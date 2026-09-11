// @ts-check
/** @import { StorageFieldDefinition } from '../storage/storage-types.js' */
/** @import { JsonApiDocument } from '../../../../types/representations.js' */
/** @typedef {string | readonly string[] | null | undefined} Fieldset */
/** @typedef {Record<string, Fieldset>} Fieldsets */
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { SERIALIZATION_CAPABILITIES } from './database-capabilities.js'

/** @param {string} name @param {string} location */
export function assertFieldName (name, location) {
  if (name === '__proto__') {
    throw new Error(`Invalid ${location}: '__proto__' cannot be a field, filter or relationship name. Choose another name.`)
  }
}

/** @param {unknown} declarations @param {string} location */
export function assertFieldNameMap (declarations, location) {
  if (declarations == null) return
  const prototype = typeof declarations === 'object' ? Object.getPrototypeOf(declarations) : undefined
  if (typeof declarations !== 'object' || Array.isArray(declarations) || (prototype !== null && prototype !== Object.prototype)) {
    throw new Error(`Invalid ${location}: Expected an object with own field declarations and a plain or null prototype.`)
  }
  for (const name of Object.keys(declarations)) assertFieldName(name, location)
}

/** @param {StorageFieldDefinition | null | undefined} definition @param {string} fieldName @param {string} operation */
export function assertScalarQueryField (definition, fieldName, operation) {
  const type = definition?.type
  if (type === undefined || !SERIALIZATION_CAPABILITIES.structuredTypes.includes(type)) return
  const parameter = operation === 'sort' ? 'sort' : `filters.${fieldName}`
  const message = `Field '${fieldName}' has type '${type}' and cannot be used in whole-document ${operation} operations. Use a scalar field or projection for sorting, or a custom applyFilter function for JSON queries.`
  throw new RestApiValidationError(message, {
    fields: [parameter],
    violations: [{ field: parameter, rule: 'structured_query', message }]
  })
}

/**
 * Collect logical relationship backing fields from an explicit field map.
 * @param {Record<string, StorageFieldDefinition> | null | undefined} schemaStructure - Compiled field definitions, not a Schema wrapper.
 * @param {Record<string, { belongsToPolymorphic?: { typeField: string, idField: string } }>} [relationships] - Includes polymorphic backing fields.
 * @returns {Set<string>}
 */
export const getForeignKeyFields = (schemaStructure, relationships = {}) => {
  /** @type {Set<string>} */
  const foreignKeys = new Set()
  if (!schemaStructure) return foreignKeys

  Object.entries(schemaStructure).forEach(([field, def]) => {
    if (def.belongsTo) {
      foreignKeys.add(field)
    }
  })
  for (const definition of Object.values(relationships)) {
    if (definition.belongsToPolymorphic) {
      foreignKeys.add(definition.belongsToPolymorphic.typeField)
      foreignKeys.add(definition.belongsToPolymorphic.idField)
    }
  }
  return foreignKeys
}

/** @param {Fieldset} requestedFields */
export const parseFieldset = requestedFields => requestedFields == null
  ? null
  : typeof requestedFields === 'string'
    ? requestedFields.split(',').map(field => field.trim()).filter(Boolean)
    : requestedFields

/** @param {Fieldsets | null | undefined} fieldsets @param {string} resourceType */
export const getResourceFieldset = (fieldsets, resourceType) => fieldsets && Object.hasOwn(fieldsets, resourceType)
  ? fieldsets[resourceType]
  : undefined

/**
 * @overload
 * @param {JsonApiDocument | null | undefined} record
 * @param {Fieldsets} [fieldsets]
 * @param {{ simplified?: false, resourceType?: string }} [options]
 * @returns {void}
 */
/**
 * @overload
 * @param {Record<string, unknown> | null | undefined} record
 * @param {Fieldsets | undefined} fieldsets
 * @param {{ simplified: true, resourceType: string }} options
 * @returns {void}
 */
/**
 * @param {JsonApiDocument | Record<string, unknown> | null | undefined} record
 * @param {Fieldsets} [fieldsets]
 * @param {{ simplified?: boolean, resourceType?: string }} [options]
 */
export const filterResponseFields = (record, fieldsets = {}, { simplified = false, resourceType } = {}) => {
  if (simplified) {
    const fields = parseFieldset(getResourceFieldset(fieldsets, /** @type {string} */ (resourceType)))
    if (fields === null || !record || typeof record !== 'object') return
    const allowed = new Set(['id', '_type', ...fields])
    for (const name of Object.keys(record)) if (!allowed.has(name)) delete /** @type {Record<string, unknown>} */ (record)[name]
    return
  }
  const selections = new Map(Object.entries(fieldsets).map(([type, fields]) => [type, new Set(parseFieldset(fields))]))
  // The overload ties the representation to the corresponding record shape.
  const document = /** @type {JsonApiDocument | null | undefined} */ (record)
  const primary = Array.isArray(document?.data) ? document.data : [document?.data]
  for (const resource of [...primary, ...(document?.included || [])]) {
    if (!resource) continue
    const allowed = selections.get(resource.type)
    if (!allowed) continue
    // Selection inspects keys and passes member values through unchanged.
    /** @type {Partial<Record<'attributes' | 'relationships', Record<string, unknown>>>} */
    const members = resource
    for (const member of /** @type {const} */ (['attributes', 'relationships'])) {
      if (!members[member]) continue
      members[member] = Object.fromEntries(Object.entries(members[member]).filter(([name]) => allowed.has(name)))
    }
  }
}

/**
 * Filters hidden fields from attributes based on schema rules.
 *
 * This pure function removes fields marked as hidden or normallyHidden
 * based on the schema definition and requested fields. It ensures that
 * sensitive data is never exposed in API responses.
 *
 * @param {Record<string, unknown>} attributes - The attributes object to filter
 * @param {{ structure?: Record<string, StorageFieldDefinition> }} schema - The schema object with structure property
 * @param {Fieldset} requestedFields - Fields explicitly requested (for normallyHidden)
 * @returns {Record<string, unknown>} Filtered attributes object
 */
export const filterHiddenFields = (attributes, schema, requestedFields) => {
  /** @type {Record<string, unknown>} */
  const filtered = {}

  // Parse requested fields if it's a string (from query params)
  // Example: "name,price,cost" -> ['name', 'price', 'cost']
  const requested = parseFieldset(requestedFields)

  Object.entries(attributes).forEach(([field, value]) => {
    const fieldDef = schema.structure?.[field]

    // Never include hidden fields - these are completely invisible
    // Example: password_hash with hidden:true is always filtered out
    if (fieldDef?.hidden === true) return

    // Include normallyHidden fields only if explicitly requested
    // Example: 'cost' with normallyHidden:true is only included if user requests it
    // via sparse fieldsets like ?fields[products]=name,cost
    if (fieldDef?.normallyHidden === true) {
      if (!requested || !requested.includes(field)) {
        return // Filter out normallyHidden field
      }
    }

    filtered[field] = value
  })

  return filtered
}
