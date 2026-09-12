import { whereInIdentifiers } from './identifier-query.js'
import { RELATIONSHIPS_KEY } from '../querying-writing/knex-constants.js'
import { databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'
import { getResourceFieldset, parseFieldset } from '../querying-writing/field-utils.js'
import {
  getIdColumnForScope,
  getFieldValueForScope,
  translateColumnForScope,
  applyScopeFiltersToIncludeQuery,
  parseIncludeTree,
} from './include-query-helpers.js'
/**
 * Loads relationship identifiers for all hasMany relationships without fetching full related records.
 *
 * ## Purpose
 * This function ensures that all hasMany relationships (one-to-many, many-to-many, and polymorphic)
 * always return resource identifiers in the JSON:API response, even when the related resources
 * are not included via the ?include parameter.
 *
 * ## Why this is needed
 * 1. **JSON:API Consistency**: The JSON:API spec allows servers to include relationship identifiers
 *    without including the full related resources. This provides a consistent API surface where
 *    clients always know what relationships exist and their IDs.
 *
 * 2. **Simplified Mode Support**: In simplified mode, relationship IDs are transformed into
 *    minimal objects (e.g., `reviews: [{id: '1'}, {id: '2'}, {id: '3'}]`). Without this function,
 *    these objects only appear when using ?include, creating an inconsistent API where fields appear/disappear.
 *
 * 3. **Performance Balance**: Loading just IDs is much cheaper than loading full records. This gives
 *    clients the ability to know what relationships exist without the cost of fetching all data.
 *
 * ## What it does
 * - Runs ONE query per relationship type (not per record) to fetch all related IDs
 * - Populates the relationship data with resource identifiers: `{ type: 'resource', id: '123' }`
 * - Handles all relationship types: one-to-many, many-to-many, and polymorphic
 * - Works for both JSON:API and simplified modes (transformation happens elsewhere)
 *
 * ## When it runs
 * This runs after the main records are fetched but before includes are processed.
 * If includes ARE specified, they will overwrite these IDs with full data.
 *
 * @param {Array<Object>} records - The parent records to load relationships for
 * @param {string} scopeName - The parent scope name (e.g., 'authors')
 * @param {Object} scopes - All available scopes with their schemas
 * @param {Object} knex - Knex instance for database queries
 * @param {import('../storage/storage-types.js').DataReadContext | null} [requestContext]
 * @returns {Promise<void>} Modifies records in place by adding relationship data
 */
export const loadRelationshipIdentifiers = async (records, scopeName, scopes, knex, requestContext = null) => {
  if (!records.length) return

  const schemaInfo = scopes[scopeName]?.vars?.schemaInfo
  if (!schemaInfo) throw new Error(`Missing relationship schema for scope '${scopeName}'`)

  const relationships = schemaInfo.schemaRelationships || {}
  const recordIds = records.map(record => String(getFieldValueForScope(scopes, scopeName, record, 'id')))
  const requestedFields = parseFieldset(getResourceFieldset(requestContext?.queryParams?.fields, scopeName))
  const includeTree = parseIncludeTree(requestContext?.queryParams?.include)

  // Process each hasMany relationship
  for (const [relName, relDef] of Object.entries(relationships)) {
    if (requestedFields !== null && !requestedFields.includes(relName)) continue
    if (Object.hasOwn(includeTree, relName)) continue
    const idsMap = Object.create(null)

    if (relDef.type === 'hasMany' && !relDef.via) {
      // Regular one-to-many
      // Example: publisher hasMany authors
      const foreignKey = relDef.foreignKey

      if (!foreignKey) {
        throw new Error(`Missing foreignKey in hasMany relationship '${relName}' for scope '${scopeName}'`)
      }
      const targetScope = scopes[relDef.target]
      const targetTable = targetScope?.vars?.schemaInfo?.tableName || relDef.target
      const targetIdColumn = getIdColumnForScope(scopes, relDef.target)
      const foreignKeyColumn = translateColumnForScope(scopes, relDef.target, foreignKey)

      let query = knex(targetTable)
        .modify(whereInIdentifiers, foreignKeyColumn, recordIds)
        .select({ id: databaseIdentityExpression(knex, `${targetTable}.${targetIdColumn}`), [foreignKeyColumn]: databaseIdentityExpression(knex, `${targetTable}.${foreignKeyColumn}`) })

      const scopedQueryState = await applyScopeFiltersToIncludeQuery({
        query,
        scopes,
        scopeName: relDef.target,
        requestContext,
        db: knex,
        tableName: targetTable,
        queryPurpose: 'relationship-identifiers'
      })
      query = scopedQueryState.query

      const results = await query

      results.forEach(row => {
        const parentId = String(row[foreignKeyColumn])
        if (!idsMap[parentId]) idsMap[parentId] = []
        idsMap[parentId].push(String(row.id))
      })
    } else if (relDef.type === 'manyToMany') {
      // Many-to-many relationship
      // Example: { type: 'manyToMany', through: 'article_tags', foreignKey: 'article_id', otherKey: 'tag_id' }
      const { through, foreignKey, otherKey } = relDef
      const fk = translateColumnForScope(scopes, through, foreignKey)
      const ok = translateColumnForScope(scopes, through, otherKey)

      if (!fk || !ok) {
        throw new Error(`Missing foreignKey or otherKey in manyToMany relationship '${relName}' for scope '${scopeName}'`)
      }

      // Get the actual table name from the pivot scope
      const pivotScope = scopes[through]
      const pivotTable = pivotScope?.vars?.schemaInfo?.tableName || through

      const targetScopeName = relDef.target || relName
      const targetTable = scopes[targetScopeName]?.vars?.schemaInfo?.tableName || targetScopeName
      const targetIdColumn = getIdColumnForScope(scopes, targetScopeName)
      let query = knex(targetTable)
        .join(`${pivotTable} as pivot`, `${targetTable}.${targetIdColumn}`, `pivot.${ok}`)
        .modify(whereInIdentifiers, `pivot.${fk}`, recordIds)
        .select({ __parent_id: databaseIdentityExpression(knex, `pivot.${fk}`), id: databaseIdentityExpression(knex, `${targetTable}.${targetIdColumn}`) })

      const scopedQueryState = await applyScopeFiltersToIncludeQuery({
        query,
        scopes,
        scopeName: targetScopeName,
        requestContext,
        db: knex,
        tableName: targetTable,
        queryPurpose: 'relationship-identifiers'
      })
      const pivotState = await applyScopeFiltersToIncludeQuery({
        query: scopedQueryState.query, scopes, scopeName: through, requestContext, db: knex, tableName: 'pivot', queryPurpose: 'relationship-identifiers'
      })
      query = pivotState.query

      const results = await query

      results.forEach(row => {
        const parentId = String(row.__parent_id)
        const childId = String(row.id)
        if (!idsMap[parentId]) idsMap[parentId] = []
        idsMap[parentId].push(childId)
      })
    } else if (relDef.type === 'hasMany' && relDef.via) {
      // Polymorphic reverse (via)
      // Example: publishers hasMany reviews via reviewable (where reviews.reviewable_type = 'publishers')
      const targetScope = relDef.target
      const targetRelationships = scopes[targetScope]?.vars?.schemaInfo?.schemaRelationships
      const viaRel = targetRelationships?.[relDef.via]

      if (!viaRel?.belongsToPolymorphic) {
        throw new Error(`Reverse relationship '${scopeName}.${relName}' requires polymorphic relationship '${targetScope}.${relDef.via}'`)
      }
      const { typeField, idField } = viaRel.belongsToPolymorphic

      // Get the actual table name
      const targetTable = scopes[targetScope]?.vars?.schemaInfo?.tableName || targetScope
      const targetIdColumn = getIdColumnForScope(scopes, targetScope)
      const typeColumn = translateColumnForScope(scopes, targetScope, typeField)
      const idColumn = translateColumnForScope(scopes, targetScope, idField)

      let query = knex(targetTable)
        .where(typeColumn, scopeName)
        .modify(whereInIdentifiers, idColumn, recordIds)
        .select({ id: databaseIdentityExpression(knex, `${targetTable}.${targetIdColumn}`), [idColumn]: databaseIdentityExpression(knex, `${targetTable}.${idColumn}`) })

      const scopedQueryState = await applyScopeFiltersToIncludeQuery({
        query,
        scopes,
        scopeName: targetScope,
        requestContext,
        db: knex,
        tableName: targetTable,
        queryPurpose: 'relationship-identifiers'
      })
      query = scopedQueryState.query

      const results = await query

      results.forEach(row => {
        const parentId = String(row[idColumn])
        if (!idsMap[parentId]) idsMap[parentId] = []
        idsMap[parentId].push(String(row.id))
      })
    }

    // Apply the collected IDs to all records
    if (Object.keys(idsMap).length > 0 || relDef.type === 'hasMany' || relDef.type === 'manyToMany') {
      records.forEach(record => {
        if (!record[RELATIONSHIPS_KEY]) {
          record[RELATIONSHIPS_KEY] = {}
        }

        const ids = idsMap[String(getFieldValueForScope(scopes, scopeName, record, 'id'))] || []
        const targetType = relDef.target || relName

        record[RELATIONSHIPS_KEY][relName] = {
          data: ids.map(id => ({
            type: targetType,
            id
          }))
        }
      })
    }
  }
}
