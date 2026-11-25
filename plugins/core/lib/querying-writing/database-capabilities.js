// @ts-check

import { errorMessage } from '../../../../lib/error-context.js'
import { formatDiagnosticValue } from '../../../../lib/error-formatter.js'
import { rememberInPredicateConversionThreshold } from '../querying/in-lists.js'

// The SQL family of a Knex instance or transaction: 'sqlite', 'pg' or 'mysql' (MySQL and MariaDB).
/** @param {import('knex').Knex} db */
export function databaseFamily (db) {
  const client = String(db.client.config.client)
  if (client.includes('sqlite')) return 'sqlite'
  if (client === 'pg' || client === 'postgresql') return 'pg'
  return 'mysql'
}

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
 * Capabilities whose version observation failed, as when an API starts before
 * its database answers, are provisional: the next storage call observes again,
 * and so on until an observation succeeds and they settle in place.
 * @type {WeakMap<object, { knex: import('../storage/storage-types.js').StorageDatabase, log?: import('../storage/storage-types.js').CapabilityLogger, attempt: Promise<void> | null }>}
 */
const provisional = new WeakMap()

/**
 * Both storage plugins share one version observation during initialization.
 * @param {import('../storage/storage-types.js').StorageDatabase} knex
 * @param {import('../storage/storage-types.js').CapabilityLogger} [log]
 * @returns {Promise<import('../storage/storage-types.js').DatabaseCapabilities>}
 */
export const getDatabaseCapabilities = async (knex, log) => {
  const dbInfo = await getDatabaseInfo(knex, log)
  const capabilities = {
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
  if ('error' in dbInfo) provisional.set(capabilities, { knex, log, attempt: null })
  return capabilities
}

/**
 * Observes provisional capabilities again, through `db` when given (the
 * caller's connection or transaction, so a pool of one connection is never
 * waited on), and settles them in place once an observation succeeds. Callers
 * meanwhile share one attempt; a failed one logs its error as the first did.
 * @param {import('../storage/storage-types.js').DatabaseCapabilities} capabilities
 * @param {import('../storage/storage-types.js').StorageDatabase} [db]
 * @returns {Promise<void> | undefined} the attempt, or undefined once settled
 */
export function observeCapabilitiesAgain (capabilities, db) {
  const pending = provisional.get(capabilities)
  if (!pending) return undefined
  pending.attempt ??= (async () => {
    const source = db || pending.knex
    const dbInfo = await getDatabaseInfo(source, pending.log)
    if ('error' in dbInfo) return
    capabilities.dbInfo = dbInfo
    capabilities.windowFunctions = await supportsWindowFunctions(source, dbInfo)
    provisional.delete(capabilities)
    try {
      await pending.log?.info?.('Database capabilities detected:', {
        database: dbInfo.client, version: dbInfo.version, windowFunctions: capabilities.windowFunctions
      })
    } catch {}
  })().finally(() => { pending.attempt = null })
  return pending.attempt
}

/**
 * A storage plugin's data helpers, each first observing provisional
 * capabilities again through the database its call uses (`context.db`).
 * @template {Record<string, unknown>} T
 * @param {T} storageHelpers
 * @param {import('../storage/storage-types.js').DatabaseCapabilities} capabilities
 * @returns {T}
 */
export const observingCapabilities = (storageHelpers, capabilities) => {
  /** @type {Record<string, any>} */
  const observing = {}
  for (const [name, helper] of Object.entries(storageHelpers)) {
    if (typeof helper !== 'function') {
      observing[name] = helper
      continue
    }
    observing[name] = (/** @type {any[]} */ ...args) => {
      const attempt = observeCapabilitiesAgain(capabilities, args[0]?.context?.db)
      return attempt ? attempt.then(() => helper(...args)) : helper(...args)
    }
  }
  return /** @type {T} */ (observing)
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
    /** @type {number | undefined} */
    let maxAllowedPacket
    /** @type {number | undefined} */
    let inPredicateConversionThreshold
    switch (name) {
      case 'MySQL': {
        // The longest statement the server takes, which bounds a blob a write sends.
        const row = /** @type {{ version?: string, maxAllowedPacket?: number | string } | undefined} */ (await knex.first(knex.raw('VERSION() as version, @@max_allowed_packet as maxAllowedPacket')))
        version = row && 'version' in row ? row.version : undefined
        if (row && Number.isSafeInteger(Number(row.maxAllowedPacket))) maxAllowedPacket = Number(row.maxAllowedPacket)
        // The shortest IN list MariaDB turns into a join, which a locking read keeps its lists below (see in-lists.js).
        if (typeof version === 'string' && /mariadb/i.test(version)) {
          const setting = /** @type {{ threshold?: number | string } | undefined} */ (await knex.first(knex.raw('@@in_predicate_conversion_threshold as threshold')))
          if (setting && Number.isSafeInteger(Number(setting.threshold))) {
            inPredicateConversionThreshold = Number(setting.threshold)
            rememberInPredicateConversionThreshold(knex, inPredicateConversionThreshold)
          }
        }
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
    return {
      client: name,
      version,
      ...(maxAllowedPacket === undefined ? {} : { maxAllowedPacket }),
      ...(inPredicateConversionThreshold === undefined ? {} : { inPredicateConversionThreshold })
    }
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
