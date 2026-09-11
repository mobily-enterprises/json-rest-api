import { whereInIdentifiers } from '../querying/identifier-query.js'
import { loadIncludedParentMap, parseIncludeTree } from '../querying/include-query-helpers.js'
import { getResourceFieldset, parseFieldset } from '../querying-writing/field-utils.js'
import { COMPUTED_DEPENDENCIES_KEY, RELATIONSHIP_READ_BATCH_SIZE } from '../querying-writing/knex-constants.js'
import { buildResourceUrl, buildRelationshipUrl } from '../querying/url-helpers.js'
import { normalizeId } from './utils/descriptor-helpers.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from '../querying-writing/knex-field-helpers.js'
import { applyDatabaseReadOptions } from '../querying-writing/database-value-normalizers.js'
import {
  getCanonicalResourceId,
  getCanonicalResourceIdColumn,
  translateCanonicalRecordFromStorage,
} from '../storage/canonical-storage-mapping.js'
import { buildEffectiveSortList } from '../querying/query-field-sort-helpers.js'
import { unwrapQueryBuilderState } from '../querying/query-builder-utils.js'
import { applyIncludeQueryConfig } from '../querying/knex-window-queries.js'

export const decorateResourceLinks = ({ resource, scope, scopeName, context }) => {
  if (!resource || !scope || !scopeName || !context) return

  resource.links = resource.links || {}
  resource.links.self = buildResourceUrl(context, scope, scopeName, resource.id)

  if (!resource.relationships || typeof resource.relationships !== 'object') {
    return
  }

  for (const [relationshipName, relationshipObject] of Object.entries(resource.relationships)) {
    if (!relationshipObject || typeof relationshipObject !== 'object') {
      continue
    }

    relationshipObject.links = {
      self: buildRelationshipUrl(context, scope, scopeName, resource.id, relationshipName, true),
      related: buildRelationshipUrl(context, scope, scopeName, resource.id, relationshipName, false),
    }
  }
}

export const getAllowedQueryFieldNames = (api, scopeName) => (
  Object.keys(api.resources?.[scopeName]?.vars?.schemaInfo?.queryFields || {})
)

// Relationship reads share the installed API and link store, never request state.
export function createCanonicalRelationshipReader ({ api, knex, getDescriptor, getScopeStorageAdapter, linkStore }) {
  const { getManyToManyInfo, buildRelatedLinkQuery, buildVisibleLinkTargets, fetchLinksForParents } = linkStore
  const applyTargetScopeFilters = async ({
    query,
    resourceName,
    tableName,
    context,
    filters,
    queryPurpose = 'include'
  }) => {
    const targetScope = api.resources?.[resourceName]
    if (!targetScope?.applyQueryFilters) {
      return { query }
    }

    const storageAdapter = getScopeStorageAdapter(resourceName)
    const queryState = await targetScope.applyQueryFilters({
      query,
      filters,
      schemaInfo: targetScope.vars?.schemaInfo,
      scopeName: resourceName,
      tableName,
      db: context.db || context.transaction || api.knex.instance,
      isAnyApi: true,
      queryPurpose,
      storageAdapter
    }, {
      ...context,
      scopeName: resourceName,
      schemaInfo: targetScope.vars?.schemaInfo,
      storageAdapter
    })

    return {
      query: unwrapQueryBuilderState(queryState, query)
    }
  }

  const applyIncludeFieldSelection = async ({ query, resourceName, tableName, context }) => {
    const targetScope = api.resources?.[resourceName]
    if (!targetScope) {
      return { query, fieldSelectionInfo: null }
    }

    const storageAdapter = getScopeStorageAdapter(resourceName)
    const fieldSelectionInfo = await buildFieldSelection(targetScope, {
      context: {
        ...context,
        scopeName: resourceName,
        schemaInfo: targetScope.vars.schemaInfo,
        storageAdapter,
      }
    })

    const selectionState = await applyFieldSelectionToQuery({
      query,
      scope: targetScope,
      fieldSelectionInfo,
      tableName,
      useTablePrefix: false,
      storageAdapter,
      db: context.db || context.transaction || api.knex.instance,
      context,
      scopeName: resourceName
    })

    return {
      ...selectionState,
      fieldSelectionInfo
    }
  }

  const buildIncludedResource = ({ row, descriptor, context, fieldSelectionInfo = null }) => {
    const translated = translateCanonicalRecordFromStorage(
      row,
      descriptor,
      { allowedExtraFields: getAllowedQueryFieldNames(api, descriptor.resource) }
    )
    const resourceId = getCanonicalResourceId(row, descriptor)
    const includeResource = {
      type: descriptor.resource,
      id: resourceId,
      attributes: translated.attributes,
    }

    if (translated.relationships && Object.keys(translated.relationships).length > 0) {
      includeResource.relationships = translated.relationships
    }

    if (fieldSelectionInfo?.computedDependencies?.length) {
      includeResource[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies
    }

    const targetScope = api.resources?.[descriptor.resource]
    if (targetScope) {
      decorateResourceLinks({
        resource: includeResource,
        scope: targetScope,
        scopeName: descriptor.resource,
        context,
      })
    }

    return includeResource
  }

  const includeRow = (options, includes) => {
    const id = getCanonicalResourceId(options.row, options.descriptor)
    const key = `${options.descriptor.resource}:${id}`
    if (!includes.has(key)) {
      includes.set(key, buildIncludedResource(options))
    }
    return includes.get(key)
  }

  const collectIncludes = async ({ descriptor, resources, includeTree, context, includes }) => {
    const entries = Object.entries(includeTree || {})
    if (entries.length === 0 || !resources || resources.length === 0) return

    const db = context.db || context.transaction || api.knex.instance

    for (const [relName, childTree] of entries) {
      const childKeys = Object.keys(childTree || {})

      const belongsToInfo = Object.hasOwn(descriptor.belongsTo || {}, relName) ? descriptor.belongsTo[relName] : undefined
      if (belongsToInfo) {
        const ids = [...new Set(resources
          .map((resource) => resource.relationships?.[relName]?.data?.id)
          .filter((id) => id !== undefined && id !== null))]

        if (ids.length === 0) continue

        const targetDescriptor = getDescriptor(belongsToInfo.target)

        const nestedResources = []
        for (let offset = 0; offset < ids.length; offset += RELATIONSHIP_READ_BATCH_SIZE) {
          let query = db(targetDescriptor.canonical.tableName)
            .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
            .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
            .whereIn(getCanonicalResourceIdColumn(targetDescriptor), ids.slice(offset, offset + RELATIONSHIP_READ_BATCH_SIZE))
          const selectionState = await applyIncludeFieldSelection({
            query,
            resourceName: targetDescriptor.resource,
            tableName: targetDescriptor.canonical.tableName,
            context
          })
          query = selectionState.query
          const scopedQueryState = await applyTargetScopeFilters({
            query,
            resourceName: targetDescriptor.resource,
            tableName: targetDescriptor.canonical.tableName,
            context
          })
          query = scopedQueryState.query
          const rows = await applyDatabaseReadOptions(query)

          for (const row of rows) {
            const includeResource = includeRow({
              row,
              descriptor: targetDescriptor,
              context,
              fieldSelectionInfo: selectionState.fieldSelectionInfo
            }, includes)
            nestedResources.push(includeResource)
          }
        }

        if (childKeys.length > 0 && nestedResources.length > 0) {
          await attachReverseRelationships({ resources: nestedResources, descriptor: targetDescriptor, context, includeTree: childTree })
          await attachManyToManyRelationships({ resources: nestedResources, descriptor: targetDescriptor, context, includeTree: childTree })
          await collectIncludes({
            descriptor: targetDescriptor,
            resources: nestedResources,
            includeTree: childTree,
            context,
            includes,
          })
        }
        continue
      }

      const polymorphicInfo = Object.hasOwn(descriptor.polymorphicBelongsTo || {}, relName) ? descriptor.polymorphicBelongsTo[relName] : undefined
      if (polymorphicInfo) {
        const typeToIds = new Map()
        for (const resource of resources) {
          const relData = resource.relationships?.[relName]?.data
          if (!relData?.type || relData?.id == null) continue
          const targetType = String(relData.type)
          const targetId = normalizeId(relData.id)
          if (targetId == null) continue
          if (!typeToIds.has(targetType)) {
            typeToIds.set(targetType, new Set())
          }
          typeToIds.get(targetType).add(targetId)
        }

        const nestedResources = []
        for (const [targetType, idSet] of typeToIds.entries()) {
          if (idSet.size === 0) continue
          const targetDescriptor = getDescriptor(targetType)

          const ids = [...idSet]
          for (let offset = 0; offset < ids.length; offset += RELATIONSHIP_READ_BATCH_SIZE) {
            let query = db(targetDescriptor.canonical.tableName)
              .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
              .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
              .whereIn(getCanonicalResourceIdColumn(targetDescriptor), ids.slice(offset, offset + RELATIONSHIP_READ_BATCH_SIZE))
            const selectionState = await applyIncludeFieldSelection({
              query,
              resourceName: targetDescriptor.resource,
              tableName: targetDescriptor.canonical.tableName,
              context
            })
            query = selectionState.query
            const scopedQueryState = await applyTargetScopeFilters({
              query,
              resourceName: targetDescriptor.resource,
              tableName: targetDescriptor.canonical.tableName,
              context
            })
            query = scopedQueryState.query
            const rows = await applyDatabaseReadOptions(query)

            for (const row of rows) {
              const includeResource = includeRow({
                row,
                descriptor: targetDescriptor,
                context,
                fieldSelectionInfo: selectionState.fieldSelectionInfo
              }, includes)
              nestedResources.push(includeResource)
            }
          }
        }

        if (childKeys.length > 0 && nestedResources.length > 0) {
          const resourcesByType = new Map()
          for (const includeResource of nestedResources) {
            if (!resourcesByType.has(includeResource.type)) {
              resourcesByType.set(includeResource.type, [])
            }
            resourcesByType.get(includeResource.type).push(includeResource)
          }

          for (const [targetType, groupedResources] of resourcesByType.entries()) {
            const targetDescriptor = getDescriptor(targetType)

            await attachReverseRelationships({ resources: groupedResources, descriptor: targetDescriptor, context, includeTree: childTree })
            await attachManyToManyRelationships({ resources: groupedResources, descriptor: targetDescriptor, context, includeTree: childTree })
            await collectIncludes({
              descriptor: targetDescriptor,
              resources: groupedResources,
              includeTree: childTree,
              context,
              includes,
            })
          }
        }

        continue
      }

      const reverseInfo = Object.hasOwn(descriptor.relationships || {}, relName) ? descriptor.relationships[relName] : undefined
      if (['hasMany', 'hasOne'].includes(reverseInfo?.type) && reverseInfo.target && (reverseInfo.foreignKey || reverseInfo.via)) {
        const targetDescriptor = getDescriptor(reverseInfo.target)
        const parentIds = resources.map(resource => normalizeId(resource.id)).filter(id => id !== null)
        if (parentIds.length === 0) continue
        const groupingColumn = reverseInfo.foreignKey
          ? getScopeStorageAdapter(targetDescriptor.resource).translateColumn(reverseInfo.foreignKey)
          : targetDescriptor.polymorphicBelongsTo?.[reverseInfo.via]?.idColumn
        if (!groupingColumn) throw new Error(`Missing grouping column for reverse relationship '${descriptor.resource}.${relName}'`)
        const tableName = targetDescriptor.canonical.tableName
        const query = getScopeStorageAdapter(targetDescriptor.resource).buildBaseQuery({ transaction: db })
          .modify(whereInIdentifiers, groupingColumn, parentIds)
        if (reverseInfo.via) query.where(targetDescriptor.polymorphicBelongsTo[reverseInfo.via].typeColumn, descriptor.resource)
        const includeConfig = api.resources[descriptor.resource].vars.schemaInfo.schemaRelationships[relName]?.include || {}
        const includeContext = { ...context, queryParams: { fields: context.queryParams?.fields, sort: buildEffectiveSortList(includeConfig.orderBy, { defaultSort: api.resources[targetDescriptor.resource].vars.defaultSort }) } }
        const selection = await applyIncludeFieldSelection({ query, resourceName: targetDescriptor.resource, tableName, context: includeContext })
        const filtered = await applyTargetScopeFilters({ query: selection.query, resourceName: targetDescriptor.resource, tableName, context })
        const limited = reverseInfo.type === 'hasOne'
          ? { query: filtered.query, parentColumn: groupingColumn, temporaryFields: [] }
          : await applyIncludeQueryConfig({
            query: filtered.query,
            scopeName: targetDescriptor.resource,
            tableName,
            parentColumn: `${tableName}.${groupingColumn}`,
            includeConfig,
            context: includeContext,
            capabilities: api.knex.capabilities,
            queryFieldRuntimeByField: selection.queryFieldRuntimeByField
          }, { scopes: api.resources, knex, getStorageAdapter: getScopeStorageAdapter })
        let rows = await limited.query
        if (reverseInfo.type === 'hasOne') rows = [...new Map(rows.map(row => [String(row[groupingColumn]), row])).values()]
        const linkage = new Map()
        const nestedResources = []
        for (const row of rows) {
          const parentId = String(row[limited.parentColumn])
          if (!linkage.has(parentId)) linkage.set(parentId, [])
          linkage.get(parentId).push({ type: targetDescriptor.resource, id: getCanonicalResourceId(row, targetDescriptor) })
          for (const field of limited.temporaryFields) delete row[field]
          nestedResources.push(includeRow({ row, descriptor: targetDescriptor, context, fieldSelectionInfo: selection.fieldSelectionInfo }, includes))
        }
        for (const resource of resources) {
          resource.relationships ||= {}
          const children = linkage.get(String(resource.id)) || []
          resource.relationships[relName] = { ...resource.relationships[relName], data: reverseInfo.type === 'hasOne' ? (children[0] || null) : children }
        }
        if (childKeys.length > 0 && nestedResources.length > 0) {
          await attachReverseRelationships({ resources: nestedResources, descriptor: targetDescriptor, context, includeTree: childTree })
          await attachManyToManyRelationships({ resources: nestedResources, descriptor: targetDescriptor, context, includeTree: childTree })
          await collectIncludes({ descriptor: targetDescriptor, resources: nestedResources, includeTree: childTree, context, includes })
        }
        continue
      }

      const manyInfo = Object.hasOwn(descriptor.manyToMany || {}, relName) ? descriptor.manyToMany[relName] : undefined
      if (manyInfo) {
        const info = getManyToManyInfo(descriptor.resource, relName)
        if (!info) continue
        const links = buildRelatedLinkQuery({ ...info, parentIds: resources.map(resource => resource.id), db })
        const targetDescriptor = getDescriptor(info.relInfo.target)
        const tableName = targetDescriptor.canonical.tableName
        const storageAdapter = getScopeStorageAdapter(targetDescriptor.resource)
        const includeConfig = api.resources[descriptor.resource].vars.schemaInfo.schemaRelationships[relName]?.include || {}
        const perParent = includeConfig.strategy === 'window'
        const query = storageAdapter.buildBaseQuery({ transaction: db })
        if (perParent) query.join(links.as('pivot'), `${tableName}.${storageAdapter.getIdColumn()}`, 'pivot.childId')
        else query.whereIn(`${tableName}.${storageAdapter.getIdColumn()}`, db.select('childId').from(links.clone().as('include_candidates')))
        const includeContext = { ...context, queryParams: { fields: context.queryParams?.fields, sort: buildEffectiveSortList(includeConfig.orderBy, { defaultSort: api.resources[targetDescriptor.resource].vars.defaultSort }) } }
        const selection = await applyIncludeFieldSelection({ query, resourceName: targetDescriptor.resource, tableName, context: includeContext })
        const filtered = await applyTargetScopeFilters({ query: selection.query, resourceName: targetDescriptor.resource, tableName, context })
        const limited = await applyIncludeQueryConfig({
          query: filtered.query,
          scopeName: targetDescriptor.resource,
          tableName,
          parentColumn: perParent ? 'pivot.parentId' : db.raw('NULL'),
          includeConfig,
          context: includeContext,
          capabilities: api.knex.capabilities,
          queryFieldRuntimeByField: selection.queryFieldRuntimeByField
        }, { scopes: api.resources, knex, getStorageAdapter: getScopeStorageAdapter })
        const rows = await limited.query
        const parentsByChild = perParent
          ? null
          : await loadIncludedParentMap({
            query: storageAdapter.buildBaseQuery({ transaction: db })
              .join(links.clone().as('pivot'), `${tableName}.${storageAdapter.getIdColumn()}`, 'pivot.childId')
              .select({ parentId: 'pivot.parentId', childId: `${tableName}.${storageAdapter.getIdColumn()}` }),
            parentIds: resources.map(resource => resource.id),
            childIds: rows.map(row => getCanonicalResourceId(row, targetDescriptor)),
            knex: db
          })
        const linkage = new Map()
        const nestedResources = []
        for (const row of rows) {
          const id = getCanonicalResourceId(row, targetDescriptor)
          const parents = perParent ? [String(row[limited.parentColumn])] : parentsByChild.get(String(id))
          if (!parents) continue
          for (const parentId of parents) {
            if (!linkage.has(parentId)) linkage.set(parentId, [])
            linkage.get(parentId).push({ type: targetDescriptor.resource, id })
          }
          for (const field of limited.temporaryFields) delete row[field]
          nestedResources.push(includeRow({ row, descriptor: targetDescriptor, context, fieldSelectionInfo: selection.fieldSelectionInfo }, includes))
        }
        for (const resource of resources) {
          resource.relationships ||= {}
          resource.relationships[relName] = { ...resource.relationships[relName], data: linkage.get(String(resource.id)) || [] }
        }

        if (childKeys.length > 0 && nestedResources.length > 0) {
          await attachReverseRelationships({ resources: nestedResources, descriptor: targetDescriptor, context, includeTree: childTree })
          await attachManyToManyRelationships({ resources: nestedResources, descriptor: targetDescriptor, context, includeTree: childTree })
          await collectIncludes({
            descriptor: targetDescriptor,
            resources: nestedResources,
            includeTree: childTree,
            context,
            includes,
          })
        }
      }
    }
  }

  const buildIncludes = async ({ parentResources, descriptor, context }) => {
    const includeTree = parseIncludeTree(context.queryParams?.include)
    if (Object.keys(includeTree).length === 0) return []

    // A cyclic path enriches primary linkage on the same resource object.
    const primary = new Map(parentResources.map(resource => [`${resource.type}:${resource.id}`, resource]))
    const includes = new Map(primary)

    await collectIncludes({
      descriptor,
      resources: parentResources,
      includeTree,
      context,
      includes,
    })

    return [...includes].filter(([key]) => !primary.has(key)).map(([, resource]) => resource)
  }

  const attachReverseRelationships = async ({ resources, descriptor, context, includeTree = parseIncludeTree(context.queryParams?.include) }) => {
    if (!resources || resources.length === 0) return
    const requestedFields = parseFieldset(getResourceFieldset(context.queryParams?.fields, descriptor.resource))
    const reverseEntries = Object.entries(descriptor.relationships || {})
      .filter(([, relDef]) => ['hasMany', 'hasOne'].includes(relDef?.type) && relDef.target && (relDef.foreignKey || relDef.via))
      .filter(([name]) => requestedFields === null || requestedFields.includes(name))
      .filter(([name]) => !Object.hasOwn(includeTree, name))

    if (reverseEntries.length === 0) return

    const db = context.db || context.transaction || api.knex.instance

    for (const [relName, relDef] of reverseEntries) {
      // Default linkage must not replace an explicitly loaded include limit.
      const pendingResources = resources.filter(resource => !Object.hasOwn(resource.relationships || {}, relName))
      const normalizedParentIds = pendingResources.map(resource => normalizeId(resource.id)).filter(id => id !== null)
      if (normalizedParentIds.length === 0) continue
      const targetDescriptor = getDescriptor(relDef.target)

      if (relDef.foreignKey) {
        const foreignField = targetDescriptor.fields?.[relDef.foreignKey]
        if (!foreignField?.slot) throw new Error(`Reverse relationship '${descriptor.resource}.${relName}' requires field '${relDef.target}.${relDef.foreignKey}'`)
        const column = foreignField.slot

        let query = db(targetDescriptor.canonical.tableName)
          .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
          .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
          .modify(whereInIdentifiers, column, normalizedParentIds)
          .select(['id', getCanonicalResourceIdColumn(targetDescriptor), column].map(name => `${targetDescriptor.canonical.tableName}.${name}`))
        const scopedQueryState = await applyTargetScopeFilters({
          query,
          resourceName: targetDescriptor.resource,
          tableName: targetDescriptor.canonical.tableName,
          context,
          queryPurpose: 'relationship-identifiers'
        })
        query = scopedQueryState.query
        const rows = await applyDatabaseReadOptions(query)

        const grouped = rows.reduce((acc, row) => {
          const parentId = row[column]
          if (parentId == null) return acc
          const key = String(parentId)
          acc[key] = acc[key] || []
          acc[key].push({ type: targetDescriptor.resource, id: getCanonicalResourceId(row, targetDescriptor) })
          return acc
        }, Object.create(null))

        for (const resource of pendingResources) {
          resource.relationships = resource.relationships || {}
          const related = grouped[String(resource.id)] || []
          resource.relationships[relName] = { data: relDef.type === 'hasOne' ? (related.at(-1) || null) : related }
        }

        continue
      }

      if (relDef.via) {
        const polyInfo = targetDescriptor.polymorphicBelongsTo?.[relDef.via]
        if (!polyInfo?.idColumn || !polyInfo?.typeColumn) {
          throw new Error(`Reverse relationship '${descriptor.resource}.${relName}' requires polymorphic relationship '${relDef.target}.${relDef.via}'`)
        }

        const queryIds = Array.from(new Set([
          ...normalizedParentIds,
          ...normalizedParentIds
            .map((id) => {
              const numeric = Number(id)
              return Number.isFinite(numeric) ? numeric : null
            })
            .filter((value) => value !== null),
        ]))

        let query = db(targetDescriptor.canonical.tableName)
          .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
          .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
          .where(polyInfo.typeColumn, descriptor.resource)
          .modify(whereInIdentifiers, polyInfo.idColumn, queryIds)
          .select(['id', getCanonicalResourceIdColumn(targetDescriptor), polyInfo.idColumn].map(name => `${targetDescriptor.canonical.tableName}.${name}`))
        const scopedQueryState = await applyTargetScopeFilters({
          query,
          resourceName: targetDescriptor.resource,
          tableName: targetDescriptor.canonical.tableName,
          context,
          queryPurpose: 'relationship-identifiers'
        })
        query = scopedQueryState.query
        const rows = await applyDatabaseReadOptions(query)

        const grouped = rows.reduce((acc, row) => {
          const parentId = row[polyInfo.idColumn]
          if (parentId == null) return acc
          const key = String(parentId)
          acc[key] = acc[key] || []
          acc[key].push({ type: targetDescriptor.resource, id: getCanonicalResourceId(row, targetDescriptor) })
          return acc
        }, Object.create(null))

        for (const resource of pendingResources) {
          resource.relationships = resource.relationships || {}
          const related = grouped[String(resource.id)] || []
          resource.relationships[relName] = { data: relDef.type === 'hasOne' ? (related.at(-1) || null) : related }
        }
      }
    }
  }

  const attachManyToManyRelationships = async ({ resources, descriptor, context, includeTree = parseIncludeTree(context.queryParams?.include) }) => {
    if (!resources || resources.length === 0) return
    const requestedFields = parseFieldset(getResourceFieldset(context.queryParams?.fields, descriptor.resource))
    const manyEntries = Object.entries(descriptor.manyToMany || {})
      .filter(([name]) => requestedFields === null || requestedFields.includes(name))
      .filter(([name]) => !Object.hasOwn(includeTree, name))
    if (manyEntries.length === 0) return

    const db = context.db || context.transaction || api.knex.instance

    for (const [relName] of manyEntries) {
      const pendingResources = resources.filter(resource => !Object.hasOwn(resource.relationships || {}, relName))
      if (pendingResources.length === 0) continue
      const parentIds = pendingResources.map(resource => resource.id)
      const info = getManyToManyInfo(descriptor.resource, relName)
      if (!info) continue
      const { query: visibleTargets } = await buildVisibleLinkTargets({ ...info, parentIds, db, context })
      const rows = await fetchLinksForParents({
        descriptor: info.descriptor,
        relationshipKey: info.relationshipKey,
        targetResource: info.relInfo.target,
        parentIds,
        db,
        visibleTargets,
      })

      const grouped = rows.reduce((acc, row) => {
        const key = String(row.parentId)
        acc[key] = acc[key] || []
        acc[key].push({ type: row.childType, id: String(row.childId) })
        return acc
      }, Object.create(null))

      for (const resource of pendingResources) {
        const related = grouped[resource.id] || []
        resource.relationships = resource.relationships || {}
        resource.relationships[relName] = { data: related }
      }
    }
  }

  return { buildIncludes, attachReverseRelationships, attachManyToManyRelationships }
}
