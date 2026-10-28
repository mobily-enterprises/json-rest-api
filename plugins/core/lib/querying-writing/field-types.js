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

let installed = false

/** Register the string types json-rest-schema lacks; both storages keep them in string columns. */
export function installFieldTypes () {
  if (installed) return
  installed = true
  addType('email', formattedStringType(EMAIL_PATTERN, 'email'))
  addType('uuid', formattedStringType(UUID_PATTERN, 'uuid'))
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
