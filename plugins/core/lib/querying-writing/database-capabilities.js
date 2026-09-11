// @ts-check

import { errorMessage } from '../../../../lib/error-context.js'
import { formatDiagnosticValue } from '../../../../lib/error-formatter.js'

/**
 * Parses database version string to comparable format
 *
 * @param {string} versionString - Raw version string from database
 * @returns {{major: number, minor: number, patch: number}|null} Parsed version
 */
const parseVersion = (versionString) => {
  // MySQL: "8.0.33"
  // PostgreSQL: "14.5 (Ubuntu 14.5-1.pgdg20.04+1)"
  // MariaDB: "10.6.12-MariaDB"
  // SQLite: "3.35.5"

  const match = versionString.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : 0
  }
}

/**
 * Checks if the database supports window functions based on version
 *
 * @param {import('../storage/storage-types.js').StorageDatabase} knex - Knex instance
 * @param {{ version: string }} [databaseInfo] - Already fetched version
 * @param {import('../storage/storage-types.js').CapabilityLogger} [log] - Configured diagnostic sink
 * @returns {Promise<boolean>} True if window functions are supported
 */
export const supportsWindowFunctions = async (knex, databaseInfo, log) => {
  const client = knex.client.config.client
  if (['pg', 'postgresql', 'mssql', 'oracledb'].includes(client)) return true
  if (!['mysql', 'mysql2', 'sqlite3', 'better-sqlite3'].includes(client) && !client.includes('maria')) return false

  const info = databaseInfo || await getDatabaseInfo(knex, log)
  const parsed = typeof info.version === 'string' ? parseVersion(info.version) : null
  if (!parsed) return false
  if (['mysql', 'mysql2'].includes(client)) return parsed.major >= 8
  if (client.includes('sqlite')) return parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 25)
  return info.version.toLowerCase().includes('mariadb') &&
    (parsed.major > 10 || (parsed.major === 10 && parsed.minor >= 2))
}

// Built-in rules; custom field declarations still undergo their own validation.
/** @type {import('../storage/storage-types.js').SerializationCapabilities} */
export const SERIALIZATION_CAPABILITIES = Object.freeze({
  customSerializerResult: 'synchronous',
  structuredTypes: Object.freeze(['object', 'array']),
  structuredEncoding: 'json',
  wholeDocumentPredicates: false
})

/** @type {import('../storage/storage-types.js').RelationshipCapabilities} */
export const RELATIONSHIP_CAPABILITIES = Object.freeze({
  attributeKinds: Object.freeze(['belongsTo', 'belongsToPolymorphic']),
  declaredCardinalities: Object.freeze({ hasOne: 'one', hasMany: 'many', manyToMany: 'many' })
})

/**
 * Both storage plugins share one version observation during initialization.
 * @param {import('../storage/storage-types.js').StorageDatabase} knex
 * @param {import('../storage/storage-types.js').CapabilityLogger} [log]
 * @returns {Promise<import('../storage/storage-types.js').DatabaseCapabilities>}
 */
export const getDatabaseCapabilities = async (knex, log) => {
  const dbInfo = await getDatabaseInfo(knex, log)
  return {
    dbInfo,
    windowFunctions: await supportsWindowFunctions(knex, dbInfo),
    insertResult: getInsertResultMode(knex.client.config.client),
    serialization: SERIALIZATION_CAPABILITIES,
    relationships: RELATIONSHIP_CAPABILITIES,
    temporal: {
      native: getTemporalStorageCapabilities(knex.client.config.client),
      text: getTemporalStorageCapabilities(knex.client.config.client, { textStorage: true })
    },
    schema: getSchemaCapabilities(knex.client.config.client)
  }
}

/**
 * @param {unknown} dialect
 * @returns {import('../storage/storage-types.js').InsertResultMode}
 */
export const getInsertResultMode = dialect => {
  const client = String(dialect || '').toLowerCase()
  if (['mysql', 'mysql2'].includes(client)) return 'insert-id'
  if (['pg', 'postgresql', 'sqlite3', 'better-sqlite3'].includes(client)) return 'rows'
  return 'driver-defined'
}

/**
 * Choose the query form; each caller must still validate its driver's result.
 * @param {import('knex').Knex.QueryBuilder<import('../storage/storage-types.js').StorageRow, unknown>} query
 * @param {string|string[]|Record<string, string|import('knex').Knex.Raw<unknown>>} columns
 * @returns {import('knex').Knex.QueryBuilder<import('../storage/storage-types.js').StorageRow, unknown>}
 */
export const applyInsertReturning = (query, columns) => {
  if (getInsertResultMode(query.client.config.client) === 'insert-id') return query
  // Knex supports alias dictionaries at runtime; its declarations omit that overload.
  const returning = /** @type {(columns: string|string[]|Record<string, string|import('knex').Knex.Raw<unknown>>) => typeof query} */ (query.returning)
  return returning.call(query, columns)
}

/**
 * Built-in value conversion limits; schemas/custom serializers may differ.
 * @param {unknown} dialect
 * @param {{textStorage?: boolean}} [options]
 * @returns {import('../storage/storage-types.js').TemporalStorageCapabilities}
 */
export const getTemporalStorageCapabilities = (dialect, { textStorage = false } = {}) => {
  const client = String(dialect || '').toLowerCase()
  const mysql = ['mysql', 'mysql2'].includes(client)
  return {
    dateMinYear: !textStorage && mysql ? 1000 : 0,
    dateTimeMinYear: mysql ? 1000 : 0,
    maxYear: 9999,
    dateTimeFractionDigits: 3,
    timeFractionDigits: !textStorage && (mysql || ['pg', 'postgresql'].includes(client)) ? 6 : null
  }
}

/**
 * Describe the existing field-alteration runner, not all database DDL.
 * @param {unknown} dialect
 * @returns {import('../storage/storage-types.js').SchemaCapabilities}
 */
export const getSchemaCapabilities = dialect => {
  const client = String(dialect || '').toLowerCase()
  const mysql = /mysql/.test(client)
  const sqlite = client.includes('sqlite')
  const postgres = ['pg', 'postgresql'].includes(client)
  return {
    recognizedDialect: mysql || sqlite || postgres,
    fieldAlteration: mysql ? 'standalone' : sqlite ? 'sqlite-rebuild' : 'transaction',
    callerFieldAlteration: mysql ? 'forbidden' : sqlite ? 'foreign-keys-off' : 'savepoint',
    temporalColumnFractionDigits: mysql || postgres ? 6 : null,
    setValues: mysql
  }
}

/**
 * Gets database info for error messages and capability checks
 *
 * @param {import('../storage/storage-types.js').StorageDatabase} knex - Knex instance
 * @param {import('../storage/storage-types.js').CapabilityLogger} [log] - Configured diagnostic sink
 * @returns {Promise<import('../storage/storage-types.js').DatabaseInfo>} Database info with client and version
 */
export const getDatabaseInfo = async (knex, log) => {
  const client = knex.client.config.client
  let name = client
  if (['mysql', 'mysql2'].includes(client)) name = 'MySQL'
  else if (['sqlite3', 'better-sqlite3'].includes(client)) name = 'SQLite'
  else if (['pg', 'postgresql'].includes(client)) name = 'PostgreSQL'
  try {
    /** @type {unknown} */
    let version
    switch (name) {
      case 'MySQL': {
        const row = await knex.first(knex.raw('VERSION() as version'))
        version = row && 'version' in row ? row.version : undefined
        break
      }
      case 'SQLite':
        version = (await knex.raw('SELECT sqlite_version() as version'))?.[0]?.version
        break
      case 'PostgreSQL':
        version = (await knex.raw('SELECT version() as version'))?.rows?.[0]?.version
        break
      default:
        if (!client.includes('maria')) return { client: name, version: 'unknown' }
        version = (await knex.raw('SELECT VERSION() as version'))?.[0]?.version
    }
    if (typeof version !== 'string') throw new Error('Database version query did not return a string')
    return { client: name, version }
  } catch (error) {
    // Capability observation is advisory; a failing diagnostic must not replace it.
    try {
      await log?.warn('Database version observation failed', formatDiagnosticValue({
        operation: 'database-capabilities', phase: 'version-observation', backend: client, error
      }))
    } catch {}
    return { client: name, version: 'unknown', error: errorMessage(error) }
  }
}
