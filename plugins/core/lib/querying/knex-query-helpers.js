import { analyzeRequiredIndexes, buildJoinChain } from './knex-cross-table-search.js'

// Resolve operator with sensible defaults for fields declared in searchSchema.
// - If filterOperator is provided, use it as-is
// - If field type is string and no operator provided, default to 'like' (contains)
// - Otherwise default to '='
export function resolveSearchOperator (fieldDef) {
  if (fieldDef && fieldDef.filterOperator) return String(fieldDef.filterOperator)
  if (fieldDef && fieldDef.type === 'string') return 'like'
  return '='
}

// Apply a comparison for a single field/operator/value onto a query builder.
// Handles contains/startsWith/endsWith, IN, BETWEEN, =/== null semantics,
// and uses ILIKE for case-insensitive matching on Postgres.
export function applyWhereForOperator ({ builder, columnRef, operator, value, knex, or = false }) {
  const method = or ? 'orWhere' : 'where'
  const methodNull = or ? 'orWhereNull' : 'whereNull'
  const methodIn = or ? 'orWhereIn' : 'whereIn'
  const likeOp = 'like'

  const op = typeof operator === 'string' ? operator.toLowerCase() : operator

  // Normalize scalar from possibly array input
  const firstVal = Array.isArray(value) ? value[0] : value

  // Null handling for equality and string ops
  if (firstVal === null || firstVal === undefined) {
    if (op === 'like' || op === 'contains' || op === 'startswith' || op === 'endswith') {
      builder[methodNull](columnRef)
      return
    }
    if (op === '=' || op === '==') {
      builder[methodNull](columnRef)
      return
    }
  }

  // Text search operators
  if (op === 'like' || op === 'contains') {
    builder[method](columnRef, likeOp, `%${String(firstVal)}%`)
    return
  }
  if (op === 'startswith') {
    builder[method](columnRef, likeOp, `${String(firstVal)}%`)
    return
  }
  if (op === 'endswith') {
    builder[method](columnRef, likeOp, `%${String(firstVal)}`)
    return
  }

  // Array-based operators
  if (op === 'in') {
    const values = Array.isArray(value) ? value : [value]
    builder[methodIn](columnRef, values)
    return
  }
  if (op === 'between') {
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 2) {
      builder.whereBetween(columnRef, values)
    } else if (values.length === 1) {
      if (values[0] === null || values[0] === undefined) {
        builder[methodNull](columnRef)
      } else {
        builder[method](columnRef, '=', values[0])
      }
    }
    return
  }

  // Default
  builder[method](columnRef, operator || '=', firstVal)
}

const createAdapterUtilities = (hookParams, { getStorageAdapter } = {}) => {
  const context = hookParams.context || {}
  const storageCache = new Map()

  const fetchStorageAdapter = (scopeName) => {
    if (!scopeName) return null
    if (storageCache.has(scopeName)) return storageCache.get(scopeName)

    let adapter = null
    if (scopeName === context?.knexQuery?.scopeName) {
      adapter = context.storageAdapter ||
        context.knexQuery?.storageAdapter ||
        (typeof getStorageAdapter === 'function' ? getStorageAdapter(scopeName) : null)
      if (adapter && !context.storageAdapter) {
        context.storageAdapter = adapter
      }
    } else {
      adapter = typeof getStorageAdapter === 'function' ? getStorageAdapter(scopeName) : null
    }

    storageCache.set(scopeName, adapter)
    return adapter
  }

  const defaultAliasForScope = (scopeName) => {
    if (scopeName === context?.knexQuery?.scopeName) {
      return context.knexQuery?.tableName || scopeName
    }
    return scopeName
  }

  const translateColumn = (scopeName, field, alias = defaultAliasForScope(scopeName)) => {
    const adapter = fetchStorageAdapter(scopeName)
    const translated = adapter?.translateColumn?.(field) ?? field
    if (!alias) return translated
    return `${alias}.${translated}`
  }

  const translateFilterValue = (scopeName, field, value) => {
    const adapter = fetchStorageAdapter(scopeName)
    if (!adapter?.translateFilterValue) return value
    return adapter.translateFilterValue(field, value)
  }

  return {
    fetchStorageAdapter,
    defaultAliasForScope,
    translateColumn,
    translateFilterValue,
  }
}

/**
 * Processes filters that target polymorphic relationships where a single relationship can point to different types of resources
 *
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 *
 * @example
 * // Input: Search schema with polymorphic filter
 * const searchSchema = {
 *   commentable_title: {
 *     type: 'string',
 *     polymorphicField: 'commentable',  // Points to the polymorphic relationship
 *     targetFields: {
 *       posts: 'title',      // When commentable_type='posts', search posts.title
 *       videos: 'title',     // When commentable_type='videos', search videos.title
 *       articles: 'headline' // When commentable_type='articles', search articles.headline
 *     },
 *     filterOperator: 'like'
 *   }
 * };
 *
 * // Filter request: { commentable_title: 'JavaScript' }
 *
 * // Result: Adds conditional LEFT JOINs and WHERE conditions
 * // SQL generated:
 * // LEFT JOIN posts ON comments.commentable_type = 'posts' AND comments.commentable_id = posts.id
 * // LEFT JOIN videos ON comments.commentable_type = 'videos' AND comments.commentable_id = videos.id
 * // LEFT JOIN articles ON comments.commentable_type = 'articles' AND comments.commentable_id = articles.id
 * // WHERE (
 * //   (comments.commentable_type = 'posts' AND posts.title LIKE '%JavaScript%') OR
 * //   (comments.commentable_type = 'videos' AND videos.title LIKE '%JavaScript%') OR
 * //   (comments.commentable_type = 'articles' AND articles.headline LIKE '%JavaScript%')
 * // )
 *
 * @example
 * // Input: Complex polymorphic filter with cross-table paths
 * const searchSchema = {
 *   commentable_author: {
 *     type: 'string',
 *     polymorphicField: 'commentable',
 *     targetFields: {
 *       posts: 'author.name',     // Search post author's name
 *       videos: 'creator.name'    // Search video creator's name
 *     }
 *   }
 * };
 *
 * // Result: Creates nested JOINs for each polymorphic type
 * // LEFT JOIN posts ON comments.commentable_type = 'posts' AND comments.commentable_id = posts.id
 * // LEFT JOIN users AS posts_author ON posts.author_id = posts_author.id
 * // LEFT JOIN videos ON comments.commentable_type = 'videos' AND comments.commentable_id = videos.id
 * // LEFT JOIN users AS videos_creator ON videos.creator_id = videos_creator.id
 *
 * @description
 * Used by:
 * - rest-api-knex-plugin calls this hook first during query building
 * - Must run before other filter hooks to establish JOINs
 * - Applied when searchSchema contains polymorphicField definitions
 *
 * Purpose:
 * - Enables filtering on polymorphic relationships without knowing the concrete type
 * - Searches across multiple tables with a single filter parameter
 * - Supports queries like "find all comments on content containing 'JavaScript'"
 * - Uses conditional JOINs that only match when type field equals expected value
 * - Maintains performance by leveraging indexed type/id columns
 *
 * Data flow:
 * 1. Identifies filters with polymorphicField in searchSchema
 * 2. For each polymorphic type, adds conditional LEFT JOIN
 * 3. Builds OR conditions checking type field and target field together
 * 4. Sets hasJoins flag for subsequent hooks
 * 5. Returns modified query with polymorphic search capabilities
 */
export const polymorphicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies
  const adapterUtils = createAdapterUtilities(hookParams, dependencies)

  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName
  const filters = hookParams.context?.knexQuery?.filters
  const query = hookParams.context?.knexQuery?.query
  const db = hookParams.context?.knexQuery?.db || knex

  const schemaInfo = scopes[scopeName].vars.schemaInfo
  const tableAlias = adapterUtils.defaultAliasForScope(scopeName)

  if (!filters) {
    return
  }

  // Step 1: Identify polymorphic searches
  const polymorphicSearches = new Map()
  const polymorphicJoins = new Map()

  for (const [filterKey, filterValue] of Object.entries(filters)) {
    const fieldDef = schemaInfo.searchSchemaStructure[filterKey]

    if (fieldDef?.polymorphicField && fieldDef?.targetFields && filterValue !== undefined) {
      log.trace('[POLYMORPHIC-SEARCH] Found polymorphic search:', {
        filterKey,
        polymorphicField: fieldDef.polymorphicField
      })

      polymorphicSearches.set(filterKey, {
        fieldDef,
        filterValue,
        polymorphicField: fieldDef.polymorphicField
      })
    }
  }

  if (polymorphicSearches.size === 0) {
    return
  }

  // Step 2: Build polymorphic JOINs
  log.trace('[POLYMORPHIC-SEARCH] Building JOINs for polymorphic searches')

  for (const [filterKey, searchInfo] of polymorphicSearches) {
    const { fieldDef, polymorphicField } = searchInfo

    // Get the relationship definition
    const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships
    const polyRel = relationships[polymorphicField]

    if (!polyRel?.belongsToPolymorphic) {
      throw new Error(
        `Polymorphic field '${polymorphicField}' not found in relationships for scope '${scopeName}'`
      )
    }

    const { typeField, idField } = polyRel.belongsToPolymorphic

    // Build JOINs for each target type
    for (const [targetType, targetFieldPath] of Object.entries(fieldDef.targetFields)) {
      const baseAlias = `${tableAlias}_${polymorphicField}_${targetType}`

      // Skip if we already added this JOIN
      if (!polymorphicJoins.has(baseAlias)) {
        const targetSchema = scopes[targetType].vars.schemaInfo.schemaInstance
        const targetTable = targetSchema?.tableName || targetType
        const targetIdField = scopes[targetType].vars.schemaInfo.idProperty || 'id'

        log.trace('[POLYMORPHIC-SEARCH] Adding conditional JOIN:', {
          targetType,
          alias: baseAlias
        })

        // Conditional JOIN - only matches when type is correct
        query.leftJoin(`${targetTable} as ${baseAlias}`, function () {
          const typeColumn = adapterUtils.translateColumn(scopeName, typeField, tableAlias)
          const idColumn = adapterUtils.translateColumn(scopeName, idField, tableAlias)
          const targetIdColumn = adapterUtils.translateColumn(targetType, targetIdField, baseAlias)

          this.on(typeColumn, db.raw('?', [adapterUtils.translateFilterValue(scopeName, typeField, targetType)]))
            .andOn(idColumn, targetIdColumn)
        })

        polymorphicJoins.set(baseAlias, {
          targetType,
          targetTable,
          targetFieldPath
        })
        polymorphicJoins.get(baseAlias).baseAlias = baseAlias
        polymorphicJoins.get(baseAlias).targetIdField = targetIdField

        if (!polymorphicJoins.get(baseAlias).aliasScopeMap) {
          polymorphicJoins.get(baseAlias).aliasScopeMap = new Map()
        }
        polymorphicJoins.get(baseAlias).aliasScopeMap.set(baseAlias, targetType)

        // Handle cross-table paths
        if (targetFieldPath.includes('.')) {
          log.trace('[POLYMORPHIC-SEARCH] Building cross-table JOINs for path:', targetFieldPath)

          const pathParts = targetFieldPath.split('.')
          let currentAlias = baseAlias
          let currentScope = targetType

          // Build JOIN for each segment except the last
          for (let i = 0; i < pathParts.length - 1; i++) {
            const relationshipName = pathParts[i]

            // Find the foreign key for this relationship
            const currentSchema = scopes[currentScope].vars.schemaInfo.schemaInstance
            let foreignKeyField = null
            let nextScope = null

            // Search schema for matching belongsTo
            for (const [fieldName, fieldDef] of Object.entries(currentSchema.structure)) {
              if (fieldDef.as === relationshipName && fieldDef.belongsTo) {
                foreignKeyField = fieldName
                nextScope = fieldDef.belongsTo
                break
              }
            }

            if (!foreignKeyField) {
              // Check relationships for hasOne
              const currentRelationships = scopes[currentScope].vars.schemaInfo.schemaRelationships
              const rel = currentRelationships?.[relationshipName]
              if (rel?.hasOne) {
                // Handle hasOne - more complex
                throw new Error(
                  'Cross-table polymorphic search through hasOne relationships not yet supported'
                )
              }

              throw new Error(
                `Cannot resolve relationship '${relationshipName}' in path '${targetFieldPath}' for scope '${currentScope}'`
              )
            }

            // Build next JOIN
            const nextAlias = `${currentAlias}_${relationshipName}`
            const nextSchema = scopes[nextScope].vars.schemaInfo.schemaInstance
            const nextTable = nextSchema?.tableName || nextScope

            log.trace('[POLYMORPHIC-SEARCH] Adding cross-table JOIN:', {
              from: currentAlias,
              to: nextAlias,
              table: nextTable
            })

            const nextIdField = scopes[nextScope].vars.schemaInfo.idProperty || 'id'
            const sourceColumn = adapterUtils.translateColumn(currentScope, foreignKeyField, currentAlias)
            const targetColumn = adapterUtils.translateColumn(nextScope, nextIdField, nextAlias)

            query.leftJoin(`${nextTable} as ${nextAlias}`, sourceColumn, targetColumn)

            currentAlias = nextAlias
            currentScope = nextScope

            polymorphicJoins.get(baseAlias).aliasScopeMap.set(currentAlias, currentScope)
          }
        }
      }
    }
  }

  // Pre-fetch relationships for WHERE clause processing
  const polymorphicRelationships = new Map()
  const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships
  for (const [filterKey, searchInfo] of polymorphicSearches) {
    const { polymorphicField } = searchInfo
    const polyRel = relationships[polymorphicField]
    if (polyRel?.belongsToPolymorphic) {
      polymorphicRelationships.set(filterKey, polyRel)
    }
  }

  // Mark that we have JOINs for other hooks
  hookParams.context.knexQuery.hasJoins = true

  // Step 3: Apply WHERE conditions
  query.where(function applyPolymorphicWhere () {
    const applyComparison = (builder, scope, alias, field, operator, rawValue) => {
      const columnRef = adapterUtils.translateColumn(scope, field, alias)
      const normalizedValue = adapterUtils.translateFilterValue(scope, field, rawValue)
      applyWhereForOperator({ builder, columnRef, operator, value: normalizedValue, knex })
    }

    for (const [filterKey] of Object.entries(filters)) {
      if (!polymorphicSearches.has(filterKey)) continue

      const searchInfo = polymorphicSearches.get(filterKey)
      const polyRel = polymorphicRelationships.get(filterKey)
      if (!polyRel) continue

      const { typeField } = polyRel.belongsToPolymorphic

      this.where(function applyTypeOrBranch () {
        for (const [targetType, targetFieldPath] of Object.entries(searchInfo.fieldDef.targetFields)) {
          this.orWhere(function applyTargetBranch () {
            const typeColumnAlias = tableAlias
            applyComparison(this, scopeName, typeColumnAlias, typeField, '=', targetType)

            const baseAlias = `${tableAlias}_${searchInfo.polymorphicField}_${targetType}`
            const joinMeta = polymorphicJoins.get(baseAlias)
            const aliasScopeMap = joinMeta?.aliasScopeMap || new Map([[baseAlias, targetType]])

            if (targetFieldPath.includes('.')) {
              const pathParts = targetFieldPath.split('.')
              const fieldName = pathParts[pathParts.length - 1]

              let finalAlias = baseAlias
              for (let i = 0; i < pathParts.length - 1; i++) {
                finalAlias = `${finalAlias}_${pathParts[i]}`
              }

              const finalScope = aliasScopeMap.get(finalAlias) || targetType
              const operator = resolveSearchOperator(searchInfo.fieldDef)
              applyComparison(this, finalScope, finalAlias, fieldName, operator, searchInfo.filterValue)
            } else {
              const operator = resolveSearchOperator(searchInfo.fieldDef)
              const finalScope = aliasScopeMap.get(baseAlias) || targetType
              applyComparison(this, finalScope, baseAlias, targetFieldPath, operator, searchInfo.filterValue)
            }
          })
        }
      })
    }
  })
}

/**
 * Processes filters that require JOINs to access fields in related tables using dot notation
 *
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 *
 * @example
 * // Input: Simple cross-table filter
 * const searchSchema = {
 *   author_name: {
 *     type: 'string',
 *     actualField: 'author.name',  // Dot notation indicates JOIN needed
 *     filterOperator: 'like'
 *   }
 * };
 *
 * // Filter request: { author_name: 'Smith' }
 * // Query before: SELECT * FROM articles
 *
 * // Result: Adds JOIN and qualified WHERE
 * // Query after:
 * // SELECT * FROM articles
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // WHERE articles_author.name LIKE '%Smith%'
 *
 * @example
 * // Input: Multi-field search across tables
 * const searchSchema = {
 *   search: {
 *     type: 'string',
 *     oneOf: [
 *       'title',           // Local field
 *       'content',         // Local field
 *       'author.name',     // Requires JOIN to users
 *       'category.title'   // Requires JOIN to categories
 *     ],
 *     filterOperator: 'like'
 *   }
 * };
 *
 * // Filter request: { search: 'JavaScript' }
 *
 * // Result: Multiple JOINs and OR conditions
 * // SELECT DISTINCT * FROM articles
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // LEFT JOIN categories AS articles_category ON articles.category_id = articles_category.id
 * // WHERE (
 * //   articles.title LIKE '%JavaScript%' OR
 * //   articles.content LIKE '%JavaScript%' OR
 * //   articles_author.name LIKE '%JavaScript%' OR
 * //   articles_category.title LIKE '%JavaScript%'
 * // )
 *
 * @example
 * // Input: Deep nested relationships (3 levels)
 * const searchSchema = {
 *   company_country: {
 *     type: 'string',
 *     actualField: 'author.company.country.name'
 *   }
 * };
 *
 * // Filter request: { company_country: 'USA' }
 *
 * // Result: Chain of JOINs following relationships
 * // SELECT * FROM articles
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // LEFT JOIN companies AS articles_author_company ON articles_author.company_id = articles_author_company.id
 * // LEFT JOIN countries AS articles_author_company_country ON articles_author_company.country_id = articles_author_company_country.id
 * // WHERE articles_author_company_country.name = 'USA'
 *
 * @description
 * Used by:
 * - rest-api-knex-plugin calls this hook second during query building
 * - Runs after polymorphicFiltersHook but before basicFiltersHook
 * - Applied when filters contain dot notation in actualField or oneOf
 *
 * Purpose:
 * - Enables filtering on related table fields without manual JOIN writing
 * - Automatically builds JOIN chains from dot notation paths
 * - Detects one-to-many relationships and adds DISTINCT to prevent duplicates
 * - Creates unique aliases to avoid naming conflicts
 * - Validates that target fields are indexed for performance
 *
 * Data flow:
 * 1. Scans filters for dot notation in actualField or oneOf arrays
 * 2. For each cross-table reference, builds JOIN chain via buildJoinChain
 * 3. Applies JOINs to query with proper aliasing
 * 4. Adds DISTINCT if any one-to-many JOINs detected
 * 5. Applies WHERE conditions using qualified field names
 * 6. Sets hasJoins flag for basicFiltersHook to use
 */
export const crossTableFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies
  const adapterUtils = createAdapterUtilities(hookParams, dependencies)

  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName
  const filters = hookParams.context?.knexQuery?.filters
  const query = hookParams.context?.knexQuery?.query
  const db = hookParams.context?.knexQuery?.db || knex

  const schemaInfo = scopes[scopeName].vars.schemaInfo
  const tableName = schemaInfo.tableName
  const tableAlias = adapterUtils.defaultAliasForScope(scopeName)
  const aliasScopeMap = new Map()
  aliasScopeMap.set(tableAlias, scopeName)

  if (!filters) {
    return
  }

  // Step 1: Analyze indexes
  const requiredIndexes = analyzeRequiredIndexes(scopes, log, scopeName, schemaInfo)
  if (requiredIndexes.length > 0) {
    log.debug('Cross-table search requires indexes:', requiredIndexes)
  }

  // Step 2: Build JOIN maps
  const joinMap = new Map()
  const fieldPathMap = new Map()
  let hasCrossTableFilters = false

  for (const [filterKey, fieldDef] of Object.entries(schemaInfo.searchSchemaStructure)) {
    if (filters[filterKey] === undefined) continue

    // Skip polymorphic filters
    if (fieldDef.polymorphicField) continue

    // Check actualField for cross-table references
    if (fieldDef.actualField?.includes('.')) {
      hasCrossTableFilters = true
      log.trace('[JOIN-DETECTION] Cross-table actualField found', { filterKey, actualField: fieldDef.actualField, scopeName })
      const joinInfo = await buildJoinChain(scopes, log, scopeName, fieldDef.actualField)
      if (!joinMap.has(joinInfo.joinAlias)) {
        joinMap.set(joinInfo.joinAlias, joinInfo)
      }
      fieldPathMap.set(fieldDef.actualField, `${joinInfo.joinAlias}.${joinInfo.targetField}`)
    }

    // Check oneOf for cross-table references
    if (fieldDef.oneOf && Array.isArray(fieldDef.oneOf)) {
      for (const field of fieldDef.oneOf) {
        if (field.includes('.')) {
          hasCrossTableFilters = true
          log.trace('[JOIN-DETECTION] Cross-table oneOf field found', { filterKey, field, scopeName })
          const joinInfo = await buildJoinChain(scopes, log, scopeName, field)
          if (!joinMap.has(joinInfo.joinAlias)) {
            joinMap.set(joinInfo.joinAlias, joinInfo)
          }
          fieldPathMap.set(field, `${joinInfo.joinAlias}.${joinInfo.targetField}`)
        }
      }
    }
  }

  if (!hasCrossTableFilters) {
    return
  }

  joinMap.forEach((joinInfo) => {
    if (joinInfo.joinAlias) {
      aliasScopeMap.set(joinInfo.joinAlias, joinInfo.targetScopeName || joinInfo.targetTableName)
    }
    if (joinInfo.isMultiLevel && Array.isArray(joinInfo.joinChain)) {
      joinInfo.joinChain.forEach((join) => {
        if (join.joinAlias) {
          aliasScopeMap.set(join.joinAlias, join.targetScopeName || join.targetTableName)
        }
      })
    }
  })

  const translateQualifiedColumn = (qualified) => {
    const trimmed = qualified.trim()
    if (!trimmed.includes('.')) {
      return adapterUtils.translateColumn(scopeName, trimmed, tableAlias)
    }

    const [alias, ...fieldParts] = trimmed.split('.')
    const field = fieldParts.join('.')
    const scopeForAlias = aliasScopeMap.get(alias) || scopeName
    return adapterUtils.translateColumn(scopeForAlias, field, alias)
  }

  const resolveFieldColumn = (field) => {
    if (field.includes('.')) {
      const qualified = fieldPathMap.get(field) || field
      return translateQualifiedColumn(qualified)
    }
    return adapterUtils.translateColumn(scopeName, field, tableAlias)
  }

  const normalizeFieldValue = (field, value) => {
    if (field.includes('.')) {
      const qualified = fieldPathMap.get(field) || field
      const [alias, ...rest] = qualified.split('.')
      const fieldName = rest.join('.')
      const valueScope = aliasScopeMap.get(alias) || scopeName
      if (Array.isArray(value)) {
        return value.map((entry) => adapterUtils.translateFilterValue(valueScope, fieldName, entry))
      }
      return adapterUtils.translateFilterValue(valueScope, fieldName, value)
    }
    if (Array.isArray(value)) {
      return value.map((entry) => adapterUtils.translateFilterValue(scopeName, field, entry))
    }
    return adapterUtils.translateFilterValue(scopeName, field, value)
  }

  // Step 3: Apply JOINs
  const appliedJoins = new Set()

  const applyPolymorphicJoin = (join) => {
    query.leftJoin(`${join.targetTableName} as ${join.joinAlias}`, function () {
      const parts = join.joinCondition.split(' AND ')
      const [typeCondition, idCondition] = parts

      const typeMatch = typeCondition.match(/(.+?)\s*=\s*'(.+?)'/)
      if (typeMatch) {
        const typeColumnToken = typeMatch[1].trim()
        const typeAlias = typeColumnToken.split('.')[0]
        const typeField = typeColumnToken.split('.').slice(1).join('.')
        const typeScope = aliasScopeMap.get(typeAlias) || scopeName
        const translatedColumn = translateQualifiedColumn(typeColumnToken)
        const translatedValue = adapterUtils.translateFilterValue(typeScope, typeField, typeMatch[2])
        this.on(translatedColumn, db.raw('?', [translatedValue]))
      }

      const idMatch = idCondition.match(/(.+?)\s*=\s*(.+)/)
      if (idMatch) {
        const leftToken = idMatch[1].trim()
        const rightToken = idMatch[2].trim()
        const leftColumn = translateQualifiedColumn(leftToken)
        const rightColumn = translateQualifiedColumn(rightToken)
        this.andOn(leftColumn, rightColumn)
      }
    })
  }

  const applyStandardJoin = (join) => {
    const [leftSide, rightSide] = join.joinCondition.split(' = ')
    const translatedLeft = translateQualifiedColumn(leftSide.trim())
    const translatedRight = translateQualifiedColumn(rightSide.trim())
    query.leftJoin(`${join.targetTableName} as ${join.joinAlias}`, function () {
      this.on(translatedLeft, translatedRight)
    })
  }

  const processJoin = (join) => {
    const joinKey = `${join.joinAlias}:${join.joinCondition}`
    if (appliedJoins.has(joinKey)) return

    if (join.isPolymorphic && join.joinCondition.includes(' AND ')) {
      applyPolymorphicJoin(join)
    } else {
      applyStandardJoin(join)
    }

    appliedJoins.add(joinKey)
  }

  joinMap.forEach((joinInfo) => {
    if (joinInfo.isMultiLevel && Array.isArray(joinInfo.joinChain)) {
      joinInfo.joinChain.forEach(processJoin)
    } else {
      processJoin(joinInfo)
    }
  })

  // Step 4: Handle DISTINCT
  let hasOneToManyJoins = false
  joinMap.forEach((joinInfo) => {
    if (joinInfo.isOneToMany) {
      hasOneToManyJoins = true
    } else if (joinInfo.isMultiLevel && joinInfo.joinChain) {
      joinInfo.joinChain.forEach(join => {
        if (join.isOneToMany) hasOneToManyJoins = true
      })
    }
  })

  if (hasOneToManyJoins) {
    log.trace('[DISTINCT] Adding DISTINCT to query due to one-to-many JOINs')
    query.distinct()
  }

  // Store state for basic filters hook
  hookParams.context.knexQuery.hasJoins = true

  // Step 5: Apply WHERE conditions for cross-table filters
  query.where(function () {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      const fieldDef = schemaInfo.searchSchemaStructure[filterKey]
      if (!fieldDef) continue

      // Skip non-cross-table and polymorphic filters
      if (fieldDef.polymorphicField) continue
      if (!fieldDef.actualField?.includes('.') &&
          !fieldDef.oneOf?.some(f => f.includes('.'))) {
        continue
      }

      // Process cross-table filters
      switch (true) {
        case fieldDef.oneOf && Array.isArray(fieldDef.oneOf): {
          const operator = resolveSearchOperator(fieldDef)

          let searchTerms = [filterValue]
          if (fieldDef.splitBy && typeof filterValue === 'string') {
            searchTerms = filterValue.split(fieldDef.splitBy).filter(term => term.trim())
          } else if (Array.isArray(filterValue)) {
            searchTerms = filterValue
          }

          const applyTermComparison = (builder, method, field, raw) => {
            const columnRef = resolveFieldColumn(field)
            const normalized = normalizeFieldValue(field, raw)
            applyWhereForOperator({
              builder,
              columnRef,
              operator,
              value: normalized,
              knex,
              or: method === 'or',
            })
          }

          this.where(function () {
            if (fieldDef.matchAll && searchTerms.length > 1) {
              searchTerms.forEach(term => {
                this.andWhere(function () {
                  fieldDef.oneOf.forEach((field, index) => {
                    const method = index === 0 ? 'and' : 'or'
                    applyTermComparison(this, method, field, term)
                  })
                })
              })
            } else {
              fieldDef.oneOf.forEach((field, index) => {
                const method = index === 0 ? 'and' : 'or'
                applyTermComparison(this, method, field, filterValue)
              })
            }
          })
          break
        }

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          fieldDef.applyFilter.call(this, this, filterValue)
          break

        default:
          const targetField = fieldDef.actualField || filterKey
          const columnRef = resolveFieldColumn(targetField)
          const operator = resolveSearchOperator(fieldDef)
          const normalized = normalizeFieldValue(targetField, filterValue)
          applyWhereForOperator({ builder: this, columnRef, operator, value: normalized, knex })
          break
        }
    }
  })
}

/**
 * Processes filters that apply directly to fields on the main table
 *
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 *
 * @example
 * // Input: Basic equality filter
 * const searchSchema = {
 *   status: {
 *     type: 'string',
 *     filterOperator: '='  // Default is '=' if not specified
 *   }
 * };
 *
 * // Filter request: { status: 'published' }
 * // Query before: SELECT * FROM articles
 *
 * // Result: Adds qualified WHERE clause
 * // Query after: SELECT * FROM articles WHERE articles.status = 'published'
 *
 * @example
 * // Input: LIKE filter for partial text matching
 * const searchSchema = {
 *   title: {
 *     type: 'string',
 *     filterOperator: 'like'
 *   },
 *   content: {
 *     type: 'string',
 *     filterOperator: 'like'
 *   }
 * };
 *
 * // Filter request: { title: 'JavaScript', content: 'async' }
 *
 * // Result: Multiple LIKE conditions
 * // WHERE articles.title LIKE '%JavaScript%'
 * // AND articles.content LIKE '%async%'
 *
 * @example
 * // Input: Multi-field OR search with oneOf
 * const searchSchema = {
 *   search: {
 *     type: 'string',
 *     oneOf: ['title', 'content', 'summary'],
 *     filterOperator: 'like',
 *     splitBy: ' ',        // Split search terms by space
 *     matchAll: true       // All terms must match somewhere
 *   }
 * };
 *
 * // Filter request: { search: 'REST API' }
 *
 * // Result: Each term must match in at least one field
 * // WHERE (
 * //   (articles.title LIKE '%REST%' OR articles.content LIKE '%REST%' OR articles.summary LIKE '%REST%')
 * //   AND
 * //   (articles.title LIKE '%API%' OR articles.content LIKE '%API%' OR articles.summary LIKE '%API%')
 * // )
 *
 * @example
 * // Input: Advanced operators - IN and BETWEEN
 * const searchSchema = {
 *   category_id: {
 *     type: 'array',
 *     filterOperator: 'in'
 *   },
 *   price: {
 *     type: 'array',
 *     filterOperator: 'between'
 *   },
 *   tags: {
 *     type: 'array',
 *     filterOperator: 'in'
 *   }
 * };
 *
 * // Filter request: {
 * //   category_id: [1, 2, 3],
 * //   price: [10.00, 99.99],
 * //   tags: ['javascript', 'nodejs']
 * // }
 *
 * // Result: IN and BETWEEN clauses
 * // WHERE articles.category_id IN (1, 2, 3)
 * // AND articles.price BETWEEN 10.00 AND 99.99
 * // AND articles.tags IN ('javascript', 'nodejs')
 *
 * @example
 * // Input: Custom filter function
 * const searchSchema = {
 *   has_comments: {
 *     type: 'boolean',
 *     applyFilter: function(query, value) {
 *       if (value === true) {
 *         query.whereExists(function() {
 *           this.select('id')
 *               .from('comments')
 *               .whereRaw('comments.article_id = articles.id');
 *         });
 *       } else if (value === false) {
 *         query.whereNotExists(function() {
 *           this.select('id')
 *               .from('comments')
 *               .whereRaw('comments.article_id = articles.id');
 *         });
 *       }
 *     }
 *   }
 * };
 *
 * // Filter request: { has_comments: true }
 *
 * // Result: Subquery to check existence
 * // WHERE EXISTS (
 * //   SELECT id FROM comments WHERE comments.article_id = articles.id
 * // )
 *
 * @description
 * Used by:
 * - rest-api-knex-plugin calls this hook last during query building
 * - Runs after all JOINs have been established by previous hooks
 * - Handles all non-cross-table, non-polymorphic filters
 *
 * Purpose:
 * - Implements standard SQL filtering operations safely via Knex
 * - Always qualifies field names with table name to prevent ambiguity
 * - Supports various operators: =, like, in, between, and custom
 * - Enables multi-field OR searches with optional term splitting
 * - Handles null values appropriately (using whereNull)
 * - Allows custom filter logic via applyFilter functions
 *
 * Data flow:
 * 1. Skips filters already handled by polymorphic/cross-table hooks
 * 2. Qualifies all field names with table name (e.g., articles.title)
 * 3. Applies appropriate WHERE clause based on filterOperator
 * 4. For oneOf filters, creates OR conditions across specified fields
 * 5. For custom filters, delegates to applyFilter function
 * 6. Returns query with all basic filters applied
 */
export const basicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies
  const adapterUtils = createAdapterUtilities(hookParams, dependencies)

  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName
  const filters = hookParams.context?.knexQuery?.filters
  const query = hookParams.context?.knexQuery?.query
  const db = hookParams.context?.knexQuery?.db || knex

  const schemaInfo = scopes[scopeName].vars.schemaInfo
  const tableName = schemaInfo.tableName
  const tableAlias = adapterUtils.defaultAliasForScope(scopeName)

  log.trace('[DEBUG basicFiltersHook] Called with:', {
    scopeName,
    hasFilters: !!filters,
    filters,
    searchSchemaKeys: Object.keys(schemaInfo.searchSchemaStructure || {}),
    tableName
  })

  if (!filters) {
    log.trace('[DEBUG basicFiltersHook] Returning early - no filters')
    return
  }

  // Check if we have any JOINs applied (to know if we need to qualify fields)
  // Instead of relying on hasJoins flag, always qualify fields for safety
  const qualifyField = (field) => adapterUtils.translateColumn(scopeName, field, tableAlias)
  const normalizeValue = (field, value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => adapterUtils.translateFilterValue(scopeName, field, entry))
    }
    return adapterUtils.translateFilterValue(scopeName, field, value)
  }

  // Main WHERE group
  query.where(function () {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      const fieldDef = schemaInfo.searchSchemaStructure[filterKey]
      if (!fieldDef) {
        log.trace(`[DEBUG basicFiltersHook] No field definition for filter key: ${filterKey}`)
        continue
      }
      log.trace(`[DEBUG basicFiltersHook] Processing filter: ${filterKey} = ${filterValue}, fieldDef:`, fieldDef)

      // Skip if this is a cross-table filter
      if (fieldDef.actualField?.includes('.') ||
          fieldDef.oneOf?.some(f => f.includes('.')) ||
          fieldDef.polymorphicField) {
        log.trace(`[DEBUG basicFiltersHook] Skipping filter ${filterKey} - is cross-table or polymorphic`)
        continue
      }

      // Process basic filters
      switch (true) {
        case fieldDef.oneOf && Array.isArray(fieldDef.oneOf): {
          // Multi-field OR search
          const operator = resolveSearchOperator(fieldDef)

          // Handle split search terms
          let searchTerms = [filterValue]
          if (fieldDef.splitBy && typeof filterValue === 'string') {
            searchTerms = filterValue.split(fieldDef.splitBy).filter(term => term.trim())
          }

          this.where(function () {
            if (fieldDef.matchAll && searchTerms.length > 1) {
              searchTerms.forEach(term => {
                const normalizedTerm = normalizeValue(fieldDef.oneOf[0], term)
                this.andWhere(function () {
                  fieldDef.oneOf.forEach((field, index) => {
                    const columnRef = qualifyField(field)
                    const perFieldValue = Array.isArray(normalizedTerm)
                      ? normalizeValue(field, term)
                      : normalizeValue(field, term)
                    applyWhereForOperator({
                      builder: this,
                      columnRef,
                      operator,
                      value: perFieldValue,
                      knex,
                      or: index !== 0,
                    })
                  })
                })
              })
            } else {
              fieldDef.oneOf.forEach((field, index) => {
                const columnRef = qualifyField(field)
                const normalizedValue = normalizeValue(field, filterValue)
                applyWhereForOperator({
                  builder: this,
                  columnRef,
                  operator,
                  value: normalizedValue,
                  knex,
                  or: index !== 0,
                })
              })
            }
          })
          break
        }

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          // Custom filter
          fieldDef.applyFilter.call(this, this, filterValue)
          break

        default:
          // Standard filtering
          const actualField = fieldDef.actualField || filterKey
          // Always qualify field names
          const dbField = qualifyField(actualField)

          const operator = resolveSearchOperator(fieldDef)
          const normalized = normalizeValue(actualField, filterValue)
          log.trace(`[DEBUG basicFiltersHook] Applying filter: ${dbField} ${operator} ${filterValue}`)
          applyWhereForOperator({ builder: this, columnRef: dbField, operator, value: normalized, knex })
          break
        }
    }
  })
}
