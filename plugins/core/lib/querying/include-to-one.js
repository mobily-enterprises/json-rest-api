// To-one loaders attach linkage and selected records; deps.loadNestedIncludes traverses child paths.
import { whereInIdentifiers } from './identifier-query.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from '../querying-writing/knex-field-helpers.js'
import { toJsonApiRecord } from './knex-json-api-transformers-querying.js'
import {
  RELATIONSHIPS_KEY,
  RELATIONSHIP_METADATA_KEY,
  COMPUTED_DEPENDENCIES_KEY,
  RELATIONSHIP_READ_BATCH_SIZE,
} from '../querying-writing/knex-constants.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'
import { getPolymorphicLinkage } from '../querying-writing/relationship-contracts.js'
import {
  resolveScopeStorageAdapter,
  getIdColumnForScope,
  getFieldValueForScope,
  translateColumnForScope,
  buildRelationshipLinks,
  applyScopeFiltersToIncludeQuery,
  groupByPolymorphicType,
  loadRelationshipMetadata,
} from './include-query-helpers.js'
/**
 * Loads belongsTo relationships (many-to-one)
 *
 * This function loads the "parent" side of a relationship. For example, if comments
 * belong to articles, this loads the articles for a set of comments.
 *
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - Records to load relationships for
 *   - fieldName: string - The foreign key field name (e.g., 'author_id')
 *   - fieldDef: Object - The field definition from the schema
 *   - includeName: string - The relationship name (e.g., 'author')
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadBelongsTo = async (scope, deps) => {
  const { records, scopeName, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields } = scope
  const { scopes, log, knex, capabilities, requestContext } = deps.context
  try {
    log.trace('[INCLUDE] Loading belongsTo:', {
      fieldName,
      includeName,
      recordCount: records.length
    })

    // Get the target scope name
    const targetScope = fieldDef.belongsTo
    if (!scopes[targetScope]) {
      log.warn('[INCLUDE] Target scope not found:', targetScope)
      return
    }

    // Collect all foreign key values
    const foreignKeyValues = records
      .map(record => getFieldValueForScope(scopes, scopeName, record, fieldName))
      .filter(val => val != null) // Filter out null/undefined

    const uniqueIds = [...new Set(foreignKeyValues)]

    log.debug('[INCLUDE] Loading belongsTo records:', {
      targetScope,
      idCount: uniqueIds.length
    })

    if (uniqueIds.length === 0) {
      // No relationships to load, set all to null
      records.forEach(record => {
        if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}
        const relationshipObject = { data: null }

        // Add links if urlPrefix is configured
        if (scopeName) {
          relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, includeName)
        }

        record[RELATIONSHIPS_KEY][includeName] = relationshipObject
      })
      return
    }

    // Get target table info
    const targetTableName = scopes[targetScope].vars.schemaInfo.tableName
    const targetIdColumn = getIdColumnForScope(scopes, targetScope)
    // Select visible fields, projections and their dependencies.
    const targetScopeObject = scopes[targetScope]
    const storageAdapter = resolveScopeStorageAdapter(scopes, targetScope, knex)
    const fieldSelectionInfo = await buildFieldSelection(targetScopeObject, {
      context: {
        ...(requestContext || {}),
        scopeName: targetScope,
        queryParams: { fields },
        schemaInfo: targetScopeObject.vars.schemaInfo,
        storageAdapter,
      }
    })

    // Load the target records
    const targetRecords = []
    for (let offset = 0; offset < uniqueIds.length; offset += RELATIONSHIP_READ_BATCH_SIZE) {
      let query = knex(targetTableName).whereIn(targetIdColumn, uniqueIds.slice(offset, offset + RELATIONSHIP_READ_BATCH_SIZE))
      const selectionState = await applyFieldSelectionToQuery({
        query,
        scope: targetScopeObject,
        fieldSelectionInfo,
        tableName: targetTableName,
        useTablePrefix: false,
        storageAdapter,
        db: knex,
        context: {
          ...(requestContext || {}),
          scopeName: targetScope,
          schemaInfo: targetScopeObject.vars.schemaInfo,
          storageAdapter,
        },
        scopeName: targetScope
      })
      query = selectionState.query
      const scopedQueryState = await applyScopeFiltersToIncludeQuery({
        query,
        scopes,
        scopeName: targetScope,
        requestContext,
        db: knex,
        tableName: targetTableName
      })
      query = scopedQueryState.query
      for (const record of await query) targetRecords.push(record)
    }

    // Load relationship metadata for all target records
    await loadRelationshipMetadata(scopes, targetRecords, targetScope)

    // Create lookup map
    const targetById = Object.create(null)
    targetRecords.forEach(record => {
      targetById[getFieldValueForScope(scopes, targetScope, record, 'id')] = record
    })

    // Set relationships on original records
    const targetRecordsToProcess = new Set()

    records.forEach(record => {
      if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}

      const targetId = getFieldValueForScope(scopes, scopeName, record, fieldName)
      const targetRecord = targetById[targetId]

      if (targetRecord) {
        // Convert to JSON:API format
        const jsonApiRecord = toJsonApiRecord(
          scopes[targetScope],
          targetRecord,
          targetScope
        )

        // Add relationships from metadata
        if (targetRecord[RELATIONSHIP_METADATA_KEY]) {
          jsonApiRecord.relationships = targetRecord[RELATIONSHIP_METADATA_KEY]
          // Clean up the temporary property
          delete targetRecord[RELATIONSHIP_METADATA_KEY]
        }

        // Attach computed dependencies info if sparse fieldsets were used
        if (fieldSelectionInfo?.computedDependencies) {
          jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies
        }

        const relationshipObject = { data: { type: targetScope, id: String(targetId) } }

        // Add links if urlPrefix is configured
        if (scopeName) {
          relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, includeName)
        }

        record[RELATIONSHIPS_KEY][includeName] = relationshipObject

        // Add to included if not already there
        const resourceKey = `${targetScope}:${targetId}`
        if (!included.has(resourceKey)) {
          included.set(resourceKey, jsonApiRecord) // Now includes relationships!
        }
        if (Object.keys(subIncludes).length > 0) {
          targetRecordsToProcess.add(targetRecord)
        }
      } else {
        const relationshipObject = { data: null }

        // Add links if urlPrefix is configured
        if (scopeName) {
          relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, includeName)
        }

        record[RELATIONSHIPS_KEY][includeName] = relationshipObject
      }
    })

    // Process nested includes if any
    if (targetRecordsToProcess.size > 0) {
      const nextPath = `${currentPath}.${includeName}`
      await deps.loadNestedIncludes(
        { records: [...targetRecordsToProcess], scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields },
        { context: { scopes, log, knex, capabilities, requestContext } }
      )
    }
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to load belongsTo relationship '${includeName}' for field '${fieldName}'`,
      context: { phase: 'include', fieldName, includeName, targetScope: fieldDef.belongsTo }
    })
  }
}

/**
 * Loads hasOne relationships (one-to-one)
 *
 * Similar to hasMany but expects a single related record.
 * For example, a user that has one profile.
 *
 * @param {Object} scope - The hooked-api scope object
 * @param {Object} deps - Dependencies object
 */
export const loadHasOne = async (scope, deps) => {
  const { records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields } = scope
  const { context: { scopes, log, knex, capabilities, requestContext } } = deps

  const childLog = log?.child ? log.child({ method: 'loadHasOne' }) : log

  if (!records || records.length === 0) {
    childLog?.trace?.('[INCLUDE] No records to load hasOne for')
    return
  }

  // Get parent IDs
  const mainIds = [...new Set(records.map(record => getFieldValueForScope(scopes, scopeName, record, 'id')).filter(id => id !== null && id !== undefined))]

  if (mainIds.length === 0) {
    childLog?.trace?.('[INCLUDE] No parent IDs found, skipping hasOne load')
    return
  }

  const targetScope = relDef.target
  const targetTable = scopes[targetScope].vars.schemaInfo.tableName
  const foreignKey = relDef.foreignKey

  if (!foreignKey) {
    throw new Error(`Missing foreignKey in hasOne relationship '${includeName}' for scope '${scopeName}'`)
  }

  childLog?.debug?.(`[INCLUDE] Loading ${targetScope} records with foreign key ${foreignKey}:`, {
    parentCount: mainIds.length
  })

  // Build query for hasOne - expects single result per parent
  const targetScopeObject = scopes[targetScope]
  const storageAdapter = resolveScopeStorageAdapter(scopes, targetScope, knex)

  // Select visible fields, projections and their dependencies.
  const fieldSelectionInfo = await buildFieldSelection(targetScopeObject, {
    context: {
      ...(requestContext || {}),
      scopeName: targetScope,
      queryParams: { fields },
      schemaInfo: targetScopeObject.vars.schemaInfo,
      storageAdapter,
    }
  })

  // Query related records
  const foreignKeyColumn = translateColumnForScope(scopes, targetScope, foreignKey)
  let query = knex(targetTable).modify(whereInIdentifiers, foreignKeyColumn, mainIds)

  const selectionState = await applyFieldSelectionToQuery({
    query,
    scope: targetScopeObject,
    fieldSelectionInfo,
    tableName: targetTable,
    useTablePrefix: false,
    storageAdapter,
    db: knex,
    context: {
      ...(requestContext || {}),
      scopeName: targetScope,
      schemaInfo: targetScopeObject.vars.schemaInfo,
      storageAdapter,
    },
    scopeName: targetScope
  })
  query = selectionState.query

  const scopedQueryState = await applyScopeFiltersToIncludeQuery({
    query,
    scopes,
    scopeName: targetScope,
    requestContext,
    db: knex,
    tableName: targetTable
  })
  query = scopedQueryState.query

  const relatedRecords = await query
  await loadRelationshipMetadata(scopes, relatedRecords, targetScope)

  // Create a map of parent ID to related record (should be one-to-one)
  const relatedByParentId = Object.create(null)
  for (const related of relatedRecords) {
    const parentId = getFieldValueForScope(scopes, targetScope, related, foreignKey)
    if (relatedByParentId[parentId]) {
      log.warn(`[INCLUDE] Multiple records found for hasOne relationship '${includeName}' with ${foreignKey}=${parentId}`)
    }
    relatedByParentId[parentId] = related
  }

  // Process each parent record
  for (const record of records) {
    const recordId = getFieldValueForScope(scopes, scopeName, record, 'id')
    const relatedRecord = relatedByParentId[recordId]

    if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}

    if (relatedRecord) {
      // Transform to JSON:API format
      const transformed = toJsonApiRecord(targetScopeObject, relatedRecord, targetScope)
      if (relatedRecord[RELATIONSHIP_METADATA_KEY]) {
        transformed.relationships = relatedRecord[RELATIONSHIP_METADATA_KEY]
        delete relatedRecord[RELATIONSHIP_METADATA_KEY]
      }
      if (fieldSelectionInfo?.computedDependencies) {
        transformed[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies
      }

      // Set single object (not array) for hasOne
      const relatedRecordId = getFieldValueForScope(scopes, targetScope, relatedRecord, 'id')
      record[RELATIONSHIPS_KEY][includeName] = {
        data: { type: targetScope, id: String(relatedRecordId) },
        links: buildRelationshipLinks(scopes, scopeName, record, includeName)
      }

      // Add to included if not already there
      const key = `${targetScope}:${relatedRecordId}`
      if (!included.has(key)) {
        included.set(key, transformed)
      }

      // Process nested includes if any
      if (subIncludes && Object.keys(subIncludes).length > 0) {
        const newPath = `${currentPath}.${includeName}`
        await deps.loadNestedIncludes(
          { records: [relatedRecord], scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: newPath, fields },
          { context: { scopes, log, knex, capabilities, requestContext } }
        )
      }
    } else {
      // No related record found
      record[RELATIONSHIPS_KEY][includeName] = {
        data: null,
        links: buildRelationshipLinks(scopes, scopeName, record, includeName)
      }
    }
  }
}

/**
 * Loads polymorphic belongsTo relationships
 *
 * Handles relationships where a record can belong to different types of parent records.
 * For example, comments that can belong to either articles or videos.
 *
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - Records with polymorphic relationships
 *   - relName: string - The relationship name
 *   - relDef: Object - The relationship definition with belongsToPolymorphic
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadPolymorphicBelongsTo = async (scope, deps) => {
  const { records, scopeName, relName, relDef, subIncludes, included, processedPaths, currentPath, fields } = scope
  const { scopes, log, knex, capabilities, requestContext } = deps.context
  try {
    log.trace('[INCLUDE] Loading polymorphic belongsTo:', {
      relName,
      recordCount: records.length
    })

    const { typeField, idField, types } = relDef.belongsToPolymorphic

    // Group records by their target type using helper
    const grouped = groupByPolymorphicType(
      records,
      typeField,
      idField,
      (record, fieldName) => getFieldValueForScope(scopes, scopeName, record, fieldName)
    )

    log.trace('[INCLUDE] Grouped by type:', {
      types: Object.keys(grouped),
      counts: Object.entries(grouped).map(([t, ids]) => `${t}: ${ids.length}`)
    })

    // Load each type separately
    for (const [targetType, targetIds] of Object.entries(grouped)) {
      if (targetIds.length === 0) continue
      getPolymorphicLinkage({ type: targetType, id: targetIds[0], types, scopeName, relationshipName: relName })

      // Get target table information
      const targetSchemaInfo = scopes[targetType].vars.schemaInfo
      const targetTable = targetSchemaInfo?.tableName || targetType

      // Select visible fields, projections and their dependencies.
      const targetScopeObject = scopes[targetType]
      const storageAdapter = resolveScopeStorageAdapter(scopes, targetType, knex)
      const fieldSelectionInfo = await buildFieldSelection(targetScopeObject, {
        context: {
          ...(requestContext || {}),
          scopeName: targetType,
          queryParams: { fields },
          schemaInfo: targetScopeObject.vars.schemaInfo,
          storageAdapter,
        }
      })

      log.debug(`[INCLUDE] Loading ${targetType} records:`, {
        idCount: targetIds.length
      })

      // Query for this type
      const targetIdColumn = getIdColumnForScope(scopes, targetType)
      const targetRecords = []
      for (let offset = 0; offset < targetIds.length; offset += RELATIONSHIP_READ_BATCH_SIZE) {
        let query = knex(targetTable).whereIn(targetIdColumn, targetIds.slice(offset, offset + RELATIONSHIP_READ_BATCH_SIZE))
        const selectionState = await applyFieldSelectionToQuery({
          query,
          scope: targetScopeObject,
          fieldSelectionInfo,
          tableName: targetTable,
          useTablePrefix: false,
          storageAdapter,
          db: knex,
          context: {
            ...(requestContext || {}),
            scopeName: targetType,
            schemaInfo: targetScopeObject.vars.schemaInfo,
            storageAdapter,
          },
          scopeName: targetType
        })
        query = selectionState.query
        const scopedQueryState = await applyScopeFiltersToIncludeQuery({
          query,
          scopes,
          scopeName: targetType,
          requestContext,
          db: knex,
          tableName: targetTable
        })
        query = scopedQueryState.query
        for (const record of await query) targetRecords.push(record)
      }

      // Load relationship metadata for all target records
      await loadRelationshipMetadata(scopes, targetRecords, targetType)

      // Create lookup map
      const targetById = Object.create(null)
      targetRecords.forEach(record => {
        targetById[getFieldValueForScope(scopes, targetType, record, 'id')] = record
      })

      // Add to included and set relationships
      records.forEach(record => {
        if (getFieldValueForScope(scopes, scopeName, record, typeField) === targetType) {
          const targetId = getFieldValueForScope(scopes, scopeName, record, idField)
          const targetRecord = targetById[targetId]

          if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}

          if (targetRecord) {
          // Add to included
            const resourceKey = `${targetType}:${targetId}`
            if (!included.has(resourceKey)) {
              const jsonApiRecord = toJsonApiRecord(
                scopes[targetType],
                targetRecord,
                targetType
              )

              // Add relationships from metadata
              if (targetRecord[RELATIONSHIP_METADATA_KEY]) {
                jsonApiRecord.relationships = targetRecord[RELATIONSHIP_METADATA_KEY]
                // Clean up the temporary property
                delete targetRecord[RELATIONSHIP_METADATA_KEY]
              }

              // Attach computed dependencies info if sparse fieldsets were used
              if (fieldSelectionInfo?.computedDependencies) {
                jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies
              }

              included.set(resourceKey, jsonApiRecord)
            }

            const relationshipObject = {
              data: { type: targetType, id: String(targetId) }
            }

            // Add links if urlPrefix is configured
            if (scopeName) {
              relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, relName)
            }

            record[RELATIONSHIPS_KEY][relName] = relationshipObject
          } else {
            const relationshipObject = { data: null }

            // Add links if urlPrefix is configured
            if (scopeName) {
              relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, relName)
            }

            record[RELATIONSHIPS_KEY][relName] = relationshipObject
          }
        }
      })

      // Process nested includes for this type
      if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
        const nextPath = `${currentPath}.${relName}`
        await deps.loadNestedIncludes(
          { records: targetRecords, scopeName: targetType, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields },
          { context: { scopes, log, knex, capabilities, requestContext } }
        )
      }
    }

    // Set null for records without relationships
    records.forEach(record => {
      if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {}
      if (!Object.hasOwn(record[RELATIONSHIPS_KEY], relName)) {
        const relationshipObject = { data: null }

        // Add links if urlPrefix is configured
        if (scopeName) {
          relationshipObject.links = buildRelationshipLinks(scopes, scopeName, record, relName)
        }

        record[RELATIONSHIPS_KEY][relName] = relationshipObject
      }
    })
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to load polymorphic belongsTo relationship '${relName}'`,
      context: { phase: 'include', relName, types: relDef?.belongsToPolymorphic?.types }
    })
  }
}
