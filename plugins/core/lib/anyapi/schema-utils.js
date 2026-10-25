import { hasKnexTableIndex } from '../dbIntrospection.js'

// Default layout of a new any_records table. The registry reads the actual
// columns, so a migration that adds slots raises the limits for every server.
export const SLOT_LIMITS = Object.freeze({
  string: 10,
  number: 10,
  boolean: 5,
  date: 5,
  json: 5,
  belongsTo: 5,
})

const SLOT_COLUMNS = {
  string: index => [`string_${index}`],
  number: index => [`number_${index}`],
  boolean: index => [`boolean_${index}`],
  date: index => [`date_${index}`],
  json: index => [`json_${index}`],
  belongsTo: index => [`rel_${index}_id`, `rel_${index}_type`],
}

const addSlotColumn = (table, column) => {
  if (column.startsWith('number_')) table.double(column)
  else if (column.startsWith('boolean_')) table.boolean(column)
  else if (column.startsWith('date_')) table.dateTime(column, { precision: 6 })
  else if (column.startsWith('rel_')) table.string(column)
  else table.text(column)
}

const resolveSlotCounts = (slots = {}) => {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
    throw new Error('AnyAPI slots must be an object of slot counts')
  }
  for (const [pool, count] of Object.entries(slots)) {
    if (!Object.hasOwn(SLOT_LIMITS, pool)) throw new Error(`Unknown AnyAPI slot pool '${pool}'`)
    if (!Number.isInteger(count) || count < 1) throw new Error(`AnyAPI ${pool} slot count must be a positive integer`)
  }
  return { ...SLOT_LIMITS, ...slots }
}

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

const ensureTable = async (knex, tableName, tableBuilder) => {
  const exists = await knex.schema.hasTable(tableName)
  if (!exists) {
    await knex.schema.createTable(tableName, tableBuilder)
  }
}

const ensureColumn = async (knex, tableName, columnName, columnBuilder) => {
  const exists = await knex.schema.hasTable(tableName)
  if (!exists) return

  const hasColumn = await knex.schema.hasColumn(tableName, columnName)
  if (!hasColumn) {
    await knex.schema.table(tableName, columnBuilder)
  }
}

const ensureUniqueIndex = async (knex, tableName, columns, indexName) => {
  const exists = await knex.schema.hasTable(tableName)
  if (!exists) return
  const hasIndex = await hasKnexTableIndex(knex, tableName, indexName)
  if (!hasIndex) {
    await knex.schema.table(tableName, (table) => {
      table.unique(columns, indexName)
    })
  }
}

/**
 * Create or upgrade the shared canonical tables. Run it from a migration, or let
 * the plugin run it at start-up. `slots` only adds missing slot columns; lowering
 * a count never drops columns that may hold data.
 * @param {import('knex').Knex} knex
 * @param {{ slots?: Partial<Record<keyof typeof SLOT_LIMITS, number>> }} [options]
 */
export const ensureAnyApiSchema = async (knex, { slots } = {}) => {
  const counts = resolveSlotCounts(slots)
  await ensureTable(knex, 'any_records', (table) => {
    table.increments('id').primary()
    table.string('logical_id')
    table.string('tenant_id').notNullable()
    table.string('resource').notNullable()

    for (const [pool, count] of Object.entries(counts)) {
      for (let index = 1; index <= count; index += 1) SLOT_COLUMNS[pool](index).forEach(column => addSlotColumn(table, column))
    }

    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable()
    table.dateTime('deleted_at')

    table.index(['tenant_id', 'resource'])
    table.unique(['tenant_id', 'resource', 'logical_id'], 'any_records_tenant_resource_logical_id_unique')
    table.index(['resource'])
  })

  if (slots) {
    const existing = new Set(Object.keys(await knex('any_records').columnInfo()))
    const missing = Object.entries(counts).flatMap(([pool, count]) => Array.from({ length: count }, (_, index) => SLOT_COLUMNS[pool](index + 1)))
      .flat()
      .filter(column => !existing.has(column))
    if (missing.length) {
      await knex.schema.alterTable('any_records', (table) => missing.forEach(column => addSlotColumn(table, column)))
    }
  }

  const client = knex.client.config.client
  if (['pg', 'postgresql', 'mysql', 'mysql2'].includes(client)) {
    const columns = (await knex('information_schema.columns')
      .select({ column: 'column_name', precision: 'datetime_precision' })
      .where('table_schema', knex.raw(client === 'pg' || client === 'postgresql' ? 'current_schema()' : 'DATABASE()'))
      .where('table_name', 'any_records'))
      .filter(column => /^date_\d+$/.test(column.column))
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

  await ensureTable(knex, 'any_links', (table) => {
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

const buildSlotPools = (hasColumns) => Object.fromEntries(Object.keys(SLOT_LIMITS).map(pool => {
  const indexes = []
  for (let index = 1; hasColumns(pool, index); index += 1) indexes.push(index)
  return [pool, pool === 'belongsTo' ? indexes : indexes.map(index => SLOT_COLUMNS[pool](index)[0])]
}))

export const SLOT_POOLS = buildSlotPools((pool, index) => index <= SLOT_LIMITS[pool])

/**
 * Read the slot columns any_records actually has. Slots are numbered from 1
 * without gaps; a pool ends at its first missing column.
 * @param {import('knex').Knex | import('knex').Knex.Transaction} db
 */
export const readSlotPools = async (db) => {
  const columns = new Set(Object.keys(await db('any_records').columnInfo()))
  if (!columns.size) throw new Error('AnyAPI storage tables are missing; run ensureAnyApiSchema in a migration')
  return buildSlotPools((pool, index) => SLOT_COLUMNS[pool](index).every(column => columns.has(column)))
}

export const TYPE_TO_POOL = new Map([
  ['string', 'string'],
  ['text', 'string'],
  ['uuid', 'string'],
  ['email', 'string'],
  ['file', 'string'],
  ['number', 'number'],
  ['integer', 'number'],
  ['float', 'number'],
  ['decimal', 'number'],
  ['boolean', 'boolean'],
  ['date', 'string'],
  ['datetime', 'date'],
  ['dateTime', 'date'],
  ['time', 'string'],
  ['epochMilliseconds', 'number'],
  ['epochSeconds', 'number'],
  ['json', 'json'],
  ['object', 'json'],
  ['array', 'json'],
])
