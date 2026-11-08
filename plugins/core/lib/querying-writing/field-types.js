import { addType } from 'json-rest-schema'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const TEXT_SEARCH_OPERATORS = new Set(['like', 'contains', 'startswith', 'endswith'])

// Partial-match filters search fragments of a value, not whole values.
const isTextSearch = definition => TEXT_SEARCH_OPERATORS.has(String(definition?.filterOperator).toLowerCase())

const formattedStringType = (pattern, format) => {
  const type = (context) => {
    if (typeof context.value !== 'string') context.throwTypeError()
    const value = context.definition.noTrim ? context.value : context.value.trim()
    if (!isTextSearch(context.definition) && !pattern.test(value)) context.throwTypeError()
    return value
  }
  type.toJsonSchema = ({ definition }) => isTextSearch(definition) ? { type: 'string' } : { type: 'string', format, pattern: pattern.source }
  return type
}

const XID8_PATTERN = /^[0-9]{1,20}$/
const XID8_LIMIT = 2n ** 64n

/**
 * PostgreSQL's 64-bit transaction id (xid8) as canonical decimal text, without
 * leading zeros, from 1 to 20 digits below 2^64 or a bigint; undefined for
 * anything else.
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function xid8Text (value) {
  const text = typeof value === 'bigint' ? value.toString() : value
  if (typeof text !== 'string' || !XID8_PATTERN.test(text)) return undefined
  const number = BigInt(text)
  return number < XID8_LIMIT ? number.toString() : undefined
}

/** @param {any} context */
const xid8Type = (context) => {
  const text = xid8Text(context.value)
  if (text === undefined) context.throwTypeError()
  return text
}
xid8Type.toJsonSchema = () => ({ type: 'string', format: 'xid8', pattern: XID8_PATTERN.source })

let installed = false

/**
 * Register the types json-rest-schema lacks: email and uuid, which every
 * storage keeps in string columns, and xid8, PostgreSQL's transaction id.
 */
export function installFieldTypes () {
  if (installed) return
  installed = true
  addType('email', formattedStringType(EMAIL_PATTERN, 'email'))
  addType('uuid', formattedStringType(UUID_PATTERN, 'uuid'))
  addType('xid8', xid8Type)
}

/**
 * Refuse xid8 fields, and search fields on them, except on Knex storage on
 * PostgreSQL: other databases have no such type, and a text column would
 * compare the values as text. Text search on them is refused everywhere.
 * @param {{ schemaStructure?: Record<string, any>, searchSchemaStructure?: Record<string, any> }} schemaInfo
 * @param {string} scopeName
 * @param {boolean} postgres Knex storage on PostgreSQL
 */
export function assertXid8Fields (schemaInfo, scopeName, postgres) {
  const fields = schemaInfo.schemaStructure || {}
  for (const [name, definition] of [...Object.entries(fields), ...Object.entries(schemaInfo.searchSchemaStructure || {})]) {
    const target = definition?.actualField ? fields[definition.actualField] : undefined
    if (definition?.type !== 'xid8' && target?.type !== 'xid8') continue
    if (!postgres) {
      throw new Error(`Field '${name}' in resource '${scopeName}' has type 'xid8', PostgreSQL's transaction id, which only Knex storage on PostgreSQL has`)
    }
    if (isTextSearch(definition)) {
      throw new Error(`Search field '${name}' in resource '${scopeName}' searches text in an xid8 field; use =, !=, <, <=, >, >=, between or in`)
    }
  }
}

/**
 * Reject field types no casting function exists for, at registration rather than on the first write.
 * @param {{ structure: Record<string, any>, types: Record<string, unknown> }} schema
 * @param {string} label
 */
export function assertKnownFieldTypes (schema, label) {
  for (const [fieldName, definition] of Object.entries(schema.structure)) {
    const type = definition?.type
    if (typeof type === 'string' && !Object.hasOwn(schema.types, type)) {
      throw new Error(`Field '${fieldName}' in ${label} has unknown type '${type}'`)
    }
  }
}
