import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createAnyApiFieldEvolutionApi } from './fixtures/api-configs.js'
import { applyDatabaseReadOptions } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'

function evolutionCase (name, run, options = {}) {
  describe(`AnyAPI field evolution (${databaseClient}, canonical storage): ${name}`, () => {
    let database, fixture
    before(async () => {
      database = await createTestDatabase()
      const db = database.knex
      const api = await createAnyApiFieldEvolutionApi(db, options)
      const registry = api.anyapi.registry
      fixture = {
        api,
        db,
        registry,
        items: api.resources.items,
        descriptor: options => registry.getDescriptor('field_evolution', 'items', options),
        async snapshot () {
          const data = {}
          for (const table of ['any_records', 'any_links', 'any_field_configs', 'any_relationship_configs', 'any_resource_configs']) {
            data[table] = await applyDatabaseReadOptions(db(table).orderBy('id'))
          }
          return data
        }
      }
    })
    beforeEach(async () => cleanTables(fixture.db, ['any_links', 'any_records'], { storage: 'knex' }))
    after(async () => {
      try { await database?.close() } finally { if (database) storageMode.clearRegistry(database.knex) }
    })
    it(name, async () => run(fixture))
  })
}

for (const format of ['jsonapi', 'plain']) {
  evolutionCase(`adds defaults, transforms and filters after request contracts are cached (${format})`, async ({ items, descriptor, db }) => {
    await items.post({ format: 'plain', data: { id: '1', name: 'Before' } })
    await items.query()
    let defaults = 0
    await items.addKnexFields({
      fields: {
        note: { type: 'string', nullable: true, search: true, setter: async value => value?.trim(), getter: async value => value?.toUpperCase() ?? null },
        score: { type: 'integer', defaultTo: 0 },
        label: { type: 'string', defaultTo: () => { defaults++; return 'Generated' } }
      },
      searchSchema: { noteContains: { type: 'string', actualField: 'note', filterOperator: 'contains' } }
    })
    assert.equal(defaults, 0, 'Schema changes must not execute runtime defaults')
    const existing = await items.get({ id: '1', format: 'plain' })
    assert.equal(existing.name, 'Before')
    assert.equal(existing.note, null)
    assert.equal(existing.score, null)
    assert.equal(existing.label, null)
    const inputRecord = format === 'plain' ? { name: 'After', note: ' stored ' } : createJsonApiDocument('items', { name: 'After', note: ' stored ' })
    const result = await items.post({ format, [format === 'plain' ? 'data' : 'document']: inputRecord })
    const attributes = format === 'plain' ? result : result.data.attributes
    assert.equal(attributes.note, 'STORED')
    assert.equal(attributes.score, 0)
    assert.equal(attributes.label, 'Generated')
    assert.equal(defaults, 1)
    for (const filters of [{ note: 'stored' }, { noteContains: 'tor' }]) {
      const query = await items.query({ format, queryParams: { filters } })
      assert.deepEqual(query.data.map(row => row.id), [format === 'plain' ? result.id : result.data.id])
    }
    const current = await descriptor({ bypassCache: true })
    assert.equal(current.schema.note.type, 'string')
    assert.equal(current.schema.score.defaultTo, 0)
    const stored = await db('any_records').where({ resource: 'items', logical_id: format === 'plain' ? result.id : result.data.id }).first()
    assert.equal(stored[current.fields.note.slot], 'stored')
  })
}

evolutionCase('retains added fields through repeated creation and a fresh API declaration', async ({ api, db, items, descriptor, snapshot }) => {
  let defaultCalls = 0
  const fields = {
    note: { type: 'string', nullable: true, search: true },
    groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true },
    label: { type: 'string', defaultTo: () => { defaultCalls++; return 'Restarted' } }
  }
  await items.addKnexFields({ fields, canonicalFieldsMap: { note: 'string_4', groupId: 'rel_2_id' } })
  const group = await api.resources.groups.post({ format: 'plain', data: { id: '1', name: 'Group' } })
  await items.post({ format: 'plain', data: { id: '1', name: 'Stored', note: 'Kept', group: group.id } })
  const before = await snapshot()
  await items.createKnexTable()
  assert.deepEqual(await snapshot(), before)
  const canonicalFieldsMap = (await descriptor({ bypassCache: true })).canonicalFieldMap
  const restarted = await createAnyApiFieldEvolutionApi(db, { fields, canonicalFieldsMap })
  const result = await restarted.resources.items.get({ id: '1', format: 'plain', queryParams: { include: ['group'] } })
  assert.equal(result.note, 'Kept')
  assert.equal(result.label, 'Restarted')
  assert.equal(result.group.name, 'Group')
  assert.equal(restarted.resources.items.vars.schemaInfo.descriptor.fields.note.slot, 'string_4')
  const created = await restarted.resources.items.post({ format: 'plain', data: { name: 'New after restart' } })
  assert.equal(created.label, 'Restarted')
  assert.equal(defaultCalls, 2)
})

evolutionCase('honors explicit slots during registration before createKnexTable is called', async ({ items }) => {
  assert.equal(items.vars.schemaInfo.descriptor.fields.name.slot, 'string_7')
}, { canonicalFieldsMap: { name: 'string_7' }, createTable: false })

evolutionCase('rolls back a partially allocated batch and permits retry without leaked schema', async ({ items, descriptor, snapshot }) => {
  const before = await snapshot()
  const schemaInfo = items.vars.schemaInfo
  const cached = await descriptor()
  await assert.rejects(items.addKnexFields({
    fields: { note: { type: 'string' }, other: { type: 'string' } },
    canonicalFieldsMap: { note: 'string_2', other: 'string_1' }
  }), /already in use/)
  assert.deepEqual(await snapshot(), before)
  assert.equal(items.vars.schemaInfo, schemaInfo)
  assert.deepEqual(await descriptor(), cached)
  await items.addKnexFields({ fields: { note: { type: 'string' }, other: { type: 'string' } } })
  const current = await descriptor({ bypassCache: true })
  assert.equal(current.fields.note.slot, 'string_2')
  assert.equal(current.fields.other.slot, 'string_3')
})

evolutionCase('rejects unknown map entries and existing fields before altering metadata', async ({ items, snapshot }) => {
  const before = await snapshot()
  for (const params of [
    { fields: { note: { type: 'string' } }, canonicalFieldsMap: { missing: 'string_3' } },
    { fields: { name: { type: 'number' } } },
    { fields: { id: { type: 'string' } } }
  ]) {
    await assert.rejects(items.addKnexFields(params), /unknown fields|already exists/)
    assert.deepEqual(await snapshot(), before)
  }
})

evolutionCase('validates setter dependencies before committing metadata', async ({ items, snapshot }) => {
  const before = await snapshot()
  await assert.rejects(items.addKnexFields({
    fields: {
      note: { type: 'string', setter: value => value, runSetterAfter: ['missing'] }
    }
  }), /setter dependency/)
  assert.deepEqual(await snapshot(), before)
})

evolutionCase('persists direct field allocations and isolates managed transaction descriptors', async ({ registry, descriptor, snapshot, api }) => {
  const cached = await descriptor()
  const before = await snapshot()
  const definition = { type: 'string', nullable: true, defaultTo: 'Saved' }
  await assert.rejects(api.transaction(async transaction => {
    await registry.allocateField({ tenant: 'field_evolution', resource: 'items', fieldName: 'note', definition }, { transaction })
    const local = await descriptor({ transaction })
    assert.deepEqual(local.schema.note, definition)
    assert.equal(local.fields.note.slot, 'string_2')
    assert.deepEqual(await descriptor(), cached)
    throw new Error('caller rollback')
  }), /caller rollback/)
  assert.deepEqual(await snapshot(), before)
  assert.deepEqual(await descriptor(), cached)
  await registry.allocateField({ tenant: 'field_evolution', resource: 'items', fieldName: 'note', definition })
  registry.invalidateDescriptor('field_evolution', 'items')
  assert.deepEqual((await descriptor()).schema.note, definition)
})

evolutionCase('rejects out-of-range canonical slots without changing persisted schema', async ({ registry, snapshot }) => {
  const before = await snapshot()
  for (const canonicalField of ['string_0', 'string_11', 'string_01', 'rel_0_id', 'rel_6_id', 'rel_01_id']) {
    const definition = canonicalField.startsWith('rel') ? { type: 'id', belongsTo: 'groups', as: 'group' } : { type: 'string' }
    await assert.rejects(registry.allocateField({ tenant: 'field_evolution', resource: 'items', fieldName: 'extra', definition, canonicalField }), /slot.*range|Invalid canonical|Invalid belongsTo/i)
    assert.deepEqual(await snapshot(), before)
  }
  await assert.rejects(registry.allocateField({
    tenant: 'field_evolution',
    resource: 'items',
    fieldName: 'groupId',
    definition: { type: 'id', belongsTo: 'groups', as: 'group' },
    canonicalField: { idSlot: 'rel_1_id', typeSlot: 'rel_01_type' }
  }), /must correspond/)
  assert.deepEqual(await snapshot(), before)
})

for (const format of ['jsonapi', 'plain']) {
  evolutionCase(`uses one published slot mapping until explicit refresh (${format})`, async ({ items, descriptor, registry, db }) => {
    await items.post({ format: 'plain', data: { id: '1', name: 'Original' } })
    const published = items.vars.schemaInfo
    const originalAdapter = items.vars.storageAdapter
    const config = await db('any_resource_configs').where({ tenant_id: 'field_evolution', resource: 'items' }).first()
    await db('any_field_configs').where({ resource_config_id: config.id, field_name: 'name' }).update({ slot_column: 'string_4', slot_index: 4 })
    await db('any_records').where({ tenant_id: 'field_evolution', resource: 'items' }).update({ string_4: 'Migrated' })
    registry.invalidateDescriptor('field_evolution', 'items')
    assert.equal((await descriptor()).fields.name.slot, 'string_4')

    const readName = async () => {
      const result = await items.get({ id: '1', format })
      return format === 'plain' ? result.name : result.data.attributes.name
    }
    assert.equal(await readName(), 'Original')
    assert.equal(items.vars.schemaInfo, published)
    await items.patch({ id: '1', format: 'plain', data: { name: 'Published' } })
    let row = await db('any_records').where({ tenant_id: 'field_evolution', resource: 'items', logical_id: '1' }).first()
    assert.equal(row.string_1, 'Published')
    assert.equal(row.string_4, 'Migrated')
    assert.equal(await readName(), 'Published')

    await items.createKnexTable()
    assert.notEqual(items.vars.schemaInfo, published)
    assert.notEqual(items.vars.storageAdapter, originalAdapter)
    assert.equal(published.descriptor.fields.name.slot, 'string_1')
    assert.equal(await readName(), 'Migrated')
    await items.patch({ id: '1', format: 'plain', data: { name: 'Destination' } })
    row = await db('any_records').where({ tenant_id: 'field_evolution', resource: 'items', logical_id: '1' }).first()
    assert.equal(row.string_1, 'Published')
    assert.equal(row.string_4, 'Destination')
    const result = await items.query({ format, queryParams: { filters: { name: 'Destination' } } })
    assert.deepEqual(result.data.map(record => record.id), ['1'])
  }, { fields: { name: { type: 'string', required: true, search: true } } })
}

evolutionCase('keeps managed registry changes separate from published resource metadata', async ({ items, descriptor, registry, api, snapshot }) => {
  await items.post({ format: 'plain', data: { id: '1', name: 'Original' } })
  const published = items.vars.schemaInfo
  const before = await snapshot()
  await assert.rejects(api.transaction(async transaction => {
    await registry.allocateField({ tenant: 'field_evolution', resource: 'items', fieldName: 'note', definition: { type: 'string', nullable: true } }, { transaction })
    assert.equal((await descriptor({ transaction })).fields.note.slot, 'string_2')
    assert.equal(items.vars.schemaInfo, published)
    const result = await items.get({ id: '1', format: 'plain', transaction })
    assert.equal(result.name, 'Original')
    assert.equal(Object.hasOwn(result, 'note'), false)
    assert.equal(transaction.isCompleted(), false)
    throw new Error('Roll back unpublished metadata')
  }), /Roll back unpublished metadata/)
  assert.deepEqual(await snapshot(), before)
  assert.equal(items.vars.schemaInfo, published)
})

describe(`Published descriptors across tenant APIs (${databaseClient})`, () => {
  let database, first, second
  before(async () => {
    database = await createTestDatabase()
    const fields = { groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true } }
    first = await createAnyApiFieldEvolutionApi(database.knex, {
      tenantId: 'first', fields, canonicalFieldsMap: { name: 'string_1', groupId: 'rel_1_id' }
    })
    second = await createAnyApiFieldEvolutionApi(database.knex, {
      tenantId: 'second', fields, canonicalFieldsMap: { name: 'string_3', groupId: 'rel_2_id' }
    })
  })
  beforeEach(async () => {
    await cleanTables(database.knex, ['any_links', 'any_records'], { storage: 'knex' })
    for (const [api, name] of [[first, 'First'], [second, 'Second']]) {
      await api.resources.groups.post({ format: 'plain', data: { id: '1', name: `${name} group` } })
      await api.resources.items.post({ format: 'plain', data: { id: '1', name, group: '1' } })
      for (const resource of ['items', 'groups']) api.anyapi.registry.invalidateDescriptor(api.anyapi.tenantId, resource)
    }
  })
  after(async () => {
    try { await database?.close() } finally { if (database) storageMode.clearRegistry(database.knex) }
  })
  for (const format of ['jsonapi', 'plain']) {
    it(`isolates overlapping resource IDs and different slot mappings (${format})`, async () => {
      let metadataStatements = 0
      const count = ({ sql }) => { if (/any_(resource|field|relationship)_configs/.test(sql)) metadataStatements++ }
      database.knex.on('query', count)
      try {
        await assert.rejects(first.transaction(async transaction => {
          for (const [api, name] of [[first, 'First'], [second, 'Second']]) {
            const result = await api.resources.items.query({ format, transaction, queryParams: { include: ['group'] } })
            assert.equal(result.data.length, 1)
            assert.equal(format === 'plain' ? result.data[0].name : result.data[0].attributes.name, name)
            assert.equal(format === 'plain' ? result.data[0].group.name : result.included[0].attributes.name, `${name} group`)
          }
          await first.resources.items.patch({ id: '1', format: 'plain', transaction, data: { name: 'Changed first' } })
          assert.equal((await first.resources.items.get({ id: '1', format: 'plain', transaction })).name, 'Changed first')
          assert.equal((await second.resources.items.get({ id: '1', format: 'plain', transaction })).name, 'Second')
          assert.equal(transaction.isCompleted(), false)
          assert.equal(metadataStatements, 0)
          throw new Error('Roll back tenant writes')
        }), /Roll back tenant writes/)
      } finally {
        database.knex.off('query', count)
      }
      assert.equal((await first.resources.items.get({ id: '1', format: 'plain' })).name, 'First')
    })
  }
})

evolutionCase('rejects storage slots for computed and virtual fields', async ({ items, snapshot }) => {
  const before = await snapshot()
  for (const definition of [{ type: 'string', computed: true, compute: () => 'Value' }, { type: 'string', virtual: true }]) {
    await assert.rejects(items.addKnexFields({ fields: { extra: definition }, canonicalFieldsMap: { extra: 'string_2' } }), /non-stored field/)
    assert.deepEqual(await snapshot(), before)
  }
})

evolutionCase('retains added computed and virtual definitions without allocating storage', async ({ items, descriptor }) => {
  await items.addKnexFields({
    fields: {
      computedValue: { type: 'string', computed: true, compute: () => 'Computed' },
      transient: { type: 'string', virtual: true }
    }
  })
  const current = await descriptor({ bypassCache: true })
  assert.equal(current.schema.computedValue.computed, true)
  assert.equal(current.schema.transient.virtual, true)
  assert.equal(current.fields.computedValue, undefined)
  assert.equal(current.fields.transient, undefined)
  const created = await items.post({ format: 'plain', data: { name: 'Stored', transient: 'temporary' } })
  assert.equal(created.computedValue, 'Computed')
})

evolutionCase('keeps a newly added storage serializer through creation and filtering', async ({ items, descriptor, db }) => {
  const calls = []
  const serialize = (value, details) => {
    calls.push(details.operation)
    return value == null ? null : `stored:${value}`
  }
  await items.addKnexFields({ fields: { coded: { type: 'string', search: true, storage: { serialize }, getter: value => value?.replace(/^stored:/, '') } } })
  assert.deepEqual(calls, [])
  const created = await items.post({ format: 'plain', data: { name: 'Value', coded: 'secret' } })
  assert.equal(created.coded, 'secret')
  const current = await descriptor({ bypassCache: true })
  assert.equal((await db('any_records').where({ resource: 'items', logical_id: created.id }).first())[current.fields.coded.slot], 'stored:secret')
  const found = await items.query({ queryParams: { filters: { coded: 'secret' } } })
  assert.deepEqual(found.data.map(row => row.id), [created.id])
  assert.deepEqual(calls, ['post', 'filter'])
})

evolutionCase('keeps managed re-registration out of the global descriptor cache until the caller reloads', async ({ registry, descriptor, snapshot, api }) => {
  const cached = await descriptor()
  const before = await snapshot()
  const definition = { tenant: 'field_evolution', resource: 'items', schema: { ...cached.schema, extra: { type: 'string' } } }
  await assert.rejects(api.transaction(async transaction => {
    await registry.registerResource(definition, { transaction })
    assert.equal((await descriptor({ transaction })).schema.extra.type, 'string')
    assert.deepEqual(await descriptor(), cached)
    throw new Error('caller rollback')
  }), /caller rollback/)
  assert.deepEqual(await snapshot(), before)
  await api.transaction(transaction => registry.registerResource(definition, { transaction }))
  registry.invalidateDescriptor('field_evolution', 'items')
  assert.equal((await descriptor()).schema.extra.type, 'string')
})
