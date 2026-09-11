import { createKnexTransaction } from '../../lib/knex-transaction.js'
import { requirePackage } from 'hooked-api'
import { createSchema } from 'json-rest-schema'
import { deletePivotReferences, invalidateDeletedPivotTargets } from './lib/writing/many-to-many-manipulations.js'
import {
  createKnexTable,
  addKnexFields,
  alterKnexFields,
  generateKnexMigration,
  generateKnexMigrationDiff
} from './lib/dbTablesOperations.js'
import { introspectKnexTableSnapshot } from './lib/dbIntrospection.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from './lib/querying-writing/knex-field-helpers.js'
import { buildJsonApiResponse } from './lib/querying/knex-json-api-transformers-querying.js'
import { toJsonApiRecordWithBelongsTo } from './lib/querying-writing/knex-json-api-transformers.js'
import { processIncludes } from './lib/querying/knex-process-includes.js'
import { loadRelationshipIdentifiers } from './lib/querying/relationship-identifiers.js'
import { applyQueryConstraint } from './lib/querying/query-constraint.js'
import {
  polymorphicFiltersHook,
  crossTableFiltersHook,
  basicFiltersHook,
  prepareReferenceSortColumns
} from './lib/querying/knex-query-helpers.js'
import { RestApiResourceError } from '../../lib/rest-api-errors.js'
import { applyInsertReturning, getDatabaseCapabilities } from './lib/querying-writing/database-capabilities.js'
import { ERROR_SUBTYPES } from './lib/querying-writing/knex-constants.js'
import {
  calculatePaginationMeta,
  generatePaginationLinks,
  generateCursorPaginationLinks,
  buildCursorMeta,
  applyPaginationToQuery
} from './lib/querying/knex-pagination-helpers.js'
import { getUrlPrefix } from './lib/querying/url-helpers.js'
import { createStorageAdapterLookup } from './lib/storage/storage-adapter.js'
import { assertWritableKnexColumns } from './lib/storage/storage-mapping.js'
import { assertFieldNameMap } from './lib/querying-writing/field-utils.js'
import {
  applySortDescriptorOrder,
  buildEffectiveSortList,
  parseSortEntry,
  resolveSortField
} from './lib/querying/query-field-sort-helpers.js'
import { unwrapQueryBuilderState, withQueryFilteringContext } from './lib/querying/query-builder-utils.js'
import { serializeJsonApiQuery } from './lib/querying-writing/connectors-query-parser.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from './lib/querying-writing/database-value-normalizers.js'

export const RestApiKnexPlugin = {
  name: 'rest-api-knex',
  dependencies: ['rest-api'],

  async install ({ helpers, pluginOptions, api, log, scopes, addHook, addScopeMethod }) {
    // Try to import knex dynamically
    try {
      await import('knex')
    } catch (e) {
      requirePackage('knex', 'rest-api-knex',
        'Knex.js is required for database operations. This is a peer dependency that allows you to control the version.')
    }

    // Get Knex instance from plugin options
    const knexOptions = pluginOptions || {}
    const knex = knexOptions.knex

    // Expose Knex instance and helpers in a structured way
    api.knex = {
      instance: knex,
      helpers: {}
    }

    const getScopeStorageAdapter = createStorageAdapterLookup({
      knex,
      getResource: scopeName => api.resources?.[scopeName] || scopes?.[scopeName]
    })

    api.knex.helpers.getStorageAdapter = getScopeStorageAdapter
    helpers.getStorageAdapter = getScopeStorageAdapter

    addHook('scope:added', 'validate-knex-storage-columns', { afterFunction: 'compileResourceSchemas' }, ({ context }) => {
      assertWritableKnexColumns(context.vars.schemaInfo.storageInfo)
    })

    /** @type {import('./lib/storage/storage-types.js').DataRelatedIdsQuery} */
    helpers.dataRelatedIdsQuery = async ({ context, relDef }) => {
      const pivotScope = scopes[relDef.through]
      const pivotAdapter = getScopeStorageAdapter(relDef.through)
      if (!pivotScope || !pivotAdapter || !relDef.foreignKey || !relDef.otherKey) {
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
        .where(`${tableName}.${pivotAdapter.translateColumn(relDef.foreignKey)}`, pivotAdapter.translateFilterValue(relDef.foreignKey, context.id))
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

    const buildScopeTableSchema = (vars = {}) => {
      const schemaStructure = vars.schemaInfo?.schemaStructure || {}
      const filteredSchema = {}

      Object.entries(schemaStructure).forEach(([fieldName, fieldDef]) => {
        if (!fieldDef.virtual) {
          filteredSchema[fieldName] = fieldDef
        }
      })

      return {
        structure: filteredSchema,
        storage: vars.schemaInfo?.storage,
        indexes: vars.schemaInfo?.indexes || [],
        foreignKeys: vars.schemaInfo?.foreignKeys || [],
        checkConstraints: vars.schemaInfo?.checkConstraints || []
      }
    }

    const buildLegacySortDescriptors = async ({
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

        if (field !== 'id' && sortableFields?.length > 0 && !sortableFields.includes(field)) {
          log.warn(`Ignoring non-sortable field: ${field}`)
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

        const storageColumn = storageAdapter?.translateColumn
          ? storageAdapter.translateColumn(dbField)
          : dbField
        const reference = referenceColumns.get(field)
        const translatedField = reference?.column || (storageColumn.includes('.')
          ? storageColumn
          : `${storageAdapter?.getTableName?.() || schemaInfo.tableName}.${storageColumn}`)

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

    api.knex.capabilities = await getDatabaseCapabilities(knex, log)
    const { dbInfo, windowFunctions } = api.knex.capabilities

    log.info('Database capabilities detected:', {
      database: dbInfo.client,
      version: dbInfo.version,
      windowFunctions
    })

    // Cross-table search functions are now imported directly and used with full signatures

    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                  MAIN QUERY FILTERING HOOK                              ║
     * ║  This is the heart of the filtering system. It processes searchSchema   ║
     * ║  filters and builds SQL WHERE conditions with proper JOINs              ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    // Register the three separate filter hooks
    // Dependencies object for the hooks
    const polymorphicFiltersHookParams = { log, scopes, knex, getStorageAdapter: getScopeStorageAdapter }

    // Register in specific order: polymorphic → cross-table → basic
    // This ensures proper field qualification when JOINs are present

    // 1. Polymorphic filters (adds JOINs for polymorphic relationships)
    addHook('knexQueryFiltering', 'polymorphicFiltersHook', {},
      async (hookParams) => polymorphicFiltersHook(hookParams, polymorphicFiltersHookParams)
    )

    // 2. Cross-table filters (adds JOINs for cross-table fields)
    addHook('knexQueryFiltering', 'crossTableFiltersHook', {},
      async (hookParams) => crossTableFiltersHook(hookParams, polymorphicFiltersHookParams)
    )

    // 3. Basic filters (processes simple main table filters)
    addHook('knexQueryFiltering', 'basicFiltersHook', {},
      async (hookParams) => basicFiltersHook(hookParams, polymorphicFiltersHookParams)
    )

    // 3. Basic filters (processes simple main table filters)
    addHook('release', 'releaseHook', {},
      async ({ api }) => api.knex.instance.destroy()
    )

    // Helper scope method to get all schema-related information
    addScopeMethod('createKnexTable', async ({ vars, scope, scopeName, scopeOptions, runHooks }) => {
      const tableSchemaInstance = buildScopeTableSchema(vars)
      await createKnexTable(api.knex.instance, vars.schemaInfo, tableSchemaInstance, scopeOptions)
    })

    addScopeMethod('introspectKnexTableSnapshot', async ({ vars }) => {
      return introspectKnexTableSnapshot(api.knex.instance, {
        tableName: vars.schemaInfo.tableName,
        idColumn: vars.schemaInfo.idProperty
      })
    })

    addScopeMethod('generateKnexMigration', async ({ vars, scopeOptions }) => {
      return generateKnexMigration(
        vars.schemaInfo.tableName,
        buildScopeTableSchema(vars),
        {
          ...scopeOptions,
          idProperty: vars.schemaInfo.idProperty,
          dialect: api.knex.instance?.client?.config?.client
        }
      )
    })

    addScopeMethod('generateKnexMigrationDiff', async ({ vars, params }) => {
      const snapshot = await introspectKnexTableSnapshot(api.knex.instance, {
        tableName: vars.schemaInfo.tableName,
        idColumn: vars.schemaInfo.idProperty
      })

      return generateKnexMigrationDiff(
        vars.schemaInfo.tableName,
        snapshot,
        buildScopeTableSchema(vars),
        {
          ...(params?.options || {}),
          idProperty: vars.schemaInfo.idProperty,
          dialect: snapshot.dialect || api.knex.instance?.client?.config?.client
        }
      )
    })

    // Helper scope method to alter existing fields in a table
    addScopeMethod('alterKnexFields', async ({ vars, scope, scopeName, scopeOptions, runHooks, params }) => {
    // Validate required parameters
      if (!params.fields || typeof params.fields !== 'object') {
        throw new Error('fields parameter is required for alterKnexFields')
      }

      await alterKnexFields(
        api.knex.instance,
        vars.schemaInfo.tableName,
        { structure: params.fields },
        { storage: vars.schemaInfo.storage, ...params.options, idProperty: vars.schemaInfo.idProperty }
      )
    })

    // Helper scope method to add a field to an existing table
    addScopeMethod('addKnexFields', async ({ vars, scope, scopeName, scopeOptions, runHooks, params }) => {
      assertFieldNameMap(params.fields, `added fields in '${scopeName}'`)
      // Create schema object from filtered fields
      const partialTableSchema = createSchema(params.fields)

      await addKnexFields(
        api.knex.instance,
        vars.schemaInfo.tableName,
        partialTableSchema,
        { storage: vars.schemaInfo.storage, idProperty: vars.schemaInfo.idProperty }
      )
    })

    /** @type {import('../../lib/transaction-types.js').TransactionFactory} */
    helpers.newTransaction = context => createKnexTransaction(knex, context)

    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                    DATA OPERATION METHODS                           ║
     * ║  Implementation of the storage interface required by REST API plugin║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    /**
     * Checks if a resource exists in the database
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to check for existence
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @returns {Promise<boolean>} True if the resource exists, false otherwise
     */
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataWriteHelpers['dataExists']} */
    helpers.dataExists = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }

      const id = context.id

      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const idProperty = storageAdapter?.getIdColumn?.() || context.schemaInfo.idProperty
      const db = context.db || api.knex.instance

      log.debug(`[Knex] EXISTS ${tableName}/${id}`)

      const selectClause = idProperty !== 'id' ? `${idProperty} as id` : 'id'

      const record = await db(tableName)
        .where(idProperty, id)
        .select(selectClause)
        .first()

      return !!record
    }

    /**
     * Retrieves a single resource by ID with support for sparse fieldsets and includes
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to retrieve
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} [params.context.queryParams] - Query parameters for sparse fieldsets and includes
     * @param {Object} [params.context.queryParams.fields] - Sparse fieldset selections
     * @param {Array<string>} [params.context.queryParams.include] - Related resources to include
     * @param {Object} [params.context.computedDependencies] - Set by function to track computed field dependencies
     * @returns {Promise<Object>} JSON:API formatted response with data and optional included resources
     * @throws {RestApiResourceError} When the resource is not found
     */
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataReadHelpers['dataGet']} */
    helpers.dataGet = async ({ scopeName, context, runHooks }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const scope = api.resources[scopeName]
      if (!scope) {
        log.error('[DATA-GET] scope is undefined!', { scopeName, availableScopes: Object.keys(api.resources || {}) })
        throw new Error(`Scope '${scopeName}' not found in api.resources`)
      }
      if (!scope.scopeName && !scope.name) {
        log.debug('[DATA-GET] Scope structure:', {
          scopeKeys: Object.keys(scope),
          scopeName,
          hasVars: !!scope.vars,
          varKeys: scope.vars ? Object.keys(scope.vars) : []
        })
      }
      const id = context.id
      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const idProperty = storageAdapter?.getIdColumn?.() || context.schemaInfo.idProperty
      const db = context.db || api.knex.instance

      log.debug(`[Knex] GET ${tableName}/${id}`)

      // Build field selection for sparse fieldsets
      // This determines which fields to SELECT from database
      // and tracks dependencies needed for computed fields
      const fieldSelectionInfo = await buildFieldSelection(
        scope,
        { context }
      )

      // Store dependency info in context for enrichAttributes
      // Example: If user requests 'profit_margin' (computed), this might contain ['cost']
      // The REST API plugin will use this to remove 'cost' from response if not requested
      context.computedDependencies = fieldSelectionInfo.computedDependencies

      // Build query - no filtering hooks for single records
      // Permission checks will handle access control
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

      // Load relationship identifiers for all hasMany relationships
      const records = [record] // Wrap in array for processing
      await loadRelationshipIdentifiers(records, scopeName, scopes, db, context)

      // Process includes
      const included = await processIncludes(scope, records, {
        log,
        scopes,
        knex,
        context,
        api
      })

      // Build and return response
      return buildJsonApiResponse(scope, records, included, true, scopeName, context)
    }

    /**
     * Retrieves a single resource by ID with minimal processing (no includes or sparse fieldsets)
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to retrieve
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @returns {Promise<Object|null>} JSON:API formatted resource with belongsTo relationships, or null if not found
     */
    // Supplying ids returns minimal records for the caller's bounded validation batch.
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataReadHelpers['dataGetMinimal']} */
    helpers.dataGetMinimal = async ({
      scopeName,
      context,
      ids,
      runHooks,
      applyQueryFilters,
      filters = context.queryParams?.filters,
      queryPurpose = 'single'
    }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const scope = api.resources[scopeName]
      const id = context.id
      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const idProperty = storageAdapter?.getIdColumn?.() || context.schemaInfo.idProperty
      const db = context.db || api.knex.instance

      log.debug(`[Knex] GET_MINIMAL ${tableName}/${id}`)

      // Build query.
      // Single-record lookups still go through knexQueryFiltering when hooks are available,
      // so resource scoping plugins can treat GET/PUT/PATCH/DELETE the same way as collections.
      let query = ids === undefined
        ? db(tableName).where(idProperty, id)
        : db(tableName).whereIn(idProperty, ids.map(value => storageAdapter.translateFilterValue('id', value)))
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
      // Execute query
      if (ids !== undefined) {
        // Deduplicate policy joins by ID, without comparing JSON or other row values.
        const records = await applyDatabaseReadOptions(storageAdapter.buildBaseQuery({ transaction: db }).whereIn(idProperty, query).select(`${tableName}.*`, identities))
        return records.map(record => toJsonApiRecordWithBelongsTo(scope, record, scopeName))
      }
      const record = await applyDatabaseReadOptions(query.select(`${tableName}.*`, identities)).first()

      if (!record) {
        return null
      }

      // Transform to JSON:API format with belongsTo relationships
      return toJsonApiRecordWithBelongsTo(scope, record, scopeName)
    }

    /**
     * Queries resources with support for filtering, sorting, pagination, sparse fieldsets, and includes
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.schemaInfo.searchSchemaInstance - Search schema for filtering capabilities
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.queryParams - Query parameters object
     * @param {Object} [params.context.queryParams.filters] - Filter conditions
     * @param {Array<string>} [params.context.queryParams.sort] - Sort fields (prefix with - for DESC)
     * @param {Object} [params.context.queryParams.page] - Pagination parameters
     * @param {number} [params.context.queryParams.page.size] - Page size
     * @param {number} [params.context.queryParams.page.number] - Page number (offset pagination)
     * @param {string} [params.context.queryParams.page.after] - Cursor for forward pagination
     * @param {string} [params.context.queryParams.page.before] - Cursor for backward pagination
     * @param {Array<string>} [params.context.queryParams.include] - Related resources to include
     * @param {Object} [params.context.queryParams.fields] - Sparse fieldset selections
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Array<string>} params.context.sortableFields - Array of fields that can be sorted
     * @param {Object} [params.context.knexQuery] - Temporarily set during hooks for query building
     * @param {Object} [params.context.computedDependencies] - Set by function to track computed field dependencies
     * @param {Function} params.runHooks - Function to run hooks (e.g., 'knexQueryFiltering')
     * @returns {Promise<Object>} JSON:API formatted response with data array, optional included resources, and pagination meta/links
     */
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataReadHelpers['dataQuery']} */
    helpers.dataQuery = async ({ scopeName, context, runHooks }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const scope = api.resources[scopeName]
      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const schemaInfo = context.schemaInfo
      const queryParams = context.queryParams
      const db = context.db || api.knex.instance
      const sortableFields = context.sortableFields

      log.trace('[DATA-QUERY] Starting dataQuery', { scopeName })
      log.debug(`[Knex] QUERY ${tableName}`)

      // Build field selection for sparse fieldsets
      // This determines which fields to SELECT from database
      // and tracks dependencies needed for computed fields
      const fieldSelectionInfo = await buildFieldSelection(
        scope,
        { context }
      )

      // Store dependency info in context for enrichAttributes
      // Example: If user requests 'profit_margin' (computed), this might contain ['cost']
      // The REST API plugin will use this to remove 'cost' from response if not requested
      context.computedDependencies = fieldSelectionInfo.computedDependencies

      // Start building query with table prefix (for JOIN support)
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

      /* ═══════════════════════════════════════════════════════════════════
       * FILTERING HOOKS
       * This is where the magic happens. The knexQueryFiltering hook is called
       * to apply all filter conditions. The searchSchemaFilter hook (registered
       * above) will process the searchSchema and apply filters with JOINs.
       *
       * IMPORTANT: Each hook should wrap its conditions in query.where(function() {...})
       * to ensure proper grouping and prevent accidental filter bypass.
       * ═══════════════════════════════════════════════════════════════════ */

      log.trace('[DATA-QUERY] Calling knexQueryFiltering hook', { hasQuery: !!query, hasFilters: !!queryParams.filters, scopeName, tableName })

      log.trace('[DATA-QUERY] About to call runHooks', { hookName: 'knexQueryFiltering' })

      log.trace('[DATA-QUERY] Storing query data in context before calling runHooks')

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
        log.trace('[DATA-QUERY] Stored data in context', { hasStoredData: !!context.knexQuery })
        await runHooks('knexQueryFiltering')
      })
      query = filteredState.query

      log.trace('[DATA-QUERY] Finished knexQueryFiltering hook')

      const sortDescriptors = await buildLegacySortDescriptors({
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

      // Execute query
      const records = await applyDatabaseReadOptions(query)

      // Initialize returnMeta namespace for thread-safe metadata
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
          const total = parseInt(countResult.total)

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
        // Check if there are more records
        // We fetched pageSize + 1 records to detect if there are more
        const hasMore = records.length > pageSize

        // Remove the extra record if present
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
        for (const { resultColumn } of referenceSortDescriptors) delete record[resultColumn]
      }
      // Load relationship identifiers for all hasMany relationships
      await loadRelationshipIdentifiers(records, scopeName, scopes, db, context)

      // Process includes
      const included = await processIncludes(scope, records, {
        log,
        scopes,
        knex,
        context,
        api
      })

      // Build and return response
      return buildJsonApiResponse(scope, records, included, false, scopeName, context)
    }

    /**
     * Creates a new resource in the database
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} params.context.inputRecord - JSON:API formatted input record
     * @param {Object} params.context.inputRecord.data - The resource data
     * @param {Object} params.context.inputRecord.data.attributes - The resource attributes to insert
     * @returns {Promise<string|number>} The ID of the newly created resource
     */
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataWriteHelpers['dataPost']} */
    helpers.dataPost = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const idProperty = storageAdapter?.getIdColumn?.() || context.schemaInfo.idProperty
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
      const dbAttributes = storageAdapter?.toStorageRow
        ? storageAdapter.toStorageRow(attributes, {
          context,
          operation: 'post'
        })
        : attributes

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

    /**
     * Replaces an entire resource (PUT operation) or creates it with a specific ID
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to replace or create
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} params.context.inputRecord - JSON:API formatted input record
     * @param {Object} params.context.inputRecord.data - The resource data
     * @param {Object} [params.context.inputRecord.data.attributes] - The resource attributes
     * @param {Object} [params.context.inputRecord.data.relationships] - The resource relationships (processed for foreign keys)
     * @param {boolean} params.context.isCreate - Whether this is a create operation (true) or update (false)
     * @returns {Promise<void>} Resolves when the operation is complete
     * @throws {RestApiResourceError} When updating and the resource is not found
     */
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataWriteHelpers['dataPut']} */
    helpers.dataPut = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const id = context.id
      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const idProperty = storageAdapter?.getIdColumn?.() || context.schemaInfo.idProperty
      const db = context.db || api.knex.instance
      const inputRecord = context.inputRecord
      const isCreate = context.isCreate

      log.debug(`[Knex] PUT ${tableName}/${id} (isCreate: ${context.isCreate})`)

      // Core has already merged relationship values and applied setters.
      const attributes = inputRecord.data.attributes || {}

      // Strip non-database fields (computed and virtual) before database operation
      const finalAttributes = storageAdapter?.toStorageRow
        ? storageAdapter.toStorageRow(attributes, {
          context,
          operation: 'put'
        })
        : attributes

      // Map 'id' to actual idProperty if needed (for PUT with specific ID)
      if (idProperty !== 'id' && inputRecord.data.id) {
        finalAttributes[idProperty] = inputRecord.data.id
      }

      if (isCreate) {
        // Create mode - insert new record with specified ID
        const recordData = {
          ...finalAttributes,
          [idProperty]: id
        }

        await db(tableName).insert(recordData)
      } else {
        // Update mode - check if record exists first
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

        // Remove the idProperty from attributes to prevent updating the primary key
        delete finalAttributes[idProperty]

        // Update the record (replace all fields)
        if (Object.keys(finalAttributes).length > 0) {
          await db(tableName)
            .where(idProperty, id)
            .update(finalAttributes)
        }
      }
    }

    /**
     * Partially updates a resource (PATCH operation)
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to update
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} params.context.inputRecord - JSON:API formatted input record with partial updates
     * @param {Object} params.context.inputRecord.data - The resource data
     * @param {Object} [params.context.inputRecord.data.attributes] - The resource attributes to update
     * @param {Object} [params.context.inputRecord.data.relationships] - The resource relationships (processed for foreign keys)
     * @returns {Promise<void>} Resolves when the update is complete
     * @throws {RestApiResourceError} When the resource is not found
     */
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataWriteHelpers['dataPatch']} */
    helpers.dataPatch = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const id = context.id
      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const idProperty = storageAdapter?.getIdColumn?.() || context.schemaInfo.idProperty
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
      const finalAttributes = storageAdapter?.toStorageRow
        ? storageAdapter.toStorageRow(attributes, {
          context,
          operation: 'patch'
        })
        : attributes

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

    /**
     * Deletes a resource from the database
     *
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to delete
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @returns {Promise<Object>} Returns { success: true } when deletion is successful
     * @throws {RestApiResourceError} When the resource is not found
     */
    /** @type {import('./lib/storage/storage-types.js').OrdinaryDataWriteHelpers['dataDelete']} */
    helpers.dataDelete = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const id = context.id

      const tableName = storageAdapter?.getTableName?.() || context.schemaInfo.tableName
      const idProperty = storageAdapter?.getIdColumn?.() || context.schemaInfo.idProperty
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

    log.info('RestApiKnexPlugin installed - basic CRUD operations ready')
  }
}
