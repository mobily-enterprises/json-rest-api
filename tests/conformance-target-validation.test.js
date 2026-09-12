import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, createConformanceApi, createAnyApiFieldEvolutionApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { validateRelationshipAccess } from '../plugins/core/rest-api-plugin-methods/common.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const targets = size => Array.from({ length: size }, (_, index) => ({ type: 'groups', id: String(index + 1) }))
const seed = (fixture, type, records) => seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records)

describe(`Relationship target validation (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables,
      apiOptions: {
        polymorphicTargets: ['groups', 'items'],
        resourcePolicy: ({ query, context, column }) => {
          if (context.hideTargets) query.whereNot(column('name'), 'Hidden')
          return true
        }
      }
    })
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'target-validation-batch-query',
          handler: async ({ context, scopeName }) => {
            const probe = context.validationProbe
            if (!probe || context.knexQuery.queryPurpose !== 'relationship-validation') return
            probe.queries.push({ scopeName, id: context.id, filters: context.knexQuery.filters, transaction: context.transaction, auth: context.auth })
            await Promise.resolve()
            if (probe.queries.length === probe.failQueryAt) throw probe.failure
            context.knexQuery.query = context.knexQuery.query.clone()
          }
        },
        checkPermissions: {
          functionName: 'target-validation-read-permission',
          handler: async ({ context, scopeName }) => {
            const request = context.originalContext
            const probe = request?.validationProbe
            if (!probe || context.method !== 'get' || scopeName !== 'groups') return
            await Promise.resolve()
            probe.permissions.push({ id: request.id, minimal: request.minimalRecord, transaction: request.transaction, auth: request.auth, scopeName: request.scopeName })
            if (request.id === probe.denyId) throw probe.failure
          }
        },
        beforeDataGet: {
          functionName: 'target-validation-does-not-render',
          handler: ({ context, scopeName }) => {
            if (context.validationProbe && scopeName === 'groups') throw new Error('Target validation ran a response GET')
          }
        },
        finishPostRelationship: {
          functionName: 'target-validation-owned-finish',
          handler: ({ context }) => { if (context.validationProbe?.failFinish) throw context.validationProbe.failure }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seed(fixture, 'groups', targets(205).map(({ id }) => ({ id, name: `Group ${id}` })))
    await seed(fixture, 'items', [{ id: '1', name: 'Owner' }])
  })
  after(async () => { await fixture?.close() })

  const context = extra => ({ auth: { user: 'writer' }, queryParams: { filters: { name: 'Parent filter' } }, validationProbe: { queries: [], permissions: [], failure: new RestApiResourceError('Target denied', { subtype: 'forbidden' }) }, ...extra })
  const add = (data, request, transaction) => fixture.api.resources.items.postRelationship({ id: '1', relationshipName: 'groups', relationshipData: data, transaction }, request)
  const linked = async transaction => (await fixture.api.resources.items.getRelationship({ id: '1', relationshipName: 'groups', transaction })).data.map(row => row.id).sort()

  for (const operation of ['postRelationship', 'post', 'put', 'put-create', 'patch']) {
    const method = operation === 'put-create' ? 'put' : operation
    it(`${operation} validates 205 targets in three reads and one permission check per target`, async () => {
      const request = context()
      const ids = targets(205)
      let ownerId = '1'
      if (method === 'postRelationship') await add(ids, request)
      else {
        ownerId = method === 'post' || operation === 'put-create' ? '2' : '1'
        await fixture.api.resources.items[method]({
          ...(method === 'post' ? {} : { id: ownerId }),
          returning: 'none',
          document: { data: { type: 'items', id: ownerId, attributes: { name: 'Written owner' }, relationships: { groups: { data: ids } } } }
        }, request)
      }
      assert.equal(request.validationProbe.queries.length, 3)
      assert.deepEqual(request.validationProbe.permissions.map(row => row.id), ids.map(row => row.id))
      for (const entry of request.validationProbe.queries) {
        assert.equal(entry.scopeName, 'groups')
        assert.equal(entry.id, undefined)
        assert.deepEqual(entry.filters, {})
        assert.equal(entry.auth, request.auth)
        assert.ok(entry.transaction.isCompleted())
      }
      for (const entry of request.validationProbe.permissions) {
        assert.equal(entry.minimal.id, entry.id)
        assert.equal(entry.minimal.attributes.name, `Group ${entry.id}`)
        assert.equal(entry.scopeName, 'groups')
        assert.equal(entry.auth, request.auth)
      }
      const result = await fixture.api.resources.items.getRelationship({ id: ownerId, relationshipName: 'groups' })
      assert.deepEqual(result.data.map(row => row.id).sort(), ids.map(row => row.id).sort())
      if (method === 'postRelationship') assert.deepEqual(request.queryParams.filters, { name: 'Parent filter' })
    })
  }

  it('reads and authorizes a repeated target once per relationship', async () => {
    const request = context()
    await add(Array.from({ length: 205 }, () => ({ type: 'groups', id: '1' })), request)
    assert.equal(request.validationProbe.queries.length, 1)
    assert.deepEqual(request.validationProbe.permissions.map(row => row.id), ['1'])
    assert.deepEqual(await linked(), ['1'])
  })

  it('bounds actual result batches despite duplicate policy join rows', async () => {
    const counts = []
    const capture = (rows, { sql, bindings }) => {
      if (/ in \(select distinct /i.test(sql) && Array.isArray(rows)) counts.push({ count: rows.length, bindings: bindings.length })
    }
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'target-validation-duplicate-join',
          handler: ({ context }) => {
            if (!context.duplicateTargets || context.knexQuery.queryPurpose !== 'relationship-validation') return
            const db = context.db
            const copies = db.select(db.raw('1 as copy')).unionAll([db.select(db.raw('2 as copy'))])
            context.knexQuery.query.crossJoin(copies.as('copies'))
          }
        }
      }
    })
    fixture.knex.on('query-response', capture)
    try { await add(targets(205), context({ duplicateTargets: true })) } finally { fixture.knex.off('query-response', capture) }
    assert.deepEqual(counts.map(row => row.count), [100, 100, 5])
    assert.ok(counts.every(row => row.bindings <= 106))
  })

  it('keeps overlapping IDs separate across resource types and relationship checks', async () => {
    const seen = []
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'target-validation-mixed-types',
          handler: ({ context, scopeName }) => {
            if (context.method === 'get' && context.originalContext?.mixedTargets) seen.push([scopeName, context.originalContext.minimalRecord.attributes.name])
          }
        }
      }
    })
    await fixture.api.resources.items.patch({
      id: '1',
      returning: 'none',
      document: {
        data: {
          type: 'items',
          relationships: {
            group: { data: { type: 'groups', id: '1' } },
            subject: { data: { type: 'items', id: '1' } },
            groups: { data: targets(2) }
          }
        }
      }
    }, { mixedTargets: true })
    assert.deepEqual(seen, [['groups', 'Group 1'], ['items', 'Owner'], ['groups', 'Group 1'], ['groups', 'Group 2']])
  })

  for (const hidden of [false, true]) {
    it(`rejects a later ${hidden ? 'policy-hidden' : 'missing'} target before attaching any links`, async () => {
      if (hidden) {
        const adapter = fixture.api.knex.helpers.getStorageAdapter('groups')
        await adapter.buildBaseQuery().where(adapter.getIdColumn(), '201').update(adapter.toStorageRow({ name: 'Hidden' }))
      }
      const request = context({ hideTargets: hidden })
      const ids = targets(205)
      if (!hidden) ids[200].id = '999'
      await assert.rejects(add(ids, request), { code: 'REST_API_RESOURCE', subtype: 'not_found', details: { resourceType: 'groups', resourceId: hidden ? '201' : '999' } })
      assert.deepEqual(request.validationProbe.permissions.map(row => row.id), ids.slice(0, 200).map(row => row.id))
      assert.deepEqual(await linked(), [])
    })
  }

  for (const borrowed of [false, true]) {
    for (const failureAt of ['permission', 'query', 'finish']) {
      it(`retains ${borrowed ? 'borrowed' : 'owned'} transaction semantics after ${failureAt} failure`, async () => {
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        const request = context()
        Object.assign(request.validationProbe, { denyId: failureAt === 'permission' ? '201' : undefined, failQueryAt: failureAt === 'query' ? 2 : undefined, failFinish: failureAt === 'finish' })
        try {
          await assert.rejects(add(targets(205), request, transaction), error => assertWriteFailure(error, { cause: request.validationProbe.failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
          if (borrowed) {
            assert.equal(transaction.isCompleted(), false)
            assert.deepEqual(await linked(transaction), failureAt === 'finish' ? targets(205).map(row => row.id).sort() : [])
          }
        } finally { await unit?.rollback() }
        assert.deepEqual(await linked(), [])
      })
    }
  }

  it('uses pending target changes and isolates a later call after rollback', async () => {
    const unit = await holdManagedTransaction(fixture.api)
    const transaction = unit.transaction
    const adapter = fixture.api.knex.helpers.getStorageAdapter('groups')
    const request = context({ hideTargets: true })
    try {
      await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '201').update(adapter.toStorageRow({ name: 'Hidden' }))
      await assert.rejects(add(targets(205), request, transaction), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
      assert.ok(request.validationProbe.queries.every(row => row.transaction === transaction))
      assert.equal(transaction.isCompleted(), false)
    } finally { await unit.rollback() }
    await add(targets(205), context({ hideTargets: true }))
    assert.equal((await linked()).length, 205)
  })
})

describe(`Structured target rows (${storageMode.mode})`, () => {
  let fixture
  const payload = { nested: ['value', 1, null] }
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createConformanceApi,
      apiOptions: {
        groupOptions: {
          schema: { id: { type: 'id' }, name: { type: 'string', required: true }, payload: { type: 'object' } }
        }
      }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('validates resources containing native JSON without requiring equality over the JSON column', async () => {
    const group = await fixture.seed('groups', { name: 'JSON target', payload })
    const item = await fixture.seed('items', { name: 'Owner' })
    await fixture.api.resources.items.patch({ id: item.id, returning: 'none', document: { data: { type: 'items', relationships: { group: { data: { type: 'groups', id: group.id } } } } } })
    assert.deepEqual((await fixture.api.resources.groups.get({ id: group.id })).data.attributes.payload, payload)
    assert.equal((await fixture.api.resources.items.get({ id: item.id })).data.relationships.group.data.id, group.id)
  })
})

if (storageMode.isAnyApi()) {
  describe('Canonical validation tenant isolation', () => {
    let fixture, right
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createAnyApiFieldEvolutionApi, apiOptions: { tenantId: 'validation_left' }, tables: { items: 'any_records' } })
      right = await createAnyApiFieldEvolutionApi(fixture.knex, { tenantId: 'validation_right' })
    })
    beforeEach(async () => {
      await fixture.reset()
      await seed(fixture, 'items', [{ id: '1', name: 'Left' }])
      await seedStorageAdapterRecords(fixture.knex, right.resources.items.vars.schemaInfo, [{ id: '1', name: 'Right' }, { id: '2', name: 'Right only' }])
    })
    after(async () => { await fixture?.close() })
    it('uses both tenant scopes for the ID subquery and selected minimal rows', async () => {
      for (const [api, expected] of [[fixture.api, 'Left'], [right, 'Right'], [fixture.api, 'Left']]) {
        const seen = []
        await api.customize({
          hooks: {
            checkPermissions: {
              functionName: 'validation-tenant-record',
              handler: ({ context }) => { if (context.method === 'get') seen.push(context.originalContext.minimalRecord.attributes.name) }
            }
          }
        })
        const input = id => ({ data: { relationships: { target: { data: { type: 'items', id } } } } })
        await validateRelationshipAccess({ db: fixture.knex }, input('1'), api.helpers, api)
        assert.deepEqual(seen, [expected])
        if (api === fixture.api) await assert.rejects(validateRelationshipAccess({ db: fixture.knex }, input('2'), api.helpers, api), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
      }
    })
  })
}

describe('Relationship validation with database ID equality', () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'knex', createApi: createIdConformanceApi, tables, apiOptions: { idType: 'string', idCaseInsensitive: true } })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seed(fixture, 'groups', [{ id: 'alpha', name: 'Target' }])
    await seed(fixture, 'items', [{ id: 'owner', name: 'Owner' }])
  })
  after(async () => { await fixture?.close() })

  it('accepts alternate ID spelling without replacing database comparison with JavaScript equality', async () => {
    await fixture.api.resources.items.postRelationship({ id: 'owner', relationshipName: 'groups', relationshipData: [{ type: 'groups', id: 'ALPHA' }] })
    const row = await fixture.knex('conformance_memberships').first()
    assert.equal(row.group_key, 'ALPHA')
    await assert.rejects(fixture.api.resources.items.postRelationship({ id: 'owner', relationshipName: 'groups', relationshipData: [{ type: 'groups', id: 'absent' }] }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
  })
})
