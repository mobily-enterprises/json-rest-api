// @ts-check
/** @import { StorageFieldDefinition } from '../storage/storage-types.js' */
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'
import { RELATIONSHIP_CAPABILITIES } from './database-capabilities.js'

/** @param {{ type: unknown, id: unknown, types?: readonly string[] | null, scopeName?: string, relationshipName: string }} options */
export function getPolymorphicLinkage ({ type, id, types, scopeName, relationshipName }) {
  if (type == null || id == null) return null
  if (typeof type !== 'string' || !Array.isArray(types) || !types.includes(type)) {
    throw wrapUnexpectedError(new Error(`Undeclared target type '${type}'`), {
      message: `Invalid stored relationship '${scopeName}.${relationshipName}'`,
      context: { scopeName, relationshipName, phase: 'relationshipData' }
    })
  }
  return { type, id: String(id) }
}

/**
 * @template {StorageFieldDefinition} Definition
 * @param {{ outputRelationships?: Record<string, Definition> }} schemaInfo
 * @param {string} relationshipName
 */
export const findRelationshipDefinition = (schemaInfo, relationshipName) => {
  const relationships = schemaInfo.outputRelationships || {}
  return Object.hasOwn(relationships, relationshipName) ? relationships[relationshipName] || null : null
}

/** @param {StorageFieldDefinition | null} [relDef] */
export function getRelationshipCardinality (relDef) {
  if (!relDef) return null

  if (RELATIONSHIP_CAPABILITIES.attributeKinds.some(kind => relDef[kind])) return 'one'
  const cardinalities = RELATIONSHIP_CAPABILITIES.declaredCardinalities
  return typeof relDef.type === 'string' && Object.hasOwn(cardinalities, relDef.type)
    ? cardinalities[/** @type {keyof typeof cardinalities} */ (relDef.type)]
    : null
}

/** @param {{ relationshipName: string, relDef?: StorageFieldDefinition | null, data: unknown, fieldPath?: string }} options */
export function validateRelationshipDataCardinality ({
  relationshipName,
  relDef,
  data,
  fieldPath = `data.relationships.${relationshipName}.data`
}) {
  const cardinality = getRelationshipCardinality(relDef)

  if (cardinality === 'one' && Array.isArray(data)) {
    throw new RestApiValidationError(
      `Relationship '${relationshipName}' expects a single resource identifier or null`,
      {
        fields: [fieldPath],
        violations: [{
          field: fieldPath,
          rule: 'relationship_cardinality',
          message: 'Expected a single resource identifier or null'
        }]
      }
    )
  }

  if (cardinality === 'many' && !Array.isArray(data)) {
    throw new RestApiValidationError(
      `Relationship '${relationshipName}' expects an array of resource identifiers`,
      {
        fields: [fieldPath],
        violations: [{
          field: fieldPath,
          rule: 'relationship_cardinality',
          message: 'Expected an array of resource identifiers'
        }]
      }
    )
  }
}
