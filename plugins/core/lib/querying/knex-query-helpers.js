import { assertScalarQueryField } from '../querying-writing/field-utils.js'
import { buildJoinChain } from './knex-cross-table-search.js'
import { createStorageAdapterUtilities } from './storage-adapter-utils.js'
import { unwrapQueryBuilderState } from './query-builder-utils.js'
import { RestApiResourceError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { resolveSortField } from './query-field-sort-helpers.js'
import { databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'

const referenceVisibility = Symbol('referenceVisibility')

async function buildSearchJoinQuery ({ scopeName, scopes, context, adapterUtils, db }) {
  const scope = scopes[scopeName]
  const storageAdapter = adapterUtils.fetchStorageAdapter(scopeName)
  if (!scope || !storageAdapter) throw new RestApiResourceError(`Related resource '${scopeName}' not found`, { subtype: 'related_type_not_found' })
  const tableName = storageAdapter.getTableName()
  const query = storageAdapter.buildBaseQuery({ transaction: db }).select(`${tableName}.*`)
  const state = await scope.applyQueryFilters({
    query,
    scopeName,
    tableName,
    db,
    storageAdapter,
    schemaInfo: scope.vars.schemaInfo,
    queryPurpose: 'search-join',
    isAnyApi: storageAdapter.isCanonical()
  }, { ...context, queryParams: {}, scopeName, schemaInfo: scope.vars.schemaInfo, storageAdapter })
  return { query: unwrapQueryBuilderState(state, query) }
}

async function resolveSearchColumns (references, { scopes, context, adapterUtils, db, operation = 'filter' }) {
  const columns = new Map()
  for (const [key, { scopeName, field, alias }] of references) {
    const column = adapterUtils.translateColumn(scopeName, field, alias)
    const schemaInfo = scopes[scopeName]?.vars?.schemaInfo
    const fieldDef = schemaInfo?.schemaStructure?.[field]
    assertScalarQueryField(fieldDef, field, operation)
    let idField, typeField, targets
    if (fieldDef?.belongsTo) {
      idField = field
      targets = [fieldDef.belongsTo]
    } else {
      for (const [name, definition] of Object.entries({ ...schemaInfo?.schemaStructure, ...schemaInfo?.schemaRelationships })) {
        const polymorphic = definition?.belongsToPolymorphic
        if (!polymorphic) continue
        const referenceId = polymorphic.idField || `${name}_id`
        const referenceType = polymorphic.typeField || `${name}_type`
        if (field !== referenceId && field !== referenceType) continue
        idField = referenceId
        typeField = referenceType
        targets = polymorphic.types
        break
      }
    }
    if (!targets) {
      columns.set(key, column)
      continue
    }

    const selections = []
    const targetAlias = alias === '__jra_reference' ? '__jra_reference_target' : '__jra_reference'
    for (const target of targets) {
      const state = await buildSearchJoinQuery({ scopeName: target, scopes, context, adapterUtils, db })
      const selection = db.queryBuilder().from(state.query.as(targetAlias)).select(db.raw('1'))
        .whereColumn(adapterUtils.translateColumn(target, 'id', targetAlias), adapterUtils.translateColumn(scopeName, idField, alias))
      if (typeField) selection.where(adapterUtils.translateColumn(scopeName, typeField, alias), adapterUtils.translateFilterValue(scopeName, typeField, target))
      selections.push(selection)
    }
    columns.set(key, { column, [referenceVisibility]: selections })
  }
  return columns
}

export async function prepareReferenceSortColumns ({ query, fields, scopeName, tableAlias, context }, dependencies) {
  const { scopes, knex, getStorageAdapter } = dependencies
  const storageAdapter = getStorageAdapter(scopeName)
  const tableName = storageAdapter.getTableName()
  const db = context.db || context.transaction || knex
  const schemaInfo = scopes[scopeName].vars.schemaInfo
  const adapterUtils = createStorageAdapterUtilities({
    context: {
      ...context, knexQuery: { scopeName, tableName, storageAdapter }
    }
  }, dependencies)
  const references = new Map(fields.map(field => [field, {
    scopeName, alias: tableName, field: resolveSortField(field, schemaInfo)
  }]))
  const resolved = await resolveSearchColumns(references, { scopes, context, adapterUtils, db, operation: 'sort' })
  const columns = new Map()
  if (![...resolved.values()].some(reference => reference?.[referenceVisibility])) return columns
  const resultNames = new Set([
    ...fields,
    ...Object.keys(scopes[scopeName].vars.schemaInfo?.queryFields || {}),
    ...Object.keys(schemaInfo.schemaStructure).flatMap(field => [field, storageAdapter.translateColumn(field)])
  ])
  let resultIndex = 0
  for (const [field, reference] of resolved) {
    const selections = reference?.[referenceVisibility]
    if (!selections) continue
    const joinAlias = `__jra_sort_${columns.size}${tableAlias === `__jra_sort_${columns.size}` ? '_target' : ''}`
    while (resultNames.has(`__jra_sort_value_${resultIndex}`)) resultIndex++
    const resultColumn = `__jra_sort_value_${resultIndex++}`
    // A filtered copy preserves the source column's affinity and collation.
    const visibleSource = storageAdapter.buildBaseQuery({ transaction: db })
      .select({ __jra_id: `${tableName}.${storageAdapter.getIdColumn()}`, __jra_value: reference.column })
      .where(function () {
        if (selections.length === 0) this.whereRaw('1 = 0')
        for (const selection of selections) this.orWhereExists(selection)
      })
    const column = `${joinAlias}.__jra_value`
    query.leftJoin(visibleSource.as(joinAlias), `${tableAlias}.${storageAdapter.getIdColumn()}`, `${joinAlias}.__jra_id`)
    query.select({ [resultColumn]: databaseIdentityExpression(db, column) })
    columns.set(field, { column, resultColumn, referenceField: references.get(field).field })
  }
  return columns
}

// Resolve operator with sensible defaults for fields declared in searchSchema.
// - If filterOperator is provided, use it as-is
// - If no operator is provided, default to '='
export function resolveSearchOperator (fieldDef) {
  if (fieldDef && fieldDef.filterOperator) return String(fieldDef.filterOperator)
  return '='
}

// Apply a comparison for a single field/operator/value onto a query builder.
// Handles text matching, IN, BETWEEN, and explicit null comparisons.
export function applyWhereForOperator ({ builder, columnRef, operator, value, knex, or = false }) {
  const method = or ? 'orWhere' : 'where'
  const methodNull = or ? 'orWhereNull' : 'whereNull'
  const methodIn = or ? 'orWhereIn' : 'whereIn'

  const selections = columnRef?.[referenceVisibility]
  if (selections) {
    const visible = function () {
      if (selections.length === 0) this.whereRaw('1 = 0')
      for (const selection of selections) this.orWhereExists(selection)
    }
    // Compare the column itself to preserve driver affinity and collation.
    builder[method](function () {
      this.where(function () {
        this.where(visible)
        applyWhereForOperator({ builder: this, columnRef: columnRef.column, operator, value, knex })
      }).orWhere(function () {
        this.whereNot(visible)
        applyWhereForOperator({ builder: this, columnRef: knex.raw('null'), operator, value, knex })
      })
    })
    return
  }
  const likeOp = 'like'

  const op = typeof operator === 'string' ? operator.toLowerCase() : operator
  const textSearch = ['like', 'contains', 'startswith', 'endswith'].includes(op)

  // Normalize scalar from possibly array input
  const firstVal = Array.isArray(value) ? value[0] : value

  // Null handling for equality and string ops
  if (firstVal === null || firstVal === undefined) {
    if (textSearch) {
      builder[methodNull](columnRef)
      return
    }
    if (op === '=' || op === '==') {
      builder[methodNull](columnRef)
      return
    }
    if (op === '!=' || op === '<>' || op === 'is not') {
      builder[or ? 'orWhereNotNull' : 'whereNotNull'](columnRef)
      return
    }
  }

  // Text search operators
  if (textSearch) {
    const textColumn = knex.client.config.client === 'pg' ? knex.raw('cast(?? as text)', [columnRef]) : columnRef
    const prefix = op === 'startswith' ? '' : '%'
    const suffix = op === 'endswith' ? '' : '%'
    builder[method](textColumn, likeOp, `${prefix}${String(firstVal)}${suffix}`)
    return
  }

  // Array-based operators
  if (op === 'in') {
    const values = Array.isArray(value) ? value : [value]
    builder[methodIn](columnRef, values)
    return
  }
  if (op === 'between') {
    if (!Array.isArray(value) || value.length !== 2 || value.some(bound => bound == null)) {
      throw new RestApiValidationError('A between filter requires exactly two non-null bounds')
    }
    builder[or ? 'orWhereBetween' : 'whereBetween'](columnRef, value)
    return
  }

  // Default
  builder[method](columnRef, operator || '=', firstVal)
}

/**
 * Processes filters that target polymorphic relationships where a single relationship can point to different types of resources
 *
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 */
export const polymorphicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies
  const adapterUtils = createStorageAdapterUtilities(hookParams, dependencies)

  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName
  const filters = hookParams.context?.knexQuery?.filters
  const query = hookParams.context?.knexQuery?.query
  const db = hookParams.context?.knexQuery?.db || knex

  if (!scopeName || !filters || !scopes[scopeName]) {
    return
  }

  const schemaInfo = scopes[scopeName].vars.schemaInfo
  const tableAlias = adapterUtils.defaultAliasForScope(scopeName)

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

  for (const [, searchInfo] of polymorphicSearches) {
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
        const targetState = await buildSearchJoinQuery({ scopeName: targetType, scopes, context: hookParams.context, adapterUtils, db })
        query.leftJoin(targetState.query.as(baseAlias), function () {
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
      }

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

          if (!polymorphicJoins.get(baseAlias).aliasScopeMap.has(nextAlias)) {
            const nextState = await buildSearchJoinQuery({ scopeName: nextScope, scopes, context: hookParams.context, adapterUtils, db })
            query.leftJoin(nextState.query.as(nextAlias), sourceColumn, targetColumn)
          }

          currentAlias = nextAlias
          currentScope = nextScope

          polymorphicJoins.get(baseAlias).aliasScopeMap.set(currentAlias, currentScope)
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

  const references = new Map()
  for (const { fieldDef, polymorphicField } of polymorphicSearches.values()) {
    for (const [target, path] of Object.entries(fieldDef.targetFields)) {
      const baseAlias = `${tableAlias}_${polymorphicField}_${target}`
      const parts = path.split('.')
      const field = parts.pop()
      const alias = [baseAlias, ...parts].join('_')
      const targetScope = polymorphicJoins.get(baseAlias).aliasScopeMap.get(alias)
      references.set(adapterUtils.translateColumn(targetScope, field, alias), { scopeName: targetScope, field, alias })
    }
  }
  const columns = await resolveSearchColumns(references, { scopes, context: hookParams.context, adapterUtils, db })

  // Step 3: Apply WHERE conditions
  query.where(function applyPolymorphicWhere () {
    const applyComparison = (builder, scope, alias, field, operator, rawValue) => {
      const qualified = adapterUtils.translateColumn(scope, field, alias)
      const columnRef = columns.get(qualified) || qualified
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
            this.whereNotNull(adapterUtils.translateColumn(targetType, 'id', baseAlias))
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
 */
export const crossTableFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies
  const adapterUtils = createStorageAdapterUtilities(hookParams, dependencies)

  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName
  const filters = hookParams.context?.knexQuery?.filters
  const query = hookParams.context?.knexQuery?.query
  const db = hookParams.context?.knexQuery?.db || knex

  if (!scopeName || !filters || !scopes[scopeName]) {
    return
  }

  const schemaInfo = scopes[scopeName].vars.schemaInfo
  const tableAlias = adapterUtils.defaultAliasForScope(scopeName)
  const aliasScopeMap = new Map()
  aliasScopeMap.set(tableAlias, scopeName)

  // Build JOIN maps.
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

  const resolveFieldColumn = field => columns.get(field)

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

  // Apply JOINs.
  const appliedJoins = new Set()

  const applyPolymorphicJoin = (join, source) => {
    query.leftJoin(source.as(join.joinAlias), function () {
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

  const applyStandardJoin = (join, source) => {
    const [leftSide, rightSide] = join.joinCondition.split(' = ')
    const translatedLeft = translateQualifiedColumn(leftSide.trim())
    const translatedRight = translateQualifiedColumn(rightSide.trim())
    query.leftJoin(source.as(join.joinAlias), function () {
      this.on(translatedLeft, translatedRight)
    })
  }

  const processJoin = async (join) => {
    const joinKey = `${join.joinAlias}:${join.joinCondition}`
    if (appliedJoins.has(joinKey)) return

    const state = join.relationshipType === 'manyToMany_pivot' && dependencies.buildSearchMembershipQuery
      ? await dependencies.buildSearchMembershipQuery({ ...join, db, context: hookParams.context })
      : await buildSearchJoinQuery({ scopeName: join.targetScopeName, scopes, context: hookParams.context, adapterUtils, db })
    if (join.isPolymorphic && join.joinCondition.includes(' AND ')) {
      applyPolymorphicJoin(join, state.query)
    } else {
      applyStandardJoin(join, state.query)
    }

    appliedJoins.add(joinKey)
  }

  for (const joinInfo of joinMap.values()) {
    if (joinInfo.isMultiLevel && Array.isArray(joinInfo.joinChain)) {
      for (const join of joinInfo.joinChain) await processJoin(join)
    } else {
      await processJoin(joinInfo)
    }
  }

  // Handle DISTINCT.
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

  const references = new Map()
  for (const filterKey of Object.keys(filters)) {
    const fieldDef = schemaInfo.searchSchemaStructure[filterKey]
    if (!fieldDef || fieldDef.polymorphicField ||
      (!fieldDef.actualField?.includes('.') && !fieldDef.oneOf?.some(field => field.includes('.')))) continue
    for (const field of fieldDef.oneOf || [fieldDef.actualField || filterKey]) {
      if (field.includes('.')) {
        const [alias, ...parts] = (fieldPathMap.get(field) || field).split('.')
        references.set(field, { scopeName: aliasScopeMap.get(alias) || scopeName, field: parts.join('.'), alias })
      } else {
        references.set(field, { scopeName, field, alias: tableAlias })
      }
    }
  }
  const columns = await resolveSearchColumns(references, { scopes, context: hookParams.context, adapterUtils, db })

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
            searchTerms.forEach((term, termIndex) => {
              const join = fieldDef.matchAll || termIndex === 0 ? 'where' : 'orWhere'
              this[join](function () {
                fieldDef.oneOf.forEach((field, index) => {
                  applyTermComparison(this, index === 0 ? 'and' : 'or', field, term)
                })
              })
            })
          })
          break
        }

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          fieldDef.applyFilter.call(this, this, filterValue, {
            column: field => translateQualifiedColumn(fieldPathMap.get(field) || field),
            value: normalizeFieldValue,
            context: hookParams.context,
            scopeName
          })
          break

        default: {
          const targetField = fieldDef.actualField || filterKey
          const columnRef = resolveFieldColumn(targetField)
          const operator = resolveSearchOperator(fieldDef)
          const normalized = normalizeFieldValue(targetField, filterValue)
          applyWhereForOperator({ builder: this, columnRef, operator, value: normalized, knex })
          break
        }
      }
    }
  })
}

/**
 * Processes filters that apply directly to fields on the main table
 *
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 */
export const basicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies
  const adapterUtils = createStorageAdapterUtilities(hookParams, dependencies)

  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName
  const filters = hookParams.context?.knexQuery?.filters
  const query = hookParams.context?.knexQuery?.query
  const db = hookParams.context?.knexQuery?.db || knex
  if (!scopeName || !filters || !scopes[scopeName]) {
    return
  }

  const schemaInfo = scopes[scopeName].vars.schemaInfo
  const tableName = schemaInfo.tableName
  const tableAlias = adapterUtils.defaultAliasForScope(scopeName)

  log.trace('[DEBUG basicFiltersHook] Called with:', {
    scopeName,
    hasFilters: !!filters,
    tableName
  })

  const references = new Map()
  for (const filterKey of Object.keys(filters)) {
    const fieldDef = schemaInfo.searchSchemaStructure[filterKey]
    if (!fieldDef || fieldDef.polymorphicField || fieldDef.actualField?.includes('.') ||
      fieldDef.oneOf?.some(field => field.includes('.')) || (fieldDef.applyFilter && !fieldDef.oneOf)) continue
    for (const field of fieldDef.oneOf || [fieldDef.actualField || filterKey]) references.set(field, { scopeName, field, alias: tableAlias })
  }
  const columns = await resolveSearchColumns(references, { scopes, context: hookParams.context, adapterUtils, db })
  const qualifyField = field => columns.get(field)
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
      log.trace(`[DEBUG basicFiltersHook] Processing filter: ${filterKey}`)

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
            searchTerms.forEach((term, termIndex) => {
              const join = fieldDef.matchAll || termIndex === 0 ? 'where' : 'orWhere'
              this[join](function () {
                fieldDef.oneOf.forEach((field, index) => {
                  applyWhereForOperator({
                    builder: this,
                    columnRef: qualifyField(field),
                    operator,
                    value: normalizeValue(field, term),
                    knex,
                    or: index !== 0,
                  })
                })
              })
            })
          })
          break
        }

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          // Custom filter
          fieldDef.applyFilter.call(this, this, filterValue, {
            column: field => adapterUtils.translateColumn(scopeName, field, tableAlias),
            value: normalizeValue,
            context: hookParams.context,
            scopeName
          })
          break

        default: {
          // Standard filtering
          const actualField = fieldDef.actualField || filterKey
          // Always qualify field names
          const dbField = qualifyField(actualField)

          const operator = resolveSearchOperator(fieldDef)
          const normalized = normalizeValue(actualField, filterValue)
          log.trace(`[DEBUG basicFiltersHook] Applying filter: ${dbField} ${operator}`)
          applyWhereForOperator({ builder: this, columnRef: dbField, operator, value: normalized, knex })
          break
        }
      }
    }
  })
}
