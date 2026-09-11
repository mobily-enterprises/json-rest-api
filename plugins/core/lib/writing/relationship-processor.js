import { RestApiResourceError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { validateRelationshipDataCardinality } from '../querying-writing/relationship-contracts.js'
import { RELATIONSHIP_WRITE_BATCH_SIZE } from '../querying-writing/knex-constants.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'

export const lockRelationshipParent = async ({ context, helpers, scopeName }) => {
  if (!context.transaction) return
  const adapter = helpers.getStorageAdapter(scopeName)
  const idColumn = adapter.getIdColumn()
  const parent = () => adapter.buildBaseQuery({ transaction: context.transaction })
    .where(idColumn, adapter.translateFilterValue('id', context.id))
  // A row version change also rejects stale PostgreSQL repeatable-read writers.
  const matched = await parent().update({ [idColumn]: context.transaction.ref(idColumn) })
  // MySQL can report changed rows rather than matched rows when FOUND_ROWS is disabled.
  if (!matched && !await parent().select(idColumn).forUpdate().first()) {
    throw new RestApiResourceError('Resource not found', { subtype: 'not_found' })
  }
}

export const lockRelationshipTargets = async (api, transaction, identifiers) => {
  if (!transaction) return identifiers
  const targets = []
  const resolved = []
  const resources = new Map()
  for (const { type, id } of identifiers) {
    if (!resources.has(type)) resources.set(type, { adapter: api.knex.helpers.getStorageAdapter(type), seen: new Set(), resolved: new Set() })
    const { adapter, seen } = resources.get(type)
    const value = adapter.translateFilterValue('id', id)
    if (seen.has(String(value))) continue
    seen.add(String(value))
    targets.push({ type, id, value, adapter })
  }
  for (let offset = 0; offset < targets.length; offset += RELATIONSHIP_WRITE_BATCH_SIZE) {
    const batch = targets.slice(offset, offset + RELATIONSHIP_WRITE_BATCH_SIZE)
    const byType = new Map()
    for (const target of batch) {
      if (!byType.has(target.type)) byType.set(target.type, [])
      byType.get(target.type).push(target)
    }
    const found = new Map()
    for (const [type, group] of byType) {
      const { adapter } = group[0]
      const idColumn = adapter.getIdColumn()
      const rows = await applyDatabaseReadOptions(adapter.buildBaseQuery({ transaction })
        .whereIn(idColumn, group.map(target => target.value))
        .orderBy(`${adapter.getTableName()}.${idColumn}`).forUpdate().select({ [idColumn]: databaseIdentityExpression(transaction, idColumn) }))
      found.set(type, new Set(rows.map(row => String(row[idColumn]))))
    }
    for (const { type, id, value, adapter } of batch) {
      let storedId = String(value)
      // Let the database resolve alternate spellings under its column collation.
      if (!found.get(type).has(storedId)) {
        const record = await applyDatabaseReadOptions(adapter.buildBaseQuery({ transaction })
          .where(adapter.getIdColumn(), value).forUpdate().first({ [adapter.getIdColumn()]: databaseIdentityExpression(transaction, adapter.getIdColumn()) }))
        if (!record) {
          throw new RestApiResourceError(`Related ${type} with id ${id} not found`, {
            subtype: 'not_found', resourceType: type, resourceId: id
          })
        }
        storedId = String(record[adapter.getIdColumn()])
      }
      const identities = resources.get(type).resolved
      if (!identities.has(storedId)) {
        identities.add(storedId)
        resolved.push({ type, id })
      }
    }
  }
  // Return each database identity once, retaining its first submitted spelling.
  return resolved
}

/**
 * Classify normalized linkage for the resource write lifecycle.
 * Validates cardinality and polymorphic target types, then separates owner
 * columns, referenced targets, pivot writes and reverse child writes. This
 * helper prepares work; it does not write storage or establish authorization.
 *
 * @param {Object} scope - Resource with compiled schemaInfo in vars
 * @param {Object} deps
 * @param {Object} deps.context
 * @param {Object} deps.context.inputRecord - Normalized JSON:API write document
 * @returns {Object} belongsToUpdates map plus belongsToTargets,
 *   manyToManyRelationships and reverseRelationships arrays
 * @example
 * // An explicit author clear produces belongsToUpdates.author_id = null.
 * // An explicit empty tags array produces a pivot operation with relData: [].
 * // Omitting relationships produces empty work collections, not implicit clears.
 */
export const processRelationships = (scope, deps) => {
  // Extract values from scope
  const {
    vars: {
      schemaInfo: { schemaStructure: schemaFields, schemaRelationships: relationships }
    }
  } = scope

  // Extract values from deps
  const { context } = deps
  const { inputRecord } = context
  const belongsToUpdates = {}
  const belongsToTargets = []
  const manyToManyRelationships = []
  const reverseRelationships = []

  if (!inputRecord.data.relationships) {
    return { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships }
  }

  for (const [relName, relData] of Object.entries(inputRecord.data.relationships)) {
    const relDef = relationships?.[relName]

    // Find the schema field that defines this relationship
    const schemaField = Object.entries(schemaFields).find(([fieldName, fieldDef]) =>
      fieldDef.as === relName
    )

    if (schemaField || relDef) {
      validateRelationshipDataCardinality({
        relationshipName: relName,
        relDef: schemaField ? schemaField[1] : relDef,
        data: relData?.data
      })
    }

    if (schemaField) {
      const [fieldName, fieldDef] = schemaField

      // Handle regular belongsTo (1:1)
      if (fieldDef.belongsTo) {
        if (relData.data === null) {
          belongsToUpdates[fieldName] = null
        } else if (relData.data?.id) {
          belongsToUpdates[fieldName] = relData.data.id
          belongsToTargets.push(relData.data)
        }
      }
    }

    // Check for polymorphic belongsTo defined in relationships object (not as schema field)
    if (!schemaField && relDef?.belongsToPolymorphic && relData.data !== undefined) {
      if (relData.data === null) {
        const { typeField, idField } = relDef.belongsToPolymorphic
        belongsToUpdates[typeField] = null
        belongsToUpdates[idField] = null
      } else if (relData.data) {
        const { type, id } = relData.data
        const { types, typeField, idField } = relDef.belongsToPolymorphic

        // Validate type is allowed
        if (!types.includes(type)) {
          throw new RestApiValidationError(
            `Invalid type '${type}' for polymorphic relationship '${relName}'. Allowed types: ${types.join(', ')}`,
            {
              fields: [`data.relationships.${relName}.data.type`],
              violations: [{
                field: `data.relationships.${relName}.data.type`,
                rule: 'polymorphic_type',
                message: `Type must be one of: ${types.join(', ')}`
              }]
            }
          )
        }

        belongsToUpdates[typeField] = type
        belongsToUpdates[idField] = id
        belongsToTargets.push(relData.data)
      }
    }

    // Check relationship type and process accordingly
    if (relDef?.type === 'manyToMany' && relData.data !== undefined) {
      manyToManyRelationships.push({
        relName,
        relDef: {
          target: relDef.target,
          through: relDef.through,
          foreignKey: relDef.foreignKey,
          otherKey: relDef.otherKey
        },
        relData: relData.data
      })
    }
    if ((relDef?.type === 'hasOne' || relDef?.type === 'hasMany') && relData.data !== undefined) {
      reverseRelationships.push({ relName, relDef, relData: relData.data })
    }
  }

  return { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships }
}
