import { SLOT_POOLS } from '../../plugins/core/lib/anyapi/schema-utils.js'
import { applyDatabaseReadOptions, normalizeValueForDatabaseStorage } from '../../plugins/core/lib/querying-writing/database-value-normalizers.js'

// One-off migration example. Stop writers, back up, and choose conversions before calling.
// The caller owns the transaction; native timestamp precision DDL is a separate step.
export async function migrateAnyApiTemporalFields (transaction, moves) {
  if (!transaction?.isTransaction) throw new Error('A caller-owned Knex transaction is required')
  if (!Array.isArray(moves)) throw new Error('Expected an explicit list of temporal field moves')
  const plans = []
  const reserved = new Set()
  const fields = new Set()

  for (const { tenant, resource, field, from, to, convert } of moves) {
    if (!tenant || !resource || !field || !SLOT_POOLS.date.includes(from) || !SLOT_POOLS.string.includes(to) || typeof convert !== 'function') {
      throw new Error('Each move requires tenant, resource, field, date_N source, string_N target and convert')
    }
    const config = await transaction('any_resource_configs').where({ tenant_id: tenant, resource }).first()
    const definition = config && JSON.parse(config.schema_json)[field]
    if (!['date', 'time'].includes(definition?.type)) throw new Error(`Unknown calendar/time field '${resource}.${field}'`)
    const rows = await transaction('any_field_configs').where({ resource_config_id: config.id })
    const metadata = rows.find(row => row.field_name === field)
    if (metadata?.slot_type !== 'date' || metadata.slot_column !== from || Number(metadata.slot_index) !== SLOT_POOLS.date.indexOf(from) + 1) {
      throw new Error(`Source mapping changed for '${resource}.${field}'; inspect metadata before retrying`)
    }
    const targetKey = JSON.stringify([tenant, resource, to])
    if (fields.has(metadata.id) || reserved.has(targetKey) || rows.some(row => row.slot_column === to)) {
      throw new Error(`Duplicate move or occupied target '${resource}.${to}'`)
    }
    const scope = { tenant_id: tenant, resource }
    if (await transaction('any_records').where(scope).whereNotNull(to).first('id')) {
      throw new Error(`Target '${resource}.${to}' already contains data`)
    }
    fields.add(metadata.id)
    reserved.add(targetKey)
    plans.push({ field, from, to, convert, definition, metadata, scope })
  }

  const results = []
  for (const { field, from, to, convert, definition, metadata, scope } of plans) {
    let lastId = 0
    let count = 0
    while (true) {
      const rows = await applyDatabaseReadOptions(transaction('any_records')
        .where(scope).where('id', '>', lastId).select('id', 'logical_id', from).orderBy('id').limit(100))
      if (rows.length === 0) break
      for (const row of rows) {
        let value = null
        if (row[from] !== null) {
          value = await convert(row[from], { tenant: scope.tenant_id, resource: scope.resource, field, id: row.logical_id })
          if (typeof value !== 'string') throw new Error(`Conversion must return a string for '${scope.resource}.${field}'`)
          value = normalizeValueForDatabaseStorage(value, definition.type, {
            textStorage: true,
            temporalPrecision: definition.temporalPrecision,
            fieldName: field,
            resourceType: scope.resource
          })
        }
        await transaction('any_records').where({ ...scope, id: row.id }).update({ [to]: value })
        count++
      }
      lastId = rows.at(-1).id
    }
    await transaction('any_field_configs').where({ id: metadata.id }).update({
      slot_type: 'string',
      slot_index: SLOT_POOLS.string.indexOf(to) + 1,
      slot_column: to
    })
    results.push({ tenant: scope.tenant_id, resource: scope.resource, field, from, to, rows: count })
  }
  return results
}
