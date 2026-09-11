import { assertScalarQueryField } from '../querying-writing/field-utils.js'
// Cross-table search helper functions that enable filtering across related database tables

/**
 * Validates that a field exists and is indexed for cross-table search
 *
 * @async
 * @param {Object} scopes - All registered resources containing schema and relationship definitions
 * @param {Object} log - Logger instance for debug and trace output
 * @param {string} targetScopeName - The scope containing the field to validate
 * @param {string} fieldName - The field name to check
 * @param {Set<string>} [searchedScopes=new Set()] - Internal parameter to prevent circular references
 * @returns {Promise<void>}
 * @throws {Error} If scope not found, field not found, field not indexed, or circular reference detected
   */
export const validateCrossTableField = async (scopes, log, targetScopeName, fieldName, searchedScopes = new Set()) => {
  log.trace('[VALIDATE] Starting validateCrossTableField:', { targetScopeName, fieldName, searchedScopes: Array.from(searchedScopes) })

  if (searchedScopes.has(targetScopeName)) {
    throw new Error(`Circular reference detected: ${targetScopeName} -> ${Array.from(searchedScopes).join(' -> ')}`)
  }

  log.trace('[VALIDATE] Getting target schema for:', targetScopeName)
  let targetSchemaInstance
  try {
    targetSchemaInstance = scopes[targetScopeName].vars.schemaInfo.schemaInstance
    log.trace('[VALIDATE] Got target schema:', { scopeName: targetScopeName, schemaKeys: Object.keys(targetSchemaInstance || {}) })
  } catch (error) {
    log.trace('[VALIDATE] Error getting target schema:', error.message)
    throw new Error(`Target scope '${targetScopeName}' not found`)
  }

  if (!targetSchemaInstance) {
    log.trace('[VALIDATE] Target schema is null/undefined')
    throw new Error(`Target scope '${targetScopeName}' has no schema`)
  }

  const fieldDef = targetSchemaInstance.structure[fieldName]
  log.trace('[VALIDATE] Field lookup result:', { fieldName, fieldExists: !!fieldDef })
  if (!fieldDef) {
    throw new Error(`Field '${fieldName}' not found in scope '${targetScopeName}'`)
  }

  assertScalarQueryField(fieldDef, `${targetScopeName}.${fieldName}`, 'filter')

  log.trace('[VALIDATE] Checking indexed status:', { fieldName, indexed: fieldDef.indexed })
  if (!fieldDef.indexed) {
    throw new Error(`Field '${targetScopeName}.${fieldName}' is not indexed. Add 'indexed: true' to allow cross-table search`)
  }

  log.trace('[VALIDATE] Validation successful for field:', `${targetScopeName}.${fieldName}`)
}

/**
 * Builds a chain of SQL JOINs to reach a field in a related table
 *
 * @async
 * @param {Object} scopes - All registered resources containing schema and relationship definitions
 * @param {Object} log - Logger instance for debug and trace output
 * @param {string} fromScopeName - Starting scope (e.g., 'articles')
 * @param {string} targetPath - Dot-separated path to target field (e.g., 'author.company.name')
 * @param {Set<string>} [searchedScopes=new Set()] - Internal parameter to prevent circular references
 * @returns {Promise<Object>} JOIN information for query builder
 * @throws {Error} If path is invalid or relationships not properly configured
   */
export const buildJoinChain = async (scopes, log, fromScopeName, targetPath, searchedScopes = new Set()) => {
  log.trace('[BUILD-JOIN] Starting buildJoinChain:', { fromScopeName, targetPath })

  const pathSegments = targetPath.split('.')
  if (pathSegments.length < 2) {
    throw new Error(`Invalid cross-table path '${targetPath}'. Must contain at least 'scope.field'`)
  }

  const targetFieldName = pathSegments[pathSegments.length - 1]
  const relationshipPath = pathSegments.slice(0, -1)

  log.trace('[BUILD-JOIN] Parsed path:', { relationshipPath, targetFieldName })

  const joinChain = []
  let currentScope = fromScopeName

  for (let i = 0; i < relationshipPath.length; i++) {
    const targetScope = relationshipPath[i]

    log.trace('[BUILD-JOIN] Looking for direct relationship:', { from: currentScope, to: targetScope })

    if (searchedScopes.has(currentScope)) {
      throw new Error(`Circular reference detected in path: ${Array.from(searchedScopes).join(' -> ')} -> ${currentScope}`)
    }
    searchedScopes.add(currentScope)

    const schemaInfo = scopes[currentScope].vars.schemaInfo
    const currentSchema = schemaInfo.schemaInstance
    const currentRelationships = schemaInfo.schemaRelationships

    let foundRelationship = null
    let relationshipType = null
    let relationshipField = null

    const hasEstablishedPath = Object.values(currentRelationships || {}).some(rel => rel.type === 'hasMany' && rel.target === targetScope) ||
      Object.values(currentSchema.structure).some(field => field.belongsTo === targetScope)

    if (currentRelationships) {
      for (const [relName, relDef] of Object.entries(currentRelationships)) {
        const matchesHasMany = relDef.type === 'hasMany' && relDef.target === targetScope
        const matchesManyToMany = relDef.type === 'manyToMany' && (relDef.target || relName) === targetScope &&
          !hasEstablishedPath
        if (matchesHasMany || matchesManyToMany) {
          if (relDef.via) {
            const targetRelationships = scopes[targetScope].vars.schemaInfo.schemaRelationships
            const viaRel = targetRelationships?.[relDef.via]

            if (viaRel?.belongsToPolymorphic) {
              const { typeField, idField } = viaRel.belongsToPolymorphic
              foundRelationship = targetScope
              relationshipType = 'hasManyPolymorphic'
              relationshipField = { typeField, idField, via: relDef.via }
              log.trace('[BUILD-JOIN] Found polymorphic hasMany relationship:', {
                relName, targetScope, via: relDef.via, typeField, idField
              })
              break
            }
          }

          if (relDef.through) {
            foundRelationship = targetScope
            relationshipType = 'manyToMany'
            relationshipField = {
              relationshipName: relName,
              through: relDef.through,
              foreignKey: relDef.foreignKey,
              otherKey: relDef.otherKey
            }
            log.trace('[BUILD-JOIN] Found many-to-many relationship:', {
              relName,
              targetScope,
              through: relDef.through,
              foreignKey: relDef.foreignKey,
              otherKey: relDef.otherKey
            })
            break
          }

          foundRelationship = targetScope
          relationshipType = 'hasMany'
          relationshipField = relDef.foreignKey
          if (!relationshipField) {
            log.error('[BUILD-JOIN] Missing foreignKey in hasMany relationship:', { relName, currentScope })
            throw new Error(`Missing foreignKey in hasMany relationship '${relName}' for scope '${currentScope}'`)
          }
          log.trace('[BUILD-JOIN] Found hasMany relationship:', { relName, targetScope, foreignKey: relationshipField })
          break
        }
      }
    }

    if (!foundRelationship) {
      for (const [fieldName, fieldDef] of Object.entries(currentSchema.structure)) {
        if (fieldDef.belongsTo === targetScope) {
          foundRelationship = targetScope
          relationshipType = 'belongsTo'
          relationshipField = fieldName
          log.trace('[BUILD-JOIN] Found belongsTo relationship:', { fieldName, targetScope })
          break
        }
      }
    }

    if (!foundRelationship) {
      throw new Error(
          `No searchable relationship from '${currentScope}' to '${targetScope}'. `
      )
    }

    const sourceTableName = scopes[currentScope].vars.schemaInfo.tableName
    const targetTableName = scopes[targetScope].vars.schemaInfo.tableName

    if (relationshipType === 'manyToMany') {
      const { relationshipName, through, foreignKey, otherKey } = relationshipField
      const pivotTableName = scopes[through].vars.schemaInfo.tableName || through
      const previousAlias = i === 0 ? sourceTableName : joinChain.at(-1).joinAlias

      const pivotAlias = `${currentScope}_to_${through}_${through}`
      const pivotJoinCondition = `${previousAlias}.id = ${pivotAlias}.${foreignKey}`

      joinChain.push({
        targetTableName: pivotTableName,
        joinAlias: pivotAlias,
        joinCondition: pivotJoinCondition,
        isOneToMany: true,
        isPolymorphic: false,
        relationshipField: foreignKey,
        relationshipType: 'manyToMany_pivot',
        sourceScopeName: currentScope,
        relationshipName,
        foreignKey,
        otherKey,
        targetScopeName: through
      })

      const targetAlias = `${through}_to_${targetScope}_${targetScope}`
      const targetJoinCondition = `${pivotAlias}.${otherKey} = ${targetAlias}.id`

      joinChain.push({
        targetTableName,
        joinAlias: targetAlias,
        joinCondition: targetJoinCondition,
        isOneToMany: false,
        isPolymorphic: false,
        relationshipField: otherKey,
        relationshipType: 'manyToMany_target',
        targetScopeName: targetScope
      })
    } else {
      const joinAlias = `${currentScope}_to_${targetScope}_${targetScope}`

      let joinCondition
      if (relationshipType === 'hasManyPolymorphic') {
        const { typeField, idField } = relationshipField
        const previousAlias = i === 0 ? sourceTableName : joinChain.at(-1).joinAlias
        joinCondition = `${joinAlias}.${typeField} = '${currentScope}' AND ${joinAlias}.${idField} = ${previousAlias}.id`
      } else if (relationshipType === 'hasMany') {
        const previousAlias = i === 0 ? sourceTableName : joinChain.at(-1).joinAlias
        joinCondition = `${previousAlias}.id = ${joinAlias}.${relationshipField}`
      } else {
        const previousAlias = i === 0 ? sourceTableName : joinChain.at(-1).joinAlias
        joinCondition = `${previousAlias}.${relationshipField} = ${joinAlias}.id`
      }

      joinChain.push({
        targetTableName,
        joinAlias,
        joinCondition,
        isOneToMany: relationshipType === 'hasMany' || relationshipType === 'hasManyPolymorphic',
        isPolymorphic: relationshipType === 'hasManyPolymorphic',
        relationshipField,
        relationshipType,
        targetScopeName: targetScope
      })
    }

    currentScope = targetScope
  }

  const finalScope = relationshipPath[relationshipPath.length - 1]
  await validateCrossTableField(scopes, log, finalScope, targetFieldName, searchedScopes)

  if (joinChain.length === 0) {
    throw new Error(`Invalid path '${targetPath}': no relationships to traverse`)
  }

  const lastJoin = joinChain[joinChain.length - 1]

  if (joinChain.length > 1) {
    return {
      targetTableName: lastJoin.targetTableName,
      joinAlias: lastJoin.joinAlias,
      joinCondition: joinChain.map(j => j.joinCondition).join(' AND '),
      targetField: targetFieldName,
      isOneToMany: joinChain.some(j => j.isOneToMany),
      isMultiLevel: true,
      joinChain,
      targetScopeName: finalScope
    }
  } else {
    return {
      joinAlias: lastJoin.joinAlias,
      targetTableName: lastJoin.targetTableName,
      sourceField: lastJoin.relationshipField,
      targetField: targetFieldName,
      joinCondition: lastJoin.joinCondition,
      isOneToMany: lastJoin.isOneToMany,
      isPolymorphic: lastJoin.isPolymorphic,
      targetScopeName: lastJoin.targetScopeName || finalScope
    }
  }
}

/**
 * Analyzes a search schema to identify which fields need database indexes
 *
 * @param {Object} scopes - All registered resources containing schema and relationship definitions
 * @param {Object} log - Logger instance for debug and trace output
 * @param {string} scopeName - The scope being analyzed
 * @param {Object} searchSchema - Search schema definition with filter fields
 * @returns {Array<Object>} Array of required indexes with scope, field, and reason
   */
export const analyzeRequiredIndexes = (scopes, log, scopeName, schemaInfo) => {
  const requiredIndexes = []

  const schemaToAnalyze = schemaInfo.searchSchemaStructure

  Object.entries(schemaToAnalyze).forEach(([filterKey, fieldDef]) => {
    if (fieldDef.actualField && fieldDef.actualField.includes('.')) {
      const [targetScopeName, targetFieldName] = fieldDef.actualField.split('.')
      requiredIndexes.push({
        scope: targetScopeName,
        field: targetFieldName,
        reason: `Cross-table search from ${scopeName}.${filterKey}`
      })
    }

    if (fieldDef.oneOf && Array.isArray(fieldDef.oneOf)) {
      fieldDef.oneOf.forEach(field => {
        if (field.includes('.')) {
          const [targetScopeName, targetFieldName] = field.split('.')
          requiredIndexes.push({
            scope: targetScopeName,
            field: targetFieldName,
            reason: `Cross-table oneOf search from ${scopeName}.${filterKey}`
          })
        }
      })
    }
  })

  return requiredIndexes
}

/**
 * Creates database indexes for fields identified by analyzeRequiredIndexes
 *
 * @async
 * @param {Object} scopes - All registered resources containing schema and relationship definitions
 * @param {Object} log - Logger instance for debug and trace output
 * @param {Array<Object>} requiredIndexes - Index requirements from analyzeRequiredIndexes
 * @param {Object} knex - Knex database connection instance
 * @returns {Promise<Array<Object>>} Array of successfully created indexes
   */
export const createRequiredIndexes = async (scopes, log, requiredIndexes, knex) => {
  const createdIndexes = []

  for (const indexInfo of requiredIndexes) {
    const { scope, field } = indexInfo
    const tableName = scopes[scope].vars.schemaInfo.tableName
    const indexName = `idx_${tableName}_${field}_search`

    try {
      const hasIndex = await knex.schema.hasIndex(tableName, [field])
      if (!hasIndex) {
        await knex.schema.table(tableName, table => {
          table.index([field], indexName)
        })
        createdIndexes.push({ tableName, field, indexName })
        log.info(`Created index: ${indexName} on ${tableName}.${field}`)
      }
    } catch (error) {
      log.warn(`Failed to create index on ${tableName}.${field}:`, error.message)
    }
  }

  return createdIndexes
}
