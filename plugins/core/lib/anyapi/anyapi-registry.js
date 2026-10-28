import { createKnexTransaction, readCommittedTransaction } from '../../../../lib/knex-transaction.js'
import { applyInsertReturning, getDatabaseCapabilities } from '../querying-writing/database-capabilities.js'
import { DEFAULT_CANONICAL_CONFIG, TYPE_TO_POOL, ensureAnyApiSchema, readSlotPools } from './schema-utils.js'
import { toStoredJson } from './stored-definition.js'
import { beginWriteTransaction, commitTransaction, endWriteOperation, getOperationDiagnosticContext, rollbackAfterError, wrapUnexpectedError, wrapWriteError } from '../../../../lib/error-context.js'
import { createEnhancedLogger } from '../../../../lib/enhanced-logger.js'
import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { assertFieldName, assertFieldNameMap } from '../querying-writing/field-utils.js'
import { validateRelationshipFieldNames, validateSchemaFieldNames } from '../querying-writing/scope-validations.js'

const clone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

const SUPPORTED_TYPES = new Set([...TYPE_TO_POOL.keys(), 'id'])
const DEFAULT_CACHE_SIZE = 100
const EMPTY_RUNTIME = Object.freeze({ schema: {}, searchSchema: {}, callbacks: [] })

// Errors from two servers inserting the same new resource at once.
const WRITE_CONFLICT_CODES = new Set(['23505', '40001', '40P01', 'ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'SQLITE_BUSY', 'SQLITE_CONSTRAINT_UNIQUE'])
const creationRaces = new WeakSet()

const resolveIdProperty = (schema = {}, explicitIdProperty = null) => {
  if (explicitIdProperty) return explicitIdProperty
  if (schema.id) return 'id'

  const idFields = Object.entries(schema)
    .filter(([, fieldDef]) => (
      fieldDef?.type === 'id' &&
      !fieldDef.belongsTo &&
      !fieldDef.belongsToPolymorphic
    ))
    .map(([fieldName]) => fieldName)

  return idFields.length === 1 ? idFields[0] : 'id'
}

const BELONGS_TO_ALIAS = (fieldName, fieldDef) => {
  if (fieldDef.as) return fieldDef.as
  if (fieldName.endsWith('_id')) {
    return fieldName.slice(0, -3)
  }
  return fieldName
}

const SLOT_PATTERNS = {
  string: /^string_(\d+)$/,
  number: /^number_(\d+)$/,
  boolean: /^boolean_(\d+)$/,
  date: /^date_(\d+)$/,
  json: /^json_(\d+)$/,
}

const BELONGS_TO_ID_PATTERN = /^rel_(\d+)_id$/

const slotsExhausted = pool => Object.assign(new Error(`No available ${pool} slots remaining`), { slotsExhausted: true })

const slotPoolFor = (fieldDef = {}) => {
  if (fieldDef.belongsTo) return 'belongsTo'
  return fieldDef.type === 'id' ? 'string' : TYPE_TO_POOL.get(fieldDef.type)
}

const belongsToColumns = index => [`rel_${index}_id`, `rel_${index}_type`]

const parseSimpleSlotColumn = (column, pools) => {
  for (const [type, pattern] of Object.entries(SLOT_PATTERNS)) {
    const match = pattern.exec(column)
    if (match) {
      if (!pools[type].includes(column)) {
        throw new Error(`Canonical slot '${column}' is out of range`)
      }
      return { slotType: type, slotIndex: Number(match[1]) }
    }
  }
  throw new Error(`Invalid canonical slot column '${column}'`)
}

const parseBelongsToSlots = ({ idSlot, typeSlot }, pools) => {
  if (!idSlot || typeof idSlot !== 'string') {
    throw new Error('BelongsTo canonical mapping requires idSlot')
  }
  const idMatch = BELONGS_TO_ID_PATTERN.exec(idSlot)
  if (!idMatch) {
    throw new Error(`Invalid belongsTo id slot '${idSlot}'`)
  }
  const index = Number(idMatch[1])
  if (!pools.belongsTo.includes(index) || idSlot !== `rel_${index}_id`) {
    throw new Error(`BelongsTo slot '${idSlot}' is out of range`)
  }
  const expectedTypeSlot = `rel_${index}_type`
  const actualTypeSlot = typeSlot || expectedTypeSlot
  if (actualTypeSlot !== expectedTypeSlot) {
    throw new Error(`BelongsTo type slot '${actualTypeSlot}' must correspond to id slot '${idSlot}'`)
  }
  return { slotType: 'belongsTo', slotIndex: index, idColumn: idSlot, typeColumn: actualTypeSlot }
}

const reserveSlots = (used, columns) => {
  if (columns.some(column => used.has(column))) {
    throw new Error(columns.length > 1 ? `Canonical slots '${columns[0]}'/'${columns[1]}' already in use` : `Canonical slot '${columns[0]}' already in use`)
  }
  columns.forEach(column => used.add(column))
}

const FIELD_ROW_COLUMNS = ['field_name', 'slot_type', 'slot_index', 'slot_column', 'nullable', 'required', 'target_resource', 'alias', 'meta_json']
const RELATIONSHIP_ROW_COLUMNS = ['relationship_name', 'relationship_type', 'target_resource', 'slot_index', 'id_column', 'type_column', 'relationship_key', 'through', 'foreign_key', 'other_key', 'alias', 'meta_json']

// Drivers return booleans and integers in different shapes; compare meaning only.
const rowsSignature = (rows, columns) => JSON.stringify(rows.map(row => columns.map(column => {
  const value = row[column]
  if (column === 'nullable' || column === 'required') return Boolean(value)
  if (column === 'slot_index') return value == null ? null : Number(value)
  return value ?? null
})).sort((left, right) => String(left[0]).localeCompare(String(right[0]))))

const isWriteConflict = error => WRITE_CONFLICT_CODES.has(error?.code) || [1062, 1213].includes(error?.errno)

/**
 * Canonical resource metadata. One registry can serve every tenant API that
 * shares a Knex instance: start-up checks, capabilities and the slot layout are
 * read once, and descriptors are cached per tenant and resource.
 */
export class AnyapiRegistry {
  #shared = new Map()

  constructor ({ knex, log, cacheSize = DEFAULT_CACHE_SIZE } = {}) {
    if (!knex) {
      throw new Error('AnyapiRegistry requires a knex instance')
    }
    if (!Number.isInteger(cacheSize) || cacheSize < 1) {
      throw new Error('AnyapiRegistry cacheSize must be a positive integer')
    }
    this.knex = knex
    this.log = log || console
    this.cacheSize = cacheSize
    this.cache = new Map()
  }

  #once (key, run) {
    if (!this.#shared.has(key)) {
      const result = run()
      this.#shared.set(key, result)
      result.catch(() => { if (this.#shared.get(key) === result) this.#shared.delete(key) })
    }
    return this.#shared.get(key)
  }

  ensureSchema ({ slots } = {}) {
    return this.#once(`schema:${JSON.stringify(slots ?? null)}`, async () => {
      await ensureAnyApiSchema(this.knex, { slots })
      this.#shared.delete('slots')
    })
  }

  getCapabilities (log = this.log) {
    return this.#once('capabilities', () => getDatabaseCapabilities(this.knex, log))
  }

  getSlotPools ({ db = this.knex, refresh = false } = {}) {
    if (refresh) this.#shared.delete('slots')
    return this.#once('slots', () => readSlotPools(db))
  }

  async #withSlotPools (db, plan) {
    try {
      return plan(await this.getSlotPools({ db }))
    } catch (error) {
      // A migration may have added slot columns since the layout was read.
      if (!error?.slotsExhausted) throw error
      return plan(await this.getSlotPools({ db, refresh: true }))
    }
  }

  #key (tenant, resource) {
    return JSON.stringify([tenant, resource])
  }

  #rememberDescriptor (descriptor) {
    const key = this.#key(descriptor.tenant, descriptor.resource)
    this.cache.delete(key)
    this.cache.set(key, descriptor)
    if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value)
  }

  async registerResource (definition, options = {}) {
    return (await this.register(definition, options)).descriptor
  }

  /**
   * Register a declaration and report whether stored metadata changed.
   * @returns {Promise<{ descriptor: Record<string, any>, changed: boolean }>}
   */
  async register (definition, options = {}) {
    try {
      return await this.#registerOnce(definition, options)
    } catch (error) {
      if (options.transaction || !creationRaces.has(error?.cause)) throw error
      return this.#registerOnce(definition, options)
    }
  }

  async #registerOnce (definition, options) {
    const context = { method: 'registerResource', tenant: definition?.tenant, resource: definition?.resource, [readCommittedTransaction]: true }
    try {
      this.#validateDefinition(definition)
      const { descriptor, changed } = await this.#register(definition, options.transaction, context)
      if (!options.transaction) this.#rememberDescriptor(descriptor)
      return { descriptor: clone(descriptor), changed }
    } catch (error) {
      throw wrapWriteError(error, context, context.transaction || options.transaction)
    } finally {
      endWriteOperation(context)
    }
  }

  async allocateField (params, options = {}) {
    return this.#allocate(options, 'allocateField', () => {
      const { tenant, resource, fieldName, definition, declaration, canonicalField } = params || {}
      if (!tenant || !resource || !fieldName || !definition) {
        throw new Error('allocateField requires tenant, resource, fieldName, and definition')
      }
      return { tenant, resource, fields: { [fieldName]: { definition, declaration, canonicalField } } }
    })
  }

  /**
   * Allocate several fields under one lock and one schema version.
   * `declaration` is the uncompiled definition stored for other servers.
   */
  async allocateFields (params, options = {}) {
    return this.#allocate(options, 'allocateFields', () => {
      const { tenant, resource, fields, searchSchema } = params || {}
      if (!tenant || !resource || !fields || typeof fields !== 'object' || !Object.keys(fields).length) {
        throw new Error('allocateFields requires tenant, resource, and fields')
      }
      for (const field of Object.values(fields)) {
        if (!field?.definition) throw new Error('allocateFields requires a definition for each field')
      }
      return { tenant, resource, fields, searchSchema }
    })
  }

  #allocate (options, method, readParams) {
    return this.#changeResource(options, method, () => {
      const params = readParams()
      const { resource, fields, searchSchema } = params
      for (const [fieldName, { definition }] of Object.entries(fields)) {
        validateSchemaFieldNames({ [fieldName]: definition }, resource)
      }
      assertFieldNameMap(searchSchema, `added search schema in '${resource}'`)
      return params
    }, async ({ trx, resourceRow, descriptor }, { fields, searchSchema }) => {
      const plan = await this.#withSlotPools(trx, pools => this.#planAllocation(descriptor, fields, pools))

      for (const row of plan.fieldRows) {
        await trx('any_field_configs').insert({ resource_config_id: resourceRow.id, ...row })
      }
      for (const row of plan.relationshipRows) {
        await trx('any_relationship_configs').insert({ resource_config_id: resourceRow.id, ...row })
      }

      const stored = descriptor.definition || { options: null, callbacks: [] }
      const runtime = clone(stored.runtime || EMPTY_RUNTIME)
      for (const [kind, entries] of [
        ['schema', Object.entries(fields).map(([name, field]) => [name, field.declaration ?? field.definition])],
        ['searchSchema', Object.entries(searchSchema || {})]
      ]) {
        for (const [name, value] of entries) {
          const { json, callbacks } = toStoredJson(value)
          runtime[kind][name] = json
          runtime.callbacks.push(...callbacks.map(path => [kind, name, ...path]))
        }
      }
      return {
        schema_json: JSON.stringify({ ...descriptor.schema, ...plan.definitions }),
        definition_json: JSON.stringify({ ...stored, runtime })
      }
    })
  }

  /**
   * Mark stored fields retired: they keep their slots and values, and the
   * published schema stops accepting writes to them. Registration keeps the mark.
   */
  async retireFields (params, options = {}) {
    return this.#changeResource(options, 'retireFields', () => {
      const { tenant, resource, fields } = params || {}
      if (!tenant || !resource || !Array.isArray(fields) || !fields.length || fields.some(field => typeof field !== 'string')) {
        throw new Error('retireFields requires tenant, resource, and an array of field names')
      }
      return { tenant, resource, fields }
    }, ({ descriptor }, { fields }) => {
      for (const fieldName of fields) {
        const field = descriptor.fields[fieldName]
        if (!field) throw new Error(`Field '${descriptor.resource}.${fieldName}' has no stored slot to retire`)
        if (field.slotType === 'belongsTo') throw new Error(`Field '${descriptor.resource}.${fieldName}' is a relationship and cannot be retired`)
      }
      const stored = descriptor.definition || { options: null, callbacks: [] }
      const retired = [...new Set([...(stored.retired || []), ...fields])]
      return { definition_json: JSON.stringify({ ...stored, retired }) }
    })
  }

  // Run one schema change under the resource's row lock and bump its version once.
  // `change` returns the any_resource_configs values to write.
  async #changeResource (options, method, readParams, change) {
    const context = { method, [readCommittedTransaction]: true }
    let trx; let managed = false
    try {
      const params = readParams()
      const { tenant, resource } = params
      Object.assign(context, { tenant, resource })

      managed = !options.transaction
      trx = await beginWriteTransaction(context, options.transaction, ownerContext => createKnexTransaction(this.knex, ownerContext))
      const resourceRow = await this.#lockResourceRow(trx, tenant, resource)
      const descriptor = resourceRow && await this.#loadDescriptor(tenant, resource, trx)
      if (!descriptor) throw new Error(`Resource '${resource}' not registered for tenant '${tenant}'`)
      const values = await change({ trx, resourceRow, descriptor }, params)
      await this.#bumpVersion(trx, resourceRow, { ...values, updated_at: this.knex.fn.now() })
      const updated = await this.#loadDescriptor(tenant, resource, trx)
      if (managed) {
        await commitTransaction(trx, context)
        this.#rememberDescriptor(updated)
      }
      return clone(updated)
    } catch (error) {
      if (managed) {
        await this.#handleWriteFailure(error, trx || context.transaction, context)
      }
      throw wrapWriteError(error, context, context.transaction || options.transaction)
    } finally {
      endWriteOperation(context)
    }
  }

  #planAllocation (descriptor, fields, pools) {
    const { resource } = descriptor
    const used = new Set(Object.values(descriptor.fields).map(info => info.slot))
    for (const info of Object.values(descriptor.belongsTo)) {
      used.add(info.idColumn)
      used.add(info.typeColumn)
    }
    const fieldRows = []
    const relationshipRows = []
    const definitions = {}

    for (const [fieldName, { definition, canonicalField }] of Object.entries(fields)) {
      if (fieldName === descriptor.idProperty || Object.hasOwn(descriptor.schema, fieldName) || Object.hasOwn(definitions, fieldName)) {
        throw new Error(`Field '${resource}.${fieldName}' already exists`)
      }
      if (canonicalField && (definition.belongsToPolymorphic || definition.computed || definition.virtual)) {
        throw new Error(`canonicalFieldsMap should not include non-stored field '${fieldName}'`)
      }
      definitions[fieldName] = definition

      if (definition?.belongsToPolymorphic) {
        const alias = definition.as || fieldName
        const { typeField, idField, types = [] } = definition.belongsToPolymorphic
        relationshipRows.push({
          relationship_name: alias,
          relationship_type: 'belongsToPolymorphic',
          target_resource: null,
          slot_index: null,
          id_column: idField,
          type_column: typeField,
          relationship_key: null,
          through: null,
          foreign_key: null,
          other_key: null,
          alias,
          meta_json: JSON.stringify({ types }),
        })
        continue
      }
      if (definition.computed || definition.virtual) continue

      let override = null
      if (canonicalField) {
        if (definition.belongsTo) {
          const normalized = typeof canonicalField === 'string'
            ? { idSlot: canonicalField }
            : canonicalField
          if (!normalized || !normalized.idSlot) {
            throw new Error(`canonicalFieldsMap for belongsTo field '${fieldName}' requires idSlot`)
          }
          const parsed = parseBelongsToSlots(normalized, pools)
          reserveSlots(used, [parsed.idColumn, parsed.typeColumn])
          override = normalized
        } else {
          const slotColumn = typeof canonicalField === 'string'
            ? canonicalField
            : canonicalField?.slot || canonicalField?.slotColumn
          if (!slotColumn) {
            throw new Error(`canonicalFieldsMap for field '${fieldName}' must provide a slot column`)
          }
          reserveSlots(used, [slotColumn])
          override = { slotColumn }
        }
      }
      const fieldSlot = this.#assignFieldSlot({ ...definition, fieldName }, used, override, pools)
      if (!fieldSlot) throw new Error(`Field '${resource}.${fieldName}' requires a supported type`)
      fieldRows.push(this.#fieldRow(fieldName, definition, fieldSlot))
      if (fieldSlot.relationshipRow) relationshipRows.push(this.#relationshipRow(fieldSlot.relationshipRow))
    }
    return { fieldRows, relationshipRows, definitions }
  }

  #fieldRow (fieldName, fieldDef, allocation) {
    return {
      field_name: fieldName,
      slot_type: allocation.slotType,
      slot_index: allocation.slotIndex,
      slot_column: allocation.slotColumn,
      nullable: fieldDef.nullable === true,
      required: fieldDef.required === true,
      target_resource: fieldDef.belongsTo || null,
      alias: fieldDef.as || null,
      meta_json: fieldDef.meta ? JSON.stringify(fieldDef.meta) : null,
    }
  }

  #relationshipRow (relationship) {
    return {
      relationship_name: relationship.name,
      relationship_type: relationship.type,
      target_resource: relationship.target,
      slot_index: relationship.slotIndex,
      id_column: relationship.idColumn,
      type_column: relationship.typeColumn,
      relationship_key: relationship.relationshipKey,
      through: relationship.through,
      foreign_key: relationship.foreignKey,
      other_key: relationship.otherKey,
      alias: relationship.alias,
      meta_json: relationship.meta ? JSON.stringify(relationship.meta) : null,
    }
  }

  // Concurrent schema changes to one resource queue on its metadata row.
  #lockResourceRow (trx, tenant, resource) {
    return trx('any_resource_configs').where({ tenant_id: tenant, resource }).forUpdate().first()
  }

  async #bumpVersion (trx, resourceRow, values) {
    const version = Number(resourceRow.schema_version ?? 1)
    const updated = await trx('any_resource_configs')
      .where({ id: resourceRow.id, schema_version: version })
      .update({ ...values, schema_version: version + 1 })
    if (Number(updated) !== 1) {
      throw new RestApiResourceError(`AnyAPI resource '${resourceRow.resource}' changed concurrently; retry the schema change`, {
        subtype: 'conflict', resourceType: 'anyapi_resource', resourceId: resourceRow.resource
      })
    }
    return version + 1
  }

  async #hasRecords (trx, descriptor) {
    const { canonical } = descriptor
    return Boolean(await trx(canonical.tableName)
      .where(canonical.tenantColumn, descriptor.tenant)
      .where(canonical.resourceColumn, descriptor.resource)
      .first('id'))
  }

  async getSchemaVersion (tenant, resource, { transaction } = {}) {
    const row = await (transaction || this.knex)('any_resource_configs')
      .where({ tenant_id: tenant, resource })
      .first('schema_version')
    return row ? Number(row.schema_version) : null
  }

  async getDescriptor (tenant, resource, options = {}) {
    if (!tenant || !resource) return null
    try {
      const key = this.#key(tenant, resource)
      if (!options.transaction && !options.bypassCache && this.cache.has(key)) {
        const descriptor = this.cache.get(key)
        this.#rememberDescriptor(descriptor)
        return clone(descriptor)
      }

      const descriptor = await this.#loadDescriptor(tenant, resource, options.transaction)
      if (!descriptor) {
        if (!options.transaction) this.cache.delete(key)
        return null
      }

      if (!options.transaction) this.#rememberDescriptor(descriptor)
      return clone(descriptor)
    } catch (error) {
      throw wrapUnexpectedError(error, {
        message: `Failed to load descriptor for resource '${resource}'`,
        context: { tenant, scopeName: resource, phase: 'descriptor' }
      })
    }
  }

  async listResources (tenant) {
    const query = this.knex('any_resource_configs')
    if (tenant) {
      query.where({ tenant_id: tenant })
    }
    const rows = await query.select('tenant_id', 'resource')
    return rows.map((row) => ({ tenant: row.tenant_id, resource: row.resource }))
  }

  invalidateDescriptor (tenant, resource) {
    this.cache.delete(this.#key(tenant, resource))
  }

  async #handleWriteFailure (error, transaction, context) {
    // A rejected commit can still have changed persisted metadata.
    this.invalidateDescriptor(context.tenant, context.resource)
    await rollbackAfterError(error, context, transaction)
    if (context.cleanupErrors.length) {
      try {
        await createEnhancedLogger(this.log).error('AnyAPI registry rollback failed', {
          ...getOperationDiagnosticContext(context, {
            phase: 'registryRollback',
            scopeName: context.resource,
            backend: this.knex.client.config.client
          }),
          tenant: context.tenant,
          error: context.error,
          cleanupErrors: context.cleanupErrors
        })
      } catch (error) {
        context.cleanupErrors.push({ phase: 'logging', error })
      }
    }
  }

  #validateDefinition (definition) {
    const { tenant, resource, schema } = definition || {}
    if (!tenant || typeof tenant !== 'string') {
      throw new Error('AnyapiRegistry.registerResource requires a tenant string')
    }
    if (!resource || typeof resource !== 'string') {
      throw new Error('AnyapiRegistry.registerResource requires a resource string')
    }
    if (!schema || typeof schema !== 'object') {
      throw new Error('AnyapiRegistry.registerResource requires a schema object')
    }
    validateSchemaFieldNames(schema, resource)
    validateRelationshipFieldNames(definition.relationships, resource)
    assertFieldNameMap(definition.canonicalFieldMap, `canonical fields in '${resource}'`)
  }

  async #register (definition, externalTrx, context) {
    const { tenant, resource, schema, relationships = {}, canonicalFieldMap = null } = definition
    const idProperty = resolveIdProperty(schema, definition.idProperty)
    let trx
    const managed = !externalTrx

    try {
      trx = await beginWriteTransaction(context, externalTrx, ownerContext => createKnexTransaction(this.knex, ownerContext))
      const now = this.knex.fn.now()
      const resourceRow = await this.#lockResourceRow(trx, tenant, resource)
      // Validate persisted mappings before registration can replace migration evidence.
      const previous = resourceRow ? await this.#loadState(tenant, resource, trx, { idProperty }) : null
      const previousDescriptor = previous?.descriptor
      const stored = previousDescriptor?.definition || null
      const runtime = clone(stored?.runtime || EMPTY_RUNTIME)
      let populated
      const isPopulated = () => (populated ??= this.#hasRecords(trx, previousDescriptor))

      // Registration never drops a mapping other servers may still use. Runtime
      // additions stay published; a populated field the declaration omits keeps
      // its slot but is no longer published. Metadata written before
      // definitions were stored cannot tell the two apart, so it keeps both.
      const retained = {}
      for (const [fieldName, fieldDef] of Object.entries(previousDescriptor?.schema || {})) {
        if (Object.hasOwn(schema, fieldName)) continue
        if (!stored?.options && !Object.hasOwn(runtime.schema, fieldName)) runtime.schema[fieldName] = fieldDef
        if (Object.hasOwn(runtime.schema, fieldName) || await isPopulated()) retained[fieldName] = fieldDef
      }
      const storageSchema = { ...schema, ...retained }

      const plan = await this.#withSlotPools(trx, pools => this.#planRegistration({
        tenant, resource, schema, storageSchema, relationships, canonicalFieldMap, idProperty, previousDescriptor, pools
      }))
      const declaration = toStoredJson(definition.declaration ?? { schema, relationships })
      const row = {
        schema_json: JSON.stringify(storageSchema),
        relationships_json: JSON.stringify(relationships || {}),
        definition_json: JSON.stringify({
          options: declaration.json,
          callbacks: declaration.callbacks,
          runtime,
          // Retirement outlives declarations that still list the field.
          ...(stored?.retired?.length ? { retired: stored.retired } : {})
        }),
      }
      const unchanged = previous &&
        Object.entries(row).every(([column, value]) => previous.resourceRow[column] === value) &&
        rowsSignature(previous.fieldRows, FIELD_ROW_COLUMNS) === rowsSignature(plan.fieldRows, FIELD_ROW_COLUMNS) &&
        rowsSignature(previous.relationshipRows, RELATIONSHIP_ROW_COLUMNS) === rowsSignature(plan.relationshipRows, RELATIONSHIP_ROW_COLUMNS)
      if (unchanged) {
        if (managed) await commitTransaction(trx, context)
        return { descriptor: previousDescriptor, changed: false }
      }

      let resourceConfigId = resourceRow?.id
      if (resourceRow) {
        await trx('any_field_configs').where({ resource_config_id: resourceRow.id }).delete()
        await trx('any_relationship_configs').where({ resource_config_id: resourceRow.id }).delete()
        await this.#bumpVersion(trx, resourceRow, { ...row, updated_at: now })
      } else {
        try {
          const [inserted] = await applyInsertReturning(trx('any_resource_configs').insert({
            tenant_id: tenant,
            resource,
            ...row,
            schema_version: 1,
            created_at: now,
            updated_at: now,
          }), 'id')
          resourceConfigId = inserted && typeof inserted === 'object' ? inserted.id : inserted
        } catch (error) {
          if (isWriteConflict(error)) creationRaces.add(error)
          throw error
        }
      }

      const stamp = { resource_config_id: resourceConfigId, created_at: now, updated_at: now }
      if (plan.fieldRows.length > 0) {
        await trx('any_field_configs').insert(plan.fieldRows.map(fieldRow => ({ ...fieldRow, ...stamp })))
      }
      if (plan.relationshipRows.length > 0) {
        await trx('any_relationship_configs').insert(plan.relationshipRows.map(relationshipRow => ({ ...relationshipRow, ...stamp })))
      }

      const descriptor = await this.#loadDescriptor(tenant, resource, trx, { idProperty })
      const changedField = Object.keys(previousDescriptor?.fields || {}).find(fieldName => {
        const previousField = previousDescriptor.fields[fieldName]
        const current = descriptor.fields[fieldName]
        if (!current || previousField.slot !== current.slot || previousField.slotType !== current.slotType) return true
        return previousField.slotType === 'belongsTo' &&
          previousDescriptor.belongsTo[previousField.alias]?.typeColumn !== descriptor.belongsTo[current.alias]?.typeColumn
      })
      if (changedField && await isPopulated()) {
        throw new Error(`Canonical storage migration required for '${resource}.${changedField}': registration cannot remove or remap stored fields while records exist. Preserve canonicalFieldsMap or migrate the stored data before changing the schema.`)
      }

      if (managed) {
        await commitTransaction(trx, context)
      }

      return { descriptor, changed: true }
    } catch (error) {
      if (managed) {
        await this.#handleWriteFailure(error, trx || context.transaction, context)
      }
      throw error
    }
  }

  #planRegistration ({ tenant, resource, schema, storageSchema, relationships, canonicalFieldMap, idProperty, previousDescriptor, pools }) {
    const used = new Set()
    const canonicalOverrides = canonicalFieldMap ? new Map(Object.entries(canonicalFieldMap)) : null
    const entries = []
    const fieldRows = []
    const relationshipRows = []

    // ID attributes previously had no slot; append them without moving existing slots.
    const fields = Object.entries(storageSchema).sort(([, left], [, right]) =>
      Number(left?.type === 'id' && !left.belongsTo) - Number(right?.type === 'id' && !right.belongsTo)
    )
    for (const [fieldName, fieldDef] of fields) {
      if (fieldName === 'id' || (fieldName === idProperty && fieldDef?.type === 'id')) {
        canonicalOverrides?.delete(fieldName)
        continue
      }

      if (fieldDef?.belongsToPolymorphic) {
        if (canonicalOverrides?.has(fieldName)) {
          throw new Error(`canonicalFieldsMap should not include polymorphic field '${fieldName}'`)
        }
        const alias = fieldDef.as || fieldName
        const { typeField, idField, types = [] } = fieldDef.belongsToPolymorphic
        relationshipRows.push({
          relationship_name: alias,
          relationship_type: 'belongsToPolymorphic',
          target_resource: null,
          slot_index: null,
          id_column: idField,
          type_column: typeField,
          relationship_key: null,
          through: null,
          foreign_key: null,
          other_key: null,
          alias,
          meta_json: JSON.stringify({ types }),
        })
        continue
      }

      if (fieldDef?.computed) {
        if (canonicalOverrides?.has(fieldName)) {
          throw new Error(`canonicalFieldsMap should not include computed field '${fieldName}'`)
        }
        continue
      }

      if (fieldDef?.virtual === true) {
        if (canonicalOverrides?.has(fieldName)) {
          throw new Error(`canonicalFieldsMap should not include virtual field '${fieldName}'`)
        }
        continue
      }

      let override = null
      // Retained fields are not part of the declaration, so its map does not cover them.
      if (canonicalOverrides && Object.hasOwn(schema, fieldName)) {
        if (!canonicalOverrides.has(fieldName)) {
          throw new Error(`canonicalFieldsMap missing entry for field '${fieldName}'`)
        }
        const rawOverride = canonicalOverrides.get(fieldName)
        canonicalOverrides.delete(fieldName)

        if (fieldDef.belongsTo) {
          const normalized = typeof rawOverride === 'string'
            ? { idSlot: rawOverride }
            : rawOverride
          if (!normalized || !normalized.idSlot) {
            throw new Error(`canonicalFieldsMap for belongsTo field '${fieldName}' requires idSlot`)
          }
          const parsed = parseBelongsToSlots(normalized, pools)
          reserveSlots(used, [parsed.idColumn, parsed.typeColumn])
          override = normalized
        } else {
          const slotColumn = typeof rawOverride === 'string'
            ? rawOverride
            : rawOverride?.slot || rawOverride?.slotColumn
          if (!slotColumn) {
            throw new Error(`canonicalFieldsMap for field '${fieldName}' must provide a slot column`)
          }
          parseSimpleSlotColumn(slotColumn, pools)
          reserveSlots(used, [slotColumn])
          override = { slotColumn }
        }
      }
      entries.push({ fieldName, fieldDef, override })
    }

    if (canonicalOverrides && canonicalOverrides.size > 0) {
      const unknownFields = [...canonicalOverrides.keys()].join(', ')
      throw new Error(`canonicalFieldsMap contains unknown fields: ${unknownFields}`)
    }

    // Stored fields keep their slots, so declaration order never moves data.
    for (const entry of entries) {
      const previous = previousDescriptor?.fields?.[entry.fieldName]
      if (entry.override || !previous || previous.slotType !== slotPoolFor(entry.fieldDef)) continue
      const columns = previous.slotType === 'belongsTo' ? belongsToColumns(previous.slotIndex) : [previous.slot]
      const available = previous.slotType === 'belongsTo'
        ? pools.belongsTo.includes(previous.slotIndex)
        : pools[previous.slotType]?.includes(previous.slot)
      if (!available || columns.some(column => used.has(column))) continue
      columns.forEach(column => used.add(column))
      entry.override = previous.slotType === 'belongsTo' ? { idSlot: columns[0], typeSlot: columns[1] } : { slotColumn: previous.slot }
    }

    for (const { fieldName, fieldDef, override } of entries) {
      const allocation = this.#assignFieldSlot({ ...fieldDef, fieldName }, used, override, pools)
      if (!allocation) continue
      fieldRows.push(this.#fieldRow(fieldName, fieldDef, allocation))
      if (allocation.relationshipRow) relationshipRows.push(this.#relationshipRow(allocation.relationshipRow))
    }

    for (const [relName, relDef] of Object.entries(relationships || {})) {
      if (relDef?.type === 'manyToMany') {
        relationshipRows.push(this.#relationshipRow({
          name: relName,
          type: 'manyToMany',
          target: relDef.target || relName,
          relationshipKey: relDef.relationship || `${tenant}:${resource}:${relName}`,
          through: relDef.through,
          foreignKey: relDef.foreignKey,
          otherKey: relDef.otherKey,
          alias: relDef.as || relName,
          meta: relDef.meta || {},
        }))
      }
    }

    return { fieldRows, relationshipRows }
  }

  async #loadDescriptor (tenant, resource, trx, options = {}) {
    return (await this.#loadState(tenant, resource, trx, options))?.descriptor || null
  }

  async #loadState (tenant, resource, trx, options = {}) {
    const resourceRow = await (trx || this.knex)('any_resource_configs')
      .where({ tenant_id: tenant, resource })
      .first()
    if (!resourceRow) return null

    const fieldRows = await (trx || this.knex)('any_field_configs')
      .where({ resource_config_id: resourceRow.id })
      .select()

    const relationshipRows = await (trx || this.knex)('any_relationship_configs')
      .where({ resource_config_id: resourceRow.id })
      .select()

    const slotState = this.#initializeSlotState()
    for (const row of fieldRows) {
      if (row.slot_type === 'belongsTo') {
        slotState.belongsTo = Math.max(slotState.belongsTo, row.slot_index)
      } else if (row.slot_type in slotState) {
        slotState[row.slot_type] = Math.max(slotState[row.slot_type], row.slot_index)
      }
    }

    const descriptor = this.#buildDescriptor({
      tenant,
      resource,
      schema: JSON.parse(resourceRow.schema_json),
      relationships: JSON.parse(resourceRow.relationships_json || '{}'),
      slotState,
      fieldRows,
      relationshipRows,
      idProperty: options.idProperty,
    })

    const canonicalFieldMap = {}
    for (const [fieldName, fieldInfo] of Object.entries(descriptor.fields || {})) {
      if (fieldInfo.slotType === 'belongsTo') {
        const alias = fieldInfo.alias || BELONGS_TO_ALIAS(fieldName, descriptor.schema?.[fieldName] || {})
        const belongsToInfo = descriptor.belongsTo?.[alias]
        canonicalFieldMap[fieldName] = {
          idSlot: fieldInfo.slot,
          typeSlot: belongsToInfo?.typeColumn || `rel_${fieldInfo.slotIndex}_type`,
        }
      } else {
        canonicalFieldMap[fieldName] = fieldInfo.slot
      }
    }

    descriptor.canonicalFieldMap = canonicalFieldMap
    descriptor.schemaVersion = Number(resourceRow.schema_version ?? 1)
    descriptor.definition = resourceRow.definition_json ? JSON.parse(resourceRow.definition_json) : null

    return { resourceRow, fieldRows, relationshipRows, descriptor }
  }

  #buildDescriptor ({ tenant, resource, schema, relationships, slotState, fieldRows, relationshipRows, idProperty }) {
    validateSchemaFieldNames(schema, resource)
    validateRelationshipFieldNames(relationships, resource)
    const fields = {}
    const reverseAttributes = {}
    const belongsTo = {}
    const manyToMany = {}
    const polymorphicBelongsTo = {}

    for (const row of fieldRows) {
      assertFieldName(row.field_name, `stored field in '${resource}'`)
      assertFieldName(row.alias, `stored relationship alias in '${resource}'`)
      if (['date', 'time'].includes(schema?.[row.field_name]?.type) && row.slot_type !== 'string') {
        throw new Error(`AnyAPI temporal storage migration required for '${resource}.${row.field_name}': calendar dates and times must use string slots. See 33-migrating-to-v2.md.`)
      }
      fields[row.field_name] = {
        slot: row.slot_column,
        slotType: row.slot_type,
        slotIndex: row.slot_index,
        nullable: row.nullable === 1 || row.nullable === true,
        required: row.required === 1 || row.required === true,
        target: row.target_resource,
        alias: row.alias,
        meta: row.meta_json ? JSON.parse(row.meta_json) : undefined,
      }

      reverseAttributes[row.slot_column] = row.field_name
    }

    for (const row of relationshipRows) {
      assertFieldName(row.relationship_name, `stored relationship in '${resource}'`)
      assertFieldName(row.alias, `stored relationship alias in '${resource}'`)
      if (row.relationship_type === 'belongsTo') {
        const alias = row.alias || row.relationship_name
        belongsTo[alias] = {
          alias,
          field: fields[row.relationship_name]?.field || row.relationship_name,
          target: row.target_resource,
          slotIndex: row.slot_index,
          idColumn: row.id_column,
          typeColumn: row.type_column,
        }
      } else if (row.relationship_type === 'manyToMany') {
        manyToMany[row.relationship_name] = {
          alias: row.alias || row.relationship_name,
          relationship: row.relationship_key,
          target: row.target_resource || row.relationship_name,
          through: row.through,
          foreignKey: row.foreign_key,
          otherKey: row.other_key,
          meta: row.meta_json ? JSON.parse(row.meta_json) : undefined,
        }
      }
    }

    const schemaObj = schema || {}
    for (const [fieldName, fieldDef] of Object.entries(schemaObj)) {
      if (!fieldDef?.belongsToPolymorphic) continue
      const alias = fieldDef.as || fieldName
      const { typeField, idField, types = [] } = fieldDef.belongsToPolymorphic
      const typeEntry = fields[typeField] || null
      const idEntry = fields[idField] || null
      polymorphicBelongsTo[alias] = {
        alias,
        typeField,
        idField,
        typeColumn: typeEntry?.slot || null,
        idColumn: idEntry?.slot || null,
        types,
      }
    }

    for (const [relName, relDef] of Object.entries(relationships || {})) {
      if (!relDef?.belongsToPolymorphic) continue
      const alias = relDef.as || relName
      const { typeField, idField, types = [] } = relDef.belongsToPolymorphic
      const typeEntry = fields[typeField] || null
      const idEntry = fields[idField] || null
      polymorphicBelongsTo[alias] = {
        alias,
        typeField,
        idField,
        typeColumn: typeEntry?.slot || null,
        idColumn: idEntry?.slot || null,
        types,
      }
    }

    return {
      tenant,
      resource,
      idProperty: resolveIdProperty(schema, idProperty),
      schema,
      relationships,
      canonical: DEFAULT_CANONICAL_CONFIG,
      fields,
      belongsTo,
      manyToMany,
      polymorphicBelongsTo,
      reverseAttributes,
      slotState,
    }
  }

  #initializeSlotState () {
    return {
      string: 0,
      number: 0,
      boolean: 0,
      date: 0,
      json: 0,
      belongsTo: 0,
    }
  }

  // Callers reserve explicit and preserved slots in `used` before assigning;
  // other fields take the first free slot of their pool.
  #assignFieldSlot (fieldDef, used, canonicalOverride, pools) {
    if (fieldDef.belongsTo) {
      return this.#assignBelongsTo(fieldDef, used, canonicalOverride, pools)
    }

    const { type } = fieldDef
    if (!type) {
      return null
    }
    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error(`Unsupported field type '${type}'`)
    }

    const pool = slotPoolFor(fieldDef)
    if (!pool) {
      throw new Error(`No slot pool defined for type '${type}'`)
    }

    if (canonicalOverride) {
      const slotColumn = typeof canonicalOverride === 'string'
        ? canonicalOverride
        : canonicalOverride.slot || canonicalOverride.slotColumn
      if (!slotColumn) {
        throw new Error(`Canonical mapping for field '${fieldDef.fieldName}' must provide a slot column`)
      }
      const { slotType, slotIndex } = parseSimpleSlotColumn(slotColumn, pools)
      if (slotType !== pool) {
        throw new Error(
          `Canonical slot '${slotColumn}' does not match expected type '${pool}' for field '${fieldDef.fieldName}'`
        )
      }
      used.add(slotColumn)
      return { slotType: pool, slotIndex, slotColumn }
    }

    const slotColumn = pools[pool].find(column => !used.has(column))
    if (!slotColumn) {
      throw slotsExhausted(pool)
    }
    used.add(slotColumn)
    return { slotType: pool, slotIndex: pools[pool].indexOf(slotColumn) + 1, slotColumn }
  }

  #assignBelongsTo (fieldDef, used, canonicalOverride, pools) {
    const alias = BELONGS_TO_ALIAS(fieldDef.fieldName || '', fieldDef)
    const relationshipKey = fieldDef.relationshipKey || null

    let slotIndex
    if (canonicalOverride) {
      const normalized = typeof canonicalOverride === 'string'
        ? { idSlot: canonicalOverride }
        : canonicalOverride
      slotIndex = parseBelongsToSlots(normalized || {}, pools).slotIndex
    } else {
      slotIndex = pools.belongsTo.find(index => belongsToColumns(index).every(column => !used.has(column)))
      if (slotIndex === undefined) {
        throw slotsExhausted('belongsTo')
      }
    }
    const [idColumn, typeColumn] = belongsToColumns(slotIndex)
    used.add(idColumn)
    used.add(typeColumn)

    return {
      slotType: 'belongsTo',
      slotIndex,
      slotColumn: idColumn,
      relationshipRow: {
        name: alias,
        type: 'belongsTo',
        target: fieldDef.belongsTo,
        slotIndex,
        idColumn,
        typeColumn,
        relationshipKey,
        alias,
      },
    }
  }
}
