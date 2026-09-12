// @ts-check
/** @import { DataMinimalRequest, DataReadContext, DataRelatedIdsQuery, DataResource, DataSortDescriptor, DataSortRequest, OrdinaryDataDependencies, OrdinaryDataReadHelpers, OrdinaryDataWriteHelpers, StorageRow } from './storage-types.js' */
import { prepareReferenceSortColumns } from '../querying/knex-query-helpers.js'
import { applySortDescriptorOrder, buildEffectiveSortList, parseSortEntry, resolveSortField } from '../querying/query-field-sort-helpers.js'
import { deletePivotReferences, invalidateDeletedPivotTargets } from '../writing/many-to-many-manipulations.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from '../querying-writing/knex-field-helpers.js'
import { buildJsonApiResponse } from '../querying/knex-json-api-transformers-querying.js'
import { toJsonApiRecordWithBelongsTo } from '../querying-writing/knex-json-api-transformers.js'
import { processIncludes } from '../querying/knex-process-includes.js'
import { loadRelationshipIdentifiers } from '../querying/relationship-identifiers.js'
import { applyQueryConstraint } from '../querying/query-constraint.js'
import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { getOperationDiagnosticContext } from '../../../../lib/error-context.js'
import { applyInsertReturning } from '../querying-writing/database-capabilities.js'
import { ERROR_SUBTYPES } from '../querying-writing/knex-constants.js'
import { calculatePaginationMeta, generatePaginationLinks, generateCursorPaginationLinks, buildCursorMeta, applyPaginationToQuery } from '../querying/knex-pagination-helpers.js'
import { getUrlPrefix } from '../querying/url-helpers.js'
import { unwrapQueryBuilderState, withQueryFilteringContext } from '../querying/query-builder-utils.js'
import { serializeJsonApiQuery } from '../querying-writing/connectors-query-parser.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'

/** @param {OrdinaryDataDependencies} dependencies */
export function createOrdinaryDataHelpers ({ api, scopes, knex, log, getScopeStorageAdapter: findStorageAdapter }) {
  /** @param {string} scopeName */
  const getScopeStorageAdapter = scopeName => {
    const adapter = findStorageAdapter(scopeName)
    if (!adapter) throw new Error(`Storage adapter for resource '${scopeName}' not found`)
    return adapter
  }
  /** @param {string} scopeName */
  const getScope = scopeName => {
    const scope = api.resources[scopeName]
    if (!scope) throw new Error(`Scope '${scopeName}' not found in api.resources`)
    return scope
  }
  /** @param {DataSortRequest} request @returns {Promise<DataSortDescriptor[]>} */
  const buildSortDescriptors = async ({
    query,
    sort,
    schemaInfo,
    sortableFields,
    storageAdapter,
    defaultSort,
    scopeName,
    context,
    before = false,
    queryFieldRuntimeByField = new Map()
  }) => {
    const effectiveSort = buildEffectiveSortList(sort, { defaultSort, idField: 'id', schemaInfo })
    /** @type {DataSortDescriptor[]} */
    const descriptors = []
    const referenceColumns = await prepareReferenceSortColumns({
      query,
      fields: effectiveSort.map(entry => parseSortEntry(entry).field).filter(field =>
        !queryFieldRuntimeByField.has(field) && (field === 'id' || !sortableFields?.length || sortableFields.includes(field))),
      scopeName,
      tableAlias: storageAdapter.getTableName(),
      context
    }, { scopes, knex, getStorageAdapter: getScopeStorageAdapter })

    for (const sortEntry of effectiveSort) {
      const { field, direction, sqlDirection } = parseSortEntry(sortEntry)

      if (field !== 'id' && sortableFields && sortableFields.length > 0 && !sortableFields.includes(field)) {
        try {
          await log.warn('Ignoring non-sortable field', {
            ...getOperationDiagnosticContext(context, { phase: 'querySort', scopeName, backend: knex.client.config.client }), field
          })
        } catch { /* Diagnostics must preserve the skipped sort. */ }
        continue
      }

      const queryFieldRuntime = queryFieldRuntimeByField.get(field)
      if (queryFieldRuntime) {
        applySortDescriptorOrder(query, { queryFieldRuntime, direction }, { before })
        descriptors.push({
          field,
          direction: sqlDirection,
          queryFieldRuntime,
          definition: queryFieldRuntime.definition,
          isRelationship: false
        })
        continue
      }

      const dbField = resolveSortField(field, schemaInfo)
      const searchField = schemaInfo.searchSchemaStructure?.[field]

      const storageColumn = storageAdapter.translateColumn(dbField)
      const reference = referenceColumns.get(field)
      const translatedField = reference?.column || (storageColumn.includes('.')
        ? storageColumn
        : `${storageAdapter.getTableName()}.${storageColumn}`)

      applySortDescriptorOrder(query, { column: translatedField, direction }, { before })
      descriptors.push({
        field,
        direction: sqlDirection,
        column: translatedField,
        actualField: dbField,
        resultColumn: field === 'id' ? 'id' : storageColumn,
        ...(reference || {}),
        definition: schemaInfo.schemaStructure?.[dbField] || { type: field === 'id' ? 'id' : undefined },
        isRelationship: Boolean(schemaInfo.schemaStructure?.[dbField]?.belongsTo || (dbField !== field && searchField?.isRelationship))
      })
    }

    if (descriptors.length === 0) {
      query.orderBy('id', 'asc')
      descriptors.push({
        field: 'id',
        direction: 'ASC',
        column: 'id',
        definition: { type: 'id' },
        isRelationship: false
      })
    }

    return descriptors
  }

  /** @type {DataRelatedIdsQuery} */
  const dataRelatedIdsQuery = async ({ context, relDef }) => {
    const pivotScope = scopes[relDef.through]
    const pivotAdapter = getScopeStorageAdapter(relDef.through)
    if (!pivotScope || !relDef.foreignKey || !relDef.otherKey) {
      throw new RestApiResourceError('Invalid many-to-many pivot definition', { subtype: 'pivot_table_not_found' })
    }
    const tableName = pivotAdapter.getTableName()
    const pivotContext = {
      ...context,
      method: 'query',
      scopeName: relDef.through,
      schemaInfo: pivotScope.vars.schemaInfo,
      storageAdapter: pivotAdapter,
      queryParams: {}
    }
    await pivotScope.checkPermissions({ method: 'query', originalContext: pivotContext })
    const query = pivotAdapter.buildBaseQuery({ transaction: context.transaction })
      .where({ [`${tableName}.${pivotAdapter.translateColumn(relDef.foreignKey)}`]: pivotAdapter.translateFilterValue(relDef.foreignKey, context.id) })
    const state = await pivotScope.applyQueryFilters({
      query,
      filters: undefined,
      scopeName: relDef.through,
      tableName,
      db: context.db,
      schemaInfo: pivotScope.vars.schemaInfo,
      storageAdapter: pivotAdapter,
      queryPurpose: 'collection'
    }, pivotContext)
    return {
      query: unwrapQueryBuilderState(state, query).clearSelect().select(`${tableName}.${pivotAdapter.translateColumn(relDef.otherKey)}`)
    }
  }

  /** @type {OrdinaryDataWriteHelpers['dataExists']} */
  const dataExists = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    context.storageAdapter = storageAdapter

    const id = context.id

    const tableName = storageAdapter.getTableName()
    const idProperty = storageAdapter.getIdColumn()
    const db = context.db || api.knex.instance

    log.debug(`[Knex] EXISTS ${tableName}/${id}`)

    const selectClause = idProperty !== 'id' ? `${idProperty} as id` : 'id'

    const record = await db(tableName)
      .where(idProperty, id)
      .select(selectClause)
      .first()

    return !!record
  }

  /** @type {OrdinaryDataReadHelpers['dataGet']} */
  const dataGet = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    context.storageAdapter = storageAdapter
    const scope = getScope(scopeName)
    const id = context.id
    const tableName = storageAdapter.getTableName()
    const idProperty = storageAdapter.getIdColumn()
    const db = context.db || api.knex.instance

    log.debug(`[Knex] GET ${tableName}/${id}`)

    const fieldSelectionInfo = await buildFieldSelection(scope, { context })
    // Enrichment removes fetched dependencies that the caller did not request.
    context.computedDependencies = fieldSelectionInfo.computedDependencies

    // The preceding minimal read has already applied permission and row filters.
    let query = db(tableName).where(idProperty, id)

    const selectionState = await applyFieldSelectionToQuery({
      query,
      scope,
      fieldSelectionInfo,
      tableName,
      useTablePrefix: false,
      storageAdapter,
      db,
      context,
      scopeName
    })
    query = selectionState.query

    const record = await applyDatabaseReadOptions(query).first()

    if (!record) {
      throw new RestApiResourceError(
        'Resource not found',
        {
          subtype: ERROR_SUBTYPES.NOT_FOUND,
          resourceType: scopeName,
          resourceId: id
        }
      )
    }

    const records = [record]
    await loadRelationshipIdentifiers(records, scopeName, scopes, db, context)

    const included = await processIncludes(scope, records, {
      log,
      scopes,
      knex,
      context,
      api
    })

    return buildJsonApiResponse(scope, records, included, true, scopeName, context)
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
    context.storageAdapter = storageAdapter
    const scope = getScope(scopeName)
    const id = context.id
    const tableName = storageAdapter.getTableName()
    const idProperty = storageAdapter.getIdColumn()
    const db = context.db || api.knex.instance

    log.debug(`[Knex] GET_MINIMAL ${tableName}/${id}`)

    // Knex types exclude unknown bindings; the configured driver still validates serializer results.
    let query = ids === undefined
      ? db(tableName).where(idProperty, id)
      : db(tableName).whereIn(idProperty, /** @type {import('knex').Knex.Value[]} */ (ids.map(value => storageAdapter.translateFilterValue('id', value))))
        .distinct(`${tableName}.${idProperty}`)

    if (typeof applyQueryFilters === 'function') {
      const scopedQueryState = await applyQueryFilters({
        query,
        filters,
        tableName,
        db,
        scopeName,
        queryPurpose,
        storageAdapter
      })
      query = unwrapQueryBuilderState(scopedQueryState, query)
    } else if (runHooks) {
      const filteredState = await withQueryFilteringContext(context, {
        query,
        filters,
        schemaInfo: context.schemaInfo,
        scopeName,
        tableName,
        db,
        queryPurpose,
        adapter: storageAdapter,
        storageAdapter,
      }, async () => {
        await runHooks('knexQueryFiltering')
      })
      query = filteredState.query
    }

    const identityFields = new Set([...context.schemaInfo.foreignKeyFields, 'id'])
    const identities = Object.fromEntries([...identityFields].map(field => {
      const column = storageAdapter.translateColumn(field)
      return [field === 'id' ? 'id' : column, databaseIdentityExpression(db, `${tableName}.${column}`)]
    }))
    if (ids !== undefined) {
      // Filtering owns predicates; the validation batch owns its identity projection.
      query.clearSelect().distinct(`${tableName}.${idProperty}`)
      // Deduplicate policy joins by ID, without comparing JSON or other row values.
      /** @type {StorageRow[]} */
      const records = await applyDatabaseReadOptions(storageAdapter.buildBaseQuery({ transaction: db }).whereIn(idProperty, query).select(`${tableName}.*`, identities))
      return records.map(record => toJsonApiRecordWithBelongsTo(scope, record, scopeName))
    }
    const record = await applyDatabaseReadOptions(query.select(`${tableName}.*`, identities)).first()

    if (!record) {
      return null
    }

    return toJsonApiRecordWithBelongsTo(scope, record, scopeName)
  }

  /** @type {OrdinaryDataReadHelpers['dataQuery']} */
  const dataQuery = async ({ scopeName, context, runHooks }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    context.storageAdapter = storageAdapter
    const scope = getScope(scopeName)
    const tableName = storageAdapter.getTableName()
    const schemaInfo = context.schemaInfo
    const queryParams = context.queryParams
    const db = context.db || api.knex.instance
    const sortableFields = context.sortableFields

    log.trace('[DATA-QUERY] Starting dataQuery', { scopeName })
    log.debug(`[Knex] QUERY ${tableName}`)

    const fieldSelectionInfo = await buildFieldSelection(scope, { context })
    context.computedDependencies = fieldSelectionInfo.computedDependencies

    let query = db(tableName)
    applyQueryConstraint({ query, context, scopeName, storageAdapter, tableName })

    const selectionState = await applyFieldSelectionToQuery({
      query,
      scope,
      fieldSelectionInfo,
      tableName,
      useTablePrefix: true,
      storageAdapter,
      db,
      context,
      scopeName
    })
    query = selectionState.query
    const queryFieldRuntimeByField = selectionState.queryFieldRuntimeByField

    log.trace('[DATA-QUERY] Calling knexQueryFiltering hook', { hasQuery: !!query, hasFilters: !!queryParams.filters, scopeName, tableName })

    const filteredState = await withQueryFilteringContext(context, {
      query,
      filters: queryParams.filters,
      schemaInfo,
      scopeName,
      tableName,
      db,
      queryPurpose: 'collection',
      adapter: storageAdapter,
      storageAdapter,
    }, async () => {
      await runHooks('knexQueryFiltering')
    })
    query = filteredState.query

    log.trace('[DATA-QUERY] Finished knexQueryFiltering hook')

    const sortDescriptors = await buildSortDescriptors({
      query,
      sort: queryParams.sort,
      schemaInfo,
      sortableFields,
      defaultSort: scope.vars.defaultSort,
      scopeName,
      context,
      before: Boolean(queryParams.page?.before),
      storageAdapter,
      queryFieldRuntimeByField
    })

    const paginationInfo = applyPaginationToQuery({
      query,
      page: queryParams.page,
      vars: scope.vars,
      sortDescriptors,
      storageAdapter
    })
    const { pageSize } = paginationInfo

    /** @type {StorageRow[]} */
    const records = await applyDatabaseReadOptions(query)

    context.returnMeta = context.returnMeta || {}
    const queryString = serializeJsonApiQuery(queryParams)
    context.returnMeta.queryString = queryString ? `?${queryString}` : ''

    // Execute count query for pagination if offset-based pagination is used
    if (paginationInfo.mode === 'offset') {
      const { page } = paginationInfo

      // Only execute count query if enabled
      if (scope.vars.enablePaginationCounts) {
        // Build count query with same filters as main query
        let countQuery = db(tableName)
        applyQueryConstraint({ query: countQuery, context, scopeName, storageAdapter, tableName })

        // Mandatory server-side filters must also run when the client supplied no filters.
        // Otherwise pagination metadata can disclose or count rows excluded from the page.
        const filteredState = await withQueryFilteringContext(context, {
          query: countQuery,
          filters: queryParams.filters,
          scopeName,
          tableName,
          schemaInfo,
          db,
          queryPurpose: 'count',
          adapter: storageAdapter,
          storageAdapter
        }, async () => {
          await runHooks('knexQueryFiltering')
        })
        countQuery = filteredState.query

        // Get total count
        const countResult = await countQuery.clearSelect().clearOrder()
          .countDistinct({ total: `${tableName}.${storageAdapter.getIdColumn()}` }).first()
        const total = Number(countResult?.total ?? 0)

        // Calculate pagination metadata with total
        context.returnMeta.paginationMeta = calculatePaginationMeta(total, page, pageSize)
      } else {
        // Without count, we can still provide basic pagination info
        context.returnMeta.paginationMeta = {
          page,
          pageSize
          // No total, pageCount, or hasMore when counts are disabled
        }
      }

      // Generate links
      const urlPrefix = getUrlPrefix(context, scope)
      context.returnMeta.paginationLinks = generatePaginationLinks(
        urlPrefix,
        scopeName,
        queryParams,
        context.returnMeta.paginationMeta
      )
    }

    const referenceSortDescriptors = sortDescriptors.filter(descriptor => descriptor.referenceField)
    if (paginationInfo.mode === 'cursor') {
      // Pagination fetches one extra row to detect a following page.
      const hasMore = records.length > pageSize

      if (hasMore) {
        records.pop()
      }
      if (paginationInfo.before) records.reverse()

      const sortFields = sortDescriptors.map((descriptor) => descriptor.field)
      const cursorRecords = records.map(record => {
        const cursorRecord = { ...record }
        for (const { field, resultColumn } of sortDescriptors) {
          if (resultColumn) cursorRecord[field] = record[resultColumn]
        }
        return cursorRecord
      })
      const cursorOptions = {
        schemaInfo,
        definitions: Object.fromEntries(sortDescriptors.map(({ field, definition }) => [field, definition])),
        before: paginationInfo.before
      }

      context.returnMeta.paginationMeta = buildCursorMeta(cursorRecords, pageSize, hasMore, sortFields, cursorOptions)
      const urlPrefix = getUrlPrefix(context, scope)
      context.returnMeta.paginationLinks = generateCursorPaginationLinks(
        urlPrefix,
        scopeName,
        queryParams,
        cursorRecords,
        pageSize,
        hasMore,
        sortFields,
        cursorOptions
      )
    }

    for (const record of records) {
      for (const { resultColumn } of referenceSortDescriptors) {
        if (resultColumn) delete record[resultColumn]
      }
    }
    await loadRelationshipIdentifiers(records, scopeName, scopes, db, context)

    const included = await processIncludes(scope, records, {
      log,
      scopes,
      knex,
      context,
      api
    })

    return buildJsonApiResponse(scope, records, included, false, scopeName, context)
  }

  /** @type {OrdinaryDataWriteHelpers['dataPost']} */
  const dataPost = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    context.storageAdapter = storageAdapter
    const tableName = storageAdapter.getTableName()
    const idProperty = storageAdapter.getIdColumn()
    const db = context.db || api.knex.instance
    const inputRecord = context.inputRecord

    log.debug(`[Knex] POST ${tableName}`)

    // Extract attributes from JSON:API format.
    // POST may legitimately provide a resource id when the table uses a custom primary key
    // (for example, one-to-one rows keyed by user_id/workspace_id). Keep that id in the
    // attribute bag so storage translation can write it to the configured id column.
    const attributes = {
      ...(inputRecord.data.attributes || {}),
      ...(inputRecord.data.id !== undefined ? { id: inputRecord.data.id } : {})
    }

    // Strip non-database fields (computed and virtual) before insert
    /** @type {StorageRow} */
    const dbAttributes = storageAdapter.toStorageRow(attributes, {
      context,
      operation: 'post'
    })

    const explicitId = dbAttributes[idProperty] ?? inputRecord.data.id

    // Insert and get the new ID
    const result = await applyDatabaseReadOptions(applyInsertReturning(db(tableName).insert(dbAttributes), { [idProperty]: databaseIdentityExpression(db, idProperty) }))

    // Extract the ID value. Some dialects ignore .returning() for inserts and can
    // yield 0 even when the caller explicitly supplied the primary key.
    const returnedId = Array.isArray(result)
      ? (result[0]?.[idProperty] ?? result[0])
      : (result?.[idProperty] ?? result)

    if (
      explicitId !== undefined &&
      explicitId !== null &&
      (returnedId === undefined || returnedId === null || returnedId === 0 || returnedId === '0')
    ) {
      return explicitId
    }

    return returnedId
  }

  /** @type {OrdinaryDataWriteHelpers['dataPut']} */
  const dataPut = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    context.storageAdapter = storageAdapter
    const id = context.id
    const tableName = storageAdapter.getTableName()
    const idProperty = storageAdapter.getIdColumn()
    const db = context.db || api.knex.instance
    const inputRecord = context.inputRecord
    const isCreate = context.isCreate

    log.debug(`[Knex] PUT ${tableName}/${id} (isCreate: ${context.isCreate})`)

    // Core has already merged relationship values and applied setters.
    const attributes = inputRecord.data.attributes || {}

    // Strip non-database fields (computed and virtual) before database operation
    const finalAttributes = storageAdapter.toStorageRow(attributes, {
      context,
      operation: 'put'
    })

    if (isCreate) {
      await db(tableName).insert({
        ...finalAttributes,
        [idProperty]: id
      })
      return
    }

    const exists = await db(tableName)
      .where(idProperty, id)
      .first()

    if (!exists) {
      throw new RestApiResourceError(
        'Resource not found',
        {
          subtype: ERROR_SUBTYPES.NOT_FOUND,
          resourceType: scopeName,
          resourceId: id
        }
      )
    }

    // Updates cannot replace the primary key.
    delete finalAttributes[idProperty]
    if (Object.keys(finalAttributes).length > 0) {
      await db(tableName)
        .where(idProperty, id)
        .update(finalAttributes)
    }
  }

  /** @type {OrdinaryDataWriteHelpers['dataPatch']} */
  const dataPatch = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    context.storageAdapter = storageAdapter
    const id = context.id
    const tableName = storageAdapter.getTableName()
    const idProperty = storageAdapter.getIdColumn()
    const db = context.db || api.knex.instance
    const inputRecord = context.inputRecord

    log.debug(`[Knex] PATCH ${tableName}/${id}`)

    // Check if record exists
    const exists = await db(tableName)
      .where(idProperty, id)
      .first()

    if (!exists) {
      throw new RestApiResourceError(
        'Resource not found',
        {
          subtype: ERROR_SUBTYPES.NOT_FOUND,
          resourceType: scopeName,
          resourceId: id
        }
      )
    }

    // Core has already merged relationship values and applied setters.
    const attributes = inputRecord.data.attributes || {}

    // Strip non-database fields (computed and virtual) before database operation
    const finalAttributes = storageAdapter.toStorageRow(attributes, {
      context,
      operation: 'patch'
    })

    log.debug(`[Knex] PATCH attributes prepared for ${tableName}`)

    // Remove the idProperty from attributes to prevent updating the primary key
    delete finalAttributes[idProperty]

    // Update only if there are changes
    if (Object.keys(finalAttributes).length > 0) {
      await db(tableName)
        .where(idProperty, id)
        .update(finalAttributes)
    }
  }

  /** @type {OrdinaryDataWriteHelpers['dataDelete']} */
  const dataDelete = async ({ scopeName, context }) => {
    const storageAdapter = getScopeStorageAdapter(scopeName)
    context.storageAdapter = storageAdapter
    const id = context.id

    const tableName = storageAdapter.getTableName()
    const idProperty = storageAdapter.getIdColumn()
    const db = context.db || api.knex.instance

    log.debug(`[Knex] DELETE ${tableName}/${id}`)

    // Check if record exists
    const exists = await db(tableName)
      .where(idProperty, id)
      .first()

    if (!exists) {
      throw new RestApiResourceError(
        'Resource not found',
        {
          subtype: ERROR_SUBTYPES.NOT_FOUND,
          resourceType: scopeName,
          resourceId: id
        }
      )
    }

    // Delete the record
    await invalidateDeletedPivotTargets(api, scopeName, context)
    await db(tableName)
      .where(idProperty, id)
      .delete()
    await deletePivotReferences(api, scopeName, context)

    return { success: true }
  }

  return {
    dataRelatedIdsQuery,
    dataExists,
    dataGet,
    dataQuery,
    dataPost,
    dataPut,
    dataPatch,
    dataDelete,
    dataGetMinimal
  }
}
