import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import knexLib from 'knex'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createConnectorParityApi, createIdConformanceApi } from './fixtures/api-configs.js'
import { cleanTables, createJsonApiDocument, validateJsonApiStructure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

const jsonapi = 'application/vnd.api+json'

for (const connector of ['express', 'fastify']) {
  for (const returning of ['none', 'minimal', 'full']) {
    describe(`Real ${connector}, programmatic returning=${returning} (${storageMode.mode})`, () => {
      let api
      let app
      let knex
      let lastWriteMetadata
      const publicBaseUrl = returning === 'minimal' ? 'https://public.example/api/' : ''
      const prefix = publicBaseUrl ? publicBaseUrl.slice(0, -1) : '/api'
      const send = async (method, url, body, headers = {}) => {
        headers = { accept: jsonapi, ...(body === undefined ? {} : { 'content-type': jsonapi }), ...headers }
        if (connector === 'fastify') {
          const response = await app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) })
          return { status: response.statusCode, headers: response.headers, body: response.body ? response.json() : undefined }
        }
        let req = request(app)[method.toLowerCase()](url).set(headers).timeout({ response: 3000, deadline: 5000 })
        if (body !== undefined) req = req.send(body)
        const response = await req
        return { status: response.status, headers: response.headers, body: response.text ? response.body : undefined }
      }
      const seed = async (type, attributes, relationships) => (await api.resources[type].post({
        document: createJsonApiDocument(type, attributes, relationships), format: 'jsonapi', returning: 'full'
      })).data
      const assertDocument = (response, status = 200) => {
        assert.equal(response.status, status, JSON.stringify(response.body))
        assert.equal(response.headers['content-type'], jsonapi)
        assert.deepEqual(response.headers.vary.split(',').map(value => value.trim().toLowerCase()).sort(), ['accept', 'origin'])
        validateJsonApiStructure(response.body, Array.isArray(response.body.data))
      }

      before(async () => {
        knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
        app = connector === 'fastify' ? fastify({ bodyLimit: 1024 }) : express()
        if (connector === 'fastify') {
          app.removeContentTypeParser('application/json')
          app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
            try { done(null, { hostParsed: JSON.parse(body) }) } catch (error) { done(error) }
          })
          app.get('/health', async () => ({ host: true }))
          app.post('/host-parser', async req => req.body)
          app.setNotFoundHandler(async (req, reply) => reply.code(404).send({ host: 'missing' }))
        } else {
          app.get('/health', (req, res) => res.json({ host: true }))
          app.post('/host-parser', express.json(), (req, res) => res.json({ hostParsed: req.body }))
        }
        api = await createConnectorParityApi(knex, { app, connector, returning, publicBaseUrl })
        await api.customize({
          hooks: {
            beforeDataCall: {
              functionName: 'capture-write-document-metadata',
              handler: ({ context }) => {
                if (context.inputRecord) {
                  const { meta, links, jsonapi } = context.inputRecord
                  lastWriteMetadata = { meta, links, jsonapi }
                }
              }
            }
          }
        })
        if (connector === 'express') app.use((req, res) => res.status(404).json({ host: 'missing' }))
        assert.equal(api.anyapi ? 'anyapi' : 'knex', storageMode.mode)
        if (connector === 'fastify') {
          await app.ready()
          assert.equal(app.hasContentTypeParser(jsonapi), false, 'Connector parser must stay in its own Fastify scope')
        }
      })
      beforeEach(async () => { await cleanTables(knex, ['connector_cities', 'connector_countries']) })
      after(async () => {
        try { if (connector === 'fastify') await app?.close() } finally {
          try { await knex?.destroy() } finally { storageMode.clearRegistry(knex) }
        }
      })

      it('selects full JSON:API HTTP responses independently from programmatic defaults', async () => {
        const direct = await api.resources.countries.post({ data: { name: 'Direct' } })
        if (returning === 'none') assert.equal(direct, undefined)
        else if (returning === 'minimal') assert.deepEqual(Object.keys(direct).sort(), ['id', 'type'])
        else assert.equal(direct.name, 'Direct')
        const created = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'HTTP', active: false, rank: 0 }))
        assertDocument(created, 201)
        const id = created.body.data.id
        assert.equal(created.body.data.attributes.name, 'HTTP')
        assert.equal(created.body.data.attributes.active, false)
        assert.equal(created.body.data.attributes.rank, 0)
        assert.equal(created.headers.location, `${prefix}/countries/${id}`)
        assert.equal(created.headers['x-connector-test'], 'enabled')
        const city = await send('POST', '/api/cities', createJsonApiDocument('cities', { name: 'City override' }))
        assertDocument(city, 201)
        assert.equal(city.body.data.attributes.name, 'City override')
        assertDocument(await send('GET', `/api/countries/${id}`))
        assertDocument(await send('GET', '/api/countries'))
        const updated = await send('PATCH', `/api/countries/${id}`, createJsonApiDocument('countries', { name: 'Updated' }))
        assertDocument(updated)
        assert.equal(updated.body.data.attributes.name, 'Updated')
        const deleted = await send('DELETE', `/api/countries/${id}`)
        assert.equal(deleted.status, 204)
        assert.equal(deleted.body, undefined)
        assert.equal((await send('GET', `/api/countries/${id}`)).status, 404)
      })

      it('creates and replaces through PUT with the same explicit identity', async () => {
        for (const name of ['Created', 'Replaced']) {
          const body = createJsonApiDocument('countries', { name, active: false })
          body.data.id = '701'
          const response = await send('PUT', '/api/countries/701', body)
          assertDocument(response)
          assert.equal(response.body.data.id, '701')
          assert.equal(response.body.data.attributes.name, name)
        }
        assert.equal((await api.resources.countries.query()).data.length, 1)
      })

      it('retains document metadata for write hooks without treating it as stored fields', async () => {
        const metadata = { meta: { reason: 'Catalog correction' }, links: { self: '/source/country' }, jsonapi: { version: '1.1' } }
        const document = { ...createJsonApiDocument('countries', { name: 'Original' }), ...metadata }
        const created = await send('POST', '/api/countries', document)
        assertDocument(created, 201)
        assert.deepEqual(lastWriteMetadata, metadata)
        const id = created.body.data.id
        for (const method of ['PATCH', 'PUT']) {
          const body = { ...createJsonApiDocument('countries', { name: method, active: true }), ...metadata }
          body.data.id = id
          const updated = await send(method, `/api/countries/${id}`, body)
          assertDocument(updated)
          assert.deepEqual(lastWriteMetadata, metadata)
          assert.equal(updated.body.data.attributes.name, method)
          assert.equal(updated.body.data.attributes.meta, undefined)
          assert.equal(updated.body.data.attributes.links, undefined)
          assert.equal(updated.body.data.attributes.jsonapi, undefined)
        }
      })

      it('accepts only JSON:API write documents over HTTP and rejects unsupported document members', async () => {
        const document = createJsonApiDocument('countries', { name: 'Rejected' })
        for (const body of [
          { name: 'Plain application data' },
          { document },
          { ...document, included: [] },
          { ...document, errors: [] }
        ]) {
          const response = await send('POST', '/api/countries', body)
          assert.equal(response.status, 422, JSON.stringify(response.body))
          assert.ok(response.body.errors.length)
        }
        assert.deepEqual((await api.resources.countries.query()).data, [])
      })

      it('accepts bodyless resource deletion with either supported JSON content type', async () => {
        for (const contentType of [jsonapi, 'application/json']) {
          const country = await seed('countries', { name: 'Delete' })
          const response = await send('DELETE', `/api/countries/${country.id}`, undefined, { 'content-type': contentType })
          assert.equal(response.status, 204, JSON.stringify(response.body))
          assert.equal(response.body, undefined)
        }
        assert.deepEqual((await api.resources.countries.query()).data, [])
      })

      it('rejects mismatching zero and invalid body IDs without changing the path record', async () => {
        const country = await seed('countries', { name: 'Unchanged' })
        for (const method of ['PUT', 'PATCH']) {
          for (const id of [0, null, false, '']) {
            const body = createJsonApiDocument('countries', { name: 'Wrong', active: true })
            body.data.id = id
            const response = await send(method, `/api/countries/${country.id}`, body)
            assert.equal(response.status, 422, JSON.stringify(response.body))
            assert.ok(response.body.errors.length > 0)
            const stored = await api.resources.countries.get({ id: country.id, format: 'jsonapi' })
            assert.equal(stored.data.attributes.name, 'Unchanged')
          }
        }
      })

      it('does not derive links from untrusted proxy headers and honors trusted overrides', async () => {
        for (const override of [false, true]) {
          const response = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'Country' }), {
            host: 'attacker.example',
            'x-forwarded-host': 'proxy-attacker.example',
            'x-forwarded-proto': 'https',
            ...(override ? { 'x-use-public-url-override': 'yes' } : {})
          })
          assertDocument(response, 201)
          const expected = `${override ? 'https://trusted.example/api' : prefix}/countries/${response.body.data.id}`
          assert.equal(response.headers.location, expected)
          assert.equal(response.body.links.self, expected)
          assert.equal(response.body.data.links.self, expected)
        }
      })

      it('runs response hooks after explicit request rejection', async () => {
        const response = await send('GET', '/api/countries', undefined, { 'x-block-request': 'yes' })
        assert.equal(response.status, 401)
        assert.deepEqual(response.body, { errors: [{ status: '401', title: 'Unauthorized', detail: 'Blocked by connector parity hook' }] })
        assert.equal(response.headers['x-connector-test'], 'enabled')
      })

      it('awaits rejected request hooks and sends a JSON:API error without writing', async () => {
        const response = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'Rejected' }), { 'x-throw-request': 'yes' })
        assert.equal(response.status, 500)
        assert.equal(response.body.errors[0].detail, 'Connector request hook failed')
        assert.equal(response.headers['content-type'], jsonapi)
        assert.equal(response.headers['x-connector-test'], 'enabled')
        assert.deepEqual((await api.resources.countries.query()).data, [])
      })

      for (const contentType of [jsonapi, 'application/json']) {
        it(`preserves accepted scalar coercion and nulls from the resource contract (${contentType})`, async () => {
          const body = createJsonApiDocument('countries', { name: 'Coerced', active: 'false', rank: '0' })
          const direct = (await api.resources.countries.post({ document: structuredClone(body), format: 'jsonapi', returning: 'full' })).data
          const created = await send('POST', '/api/countries', body, { 'content-type': contentType })
          assertDocument(created, 201)
          assert.deepEqual(created.body.data.attributes, direct.attributes)
          const patch = createJsonApiDocument('countries', { rank: null })
          const updated = await send('PATCH', `/api/countries/${created.body.data.id}`, patch, { 'content-type': contentType })
          assertDocument(updated)
          assert.equal(updated.body.data.attributes.rank, null)
          assert.equal(updated.body.data.attributes.active, false)
        })

        it(`validates malformed bodies consistently with programmatic calls (${contentType})`, async () => {
          for (const body of [
            [], 'null', 'false', '3', '"text"',
            {},
            { data: null },
            createJsonApiDocument('wrong', { name: 'Wrong type' }),
            createJsonApiDocument('countries', { code: 'IV' }),
            createJsonApiDocument('countries', { name: { bad: true } }),
            createJsonApiDocument('countries', { name: 'Valid', unknown: 'reject me' })
          ]) {
            let expected
            try { await api.resources.countries.post({ document: typeof body === 'string' ? JSON.parse(body) : structuredClone(body), format: 'jsonapi' }) } catch (error) { expected = error }
            assert.equal(expected?.code, 'REST_API_VALIDATION')
            const response = await send('POST', '/api/countries', body, { 'content-type': contentType })
            assert.equal(response.status, 422, JSON.stringify(response.body))
            assert.equal(response.body.errors[0].detail, expected.details.violations?.[0]?.message || expected.message)
            assert.equal(response.headers['x-connector-test'], 'enabled')
          }
          assert.deepEqual((await api.resources.countries.query()).data, [])
        })

        it(`maps malformed JSON to an HTTP error (${contentType})`, async () => {
          const response = await send('POST', '/api/countries', '{"data":', { 'content-type': contentType })
          assert.equal(response.status, 400)
          assert.equal(response.headers['content-type'], jsonapi)
          assert.equal(response.body.errors[0].status, '400')
          assert.deepEqual((await api.resources.countries.query()).data, [])
        })
      }

      it('rejects unsupported write content types without writing', async () => {
        const response = await send('POST', '/api/countries', 'unsupported', { 'content-type': 'text/plain' })
        assert.equal(response.status, 415)
        assert.match(response.body.errors[0].detail, /Content-Type must be/)
        assert.deepEqual((await api.resources.countries.query()).data, [])
      })

      it('matches complete media types and validates JSON:API parameters', async () => {
        for (const contentType of [
          'application/json-invalid', 'text/plain; note="application/json"',
          `${jsonapi}; charset=utf-8`, `${jsonapi}; ext="https://unsupported.example/extension"`
        ]) {
          const response = await send('POST', '/api/countries', JSON.stringify(createJsonApiDocument('countries', { name: 'Rejected' })), { 'content-type': contentType })
          assert.equal(response.status, 415, `${contentType}: ${JSON.stringify(response.body)}`)
          assert.equal(response.body.errors[0].status, '415')
          assert.equal((await send('POST', '/api/countries', '{', { 'content-type': contentType })).status, 415)
        }
        assert.deepEqual((await api.resources.countries.query()).data, [])
        for (const contentType of ['Application/JSON; charset=utf-8', `${jsonapi}; profile="https://unknown.example/profile"`]) {
          assertDocument(await send('POST', '/api/countries', JSON.stringify(createJsonApiDocument('countries', { name: 'Accepted' })), { 'content-type': contentType }), 201)
        }
      })

      it('rejects unacceptable response media types before writing', async () => {
        for (const accept of [
          'text/html', `${jsonapi}; q=0`, `${jsonapi}; charset=utf-8`,
          `${jsonapi}; ext="https://unsupported.example/extension"`, `${jsonapi};q=0, */*;q=1`
        ]) {
          const response = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'Rejected' }), { accept })
          assert.equal(response.status, 406, `${accept}: ${JSON.stringify(response.body)}`)
          assert.equal(response.body.errors[0].status, '406')
        }
        assert.deepEqual((await api.resources.countries.query()).data, [])
        for (const accept of ['*/*', 'application/*', `${jsonapi}; profile="https://unknown.example/profile"`, `${jsonapi}; ext="https://unsupported.example/extension", ${jsonapi};q=0.5`]) {
          assertDocument(await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'Accepted' }), { accept }), 201)
        }
      })

      it('rejects oversized bodies before validation or storage', async () => {
        for (const contentType of [jsonapi, 'application/json']) {
          const response = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'x'.repeat(2048) }), { 'content-type': contentType })
          assert.equal(response.status, 413, JSON.stringify(response.body))
          assert.equal(response.body.errors[0].status, '413')
          assert.equal(response.headers['content-type'], jsonapi)
        }
        assert.deepEqual((await api.resources.countries.query()).data, [])
      })

      it('rejects fractional pagination and removed control options', async () => {
        const removed = ['simplified', 'simplifiedApi', 'simplifiedTransport', 'returnFullRecord', 'returnRecordApi', 'returnRecordTransport', 'isTransport']
        const queries = ['page[size]=1.5', 'page[number]=1.5', ...removed.flatMap(name => [`${name}=true`, `${name}=false`, `${name}=`])]
        for (const query of queries) {
          const response = await send('GET', `/api/countries?${query}`)
          assert.equal(response.status, 422, `${query}: ${JSON.stringify(response.body)}`)
          assert.equal(response.body.errors[0].status, '422')
        }
      })

      for (const fields of ['', 'country', 'name']) {
        it(`preserves the HTTP fieldset '${fields}' for primary and included resources`, async () => {
          const country = await seed('countries', { name: 'Country' })
          const city = await seed('cities', { name: 'City' }, { country: { data: { type: 'countries', id: country.id } } })
          for (const path of ['/api/cities', `/api/cities/${city.id}`]) {
            const response = await send('GET', `${path}?include=country&fields[cities]=${fields}&fields[countries]=`)
            assertDocument(response)
            for (const row of [response.body.data].flat()) {
              assert.deepEqual(row.attributes || {}, fields === 'name' ? { name: 'City' } : {})
              assert.deepEqual(Object.keys(row.relationships || {}), fields === 'country' ? ['country'] : [])
              if (fields === 'country') assert.deepEqual(row.relationships.country.data, { type: 'countries', id: country.id })
            }
            assert.equal(response.body.included[0].id, country.id)
            assert.deepEqual(response.body.included[0].attributes || {}, {})
            assert.deepEqual(response.body.included[0].relationships || {}, {})
          }
        })
      }

      it('keeps prototype-like fieldset names visible to validation', async () => {
        for (const type of ['__proto__', 'constructor', 'toString', 'unknown']) {
          await assert.rejects(api.resources.countries.query({ queryParams: { fields: { [type]: 'name' } } }), { code: 'REST_API_FIELDSET_INVALID' })
          const response = await send('GET', `/api/countries?fields[${type}]=name`)
          assert.equal(response.status, 400, JSON.stringify(response.body))
          assert.equal(response.body.errors[0].code, 'REST_API_FIELDSET_INVALID')
        }
      })

      it('rejects unsupported include paths in empty collections with a parameter error', async () => {
        for (const path of ['unknown', 'name', '__proto__', 'constructor', 'toString']) {
          const response = await send('GET', `/api/countries?include=${path}`)
          assert.equal(response.status, 400, JSON.stringify(response.body))
          assert.equal(response.body.errors[0].code, 'REST_API_INCLUDE_INVALID')
          assert.deepEqual(response.body.errors[0].source, { parameter: 'include' })
        }
      })

      it('leaves host routes and host 404 handling outside the API prefix', async () => {
        assert.deepEqual((await send('GET', '/health', undefined, { accept: 'text/html', 'x-block-request': 'yes' })).body, { host: true })
        assert.deepEqual((await send('POST', '/host-parser', { value: 1 }, { 'content-type': 'application/json' })).body, { hostParsed: { value: 1 } })
        for (const url of ['/apix/unknown', '/outside']) {
          const response = await send('POST', url, 'host body', { accept: 'text/html', 'content-type': 'text/plain' })
          assert.equal(response.status, 404)
          assert.deepEqual(response.body, { host: 'missing' })
        }
      })

      it('rejects invalid encoded route parameters at the framework boundary', async () => {
        const response = await send('GET', '/api/countries/%E0%A4%A')
        assert.equal(response.status, 400)
        if (connector === 'express') {
          assert.equal(response.headers['content-type'], jsonapi)
          assert.equal(response.body.errors[0].status, '400')
        } else {
          // Fastify routes malformed URLs to its host-owned onBadUrl before plugin hooks.
          assert.equal(response.body.code, 'FST_ERR_BAD_URL')
          assert.equal(response.body.statusCode, 400)
        }
      })

      it('returns JSON:API errors for unknown API routes', async () => {
        const response = await send('GET', '/api/unknown/deep')
        assert.equal(response.status, 404)
        assert.equal(response.headers['content-type'], jsonapi)
        assert.equal(response.body.errors[0].status, '404')
        assert.equal(response.headers['x-connector-test'], 'enabled')
      })

      it('coerces allowed query values and follows pagination links with sparse fields', async () => {
        for (const [index, name] of ['Alpha', 'Beta', 'Gamma'].entries()) await seed('countries', { name, active: true, rank: index })
        await seed('countries', { name: 'Excluded', active: false, rank: 0 })
        const ids = []
        let url = '/api/countries?filter[active]=true&page[size]=2&sort=rank&fields[countries]=name'
        while (url) {
          const response = await send('GET', url)
          assertDocument(response)
          assert.ok(response.body.data.length <= 2)
          for (const record of response.body.data) {
            assert.deepEqual(Object.keys(record.attributes), ['name'])
            assert.notEqual(record.attributes.name, 'Excluded')
            ids.push(record.id)
          }
          const next = response.body.links?.next
          url = next ? new URL(next, 'http://localhost').pathname + new URL(next, 'http://localhost').search : null
          assert.ok(ids.length <= 3, 'Pagination must terminate without repeating records')
        }
        assert.equal(new Set(ids).size, 3)
      })

      it('preserves literal question marks inside query values', async () => {
        const expected = await seed('countries', { name: 'Who? Why' })
        await seed('countries', { name: 'Who' })
        const response = await send('GET', '/api/countries?filter[name]=Who?%20Why')
        assertDocument(response)
        assert.deepEqual(response.body.data.map(record => record.id), [expected.id])
      })

      it('executes all relationship routes with includes and persistent membership', async () => {
        const country = await seed('countries', { name: 'Country' })
        const city = await seed('cities', { name: 'City' })
        const relationshipUrl = `/api/countries/${country.id}/relationships/cities`
        const relatedUrl = `/api/countries/${country.id}/cities`
        const body = { data: [{ type: 'cities', id: city.id }] }
        assert.deepEqual((await send('GET', relationshipUrl)).body.data, [])
        for (const method of ['POST', 'PATCH']) {
          const response = await send(method, relationshipUrl, body)
          assert.equal(response.status, 204, JSON.stringify(response.body))
          assert.equal(response.body, undefined)
          assert.deepEqual((await send('GET', relationshipUrl)).body.data, body.data)
        }
        const related = await send('GET', `${relatedUrl}?include=country`)
        assertDocument(related)
        assert.equal(related.body.data[0].attributes.name, 'City')
        assert.equal(related.body.included[0].id, country.id)
        assert.equal((await send('DELETE', relationshipUrl, body)).status, 204)
        assert.deepEqual((await send('GET', relationshipUrl)).body.data, [])
        assert.equal((await api.resources.cities.get({ id: city.id, format: 'jsonapi' })).data.relationships.country.data, null)
      })
    })
  }
}

for (const connector of ['express', 'fastify']) {
  describe(`Real ${connector} opaque ID links (${storageMode.mode})`, () => {
    let api
    let app
    let server
    let knex
    let baseUrl
    before(async () => {
      knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
      app = connector === 'fastify' ? fastify() : express()
      api = await createIdConformanceApi(knex, { idType: 'string', connector, app })
      assert.equal(api.anyapi ? 'anyapi' : 'knex', storageMode.mode)
      if (connector === 'fastify') {
        baseUrl = await app.listen({ port: 0, host: '127.0.0.1' })
      } else {
        server = createServer(app).listen(0, '127.0.0.1')
        await once(server, 'listening')
        baseUrl = `http://127.0.0.1:${server.address().port}`
      }
    })
    beforeEach(async () => { await cleanTables(knex, ['conformance_memberships', 'conformance_items', 'conformance_groups']) })
    after(async () => {
      try {
        if (connector === 'fastify') await app?.close()
        else if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      } finally {
        try { await knex?.destroy() } finally { storageMode.clearRegistry(knex) }
      }
    })
    const send = async (url, method = 'GET', body) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { accept: jsonapi, 'content-type': jsonapi },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000)
      })
      const text = await response.text()
      assert.equal(response.status, method === 'POST' ? 201 : 200, text)
      return { body: JSON.parse(text), location: response.headers.get('location') }
    }
    for (const id of ['0', 'part/one?x#% β', '__proto__', 'constructor']) {
      it(`follows resource and relationship links for ${JSON.stringify(id)}`, async () => {
        const expected = `/api/groups/${encodeURIComponent(id)}`
        const created = await send('/api/groups', 'POST', { data: { type: 'groups', id, attributes: { name: 'Parent' } } })
        assert.equal(created.location, expected)
        assert.equal(created.body.links.self, expected)
        assert.equal(created.body.data.links.self, expected)
        const child = await send('/api/items', 'POST', {
          data: { type: 'items', id, attributes: { name: 'Child' }, relationships: { group: { data: { type: 'groups', id } } } }
        })
        const fetched = await send(child.location)
        assert.equal(fetched.body.data.id, id)
        const relationship = fetched.body.data.relationships.group
        assert.equal(relationship.links.self, `/api/items/${encodeURIComponent(id)}/relationships/group`)
        assert.equal(relationship.links.related, `/api/items/${encodeURIComponent(id)}/group`)
        assert.deepEqual((await send(relationship.links.self)).body.data, { type: 'groups', id })
        assert.equal((await send(relationship.links.related)).body.data.id, id)
        const linkage = await send(`${created.location}/relationships/items`)
        assert.equal(linkage.body.links.related, `${expected}/items`)
        const reverse = await send(linkage.body.links.related)
        assert.deepEqual(reverse.body.data.map(record => record.id), [id])
      })
    }
  })
}
