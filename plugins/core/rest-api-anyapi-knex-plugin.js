import { createCanonicalLinkStore } from './lib/anyapi/canonical-link-store.js'
import {
  createCanonicalRelationshipReader,
  decorateResourceLinks,
  getAllowedQueryFieldNames,
} from './lib/anyapi/canonical-relationship-reader.js'
import { createKnexTransaction } from '../../lib/knex-transaction.js'
import { ensureAnyApiSchema } from './lib/anyapi/schema-utils.js'
import { AnyapiRegistry } from './lib/anyapi/anyapi-registry.js'
import { applyQueryConstraint } from './lib/querying/query-constraint.js'
import { RestApiResourceError } from '../../lib/rest-api-errors.js'
import { compileSchemas } from './lib/querying-writing/compile-schemas.js'
import { snapshotResourceConfiguration } from './lib/querying-writing/schema-helpers.js'
import { assertFieldNameMap } from './lib/querying-writing/field-utils.js'
import {
  calculatePaginationMeta,
  generatePaginationLinks,
  generateCursorPaginationLinks,
  buildCursorMeta,
  applyPaginationToQuery,
} from './lib/querying/knex-pagination-helpers.js'
import { getUrlPrefix, buildJsonApiLink } from './lib/querying/url-helpers.js'
import { normalizeId, resolveFieldInfo } from './lib/anyapi/utils/descriptor-helpers.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from './lib/querying-writing/knex-field-helpers.js'
import { applyDatabaseReadOptions } from './lib/querying-writing/database-value-normalizers.js'
import {
  polymorphicFiltersHook,
  crossTableFiltersHook,
  basicFiltersHook,
  prepareReferenceSortColumns,
} from './lib/querying/knex-query-helpers.js'
import { createStorageAdapterLookup } from './lib/storage/storage-adapter.js'
import {
  translateCanonicalAttributesForStorage,
  getCanonicalResourceId,
  getCanonicalResourceIdColumn,
  translateCanonicalRecordFromStorage,
} from './lib/storage/canonical-storage-mapping.js'
import {
  applySortDescriptorOrder,
  buildEffectiveSortList,
  parseSortEntry,
  resolveSortField,
} from './lib/querying/query-field-sort-helpers.js'
import { unwrapQueryBuilderState, withQueryFilteringContext } from './lib/querying/query-builder-utils.js'
import { applyInsertReturning, getDatabaseCapabilities } from './lib/querying-writing/database-capabilities.js'
import { serializeJsonApiQuery } from './lib/querying-writing/connectors-query-parser.js'

const DEFAULT_TENANT = 'default'

export const RestApiAnyapiKnexPlugin = {
  name: 'rest-api-anyapi-knex',
  dependencies: ['rest-api'],

  async install ({ helpers, pluginOptions, api, log, addHook, addScopeMethod, scopes }) {
    const options = pluginOptions || {}
    const knex = options.knex
    const tenantId = options.tenantId || DEFAULT_TENANT

    if (!knex) {
      throw new Error('AnyapiKnexPlugin requires a knex instance')
    }

    await ensureAnyApiSchema(knex)

    const registry = new AnyapiRegistry({ knex, log })

    api.anyapi = api.anyapi || {}
    api.anyapi.registry = registry
    api.anyapi.tenantId = tenantId
    api.knex = {
      instance: knex,
      helpers: {},
      capabilities: await getDatabaseCapabilities(knex, log),
    }

    const getScopeStorageAdapter = createStorageAdapterLookup({
      knex,
      getResource: scopeName => api.resources?.[scopeName] || scopes?.[scopeName]
    })

    api.knex.helpers.getStorageAdapter = getScopeStorageAdapter
    helpers.getStorageAdapter = getScopeStorageAdapter

    const scopeOptionsRegistry = new Map()

    /** @type {import('../../lib/transaction-types.js').TransactionFactory} */
    helpers.newTransaction = context => createKnexTransaction(knex, context)

    addHook('release', 'anyapi-knex-release', {}, async ({ api }) => {
      if (api.knex?.instance) {
        await api.knex.instance.destroy()
      }
    })

    const getDescriptor = (scopeName) => {
      const descriptor = api.resources?.[scopeName]?.vars?.schemaInfo?.descriptor
      if (!descriptor) {
        throw new Error(`Descriptor not found for resource '${scopeName}'`)
      }
      return descriptor
    }

    const applySortingToQuery = async ({ query, sort, descriptor, scope, tableAlias, context, before = false, queryFieldRuntimeByField = new Map() }) => {
      const effectiveSort = buildEffectiveSortList(sort, {
        defaultSort: scope?.vars?.defaultSort,
        schemaInfo: scope.vars.schemaInfo,
        idField: 'id'
      })
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

    const linkStore = createCanonicalLinkStore({ api, getDescriptor, getScopeStorageAdapter })
    api.anyapi.links = linkStore.methods
    helpers.dataRelatedIdsQuery = linkStore.dataRelatedIdsQuery
    const { buildIncludes, attachReverseRelationships, attachManyToManyRelationships } = createCanonicalRelationshipReader({
      api, knex, getDescriptor, getScopeStorageAdapter, linkStore
    })

    /** @type {import('./lib/storage/storage-types.js').CanonicalDataWriteHelpers['dataExists']} */
    helpers.dataExists = async ({ scopeName, context }) => {
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

    /** @type {import('./lib/storage/storage-types.js').CanonicalDataWriteHelpers['dataPost']} */
    helpers.dataPost = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const descriptor = getDescriptor(scopeName)
      const { canonical } = descriptor
      const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
      const explicitId = normalizeId(context.inputRecord?.data?.id)
      const attributes = context.inputRecord?.data?.attributes || {}
      const row = storageAdapter?.toStorageRow
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

    /** @type {import('./lib/storage/storage-types.js').CanonicalDataWriteHelpers['dataPut']} */
    helpers.dataPut = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const descriptor = getDescriptor(scopeName)
      const { canonical } = descriptor
      const id = context.id
      const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
      const attributes = context.inputRecord?.data?.attributes || {}
      const row = storageAdapter?.toStorageRow
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

      if (Object.keys(writeRow).length === 0) {
        return 0
      }

      const result = await context.db(canonical.tableName)
        .where(logicalIdColumn, id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .update(writeRow)

      return result
    }

    /** @type {import('./lib/storage/storage-types.js').CanonicalDataWriteHelpers['dataPatch']} */
    helpers.dataPatch = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const descriptor = getDescriptor(scopeName)
      const { canonical } = descriptor
      const id = context.id
      const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
      const attributes = context.inputRecord?.data?.attributes || {}
      const row = storageAdapter?.toStorageRow
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

    /** @type {import('./lib/storage/storage-types.js').CanonicalDataWriteHelpers['dataDelete']} */
    helpers.dataDelete = async ({ scopeName, context }) => {
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
    /** @type {import('./lib/storage/storage-types.js').CanonicalDataReadHelpers['dataGetMinimal']} */
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
        query.whereIn(logicalIdColumn, ids.map(value => storageAdapter.translateFilterValue('id', value)))
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

      const toMinimal = row => {
        const translated = translateCanonicalRecordFromStorage(
          row,
          descriptor,
          { allowedExtraFields: getAllowedQueryFieldNames(api, scopeName) }
        )
        const minimal = {
          type: descriptor.resource,
          id: getCanonicalResourceId(row, descriptor),
          attributes: translated.attributes,
          relationships: translated.relationships,
        }
        if (scope) decorateResourceLinks({ resource: minimal, scope, scopeName, context })
        return minimal
      }
      if (ids !== undefined) {
        const rows = await applyDatabaseReadOptions(storageAdapter.buildBaseQuery({ transaction: context.db }).whereIn(logicalIdColumn, query))
        return rows.map(toMinimal)
      }
      const row = await applyDatabaseReadOptions(query).first()
      return row ? toMinimal(row) : null
    }

    /** @type {import('./lib/storage/storage-types.js').CanonicalDataReadHelpers['dataGet']} */
    helpers.dataGet = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const descriptor = getDescriptor(scopeName)
      const { canonical } = descriptor
      const id = context.id
      const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
      const scope = api.resources?.[scopeName]

      let fieldSelectionInfo = null
      if (scope) {
        fieldSelectionInfo = await buildFieldSelection(scope, { context })
        context.computedDependencies = fieldSelectionInfo.computedDependencies
      } else {
        context.computedDependencies = []
      }

      let query = context.db(canonical.tableName)
        .where(logicalIdColumn, id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)

      if (scope && fieldSelectionInfo) {
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
      }

      const row = await applyDatabaseReadOptions(query).first()

      if (!row) return null

      const record = translateCanonicalRecordFromStorage(
        row,
        descriptor,
        { allowedExtraFields: getAllowedQueryFieldNames(api, scopeName) }
      )
      const resourceId = getCanonicalResourceId(row, descriptor)
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

      const response = { data }
      if (included.length > 0 || context.queryParams?.include !== undefined) {
        response.included = included
      }

      if (scope) {
        decorateResourceLinks({ resource: data, scope, scopeName, context })
        response.links = { self: buildJsonApiLink(data.links.self, context.queryParams) }
      }

      if (included.length > 0) {
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
      }

      return response
    }

    const refreshStorageDescriptor = async (scopeName, compiledSchemaInfo) => {
      const scope = api.resources[scopeName]
      const schemaInfo = compiledSchemaInfo || scope.vars.schemaInfo
      const descriptor = await registry.getDescriptor(tenantId, scopeName)
      if (!descriptor) throw new Error(`Descriptor not found for resource '${scopeName}'`)
      descriptor.idProperty = schemaInfo.idProperty
      scope.vars.schemaInfo = {
        ...schemaInfo,
        descriptor,
        canonicalFieldMap: descriptor.canonicalFieldMap,
      }
      getScopeStorageAdapter(scopeName)
      scopeOptionsRegistry.set(scopeName, {
        ...scopeOptionsRegistry.get(scopeName),
        canonicalFieldsMap: descriptor.canonicalFieldMap,
      })
    }

    const buildSearchMembershipQuery = ({ sourceScopeName, relationshipName, targetScopeName, foreignKey, otherKey, db }) => {
      const info = linkStore.getManyToManyInfo(sourceScopeName, relationshipName)
      if (!info) throw new RestApiResourceError(`Relationship '${sourceScopeName}.${relationshipName}' not found`, { subtype: 'related_type_not_found' })
      const links = linkStore.buildRelatedLinkQuery({ ...info, db, allParents: true })
      const pivotAdapter = getScopeStorageAdapter(targetScopeName)
      return {
        query: db.select({
          [pivotAdapter.translateColumn(foreignKey)]: 'parentId',
          [pivotAdapter.translateColumn(otherKey)]: 'childId'
        }).from(links.as('search_membership'))
      }
    }

    const queryHookDependencies = { log, scopes: api.resources, knex, getStorageAdapter: getScopeStorageAdapter, buildSearchMembershipQuery }

    const applyBuiltInAnyApiQueryFilters = async (context) => {
      const hookParams = { context }
      await polymorphicFiltersHook(hookParams, queryHookDependencies)
      await crossTableFiltersHook(hookParams, queryHookDependencies)
      await basicFiltersHook(hookParams, queryHookDependencies)
    }

    /** @type {import('./lib/storage/storage-types.js').CanonicalDataReadHelpers['dataQuery']} */
    helpers.dataQuery = async ({ scopeName, context, runHooks }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const descriptor = getDescriptor(scopeName)
      const db = context.db || context.transaction || api.knex.instance
      const scope = api.resources?.[scopeName]
      const queryParams = context.queryParams || {}

      let fieldSelectionInfo = null
      if (scope) {
        fieldSelectionInfo = await buildFieldSelection(scope, { context })
        context.computedDependencies = fieldSelectionInfo.computedDependencies
      } else {
        context.computedDependencies = []
      }

      const tableAlias = scope.vars.schemaInfo.tableName || descriptor.resource
      let queryBuilder = storageAdapter.buildBaseQuery({ transaction: db, tableAlias })
      applyQueryConstraint({ query: queryBuilder, context, scopeName, storageAdapter, tableName: tableAlias })

      const schemaInfo = scope?.vars?.schemaInfo
      const tableNameForHooks = schemaInfo?.tableName || descriptor.resource

      const filteredState = await withQueryFilteringContext(context, {
        query: queryBuilder,
        filters: queryParams.filters,
        schemaInfo,
        scopeName,
        tableName: tableNameForHooks,
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

      let selectionState = { query: queryBuilder, queryFieldRuntimeByField: new Map() }
      if (scope && fieldSelectionInfo) {
        selectionState = await applyFieldSelectionToQuery({
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
      }

      const sortDescriptors = await applySortingToQuery({
        query: selectionState.query,
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

      let rows = await applyDatabaseReadOptions(queryBuilder)
      let cursorRecords = null
      let hasMore = false

      if (paginationInfo.mode === 'cursor') {
        const { pageSize } = paginationInfo
        cursorRecords = rows.map((row) => {
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

        if (rows.length > pageSize) {
          hasMore = true
          rows = rows.slice(0, pageSize)
          cursorRecords = cursorRecords.slice(0, pageSize)
        }
        if (paginationInfo.before) {
          rows.reverse()
          cursorRecords.reverse()
        }
      }

      for (const row of rows) {
        for (const { referenceField, resultColumn } of sortDescriptors) {
          if (referenceField) delete row[resultColumn]
        }
      }
      const data = rows.map((row) => {
        const translated = translateCanonicalRecordFromStorage(
          row,
          descriptor,
          { allowedExtraFields: getAllowedQueryFieldNames(api, scopeName) }
        )
        const resourceId = getCanonicalResourceId(row, descriptor)
        const resource = {
          type: descriptor.resource,
          id: resourceId,
          attributes: translated.attributes,
        }
        if (translated.relationships && Object.keys(translated.relationships).length > 0) {
          resource.relationships = translated.relationships
        }
        const resourceScope = scope
        if (resourceScope) {
          decorateResourceLinks({ resource, scope: resourceScope, scopeName, context })
        }
        if (fieldSelectionInfo?.computedDependencies?.length) {
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

      const response = { data }
      if (included.length > 0 || context.queryParams?.include !== undefined) {
        response.included = included
      }

      if (included.length > 0) {
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
      }

      context.returnMeta = context.returnMeta || {}
      const queryString = serializeJsonApiQuery(queryParams)
      context.returnMeta.queryString = queryString ? `?${queryString}` : ''
      delete context.returnMeta.paginationMeta
      delete context.returnMeta.paginationLinks

      if (paginationInfo.mode === 'offset') {
        const { page, pageSize } = paginationInfo
        let paginationMeta

        if (scope?.vars?.enablePaginationCounts) {
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
      } else if (scope) {
        const urlPrefix = getUrlPrefix(context, scope)
        response.links = {
          self: `${urlPrefix}/${scopeName}${context.returnMeta.queryString || ''}`,
        }
      }

      return response
    }

    /** @type {import('./lib/storage/storage-types.js').DataQueryCount} */
    helpers.dataQueryCount = async ({ scopeName, context }) => {
      const storageAdapter = getScopeStorageAdapter(scopeName)
      if (storageAdapter) {
        context.storageAdapter = storageAdapter
      }
      const descriptor = getDescriptor(scopeName)
      const db = context.db || context.transaction || api.knex.instance
      // Apply the same filter hooks as dataQuery for consistent counts
      const scope = api.resources?.[scopeName]
      const schemaInfo = scope?.vars?.schemaInfo
      const tableNameForHooks = schemaInfo?.tableName || descriptor.resource

      const query = storageAdapter.buildBaseQuery({ transaction: db, tableAlias: tableNameForHooks })
      const countContext = {
        ...context,
        knexQuery: {
          query,
          filters: context.queryParams?.filters,
          schemaInfo,
          scopeName,
          tableName: tableNameForHooks,
          db,
          queryPurpose: 'count',
          isAnyApi: true,
          adapter: storageAdapter,
          storageAdapter,
        }
      }

      const hookParams = { context: countContext }
      await polymorphicFiltersHook(hookParams, queryHookDependencies)
      await crossTableFiltersHook(hookParams, queryHookDependencies)
      await basicFiltersHook(hookParams, queryHookDependencies)
      await api.runHooks('knexQueryFiltering', countContext)

      const countQuery = countContext.knexQuery?.query || query
      const [{ count }] = await countQuery.count({ count: '*' })
      return Number(count)
    }

    addHook('scope:added', 'anyapi-register-resource', { sequence: 50 }, async ({ context }) => {
      const { scopeName, scopeOptions = {} } = context
      const scope = api.resources[scopeName]
      const { schemaStructure, computed, schemaRelationships, idProperty } = scope.vars.schemaInfo
      const descriptor = await registry.registerResource({
        tenant: tenantId,
        resource: scopeName,
        schema: { ...schemaStructure, ...computed },
        relationships: schemaRelationships,
        canonicalFieldMap: scopeOptions.canonicalFieldsMap || null,
        idProperty
      })
      scopeOptionsRegistry.set(scopeName, snapshotResourceConfiguration({
        ...scopeOptions,
        idProperty,
        canonicalFieldsMap: descriptor.canonicalFieldMap
      }))
      await refreshStorageDescriptor(scopeName)
    })

    addScopeMethod('createKnexTable', async ({ scopeName }) => {
      await ensureAnyApiSchema(knex)
      await refreshStorageDescriptor(scopeName)
    })

    addScopeMethod('addKnexFields', async ({ scopeName, params }) => {
      if (!params?.fields || typeof params.fields !== 'object' || Array.isArray(params.fields)) {
        throw new Error('fields parameter is required for addKnexFields')
      }
      assertFieldNameMap(params.fields, `added fields in '${scopeName}'`)
      assertFieldNameMap(params.searchSchema, `added search schema in '${scopeName}'`)
      assertFieldNameMap(params.canonicalFieldsMap, `added canonical fields in '${scopeName}'`)
      const scope = api.resources[scopeName]
      const storedBefore = scopeOptionsRegistry.get(scopeName) || {}
      const unknown = Object.keys(params.canonicalFieldsMap || {}).filter(field => !Object.hasOwn(params.fields, field))
      if (unknown.length) {
        throw new Error(`canonicalFieldsMap contains unknown fields for addKnexFields: ${unknown}`)
      }
      const updatedStored = snapshotResourceConfiguration({
        ...storedBefore,
        schema: { ...storedBefore.schema, ...params.fields },
        searchSchema: { ...storedBefore.searchSchema, ...params.searchSchema }
      })
      const compiled = { scopeOptions: updatedStored, vars: { idProperty: scope.vars.idProperty } }
      await compileSchemas(compiled, { context: { scopeName }, runHooks: (name, context) => api.runHooks(name, context) })
      await api.transaction(async transaction => {
        for (const fieldName of Object.keys(params.fields)) {
          await registry.allocateField({
            tenant: tenantId,
            resource: scopeName,
            fieldName,
            definition: compiled.vars.schemaInfo.schemaStructure[fieldName] || compiled.vars.schemaInfo.computed[fieldName],
            canonicalField: params.canonicalFieldsMap?.[fieldName]
          }, { transaction })
        }
      })
      registry.invalidateDescriptor(tenantId, scopeName)
      scopeOptionsRegistry.set(scopeName, updatedStored)
      await refreshStorageDescriptor(scopeName, compiled.vars.schemaInfo)
    })

    addScopeMethod('alterKnexFields', async () => {
      throw new Error('alterKnexFields is not supported by AnyAPI Knex plugin yet')
    })
  },
}
