// @ts-check
import { applyInsertReturning, getDatabaseCapabilities, getDatabaseInfo, getSchemaCapabilities, getTemporalStorageCapabilities, supportsWindowFunctions } from '../../plugins/core/lib/querying-writing/database-capabilities.js'

/** @import { StorageDatabase, DatabaseCapabilities } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageDatabase} database */
export async function checkCapabilities (database) {
  /** @type {DatabaseCapabilities} */
  const capabilities = await getDatabaseCapabilities(database, { warn: () => {} })
  const info = await getDatabaseInfo(database)
  const supported = await supportsWindowFunctions(database, info)
  const schema = getSchemaCapabilities(database.client.config.client)
  const temporal = getTemporalStorageCapabilities('pg', { textStorage: true })
  const query = applyInsertReturning(database('items').insert({ name: 'Example' }), { id: database.raw('??', ['record_key']) })
  await query

  // @ts-expect-error A connection configuration is not an initialized database.
  getDatabaseCapabilities({ client: 'pg' })
  // @ts-expect-error A diagnostic logger needs a callable warning sink.
  getDatabaseInfo(database, { warn: true })
  // @ts-expect-error A version observation must contain a string version.
  supportsWindowFunctions(database, { version: 8 })
  /** @type {'transaction'} */
  // @ts-expect-error Different backends use different schema completion mechanisms.
  const assumedTransactional = schema.fieldAlteration
  // @ts-expect-error Text storage has no fixed fractional-digit limit.
  temporal.timeFractionDigits.toFixed()
  // @ts-expect-error Shared capability constants cannot be mutated by a caller.
  capabilities.relationships.declaredCardinalities.hasMany = 'one'
  // @ts-expect-error Returning columns are names or SQL expressions, not numbers.
  applyInsertReturning(database('items').insert({}), { id: 42 })
  return { supported, assumedTransactional }
}
