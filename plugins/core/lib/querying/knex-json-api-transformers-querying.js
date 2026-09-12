// @ts-check
/** @import { JsonApiRelationship, JsonApiResource } from '../../../../types/representations.js' */
/** @import { DataDocument, DataOperationScope, DataReadContext, DataResource, DataStorageRow, ResourceConversionScope, StorageRow } from '../storage/storage-types.js' */
import { RELATIONSHIPS_KEY, RELATIONSHIP_METADATA_KEY, ROW_NUMBER_KEY, COMPUTED_DEPENDENCIES_KEY } from '../querying-writing/knex-constants.js'
import { getUrlPrefix, buildResourceUrl, buildRelationshipUrl, buildJsonApiLink } from './url-helpers.js'
import { translateRecordFromStorage } from '../storage/storage-mapping.js'
import { getPolymorphicLinkage } from '../querying-writing/relationship-contracts.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'

const internalFields = new Set([
  RELATIONSHIPS_KEY,
  RELATIONSHIP_METADATA_KEY,
  ROW_NUMBER_KEY,
  COMPUTED_DEPENDENCIES_KEY
])

/**
 * @overload
 * @param {ResourceConversionScope} scope
 * @param {StorageRow} record
 * @param {string} scopeName
 * @returns {JsonApiResource}
 */
/**
 * @overload
 * @param {ResourceConversionScope} scope
 * @param {StorageRow | null | undefined} record
 * @param {string} scopeName
 * @returns {JsonApiResource | null}
 */
/** @param {ResourceConversionScope} scope @param {StorageRow | null | undefined} record @param {string} scopeName @returns {JsonApiResource | null} */
export function toJsonApiRecord (scope, record, scopeName) {
  let foreignKeys
  try {
    foreignKeys = scope.vars.schemaInfo.foreignKeyFields
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to read relationship metadata for '${scopeName}'`,
      context: { scopeName, phase: 'relationshipMetadata' }
    })
  }

  const { idProperty = 'id' } = scope.vars.schemaInfo
  if (!record) return null

  const logicalRecord = translateRecordFromStorage(record, scope.vars.schemaInfo)
  const { id, ...allAttributes } = logicalRecord
  /** @type {StorageRow} */
  const attributes = {}
  for (const [key, value] of Object.entries(allAttributes)) {
    if (!foreignKeys.has(key) && !internalFields.has(key) && key !== idProperty) {
      attributes[key] = value
    }
  }
  return { type: scopeName, id: String(id), attributes }
}

/**
 * @overload
 * @param {DataOperationScope} scope
 * @param {DataStorageRow[]} records
 * @param {DataResource[]} included
 * @param {true} isSingle
 * @param {string} scopeName
 * @param {DataReadContext} context
 * @returns {Promise<DataDocument<DataResource>>}
 */
/**
 * @overload
 * @param {DataOperationScope} scope
 * @param {DataStorageRow[]} records
 * @param {DataResource[]} included
 * @param {false} isSingle
 * @param {string} scopeName
 * @param {DataReadContext} context
 * @returns {Promise<DataDocument<DataResource[]>>}
 */
/**
 * @param {DataOperationScope} scope
 * @param {DataStorageRow[]} records
 * @param {DataResource[]} included
 * @param {boolean} isSingle
 * @param {string} scopeName
 * @param {DataReadContext} context
 */
export async function buildJsonApiResponse (scope, records, included = [], isSingle = false, scopeName, context) {
  const { schemaInfo } = scope.vars

  const {
    schemaStructure,
    schemaRelationships: relationships
  } = schemaInfo

  const processedRecords = records.map(record => {
    const { [RELATIONSHIPS_KEY]: _relationships, ...cleanRecord } = record
    const logicalRecord = translateRecordFromStorage(cleanRecord, schemaInfo)
    const jsonApiRecord = toJsonApiRecord(scope, cleanRecord, scopeName)
    const resourceId = jsonApiRecord.id

    if (_relationships) {
      jsonApiRecord.relationships = _relationships
    }

    for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
      if (fieldDef.belongsTo && fieldDef.as && Object.hasOwn(logicalRecord, fieldName)) {
        jsonApiRecord.relationships = jsonApiRecord.relationships || {}
        if (!Object.hasOwn(jsonApiRecord.relationships, fieldDef.as)) {
          const value = logicalRecord[fieldName]
          jsonApiRecord.relationships[fieldDef.as] = {
            data: value === null || value === undefined
              ? null
              : { type: fieldDef.belongsTo, id: String(value) },
            links: {
              self: buildRelationshipUrl(context, scope, scopeName, resourceId, fieldDef.as, true),
              related: buildRelationshipUrl(context, scope, scopeName, resourceId, fieldDef.as, false)
            }
          }
        }
      }
    }

    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        const typeValue = logicalRecord[relDef.belongsToPolymorphic.typeField]
        const idValue = logicalRecord[relDef.belongsToPolymorphic.idField]
        const data = getPolymorphicLinkage({
          type: typeValue,
          id: idValue,
          types: relDef.belongsToPolymorphic.types,
          scopeName,
          relationshipName: relName
        })

        if (data || typeValue === null || idValue === null) {
          jsonApiRecord.relationships = jsonApiRecord.relationships || {}
          /** @type {JsonApiRelationship} */
          const relationshipObject = { data }

          relationshipObject.links = {
            self: buildRelationshipUrl(context, scope, scopeName, resourceId, relName, true),
            related: buildRelationshipUrl(context, scope, scopeName, resourceId, relName, false)
          }

          jsonApiRecord.relationships[relName] = relationshipObject
        }
      }
    })

    jsonApiRecord.links ||= {}
    jsonApiRecord.links.self = buildResourceUrl(context, scope, scopeName, resourceId)
    return jsonApiRecord
  })

  const singleRecord = processedRecords[0]
  if (isSingle && !singleRecord) throw new Error('A single-resource response requires a record')
  const normalizedData = isSingle && singleRecord ? singleRecord : processedRecords

  /** @type {DataDocument<DataResource | DataResource[]>} */
  const response = {
    data: normalizedData
  }

  if (included.length > 0 || context.queryParams?.include !== undefined) {
    included.forEach(item => {
      if (!item.links) item.links = {}
      item.links.self = buildResourceUrl(context, scope, item.type, item.id)
    })

    response.included = included
  }

  if (context?.returnMeta?.paginationMeta) {
    response.meta = {
      pagination: context.returnMeta.paginationMeta
    }
  }

  if (context?.returnMeta?.paginationLinks) {
    response.links = context.returnMeta.paginationLinks
  } else {
    const urlPrefix = getUrlPrefix(context, scope)
    response.links = {
      self: isSingle && singleRecord
        ? buildJsonApiLink(buildResourceUrl(context, scope, scopeName, singleRecord.id), context.queryParams)
        : `${urlPrefix}/${scopeName}${context?.returnMeta?.queryString || ''}`
    }
  }

  return response
}
