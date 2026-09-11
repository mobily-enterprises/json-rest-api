// Collection loaders preserve per-parent filtering/order/limits; deps.loadNestedIncludes traverses child paths.
import { whereInIdentifiers } from './identifier-query.js'
import { toJsonApiRecord } from './knex-json-api-transformers-querying.js'
import {
  RELATIONSHIPS_KEY,
  RELATIONSHIP_METADATA_KEY,
  COMPUTED_DEPENDENCIES_KEY,
} from '../querying-writing/knex-constants.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'
import {
  loadIncludedParentMap,
  getIdColumnForScope,
  getFieldValueForScope,
  translateColumnForScope,
  prepareCollectionInclude,
  buildRelationshipLinks,
  applyScopeFiltersToIncludeQuery,
  loadRelationshipMetadata,
} from './include-query-helpers.js'
/**
 * Loads hasMany relationships (one-to-many or many-to-many)
 *
 * This function loads the "child" side of a relationship. For example, if articles
 * have many comments, this loads all comments for a set of articles. It also handles
 * many-to-many relationships through a pivot table.
 *
 * @param {Object} scope - The resource object containing:
 *   - records: Array<Object> - Parent records to load relationships for
 *   - scopeName: string - The parent scope name
 *   - includeName: string - The relationship name to include
 *   - relDef: Object - The relationship definition
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The resources object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadHasMany = async (scope, deps) => {
  const { records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields } = scope
  const { scopes, log, knex, capabilities, requestContext } = deps.context
  try {
    log.trace('[INCLUDE] Loading hasMany/manyToMany relationship:', {
      scopeName,
      includeName,
      recordCount: records.length,
      isManyToMany: relDef.type === 'manyToMany',
      hasMany: relDef.type === 'hasMany' ? relDef.target : undefined
    })

    // Collect all parent IDs
    const mainIds = records.map(record => getFieldValueForScope(scopes, scopeName, record, 'id')).filter(id => id !== null && id !== undefined)

    if (mainIds.length === 0) {
      log.trace('[INCLUDE] No parent IDs found, skipping hasMany load')
      return
    }

    // Check if this is a many-to-many relationship
    if (relDef.type === 'manyToMany') {
    // Handle many-to-many relationship
      const pivotTable = scopes[relDef.through].vars.schemaInfo.tableName
      const foreignKey = translateColumnForScope(scopes, relDef.through, relDef.foreignKey)
      const otherKey = translateColumnForScope(scopes, relDef.through, relDef.otherKey)

      if (!foreignKey || !otherKey) {
        throw new Error(`Missing foreignKey or otherKey in many-to-many relationship '${includeName}' for scope '${scopeName}'`)
      }

      const targetScope = relDef.target || includeName
      const targetTable = scopes[targetScope].vars.schemaInfo.tableName

      log.debug(`[INCLUDE] Loading pivot records from ${pivotTable}:`, {
        foreignKey,
        parentCount: mainIds.length
      })

      const pivotQuery = knex(pivotTable).modify(whereInIdentifiers, foreignKey, mainIds)
        .select(foreignKey, otherKey).distinct()
      const pivotState = await applyScopeFiltersToIncludeQuery({
        query: pivotQuery, scopes, scopeName: relDef.through, requestContext, db: knex, tableName: pivotTable
      })
      const targetIdColumn = getIdColumnForScope(scopes, targetScope)
      const perParent = relDef.include?.strategy === 'window'
      const query = knex(targetTable)
      if (perParent) query.join(pivotState.query.as('pivot'), `${targetTable}.${targetIdColumn}`, `pivot.${otherKey}`)
      else query.whereIn(`${targetTable}.${targetIdColumn}`, knex.select(otherKey).from(pivotState.query.clone().as('include_candidates')))
      const limited = await prepareCollectionInclude({
        query, targetScope, parentColumn: perParent ? `pivot.${foreignKey}` : knex.raw('NULL'), includeConfig: relDef.include, fields
      }, { scopes, knex, requestContext, capabilities })
      const fieldSelectionInfo = limited.fieldSelectionInfo
      const targetRecords = await limited.query
      const parentsByChild = perParent
        ? null
        : await loadIncludedParentMap({
          query: knex(targetTable).join(pivotState.query.clone().as('pivot'), `${targetTable}.${targetIdColumn}`, `pivot.${otherKey}`)
            .select({ parentId: `pivot.${foreignKey}`, childId: `${targetTable}.${targetIdColumn}` }),
          parentIds: mainIds,
          childIds: targetRecords.map(record => getFieldValueForScope(scopes, targetScope, record, 'id')),
          knex
        })
      const childrenByParent = Object.create(null)
      for (const record of targetRecords) {
        const parents = perParent ? [record[limited.parentColumn]] : parentsByChild.get(String(getFieldValueForScope(scopes, targetScope, record, 'id'))) || []
        for (const parentId of parents) (childrenByParent[parentId] ||= []).push(record)
        for (const field of limited.temporaryFields) delete record[field]
      }

      log.trace('[INCLUDE] Loaded target records:', { count: targetRecords.length })

      // Step 5: Load relationship metadata for all target records
      await loadRelationshipMetadata(scopes, targetRecords, targetScope)

      records.forEach(record => {
        if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}

        const recordId = getFieldValueForScope(scopes, scopeName, record, 'id')
        const relData = (childrenByParent[recordId] || []).map(childRecord => {
          // Add to included
          const childRecordId = getFieldValueForScope(scopes, targetScope, childRecord, 'id')
          const resourceKey = `${targetScope}:${childRecordId}`
          if (!included.has(resourceKey)) {
            const jsonApiRecord = toJsonApiRecord(
              scopes[targetScope],
              childRecord,
              targetScope
            )

            // Add relationships from metadata
            if (childRecord[RELATIONSHIP_METADATA_KEY]) {
              jsonApiRecord.relationships = childRecord[RELATIONSHIP_METADATA_KEY]
              // Clean up the temporary property
              delete childRecord[RELATIONSHIP_METADATA_KEY]
            }

            // Attach computed dependencies info if sparse fieldsets were used
            if (fieldSelectionInfo?.computedDependencies) {
              jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies
            }

            included.set(resourceKey, jsonApiRecord)
          }
          return { type: targetScope, id: String(childRecordId) }
        })

        const relationshipObject = { data: relData }

        // Add links if urlPrefix is configured
        if (scopeName) {
          relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, includeName)
        }

        record[RELATIONSHIPS_KEY][includeName] = relationshipObject

        // Update the record in the included Map if it exists
        const recordKey = `${scopeName}:${recordId}`
        if (included.has(recordKey)) {
          const existingRecord = included.get(recordKey)
          if (!existingRecord.relationships) {
            existingRecord.relationships = {}
          }
          existingRecord.relationships[includeName] = relationshipObject
        }
      })

      // Step 8: Process nested includes if any
      if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
        const nextPath = `${currentPath}.${includeName}`
        await deps.loadNestedIncludes(
          { records: targetRecords, scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields },
          { context: { scopes, log, knex, capabilities, requestContext } }
        )
      }
    } else if (relDef.type === 'hasMany') {
    // Handle one-to-many relationship
      const targetScope = relDef.target
      const targetTable = scopes[targetScope].vars.schemaInfo.tableName
      const foreignKey = relDef.foreignKey

      if (!foreignKey) {
        throw new Error(`Missing foreignKey in hasMany relationship '${includeName}' for scope '${scopeName}'`)
      }

      log.debug(`[INCLUDE] Loading ${targetScope} records with foreign key ${foreignKey}:`, {
        parentCount: mainIds.length
      })

      const foreignKeyColumn = translateColumnForScope(scopes, targetScope, foreignKey)
      const query = knex(targetTable).modify(whereInIdentifiers, foreignKeyColumn, mainIds)
      const limited = await prepareCollectionInclude({
        query, targetScope, parentColumn: `${targetTable}.${foreignKeyColumn}`, includeConfig: relDef.include, fields
      }, { scopes, knex, requestContext, capabilities })
      const fieldSelectionInfo = limited.fieldSelectionInfo
      const targetRecords = await limited.query
      for (const record of targetRecords) {
        for (const field of limited.temporaryFields) delete record[field]
      }

      // Load relationship metadata for all target records
      await loadRelationshipMetadata(scopes, targetRecords, targetScope)

      // Group by parent ID
      const childrenByParent = Object.create(null)
      targetRecords.forEach(record => {
        const parentId = getFieldValueForScope(scopes, targetScope, record, foreignKey)
        if (!childrenByParent[parentId]) {
          childrenByParent[parentId] = []
        }
        childrenByParent[parentId].push(record)
      })

      // Set relationships on parent records
      records.forEach(record => {
        if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}

        const recordId = getFieldValueForScope(scopes, scopeName, record, 'id')
        const children = childrenByParent[recordId] || []
        const relData = children.map(childRecord => {
        // Add to included
          const childRecordId = getFieldValueForScope(scopes, targetScope, childRecord, 'id')
          const resourceKey = `${targetScope}:${childRecordId}`
          if (!included.has(resourceKey)) {
            const jsonApiRecord = toJsonApiRecord(
              scopes[targetScope],
              childRecord,
              targetScope
            )

            // Add relationships from metadata
            if (childRecord[RELATIONSHIP_METADATA_KEY]) {
              jsonApiRecord.relationships = childRecord[RELATIONSHIP_METADATA_KEY]
              // Clean up the temporary property
              delete childRecord[RELATIONSHIP_METADATA_KEY]
            }

            // Attach computed dependencies info if sparse fieldsets were used
            if (fieldSelectionInfo?.computedDependencies) {
              jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies
            }

            included.set(resourceKey, jsonApiRecord)
          }
          return { type: targetScope, id: String(childRecordId) }
        })

        const relationshipObject = { data: relData }

        // Add links if urlPrefix is configured
        if (scopeName) {
          relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, includeName)
        }

        record[RELATIONSHIPS_KEY][includeName] = relationshipObject

        // Update the record in the included Map if it exists
        const recordKey = `${scopeName}:${recordId}`
        if (included.has(recordKey)) {
          const existingRecord = included.get(recordKey)
          if (!existingRecord.relationships) {
            existingRecord.relationships = {}
          }
          existingRecord.relationships[includeName] = relationshipObject
        }
      })

      // Process nested includes
      if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
        const nextPath = `${currentPath}.${includeName}`
        await deps.loadNestedIncludes(
          { records: targetRecords, scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields },
          { context: { scopes, log, knex, capabilities, requestContext } }
        )
      }
    }
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to load hasMany relationship '${includeName}' for scope '${scopeName}'`,
      context: { phase: 'include', scopeName, includeName, hasThrough: !!relDef.through }
    })
  }
}

/**
 * Loads reverse polymorphic relationships (via)
 *
 * Handles loading "child" records that have a polymorphic relationship back to the parent.
 * For example, loading all comments (which can belong to articles or videos) for a specific article.
 *
 * @param {Object} scope - The resource object containing:
 *   - records: Array<Object> - Parent records
 *   - scopeName: string - The parent scope name
 *   - includeName: string - The relationship name
 *   - relDef: Object - The relationship definition with 'via' property
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The resources object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadReversePolymorphic = async (scope, deps) => {
  const { records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields } = scope
  const { scopes, log, knex, capabilities, requestContext } = deps.context
  try {
    log.trace('[INCLUDE] Loading reverse polymorphic (via):', {
      scopeName,
      includeName,
      via: relDef.via,
      recordCount: records.length
    })

    const targetScope = relDef.target
    const viaRelName = relDef.via

    // Get the polymorphic field info from target scope
    const targetRelationships = scopes[targetScope].vars.schemaInfo.schemaRelationships
    const viaRel = targetRelationships?.[viaRelName]

    if (!viaRel?.belongsToPolymorphic) {
      throw new Error(`Reverse relationship '${scopeName}.${includeName}' requires polymorphic relationship '${targetScope}.${viaRelName}'`)
    }

    const { typeField, idField } = viaRel.belongsToPolymorphic
    const targetTable = scopes[targetScope].vars.schemaInfo.tableName

    // Collect parent IDs
    const parentIds = records.map(record => getFieldValueForScope(scopes, scopeName, record, 'id')).filter(id => id !== null && id !== undefined)
    if (parentIds.length === 0) return

    log.debug(`[INCLUDE] Loading ${targetScope} records via ${viaRelName}:`, {
      typeField,
      idField,
      scopeName,
      parentCount: parentIds.length
    })

    const typeColumn = translateColumnForScope(scopes, targetScope, typeField)
    const idColumn = translateColumnForScope(scopes, targetScope, idField)
    const query = knex(targetTable).where(typeColumn, scopeName).modify(whereInIdentifiers, idColumn, parentIds)
    const limited = await prepareCollectionInclude({
      query, targetScope, parentColumn: `${targetTable}.${idColumn}`, includeConfig: relDef.include, fields
    }, { scopes, knex, requestContext, capabilities })
    const fieldSelectionInfo = limited.fieldSelectionInfo
    const targetRecords = await limited.query
    for (const record of targetRecords) {
      for (const field of limited.temporaryFields) delete record[field]
    }

    // Load relationship metadata for all target records
    await loadRelationshipMetadata(scopes, targetRecords, targetScope)

    // Group by parent ID
    const childrenByParent = Object.create(null)
    targetRecords.forEach(record => {
      const parentId = getFieldValueForScope(scopes, targetScope, record, idField)
      if (!childrenByParent[parentId]) {
        childrenByParent[parentId] = []
      }
      childrenByParent[parentId].push(record)
    })

    // Set relationships on parent records
    records.forEach(record => {
      if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}

      const recordId = getFieldValueForScope(scopes, scopeName, record, 'id')
      const children = childrenByParent[recordId] || []
      const relData = children.map(childRecord => {
      // Add to included
        const childRecordId = getFieldValueForScope(scopes, targetScope, childRecord, 'id')
        const resourceKey = `${targetScope}:${childRecordId}`
        if (!included.has(resourceKey)) {
          const jsonApiRecord = toJsonApiRecord(
            scopes[targetScope],
            childRecord,
            targetScope
          )

          // Add relationships from metadata
          if (childRecord[RELATIONSHIP_METADATA_KEY]) {
            jsonApiRecord.relationships = childRecord[RELATIONSHIP_METADATA_KEY]
            // Clean up the temporary property
            delete childRecord[RELATIONSHIP_METADATA_KEY]
          }

          // Attach computed dependencies info if sparse fieldsets were used
          if (fieldSelectionInfo?.computedDependencies) {
            jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies
          }

          included.set(resourceKey, jsonApiRecord)
        }
        return { type: targetScope, id: String(childRecordId) }
      })

      const relationshipObject = { data: relData }

      // Add links if urlPrefix is configured
      if (scopeName) {
        relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, includeName)
      }

      record[RELATIONSHIPS_KEY][includeName] = relationshipObject
    })

    // Process nested includes
    if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
      const nextPath = `${currentPath}.${includeName}`
      await deps.loadNestedIncludes(
        { records: targetRecords, scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields },
        { context: { scopes, log, knex, capabilities, requestContext } }
      )
    }
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to load reverse polymorphic relationship '${includeName}' via '${relDef?.via}' for scope '${scopeName}'`,
      context: { phase: 'include', scopeName, includeName, via: relDef?.via, targetScope: relDef?.target }
    })
  }
}
