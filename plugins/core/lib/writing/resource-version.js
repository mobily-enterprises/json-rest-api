import { randomUUID } from 'node:crypto'
import { RestApiResourceError, RestApiValidationError, RestApiVersionConflictError } from '../../../../lib/rest-api-errors.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'
import { RELATIONSHIP_WRITE_BATCH_SIZE } from '../querying-writing/knex-constants.js'

export function hasVersionedInverse (api, relDef) {
  const schemaInfo = api.resources[relDef.target]?.vars.schemaInfo
  return Boolean(schemaInfo?.versionField && Object.values(schemaInfo.schemaRelationships).some(inverse =>
    inverse.through === relDef.through && inverse.foreignKey === relDef.otherKey && inverse.otherKey === relDef.foreignKey))
}

export function assertVersionedRelationshipTransaction (api, relDef, transaction) {
  if (hasVersionedInverse(api, relDef) && (!transaction?.isTransaction || transaction.isCompleted())) {
    throw new RestApiValidationError('Versioned relationship writes require an active transaction', { fields: ['transaction'] })
  }
}

export async function invalidateManyToManyVersions (api, relDef, ids, transaction) {
  if (!hasVersionedInverse(api, relDef) || !ids.length) return
  const adapter = api.knex.helpers.getStorageAdapter(relDef.target)
  const idColumn = adapter.getIdColumn()
  const versionColumn = adapter.translateColumn(api.resources[relDef.target].vars.schemaInfo.versionField)
  const values = [...new Set(ids.map(id => adapter.translateFilterValue('id', id)))]
  for (let offset = 0; offset < values.length; offset += RELATIONSHIP_WRITE_BATCH_SIZE) {
    const batch = values.slice(offset, offset + RELATIONSHIP_WRITE_BATCH_SIZE)
    const cases = []
    const bindings = [idColumn]
    for (const id of batch) {
      cases.push('WHEN ? THEN ?')
      bindings.push(id, randomUUID())
    }
    bindings.push(versionColumn)
    const revisions = transaction.raw(`CASE ?? ${cases.join(' ')} ELSE ?? END`, bindings)
    await adapter.buildBaseQuery({ transaction }).whereIn(idColumn, batch).update({ [versionColumn]: revisions })
  }
}

async function readInverseReferences (state, context) {
  const { adapter, fields } = state
  const selectedFields = []
  for (const field of fields) {
    const column = adapter.translateColumn(field)
    selectedFields.push([field, databaseIdentityExpression(context.transaction, column)])
  }
  const selection = Object.fromEntries(selectedFields)
  return applyDatabaseReadOptions(adapter.buildBaseQuery({ transaction: context.transaction })
    .where(adapter.getIdColumn(), adapter.translateFilterValue('id', context.id)).forUpdate().first(selection))
}

// Capture actual stored references after authorization; hooks/setters may change the input.
export async function captureInverseVersions ({ api, helpers, context, scopeName, isCreate = false }) {
  const references = []
  for (const [parentType, parent] of Object.entries(api.resources)) {
    const schemaInfo = parent.vars.schemaInfo
    if (!schemaInfo?.versionField) continue
    for (const relationship of Object.values(schemaInfo.schemaRelationships)) {
      if (!api.anyapi && relationship.type === 'manyToMany' && relationship.through === scopeName) {
        references.push({ parentType, idField: relationship.foreignKey, valueField: relationship.otherKey })
        continue
      }
      if (!['hasMany', 'hasOne'].includes(relationship.type) || relationship.target !== scopeName) continue
      if (relationship.via) {
        const inverse = context.schemaInfo.schemaRelationships[relationship.via]?.belongsToPolymorphic
        if (inverse?.types.includes(parentType)) references.push({ parentType, idField: inverse.idField, typeField: inverse.typeField })
      } else if (relationship.foreignKey) references.push({ parentType, idField: relationship.foreignKey })
    }
  }
  if (!references.length) return undefined
  const fields = new Set()
  for (const { idField, typeField, valueField } of references) {
    if (idField) fields.add(idField)
    if (typeField) fields.add(typeField)
    if (valueField) fields.add(valueField)
  }
  const state = { references, fields: [...fields], adapter: helpers.getStorageAdapter(scopeName) }
  state.before = isCreate ? undefined : await readInverseReferences(state, context)
  return state
}

export async function invalidateInverseVersions ({ state, context, helpers, api, isDelete = false }) {
  if (!state) return
  const after = isDelete ? undefined : await readInverseReferences(state, context)
  const targets = new Map()
  for (const { parentType, idField, typeField, valueField } of state.references) {
    const readParentId = record => {
      if (!record) return null
      if (typeField && record[typeField] !== parentType) return null
      return record[idField]
    }
    const oldId = readParentId(state.before)
    const newId = readParentId(after)
    const valueUnchanged = !valueField || state.before?.[valueField] === after?.[valueField]
    if (oldId === newId && valueUnchanged) continue
    for (const id of [oldId, newId]) {
      if (id !== null && id !== undefined) targets.set(JSON.stringify([parentType, id]), { parentType, id })
    }
  }
  // Update parents in a stable order so concurrent writes acquire locks in the same order.
  const orderedTargets = [...targets].sort(([left], [right]) => left.localeCompare(right))
  for (const [, { parentType, id }] of orderedTargets) {
    const adapter = helpers.getStorageAdapter(parentType)
    const field = api.resources[parentType].vars.schemaInfo.versionField
    // An old dangling reference or a parent deleted in this transaction needs no revision.
    await adapter.buildBaseQuery({ transaction: context.transaction })
      .where(adapter.getIdColumn(), adapter.translateFilterValue('id', id))
      .update({ [adapter.translateColumn(field)]: randomUUID() })
  }
}

// Called after resource authorization, within the transaction containing the write.
export async function advanceResourceVersion ({ scopeName, context, helpers, expectedVersion, nextVersion = randomUUID() }) {
  const field = context.schemaInfo.versionField
  if (expectedVersion !== undefined && (!field || typeof expectedVersion !== 'string' || !expectedVersion.length || expectedVersion.length > 128)) {
    throw new RestApiValidationError('expectedVersion requires a versioned resource and a non-empty token of at most 128 characters', { fields: ['expectedVersion'] })
  }
  if (!field) return undefined
  if (!context.transaction) throw new Error('Versioned writes require a transaction')

  const adapter = helpers.getStorageAdapter(scopeName)
  const column = adapter.translateColumn(field)
  const query = adapter.buildBaseQuery({ transaction: context.transaction })
    .where(adapter.getIdColumn(), adapter.translateFilterValue('id', context.id))
  if (expectedVersion !== undefined) {
    // Revision tokens use byte equality, independent of column collation.
    const client = context.transaction.client.config.client
    if (client === 'pg') {
      query.whereRaw("convert_to(??, 'UTF8') = convert_to(?, 'UTF8')", [column, expectedVersion])
    } else if (client === 'mysql2' || client === 'mysql') {
      query.whereRaw('CAST(?? AS BINARY) = CAST(? AS BINARY)', [column, expectedVersion])
    } else if (client === 'better-sqlite3' || client === 'sqlite3') {
      query.whereRaw('CAST(?? AS BLOB) = CAST(? AS BLOB)', [column, expectedVersion])
    } else {
      throw new Error(`Conditional revisions are not implemented for database client '${client}'`)
    }
  }
  const matched = await query.update({ [column]: nextVersion })
  if (!matched) {
    throw new RestApiVersionConflictError({ resourceType: scopeName, resourceId: context.id })
  }
  return nextVersion
}

export function initializeResourceVersion ({ context, expectedVersion }) {
  const field = context.schemaInfo.versionField
  if (expectedVersion !== undefined && (!field || typeof expectedVersion !== 'string' || !expectedVersion.length || expectedVersion.length > 128 || context.method === 'post')) {
    throw new RestApiValidationError('expectedVersion requires an existing versioned resource and a non-empty token of at most 128 characters', { fields: ['expectedVersion'] })
  }
  if (!field) return undefined
  const attributes = context.inputRecord?.data?.attributes
  if (context.method !== 'delete' && attributes && Object.hasOwn(attributes, field)) {
    throw new RestApiValidationError('The version field is managed by the library; use expectedVersion', { fields: [`data.attributes.${field}`] })
  }
  const state = { field, expectedVersion, nextVersion: randomUUID() }
  const data = context.inputRecord?.data
  if (context.method !== 'delete' && data && typeof data === 'object' && !Array.isArray(data) &&
    (attributes === undefined || (attributes && typeof attributes === 'object' && !Array.isArray(attributes)))) {
    context.inputRecord = { ...context.inputRecord, data: { ...data, attributes: { ...attributes, [field]: state.nextVersion } } }
  }
  return state
}

export async function applyResourceVersion ({ state, context, helpers, scopeName, isCreate = false }) {
  if (!state) return
  if (isCreate) {
    if (state.expectedVersion !== undefined) {
      throw new RestApiResourceError(`Resource not found: ${scopeName}/${context.id}`, { subtype: 'not_found' })
    }
  } else {
    await advanceResourceVersion({ scopeName, context, helpers, expectedVersion: state.expectedVersion, nextVersion: state.nextVersion })
  }
  if (context.method !== 'delete') context.inputRecord.data.attributes[state.field] = state.nextVersion
}
