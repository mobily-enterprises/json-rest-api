import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'
import { RELATIONSHIP_WRITE_BATCH_SIZE } from '../querying-writing/knex-constants.js'
import { whereInIdentifiers } from '../querying/identifier-query.js'
import { lockRelationshipTargets } from './relationship-processor.js'

// Read membership in bounded batches; each actual child write still goes through PATCH.
export async function updateReverseRelationship ({ api, helpers, context, scopeName, relDef, relData, operation = 'replace' }) {
  const targetType = relDef.target
  const targetScope = api.resources[targetType]
  if (!targetScope) {
    throw new RestApiResourceError(`Related resource type '${targetType}' not found`, { subtype: 'related_type_not_found' })
  }
  const schemaInfo = targetScope.vars.schemaInfo
  let inverseName
  let parentValues
  if (relDef.via) {
    const inverse = schemaInfo.schemaRelationships[relDef.via]?.belongsToPolymorphic
    if (!inverse || !inverse.types.includes(scopeName)) {
      throw new RestApiResourceError(`Invalid reverse polymorphic relationship '${relDef.via}' on '${targetType}'`, { subtype: 'invalid_via_relationship' })
    }
    inverseName = relDef.via
    parentValues = { [inverse.typeField]: scopeName, [inverse.idField]: context.id }
  } else {
    const field = schemaInfo.schemaStructure[relDef.foreignKey]
    if (!field) {
      throw new RestApiResourceError(`Foreign key '${relDef.foreignKey}' not found on '${targetType}'`, { subtype: 'invalid_foreign_key' })
    }
    inverseName = field.belongsTo === scopeName ? field.as : undefined
    parentValues = { [relDef.foreignKey]: context.id }
  }

  const adapter = helpers.getStorageAdapter(targetType)
  const query = adapter.buildBaseQuery({ transaction: context.transaction })
  for (const [field, value] of Object.entries(parentValues)) {
    query.where(adapter.translateColumn(field), adapter.translateFilterValue(field, value))
  }
  if (context.transaction) query.forUpdate()
  const idColumn = adapter.getIdColumn()
  const selection = { [idColumn]: databaseIdentityExpression(context.db || api.knex.instance, idColumn) }
  let identifiers = []
  if (Array.isArray(relData)) {
    identifiers = relData
  } else if (relData !== null) {
    identifiers = [relData]
  }
  const targets = operation === 'remove' ? identifiers : await lockRelationshipTargets(api, context.transaction, identifiers)
  const requested = new Map()
  for (const { id } of targets) {
    const value = adapter.translateFilterValue('id', id)
    if (!requested.has(String(value))) requested.set(String(value), { id: String(id), value })
  }
  const requestedIds = [...requested.values()]

  const patchChild = async (id, linked) => {
    const data = { type: targetType, id }
    if (inverseName) {
      data.relationships = { [inverseName]: { data: linked ? { type: scopeName, id: String(context.id) } : null } }
    } else {
      data.attributes = Object.fromEntries(Object.entries(parentValues).map(([field, value]) => [field, linked ? value : null]))
    }
    try {
      await targetScope.patch({
        id, inputRecord: { data }, transaction: context.transaction, format: 'jsonapi', returning: 'none'
      }, { ...context })
    } catch (error) {
      if (!linked && operation === 'replace' && error.code === 'REST_API_RESOURCE' && ['not_found', 'forbidden'].includes(error.subtype)) {
        const rejection = new RestApiResourceError('Cannot replace a relationship with inaccessible existing members', { subtype: 'forbidden' })
        rejection.cause = error
        throw rejection
      }
      throw error
    }
  }

  if (operation === 'replace') {
    // Exclude the whole keep-list once; independent exclusions would remove retained children.
    const removals = query.clone().whereNot(builder => whereInIdentifiers(builder, idColumn, requestedIds.map(({ value }) => value)))
    let afterId
    while (true) {
      const page = removals.clone().orderBy(`${adapter.getTableName()}.${idColumn}`).limit(RELATIONSHIP_WRITE_BATCH_SIZE + 1).select(selection)
      if (afterId !== undefined) page.where(idColumn, '>', afterId)
      const rows = await applyDatabaseReadOptions(page)
      for (const row of rows) await patchChild(String(adapter.getFieldValue(row, 'id')), false)
      if (rows.length <= RELATIONSHIP_WRITE_BATCH_SIZE) break
      afterId = rows.at(-1)[idColumn]
    }
  }

  // Free all removed hasOne slots before assigning replacements.
  for (let offset = 0; offset < requestedIds.length; offset += RELATIONSHIP_WRITE_BATCH_SIZE) {
    const batch = requestedIds.slice(offset, offset + RELATIONSHIP_WRITE_BATCH_SIZE)
    const rows = await applyDatabaseReadOptions(query.clone().whereIn(idColumn, batch.map(({ value }) => value)).select(selection))
    const existing = new Map(rows.map(row => [String(row[idColumn]), row]))
    for (const { id, value } of batch) {
      // Resolve alternate ID spellings using the database's equality rules.
      let record = existing.get(String(value))
      if (!record && existing.size) {
        const lookup = query.clone().where(idColumn, value).first(selection)
        record = await applyDatabaseReadOptions(lookup)
      }
      if (operation === 'remove') {
        if (record) {
          await patchChild(id, false)
          existing.delete(String(record[idColumn]))
        }
      } else if (!record) await patchChild(id, true)
    }
  }
}
