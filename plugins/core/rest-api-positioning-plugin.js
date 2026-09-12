import { createHash } from 'node:crypto'
import { calculatePosition, getInitialPosition, isValidPosition } from './lib/fractional-positioning.js'
import { createStorageAdapter } from './lib/storage/storage-adapter.js'
import { hasKnexTableIndex } from './lib/dbIntrospection.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from './lib/querying-writing/database-value-normalizers.js'
import { RestApiValidationError } from '../../lib/rest-api-errors.js'

const lockTable = 'json_rest_api_positioning_locks'

async function createLockTable (knex) {
  if (await knex.schema.hasTable(lockTable)) return
  try {
    await knex.schema.createTable(lockTable, table => table.string('resource', 64).primary())
  } catch (error) {
    // Another application process may have initialized the same database.
    if (!await knex.schema.hasTable(lockTable)) throw error
  }
}

function positionExpression (knex, column) {
  const client = knex.client.config.client
  if (client === 'pg' || client === 'postgresql') return knex.raw('?? COLLATE "C"', [column])
  if (client === 'mysql2' || client === 'mysql') return knex.raw('BINARY ??', [column])
  return knex.raw('?? COLLATE BINARY', [column])
}

export const PositioningPlugin = {
  name: 'positioning',
  dependencies: ['rest-api', ['rest-api-knex', 'rest-api-anyapi-knex']],

  async install ({ api, addHook, vars, log, scopes, pluginOptions = {} }) {
    const knex = api.knex?.instance
    if (!knex) throw new Error('Positioning requires Knex storage')
    const config = {
      field: 'position',
      filters: [],
      excludeResources: ['system_migrations', 'system_logs'],
      beforeIdField: 'beforeId',
      defaultPosition: 'last',
      strategy: 'fractional',
      autoIndex: true,
      ...pluginOptions
    }
    if (config.strategy !== 'fractional') throw new Error("Positioning supports only the 'fractional' strategy")
    if (!['first', 'last'].includes(config.defaultPosition)) throw new Error("defaultPosition must be 'first' or 'last'")
    if (Object.hasOwn(config, 'rebalanceThreshold')) throw new Error('rebalanceThreshold is not supported; automatic rebalancing is not implemented')
    vars.positioning = config
    await createLockTable(knex)

    function enabled (scopeName) {
      return !config.excludeResources.includes(scopeName) && Boolean(scopes[scopeName]?.vars.schemaInfo?.schemaStructure?.[config.field])
    }

    function adapterFor (scopeName) {
      const scope = scopes[scopeName]
      scope.vars.storageAdapter ||= createStorageAdapter({ knex, schemaInfo: scope.vars.schemaInfo })
      return scope.vars.storageAdapter
    }

    function filterFields (schemaInfo) {
      return config.filters.map(name => {
        const field = schemaInfo.searchSchemaStructure?.[name]?.actualField ||
          Object.keys(schemaInfo.schemaStructure).find(key => schemaInfo.schemaStructure[key].as === name) || name
        if (!schemaInfo.schemaStructure[field]) throw new Error(`Unknown positioning group field '${name}'`)
        return { name, field }
      })
    }

    addHook('resource:added', 'validate-position-field', {}, ({ context }) => {
      if (config.excludeResources.includes(context.scopeName)) return
      const definition = context.scopeOptions.schema?.[config.field]
      if (!definition || definition.type !== 'string') {
        throw new Error(`Resource '${context.scopeName}' must declare a string '${config.field}' field for positioning`)
      }
      if (definition.setter) throw new Error(`Positioning field '${config.field}' cannot have a setter`)
      filterFields(scopes[context.scopeName].vars.schemaInfo)
    })

    addHook('resource:added', 'add-position-index', { afterFunction: 'validate-position-field' }, async ({ context }) => {
      if (!enabled(context.scopeName) || !config.autoIndex) return
      const adapter = adapterFor(context.scopeName)
      if (adapter.isCanonical()) return
      const tableName = adapter.getTableName()
      if (!await knex.schema.hasTable(tableName)) return
      const columns = [...new Set([
        ...filterFields(scopes[context.scopeName].vars.schemaInfo).map(({ field }) => adapter.translateColumn(field)),
        adapter.translateColumn(config.field)
      ])]
      try {
        const name = `idx_${tableName}_positioning`
        if (!await hasKnexTableIndex(knex, tableName, name)) {
          await knex.schema.table(tableName, table => table.index(columns, name))
        }
      } catch (error) { log.warn(`Could not create positioning index for ${context.scopeName}: ${error.message}`) }
    })

    addHook('beforeProcessing', 'lock-position-resource', {}, async ({ context, scopeName }) => {
      if (!enabled(scopeName)) return
      const adapter = adapterFor(scopeName)
      const descriptor = context.schemaInfo.descriptor
      const resource = createHash('sha256').update(JSON.stringify([
        adapter.getTableName(), descriptor?.tenant, descriptor?.resource
      ])).digest('hex')
      const transaction = context.transaction
      // A row write holds the resource lock until transaction completion, including
      // empty groups, and rejects stale PostgreSQL repeatable-read snapshots.
      await transaction(lockTable).insert({ resource }).onConflict('resource').merge(['resource'])
      context.positioningBeforeId = undefined
      const attributes = context.inputRecord?.data?.attributes
      if (context.method === 'put' && attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
        // PUT checks replacement completeness before schema hooks; position is
        // managed here and replaced with its current/calculated value before storage.
        attributes[config.field] = getInitialPosition()
      }
    })

    addHook('beforeSchemaValidate', 'process-beforeid', {}, ({ context, scopeName }) => {
      if (!enabled(scopeName)) return
      const attributes = context.inputRecord.data.attributes || {}
      context.positioningBeforeId = attributes[config.beforeIdField]
      delete attributes[config.beforeIdField]
      delete attributes[config.field]
    })

    async function calculateAndSetPosition ({ context, scopeName }) {
      if (!enabled(scopeName)) return
      const adapter = adapterFor(scopeName)
      const schemaInfo = context.schemaInfo
      const attributes = context.inputRecord.data.attributes ||= {}
      const transaction = context.transaction
      const idColumn = adapter.getIdColumn()
      const positionColumn = adapter.translateColumn(config.field)
      const position = positionExpression(knex, positionColumn)
      const isCreate = context.method === 'post' || context.isCreate === true
      const fields = filterFields(schemaInfo)
      const columns = Object.fromEntries([config.field, ...fields.map(({ field }) => field)].map(field => {
        const column = adapter.translateColumn(field)
        return [column, databaseIdentityExpression(transaction, column)]
      }))
      const current = !isCreate && await applyDatabaseReadOptions(adapter.buildBaseQuery({ transaction })
        .where(idColumn, adapter.translateFilterValue('id', context.id)).forUpdate()).select(columns).first()
      let groupChanged = false
      const conditions = fields.map(({ name, field }) => {
        const oldValue = current ? adapter.getFieldValue(current, field) : null
        const value = Object.hasOwn(attributes, field) ? attributes[field] : oldValue
        const normalized = value == null ? null : adapter.translateFilterValue(name, value)
        const oldNormalized = oldValue == null ? null : adapter.translateFilterValue(name, oldValue)
        if (normalized !== oldNormalized) groupChanged = true
        return [adapter.translateColumn(field), normalized]
      })
      const oldPosition = current && adapter.getFieldValue(current, config.field)
      let beforeId = context.positioningBeforeId
      if (!isCreate && beforeId === undefined && !groupChanged && isValidPosition(oldPosition)) {
        attributes[config.field] = oldPosition
        return
      }
      if (beforeId === undefined) beforeId = config.defaultPosition === 'first' ? 'FIRST' : null
      if (!isCreate && beforeId !== null && String(beforeId) === String(context.id)) {
        if (!groupChanged && isValidPosition(oldPosition)) { attributes[config.field] = oldPosition; return }
        beforeId = null
      }

      const base = adapter.buildBaseQuery({ transaction }).forUpdate()
      for (const [column, value] of conditions) {
        if (value === null) base.whereNull(column)
        else base.where(column, value)
      }
      if (!isCreate) base.whereNot(idColumn, adapter.translateFilterValue('id', context.id))
      const select = query => adapter.selectColumns(query, { position: positionColumn })
      let target
      if (beforeId === 'FIRST') target = await select(base.clone()).orderBy(position, 'asc').first()
      else if (beforeId !== null) {
        try {
          // Placement targets obey the same visibility and read authorization as GET.
          await api.resources[scopeName].get({
            id: beforeId, transaction, format: 'jsonapi', queryParams: { fields: { [scopeName]: 'id' } }
          }, { ...context })
          target = await select(base.clone()).where(idColumn, adapter.translateFilterValue('id', beforeId)).first()
        } catch (error) {
          if (error.subtype !== 'not_found') throw error
        }
      }
      const neighbor = target
        ? await select(base.clone()).where(position, '<', target.position).orderBy(position, 'desc').first()
        : await select(base.clone()).orderBy(position, 'desc').first()
      const items = [neighbor, target].filter(Boolean)
      if (items.some(item => !isValidPosition(item.position))) {
        throw new RestApiValidationError('Existing positions must be valid fractional keys; migrate the list before positioning', { fields: [config.field] })
      }
      const newPosition = calculatePosition(neighbor?.position, target?.position)
      const definition = schemaInfo.schemaStructure[config.field]
      const maximum = Math.min(definition.max ?? Infinity, definition.maxLength || 255)
      if (newPosition.length > maximum) {
        throw new RestApiValidationError('Position key exceeds the field length; rebalance the list before retrying', { fields: [config.field] })
      }
      attributes[config.field] = newPosition
    }

    for (const method of ['Post', 'Put', 'Patch']) {
      addHook(`beforeDataCall${method}`, `calculate-position-${method.toLowerCase()}`, {}, calculateAndSetPosition)
    }
    addHook('beforeDataQuery', 'apply-position-sort', {}, ({ context, scopeName }) => {
      if (enabled(scopeName) && !context.queryParams.sort?.length) context.queryParams.sort = [config.field]
    })
    api.positioning = {
      getConfig: () => ({ ...config, filters: [...config.filters], excludeResources: [...config.excludeResources] }),
      isEnabled: enabled
    }
  }
}
