import { hasKnexTableIndex, listKnexTableIndexes } from '../dbIntrospection.js'

// Default layout of any_records. The registry reads the actual columns, so a
// migration that adds slots raises the limits for every server.
export const SLOT_LIMITS = Object.freeze({
  string: 10,
  number: 10,
  boolean: 5,
  date: 5,
  json: 5,
  belongsTo: 5,
})

// Indexed slots carry a (tenant_id, resource, slot) index. Fields declared
// `indexed: true` take them; every index costs each write to any_records.
export const INDEXED_SLOT_LIMITS = Object.freeze({
  string: 5,
  number: 3,
  boolean: 0,
  date: 2,
})

// Indexed string slots are VARCHAR so MySQL can index them whole.
export const INDEXED_STRING_LENGTH = 255

const SLOT_COLUMNS = {
  string: index => [`string_${index}`],
  number: index => [`number_${index}`],
  boolean: index => [`boolean_${index}`],
  date: index => [`date_${index}`],
  json: index => [`json_${index}`],
  belongsTo: index => [`rel_${index}_id`, `rel_${index}_type`],
}

export const indexedSlotColumn = (pool, index) => `indexed_${pool}_${index}`

const addSlotColumn = (table, column) => {
  const [, indexed, pool] = /^(indexed_)?([a-z]+)_/.exec(column)
  if (pool === 'number') table.double(column)
  else if (pool === 'boolean') table.boolean(column)
  else if (pool === 'date') table.dateTime(column, { precision: 6 })
  else if (pool === 'rel' || indexed) table.string(column, INDEXED_STRING_LENGTH)
  else table.text(column)
}

const resolveSlotCounts = (slots = {}, limits = SLOT_LIMITS, { label = 'slot', minimum = 1 } = {}) => {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    throw new Error(`AnyAPI ${label}s must be an object of slot counts`)
  }
  for (const [pool, count] of Object.entries(slots)) {
    if (!Object.hasOwn(limits, pool)) throw new Error(`Unknown AnyAPI ${label} pool '${pool}'`)
    if (!Number.isInteger(count) || count < minimum) {
      throw new Error(`AnyAPI ${pool} ${label} count must be ${minimum ? 'a positive' : 'a non-negative'} integer`)
    }
  }
  return { ...limits, ...slots }
}

const layoutColumns = (counts, indexedCounts) => [
  ...Object.entries(counts).flatMap(([pool, count]) => Array.from({ length: count }, (_, index) => SLOT_COLUMNS[pool](index + 1)).flat()),
  ...Object.entries(indexedCounts).flatMap(([pool, count]) => Array.from({ length: count }, (_, index) => indexedSlotColumn(pool, index + 1)))
]

const slotIndexName = column => `any_records_${column}_idx`

export const DEFAULT_CANONICAL_CONFIG = {
  scopeName: 'anyapi_records',
  tableName: 'any_records',
  type: 'anyapi_records',
  logicalIdColumn: 'logical_id',
  tenantColumn: 'tenant_id',
  resourceColumn: 'resource',
  relationshipColumn: 'relationship',
  leftIdColumn: 'left_id',
  leftResourceColumn: 'left_resource',
  rightIdColumn: 'right_id',
  rightResourceColumn: 'right_resource',
}

// Several servers may start at once: DDL another one completed first is success.
const tolerateConcurrentDdl = async (run, done) => {
  try {
    await run()
  } catch (error) {
    if (!await done().catch(() => false)) throw error
  }
}

// Returns whether the table was missing, so its indexes can be built offline.
const ensureTable = async (knex, tableName, tableBuilder) => {
  if (await knex.schema.hasTable(tableName)) return false
  await tolerateConcurrentDdl(() => knex.schema.createTable(tableName, tableBuilder), () => knex.schema.hasTable(tableName))
  return true
}

const ensureColumn = async (knex, tableName, columnName, columnBuilder) => {
  const exists = await knex.schema.hasTable(tableName)
  if (!exists) return

  const hasColumn = () => knex.schema.hasColumn(tableName, columnName)
  if (!await hasColumn()) {
    await tolerateConcurrentDdl(() => knex.schema.table(tableName, columnBuilder), hasColumn)
  }
}

const ensureUniqueIndex = async (knex, tableName, columns, indexName) => {
  const exists = await knex.schema.hasTable(tableName)
  if (!exists) return
  const hasIndex = () => hasKnexTableIndex(knex, tableName, indexName)
  if (!await hasIndex()) {
    await tolerateConcurrentDdl(() => knex.schema.table(tableName, (table) => {
      table.unique(columns, indexName)
    }), hasIndex)
  }
}

/**
 * Create missing secondary indexes. On an existing table they are built without
 * blocking writes: in place on MySQL, and concurrently on PostgreSQL unless the
 * pool has a single connection. Either way the build reads the whole table, so
 * on a big table run it from a migration before the deploy.
 */
const ensureIndexes = async (knex, tableName, indexes, { online }) => {
  const client = knex.client.config.client
  const pg = ['pg', 'postgresql'].includes(client)
  const mysql = ['mysql', 'mysql2'].includes(client)
  // The build lock needs a connection of its own beside the builds.
  const concurrently = online && pg && !knex.isTransaction && (knex.client.pool?.max ?? 0) > 1
  const missing = async () => {
    const existing = await listKnexTableIndexes(knex, tableName)
    return indexes.filter(({ name }) => !existing.get(name)?.valid && !existing.get(name)?.building)
      .map(index => ({ ...index, invalid: existing.has(index.name) }))
  }
  const build = async () => {
    for (const { name, columns, invalid } of await missing()) {
      const list = columns.map(() => '??').join(', ')
      if (invalid) await knex.raw(`drop index ${concurrently ? 'concurrently ' : ''}if exists ??`, [name])
      if (mysql) {
        await tolerateConcurrentDdl(
          () => knex.raw(`alter table ?? add index ?? (${list})${online ? ', algorithm=inplace, lock=none' : ''}`, [tableName, name, ...columns]),
          () => hasKnexTableIndex(knex, tableName, name)
        )
      } else {
        await tolerateConcurrentDdl(
          () => knex.raw(`create index ${concurrently ? 'concurrently ' : ''}if not exists ?? on ?? (${list})`, [name, tableName, ...columns]),
          async () => (await listKnexTableIndexes(knex, tableName)).has(name)
        )
      }
    }
  }
  if (!(await missing()).length) return
  if (concurrently) await withPgIndexBuildLock(knex, tableName, build)
  else await build()
}

// Concurrent builds on one table deadlock each other, so one server builds at a
// time. The lock lives on an idle session, which concurrent builds never wait
// for. A server that finds it taken carries on: the holder builds the same indexes.
const withPgIndexBuildLock = async (knex, tableName, build) => {
  const connection = await knex.client.acquireConnection()
  const lock = name => knex.select(knex.raw(`${name}(hashtext(?)) as result`, [`json-rest-api:indexes:${tableName}`]))
    .connection(connection).first()
  try {
    if (!(await lock('pg_try_advisory_lock')).result) return
    try {
      await build()
    } finally {
      await lock('pg_advisory_unlock')
    }
  } finally {
    await knex.client.releaseConnection(connection)
  }
}

/**
 * Create or upgrade the shared canonical tables. Run it from a migration, or let
 * the plugin run it at start-up. Counts only add missing slot columns, never
 * drop them; any_records always has at least the default layout.
 * @param {import('knex').Knex} knex
 * @param {{
 *   slots?: Partial<Record<keyof typeof SLOT_LIMITS, number>>,
 *   indexedSlots?: Partial<Record<keyof typeof INDEXED_SLOT_LIMITS, number>>
 * }} [options]
 */
export const ensureAnyApiSchema = async (knex, { slots, indexedSlots } = {}) => {
  const counts = resolveSlotCounts(slots)
  const indexedCounts = resolveSlotCounts(indexedSlots, INDEXED_SLOT_LIMITS, { label: 'indexed slot', minimum: 0 })
  const created = await ensureTable(knex, 'any_records', (table) => {
    table.increments('id').primary()
    table.string('logical_id')
    table.string('tenant_id').notNullable()
    table.string('resource').notNullable()

    layoutColumns(counts, indexedCounts).forEach(column => addSlotColumn(table, column))

    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('deleted_at')

    table.index(['tenant_id', 'resource'])
    table.unique(['tenant_id', 'resource', 'logical_id'], 'any_records_tenant_resource_logical_id_unique')
    table.index(['resource'])
  })

  const readColumns = async () => new Set(Object.keys(await knex('any_records').columnInfo()))
  let recordColumns = await readColumns()
  const missing = layoutColumns(counts, indexedCounts).filter(column => !recordColumns.has(column))
  if (missing.length) {
    await tolerateConcurrentDdl(
      () => knex.schema.alterTable('any_records', (table) => missing.forEach(column => addSlotColumn(table, column))),
      async () => {
        const columns = await readColumns()
        return missing.every(column => columns.has(column))
      }
    )
    recordColumns = await readColumns()
  }

  const client = knex.client.config.client
  if (['pg', 'postgresql', 'mysql', 'mysql2'].includes(client)) {
    const columns = (await knex('information_schema.columns')
      .select({ column: 'column_name', precision: 'datetime_precision' })
      .where('table_schema', knex.raw(client === 'pg' || client === 'postgresql' ? 'current_schema()' : 'DATABASE()'))
      .where('table_name', 'any_records'))
      .filter(column => /^(indexed_)?date_\d+$/.test(column.column))
    if (!columns.length || columns.some(column => Number(column.precision) !== 6)) {
      throw new Error('AnyAPI temporal storage migration required: every any_records date slot must use timestamp/datetime precision 6. See 33-migrating-to-v2.md.')
    }
  }

  await ensureColumn(knex, 'any_records', 'logical_id', (table) => {
    table.string('logical_id')
  })
  await ensureUniqueIndex(
    knex,
    'any_records',
    ['tenant_id', 'resource', 'logical_id'],
    'any_records_tenant_resource_logical_id_unique'
  )

  const rowsMissingLogicalId = await knex('any_records')
    .select('id')
    .whereNull('logical_id')

  for (const row of rowsMissingLogicalId) {
    await knex('any_records')
      .where({ id: row.id })
      .update({ logical_id: String(row.id) })
  }

  const linksCreated = await ensureTable(knex, 'any_links', (table) => {
    table.increments('id').primary()
    table.string('tenant_id').notNullable()
    table.string('relationship').notNullable()
    table.string('inverse_relationship')
    table.string('left_resource').notNullable()
    table.string('left_id').notNullable()
    table.string('right_resource').notNullable()
    table.string('right_id').notNullable()
    table.text('payload')
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable()

    table.index(['tenant_id', 'relationship'])
    table.index(['tenant_id', 'inverse_relationship'])
    table.index(['tenant_id', 'left_resource'])
    table.index(['tenant_id', 'right_resource'])
    table.index(['relationship'])
    table.index(['inverse_relationship'])
  })

  // Filters on indexed fields, child lookups by parent id and link lookups by
  // record id all stay inside one tenant's rows.
  const recordIndexes = [...recordColumns]
    .filter(column => /^(indexed_[a-z]+_\d+|rel_\d+_id)$/.test(column))
    .map(column => ({ name: slotIndexName(column), columns: ['tenant_id', 'resource', column] }))
  await ensureIndexes(knex, 'any_records', recordIndexes, { online: !created })
  await ensureIndexes(knex, 'any_links', [
    { name: 'any_links_tenant_left_id_idx', columns: ['tenant_id', 'left_id'] },
    { name: 'any_links_tenant_right_id_idx', columns: ['tenant_id', 'right_id'] }
  ], { online: !linksCreated })

  await ensureTable(knex, 'any_resource_configs', (table) => {
    table.increments('id').primary()
    table.string('tenant_id').notNullable()
    table.string('resource').notNullable()
    table.text('schema_json').notNullable()
    table.text('relationships_json').notNullable()
    // Holds the search schema and runtime additions too: MySQL TEXT stops at 64 KB.
    table.text('definition_json', 'longtext')
    table.integer('schema_version').notNullable().defaultTo(1)
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable()

    table.unique(['tenant_id', 'resource'])
  })
  await ensureColumn(knex, 'any_resource_configs', 'definition_json', (table) => {
    table.text('definition_json', 'longtext')
  })
  await ensureColumn(knex, 'any_resource_configs', 'schema_version', (table) => {
    table.integer('schema_version').notNullable().defaultTo(1)
  })

  await ensureTable(knex, 'any_field_configs', (table) => {
    table.increments('id').primary()
    table.integer('resource_config_id').unsigned().notNullable()
      .references('id').inTable('any_resource_configs').onDelete('CASCADE')
    table.string('field_name').notNullable()
    table.string('slot_type').notNullable()
    table.integer('slot_index').notNullable()
    table.string('slot_column').notNullable()
    table.boolean('nullable').defaultTo(false).notNullable()
    table.boolean('required').defaultTo(false).notNullable()
    table.string('target_resource')
    table.string('alias')
    table.text('meta_json')
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable()

    table.unique(['resource_config_id', 'field_name'])
    table.unique(['resource_config_id', 'slot_column'], 'any_field_configs_resource_slot_unique')
    table.index(['resource_config_id'])
  })
  if (!await hasKnexTableIndex(knex, 'any_field_configs', 'any_field_configs_resource_slot_unique')) {
    const shared = await knex('any_field_configs')
      .select('resource_config_id', 'slot_column')
      .groupBy('resource_config_id', 'slot_column')
      .havingRaw('count(*) > 1')
      .first()
    if (shared) {
      throw new Error(`AnyAPI slot metadata repair required: several fields of resource config ${shared.resource_config_id} share ${shared.slot_column}. Reassign them before upgrading.`)
    }
    await ensureUniqueIndex(knex, 'any_field_configs', ['resource_config_id', 'slot_column'], 'any_field_configs_resource_slot_unique')
  }

  await ensureTable(knex, 'any_relationship_configs', (table) => {
    table.increments('id').primary()
    table.integer('resource_config_id').unsigned().notNullable()
      .references('id').inTable('any_resource_configs').onDelete('CASCADE')
    table.string('relationship_name').notNullable()
    table.string('relationship_type').notNullable()
    table.string('target_resource')
    table.integer('slot_index')
    table.string('id_column')
    table.string('type_column')
    table.string('relationship_key')
    table.string('through')
    table.string('foreign_key')
    table.string('other_key')
    table.string('alias')
    table.text('meta_json')
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable()

    table.unique(['resource_config_id', 'relationship_name'], 'any_relationship_configs_resource_relationship_unique')
    table.index(['resource_config_id'])
  })
}

// The default unindexed layout, for migrations written against it.
export const SLOT_POOLS = Object.fromEntries(Object.entries(SLOT_LIMITS).map(([pool, count]) => {
  const indexes = Array.from({ length: count }, (_, index) => index + 1)
  return [pool, pool === 'belongsTo' ? indexes : indexes.map(index => SLOT_COLUMNS[pool](index)[0])]
}))

/**
 * Read the slot columns any_records actually has. Slots are numbered from 1
 * without gaps; a pool ends at its first missing column. `indexed` lists the
 * indexed columns of each pool that has them.
 * @param {import('knex').Knex | import('knex').Knex.Transaction} db
 */
export const readSlotPools = async (db) => {
  const columns = new Set(Object.keys(await db('any_records').columnInfo()))
  if (!columns.size) throw new Error('AnyAPI storage tables are missing; run ensureAnyApiSchema in a migration')
  const run = columnsAt => {
    const indexes = []
    for (let index = 1; columnsAt(index).every(column => columns.has(column)); index += 1) indexes.push(index)
    return indexes
  }
  return {
    ...Object.fromEntries(Object.keys(SLOT_LIMITS).map(pool => {
      const indexes = run(SLOT_COLUMNS[pool])
      return [pool, pool === 'belongsTo' ? indexes : indexes.map(index => SLOT_COLUMNS[pool](index)[0])]
    })),
    indexed: Object.fromEntries(Object.keys(INDEXED_SLOT_LIMITS).map(pool => [
      pool, run(index => [indexedSlotColumn(pool, index)]).map(index => indexedSlotColumn(pool, index))
    ]))
  }
}

export const TYPE_TO_POOL = new Map([
  ['string', 'string'],
  ['uuid', 'string'],
  ['email', 'string'],
  ['file', 'string'],
  ['number', 'number'],
  ['integer', 'number'],
  ['boolean', 'boolean'],
  ['date', 'string'],
  ['dateTime', 'date'],
  ['time', 'string'],
  ['epochMilliseconds', 'number'],
  ['epochSeconds', 'number'],
  ['object', 'json'],
  ['array', 'json'],
])
