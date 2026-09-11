// @ts-check
/** @import { ResourceConversionScope, StorageRow } from '../storage/storage-types.js' */
/** @import { JsonApiResource, JsonApiRelationship } from '../../../../types/representations.js' */
import { toJsonApiRecord } from '../querying/knex-json-api-transformers-querying.js'
import { translateRecordFromStorage } from '../storage/storage-mapping.js'
import { getPolymorphicLinkage } from './relationship-contracts.js'

/**
 * Convert one storage row and its belongs-to linkage without loading targets.
 * Empty foreign keys become null linkage; backing fields stay out of attributes.
 * @param {ResourceConversionScope} scope
 * @param {StorageRow | null | undefined} record
 * @param {string} scopeName
 * @returns {JsonApiResource | null}
 */
export const toJsonApiRecordWithBelongsTo = (scope, record, scopeName) => {
  if (!record) return null

  const schemaInfo = scope.vars.schemaInfo
  const logicalRecord = translateRecordFromStorage(record, schemaInfo)

  // Get the basic JSON:API structure (without relationships)
  const jsonApiRecord = toJsonApiRecord(scope, record, scopeName)

  // Extract schema info from scope
  const {
    schemaStructure,
    schemaRelationships: relationships
  } = schemaInfo

  // Initialize relationships object
  /** @type {Record<string, JsonApiRelationship>} */
  const relationshipData = jsonApiRecord.relationships = {}

  // Process regular belongsTo relationships from schema
  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (fieldDef.belongsTo && fieldDef.as) {
      const fieldValue = logicalRecord[fieldName]

      relationshipData[fieldDef.as] = {
        data: fieldValue === null || fieldValue === undefined
          ? null
          : { type: fieldDef.belongsTo, id: String(fieldValue) }
      }
    }
  }

  // Process polymorphic belongsTo relationships
  Object.entries(relationships || {}).forEach(([relName, relDef]) => {
    if (relDef.belongsToPolymorphic) {
      const typeValue = logicalRecord[relDef.belongsToPolymorphic.typeField]
      const idValue = logicalRecord[relDef.belongsToPolymorphic.idField]

      relationshipData[relName] = {
        data: getPolymorphicLinkage({
          type: typeValue,
          id: idValue,
          types: relDef.belongsToPolymorphic.types,
          scopeName,
          relationshipName: relName
        })
      }
    }
  })

  // Remove relationships object if empty
  if (Object.keys(jsonApiRecord.relationships).length === 0) {
    delete jsonApiRecord.relationships
  }

  return jsonApiRecord
}
