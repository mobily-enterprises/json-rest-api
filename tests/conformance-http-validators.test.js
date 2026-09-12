import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createStrongEntityTag } from '../plugins/core/connectors/lib/http-validators.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'

for (const connector of ['express', 'fastify']) {
  describe(`HTTP serialized validators ${connector} (${storageMode.mode})`, () => {
    let fixture, app, parent, child, synchronize, readFailure
    const computedTransactions = []
    const renderStages = []
    const failedPutContexts = []
    const send = async (method, url, body, headers = {}) => {
      headers = { accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json', ...headers }
      if (connector === 'fastify') {
        const result = await app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) })
        return { status: result.statusCode, text: result.body, headers: result.headers }
      }
      let call = request(app)[method.toLowerCase()](url).set(headers)
      if (body !== undefined) call = call.send(body)
      const result = await call
      return { status: result.status, text: result.text, headers: result.headers }
    }
    before(async () => {
      app = connector === 'fastify' ? fastify() : express()
      if (connector === 'express') app.set('json spaces', 4)
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        databaseOptions: { concurrent: true, maxConnections: 2 },
        tables: { items: 'schema_enrichment_items' },
        apiOptions: {
          app,
          connector,
          connectorOptions: { httpValidators: true },
          fields: {
            parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true, search: true },
            childrenSummary: {
              type: 'string',
              computed: true,
              normallyHidden: true,
              dependencies: ['id'],
              compute: async ({ id, context, api }) => {
                if (context.precondition) {
                  assert.ok(context.transaction && !context.transaction.isCompleted())
                  computedTransactions.push(context.transaction)
                }
                const children = await api.resources.items.query({
                  format: 'jsonapi',
                  transaction: context.transaction,
                  queryParams: { filters: { parentId: id }, fields: { items: 'name' } }
                }, { ...context })
                return children.data.map(record => record.attributes.name).sort().join('|')
              }
            }
          },
          resourceOptions: { rowPolicy: 'visible', relationships: { children: { type: 'hasMany', target: 'items', foreignKey: 'parentId' } } },
          rowPolicyOptions: {
            policies: {
              visible: ({ context, query, column, value }) => {
                if (context.transport?.request.headers['x-hide-target']) query.where(column('name'), value('name', 'Invisible'))
                if (context.transport?.request.headers['x-hide-children']) query.where(column('name'), value('name', 'Parent'))
                return true
              }
            }
          },
          hooks: {
            beforeProcessing: {
              functionName: 'provisional-computed-dependency',
              handler: async ({ context }) => {
                if (['patch', 'put'].includes(context.method) && context.transport?.request.headers['x-provisional-child']) {
                  await fixture.api.resources.items.patch({
                    id: child.id,
                    transaction: context.transaction,
                    format: 'plain',
                    data: { name: 'Provisional child' }
                  })
                }
              }
            },
            beforeDataGet: {
              functionName: 'fail-conditional-read',
              handler: ({ context }) => {
                if (readFailure && context.transport?.request.headers['x-fail-conditional-read']) throw readFailure.value
              }
            },
            afterRollback: {
              functionName: 'capture-conditional-put-failure',
              handler: ({ context }) => {
                if (context.method === 'put' && context.transport?.request.headers['x-fail-conditional-read']) failedPutContexts.push(context)
              }
            },
            checkPermissions: {
              functionName: 'deny-conditional-write',
              handler: ({ context }) => {
                if (['patch', 'put', 'delete'].includes(context.method) && context.originalContext.transport?.request.headers['x-deny-write']) {
                  throw new RestApiResourceError('Write forbidden', { subtype: 'forbidden' })
                }
              }
            },
            finish: {
              functionName: 'fail-conditional-write-before-commit',
              handler: async ({ context }) => {
                if (['patch', 'put', 'delete'].includes(context.method) && context.transport?.request.headers['x-fail-write']) throw new Error('Conditional write rollback probe')
                if (context.method === 'get' && context.transport?.request.headers['x-delete-after-read']) {
                  await fixture.api.resources.items.delete({ id: context.id })
                }
                if (context.precondition && context.transport?.request.headers['x-race']) await synchronize()
              }
            },
            'transport:response': {
              functionName: 'validator-response-marker',
              handler: ({ context }) => {
                if (context.transport.request.headers['x-fail-render']) {
                  renderStages.push({ precondition: context.precondition === true, method: context.transport.request.method, requestMethod: context.request.method })
                  if (context.precondition) {
                    context.request.method = 'RENDER-PROBE'
                    context.transport.request.headers['x-marker'] = 'render-only'
                    context.transport.response.headers['x-render-only'] = 'discarded'
                    throw new Error('Speculative response rendering failed')
                  }
                }
                if (context.transport.response.body) {
                  context.transport.response.body.meta = {
                    marker: context.transport.request.headers['x-marker'] || 'default',
                    method: context.transport.request.method === 'HEAD' ? 'GET' : context.transport.request.method
                  }
                  if (context.transport.request.headers['x-replace-body']) {
                    context.transport.response.body = {
                      ...context.transport.response.body,
                      meta: { replacement: context.transport.request.headers['x-replace-body'] }
                    }
                  }
                }
              }
            }
          }
        }
      })
      await fixture.api.addRoute({
        method: 'OPTIONS',
        path: '/api/items/:id',
        handler: async () => ({ meta: { options: true } })
      })
      await fixture.api.addRoute({
        method: 'PATCH',
        path: '/api/unchecked-items/:id',
        routeMeta: { kind: 'resource', scopeName: 'items', operation: 'patch' },
        handler: async ({ params, body, transaction, context }) => fixture.api.resources.items.patch({
          id: params.id, document: body, transaction, format: 'jsonapi', returning: 'full'
        }, context)
      })
    })
    beforeEach(async () => {
      synchronize = undefined
      readFailure = undefined
      computedTransactions.length = 0
      renderStages.length = 0
      failedPutContexts.length = 0
      await fixture.reset()
      parent = await fixture.seed('items', { name: 'Parent' })
      child = await fixture.seed('items', { name: 'Child' }, { parent: { data: { type: 'items', id: parent.id } } })
    })
    after(async () => { try { if (connector === 'fastify') await app?.close() } finally { await fixture?.close() } })
    it('rolls back a resource handler that omits its precondition callback', async () => {
      const body = { data: { type: 'items', id: parent.id, attributes: { name: 'Unchecked' } } }
      const result = await send('PATCH', `/api/unchecked-items/${parent.id}`, body, { 'if-match': '"stale"' })
      assert.equal(result.status, 422)
      assert.equal(JSON.parse(result.text).errors[0].meta.transactionOutcome, 'rolledBack')
      assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
    })
    it('ignores valid and malformed If-Match on OPTIONS', async () => {
      for (const condition of ['*', '"stale"', 'malformed']) {
        const result = await send('OPTIONS', `/api/items/${parent.id}`, undefined, { 'if-match': condition })
        assert.equal(result.status, 200)
        assert.equal(JSON.parse(result.text).meta.method, 'OPTIONS')
      }
    })
    for (const [method, path, body] of [
      ['POST', '/api/items', { data: { type: 'items', id: '99', attributes: { name: 'Rejected' } } }],
      ['PATCH', '/api/items/:id/relationships/children', { data: [] }]
    ]) {
      it(`rejects unsupported If-Match on ${method} ${path} before mutation`, async () => {
        const original = await send('GET', `/api/items/${parent.id}?include=children`)
        for (const condition of ['*', '"tag"']) {
          const result = await send(method, path.replace(':id', parent.id), body, { 'if-match': condition })
          assert.equal(result.status, 422)
          assert.match(result.text, /If-Match is not supported for this route/)
        }
        assert.equal(await fixture.count('items'), 2)
        assert.equal((await send('GET', `/api/items/${parent.id}?include=children`)).text, original.text)
      })
    }
    it('keeps POST, PATCH and DELETE unconditional when If-Match is absent', async () => {
      const body = { data: { type: 'items', id: '99', attributes: { name: 'Created' } } }
      assert.equal((await send('POST', '/api/items', body)).status, 201)
      body.data.attributes.name = 'Updated'
      assert.equal((await send('PATCH', '/api/items/99', body)).status, 200)
      assert.equal((await send('DELETE', '/api/items/99')).status, 204)
      assert.equal((await send('GET', '/api/items/99')).status, 404)
    })
    it('isolates a speculative response-hook failure and rolls back provisional writes', async () => {
      const url = `/api/items/${parent.id}?include=children`
      const current = await send('GET', url)
      const body = { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected parent' } } }
      const failed = await send('PATCH', url, body, {
        'if-match': current.headers.etag, 'x-provisional-child': 'yes', 'x-fail-render': 'yes'
      })
      assert.equal(failed.status, 500)
      assert.equal(failed.headers['x-render-only'], undefined)
      assert.equal(JSON.parse(failed.text).errors[0].meta.transactionOutcome, 'rolledBack')
      assert.equal(JSON.parse(failed.text).meta.method, 'PATCH')
      assert.equal(JSON.parse(failed.text).meta.marker, 'default')
      assert.deepEqual(renderStages, [
        { precondition: true, method: 'GET', requestMethod: 'GET' },
        { precondition: false, method: 'PATCH', requestMethod: 'PATCH' }
      ])
      assert.equal((await fixture.api.resources.items.get({ id: child.id })).data.attributes.name, 'Child')
      assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
    })
    it('preserves row visibility in nested computed queries', async () => {
      const url = `/api/items/${parent.id}?fields[items]=name,childrenSummary`
      const visible = await send('GET', url)
      const headers = { 'x-hide-children': 'yes' }
      const hidden = await send('GET', url, undefined, headers)
      assert.equal(hidden.status, 200)
      assert.equal(JSON.parse(hidden.text).data.attributes.childrenSummary, '')
      assert.notEqual(hidden.headers.etag, visible.headers.etag)
      const body = { data: { type: 'items', id: parent.id, attributes: { name: 'Parent' } } }
      assert.equal((await send('PATCH', url, body, { ...headers, 'if-match': visible.headers.etag })).status, 412)
      const accepted = await send('PATCH', url, body, { ...headers, 'if-match': hidden.headers.etag })
      assert.equal(accepted.status, 200)
      assert.equal(JSON.parse(accepted.text).data.attributes.childrenSummary, '')
    })
    it('reads transaction-local computed dependencies and rolls them back on rejection', async () => {
      const url = `/api/items/${parent.id}?fields[items]=name,childrenSummary`
      const current = await send('GET', url)
      const body = { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected parent' } } }
      const rejected = await send('PATCH', url, body, {
        'if-match': current.headers.etag, 'x-provisional-child': 'yes'
      })
      assert.equal(rejected.status, 412)
      assert.equal((await fixture.api.resources.items.get({ id: child.id })).data.attributes.name, 'Child')
      assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
      assert.equal(computedTransactions.length, 1)
      assert.equal(computedTransactions[0].isCompleted(), true)
    })
    it('conditions computed output on its database dependencies in the write transaction', async () => {
      const url = `/api/items/${parent.id}?fields[items]=name,childrenSummary`
      const current = await send('GET', url)
      assert.equal(current.status, 200)
      assert.equal(JSON.parse(current.text).data.attributes.childrenSummary, 'Child')
      await fixture.api.resources.items.patch({ id: child.id, format: 'plain', data: { name: 'Changed child' } })
      const body = { data: { type: 'items', id: parent.id, attributes: { name: 'Updated parent' } } }
      const stale = await send('PATCH', url, body, { 'if-match': current.headers.etag })
      assert.equal(stale.status, 412)
      assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
      const refreshed = await send('GET', url)
      assert.notEqual(refreshed.headers.etag, current.headers.etag)
      const accepted = await send('PATCH', url, body, { 'if-match': refreshed.headers.etag })
      assert.equal(accepted.status, 200)
      assert.equal(JSON.parse(accepted.text).data.attributes.childrenSummary, 'Changed child')
      assert.equal(computedTransactions.length, 2)
      assert.notEqual(computedTransactions[0], computedTransactions[1])
      assert.ok(computedTransactions.every(transaction => transaction.isCompleted()))
    })
    it('uses a replaced response body for emission and strong write comparison', async () => {
      const url = `/api/items/${parent.id}`
      const headers = { 'x-replace-body': 'replacement' }
      const current = await send('GET', url, undefined, headers)
      assert.deepEqual(JSON.parse(current.text).meta, { replacement: 'replacement' })
      assert.equal(current.headers.etag, createStrongEntityTag(current.text))
      const body = { data: { type: 'items', id: parent.id, attributes: { name: 'Updated' } } }
      const stale = await send('PATCH', url, body, { 'if-match': current.headers.etag, 'x-replace-body': 'different' })
      assert.equal(stale.status, 412)
      assert.deepEqual(JSON.parse(stale.text).meta, { replacement: 'different' })
      const accepted = await send('PATCH', url, body, { ...headers, 'if-match': current.headers.etag })
      assert.equal(accepted.status, 200)
      assert.deepEqual(JSON.parse(accepted.text).meta, { replacement: 'replacement' })
      assert.equal(JSON.parse(accepted.text).data.attributes.name, 'Updated')
    })
    it('hashes the exact emitted bytes after response hooks', async () => {
      const result = await send('GET', `/api/items/${parent.id}`)
      assert.equal(result.status, 200)
      assert.equal(result.headers.etag, createStrongEntityTag(result.text))
      assert.equal(result.headers['content-type'], 'application/vnd.api+json')
      assert.equal(JSON.parse(result.text).meta.marker, 'default')
      const changed = await send('GET', `/api/items/${parent.id}`, undefined, { 'x-marker': 'changed' })
      assert.notEqual(changed.headers.etag, result.headers.etag)
      assert.equal(changed.headers.etag, createStrongEntityTag(changed.text))
    })
    it('changes the tag when included child attributes change', async () => {
      const url = `/api/items/${parent.id}?include=children`
      const first = await send('GET', url)
      await fixture.api.resources.items.patch({ id: child.id, format: 'plain', data: { name: 'Changed child' } })
      const second = await send('GET', url)
      assert.equal(first.status, 200)
      assert.equal(second.status, 200)
      assert.notEqual(first.headers.etag, second.headers.etag)
      assert.equal(JSON.parse(second.text).included[0].attributes.name, 'Changed child')
    })
    it('uses GET validators and preconditions for bodyless HEAD responses', async () => {
      const url = `/api/items/${parent.id}?include=children`
      const current = await send('GET', url)
      for (const headers of [{}, { 'if-match': current.headers.etag }, { 'if-match': '*' }]) {
        const result = await send('HEAD', url, undefined, headers)
        assert.equal(result.status, 200)
        assert.equal(result.headers.etag, current.headers.etag)
        assert.ok(!result.text)
      }
      const stale = await send('HEAD', url, undefined, { 'if-match': '"missing"' })
      assert.equal(stale.status, 412)
      assert.ok(!stale.text)
      const missing = await send('HEAD', '/api/items/999', undefined, { 'if-match': '*' })
      assert.equal(missing.status, 404)
      assert.ok(!missing.text)
    })
    it('accepts matching strong lists and wildcard GET conditions', async () => {
      const url = `/api/items/${parent.id}`
      const first = await send('GET', url)
      for (const condition of [first.headers.etag, `W/"other", , ${first.headers.etag}`, '*']) {
        const result = await send('GET', url, undefined, { 'if-match': condition })
        assert.equal(result.status, 200)
        assert.equal(result.text, first.text)
        assert.equal(result.headers.etag, first.headers.etag)
      }
    })
    it('returns a non-disclosing 412 for nonmatching, weak and empty GET lists', async () => {
      const url = `/api/items/${parent.id}`
      const first = await send('GET', url)
      for (const condition of [`W/${first.headers.etag}`, '"other"', '', ', ,']) {
        const result = await send('GET', url, undefined, { 'if-match': condition })
        assert.equal(result.status, 412)
        assert.equal(JSON.parse(result.text).errors[0].code, 'REST_API_PRECONDITION_FAILED')
        assert.ok(!result.text.includes(first.headers.etag.slice(1, -1)))
      }
      const changed = await send('GET', url, undefined, { 'if-match': first.headers.etag, 'x-marker': 'different' })
      assert.equal(changed.status, 412)
    })
    it('preserves normal missing-resource errors and rejects malformed GET conditions', async () => {
      assert.equal((await send('GET', '/api/items/999', undefined, { 'if-match': '*' })).status, 404)
      assert.equal((await send('GET', `/api/items/${parent.id}`, undefined, { 'if-match': '*,"tag"' })).status, 422)
    })
    it('does not emit a validator after transformed PUT', async () => {
      const result = await send('PUT', `/api/items/${parent.id}`, { data: { type: 'items', id: parent.id, attributes: { name: 'Updated' } } })
      assert.equal(result.status, 200)
      assert.equal(result.headers.etag, undefined)
    })
    for (const condition of ['wildcard', 'strong']) {
      for (const value of [null, undefined]) {
        it(`retains ${String(value)} from the ${condition} PUT precondition read`, async () => {
          const url = `/api/items/${parent.id}`
          const current = await send('GET', url)
          readFailure = { value }
          const body = { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected parent' } } }
          const result = await send('PUT', url, body, {
            'if-match': condition === 'wildcard' ? '*' : current.headers.etag,
            'x-fail-conditional-read': 'yes',
            'x-provisional-child': 'yes'
          })
          assert.equal(result.status, 500)
          assert.equal(JSON.parse(result.text).errors[0].meta.transactionOutcome, 'rolledBack')
          assert.equal(failedPutContexts.length, 1)
          assert.equal(failedPutContexts[0].transactionOutcome, 'rolledBack')
          let cause = failedPutContexts[0].error
          while (cause && typeof cause === 'object' && Object.hasOwn(cause, 'cause')) cause = cause.cause
          assert.equal(cause, value)
          assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
          assert.equal((await fixture.api.resources.items.get({ id: child.id })).data.attributes.name, 'Child')
        })
      }
    }
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      it(`preserves normal hidden-target errors for strong ${method}`, async () => {
        const current = await send('GET', `/api/items/${parent.id}`)
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected' } } }
        const headers = { 'if-match': current.headers.etag, 'x-hide-target': 'yes' }
        const hidden = await send(method, `/api/items/${parent.id}`, body, headers)
        assert.equal(hidden.status, 404)
        const unconditional = await send(method, `/api/items/${parent.id}`, body, { 'x-hide-target': 'yes' })
        assert.equal(unconditional.status, hidden.status)
        assert.deepEqual(JSON.parse(hidden.text), JSON.parse(unconditional.text))
        assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
        await fixture.api.resources.items.delete({ id: parent.id })
        const missing = await send(method, `/api/items/${parent.id}`, body, headers)
        assert.equal(missing.status, method === 'PUT' ? 412 : 404)
        if (method !== 'PUT') assert.deepEqual(JSON.parse(missing.text), JSON.parse(hidden.text))
      })
      it(`preserves normal hidden-target errors for wildcard ${method}`, async () => {
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected' } } }
        const headers = { 'if-match': '*', 'x-hide-target': 'yes' }
        const hidden = await send(method, `/api/items/${parent.id}`, body, headers)
        assert.equal(hidden.status, 404)
        const unconditional = await send(method, `/api/items/${parent.id}`, body, { 'x-hide-target': 'yes' })
        assert.equal(unconditional.status, hidden.status)
        assert.deepEqual(JSON.parse(hidden.text), JSON.parse(unconditional.text))
        assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
        await fixture.api.resources.items.delete({ id: parent.id })
        const missing = await send(method, `/api/items/${parent.id}`, body, headers)
        assert.equal(missing.status, method === 'PUT' ? 412 : 404)
        if (method !== 'PUT') assert.deepEqual(JSON.parse(missing.text), JSON.parse(hidden.text))
      })
      it(`does not recreate a wildcard ${method} target deleted after its existence read`, async () => {
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Recreated' } } }
        const result = await send(method, `/api/items/${parent.id}`, body, { 'if-match': '*', 'x-delete-after-read': 'yes' })
        if (databaseClient === 'better-sqlite3') {
          assert.equal(result.status, 500)
          assert.match(result.text, /database is locked/)
        } else assert.equal(result.status, method === 'PUT' ? 412 : 404)
        await assert.rejects(fixture.api.resources.items.get({ id: parent.id }), error => error.subtype === 'not_found')
      })
      it(`rolls back wildcard ${method} when its write hook fails`, async () => {
        const original = await fixture.api.resources.items.get({ id: parent.id })
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Rolled back' } } }
        const result = await send(method, `/api/items/${parent.id}`, body, { 'if-match': '*', 'x-fail-write': 'yes' })
        assert.equal(result.status, 500)
        assert.equal(JSON.parse(result.text).errors[0].meta.transactionOutcome, 'rolledBack')
        assert.deepEqual(await fixture.api.resources.items.get({ id: parent.id }), original)
      })
      it(`accepts wildcard ${method} only for an existing resource`, async () => {
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Conditional' } } }
        const result = await send(method, `/api/items/${parent.id}`, body, { 'if-match': '*' })
        assert.equal(result.status, method === 'DELETE' ? 204 : 200)
        if (method !== 'DELETE') assert.equal(JSON.parse(result.text).data.attributes.name, 'Conditional')
        const missingBody = body ? { data: { ...body.data, id: '999' } } : undefined
        const missing = await send(method, '/api/items/999', missingBody, { 'if-match': '*' })
        assert.equal(missing.status, method === 'PUT' ? 412 : 404)
        await assert.rejects(fixture.api.resources.items.get({ id: '999' }), error => error.subtype === 'not_found')
      })
    }
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      it(`accepts strong ${method} with the selected GET representation`, async () => {
        const url = `/api/items/${parent.id}?include=children`
        const current = await send('GET', url)
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Strong update' } } }
        const result = await send(method, url, body, { 'if-match': `W/"ignored", ${current.headers.etag}` })
        assert.equal(result.status, method === 'DELETE' ? 204 : 200)
        if (method !== 'DELETE') {
          assert.equal(JSON.parse(result.text).data.attributes.name, 'Strong update')
          assert.equal(JSON.parse(result.text).meta.method, method)
        }
      })
      it(`preserves forbidden ${method} errors ahead of a stale condition`, async () => {
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected' } } }
        const result = await send(method, `/api/items/${parent.id}`, body, { 'if-match': '"stale"', 'x-deny-write': 'yes' })
        assert.equal(result.status, 403)
        assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
      })
      if (method !== 'DELETE') {
        it(`validates the ${method} document before comparing a stale condition`, async () => {
          const body = { data: { type: 'items', id: '999', attributes: { name: 'Rejected' } } }
          const result = await send(method, `/api/items/${parent.id}`, body, { 'if-match': '"stale"' })
          assert.equal(result.status, 422)
          assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
        })
      }
      it(`rolls back strong ${method} when its write hook fails`, async () => {
        const url = `/api/items/${parent.id}`
        const current = await send('GET', url)
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Rolled back' } } }
        const result = await send(method, url, body, { 'if-match': current.headers.etag, 'x-fail-write': 'yes' })
        assert.equal(result.status, 500)
        assert.equal(JSON.parse(result.text).errors[0].meta.transactionOutcome, 'rolledBack')
        assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
      })
      it(`rejects weak, empty and changed response-hook conditions on ${method}`, async () => {
        const url = `/api/items/${parent.id}`
        const current = await send('GET', url)
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected' } } }
        for (const headers of [
          { 'if-match': `W/${current.headers.etag}` },
          { 'if-match': '' },
          { 'if-match': ', ,' },
          { 'if-match': current.headers.etag, 'x-marker': 'Changed variant' }
        ]) {
          const result = await send(method, url, body, headers)
          assert.equal(result.status, 412)
          assert.equal(JSON.parse(result.text).errors[0].code, 'REST_API_PRECONDITION_FAILED')
        }
        assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
      })
      it(`rejects stale included data on strong ${method}`, async () => {
        const url = `/api/items/${parent.id}?include=children`
        const current = await send('GET', url)
        await fixture.api.resources.items.patch({ id: child.id, format: 'plain', data: { name: 'Changed dependency' } })
        const body = method === 'DELETE' ? undefined : { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected' } } }
        const result = await send(method, url, body, { 'if-match': current.headers.etag })
        assert.equal(result.status, 412)
        assert.equal((await fixture.api.resources.items.get({ id: parent.id })).data.attributes.name, 'Parent')
      })
    }
    it('allows only one concurrent PATCH using the same strong representation', async () => {
      const url = `/api/items/${parent.id}?include=children`
      const current = await send('GET', url)
      const barrier = Promise.withResolvers()
      let arrivals = 0
      synchronize = async () => {
        if (++arrivals === 2) barrier.resolve()
        await barrier.promise
      }
      const change = name => send('PATCH', url, { data: { type: 'items', id: parent.id, attributes: { name } } }, {
        'if-match': current.headers.etag, 'x-race': 'yes'
      }).finally(() => barrier.resolve())
      const outcomes = await Promise.all([change('First client'), change('Second client')])
      assert.equal(arrivals, 2)
      const accepted = outcomes.filter(outcome => outcome.status === 200)
      const rejected = outcomes.filter(outcome => outcome.status === 500)
      assert.equal(accepted.length, 1)
      assert.equal(rejected.length, 1)
      const final = await send('GET', url)
      assert.equal(JSON.parse(final.text).data.attributes.name, JSON.parse(accepted[0].text).data.attributes.name)
      assert.notEqual(final.headers.etag, current.headers.etag)
    })
    it('rejects a nonmatching strong condition before mutation', async () => {
      const before = await fixture.api.resources.items.get({ id: parent.id })
      const result = await send('PATCH', `/api/items/${parent.id}`, { data: { type: 'items', id: parent.id, attributes: { name: 'Rejected' } } }, { 'if-match': '"pending"' })
      assert.equal(result.status, 412)
      assert.deepEqual(await fixture.api.resources.items.get({ id: parent.id }), before)
    })
  })
}
