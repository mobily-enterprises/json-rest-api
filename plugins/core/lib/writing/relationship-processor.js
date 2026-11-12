import { RestApiResourceError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { validateRelationshipDataCardinality } from '../querying-writing/relationship-contracts.js'
import { whereInIdentifiers } from '../querying/identifier-query.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'
import { databaseFamily } from '../querying-writing/database-capabilities.js'
import { lockStrength, transactionChecks } from '../querying-writing/transaction-checks.js'

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

// A shared target lock keeps the row from being deleted. A to-one parent's
// (keyShare) is PostgreSQL's FOR KEY SHARE, the lock a foreign key check takes,
// which a lock read with lockMode 'noKeyUpdate' (FOR NO KEY UPDATE) does not
// block. A many-to-many target's stays FOR SHARE: FOR KEY SHARE would not
// conflict with lockRelationshipParent's UPDATE, so writes from opposite ends of
// one edge could both insert it.
/**
 * @param {any} query
 * @param {{ exclusive?: boolean, keyShare?: boolean }} lock
 * @param {any} db
 */
export const lockTargetRows = (query, { exclusive, keyShare }, db) => exclusive
  ? query.forUpdate()
  : keyShare && databaseFamily(db) === 'pg' ? query.forKeyShare() : query.forShare()

// Shared by the child writes of one reverse relationship write, which all name
// the same parent: { visible: Set } of `type\0id` keys the transaction has
// already checked and locked, so each target is read once.
export const relationshipTargetChecks = Symbol('relationshipTargetChecks')
/** @typedef {{ visible: Set<string> }} RelationshipTargetChecks */
/**
 * The checks a context shares with the other child writes of its reverse relationship write, if any.
 * @param {object} context
 * @returns {RelationshipTargetChecks | undefined}
 */
export const sharedTargetChecks = context => /** @type {any} */ (context)[relationshipTargetChecks]
export const targetKey = (type, id) => `${type}\u0000${String(id)}`

/**
 * Lock referenced rows and fail when one no longer exists.
 * Targets are share-locked so writers referencing one row do not queue behind
 * each other. A caller that later modifies a target must lock it exclusively:
 * upgrading a shared lock deadlocks against a concurrent writer doing the same.
 *
 * @param {any} api
 * @param {any} transaction
 * @param {Array<{ type: string, id: string }>} identifiers
 * @param {{ exclusive?: boolean | Set<string>, keyShare?: boolean }} [options] - Lock every target, or targets of
 *   these types, for update; keyShare: the targets are to-one parents, whose shared lock is FOR KEY SHARE on PostgreSQL
 * @returns {Promise<Array<{ type: string, id: string }>>} Each database identity once, in its first submitted spelling
 */
export const lockRelationshipTargets = async (api, transaction, identifiers, { exclusive = false, keyShare = false } = {}) => {
  if (!transaction) return identifiers
  const isExclusive = type => exclusive instanceof Set ? exclusive.has(type) : exclusive
  const targets = []
  const resolved = []
  const resources = new Map()
  for (const { type, id } of identifiers) {
    if (!resources.has(type)) resources.set(type, { adapter: api.knex.helpers.getStorageAdapter(type), seen: new Set(), resolved: new Set(), group: [], found: new Set() })
    const { adapter, seen, group } = resources.get(type)
    const value = adapter.translateFilterValue('id', id)
    if (seen.has(String(value))) continue
    seen.add(String(value))
    const target = { type, id, value, adapter }
    targets.push(target)
    group.push(target)
  }
  // One statement per target type at any count; whereInIdentifiers binds a long
  // id list as one parameter where the database limits parameters. Types lock
  // in name order and each statement in id order, so two writers naming the same
  // targets in different orders take their locks in the same order.
  const checks = transactionChecks(transaction)
  for (const [type, { adapter, group, found }] of [...resources].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const idColumn = adapter.getIdColumn()
    const lock = { exclusive: isExclusive(type), keyShare }
    const query = adapter.buildBaseQuery({ transaction }).modify(whereInIdentifiers, idColumn, group.map(target => target.value))
    // The transaction's own earlier lock of these rows, at this strength or a
    // stronger one, answers when nothing sent since could have changed it.
    const checkScope = checks?.scopeOf(query, query._statements.at(-1), idColumn)
    const strength = lockStrength(lock, transaction)
    const requested = group.map(target => String(target.value))
    const known = checkScope ? checks.known(checkScope, requested, strength) : new Set()
    if (requested.every(id => known.has(id))) {
      for (const id of known) found.add(id)
      continue
    }
    const started = checks?.started()
    const rows = await applyDatabaseReadOptions(lockTargetRows(query.orderBy(`${adapter.getTableName()}.${idColumn}`), lock, transaction)
      .select({ [idColumn]: databaseIdentityExpression(transaction, idColumn) }))
    for (const row of rows) found.add(String(row[idColumn]))
    if (checkScope) checks.remember(checkScope, rows.map(row => String(row[idColumn])), strength, started)
  }
  for (const { type, id, value, adapter } of targets) {
    let storedId = String(value)
    // Let the database resolve alternate spellings under its column collation.
    if (!resources.get(type).found.has(storedId)) {
      const record = await applyDatabaseReadOptions(lockTargetRows(adapter.buildBaseQuery({ transaction })
        .where(adapter.getIdColumn(), value), { exclusive: isExclusive(type), keyShare }, transaction).first({ [adapter.getIdColumn()]: databaseIdentityExpression(transaction, adapter.getIdColumn()) }))
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
 * @returns {import('../../rest-api-plugin-methods/lifecycle-types.js').RelationshipPlan} belongsToUpdates map plus
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
  const manyToManyRelationships = []
  const reverseRelationships = []

  if (!inputRecord.data.relationships) {
    return { belongsToUpdates, manyToManyRelationships, reverseRelationships }
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

  return { belongsToUpdates, manyToManyRelationships, reverseRelationships }
}
