// @ts-check
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { getResourceFieldset, parseFieldset } from './field-utils.js'
import { databaseFamily } from './database-capabilities.js'

// A blob field (`type: 'blob'`, with `maxBytes`) holds bytes the process keeps
// whole. A write takes a Buffer or a Uint8Array of at most maxBytes, checked by
// its schema type before the write runs; a read answers it only where its
// fields name it, never in an HTTP response, and holds at most BLOB_READ_BYTES
// of blobs or one record's.

/** The most bytes of blobs a read or a write statement holds, unless one record's are more. */
export const BLOB_READ_BYTES = 16 * 1024 * 1024
// MySQL and MariaDB receive a written blob as hex text, two bytes per byte, in a
// statement no longer than max_allowed_packet; the rest of the statement gets this.
const STATEMENT_ROOM = 1024 * 1024
// MySQL's binary column types, smallest first, with the most bytes each holds.
const MYSQL_BLOB_TYPES = /** @type {const} */ ([['tinyblob', 255], ['blob', 65535], ['mediumblob', 16777215], ['longblob', 4294967295]])
// What a blob never is: a search key, an index, a link or a default.
const REFUSED_OPTIONS = ['search', 'unique', 'index', 'indexed', 'primary', 'belongsTo', 'defaultTo', 'default']

/**
 * The blob fields of a schema, as [name, definition] pairs.
 * @param {Record<string, any> | undefined} schemaStructure
 * @returns {Array<[string, { maxBytes: number } & Record<string, any>]>}
 */
export const blobFieldsOf = schemaStructure =>
  Object.entries(schemaStructure || {}).filter(([, definition]) => definition?.type === 'blob')

/**
 * The MySQL column type that holds `maxBytes`.
 * @param {number} maxBytes
 */
export const mysqlBlobColumnType = maxBytes => (MYSQL_BLOB_TYPES.find(([, limit]) => maxBytes <= limit) || MYSQL_BLOB_TYPES[3])[0]

/**
 * The most bytes a MySQL column type holds, or undefined for another type.
 * @param {string} columnType
 */
export const mysqlBlobColumnBytes = columnType => MYSQL_BLOB_TYPES.find(([type]) => type === String(columnType).toLowerCase())?.[1]

/**
 * Refuse a blob field registration can already tell is unsafe: without maxBytes,
 * searched, indexed, linked or defaulted, on AnyAPI storage (which keeps no
 * bytes), or larger than a MySQL or MariaDB server's max_allowed_packet takes
 * in one write. maxBytes on another field is refused too.
 * @param {{ schemaStructure?: Record<string, any>, searchSchemaStructure?: Record<string, any> }} schemaInfo
 * @param {string} scopeName
 * @param {{ anyapi: boolean, maxAllowedPacket?: number }} storage
 */
export function assertBlobFields (schemaInfo, scopeName, { anyapi, maxAllowedPacket }) {
  const fields = schemaInfo.schemaStructure || {}
  let bytes = 0
  for (const [name, definition] of Object.entries(fields)) {
    if (definition?.type !== 'blob') {
      if (definition && Object.hasOwn(definition, 'maxBytes')) {
        throw new Error(`Field '${name}' in resource '${scopeName}' has maxBytes, a blob's limit, but type '${definition.type}'`)
      }
      continue
    }
    const field = `Blob field '${name}' in resource '${scopeName}'`
    if (anyapi) throw new Error(`${field}: AnyAPI storage keeps no bytes; keep the resource on Knex storage`)
    if (!Number.isSafeInteger(definition.maxBytes) || definition.maxBytes < 1) {
      throw new Error(`${field} needs maxBytes, the most bytes a value holds, as a whole number from 1`)
    }
    const refused = REFUSED_OPTIONS.filter(option => definition[option] !== undefined && definition[option] !== false)
    if (refused.length) {
      throw new Error(`${field} takes no ${refused.join(', ')}: a blob is written and read whole, never searched, indexed, linked or defaulted`)
    }
    bytes += definition.maxBytes
  }
  for (const [name, definition] of Object.entries(schemaInfo.searchSchemaStructure || {})) {
    const targets = [definition?.actualField ?? name, ...(Array.isArray(definition?.oneOf) ? definition.oneOf : [])]
    const blob = targets.find(target => fields[target]?.type === 'blob')
    if (blob) throw new Error(`Search field '${name}' in resource '${scopeName}' searches the blob '${blob}', which is never searched`)
  }
  if (bytes && maxAllowedPacket && 2 * bytes + STATEMENT_ROOM > maxAllowedPacket) {
    throw new Error(
      `The blob fields of resource '${scopeName}' hold up to ${bytes} bytes, which a write sends as ${2 * bytes} bytes of hex text, ` +
      `and with ${STATEMENT_ROOM} bytes for the rest of the statement that is more than the server's max_allowed_packet (${maxAllowedPacket}): ` +
      'raise max_allowed_packet or lower maxBytes'
    )
  }
}

/**
 * The most rows a statement writing `columns` holds, by their blobs' maxBytes:
 * BLOB_READ_BYTES of them, on MySQL and MariaDB within max_allowed_packet too,
 * and always at least one row. Infinity when the columns hold no blob.
 * @param {import('knex').Knex} db
 * @param {{ schemaStructure?: Record<string, any> }} schemaInfo
 * @param {(field: string) => string} translateColumn
 * @param {Iterable<string>} columns
 * @param {number} [maxAllowedPacket]
 */
export function blobRowsPerStatement (db, schemaInfo, translateColumn, columns, maxAllowedPacket) {
  const written = new Set(columns)
  const bytes = blobFieldsOf(schemaInfo.schemaStructure)
    .filter(([name]) => written.has(translateColumn(name)))
    .reduce((sum, [, definition]) => sum + definition.maxBytes, 0)
  if (!bytes) return Infinity
  const budget = databaseFamily(db) === 'mysql' && maxAllowedPacket
    ? Math.min(BLOB_READ_BYTES, Math.floor((maxAllowedPacket - STATEMENT_ROOM) / 2))
    : BLOB_READ_BYTES
  return Math.max(1, Math.floor(budget / bytes))
}

/**
 * The columns of a read of several records, which reads no blob: `table.*`,
 * or, when the resource has blobs, each stored column but them.
 * @param {{ schemaStructure?: Record<string, any> }} schemaInfo
 * @param {{ getIdColumn: () => string, translateColumn: (field: string) => string }} storageAdapter
 * @param {string} tableName
 * @returns {string[]}
 */
export function columnsWithoutBlobs (schemaInfo, storageAdapter, tableName) {
  const fields = Object.entries(schemaInfo.schemaStructure || {})
  if (!fields.some(([, definition]) => definition?.type === 'blob')) return [`${tableName}.*`]
  const columns = new Set([`${tableName}.${storageAdapter.getIdColumn()}`])
  for (const [name, definition] of fields) {
    if (definition.type === 'blob' || definition.virtual || definition.computed || definition.belongsToPolymorphic) continue
    columns.add(`${tableName}.${storageAdapter.translateColumn(name)}`)
  }
  return [...columns]
}

/**
 * Refuse a read whose fields name blobs it cannot hold, before it runs. `rows`
 * is the most records the read answers: 1 for get, the page size for a query
 * page, the ids for lockByIds, Infinity for a read of every matching row. A
 * read holds at most BLOB_READ_BYTES of the blobs its fields name, or one
 * record's. An included resource's blob is refused, as an include holds any
 * number of records, and so is any blob in a response to an HTTP request,
 * which answers JSON.
 * @param {{ context: any, scopes: Record<string, any>, scopeName: string, rows: number, operation: string }} read
 */
export function assertBlobReads ({ context, scopes, scopeName, rows, operation }) {
  const fieldsets = context.queryParams?.fields || {}
  for (const name of Object.keys(fieldsets)) {
    const requested = parseFieldset(getResourceFieldset(fieldsets, name)) || []
    const structure = scopes[name]?.vars?.schemaInfo?.schemaStructure || {}
    const blobs = requested.filter(field => structure[field]?.type === 'blob')
    if (!blobs.length) continue
    const labels = blobs.map(field => `${name}.${field}`).join(', ')
    const refuse = (/** @type {string} */ message) => {
      throw new RestApiValidationError(message, { fields: [`fields.${name}`], violations: [{ field: `fields.${name}`, rule: 'blob_read', message }] })
    }
    if (context.transport) refuse(`${labels} is a blob, which an HTTP response does not answer as JSON: serve its bytes from a route of its own`)
    if (name !== scopeName) refuse(`${operation} names ${labels}, a blob of an included resource, of whose records an include holds any number: read it through that resource`)
    const bytes = blobs.reduce((sum, field) => sum + structure[field].maxBytes, 0)
    const fit = Math.max(1, Math.floor(BLOB_READ_BYTES / bytes))
    if (rows === Infinity) refuse(`${operation} reads every matching record at once, so it reads no blob (${labels}): read them a page at a time with query, or one record's with get`)
    if (rows > fit) refuse(`${operation} reads up to ${rows} records, and ${fit} of them already hold ${BLOB_READ_BYTES} bytes of ${labels}: read at most ${fit} at a time`)
  }
}
