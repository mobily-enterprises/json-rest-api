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
 * @param {import('../storage/storage-types.js').ResourceConversionScope} scope
 * @param {import('../storage/storage-types.js').StorageRow} record
 * @param {string} scopeName
 * @returns {import('../../../../types/representations.js').JsonApiResource}
 */
/**
 * @overload
 * @param {import('../storage/storage-types.js').ResourceConversionScope} scope
 * @param {import('../storage/storage-types.js').StorageRow | null | undefined} record
 * @param {string} scopeName
 * @returns {import('../../../../types/representations.js').JsonApiResource | null}
 */
export const toJsonApiRecord = (scope, record, scopeName) => {
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
  const attributes = {}
  for (const [key, value] of Object.entries(allAttributes)) {
    if (!foreignKeys.has(key) && !internalFields.has(key) && key !== idProperty) {
      attributes[key] = value
    }
  }
  return { type: scopeName, id: String(id), attributes }
}

/**
 * Builds complete JSON:API response with data, relationships, links, and optional includes
 *
 * @async
 * @param {Object} scope - Scope containing schema and configuration
 * @param {Array<Object>} records - Primary records to include in response
 * @param {Array<Object>} included - Resources to include in 'included' array
 * @param {boolean} isSingle - Whether this is a single resource response
 * @param {string} scopeName - Resource type name
 * @param {Object} context - Request context with pagination metadata
 * @returns {Promise<Object>} Complete JSON:API response document
 */
export const buildJsonApiResponse = async (scope, records, included = [], isSingle = false, scopeName, context) => {
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
          const relationshipObject = { data }

          relationshipObject.links = {
            self: buildRelationshipUrl(context, scope, scopeName, resourceId, relName, true),
            related: buildRelationshipUrl(context, scope, scopeName, resourceId, relName, false)
          }

          jsonApiRecord.relationships[relName] = relationshipObject
        }
      }
    })

    return jsonApiRecord
  })

  const normalizedData = isSingle ? processedRecords[0] : processedRecords

  if (normalizedData) {
    if (Array.isArray(normalizedData)) {
      normalizedData.forEach(item => {
        if (!item.links) item.links = {}
        item.links.self = buildResourceUrl(context, scope, scopeName, item.id)
      })
    } else {
      if (!normalizedData.links) normalizedData.links = {}
      normalizedData.links.self = buildResourceUrl(context, scope, scopeName, normalizedData.id)
    }
  }

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
      self: isSingle
        ? buildJsonApiLink(buildResourceUrl(context, scope, scopeName, normalizedData.id), context.queryParams)
        : `${urlPrefix}/${scopeName}${context?.returnMeta?.queryString || ''}`
    }
  }

  return response
}
