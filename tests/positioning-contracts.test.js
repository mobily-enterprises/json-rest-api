import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createPositioningApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { PositioningPlugin } from '../plugins/core/rest-api-positioning-plugin.js'
import { hasKnexTableIndex, introspectKnexTableSnapshot } from '../plugins/core/lib/dbIntrospection.js'
import { databaseClient } from './helpers/test-database.js'

describe(`Positioning configuration and storage boundaries (${storageMode.mode})`, () => {
  let fixture
  const positionFieldOptions = { max: 100, maxLength: 2, storage: { column: 'ordering_key' } }
  const config = { filters: ['category'], excludeResources: ['categories', 'projects', 'items'], autoIndex: false }
  const post = data => fixture.api.resources.tasks.post({ data, format: 'jsonapi' })

  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createPositioningApi,
      apiOptions: { positionFieldOptions, beforeResources: api => api.use(PositioningPlugin, config) },
      tables: { tasks: 'positioning_tasks', categories: 'positioning_categories', projects: 'positioning_projects', items: 'positioning_items' }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('rejects key exhaustion before a mapped physical column can truncate the key', async () => {
    const first = (await post({ title: 'First', category: null })).data
    const target = (await post({ title: 'Target', category: null })).data
    assert.equal(first.attributes.position, 'a0')
    assert.equal(target.attributes.position, 'a1')
    await assert.rejects(post({ title: 'Between', category: null, beforeId: target.id }), error => {
      assert.equal(error.code, 'REST_API_VALIDATION')
      assert.equal(error.transactionOutcome, 'rolledBack')
      assert.match(error.message, /Position key exceeds/)
      return true
    })
    assert.equal(await fixture.count('tasks'), 2)
  })

  it('fails clearly when existing data has an unusable fractional key', async () => {
    const existing = (await post({ title: 'Existing', category: null })).data
    const adapter = fixture.api.knex.helpers.getStorageAdapter('tasks')
    // Simulate an older/imported row whose key bypassed application validation.
    await adapter.buildBaseQuery().where(adapter.getIdColumn(), adapter.translateFilterValue('id', existing.id))
      .update({ [adapter.translateColumn('position')]: '12' })
    await assert.rejects(post({ title: 'After invalid', category: null }), error => {
      assert.equal(error.code, 'REST_API_VALIDATION')
      assert.match(error.message, /Existing positions must be valid fractional keys/)
      return true
    })
    assert.equal(await fixture.count('tasks'), 1)
  })

  it('creates the declared ordinary-table index when registration finds an existing table', async () => {
    const options = {
      positionFieldOptions,
      beforeResources: async api => {
        await api.use(PositioningPlugin, { ...config, autoIndex: true })
        // The primary fixture already created these tables; register against them.
        await api.customize({ methods: { createKnexTable: () => {} } })
      }
    }
    await createPositioningApi(fixture.knex, options)
    const adapter = fixture.api.knex.helpers.getStorageAdapter('tasks')
    const tableName = adapter.getTableName()
    const name = `idx_${tableName}_positioning`
    assert.equal(await hasKnexTableIndex(fixture.knex, tableName, name), fixture.storage === 'knex')
    if (fixture.storage === 'knex') {
      const snapshot = await introspectKnexTableSnapshot(fixture.knex, { tableName })
      assert.deepEqual(snapshot.indexes.find(index => index.name === name)?.columns, ['category_id', 'ordering_key'])
    }
    // Repeated setup must recognize the existing index rather than attempt another CREATE.
    await createPositioningApi(fixture.knex, options)
  })

  it('rejects inert options and exposes only implemented positioning helpers', async () => {
    await assert.rejects(createPositioningApi(fixture.knex, {
      beforeResources: api => api.use(PositioningPlugin, { ...config, rebalanceThreshold: 50 })
    }), /rebalanceThreshold is not supported/)
    await assert.rejects(createPositioningApi(fixture.knex, {
      beforeResources: api => api.use(PositioningPlugin, { ...config, defaultPosition: 'middle' })
    }), /defaultPosition must be/)
    assert.equal(fixture.api.positioning.reorder, undefined)
    assert.equal(fixture.api.positioning.isEnabled('tasks'), true)
    assert.equal(fixture.api.positioning.isEnabled('categories'), false)
    assert.equal(fixture.api.positioning.isEnabled('missing'), false)
    const copy = fixture.api.positioning.getConfig()
    copy.filters.push('not-shared')
    assert.deepEqual(fixture.api.positioning.getConfig().filters, ['category'])
  })
})

describe(`Positioning with exact large IDs (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createPositioningApi,
      apiOptions: {
        beforeResources: api => api.use(PositioningPlugin, {
          filters: ['category'], excludeResources: ['categories', 'projects', 'items'], autoIndex: false
        })
      },
      tables: { tasks: 'positioning_tasks', categories: 'positioning_categories', projects: 'positioning_projects', items: 'positioning_items' }
    })
    // Ordinary fixtures normally use 32-bit generated IDs on these drivers.
    if (fixture.storage === 'knex' && databaseClient === 'pg') {
      await fixture.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? TYPE bigint', ['positioning_tasks', 'id'])
    } else if (fixture.storage === 'knex' && databaseClient === 'mysql2') {
      await fixture.knex.raw('ALTER TABLE ?? MODIFY ?? bigint unsigned NOT NULL AUTO_INCREMENT', ['positioning_tasks', 'id'])
    }
  })
  after(async () => { await fixture?.close() })

  it('positions between adjacent IDs that collapse to the same JavaScript number', async () => {
    const post = data => fixture.api.resources.tasks.post({ data, format: 'jsonapi' })
    const neighbor = await fixture.seed('tasks', { title: 'Neighbor' })
    const target = await fixture.seed('tasks', { title: 'Target' })
    const adapter = fixture.api.knex.helpers.getStorageAdapter('tasks')
    for (const [record, id] of [[neighbor, '9007199254740992'], [target, '9007199254740993']]) {
      // Existing/imported 64-bit identities must not be rounded by positioning reads.
      await adapter.buildBaseQuery().where(adapter.getIdColumn(), adapter.translateFilterValue('id', record.id))
        .update({ [adapter.getIdColumn()]: id })
      record.id = id
    }
    const placed = (await post({ id: '1', title: 'Between', category: null, beforeId: target.id })).data
    assert.equal(neighbor.id, '9007199254740992')
    assert.equal(target.id, '9007199254740993')
    assert.ok(neighbor.attributes.position < placed.attributes.position)
    assert.ok(placed.attributes.position < target.attributes.position)
    const result = await fixture.api.resources.tasks.query({ format: 'jsonapi', queryParams: { sort: ['position'] } })
    assert.deepEqual(result.data.map(record => record.attributes.title), ['Neighbor', 'Between', 'Target'])
  })
})

describe(`Positioning with an omitted large group ID (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      apiOptions: {
        itemOptions: {
          schema: {
            id: { type: 'id' },
            name: { type: 'string', required: true },
            groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true, search: true },
            position: { type: 'string', max: 255 },
            beforeId: { type: 'string', virtual: true }
          },
          sortableFields: ['id', 'position']
        }
      }
    })
    await fixture.api.use(PositioningPlugin, { filters: ['group'], excludeResources: ['groups'], autoIndex: false })
    const groupColumn = fixture.api.knex.helpers.getStorageAdapter('items').translateColumn('groupId')
    if (fixture.storage === 'knex' && databaseClient === 'pg') {
      await fixture.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? TYPE bigint', ['conformance_groups', 'id'])
      await fixture.knex.raw('ALTER TABLE ?? ALTER COLUMN ?? TYPE bigint', ['conformance_items', groupColumn])
    } else if (fixture.storage === 'knex' && databaseClient === 'mysql2') {
      await fixture.knex.raw('ALTER TABLE ?? MODIFY ?? bigint unsigned NOT NULL AUTO_INCREMENT', ['conformance_groups', 'id'])
      await fixture.knex.raw('ALTER TABLE ?? MODIFY ?? bigint unsigned NULL', ['conformance_items', groupColumn])
    }
  })
  after(async () => { await fixture?.close() })

  it('retains the exact stored group while moving a record without resubmitting its group', async () => {
    const group = await fixture.seed('groups', { name: 'Large group' })
    const members = []
    for (const name of ['First', 'Target', 'Moving']) {
      members.push(await fixture.seed('items', { name }, { group: { data: { type: 'groups', id: group.id } } }))
    }
    const groupAdapter = fixture.api.knex.helpers.getStorageAdapter('groups')
    const itemAdapter = fixture.api.knex.helpers.getStorageAdapter('items')
    const largeId = '9007199254740993'
    await groupAdapter.buildBaseQuery().where(groupAdapter.getIdColumn(), group.id)
      .update({ [groupAdapter.getIdColumn()]: largeId })
    await itemAdapter.buildBaseQuery().where(itemAdapter.translateColumn('groupId'), group.id)
      .update({ [itemAdapter.translateColumn('groupId')]: largeId })

    const moved = (await fixture.api.resources.items.patch({
      id: members[2].id, data: { beforeId: members[1].id }, format: 'jsonapi'
    })).data
    assert.ok(members[0].attributes.position < moved.attributes.position)
    assert.ok(moved.attributes.position < members[1].attributes.position)
    assert.equal(moved.relationships.group.data.id, largeId)
    const result = await fixture.api.resources.items.query({ format: 'jsonapi', queryParams: { sort: ['position'] } })
    assert.deepEqual(result.data.map(record => record.attributes.name), ['First', 'Moving', 'Target'])
    assert.equal(new Set(result.data.map(record => record.attributes.position)).size, 3)
  })
})
