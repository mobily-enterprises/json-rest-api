// @ts-check
/** @import { CanonicalDataDependencies, CanonicalDataReadHelpers, CanonicalDataSortRequest, CanonicalDataWriteHelpers, CanonicalDescriptor, DataDocument, DataMinimalRequest, DataReadContext, DataResource, DataSortDescriptor, StorageRow } from './storage-types.js' */
import { prepareReferenceSortColumns } from '../querying/knex-query-helpers.js'
import { applySortDescriptorOrder, buildEffectiveSortList, parseSortEntry, resolveSortField } from '../querying/query-field-sort-helpers.js'
import { normalizeId, resolveFieldInfo } from '../anyapi/utils/descriptor-helpers.js'
import { decorateResourceLinks, getAllowedQueryFieldNames } from '../anyapi/canonical-relationship-reader.js'
import { applyQueryConstraint } from '../querying/query-constraint.js'
import { calculatePaginationMeta, generatePaginationLinks, generateCursorPaginationLinks, buildCursorMeta, applyPaginationToQuery } from '../querying/knex-pagination-helpers.js'
import { getUrlPrefix, buildJsonApiLink } from '../querying/url-helpers.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from '../querying-writing/knex-field-helpers.js'
import { applyDatabaseReadOptions } from '../querying-writing/database-value-normalizers.js'
import { translateCanonicalAttributesForStorage, getCanonicalResourceId, getCanonicalResourceIdColumn, translateCanonicalRecordFromStorage } from '../storage/canonical-storage-mapping.js'
import { unwrapQueryBuilderState, withQueryFilteringContext } from '../querying/query-builder-utils.js'
import { applyInsertReturning } from '../querying-writing/database-capabilities.js'
import { serializeJsonApiQuery } from '../querying-writing/connectors-query-parser.js'

/** @param {StorageRow} row @param {CanonicalDescriptor} descriptor */
function requireCanonicalResourceId (row, descriptor) {
  const id = getCanonicalResourceId(row, descriptor)
  if (id === null) throw new Error(`Storage row for '${descriptor.resource}' has no resource ID`)
  return id
}

/** @param {CanonicalDataDependencies} dependencies */
export function createCanonicalDataHelpers ({
  api, knex, getScopeStorageAdapter, getDescriptor, linkStore,
  buildIncludes, attachReverseRelationships, attachManyToManyRelationships,
  applyBuiltInAnyApiQueryFilters
}) {
  /** @param {CanonicalDataSortRequest} request @returns {Promise<DataSortDescriptor[]>} */
  const applySortingToQuery = async ({ query, sort, descriptor, scope, tableAlias, context, before = false, queryFieldRuntimeByField = new Map() }) => {
    const effectiveSort = buildEffectiveSortList(sort, {
      defaultSort: scope.vars.defaultSort,
      schemaInfo: scope.vars.schemaInfo,
      idField: 'id'
    })
    /** @type {DataSortDescriptor[]} */
    const descriptors = []
    const referenceColumns = await prepareReferenceSortColumns({
      query,
      fields: effectiveSort.map(entry => parseSortEntry(entry).field).filter(field => !queryFieldRuntimeByField.has(field)),
      scopeName: descriptor.resource,
      tableAlias,
      context
    }, { scopes: api.resources, knex, getStorageAdapter: getScopeStorageAdapter })

    for (const entry of effectiveSort) {
      const { field, direction } = parseSortEntry(entry)
      const queryFieldRuntime = queryFieldRuntimeByField.get(field)
      if (queryFieldRuntime) {
        applySortDescriptorOrder(query, { queryFieldRuntime, direction }, { before })
        descriptors.push({
          field,
          direction,
          definition: queryFieldRuntime.definition,
          isRelationship: false,
          queryFieldRuntime,
        })
        continue
      }

      const reference = referenceColumns.get(field)
      const actualField = resolveSortField(field, scope.vars.schemaInfo)
      const fieldInfo = resolveFieldInfo(descriptor, actualField)
      if (!fieldInfo?.column) continue
      const column = reference?.column || `${tableAlias}.${fieldInfo.column}`
      applySortDescriptorOrder(query, { column, direction }, { before })
      descriptors.push({
        field,
        column,
        resultColumn: fieldInfo.column,
        actualField,
        ...(reference || {}),
        direction,
        definition: scope.vars.schemaInfo.schemaStructure[actualField] || fieldInfo.definition || null,
        isRelationship: fieldInfo.isRelationship || false,
      })
    }

    if (descriptors.length === 0) {
      descriptors.push({
        field: 'id',
        column: 'id',
        direction: 'asc',
        definition: { type: 'id' },
        isRelationship: false,
      })
    }

    return descriptors
  }

  /** @type {CanonicalDataWriteHelpers['dataExists']} */
  const dataExists = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (storageAdapter) {
      context.storageAdapter = storageAdapter
    }
    const descriptor = getDescriptor(scopeName)
    const { canonical } = descriptor
    const id = context.id
    const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)

    const row = await context.db(canonical.tableName)
      .select('id')
      .where(canonical.tenantColumn, descriptor.tenant)
      .where(canonical.resourceColumn, descriptor.resource)
      .where(logicalIdColumn, id)
      .first()

    return !!row
  }

  /** @type {CanonicalDataWriteHelpers['dataPost']} */
  const dataPost = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (storageAdapter) {
      context.storageAdapter = storageAdapter
    }
    const descriptor = getDescriptor(scopeName)
    const { canonical } = descriptor
    const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
    const explicitId = normalizeId(context.inputRecord?.data?.id)
    const attributes = context.inputRecord?.data?.attributes || {}
    const row = storageAdapter
      ? storageAdapter.toStorageRow(attributes, { context, operation: 'post' })
      : translateCanonicalAttributesForStorage(attributes, descriptor)

    if (explicitId !== undefined && explicitId !== null) {
      row[logicalIdColumn] = explicitId
    }

    row[canonical.tenantColumn] = descriptor.tenant
    row[canonical.resourceColumn] = descriptor.resource

    const result = await applyInsertReturning(context.db(canonical.tableName).insert(row), 'id')

    const inserted = Array.isArray(result) ? result[0] : result
    const insertedRowId = inserted && typeof inserted === 'object' && 'id' in inserted
      ? inserted.id
      : inserted

    if (explicitId !== undefined && explicitId !== null) {
      return explicitId
    }

    if (insertedRowId === undefined || insertedRowId === null) {
      return insertedRowId
    }

    const generatedLogicalId = String(insertedRowId)

    await context.db(canonical.tableName)
      .where({ id: insertedRowId })
      .update({ [logicalIdColumn]: generatedLogicalId })

    return generatedLogicalId
  }

  /** @type {CanonicalDataWriteHelpers['dataPut']} */
  const dataPut = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (storageAdapter) {
      context.storageAdapter = storageAdapter
    }
    const descriptor = getDescriptor(scopeName)
    const { canonical } = descriptor
    const id = context.id
    const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
    const attributes = context.inputRecord?.data?.attributes || {}
    const row = storageAdapter
      ? storageAdapter.toStorageRow(attributes, { context, operation: 'put' })
      : translateCanonicalAttributesForStorage(attributes, descriptor)

    row[canonical.resourceColumn] = descriptor.resource
    row[canonical.tenantColumn] = descriptor.tenant

    const writeRow = Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== undefined)
    )

    if (context.isCreate) {
      await context.db(canonical.tableName).insert({
        ...writeRow,
        [logicalIdColumn]: id,
      })
      return 1
    }

    const result = await context.db(canonical.tableName)
      .where(logicalIdColumn, id)
      .where(canonical.resourceColumn, descriptor.resource)
      .where(canonical.tenantColumn, descriptor.tenant)
      .update(writeRow)

    return result
  }

  /** @type {CanonicalDataWriteHelpers['dataPatch']} */
  const dataPatch = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (storageAdapter) {
      context.storageAdapter = storageAdapter
    }
    const descriptor = getDescriptor(scopeName)
    const { canonical } = descriptor
    const id = context.id
    const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
    const attributes = context.inputRecord?.data?.attributes || {}
    const row = storageAdapter
      ? storageAdapter.toStorageRow(attributes, { context, operation: 'patch' })
      : translateCanonicalAttributesForStorage(attributes, descriptor)

    const updateRow = Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== undefined)
    )

    if (Object.keys(updateRow).length === 0) {
      return 0
    }

    const result = await context.db(canonical.tableName)
      .where(logicalIdColumn, id)
      .where(canonical.resourceColumn, descriptor.resource)
      .where(canonical.tenantColumn, descriptor.tenant)
      .update(updateRow)

    return result
  }

  /** @type {CanonicalDataWriteHelpers['dataDelete']} */
  const dataDelete = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (storageAdapter) {
      context.storageAdapter = storageAdapter
    }
    const descriptor = getDescriptor(scopeName)
    const { canonical } = descriptor
    const id = context.id
    const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)

    await linkStore.invalidateDeletedLinkTargets(scopeName, context)
    const result = await context.db(canonical.tableName)
      .where(logicalIdColumn, id)
      .where(canonical.resourceColumn, descriptor.resource)
      .where(canonical.tenantColumn, descriptor.tenant)
      .delete()

    await linkStore.deleteResourceLinks({ descriptor, scopeName, id, db: context.db })

    return result
  }

  // Supplying ids returns minimal records for the caller's bounded validation batch.
  /** @overload @param {DataMinimalRequest & { ids: Array<string | number> }} request @returns {Promise<DataResource[]>} */
  /** @overload @param {DataMinimalRequest & { ids?: undefined, context: DataReadContext & {id: string | number} }} request @returns {Promise<DataResource | null>} */
  /** @param {DataMinimalRequest & { ids?: Array<string | number> }} request */
  async function dataGetMinimal ({
    scopeName,
    context,
    ids,
    runHooks,
    applyQueryFilters,
    filters = context.queryParams?.filters,
    queryPurpose = 'single'
  }) {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (!storageAdapter) throw new Error(`Storage adapter for resource '${scopeName}' not found`)
    context.storageAdapter = storageAdapter
    const descriptor = getDescriptor(scopeName)
    const { canonical } = descriptor
    const id = context.id
    const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
    const scope = api.resources?.[scopeName]

    let query = context.db(canonical.tableName)
      .where(canonical.resourceColumn, descriptor.resource)
      .where(canonical.tenantColumn, descriptor.tenant)
    if (ids === undefined) query.where(logicalIdColumn, id)
    else {
      // Knex types exclude unknown bindings; the configured driver still validates serializer results.
      query.whereIn(logicalIdColumn, /** @type {import('knex').Knex.Value[]} */ (ids.map(value => storageAdapter.translateFilterValue('id', value))))
        .distinct(`${canonical.tableName}.${logicalIdColumn}`)
    }

    if (typeof applyQueryFilters === 'function') {
      const scopedQueryState = await applyQueryFilters({
        query,
        filters,
        tableName: canonical.tableName,
        db: context.db,
        scopeName,
        queryPurpose,
        storageAdapter,
        isAnyApi: true
      })
      query = unwrapQueryBuilderState(scopedQueryState, query)
    } else if (runHooks) {
      const filteredState = await withQueryFilteringContext(context, {
        query,
        filters,
        schemaInfo: context.schemaInfo,
        scopeName,
        tableName: canonical.tableName,
        db: context.db,
        queryPurpose,
        isAnyApi: true,
        adapter: storageAdapter,
        storageAdapter,
      }, async () => {
        await applyBuiltInAnyApiQueryFilters(context)
        await runHooks('knexQueryFiltering')
      })
      query = filteredState.query
    }

    /** @param {StorageRow} row @returns {DataResource} */
    const toMinimal = row => {
      const translated = translateCanonicalRecordFromStorage(
        row,
        descriptor,
        { allowedExtraFields: getAllowedQueryFieldNames(api, scopeName) }
      )
      const minimal = {
        type: descriptor.resource,
        id: requireCanonicalResourceId(row, descriptor),
        attributes: translated.attributes,
        relationships: translated.relationships,
      }
      if (scope) decorateResourceLinks({ resource: minimal, scope, scopeName, context })
      return minimal
    }
    if (ids !== undefined) {
      // Filtering owns predicates; the validation batch owns its identity projection.
      query.clearSelect().distinct(`${canonical.tableName}.${logicalIdColumn}`)
      /** @type {StorageRow[]} */
      const rows = await applyDatabaseReadOptions(storageAdapter.buildBaseQuery({ transaction: context.db }).whereIn(logicalIdColumn, query))
      return rows.map(toMinimal)
    }
    const row = await applyDatabaseReadOptions(query.select(`${canonical.tableName}.*`)).first()
    return row ? toMinimal(row) : null
  }

  /** @type {CanonicalDataReadHelpers['dataGet']} */
  const dataGet = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (!storageAdapter) throw new Error(`Storage adapter for resource '${scopeName}' not found`)
    context.storageAdapter = storageAdapter
    const descriptor = getDescriptor(scopeName)
    const { canonical } = descriptor
    const id = context.id
    const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
    const scope = api.resources[scopeName]
    if (!scope) throw new Error(`Scope '${scopeName}' not found in api.resources`)

    const fieldSelectionInfo = await buildFieldSelection(scope, { context })
    context.computedDependencies = fieldSelectionInfo.computedDependencies

    let query = context.db(canonical.tableName)
      .where(logicalIdColumn, id)
      .where(canonical.resourceColumn, descriptor.resource)
      .where(canonical.tenantColumn, descriptor.tenant)

    const selectionState = await applyFieldSelectionToQuery({
      query,
      scope,
      fieldSelectionInfo,
      tableName: canonical.tableName,
      useTablePrefix: false,
      storageAdapter,
      db: context.db,
      context,
      scopeName
    })
    query = selectionState.query

    const row = await applyDatabaseReadOptions(query).first()

    if (!row) return null

    const record = translateCanonicalRecordFromStorage(
      row,
      descriptor,
      { allowedExtraFields: getAllowedQueryFieldNames(api, scopeName) }
    )
    const resourceId = requireCanonicalResourceId(row, descriptor)
    /** @type {DataResource} */
    const data = {
      type: descriptor.resource,
      id: resourceId,
      attributes: record.attributes,
    }

    if (record.relationships && Object.keys(record.relationships).length > 0) {
      data.relationships = record.relationships
    }

    await attachReverseRelationships({
      resources: [data],
      descriptor,
      context,
    })

    await attachManyToManyRelationships({
      resources: [data],
      descriptor,
      context,
    })

    const included = await buildIncludes({
      parentResources: [data],
      descriptor,
      context,
    })

    /** @type {DataDocument<typeof data>} */
    const response = { data }
    if (included.length > 0 || context.queryParams?.include !== undefined) {
      response.included = included
    }

    decorateResourceLinks({ resource: data, scope, scopeName, context })
    response.links = { self: buildJsonApiLink(data.links?.self, context.queryParams) }

    for (const includeResource of included) {
      const targetScope = api.resources?.[includeResource.type]
      if (!targetScope) continue
      decorateResourceLinks({
        resource: includeResource,
        scope: targetScope,
        scopeName: includeResource.type,
        context,
      })
    }

    return response
  }

  /** @type {CanonicalDataReadHelpers['dataQuery']} */
  const dataQuery = async ({ scopeName, context, runHooks }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    if (!storageAdapter) throw new Error(`Storage adapter for resource '${scopeName}' not found`)
    context.storageAdapter = storageAdapter
    const descriptor = getDescriptor(scopeName)
    const db = context.db || context.transaction || api.knex.instance
    const scope = api.resources?.[scopeName]
    const queryParams = context.queryParams || {}
    if (!scope) throw new Error(`Scope '${scopeName}' not found in api.resources`)

    const fieldSelectionInfo = await buildFieldSelection(scope, { context })
    context.computedDependencies = fieldSelectionInfo.computedDependencies
    const tableAlias = scope.vars.schemaInfo.tableName || descriptor.resource
    let queryBuilder = storageAdapter.buildBaseQuery({ transaction: db, tableAlias })
    applyQueryConstraint({ query: queryBuilder, context, scopeName, storageAdapter, tableName: tableAlias })

    const schemaInfo = scope.vars.schemaInfo

    const filteredState = await withQueryFilteringContext(context, {
      query: queryBuilder,
      filters: queryParams.filters,
      schemaInfo,
      scopeName,
      tableName: tableAlias,
      db,
      queryPurpose: 'collection',
      isAnyApi: true,
      adapter: storageAdapter,
      storageAdapter,
    }, async () => {
      await applyBuiltInAnyApiQueryFilters(context)
      if (runHooks) await runHooks('knexQueryFiltering')
    })
    queryBuilder = filteredState.query

    const countQuery = queryBuilder.clone()

    const selectionState = await applyFieldSelectionToQuery({
      query: queryBuilder,
      scope,
      fieldSelectionInfo,
      tableName: tableAlias,
      useTablePrefix: true,
      storageAdapter,
      db,
      context,
      scopeName
    })
    queryBuilder = selectionState.query

    const sortDescriptors = await applySortingToQuery({
      query: queryBuilder,
      sort: queryParams.sort,
      descriptor,
      scope,
      tableAlias,
      context,
      before: Boolean(queryParams.page?.before),
      queryFieldRuntimeByField: selectionState.queryFieldRuntimeByField
    })

    const paginationInfo = applyPaginationToQuery({
      query: queryBuilder,
      page: queryParams.page,
      vars: scope.vars,
      sortDescriptors,
      storageAdapter,
    })

    /** @type {StorageRow[]} */
    let rows = await applyDatabaseReadOptions(queryBuilder)
    let cursorRecords = null
    let hasMore = false

    if (paginationInfo.mode === 'cursor') {
      const { pageSize } = paginationInfo
      hasMore = rows.length > pageSize
      if (hasMore) rows = rows.slice(0, pageSize)
      if (paginationInfo.before) rows.reverse()

      cursorRecords = rows.map((row) => {
        /** @type {StorageRow} */
        const record = {}
        for (const descriptorEntry of sortDescriptors) {
          if (descriptorEntry.field === 'id') {
            record.id = getCanonicalResourceId(row, descriptor)
          } else if (descriptorEntry.queryFieldRuntime) {
            record[descriptorEntry.field] = row[descriptorEntry.field]
          } else if (descriptorEntry.column) {
            record[descriptorEntry.field] = row[descriptorEntry.resultColumn || descriptorEntry.column]
          }
        }
        return record
      })
    }

    for (const row of rows) {
      for (const { referenceField, resultColumn } of sortDescriptors) {
        if (referenceField && resultColumn) delete row[resultColumn]
      }
    }
    const data = rows.map((row) => {
      const translated = translateCanonicalRecordFromStorage(
        row,
        descriptor,
        { allowedExtraFields: getAllowedQueryFieldNames(api, scopeName) }
      )
      const resourceId = requireCanonicalResourceId(row, descriptor)
      /** @type {DataResource} */
      const resource = {
        type: descriptor.resource,
        id: resourceId,
        attributes: translated.attributes,
      }
      if (translated.relationships && Object.keys(translated.relationships).length > 0) {
        resource.relationships = translated.relationships
      }
      decorateResourceLinks({ resource, scope, scopeName, context })
      if (fieldSelectionInfo.computedDependencies.length) {
        resource.__$jsonrestapi_computed_deps$__ = fieldSelectionInfo.computedDependencies
      }
      return resource
    })

    await attachReverseRelationships({
      resources: data,
      descriptor,
      context,
    })

    await attachManyToManyRelationships({
      resources: data,
      descriptor,
      context,
    })

    const included = await buildIncludes({
      parentResources: data,
      descriptor,
      context,
    })

    /** @type {DataDocument<typeof data>} */
    const response = { data }
    if (included.length > 0 || context.queryParams?.include !== undefined) {
      response.included = included
    }

    for (const includeResource of included) {
      const targetScope = api.resources?.[includeResource.type]
      if (!targetScope) continue
      decorateResourceLinks({
        resource: includeResource,
        scope: targetScope,
        scopeName: includeResource.type,
        context,
      })
    }

    context.returnMeta = context.returnMeta || {}
    const queryString = serializeJsonApiQuery(queryParams)
    context.returnMeta.queryString = queryString ? `?${queryString}` : ''
    delete context.returnMeta.paginationMeta
    delete context.returnMeta.paginationLinks

    if (paginationInfo.mode === 'offset') {
      const { page, pageSize } = paginationInfo
      let paginationMeta

      if (scope.vars.enablePaginationCounts) {
        /** @type {StorageRow | undefined} */
        const countResult = await countQuery.clearSelect().clearOrder()
          .countDistinct({ count: `${tableAlias}.${getCanonicalResourceIdColumn(descriptor)}` }).first()
        const total = Number(countResult?.count ?? countResult?.total ?? 0)
        paginationMeta = calculatePaginationMeta(total, page, pageSize)
      } else {
        paginationMeta = { page, pageSize }
      }

      context.returnMeta.paginationMeta = paginationMeta
      const urlPrefix = getUrlPrefix(context, scope)
      context.returnMeta.paginationLinks = generatePaginationLinks(
        urlPrefix,
        scopeName,
        queryParams,
        paginationMeta
      )
    } else if (paginationInfo.mode === 'cursor' && cursorRecords) {
      const cursorFields = sortDescriptors.map((descriptorEntry) => descriptorEntry.field)
      const cursorOptions = {
        schemaInfo,
        definitions: Object.fromEntries(sortDescriptors.map(({ field, definition }) => [field, definition])),
        before: paginationInfo.before
      }
      const paginationMeta = buildCursorMeta(
        cursorRecords,
        paginationInfo.pageSize,
        hasMore,
        cursorFields,
        cursorOptions
      )
      context.returnMeta.paginationMeta = paginationMeta
      const urlPrefix = getUrlPrefix(context, scope)
      context.returnMeta.paginationLinks = generateCursorPaginationLinks(
        urlPrefix,
        scopeName,
        queryParams,
        cursorRecords,
        paginationInfo.pageSize,
        hasMore,
        cursorFields,
        cursorOptions
      )
    }

    if (context.returnMeta.paginationMeta) {
      response.meta = {
        pagination: context.returnMeta.paginationMeta,
      }
    }

    if (context.returnMeta.paginationLinks) {
      response.links = context.returnMeta.paginationLinks
    } else {
      const urlPrefix = getUrlPrefix(context, scope)
      response.links = {
        self: `${urlPrefix}/${scopeName}${context.returnMeta.queryString || ''}`,
      }
    }

    return response
  }

  return {
    dataExists,
    dataPost,
    dataPut,
    dataPatch,
    dataDelete,
    dataGet,
    dataQuery,
    dataGetMinimal
  }
}
