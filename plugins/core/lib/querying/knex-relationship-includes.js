import { RELATIONSHIPS_KEY } from '../querying-writing/knex-constants.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'
import { getFieldValueForScope, parseIncludeTree } from './include-query-helpers.js'
import { loadBelongsTo, loadHasOne, loadPolymorphicBelongsTo } from './include-to-one.js'
import { loadHasMany, loadReversePolymorphic } from './include-to-many.js'
/**
 * Processes includes for a set of records
 *
 * This is the main recursive function that processes the include tree. It examines
 * the schema to determine relationship types and calls the appropriate loader function.
 *
 * @param {Object} scope - The resource object containing:
 *   - records: Array<Object> - Records to process includes for
 *   - scopeName: string - The scope name of the records
 *   - includeTree: Object - Parsed include tree from parseIncludeTree
 *   - included: Map - Map storing all included resources
 *   - processedPaths: Set - Set tracking processed paths to prevent cycles
 *   - currentPath: string - Current path in the include tree (default '')
 *   - fields: Object - Sparse fieldsets configuration (default {})
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The resources object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const processIncludes = async (scope, deps) => {
  const { records, scopeName, includeTree, included, processedPaths, currentPath = '', fields = {} } = scope
  const { scopes, log, knex, capabilities, requestContext } = deps.context
  log.trace('[INCLUDE] Processing includes:', {
    scopeName,
    includes: Object.keys(includeTree),
    recordCount: records.length,
    currentPath
  })

  if (records.length === 0) return

  // Get schema info for this scope
  const schemaInfo = scopes[scopeName]?.vars?.schemaInfo
  if (!schemaInfo) {
    throw new Error(`Missing relationship schema for scope '${scopeName}'`)
  }

  const { schemaStructure, schemaRelationships } = schemaInfo

  // Process each include
  for (const [includeName, subIncludes] of Object.entries(includeTree)) {
    const fullPath = currentPath ? `${currentPath}.${includeName}` : includeName

    // A path can be reached by different parent records or polymorphic types.
    const recordsToProcess = records.filter(record => {
      const recordId = getFieldValueForScope(scopes, scopeName, record, 'id')
      const key = JSON.stringify([scopeName, String(recordId), fullPath])
      if (processedPaths.has(key)) return false
      processedPaths.add(key)
      return true
    })
    if (recordsToProcess.length === 0) continue

    // Check if it's a schema field (belongsTo)
    let handled = false

    try {
      // Look for belongsTo relationships in schema fields
      for (const [fieldName, fieldDef] of Object.entries(schemaStructure || {})) {
        if (fieldDef.as === includeName && fieldDef.belongsTo) {
          await loadBelongsTo(
            { records: recordsToProcess, scopeName, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields },
            { context: { scopes, log, knex, capabilities, requestContext }, loadNestedIncludes: processIncludes }
          )
          handled = true
          break
        }
      }

      // Check relationships
      if (!handled && schemaRelationships) {
        const relDef = schemaRelationships[includeName]

        if (relDef) {
          if (relDef.type === 'hasOne') {
            // Handle hasOne relationship
            log.debug('[INCLUDE] About to call loadHasOne:', {
              scopeName,
              includeName,
              target: relDef.target
            })
            await loadHasOne(
              { records: recordsToProcess, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields },
              { context: { scopes, log, knex, capabilities, requestContext }, loadNestedIncludes: processIncludes }
            )
            handled = true
          } else if (relDef.type === 'hasMany' || relDef.type === 'manyToMany') {
            // Check if it's a reverse polymorphic (via)
            if (relDef.via) {
              await loadReversePolymorphic(
                { records: recordsToProcess, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields },
                { context: { scopes, log, knex, capabilities, requestContext }, loadNestedIncludes: processIncludes }
              )
            } else {
              log.debug('[INCLUDE] About to call loadHasMany:', {
                scopeName,
                includeName,
                relDefKeys: Object.keys(relDef || {}),
                hasManyToMany: relDef.type === 'manyToMany',
                hasMany: relDef.type === 'hasMany' ? relDef.target : undefined
              })
              await loadHasMany(
                { records: recordsToProcess, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields },
                { context: { scopes, log, knex, capabilities, requestContext }, loadNestedIncludes: processIncludes }
              )
            }
            handled = true
          } else if (relDef.belongsToPolymorphic) {
            await loadPolymorphicBelongsTo(
              { records: recordsToProcess, scopeName, relName: includeName, relDef, subIncludes, included, processedPaths, currentPath, fields },
              { context: { scopes, log, knex, capabilities, requestContext }, loadNestedIncludes: processIncludes }
            )
            handled = true
          }
        }
      }
    } catch (includeError) {
      throw wrapUnexpectedError(includeError, {
        message: `Failed to load include '${fullPath}' for scope '${scopeName}'`,
        context: { phase: 'include', scopeName, includeName, fullPath }
      })
    }

    if (!handled) {
      log.warn('[INCLUDE] Unknown relationship:', {
        scopeName,
        includeName,
        availableFields: Object.keys(schemaStructure || {}).filter(k => schemaStructure[k].as),
        availableRelationships: Object.keys(schemaRelationships || {})
      })
    }
    for (const record of recordsToProcess) {
      const recordId = getFieldValueForScope(scopes, scopeName, record, 'id')
      const includedRecord = included.get(`${scopeName}:${recordId}`)
      const relationship = record[RELATIONSHIPS_KEY]?.[includeName]
      if (includedRecord && relationship) {
        includedRecord.relationships ||= {}
        includedRecord.relationships[includeName] = relationship
      }
    }
  }
}

/**
 * Main entry point for building included resources
 *
 * Takes a set of records and an include parameter, loads all requested relationships,
 * and returns both the included resources and the records with relationship data attached.
 *
 * @param {Object} scope - The resource object containing:
 *   - records: Array<Object> - The main records to process
 *   - scopeName: string - The scope name of the main resources
 *   - includeParam: string - The include parameter value (e.g., "author,comments.author")
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The resources object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<Object>} Object with included array and records with relationships
 */
export const buildIncludedResources = async (scope, deps) => {
  const { records, scopeName, includeParam, fields } = scope
  const { scopes, log, knex, capabilities, requestContext } = deps.context
  try {
    log.trace('[INCLUDE] Building included resources:', { scopeName, includeParam, recordCount: records.length })

    // Check if includes are empty or records are empty
    if (!includeParam || records.length === 0) {
      log.trace('[INCLUDE] No includes requested or no records')
      return {
        included: [],
        recordsWithRelationships: records
      }
    }

    // Handle both string and array formats
    if (Array.isArray(includeParam) && includeParam.length === 0) {
      log.trace('[INCLUDE] Empty include array, no relationships to load')
      return {
        included: [],
        recordsWithRelationships: records
      }
    }

    // Parse the include parameter
    const includeTree = parseIncludeTree(includeParam)

    log.debug('[INCLUDE] Parsed include tree:', includeTree)

    // Share primary linkage with the include graph when a path returns to it.
    const primary = new Map(records.map(record => {
      const id = String(getFieldValueForScope(scopes, scopeName, record, 'id'))
      record[RELATIONSHIPS_KEY] ||= {}
      return [`${scopeName}:${id}`, { type: scopeName, id, relationships: record[RELATIONSHIPS_KEY] }]
    }))
    const included = new Map(primary)
    const processedPaths = new Set() // Prevent infinite loops

    // Process all includes
    await processIncludes(
      { records, scopeName, includeTree, included, processedPaths, currentPath: '', fields },
      { context: { scopes, log, knex, capabilities, requestContext }, loadNestedIncludes: processIncludes }
    )

    // Convert Map to array for JSON:API format
    const includedArray = Array.from(included, ([key, resource]) => primary.has(key) ? null : resource).filter(Boolean)

    log.debug('[INCLUDE] Completed building includes:', {
      includedCount: includedArray.length,
      uniqueTypes: [...new Set(includedArray.map(r => r.type))]
    })

    return {
      included: includedArray,
      recordsWithRelationships: records
    }
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to build included resources for scope '${scopeName}'`,
      context: {
        phase: 'include',
        scopeName,
        includeParam,
        recordCount: records?.length || 0
      }
    })
  }
}
