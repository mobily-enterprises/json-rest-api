import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { createJsonApiDocument, createRelationship, resourceIdentifier } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createAnyApiFieldEvolutionApi } from './fixtures/api-configs.js'
import { AnyapiRegistry } from '../plugins/core/lib/anyapi/anyapi-registry.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'
import { listKnexTableIndexes } from '../plugins/core/lib/dbIntrospection.js'

const tenant = 'field_evolution'
const native = databaseClient !== 'better-sqlite3'
const DEFAULT_INDEXED = [
  ...[1, 2, 3, 4, 5].map(index => `indexed_string_${index}`),
  ...[1, 2, 3].map(index => `indexed_number_${index}`),
  ...[1, 2].map(index => `indexed_date_${index}`)
]
const RELATIONSHIP_SLOTS = [1, 2, 3, 4, 5].map(index => `rel_${index}_id`)

// Each case owns a database, because the cases change the table layout.
function layoutCase (name, run, databaseOptions) {
  describe(`AnyAPI indexed slots (${databaseClient}): ${name}`, () => {
    let database
    before(async () => { database = await createTestDatabase(undefined, databaseOptions) })
    after(async () => {
      try { await database?.close() } finally { if (database) storageMode.clearRegistry(database.knex) }
    })
    it(name, async () => run(database.knex))
  })
}

const server = (knex, options = {}) => createAnyApiFieldEvolutionApi(knex, options)
const slotsOf = async (knex, resource = 'items') => {
  const config = await knex('any_resource_configs').where({ tenant_id: tenant, resource }).first()
  return Object.fromEntries((await knex('any_field_configs').where({ resource_config_id: config.id })).map(row => [row.field_name, row.slot_column]))
}
const post = (api, attributes, relationships) => api.resources.items.post({ document: createJsonApiDocument('items', attributes, relationships) })
const recordIndexNames = async knex => [...(await listKnexTableIndexes(knex, 'any_records')).keys()].filter(name => /^any_records_(indexed_|rel_)/.test(name))

const capture = async (knex, run) => {
  const statements = []
  const listener = ({ sql, bindings }) => statements.push({ sql, bindings })
  knex.on('query', listener)
  try { await run() } finally { knex.off('query', listener) }
  return statements
}

// The plan for one captured statement, as text naming the indexes it uses.
const explain = async (knex, { sql, bindings }) => {
  const query = sql.replace(/\$\d+/g, '?')
  if (databaseClient === 'pg') {
    return knex.transaction(async (trx) => {
      // A small table favours a sequential scan; the question is whether the index applies.
      await trx.raw('set local enable_seqscan = off')
      return (await trx.raw(`explain ${query}`, bindings)).rows.map(row => row['QUERY PLAN']).join('\n')
    })
  }
  if (databaseClient === 'mysql2') {
    const [rows] = await knex.raw(`explain ${query}`, bindings)
    return rows.map(row => `${row.table}: ${row.key}`).join('\n')
  }
  return (await knex.raw(`explain query plan ${query}`, bindings)).map(row => row.detail).join('\n')
}

// The layout every release before indexed slots created.
const stripIndexedLayout = async (knex) => {
  const names = await recordIndexNames(knex)
  await knex.schema.alterTable('any_records', table => names.forEach(name => table.dropIndex([], name)))
  await knex.schema.alterTable('any_links', (table) => {
    table.dropIndex([], 'any_links_tenant_left_id_idx')
    table.dropIndex([], 'any_links_tenant_right_id_idx')
  })
  const columns = Object.keys(await knex('any_records').columnInfo()).filter(column => column.startsWith('indexed_'))
  await knex.schema.alterTable('any_records', table => table.dropColumns(...columns))
}

layoutCase('new tables carry indexed slots and tenant-scoped indexes', async (knex) => {
  await ensureAnyApiSchema(knex)
  const columns = await knex('any_records').columnInfo()
  assert.deepEqual(Object.keys(columns).filter(column => column.startsWith('indexed_')).sort(), [...DEFAULT_INDEXED].sort())
  assert.equal(Number(columns.indexed_string_1.maxLength), 255)
  assert.deepEqual((await recordIndexNames(knex)).sort(), [...DEFAULT_INDEXED, ...RELATIONSHIP_SLOTS].map(column => `any_records_${column}_idx`).sort())
  const links = await listKnexTableIndexes(knex, 'any_links')
  assert.ok(links.has('any_links_tenant_left_id_idx') && links.has('any_links_tenant_right_id_idx'))

  await ensureAnyApiSchema(knex, { indexedSlots: { string: 6, boolean: 1 } })
  const indexes = await recordIndexNames(knex)
  for (const column of ['indexed_string_6', 'indexed_boolean_1']) assert.ok(indexes.includes(`any_records_${column}_idx`), column)
  await assert.rejects(ensureAnyApiSchema(knex, { indexedSlots: { json: 1 } }), /Unknown AnyAPI indexed slot pool 'json'/)
})

layoutCase('indexed fields take indexed slots and keep them', async (knex) => {
  const fields = {
    code: { type: 'string', nullable: true, indexed: true, search: true },
    rank: { type: 'integer', nullable: true, indexed: true },
    seenAt: { type: 'dateTime', nullable: true, indexed: true },
    note: { type: 'string', nullable: true },
    groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true }
  }
  const api = await server(knex, { fields })
  const slots = await slotsOf(knex)
  assert.deepEqual(slots, {
    name: 'string_1', code: 'indexed_string_1', rank: 'indexed_number_1', seenAt: 'indexed_date_1', note: 'string_2', groupId: 'rel_1_id'
  })
  const { fields: stored } = api.resources.items.vars.schemaInfo.descriptor
  assert.deepEqual(Object.fromEntries(Object.entries(stored).map(([name, field]) => [name, field.indexed])), {
    name: false, code: true, rank: true, seenAt: true, note: false, groupId: true
  })
  const seenAt = '2024-02-29T23:59:59.987Z'
  const first = await post(api, { name: 'First', code: 'a', rank: 3, seenAt, note: 'n' })
  assert.equal(Date.parse(first.data.attributes.seenAt), Date.parse(seenAt))

  // Changing `indexed` moves nothing: data only moves through migrateField.
  const warnings = []
  const changed = await server(knex, {
    fields: { ...fields, code: { type: 'string', nullable: true, search: true }, note: { type: 'string', nullable: true, indexed: true } },
    logger: { warn: (...args) => warnings.push(args) }
  })
  assert.deepEqual(await slotsOf(knex), slots)
  const warning = warnings.find(([message]) => /declares indexed fields stored in unindexed slots/.test(String(message)))
  assert.ok(warning, JSON.stringify(warnings))
  assert.match(JSON.stringify(warning), /note/)
  assert.doesNotMatch(JSON.stringify(warning), /code/)
  const found = await changed.resources.items.query({ queryParams: { filters: { code: 'a' } } })
  assert.deepEqual(found.data.map(record => record.attributes.rank), [3])
  assert.equal(Date.parse(found.data[0].attributes.seenAt), Date.parse(seenAt))
})

layoutCase('indexed pools refuse what they cannot hold', async (knex) => {
  await ensureAnyApiSchema(knex)
  const registry = new AnyapiRegistry({ knex })
  const register = schema => registry.registerResource({ tenant, resource: 'items', schema: { id: { type: 'id' }, ...schema } })
  const strings = count => Object.fromEntries(Array.from({ length: count }, (_, index) => [`code${index}`, { type: 'string', indexed: true }]))

  await assert.rejects(register(strings(6)), /No available indexed string slots remaining; add them with ensureAnyApiSchema/)
  await assert.rejects(register({ done: { type: 'boolean', indexed: true } }), /No available indexed boolean slots remaining/)
  await assert.rejects(register({ tags: { type: 'array', indexed: true } }), /json slots cannot be indexed/)
  await assert.rejects(register({ code: { type: 'string', indexed: true, max: 300 } }), /allows 300 characters, but indexed string slots hold at most 255/)
  await assert.rejects(register({ code: { type: 'string', max: 300 } }).then(() => registry.registerResource({
    tenant, resource: 'items', schema: { id: { type: 'id' }, code: { type: 'string', max: 300 } }, canonicalFieldMap: { code: 'indexed_string_2' }
  })), /allows 300 characters/)
  assert.deepEqual(await slotsOf(knex), { code: 'string_1' })

  // An exhausted pool rereads the layout, so a migration that adds slots needs no restart.
  await ensureAnyApiSchema(knex, { indexedSlots: { string: 6, boolean: 1 } })
  const descriptor = await registry.registerResource({
    tenant, resource: 'others', schema: { id: { type: 'id' }, ...strings(6), done: { type: 'boolean', indexed: true } }
  })
  assert.equal(descriptor.fields.code5.slot, 'indexed_string_6')
  assert.equal(descriptor.fields.done.slot, 'indexed_boolean_1')
})

layoutCase('indexed strings hold 255 characters on every database', async (knex) => {
  const api = await server(knex, { fields: { code: { type: 'string', nullable: true, indexed: true } } })
  // Each emoji is one character to the database and two UTF-16 units to JavaScript.
  const widest = '😀'.repeat(255)
  const created = await post(api, { name: 'Wide', code: widest })
  assert.equal((await api.resources.items.get({ id: created.data.id })).data.attributes.code, widest)

  const rejected = error => error?.type === 'rest_api_validation' && error.details.violations[0]?.rule === 'storage_range'
  await assert.rejects(post(api, { name: 'Long', code: 'a'.repeat(256) }), rejected)
  await assert.rejects(api.resources.items.patch({
    id: created.data.id, document: { data: { type: 'items', id: created.data.id, attributes: { code: '😀'.repeat(256) } } }
  }), rejected)
  assert.equal((await api.resources.items.get({ id: created.data.id })).data.attributes.code, widest)
})

layoutCase('filters on indexed fields and parent ids use their indexes', async (knex) => {
  const api = await server(knex, {
    fields: {
      code: { type: 'string', nullable: true, indexed: true, search: true },
      groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true, search: true }
    }
  })
  const group = await api.resources.groups.post({ document: createJsonApiDocument('groups', { name: 'Group' }) })
  for (let index = 0; index < 120; index++) {
    await post(api, { name: `Item ${index}`, code: `code-${index}` }, index % 10 ? {} : { group: createRelationship(resourceIdentifier('groups', group.data.id)) })
  }
  // Planners judge a filter's selectivity from statistics, as on any live database.
  await knex.raw(databaseClient === 'mysql2' ? 'analyze table any_records' : 'analyze any_records')

  for (const [column, filters, expected] of [
    ['indexed_string_1', { code: 'code-7' }, 1],
    ['rel_1_id', { groupId: group.data.id }, 12]
  ]) {
    let result
    const statements = await capture(knex, async () => { result = await api.resources.items.query({ queryParams: { filters, page: { size: 50 } } }) })
    assert.equal(result.data.length, expected)
    const statement = statements.find(({ sql }) => /any_records/.test(sql) && sql.includes(column))
    assert.ok(statement, `No statement filters ${column}`)
    assert.match(await explain(knex, statement), new RegExp(`any_records_${column}_idx`))
  }
})

layoutCase('existing tables gain indexed slots and indexes without losing data', async (knex) => {
  const api = await server(knex, { fields: { note: { type: 'string', nullable: true } } })
  const created = await post(api, { name: 'Kept', note: 'old' })
  await post(api, { name: 'Also kept', note: 'older' })
  await stripIndexedLayout(knex)
  assert.deepEqual(await recordIndexNames(knex), [])

  // Servers that start together all succeed.
  const upgrade = () => ensureAnyApiSchema(knex)
  if (native) await Promise.all([upgrade(), upgrade()])
  else await upgrade()
  const columns = Object.keys(await knex('any_records').columnInfo())
  assert.deepEqual(columns.filter(column => column.startsWith('indexed_')).sort(), [...DEFAULT_INDEXED].sort())
  const indexes = await listKnexTableIndexes(knex, 'any_records')
  for (const column of [...DEFAULT_INDEXED, ...RELATIONSHIP_SLOTS]) assert.equal(indexes.get(`any_records_${column}_idx`)?.valid, true, column)
  assert.ok((await listKnexTableIndexes(knex, 'any_links')).has('any_links_tenant_left_id_idx'))

  if (databaseClient === 'pg') {
    // A failed concurrent build leaves an invalid index; the next start rebuilds it.
    await knex.raw('drop index any_records_indexed_string_1_idx')
    await assert.rejects(knex.raw('create unique index concurrently any_records_indexed_string_1_idx on any_records (tenant_id)'))
    assert.equal((await listKnexTableIndexes(knex, 'any_records')).get('any_records_indexed_string_1_idx')?.valid, false)
    await ensureAnyApiSchema(knex)
    assert.equal((await listKnexTableIndexes(knex, 'any_records')).get('any_records_indexed_string_1_idx')?.valid, true)
    const { rows: [rebuilt] } = await knex.raw(`select indisunique as "unique", pg_get_indexdef(indexrelid) as definition
      from pg_index where indexrelid = 'any_records_indexed_string_1_idx'::regclass`)
    assert.equal(rebuilt.unique, false)
    assert.match(rebuilt.definition, /\(tenant_id, resource, indexed_string_1\)/)
  }

  const restarted = await server(knex, { fields: { note: { type: 'string', nullable: true }, code: { type: 'string', nullable: true, indexed: true } } })
  assert.equal((await restarted.resources.items.get({ id: created.data.id })).data.attributes.note, 'old')
  assert.equal((await slotsOf(knex)).code, 'indexed_string_1')
}, { maxConnections: 4 })

layoutCase('migrateField copies a field into an indexed slot', async (knex) => {
  const api = await server(knex, { fields: { note: { type: 'string', nullable: true }, memo: { type: 'string', nullable: true } } })
  const first = await post(api, { name: 'A', note: 'alpha', memo: 'm'.repeat(300) })
  await post(api, { name: 'B', note: null })

  await api.resources.items.migrateField({ from: 'note', to: { name: 'noteKey', type: 'string', nullable: true, indexed: true, search: true } })
  assert.equal((await slotsOf(knex)).noteKey, 'indexed_string_1')
  const found = await api.resources.items.query({ queryParams: { filters: { noteKey: 'alpha' } } })
  assert.deepEqual(found.data.map(record => record.id), [first.data.id])

  // A value the indexed slot cannot hold names its record and changes nothing.
  const before = await slotsOf(knex)
  await assert.rejects(
    api.resources.items.migrateField({ from: 'memo', to: { name: 'memoKey', type: 'string', nullable: true, indexed: true } }),
    new RegExp(`Record '${first.data.id}' cannot migrate 'memo' to 'memoKey'.*at most 255`)
  )
  assert.deepEqual(await slotsOf(knex), before)
})

layoutCase('concurrent servers never share an indexed slot', async (knex) => {
  await server(knex)
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => new AnyapiRegistry({ knex }).allocateField({
    tenant, resource: 'items', fieldName: `key${index}`, definition: { type: 'string', indexed: true }
  })))
  // SQLite refuses concurrent writers instead of queueing them.
  if (native) assert.deepEqual(results.map(result => result.reason?.message ?? result.status), Array(4).fill('fulfilled'))
  const keys = Object.entries(await slotsOf(knex)).filter(([name]) => name.startsWith('key')).map(([, slot]) => slot)
  assert.ok(keys.length >= 1)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(keys.every(slot => slot.startsWith('indexed_string_')), JSON.stringify(keys))
}, { concurrent: true, maxConnections: 4 })
