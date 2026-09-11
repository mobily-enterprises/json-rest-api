import { normalizeRelationshipIdentifiers } from '../querying-writing/resource-id-normalization.js'
import { getIdColumn, getStorageColumn } from '../storage/storage-mapping.js'
import { lockRelationshipTargets } from './relationship-processor.js'
import { RELATIONSHIP_WRITE_BATCH_SIZE } from '../querying-writing/knex-constants.js'
import { whereInIdentifiers } from '../querying/identifier-query.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'
import { assertVersionedRelationshipTransaction, hasVersionedInverse, invalidateManyToManyVersions } from './resource-version.js'

export async function invalidateDeletedPivotTargets (api, scopeName, context) {
  const relationships = []
  for (const [parentType, parent] of Object.entries(api.resources)) {
    if (!parent.vars.schemaInfo?.versionField) continue
    for (const relationship of Object.values(parent.vars.schemaInfo.schemaRelationships)) {
      if (relationship.type !== 'manyToMany' || relationship.target !== scopeName) continue
      relationships.push({ target: parentType, through: relationship.through, foreignKey: relationship.otherKey, otherKey: relationship.foreignKey })
    }
  }
  if (!relationships.length) return
  assertVersionedRelationshipTransaction(api, relationships[0], context.transaction)
  await lockRelationshipTargets(api, context.transaction, [{ type: scopeName, id: context.id }])
  const id = api.knex.helpers.getStorageAdapter(scopeName).translateFilterValue('id', context.id)
  for (const inverse of relationships) {
    const pivot = getPivotStorage(api, inverse)
    const query = context.transaction(pivot.tableName).where(pivot.foreignKey, id)
    await invalidateRemovedPivotVersions(api, inverse, query, context.transaction)
  }
}

export async function deletePivotReferences (api, scopeName, context) {
  const targets = new Map()
  for (const [ownerType, owner] of Object.entries(api.resources)) {
    for (const relationship of Object.values(owner.vars.schemaInfo?.schemaRelationships || {})) {
      if (relationship.type !== 'manyToMany' || (ownerType !== scopeName && relationship.target !== scopeName)) continue
      const pivot = getPivotStorage(api, relationship)
      for (const column of [ownerType === scopeName ? pivot.foreignKey : null, relationship.target === scopeName ? pivot.otherKey : null]) {
        if (column) targets.set(JSON.stringify([pivot.tableName, column]), { tableName: pivot.tableName, column })
      }
    }
  }
  const id = api.knex.helpers.getStorageAdapter(scopeName).translateFilterValue('id', context.id)
  const db = context.transaction || context.db || api.knex.instance
  for (const { tableName, column } of targets.values()) await db(tableName).where(column, id).delete()
}

export async function invalidateRemovedPivotVersions (api, relDef, query, transaction) {
  if (!hasVersionedInverse(api, relDef)) return
  assertVersionedRelationshipTransaction(api, relDef, transaction)
  const pivot = getPivotStorage(api, relDef)
  let afterId
  while (true) {
    const page = query.clone().orderBy(pivot.idColumn).limit(RELATIONSHIP_WRITE_BATCH_SIZE).forUpdate()
      .select({ [pivot.idColumn]: databaseIdentityExpression(transaction, pivot.idColumn), [pivot.otherKey]: databaseIdentityExpression(transaction, pivot.otherKey) })
    if (afterId !== undefined) page.where(pivot.idColumn, '>', afterId)
    const rows = await applyDatabaseReadOptions(page)
    if (!rows.length) break
    await invalidateManyToManyVersions(api, relDef, rows.map(row => row[pivot.otherKey]), transaction)
    afterId = rows.at(-1)[pivot.idColumn]
  }
}

const getPivotStorage = (api, relDef) => {
  const pivotScope = api.resources[relDef.through]
  if (!pivotScope) throw new Error(`Pivot table resource '${relDef.through}' not found`)
  const { schemaInfo } = pivotScope.vars
  return {
    tableName: schemaInfo.tableName || relDef.through,
    idColumn: getIdColumn(schemaInfo),
    foreignKey: getStorageColumn(schemaInfo, relDef.foreignKey),
    otherKey: getStorageColumn(schemaInfo, relDef.otherKey)
  }
}

// Targets are already authorized and locked. Keep existing pivot rows intact.
const insertMissingPivotRecords = async (trx, { tableName, idColumn, foreignKey, otherKey }, resourceId, ids) => {
  for (let offset = 0; offset < ids.length; offset += RELATIONSHIP_WRITE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + RELATIONSHIP_WRITE_BATCH_SIZE)
    const requestedIds = new Set(batch)
    const existingIds = new Set()
    let hasExisting = false
    let afterId
    // A pivot resource can contain duplicate edges; bound returned rows as well as IDs.
    while (true) {
      const query = trx(tableName).where(foreignKey, resourceId).whereIn(otherKey, batch)
        .orderBy(`${tableName}.${idColumn}`).limit(RELATIONSHIP_WRITE_BATCH_SIZE + 1).forUpdate()
        .select({ [idColumn]: databaseIdentityExpression(trx, idColumn), [otherKey]: databaseIdentityExpression(trx, otherKey) })
      if (afterId !== undefined) query.where(idColumn, '>', afterId)
      const existing = await applyDatabaseReadOptions(query)
      hasExisting ||= existing.length > 0
      for (const record of existing) {
        const id = String(record[otherKey])
        if (requestedIds.has(id)) existingIds.add(id)
      }
      if (existing.length <= RELATIONSHIP_WRITE_BATCH_SIZE) break
      afterId = existing.at(-1)[idColumn]
    }
    const toAdd = []
    for (const id of batch) {
      if (existingIds.has(id)) continue
      // A returned spelling can match another requested ID under the column's collation.
      if (hasExisting && await trx(tableName).where(foreignKey, resourceId).where(otherKey, id).forUpdate().first(otherKey)) continue
      toAdd.push({ [foreignKey]: resourceId, [otherKey]: id })
    }
    if (toAdd.length) await trx(tableName).insert(toAdd)
  }
}

// The resource operation authorizes targets before calling these storage writers.
export const updateManyToManyRelationship = async (scope, { api, context }) => {
  const { resourceId, relDef, transaction: trx } = context
  assertVersionedRelationshipTransaction(api, relDef, trx)
  const relData = normalizeRelationshipIdentifiers(context.relData || [], { api })
  const pivot = getPivotStorage(api, relDef)
  const targets = await lockRelationshipTargets(api, trx, relData)
  const ids = [...new Set(targets.map(record => String(record.id)))]
  // Negate the complete keep-list once; independent batch deletions lose wanted links.
  const removals = trx(pivot.tableName).where(pivot.foreignKey, resourceId)
    .whereNot(query => whereInIdentifiers(query, pivot.otherKey, ids))
  await invalidateRemovedPivotVersions(api, relDef, removals, trx)
  await removals.delete()
  await insertMissingPivotRecords(trx, pivot, resourceId, ids)
  await invalidateManyToManyVersions(api, relDef, ids, trx)
}

export const createPivotRecords = async (api, resourceId, relDef, relData, trx) => {
  resourceId = String(resourceId)
  relData = [...new Map(normalizeRelationshipIdentifiers(relData, { api }).map(record => [record.id, record])).values()]
  if (relData.length === 0) return
  assertVersionedRelationshipTransaction(api, relDef, trx)
  const pivot = getPivotStorage(api, relDef)
  const targets = await lockRelationshipTargets(api, trx, relData)
  await insertMissingPivotRecords(trx, pivot, resourceId, targets.map(record => record.id))
  await invalidateManyToManyVersions(api, relDef, targets.map(record => record.id), trx)
}
