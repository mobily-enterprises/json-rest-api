/** Plain-record and JSON:API conversions at the resource boundary. */

import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'

const indexIncludedResources = (included, data) => {
  const byType = new Map()
  let primaryRecords = []
  if (Array.isArray(data)) {
    primaryRecords = data
  } else if (data) {
    primaryRecords = [data]
  }
  // Index primary records first so they win when included repeats an identity.
  for (const record of [...primaryRecords, ...(included || [])]) {
    const { type, id } = record
    if (!byType.has(type)) byType.set(type, new Map())
    const byId = byType.get(type)
    if (!byId.has(id)) byId.set(id, record)
  }
  return byType
}

/**
 * Convert plain input to a JSON:API document without mutating the input.
 * Relationship aliases become linkage; remaining keys become attributes.
 * A plain field named data is ordinary input, not automatic format detection.
 * Physical belongsTo keys are rejected in favor of relationship aliases.
 *
 * @param {Object} scope
 * @param {Object} scope.inputRecord - Plain input record
 * @param {Object} deps
 * @param {Object} deps.context
 * @param {string} deps.context.scopeName - Resource type
 * @param {Object} deps.context.schemaStructure - Compiled writable fields
 * @param {Object} [deps.context.schemaRelationships] - Relationship definitions
 * @returns {Object} JSON:API document for subsequent validation
 * @example
 * transformSimplifiedToJsonApi({ inputRecord: { id: '7', title: 'Book' } }, {
 *   context: { scopeName: 'books', schemaStructure: {}, schemaRelationships: {} }
 * }) // { data: { type: 'books', id: '7', attributes: { title: 'Book' } } }
 */
export const transformSimplifiedToJsonApi = (scope, deps) => {
  const input = scope.inputRecord
  const scopeName = deps.context.scopeName
  const schema = deps.context.schemaStructure
  const relationships = deps.context.schemaRelationships

  const relationshipsData = {}
  const tempInput = { ...input }

  const id = tempInput.id
  delete tempInput.id

  // Relationship input uses aliases; physical foreign keys are rejected.
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldDef.belongsTo) {
      const relName = fieldDef.as || fieldName

      if (tempInput[fieldName] !== undefined) {
        throw new RestApiValidationError(
          `Foreign key field '${fieldName}' is no longer supported for relationship input. ` +
          `Use the relationship name '${relName}' instead.`,
          {
            fields: [fieldName],
            violations: [{
              field: fieldName,
              rule: 'deprecated_foreign_key',
              message: 'Use relationship name instead of foreign key field'
            }]
          }
        )
      }

      const value = tempInput[relName]
      if (value !== undefined) {
        delete tempInput[relName]
        relationshipsData[relName] = {
          data: value === null ? null : { type: fieldDef.belongsTo, id: value }
        }
      }
    }
  }

  // 2. Process hasMany/manyToMany relationships (from relationships object)
  // Iterate through the relationships config to find hasMany/manyToMany
  for (const [relName, relConfig] of Object.entries(relationships || {})) {
    // Check if the user provided data for this relationship name
    if (tempInput[relName] !== undefined) {
      const value = tempInput[relName]
      delete tempInput[relName] // Remove from tempInput once processed

      if ((relConfig.type === 'hasMany' || relConfig.type === 'manyToMany') && Array.isArray(value)) {
        // Determine the target type based on relationship type:
        // - For manyToMany: the targetType is the relationship name itself
        // - For hasMany/hasOne: the targetType is specified in the target property
        const targetType = relConfig.type === 'manyToMany' ? relName : relConfig.target
        relationshipsData[relName] = {
          data: value.map(relId => ({ type: targetType, id: relId }))
        }
      } else if (relConfig.type === 'hasOne' && value !== undefined) {
        relationshipsData[relName] = {
          data: value === null ? null : { type: relConfig.target, id: value }
        }
      } else if (relConfig.belongsTo && value !== undefined) {
        relationshipsData[relName] = {
          data: value === null ? null : { type: relConfig.belongsTo, id: value }
        }
      } else if (relConfig.belongsToPolymorphic && value !== undefined) {
        if (value === null) {
          relationshipsData[relName] = { data: null }
        } else if (typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'id') && value._type) {
          relationshipsData[relName] = {
            data: { type: value._type, id: value.id }
          }
        } else {
          throw new RestApiValidationError(
            `Invalid format for polymorphic relationship '${relName}'. Expected { id: 'value', _type: 'type' } or null`,
            {
              fields: [relName],
              violations: [{
                field: relName,
                rule: 'polymorphic_format',
                message: 'Must be an object with id and _type properties, or null'
              }]
            }
          )
        }
      }
    }
  }

  // 3. Any remaining fields in tempInput are attributes
  const attributes = tempInput

  return {
    data: {
      type: scopeName,
      ...(id !== undefined && { id }),
      ...(Object.keys(attributes).length > 0 && { attributes }),
      ...(Object.keys(relationshipsData).length > 0 && { relationships: relationshipsData })
    }
  }
}

/**
 * Flatten a JSON:API response using one resource index for the whole document.
 * Collections retain their data wrapper, meta and links; single resources
 * return the plain record directly. Missing/null data passes through unchanged.
 * Relationship output uses alias-named objects, not physical foreign-key fields.
 *
 * @param {Object} scope
 * @param {Object} scope.record - JSON:API response document
 * @param {Object} deps
 * @param {Object} deps.context
 * @param {Object} [deps.context.schemaStructure] - Compiled resource fields
 * @param {Object} [deps.context.schemaRelationships] - Relationship definitions
 * @param {Object} deps.context.scopes - Resource registry for included records
 * @returns {Object} Plain record or collection envelope
 * @example
 * transformJsonApiToSimplified({ record: {
 *   data: { type: 'books', id: '7', attributes: { title: 'Book' },
 *     relationships: { author: { data: { type: 'authors', id: '2' } } } }
 * } }, { context: {} }) // { id: '7', title: 'Book', author: { id: '2' } }
 */
export const transformJsonApiToSimplified = (scope, deps) => {
  const jsonApi = scope.record
  const schema = deps.context.schemaStructure
  const relationships = deps.context.schemaRelationships
  const scopes = deps.context.scopes

  if (!jsonApi?.data) return jsonApi
  const includedByType = indexIncludedResources(jsonApi.included, jsonApi.data)

  // Handle array response (QUERY)
  if (Array.isArray(jsonApi.data)) {
    const simplifiedData = jsonApi.data.map(item =>
      transformSingleJsonApiToSimplified(
        { data: item, includedByType },
        { context: { schemaStructure: schema, schemaRelationships: relationships, scopes } }
      )
    )

    // For query results, return object with data, meta, and links
    const result = { data: simplifiedData }

    // Add meta if present
    if (jsonApi.meta) {
      result.meta = jsonApi.meta
    }

    // Add links if present
    if (jsonApi.links) {
      result.links = jsonApi.links
    }

    return result
  }

  // Handle single response (no change for single resources)
  return transformSingleJsonApiToSimplified(
    { data: jsonApi.data, includedByType },
    { context: { schemaStructure: schema, schemaRelationships: relationships, scopes } }
  )
}

/**
 * Flatten one resource and expand linkage found in the shared document index.
 * Absent to-one linkage is omitted. Unexpanded references retain their ID;
 * polymorphic references also retain _type. Cycle detection is path-local so
 * repeated siblings expand independently while back-references stay minimal.
 *
 * @param {Object} scope
 * @param {Object} scope.data - JSON:API resource
 * @param {Array<Object>} [scope.included] - Used when no shared index is supplied
 * @param {Map} [scope.includedByType] - Shared type/ID lookup
 * @param {Object} deps
 * @param {Object} deps.context
 * @param {Object} [deps.context.schemaRelationships] - Relationship definitions
 * @param {Object} deps.context.scopes - Registry for nested resource metadata
 * @param {Set<string>} [ancestors] - Resource identities on the current path
 * @returns {Object} Plain record with minimal or expanded relationship objects
 */
export const transformSingleJsonApiToSimplified = (scope, deps, ancestors = new Set()) => {
  const { data, includedByType = indexIncludedResources(scope.included, scope.data) } = scope
  const relationships = deps.context.schemaRelationships || {}
  const scopes = deps.context.scopes
  const identity = JSON.stringify([data.type, data.id])
  const path = new Set(ancestors)
  path.add(identity)

  const simplified = { ...(data.id != null ? { id: data.id } : {}), ...data.attributes }
  for (const [name, relationship] of Object.entries(data.relationships || {})) {
    if (relationship?.data == null) continue
    const polymorphic = relationships[name]?.belongsToPolymorphic
    const convert = reference => {
      const minimal = { id: reference.id, ...(polymorphic ? { _type: reference.type } : {}) }
      // Expand repeated siblings independently; stop only cycles on this path.
      if (path.has(JSON.stringify([reference.type, reference.id]))) return minimal
      const target = includedByType.get(reference.type)?.get(reference.id)
      if (!target) return minimal
      const schemaInfo = scopes?.[target.type]?.vars?.schemaInfo
      const nested = transformSingleJsonApiToSimplified({ data: target, includedByType }, {
        context: { schemaStructure: schemaInfo?.schemaStructure, schemaRelationships: schemaInfo?.schemaRelationships, scopes }
      }, path)
      if (polymorphic) nested._type = reference.type
      return nested
    }
    simplified[name] = Array.isArray(relationship.data) ? relationship.data.map(convert) : convert(relationship.data)
  }
  return simplified
}
