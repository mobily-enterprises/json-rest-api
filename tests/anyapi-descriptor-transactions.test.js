import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const identifier = ({ type, id }) => ({ type, id })
const rollbackRequested = new Error('Roll back cold descriptor writes')

describe(`Cold canonical descriptors on one connection (${databaseClient})`, () => {
  let fixture, registry, tenant, group, item, other, transaction, failFinish
  let recording = false
  let metadataStatements = 0
  const invalidate = () => {
    for (const resource of Object.keys(tables)) registry.invalidateDescriptor(tenant, resource)
    recording = true
    metadataStatements = 0
  }
  const snapshot = async (db = fixture.knex) => ({
    records: await db('any_records').orderBy('id'),
    links: await db('any_links').orderBy('id')
  })
  before(async () => {
    fixture = await createConformanceFixture({
      storage: 'anyapi',
      createApi: createIdConformanceApi,
      tables,
      apiOptions: { inverseMembership: true },
      databaseOptions: { maxConnections: 1, acquireConnectionTimeout: 1000 }
    })
    registry = fixture.api.anyapi.registry
    tenant = fixture.api.anyapi.tenantId
    fixture.knex.on('query', ({ sql }) => {
      if (recording && /any_(resource|field|relationship)_configs/.test(sql)) metadataStatements++
    })
    await fixture.api.customize({
      hooks: {
        finish: {
          functionName: 'fail-after-cold-descriptor-write',
          handler: ({ context }) => { if (failFinish && context.method === 'patch') throw failFinish }
        }
      }
    })
  })
  beforeEach(async () => {
    recording = false
    failFinish = undefined
    await fixture.reset()
    for (const resource of Object.keys(tables)) await registry.getDescriptor(tenant, resource)
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' }, {
      group: { data: identifier(group) }, subject: { data: identifier(group) }, groups: { data: [identifier(group)] }
    })
    other = await fixture.seed('items', { name: 'Other' })
  })
  afterEach(async () => {
    failFinish = undefined
    if (transaction && !transaction.isCompleted()) await transaction.rollback()
    transaction = undefined
    recording = false
    assert.equal(metadataStatements, 0, 'resource operations must use published metadata without querying configuration tables')
  })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    for (const method of ['post', 'put', 'patch', 'delete', 'postRelationship', 'patchRelationship', 'deleteRelationship']) {
      for (const managed of [false, true]) {
        it(`${method} ${format} succeeds cold with a ${managed ? 'callback-owned' : 'method-owned'} transaction`, async () => {
          const beforeState = await snapshot()
          invalidate()
          const context = {}
          const related = method.endsWith('Relationship')
          const id = method === 'post' ? '99' : item.id
          const attributes = { name: 'Changed', active: true, score: 0 }
          const relationships = { group: { data: identifier(group) }, subject: { data: identifier(group) }, groups: { data: [identifier(group)] } }
          const params = related
            ? { id: group.id, relationshipName: 'members', relationshipData: [identifier(method === 'deleteRelationship' ? item : other)] }
            : {
                id,
                [format === 'jsonapi' ? 'document' : 'data']: format === 'jsonapi'
                  ? { data: { type: 'items', id, attributes, relationships } }
                  : { id, ...attributes, group: group.id, subject: { id: group.id, _type: group.type }, groups: [group.id] },
                queryParams: { include: ['group.items', 'groups.members.subject', 'subject.firstItem'] }
              }
          const check = async transaction => {
            await fixture.api.resources[related ? 'groups' : 'items'][method]({
              ...params, format, returning: 'full', transaction
            }, context)
            assert.equal(context.transaction.isCompleted(), !managed)
            assert.equal(context.transactionCommitted, !managed)
            assert.equal(registry.cache.size, 0, 'transaction reads must not publish descriptors to the committed cache')
            const db = managed ? transaction : fixture.knex
            assert.notDeepEqual(await snapshot(db), beforeState)
            if (managed) {
              assert.equal(context.transaction, transaction)
              throw rollbackRequested
            }
          }
          if (managed) {
            await assert.rejects(fixture.api.transaction(check), /Roll back cold descriptor writes/)
            assert.deepEqual(await snapshot(), beforeState)
          } else await check()
          assert.equal(context.transaction.isCompleted(), true)
          assert.equal(context.transactionOutcome, managed ? 'rolledBack' : 'committed')
          if (!managed && related) {
            const result = await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members', format: 'jsonapi' })
            const expected = method === 'postRelationship' ? [item, other] : method === 'patchRelationship' ? [other] : []
            assert.deepEqual(result.data.map(row => row.id).sort(), expected.map(row => row.id).sort())
          } else if (!managed && method === 'delete') {
            assert.equal(await fixture.count('items'), 1)
          } else if (!managed) {
            const result = await fixture.api.resources.items.get({ id, format: 'jsonapi', queryParams: { include: ['group'] } })
            assert.equal(result.data.attributes.name, 'Changed')
            assert.equal(result.included.find(row => row.type === 'groups').attributes.name, 'Group')
          }
        })
      }
    }

    for (const scenario of [
      { resource: 'items', method: 'get', include: ['group.items', 'subject.firstItem', 'groups.members'] },
      { resource: 'groups', method: 'get', include: ['items.subject', 'firstItem.group', 'members.groups', 'mentions.group'] },
      { resource: 'items', method: 'query', include: ['group', 'subject', 'groups'], filters: { name: 'Original' } },
      { resource: 'groups', method: 'getRelated', relationshipName: 'items', include: ['subject.items'] },
      { resource: 'groups', method: 'getRelated', relationshipName: 'members', include: ['groups'] },
      { resource: 'groups', method: 'getRelationship', relationshipName: 'members' }
    ]) {
      it(`${scenario.resource}.${scenario.method} ${scenario.relationshipName || ''} ${format} loads root and related cold descriptors inside the borrowed transaction`, async () => {
        const read = transaction => fixture.api.resources[scenario.resource][scenario.method]({
          id: scenario.resource === 'items' ? item.id : group.id,
          format,
          transaction,
          relationshipName: scenario.relationshipName,
          queryParams: { include: scenario.include || [], filters: scenario.filters || {} }
        })
        const expected = await read()
        invalidate()
        transaction = await fixture.knex.transaction()
        assert.deepEqual(await read(transaction), expected)
        assert.equal(transaction.isCompleted(), false)
        assert.equal(registry.cache.size, 0)
      })
    }
  }

  it('paginates uncommitted records with cold descriptors without reading configuration tables', async () => {
    invalidate()
    await assert.rejects(fixture.api.transaction(async transaction => {
      const query = () => fixture.api.resources.items.query({
        transaction,
        format: 'jsonapi',
        queryParams: { filters: { name: 'Original' }, sort: ['id'], page: { number: 1, size: 1 } }
      })
      const before = await query()
      assert.deepEqual(before.data.map(row => row.id), [item.id])
      assert.equal(before.meta.pagination.total, 1)
      assert.equal(before.meta.pagination.pageCount, 1)
      await fixture.api.resources.items.post({
        transaction,
        format: 'jsonapi',
        returning: 'none',
        document: { data: { type: 'items', id: '99', attributes: { name: 'Original' } } }
      })
      const after = await query()
      assert.equal(after.data.length, 1)
      assert.equal(after.meta.pagination.total, 2)
      assert.equal(after.meta.pagination.pageCount, 2)
      assert.equal(transaction.isCompleted(), false)
      assert.equal(registry.cache.size, 0, 'transaction reads must not publish descriptors to the committed cache')
      throw rollbackRequested
    }), /Roll back cold descriptor writes/)
    assert.equal(await fixture.count('items'), 2)
  })

  for (const returning of ['full', 'none']) {
    for (const managed of [false, true]) {
      it(`PUT-create ${returning} handles a cold existence lookup (${managed ? 'managed' : 'owned'})`, async () => {
        const beforeState = await snapshot()
        invalidate()
        const check = async transaction => {
          const result = await fixture.api.resources.items.put({
            id: '99',
            format: 'jsonapi',
            returning,
            transaction,
            document: { data: { type: 'items', id: '99', attributes: { name: 'New' } } }
          })
          if (returning === 'none') assert.equal(result, undefined)
          else assert.equal(result.data.attributes.name, 'New')
          assert.notDeepEqual(await snapshot(transaction || fixture.knex), beforeState)
          if (managed) {
            assert.equal(transaction.isCompleted(), false)
            throw rollbackRequested
          }
        }
        if (managed) {
          await assert.rejects(fixture.api.transaction(check), /Roll back cold descriptor writes/)
          assert.deepEqual(await snapshot(), beforeState)
        } else {
          await check()
          assert.equal(await fixture.count('items'), 3)
        }
      })
    }
  }

  for (const managed of [false, true]) {
    it(`preserves ${managed ? 'callback ownership' : 'owned rollback'} when finish fails after cold descriptor reads`, async () => {
      const beforeState = await snapshot()
      invalidate()
      failFinish = new Error('Failure after cold write')
      const context = {}
      const check = async transaction => {
        await assert.rejects(fixture.api.resources.items.patch({
          id: item.id,
          transaction,
          format: 'plain',
          returning: 'full',
          data: { name: 'Changed', groups: [] },
          queryParams: { include: ['group'] }
        }, context), error => error === failFinish || error.cause === failFinish)
        assert.equal(context.transaction.isCompleted(), !managed)
        assert.equal(context.transactionCommitted, false)
        if (managed) {
          assert.notDeepEqual(await snapshot(transaction), beforeState)
        }
      }
      if (managed) await assert.rejects(fixture.api.transaction(check), error => error.cause?.cause === failFinish)
      else await check()
      assert.equal(context.transaction.isCompleted(), true)
      assert.equal(context.transactionOutcome, 'rolledBack')
      assert.deepEqual(await snapshot(), beforeState)
      assert.equal(registry.cache.size, 0)
    })
  }
})
