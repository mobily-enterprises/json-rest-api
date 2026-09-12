import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createStorageAdapter, createSelectTranslator } from '../plugins/core/lib/storage/storage-adapter.js'
import { createStorageAdapterUtilities } from '../plugins/core/lib/querying/storage-adapter-utils.js'
import { normalizeStorageConfig } from '../plugins/core/lib/storage/storage-mapping.js'
import { translateCanonicalRecordFromStorage } from '../plugins/core/lib/storage/canonical-storage-mapping.js'
import { applyQueryConstraint, queryConstraint } from '../plugins/core/lib/querying/query-constraint.js'

describe(`Storage naming declarations (${storageMode.mode})`, () => {
  for (const [label, naming] of [
    ['constructor', 'constructor'],
    ['toString', 'toString'],
    ['__proto__', '__proto__'],
    ['coercible object', { toString: () => 'snake' }]
  ]) {
    it(`rejects ${label} directly at the storage naming boundary`, () => {
      assert.throws(() => normalizeStorageConfig({ naming }), /Invalid resource storage.naming/)
    })
    it(`rejects ${label} as a naming mode during compilation`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({
            createApi: createSchemaEnrichmentApi,
            tables: { items: 'schema_enrichment_items' },
            apiOptions: { resourceOptions: { storage: { naming } } }
          })
        }, /Invalid resource storage.naming/)
      } finally { await fixture?.close() }
    })
  }
  it('normalizes every supported naming spelling', () => {
    for (const naming of [undefined, 'snake', 'snake_case', 'snakeCase']) {
      assert.deepEqual(normalizeStorageConfig({ naming }), { naming: 'snake_case' })
    }
    for (const naming of ['exact', 'field', 'verbatim']) {
      assert.deepEqual(normalizeStorageConfig({ naming }), { naming: 'exact' })
    }
  })
})

describe(`Direct storage boundaries (${storageMode.mode})`, () => {
  let fixture, adapter, schemaInfo
  const serializationCalls = []
  let callbackCalls = 0
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        resourceOptions: { idProperty: 'record key' },
        searchSchema: {
          byQuantity: { type: 'number', actualField: 'quantity' },
          byCode: { type: 'string', actualField: 'coded' }
        },
        fields: {
          id: { type: 'integer', primary: true, required: true, storage: { column: 'record key' } },
          name: {
            type: 'string',
            storage: { column: 'display" `name' },
            setter: value => { callbackCalls++; return value.trim() },
            getter: value => { callbackCalls++; return value.toUpperCase() }
          },
          quantity: { type: 'number', storage: { column: 'order' } },
          active: { type: 'boolean', storage: { column: 'enabled flag' } },
          ownerId: { type: 'integer', nullable: true, belongsTo: 'items', as: 'owner', storage: { column: 'reference key' } },
          coded: {
            type: 'string',
            nullable: true,
            storage: {
              serialize: (value, details) => {
                serializationCalls.push({ value, ...details })
                return value == null ? null : `stored:${value}`
              }
            }
          },
          transient: { type: 'string', virtual: true },
          label: { type: 'string', computed: true, compute: () => { callbackCalls++; return 'computed' } }
        }
      }
    })
    schemaInfo = fixture.api.resources.items.vars.schemaInfo
    adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo })
  })
  beforeEach(async () => {
    await fixture.reset()
    serializationCalls.length = 0
    callbackCalls = 0
  })
  after(async () => fixture?.close())

  for (const batch of [false, true]) {
    it(`keeps minimal identity and storage attributes when filtering adds a projection (${batch ? 'batch' : 'single'})`, async () => {
      await seedStorageAdapterRecords(fixture.knex, schemaInfo, [{ id: '0', name: 'Stored', quantity: 2 }])
      const record = await fixture.api.helpers.dataGetMinimal({
        scopeName: 'items',
        context: { scopeName: 'items', id: '0', db: fixture.knex, schemaInfo, queryParams: {} },
        ...(batch ? { ids: ['0'] } : {}),
        applyQueryFilters: async ({ query }) => ({
          query: query.clearSelect().select(adapter.translateColumn('name'))
        })
      })
      const resource = batch ? record[0] : record
      assert.equal(resource.id, '0')
      assert.equal(resource.attributes.name, 'Stored')
      assert.equal(resource.attributes.quantity, 2)
      assert.equal(resource.type, 'items')
    })
  }

  it('combines mandatory mapped values with an ID subquery and existing predicates', async () => {
    await seedStorageAdapterRecords(fixture.knex, schemaInfo, [
      { id: '0', name: 'Chosen', quantity: 0, active: false, coded: 'code', ownerId: null },
      { id: '1', name: 'Other', quantity: 0, active: false, coded: 'code', ownerId: null },
      { id: '2', name: 'Chosen', quantity: 2, active: true, coded: 'different', ownerId: null }
    ])
    const idsQuery = adapter.buildBaseQuery().select(adapter.getIdColumn()).where(adapter.getIdColumn(), '0')
    const beforeSubquery = idsQuery.toSQL().toNative()
    const values = { quantity: '0', active: false, coded: 'code', ownerId: null }
    const constraint = { scopeName: 'items', idsQuery, values }
    const context = { [queryConstraint]: constraint }
    const query = adapter.buildBaseQuery().where(adapter.translateColumn('name'), 'Chosen')
    applyQueryConstraint({ query, context, scopeName: 'items', storageAdapter: adapter, tableName: adapter.getTableName() })
    assert.deepEqual((await query).map(row => String(adapter.getFieldValue(row, 'id'))), ['0'])
    assert.equal(query.toSQL().bindings.includes('stored:code'), true)
    assert.deepEqual(idsQuery.toSQL().toNative(), beforeSubquery)
    assert.deepEqual(values, { quantity: '0', active: false, coded: 'code', ownerId: null })
    assert.equal(context[queryConstraint], constraint)
    const count = await query.clone().clearSelect().count({ total: '*' }).first()
    assert.equal(Number(count.total), 1)
    assert.equal(callbackCalls, 0)
  })

  it('leaves builders unchanged for absent constraints and other resource scopes', () => {
    for (const context of [{}, { [queryConstraint]: { scopeName: 'other', values: { coded: 'ignored' } } }]) {
      const query = adapter.buildBaseQuery()
      const before = query.toSQL().toNative()
      applyQueryConstraint({ query, context, scopeName: 'items', storageAdapter: adapter, tableName: adapter.getTableName() })
      assert.deepEqual(query.toSQL().toNative(), before)
    }
    assert.deepEqual(serializationCalls, [])
  })

  it('keeps an empty mandatory ID subquery empty instead of broadening selection', async () => {
    await seedStorageAdapterRecords(fixture.knex, schemaInfo, [{ id: '0', name: 'Stored', quantity: 0 }])
    const idsQuery = adapter.buildBaseQuery().select(adapter.getIdColumn()).whereRaw('1 = 0')
    const query = adapter.buildBaseQuery()
    applyQueryConstraint({ query, context: { [queryConstraint]: { scopeName: 'items', idsQuery } }, scopeName: 'items', storageAdapter: adapter, tableName: adapter.getTableName() })
    assert.deepEqual(await query, [])
  })

  it('quotes mapped columns and aliases while keeping values in bindings', async () => {
    const name = "O'Reilly ? -- value"
    await seedStorageAdapterRecords(fixture.knex, schemaInfo, [{ id: '0', name, quantity: 2, active: false }])
    const alias = 'selected "` row'
    const select = createSelectTranslator(adapter)
    const query = adapter.buildBaseQuery({ tableAlias: alias })
      .select(select('id', alias), select('name', alias), select('quantity', alias))
      .where(`${alias}.${adapter.translateColumn('name')}`, name)
    const sql = query.toSQL()
    assert.ok(sql.bindings.includes(name))
    assert.equal(sql.sql.includes(name), false)
    const rows = await query
    assert.equal(rows.length, 1)
    assert.equal(String(adapter.getFieldValue(rows[0], 'id')), '0')
    assert.equal(adapter.getFieldValue(rows[0], 'name'), name)
    assert.equal(adapter.getFieldValue(rows[0], 'quantity'), 2)
    assert.equal(callbackCalls, 0)
  })

  it('extracts logical and physical row values without running output callbacks', async () => {
    const physical = { [adapter.getIdColumn()]: '0', [adapter.translateColumn('name')]: '', [adapter.translateColumn('quantity')]: 0 }
    assert.equal(String(adapter.getFieldValue(physical, 'id')), '0')
    assert.equal(adapter.getFieldValue(physical, 'name'), '')
    assert.equal(adapter.getFieldValue(physical, 'quantity'), 0)
    assert.equal(adapter.getFieldValue({ name: 'alias', quantity: null }, 'name'), 'alias')
    assert.equal(adapter.getFieldValue({ quantity: null }, 'quantity'), null)
    assert.equal(adapter.getFieldValue({}, 'quantity'), undefined)
    assert.equal(adapter.getFieldValue(null, 'quantity'), undefined)
    assert.equal(callbackCalls, 0)
  })

  it('retains physical selections and explicit result aliases on the same builder', async () => {
    await seedStorageAdapterRecords(fixture.knex, schemaInfo, [{ id: '0', name: 'Stored', quantity: 0 }])
    for (const columns of [[adapter.translateColumn('name')], { 'result "` name': adapter.translateColumn('name') }]) {
      const query = adapter.buildBaseQuery()
      assert.equal(adapter.selectColumns(query, columns), query)
      const [row] = await query
      assert.deepEqual(Object.values(row), ['Stored'])
      if (!Array.isArray(columns)) assert.deepEqual(Object.keys(row), ['result "` name'])
    }
  })

  it('translates scalar, array and null filter values without changing the input', () => {
    for (const [field, input, expected] of [
      ['quantity', ['2', 0, null], [2, 0, null]],
      ['byQuantity', ['2', 0, null], [2, 0, null]],
      ['active', ['false', '1', 0, null], [false, true, false, null]],
      ['ownerId', ['001', 0, null], ['001', '0', null]],
      ['name', ['', 'a', null], ['', 'a', null]]
    ]) {
      const original = structuredClone(input)
      assert.deepEqual(adapter.translateFilterValue(field, input), expected)
      assert.deepEqual(input, original)
      for (let index = 0; index < input.length; index++) assert.equal(adapter.translateFilterValue(field, input[index]), expected[index])
      assert.equal(adapter.translateFilterValue(field, undefined), undefined)
    }
    assert.equal(adapter.translateFilterValue('id', 0), fixture.storage === 'anyapi' ? '0' : 0)
  })

  it('converts stored cursor scalars without invoking write serializers or output callbacks', () => {
    assert.equal(adapter.translateCursorValue('quantity', '2'), 2)
    assert.equal(adapter.translateCursorValue('active', 'false'), false)
    assert.equal(adapter.translateCursorValue('ownerId', '001'), '001')
    assert.equal(adapter.translateCursorValue('coded', 'stored:value'), 'stored:value')
    assert.equal(adapter.translateCursorValue('quantity', null), null)
    assert.equal(callbackCalls, 0)
    assert.deepEqual(serializationCalls, [])
  })

  it('serializes writes and filter aliases with their logical field and physical column', () => {
    const context = { scopeName: 'items', marker: 'write context' }
    const input = { name: 'already transformed', quantity: 0, active: false, coded: '', transient: 'ignore', label: 'ignore' }
    const original = structuredClone(input)
    const row = adapter.toStorageRow(input, { context, operation: 'patch' })
    assert.equal(row[adapter.translateColumn('name')], input.name)
    assert.equal(row[adapter.translateColumn('quantity')], 0)
    assert.equal(row[adapter.translateColumn('active')], false)
    assert.equal(row[adapter.translateColumn('coded')], 'stored:')
    assert.equal(Object.hasOwn(row, adapter.translateColumn('transient')), false)
    assert.equal(Object.hasOwn(row, adapter.translateColumn('label')), false)
    assert.deepEqual(input, original)
    assert.equal(callbackCalls, 0)
    assert.equal(serializationCalls.length, 1)
    assert.equal(serializationCalls[0].context, context)
    assert.equal(serializationCalls[0].operation, 'patch')
    assert.deepEqual(adapter.translateFilterValue('byCode', ['', 'value', null]), ['stored:', 'stored:value', null])
    for (const call of serializationCalls) {
      assert.equal(call.fieldName, 'coded')
      assert.equal(call.columnName, adapter.translateColumn('coded'))
      assert.equal(call.schemaInfo, schemaInfo)
    }
    assert.deepEqual(serializationCalls.slice(1).map(call => call.operation), ['filter', 'filter', 'filter'])
  })

  it('clears mapped relationship values and canonical target type together', () => {
    const row = adapter.toStorageRow({ ownerId: 0 })
    assert.equal(String(row[adapter.translateColumn('ownerId')]), '0')
    const cleared = adapter.toStorageRow({ ownerId: null })
    assert.equal(cleared[adapter.translateColumn('ownerId')], null)
    if (fixture.storage === 'anyapi') {
      const typeColumn = schemaInfo.descriptor.belongsTo.owner.typeColumn
      assert.equal(row[typeColumn], 'items')
      assert.equal(cleared[typeColumn], null)
    }
  })

  it('keeps query builders independent and uses the supplied transaction without completing it', async () => {
    await seedStorageAdapterRecords(fixture.knex, schemaInfo, [{ id: '0', name: 'Before' }, { id: '1', name: 'Other' }])
    const first = adapter.buildBaseQuery().where(adapter.getIdColumn(), '0')
    const second = adapter.buildBaseQuery().where(adapter.getIdColumn(), '1')
    assert.equal(adapter.getFieldValue((await first)[0], 'name'), 'Before')
    assert.equal(adapter.getFieldValue((await second)[0], 'name'), 'Other')
    const transaction = await fixture.knex.transaction()
    try {
      await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '0').update(adapter.toStorageRow({ name: 'Changed' }))
      const row = await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '0').first()
      assert.equal(adapter.getFieldValue(row, 'name'), 'Changed')
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
    assert.equal(adapter.getFieldValue(await adapter.buildBaseQuery().where(adapter.getIdColumn(), '0').first(), 'name'), 'Before')
  })

  it('uses the active hook adapter and keeps scope resolution within each invocation', () => {
    const lookups = []
    const context = { knexQuery: { scopeName: 'items', tableName: 'joined items', storageAdapter: adapter } }
    const getStorageAdapter = scope => { lookups.push(scope); return adapter }
    const utilities = createStorageAdapterUtilities({ context }, { getStorageAdapter })
    assert.equal(utilities.fetchStorageAdapter('items'), adapter)
    assert.equal(utilities.translateColumn('items', 'name'), `joined items.${adapter.translateColumn('name')}`)
    assert.equal(utilities.translateColumn('items', 'name', ''), adapter.translateColumn('name'))
    assert.deepEqual(utilities.translateFilterValue('items', 'byQuantity', ['2', null]), [2, null])
    utilities.fetchStorageAdapter('other')
    utilities.fetchStorageAdapter('other')
    assert.deepEqual(lookups, ['other'])
    createStorageAdapterUtilities({ context }, { getStorageAdapter }).fetchStorageAdapter('other')
    assert.deepEqual(lookups, ['other', 'other'])
  })

  if (storageMode.isAnyApi()) {
    it('retains an attribute named undefined when a relationship has no reverse attribute mapping', () => {
      const result = translateCanonicalRecordFromStorage({ content: 'Visible', owner_id: '42' }, {
        reverseAttributes: { content: 'undefined' },
        belongsTo: { owner: { idColumn: 'owner_id', typeColumn: 'owner_type', target: 'items' } }
      })
      assert.deepEqual(result, {
        attributes: { undefined: 'Visible' },
        relationships: { owner: { data: { type: 'items', id: '42' } } }
      })
    })
    it('constrains reads and writes to both the tenant and resource', async () => {
      for (const [tenant, resource, name] of [
        [schemaInfo.descriptor.tenant, 'items', 'Own'],
        ['another_tenant', 'items', 'Other tenant'],
        [schemaInfo.descriptor.tenant, 'another_resource', 'Other resource']
      ]) {
        await seedStorageAdapterRecords(fixture.knex, { ...schemaInfo, descriptor: { ...schemaInfo.descriptor, tenant, resource } }, [{ id: '0', name }])
      }
      assert.deepEqual((await adapter.buildBaseQuery()).map(row => adapter.getFieldValue(row, 'name')), ['Own'])
      await adapter.buildBaseQuery().where(adapter.getIdColumn(), '0').update(adapter.toStorageRow({ name: 'Changed' }))
      const names = (await fixture.knex(adapter.getTableName())).map(row => adapter.getFieldValue(row, 'name')).sort()
      assert.deepEqual(names, ['Changed', 'Other resource', 'Other tenant'])
      await adapter.buildBaseQuery().delete()
      assert.deepEqual((await fixture.knex(adapter.getTableName())).map(row => adapter.getFieldValue(row, 'name')).sort(), ['Other resource', 'Other tenant'])
    })
  }
})
