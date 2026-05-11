import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'

export function getRelationshipCardinality (relDef) {
  if (!relDef) return null

  if (
    relDef.belongsTo ||
    relDef.belongsToPolymorphic ||
    relDef.type === 'hasOne'
  ) {
    return 'one'
  }

  if (relDef.type === 'hasMany' || relDef.type === 'manyToMany') {
    return 'many'
  }

  return null
}

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
