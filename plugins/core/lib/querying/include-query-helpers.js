import { whereInIdentifiers } from './identifier-query.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from '../querying-writing/knex-field-helpers.js'
import { applyIncludeQueryConfig } from './knex-window-queries.js'
import { buildEffectiveSortList } from './query-field-sort-helpers.js'
import { unwrapQueryBuilderState } from './query-builder-utils.js'
import { RELATIONSHIP_METADATA_KEY, RELATIONSHIP_READ_BATCH_SIZE } from '../querying-writing/knex-constants.js'
import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'
import { getPolymorphicLinkage } from '../querying-writing/relationship-contracts.js'
import {
  getFieldValue as getStorageFieldValue,
  getIdColumn as getStorageIdColumn,
  getStorageColumn as getMappedStorageColumn,
} from '../storage/storage-mapping.js'
import { createStorageAdapter } from '../storage/storage-adapter.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'

const getScopeStorageAdapter = (scopes, scopeName) => scopes[scopeName]?.vars?.storageAdapter || null

export const loadIncludedParentMap = async ({ query, parentIds, childIds, knex }) => {
  const parents = [...new Set(parentIds)]
  const children = [...new Set(childIds)]
  const result = new Map()
  if (!parents.length || !children.length) return result
  const identity = name => databaseIdentityExpression(knex, `included_pairs.${name}`)
  for (let childOffset = 0; childOffset < children.length; childOffset += RELATIONSHIP_READ_BATCH_SIZE) {
    const pairs = knex.from(query.clone().as('included_links')).distinct('parentId', 'childId')
      .modify(whereInIdentifiers, 'parentId', parents)
      .whereIn('childId', children.slice(childOffset, childOffset + RELATIONSHIP_READ_BATCH_SIZE))
    let after
    while (true) {
      const read = knex.from(pairs.clone().as('included_pairs')).select({ parentId: identity('parentId'), childId: identity('childId') })
        .orderBy('included_pairs.parentId').orderBy('included_pairs.childId').limit(RELATIONSHIP_READ_BATCH_SIZE + 1)
      if (after) read.where(next => next.where('included_pairs.parentId', '>', after.parentId).orWhere(tie => tie.where('included_pairs.parentId', after.parentId).where('included_pairs.childId', '>', after.childId)))
      const rows = await applyDatabaseReadOptions(read)
      for (const { parentId, childId } of rows) {
        const parent = String(parentId)
        const child = String(childId)
        if (!result.has(child)) result.set(child, new Set())
        result.get(child).add(parent)
      }
      if (rows.length <= RELATIONSHIP_READ_BATCH_SIZE) break
      after = rows.at(-1)
    }
  }
  return result
}

export const resolveScopeStorageAdapter = (scopes, scopeName, knex) => {
  const configuredAdapter = getScopeStorageAdapter(scopes, scopeName)
  if (configuredAdapter) return configuredAdapter

  const schemaInfo = scopes[scopeName]?.vars?.schemaInfo
  if (!schemaInfo) return null

  return createStorageAdapter({ knex, schemaInfo })
}

export const getIdColumnForScope = (scopes, scopeName) => {
  const adapter = getScopeStorageAdapter(scopes, scopeName)
  if (adapter?.getIdColumn) {
    return adapter.getIdColumn()
  }

  return getStorageIdColumn(scopes[scopeName]?.vars?.schemaInfo || {})
}

export const getFieldValueForScope = (scopes, scopeName, record, fieldName) => {
  const adapter = getScopeStorageAdapter(scopes, scopeName)
  if (adapter?.getFieldValue) {
    return adapter.getFieldValue(record, fieldName)
  }

  return getStorageFieldValue(record, scopes[scopeName]?.vars?.schemaInfo || {}, fieldName)
}

export const translateColumnForScope = (scopes, scopeName, fieldName) => {
  const adapter = getScopeStorageAdapter(scopes, scopeName)
  if (adapter?.translateColumn) {
    return adapter.translateColumn(fieldName)
  }

  return getMappedStorageColumn(scopes[scopeName]?.vars?.schemaInfo || {}, fieldName)
}

export const prepareCollectionInclude = async ({ query, targetScope, parentColumn, includeConfig, fields }, { scopes, knex, requestContext, capabilities }) => {
  const target = scopes[targetScope]
  const tableName = target.vars.schemaInfo.tableName
  const storageAdapter = resolveScopeStorageAdapter(scopes, targetScope, knex)
  const context = {
    ...(requestContext || {}),
    scopeName: targetScope,
    schemaInfo: target.vars.schemaInfo,
    storageAdapter,
    queryParams: { fields, sort: buildEffectiveSortList(includeConfig?.orderBy, { defaultSort: target.vars.defaultSort }) }
  }
  const fieldSelectionInfo = await buildFieldSelection(target, { context })
  const selection = await applyFieldSelectionToQuery({
    query,
    scope: target,
    fieldSelectionInfo,
    tableName,
    useTablePrefix: true,
    storageAdapter,
    db: knex,
    context,
    scopeName: targetScope
  })
  const filtered = await applyScopeFiltersToIncludeQuery({
    query: selection.query, scopes, scopeName: targetScope, requestContext, db: knex, tableName
  })
  const limited = await applyIncludeQueryConfig({
    query: filtered.query,
    scopeName: targetScope,
    tableName,
    parentColumn,
    includeConfig,
    context,
    capabilities,
    queryFieldRuntimeByField: selection.queryFieldRuntimeByField
  }, { scopes, knex, getStorageAdapter: name => resolveScopeStorageAdapter(scopes, name, knex) })
  return { ...limited, fieldSelectionInfo }
}

export const buildRelationshipLinks = (scopes, scopeName, record, relationshipName) => {
  const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || ''
  const recordId = getFieldValueForScope(scopes, scopeName, record, 'id')

  return {
    self: `${urlPrefix}/${scopeName}/${recordId}/relationships/${relationshipName}`,
    related: `${urlPrefix}/${scopeName}/${recordId}/${relationshipName}`
  }
}

const buildScopedIncludeContext = ({ requestContext, scopeName, scopeObject, storageAdapter }) => {
  const queryParams = requestContext?.queryParams
    ? { ...requestContext.queryParams }
    : {}

  if ('filters' in queryParams) {
    delete queryParams.filters
  }

  return {
    ...(requestContext || {}),
    scopeName,
    schemaInfo: scopeObject.vars.schemaInfo,
    storageAdapter,
    queryParams
  }
}

export const applyScopeFiltersToIncludeQuery = async ({
  query,
  scopes,
  scopeName,
  requestContext,
  db,
  tableName,
  queryPurpose = 'include'
}) => {
  const scopeObject = scopes[scopeName]
  if (!scopeObject?.applyQueryFilters) {
    return { query }
  }

  const storageAdapter = resolveScopeStorageAdapter(scopes, scopeName, db)

  const queryState = await scopeObject.applyQueryFilters({
    query,
    filters: undefined,
    scopeName,
    tableName: tableName || scopeObject.vars.schemaInfo.tableName,
    db,
    schemaInfo: scopeObject.vars.schemaInfo,
    queryPurpose,
    isAnyApi: storageAdapter?.isCanonical() || false,
    storageAdapter
  }, buildScopedIncludeContext({
    requestContext,
    scopeName,
    scopeObject,
    storageAdapter
  }))

  return {
    query: applyDatabaseReadOptions(unwrapQueryBuilderState(queryState, query))
  }
}

export const filterVisibleIdentifiers = async ({ identifiers, scopes, knex, context }) => {
  const idsByType = new Map()
  for (const { type, id } of identifiers) {
    if (!idsByType.has(type)) idsByType.set(type, new Set())
    idsByType.get(type).add(String(id))
  }

  const visible = new Map()
  for (const [type, ids] of idsByType) {
    const adapter = Object.hasOwn(scopes, type) && resolveScopeStorageAdapter(scopes, type, knex)
    if (!adapter) throw new RestApiResourceError(`Related resource '${type}' not found`, { subtype: 'related_type_not_found' })
    const tableName = adapter.getTableName()
    const idColumn = adapter.getIdColumn()
    const column = `${tableName}.${idColumn}`
    const visibleIds = new Set()
    visible.set(type, visibleIds)
    const loadBatch = async values => {
      const query = adapter.buildBaseQuery({ transaction: context.transaction })
        .whereIn(column, values)
        .distinct({ [idColumn]: adapter.isCanonical() ? column : databaseIdentityExpression(knex, column) })
      const state = await applyScopeFiltersToIncludeQuery({
        query,
        scopes,
        scopeName: type,
        requestContext: context,
        db: context.db || knex,
        tableName,
        queryPurpose: 'relationship-identifiers'
      })
      for (const row of await state.query) visibleIds.add(String(row[idColumn]))
    }
    let values = []
    for (const id of ids) {
      values.push(adapter.translateFilterValue('id', id))
      if (values.length === RELATIONSHIP_READ_BATCH_SIZE) {
        await loadBatch(values)
        values = []
      }
    }
    if (values.length) await loadBatch(values)
  }
  return identifiers.filter(({ type, id }) => visible.get(type)?.has(String(id)))
}

/**
 * Groups records by their polymorphic type for efficient batch loading
 *
 * @param {Array<Object>} records - Records containing polymorphic fields
 * @param {string} typeField - Name of the type field (e.g., 'commentable_type')
 * @param {string} idField - Name of the ID field (e.g., 'commentable_id')
 * @returns {Object<string, Array<number|string>>} Map of type to array of unique IDs
 */
export const groupByPolymorphicType = (records, typeField, idField, getFieldValue = (record, fieldName) => record[fieldName]) => {
  const grouped = {}
  const seenByType = Object.create(null)

  records.forEach(record => {
    const type = getFieldValue(record, typeField)
    const id = getFieldValue(record, idField)

    // Skip if either type or id is missing
    if (!type || id === null || id === undefined) return

    if (!Object.hasOwn(grouped, type)) {
      Object.defineProperty(grouped, type, { value: [], enumerable: true, writable: true, configurable: true })
      seenByType[type] = new Set()
    }

    // Only add unique IDs
    if (!seenByType[type].has(id)) {
      seenByType[type].add(id)
      grouped[type].push(id)
    }
  })

  return grouped
}

/**
 * Parses the include parameter string into a tree structure
 *
 * @param {string|Array<string>} includeParam - The include parameter value
 * @returns {Object} Nested object representing the include tree
 */
export const parseIncludeTree = (includeParam) => {
  if (!includeParam) return {}

  // Handle array input (already split)
  const includes = Array.isArray(includeParam)
    ? includeParam
    : includeParam.split(',').map(s => s.trim()).filter(Boolean)

  const tree = {}

  includes.forEach(include => {
    const parts = include.split('.')
    let current = tree

    parts.forEach(part => {
      if (!Object.hasOwn(current, part)) {
        Object.defineProperty(current, part, { value: {}, enumerable: true, writable: true, configurable: true })
      }
      current = current[part]
    })
  })

  return tree
}

/**
 * Loads relationship metadata for included resources
 * This ensures included resources have complete JSON:API representation
 *
 * @param {Object} scopes - The resources object
 * @param {Array<Object>} records - Records to add relationships to
 * @param {string} scopeName - The scope/resource type name
 */
export const loadRelationshipMetadata = async (scopes, records, scopeName) => {
  try {
    // Get schema information
    const schemaInfo = scopes[scopeName]?.vars?.schemaInfo
    if (!schemaInfo) throw new Error(`Missing relationship schema for scope '${scopeName}'`)

    const schema = schemaInfo.schemaStructure
    const relationships = schemaInfo.schemaRelationships || {}

    // Process each record
    records.forEach(record => {
      record[RELATIONSHIP_METADATA_KEY] = {}

      // Process belongsTo relationships from schema
      for (const [fieldName, fieldDef] of Object.entries(schema)) {
        if (fieldDef.belongsTo && fieldDef.as) {
          const foreignKeyValue = getFieldValueForScope(scopes, scopeName, record, fieldName)
          if (foreignKeyValue != null) {
            record[RELATIONSHIP_METADATA_KEY][fieldDef.as] = {
              data: {
                type: fieldDef.belongsTo,
                id: String(foreignKeyValue)
              }
            }
          } else {
            record[RELATIONSHIP_METADATA_KEY][fieldDef.as] = { data: null }
          }
        }
      }

      // Process hasMany, hasOne and manyToMany relationships
      for (const [relName, relDef] of Object.entries(relationships)) {
        if (relDef.type === 'hasMany' || relDef.type === 'manyToMany') {
          // Add empty relationship data - will be populated if explicitly included
          record[RELATIONSHIP_METADATA_KEY][relName] = { data: [] }
        } else if (relDef.type === 'hasOne') {
          // hasOne expects a single object or null
          record[RELATIONSHIP_METADATA_KEY][relName] = { data: null }
        } else if (relDef.belongsToPolymorphic) {
          // Process polymorphic relationships defined in relationships section
          const { typeField, idField, types } = relDef.belongsToPolymorphic
          const type = getFieldValueForScope(scopes, scopeName, record, typeField)
          const id = getFieldValueForScope(scopes, scopeName, record, idField)

          record[RELATIONSHIP_METADATA_KEY][relName] = {
            data: getPolymorphicLinkage({ type, id, types, scopeName, relationshipName: relName })
          }
        }
      }
    })
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to load relationship metadata for scope '${scopeName}'`,
      context: { phase: 'relationshipMetadata', scopeName, recordCount: records?.length || 0 }
    })
  }
}
