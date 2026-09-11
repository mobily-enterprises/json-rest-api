import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createStorageAdapterUtilities } from '../plugins/core/lib/querying/storage-adapter-utils.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }

describe(`Replacement query visibility (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables,
      apiOptions: {
        inverseMembership: true,
        includeProjection: true,
        collectionInclude: { strategy: 'window', limit: 1, orderBy: ['id'] },
        resourcePolicy: ({ query, context, column }) => {
          if (context.hideRows) query.whereNot(column('name'), 'like', 'Policy hidden%')
          return true
        }
      }
    })
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'replacement-query-visibility',
          handler: async ({ context, scopeName }) => {
            if (!context.hideRows || scopeName !== 'items') return
            await Promise.resolve()
            const columns = createStorageAdapterUtilities({ context })
            context.knexQuery.query = context.knexQuery.query.clone()
              .whereNot(columns.translateColumn(scopeName, 'name'), 'like', 'Hook hidden%')
            if (context.filterFailure && context.knexQuery.queryPurpose === 'collection') throw context.filterFailure
          }
        }
      }
    })
    if (storageMode.isAnyApi()) {
      const schemaInfo = fixture.api.resources.items.vars.schemaInfo
      for (const descriptor of [
        { ...schemaInfo.descriptor, tenant: 'outside_visibility_tenant' },
        { ...schemaInfo.descriptor, resource: 'outside_visibility_items' }
      ]) {
        await seedStorageAdapterRecords(fixture.knex, { ...schemaInfo, descriptor }, [
          { id: '2', name: 'Visible outside scope', groupId: '1' },
          { id: '4', name: 'Visible outside scope', groupId: '2' }
        ])
      }
    }
  })
  beforeEach(async () => {
    await fixture.reset()
    const first = await fixture.seed('groups', { name: 'First owner' })
    const second = await fixture.seed('groups', { name: 'Second owner' })
    const items = []
    for (const [name, owner] of [
      ['Hook hidden first', first], ['Visible A', first], ['Policy hidden middle', first],
      ['Visible B', first], ['Visible other owner', second], ['Visible C', first]
    ]) {
      items.push(await fixture.seed('items', { name }, { group: { data: { type: 'groups', id: owner.id } } }))
    }
    await fixture.api.resources.groups.postRelationship({
      id: first.id,
      relationshipName: 'members',
      relationshipData: items.filter(row => row.id !== '5').map(({ type, id }) => ({ type, id }))
    })
  })
  after(async () => { await fixture?.close() })

  const read = (kind, params, context) => kind === 'query'
    ? fixture.api.resources.items.query(params, context)
    : fixture.api.resources.groups.getRelated({ id: '1', relationshipName: kind, ...params }, context)
  const ids = result => result.data.map(row => row.id)

  if (storageMode.isAnyApi()) {
    it('excludes overlapping tenant and resource identities after query replacement', async () => {
      const rows = await fixture.knex('any_records').where({ resource: 'outside_visibility_items' })
      const otherTenant = await fixture.knex('any_records').where({ tenant_id: 'outside_visibility_tenant' })
      assert.equal(rows.length, 2)
      assert.equal(otherTenant.length, 2)
      const result = await read('query', { queryParams: { sort: ['id'], page: { number: 1, size: 10 } } }, { hideRows: true })
      assert.deepEqual(ids(result), ['2', '4', '5', '6'])
      assert.equal(result.meta.pagination.total, 4)
      assert.equal(result.data.some(row => row.attributes.name === 'Visible outside scope'), false)
    })
  }

  for (const kind of ['query', 'items', 'members']) {
    for (const format of ['jsonapi', 'plain']) {
      for (const mode of ['offset', 'cursor']) {
        it(`applies the replacement before ${mode} limits and metadata for ${kind} (${format})`, async () => {
          const queryParams = { sort: ['id'], fields: { items: 'name,displayName' }, page: { size: 2, ...(mode === 'offset' ? { number: 1 } : {}) } }
          const context = { hideRows: true }
          const first = await read(kind, { format, queryParams }, context)
          assert.deepEqual(ids(first), ['2', '4'])
          for (const row of first.data) {
            const attributes = format === 'jsonapi' ? row.attributes : row
            assert.equal(attributes.displayName, attributes.name.toUpperCase())
          }
          if (mode === 'offset') assert.equal(first.meta.pagination.total, kind === 'query' ? 4 : 3)
          else assert.equal(first.meta.pagination.hasMore, true)
          const nextPage = mode === 'offset' ? { size: 2, number: 2 } : { size: 2, after: first.meta.pagination.cursor.next }
          const second = await read(kind, { format, queryParams: { ...queryParams, page: nextPage } }, context)
          assert.deepEqual(ids(second), kind === 'query' ? ['5', '6'] : ['6'])
          if (mode === 'offset') assert.equal(second.meta.pagination.total, kind === 'query' ? 4 : 3)
          else {
            assert.equal(second.meta.pagination.hasMore, false)
            const previous = await read(kind, {
              format, queryParams: { ...queryParams, page: { size: 2, before: `id:${second.data[0].id}` } }
            }, context)
            assert.deepEqual(ids(previous), ['2', '4'])
          }
        })
      }
    }
  }

  for (const format of ['jsonapi', 'plain']) {
    it(`uses replacement visibility before per-parent include limits (${format})`, async () => {
      const result = await fixture.api.resources.groups.query({ format, queryParams: { sort: ['id'], include: ['items'] } }, { hideRows: true })
      if (format === 'jsonapi') {
        assert.deepEqual(result.data.map(row => row.relationships.items.data.map(child => child.id)), [['2'], ['5']])
        assert.deepEqual(result.included.map(row => row.id).sort(), ['2', '5'])
      } else assert.deepEqual(result.data.map(row => row.items.map(child => child.id)), [['2'], ['5']])
    })
  }

  it('uses the same replacement restriction for a single record', async () => {
    await assert.rejects(fixture.api.resources.items.get({ id: '1' }, { hideRows: true }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
    assert.equal((await fixture.api.resources.items.get({ id: '2' }, { hideRows: true })).data.id, '2')
  })

  it('does not retain a visibility decision when a caller reuses its context', async () => {
    const context = { hideRows: true }
    const query = () => read('query', { queryParams: { sort: ['id'], page: { number: 1, size: 10 } } }, context)
    assert.deepEqual(ids(await query()), ['2', '4', '5', '6'])
    context.hideRows = false
    assert.deepEqual(ids(await query()), ['1', '2', '3', '4', '5', '6'])
    context.hideRows = true
    assert.deepEqual(ids(await query()), ['2', '4', '5', '6'])
  })

  it('uses uncommitted visibility without completing or caching a borrowed transaction', async () => {
    const transaction = await fixture.knex.transaction()
    const params = { queryParams: { sort: ['id'], page: { number: 1, size: 10 } } }
    try {
      const adapter = fixture.api.knex.helpers.getStorageAdapter('items')
      await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '6').update(adapter.toStorageRow({ name: 'Hook hidden pending' }))
      const result = await read('query', { ...params, transaction }, { hideRows: true })
      assert.deepEqual(ids(result), ['2', '4', '5'])
      assert.equal(result.meta.pagination.total, 3)
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
    assert.deepEqual(ids(await read('query', params, { hideRows: true })), ['2', '4', '5', '6'])
  })

  it('restores enclosing query metadata after a replacement filter fails or succeeds', async () => {
    const transaction = await fixture.knex.transaction()
    const previous = { enclosingQuery: true }
    const failure = new RestApiValidationError('Replacement filter failed')
    const context = { hideRows: true, filterFailure: failure, knexQuery: previous }
    try {
      await assert.rejects(read('query', { transaction }, context), error => error === failure)
      assert.equal(context.knexQuery, previous)
      assert.equal(transaction.isCompleted(), false)
      delete context.filterFailure
      assert.deepEqual(ids(await read('query', { transaction, queryParams: { sort: ['id'] } }, context)), ['2', '4', '5', '6'])
      assert.equal(context.knexQuery, previous)
    } finally { await transaction.rollback() }
  })
})
