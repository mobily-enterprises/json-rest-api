import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { validateJsonApiStructure } from './helpers/test-utils.js'
import { normalizeRecordAttributes } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'
import { COMPUTED_DEPENDENCIES_KEY } from '../plugins/core/lib/querying-writing/knex-constants.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const resourceMembers = new Set(['type', 'id', 'lid', 'attributes', 'relationships', 'links', 'meta'])
const resources = document => [...(Array.isArray(document.data) ? document.data : [document.data]), ...(document.included || [])].filter(Boolean)
const assertPublicResources = document => {
  for (const resource of resources(document)) {
    assert.ok(Object.keys(resource).every(key => resourceMembers.has(key)), JSON.stringify(resource))
    assert.equal(Object.hasOwn(resource, COMPUTED_DEPENDENCIES_KEY), false)
  }
}
const seed = async fixture => {
  await fixture.reset()
  const group = await fixture.seed('groups', { name: 'Group' })
  const other = await fixture.seed('groups', { name: 'Other' })
  await fixture.seed('items', { name: 'Item' }, {
    group: { data: { type: 'groups', id: group.id } },
    subject: { data: { type: 'groups', id: other.id } },
    groups: { data: [group, other].map(({ type, id }) => ({ type, id })) }
  })
}
const cases = [
  { source: 'items', id: '1', name: 'Item', relationship: 'group', target: 'groups', names: ['Group'], nested: 'items' },
  { source: 'items', id: '1', name: 'Item', relationship: 'groups', target: 'groups', names: ['Group', 'Other'], nested: 'items' },
  { source: 'items', id: '1', name: 'Item', relationship: 'subject', target: 'groups', names: ['Other'], nested: 'mentions' },
  { source: 'groups', id: '1', name: 'Group', relationship: 'items', target: 'items', names: ['Item'], nested: 'group' },
  { source: 'groups', id: '1', name: 'Group', relationship: 'firstItem', target: 'items', names: ['Item'], nested: 'group' },
  { source: 'groups', id: '2', name: 'Other', relationship: 'mentions', target: 'items', names: ['Item'], nested: 'group' }
]

describe('Response-only dependency metadata cleanup', () => {
  const scopes = { items: { vars: { schemaInfo: { outputFields: { name: { type: 'string' }, [COMPUTED_DEPENDENCIES_KEY]: { type: 'array' } } } } } }
  it('preserves dependencies during database normalization and removes them only from final resources', () => {
    const dependencies = ['name']
    const document = { data: [{ type: 'items', id: '1', attributes: { name: 'Item' }, [COMPUTED_DEPENDENCIES_KEY]: dependencies }], included: [{ type: 'items', id: '2', attributes: {}, [COMPUTED_DEPENDENCIES_KEY]: [] }] }
    assert.equal(normalizeRecordAttributes(document, scopes), document)
    assert.equal(document.data[0][COMPUTED_DEPENDENCIES_KEY], dependencies)
    assert.ok(Object.hasOwn(document.included[0], COMPUTED_DEPENDENCIES_KEY))
    assert.equal(normalizeRecordAttributes(document, scopes, { source: 'response' }), document)
    assertPublicResources(document)
    assert.deepEqual(dependencies, ['name'])
  })

  it('cleans minimal and unknown-schema resources without needing an attributes object', () => {
    const document = { data: { type: 'items', id: '1', [COMPUTED_DEPENDENCIES_KEY]: [] }, included: [{ type: 'extension', id: '2', [COMPUTED_DEPENDENCIES_KEY]: ['private'] }] }
    normalizeRecordAttributes(document, scopes, { source: 'response' })
    assertPublicResources(document)
  })

  it('preserves identical keys inside user attributes, meta and relationship metadata', () => {
    const document = {
      meta: { [COMPUTED_DEPENDENCIES_KEY]: ['document meta'] },
      data: {
        type: 'items',
        id: '1',
        attributes: { [COMPUTED_DEPENDENCIES_KEY]: ['user attribute'] },
        meta: { [COMPUTED_DEPENDENCIES_KEY]: ['resource meta'] },
        relationships: { related: { data: null, meta: { [COMPUTED_DEPENDENCIES_KEY]: ['relationship meta'] } } },
        [COMPUTED_DEPENDENCIES_KEY]: ['internal']
      }
    }
    const expected = structuredClone(document)
    delete expected.data[COMPUTED_DEPENDENCIES_KEY]
    normalizeRecordAttributes(document, scopes, { source: 'response' })
    assert.deepEqual(document, expected)
    const plain = { id: '1', [COMPUTED_DEPENDENCIES_KEY]: ['user attribute'] }
    assert.deepEqual(normalizeRecordAttributes(plain, scopes, { source: 'response', simplified: true, resourceType: 'items' }), plain)
  })

  it('accepts null data and empty compound documents', () => {
    for (const document of [{ data: null }, { data: [], included: [] }]) {
      const expected = structuredClone(document)
      assert.deepEqual(normalizeRecordAttributes(document, scopes, { source: 'response' }), expected)
    }
  })
})

for (const strategy of ['standard', 'window']) {
  describe(`Public included metadata, ${strategy} (${storageMode.mode})`, () => {
    let fixture
    const calls = []
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables,
        apiOptions: {
          collectionInclude: { strategy, limit: 20 },
          manyToManyInclude: { strategy, limit: 20 },
          fieldCallback: (kind, type, value) => { calls.push(`${kind}:${type}:${value}`); return kind === 'computed' ? `Computed ${value}` : value }
        }
      })
    })
    beforeEach(async () => { await seed(fixture); calls.length = 0 })
    after(async () => { await fixture?.close() })

    for (const entry of cases) {
      for (const method of ['get', 'query']) {
        it(`${method} ${entry.source}.${entry.relationship} keeps computed output and omits private resource members`, async () => {
          for (const selected of ['name', 'derivedName']) {
            calls.length = 0
            const result = await fixture.api.resources[entry.source][method]({
              id: entry.id,
              queryParams: { filters: { name: entry.name }, include: [entry.relationship], fields: { [entry.source]: 'name', [entry.target]: selected } }
            })
            assert.deepEqual(result.included.map(row => row.attributes[selected]).sort(), entry.names.map(name => selected === 'name' ? name : `Computed ${name}`).sort())
            if (selected === 'derivedName') {
              assert.ok(result.included.every(row => !Object.hasOwn(row.attributes, 'name')))
              assert.deepEqual(calls.filter(call => call.startsWith('computed:')).sort(), entry.names.map(name => `computed:${entry.target}:${name}`).sort())
            }
            assertPublicResources(result)
          }
        })
      }

      it(`getRelated ${entry.source}.${entry.relationship} normalizes nested included resources`, async () => {
        const result = await fixture.api.resources[entry.source].getRelated({
          id: entry.id,
          relationshipName: entry.relationship,
          queryParams: { include: [entry.nested], fields: { items: 'derivedName,group', groups: 'derivedName,items,mentions' } }
        })
        assert.ok(result.included.length > 0)
        assertPublicResources(result)
        assert.ok(result.included.every(row => row.attributes.derivedName.startsWith('Computed ')))
        assert.ok(result.included.every(row => !Object.hasOwn(row.attributes, 'name')))
      })
    }

    for (const method of ['post', 'patch', 'put']) {
      it(`${method} full response removes metadata after computing included attributes`, async () => {
        const id = method === 'post' ? '2' : '1'
        const result = await fixture.api.resources.items[method]({
          id,
          returning: 'full',
          inputRecord: { data: { type: 'items', id, attributes: { name: 'Written', active: true, score: 0 }, relationships: { group: { data: { type: 'groups', id: '1' } }, subject: { data: { type: 'groups', id: '2' } }, groups: { data: [{ type: 'groups', id: '1' }, { type: 'groups', id: '2' }] } } } },
          queryParams: { include: ['groups'], fields: { items: 'derivedName,groups', groups: 'derivedName' } }
        })
        assertPublicResources(result)
        assert.equal(result.data.attributes.derivedName, 'Computed Written')
        assert.deepEqual(result.included.map(row => row.attributes.derivedName).sort(), ['Computed Group', 'Computed Other'])
      })
    }

    it('retains nested plain computed values through the same response boundary', async () => {
      const result = await fixture.api.resources.items.get({ id: '1', format: 'plain', queryParams: { include: ['groups.items'], fields: { items: 'derivedName,groups', groups: 'derivedName,items' } } })
      assert.equal(result.derivedName, 'Computed Item')
      assert.deepEqual(result.groups.map(group => group.derivedName).sort(), ['Computed Group', 'Computed Other'])
      assert.equal(result.groups[0].items[0].id, '1')
      assert.ok(!JSON.stringify(result).includes(COMPUTED_DEPENDENCIES_KEY))
    })
  })
}

describe(`Metadata added by finish hooks (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables })
    await fixture.api.customize({
      hooks: Object.fromEntries(['finishGet', 'finishQuery', 'finishPatch'].map(hook => [hook, {
        functionName: `response-metadata-${hook}`,
        handler: ({ context }) => {
          if (!context.injectPrivateMetadata) return
          for (const resource of resources(hook === 'finishPatch' ? context.responseRecord : context.record)) {
            resource[COMPUTED_DEPENDENCIES_KEY] = ['internal hook value']
            resource.meta = { [COMPUTED_DEPENDENCIES_KEY]: ['public meta value'] }
          }
        }
      }]))
    })
  })
  beforeEach(async () => { await seed(fixture) })
  after(async () => { await fixture?.close() })
  for (const method of ['get', 'query']) {
    it(`cleans resources after ${method} finish hooks`, async () => {
      const result = await fixture.api.resources.items[method]({ id: '1', queryParams: { include: ['groups'] } }, { injectPrivateMetadata: true })
      assertPublicResources(result)
      for (const resource of resources(result)) assert.deepEqual(resource.meta, { [COMPUTED_DEPENDENCIES_KEY]: ['public meta value'] })
    })
  }
  for (const returning of ['full', 'minimal']) {
    it(`cleans a borrowed ${returning} write response after finish hooks`, async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        const result = await fixture.api.resources.items.patch({ id: '1', transaction, returning, inputRecord: { data: { type: 'items', id: '1', attributes: { name: 'Pending' } } }, queryParams: { include: ['groups'] } }, { injectPrivateMetadata: true })
        assertPublicResources(result)
        assert.deepEqual(result.data.meta, { [COMPUTED_DEPENDENCIES_KEY]: ['public meta value'] })
        assert.equal(transaction.isCompleted(), false)
      } finally { await unit.rollback() }
      assert.equal((await fixture.api.resources.items.get({ id: '1' })).data.attributes.name, 'Item')
    })
  }
})

for (const connector of ['express', 'fastify']) {
  describe(`Real ${connector} response metadata (${storageMode.mode})`, () => {
    let fixture, app, server, baseUrl
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { app, connector, fieldCallback: (kind, _type, value) => kind === 'computed' ? `Computed ${value}` : value } })
      if (connector === 'express') {
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
        baseUrl = `http://127.0.0.1:${server.address().port}`
      } else baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    })
    beforeEach(async () => { await seed(fixture) })
    after(async () => {
      try {
        if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        if (connector === 'fastify') await app?.close()
      } finally { await fixture?.close() }
    })
    for (const method of ['GET', 'POST', 'PATCH']) {
      for (const include of ['groups', 'groups.items']) {
        it(`${method} returns clean included computed resources over HTTP (${include})`, async () => {
          const id = method === 'POST' ? '2' : '1'
          const input = { data: { type: 'items', id, attributes: { name: 'HTTP item' }, relationships: { groups: { data: [{ type: 'groups', id: '1' }] } } } }
          const search = new URLSearchParams({ include, 'fields[items]': 'name,derivedName,groups', 'fields[groups]': 'derivedName' })
          const response = await fetch(`${baseUrl}/api/items${method === 'POST' ? '' : '/1'}?${search}`, { method, headers: { 'content-type': 'application/vnd.api+json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(input) }) })
          assert.equal(response.status, method === 'POST' ? 201 : 200)
          const result = await response.json()
          validateJsonApiStructure(result)
          assertPublicResources(result)
          assert.ok(result.included.length > 0)
          assert.ok(result.included.every(row => row.attributes.derivedName.startsWith('Computed ')))
        })
      }
    }
  })
}
