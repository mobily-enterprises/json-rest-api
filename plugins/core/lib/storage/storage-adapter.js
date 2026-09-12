// @ts-check
import {
  getFieldValue as getTableFieldValue,
  getIdColumn,
  getStorageInfo,
  getStorageColumn,
  translateAttributesForStorage,
  serializeFieldValueForStorage,
  assertWritableKnexColumns,
} from './storage-mapping.js'
import {
  getCanonicalFieldValue,
  getCanonicalResourceIdColumn,
  translateCanonicalAttributesForStorage,
} from './canonical-storage-mapping.js'
import { assertScalarQueryField } from '../querying-writing/field-utils.js'
import { normalizeValueForDatabaseStorage } from '../querying-writing/database-value-normalizers.js'

/** @import { BaseStorageAdapterOptions, CanonicalDescriptor, SelectTranslator, StorageAdapter, StorageAdapterOptions, StorageAdapterLookupOptions, StorageSchemaInfo, StorageFieldDefinition } from './storage-types.js' */

/** @template T @param {T} value @returns {T} */
const passthrough = (value) => value
/** @type {StorageAdapter['translateFilterValue']} */
const identityTranslate = (_field, value) => value

/** @type {StorageAdapter['selectColumns']} */
const selectColumnsOnBuilder = (builder, columns) => {
  if (!columns) return builder
  if (Array.isArray(columns)) {
    columns.forEach((column) => builder.select(column))
  } else if (typeof columns === 'object') {
    builder.select(columns)
  }
  return builder
}

/** @param {unknown} value @returns {unknown} */
const normalizeBelongsToValue = (value) => {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return value.map(entry => normalizeBelongsToValue(entry))
  }
  return String(value)
}

/** @param {unknown} value @returns {boolean} */
const normalizeBooleanValue = (value) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  return Boolean(value)
}

/**
 * @param {unknown} value
 * @param {StorageFieldDefinition} [definition]
 * @param {{ isRelationship?: boolean, databaseClient?: string, textStorage?: boolean }} [options]
 * @returns {unknown}
 */
const normalizeFilterValueForDefinition = (value, definition = {}, { isRelationship = false, databaseClient, textStorage } = {}) => {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return value.map(entry => normalizeFilterValueForDefinition(entry, definition, { isRelationship, databaseClient, textStorage }))
  }

  if (isRelationship) {
    return normalizeBelongsToValue(value)
  }

  const type = definition?.type || definition?.dataType
  if (!type) {
    return value
  }

  if (['number', 'integer', 'float', 'decimal'].includes(type)) {
    const numeric = Number(value)
    return Number.isNaN(numeric) ? value : numeric
  }

  if (type === 'boolean') {
    return normalizeBooleanValue(value)
  }

  if (['date', 'dateTime', 'time'].includes(type)) {
    return normalizeValueForDatabaseStorage(value, type, {
      databaseClient,
      textStorage,
      temporalPrecision: definition?.temporalPrecision
    })
  }

  return value
}

/** @overload @param {StorageAdapter} adapter @returns {SelectTranslator} */
/** @overload @param {StorageAdapter | null | undefined} adapter @returns {SelectTranslator | null} */
/** @param {StorageAdapter | null | undefined} adapter @returns {SelectTranslator | null} */
export const createSelectTranslator = (adapter) => {
  if (!adapter) return null

  return (field, alias) => {
    if (field === '*') {
      return alias ? `${alias}.*` : '*'
    }

    const translated = adapter.translateColumn(field)
    const result = translated || field

    if (field === 'id' && result !== 'id') {
      const qualified = alias ? `${alias}.${result}` : result
      return `${qualified} as id`
    }

    if (!alias) {
      return result
    }

    if (result.includes('.')) {
      return result
    }

    return `${alias}.${result}`
  }
}

/** @param {BaseStorageAdapterOptions} options @returns {StorageAdapter} */
const baseAdapter = ({
  knex,
  tableName,
  idColumn,
  translateColumn,
  translateFilterValue = identityTranslate,
  translateCursorValue = identityTranslate,
  applyResourceScope = passthrough,
  toStorageRow = passthrough,
  getFieldValue = (record, fieldName) => record?.[fieldName],
  isCanonical = false,
}) => {
  /** @type {StorageAdapter['buildBaseQuery']} */
  const buildBaseQuery = ({ transaction, tableAlias } = {}) => {
    const query = (transaction || knex)(tableAlias ? { [tableAlias]: tableName } : tableName)
    return applyResourceScope(query, tableAlias)
  }

  return {
    isCanonical: () => isCanonical,
    getTableName: () => tableName,
    getIdColumn: () => idColumn,
    translateColumn,
    translateFilterValue,
    translateCursorValue,
    applyResourceScope,
    toStorageRow,
    getFieldValue,
    buildBaseQuery,
    selectColumns: selectColumnsOnBuilder,
  }
}

/** @param {StorageAdapterOptions} options @returns {StorageAdapter} */
const createTableAdapter = ({ knex, schemaInfo }) => {
  assertWritableKnexColumns(getStorageInfo(schemaInfo))
  const tableName = schemaInfo.tableName
  const idColumn = getIdColumn(schemaInfo)

  /** @type {StorageAdapter['translateColumn']} */
  const translateColumn = (field) => getStorageColumn(schemaInfo, field)
  /** @type {StorageAdapter['toStorageRow']} */
  const toStorageRow = (attributes, options = {}) => translateAttributesForStorage(attributes, schemaInfo, { ...options, databaseClient: knex.client.config.client })
  /** @type {StorageAdapter['getFieldValue']} */
  const getFieldValue = (record, fieldName) => getTableFieldValue(record, schemaInfo, fieldName)
  /** @type {StorageAdapter['translateCursorValue']} */
  const translateCursorValue = (field, value) => {
    const definition = schemaInfo.schemaStructure?.[field]
    return normalizeFilterValueForDefinition(value, definition, {
      isRelationship: Boolean(definition?.belongsTo || definition?.belongsToPolymorphic),
      databaseClient: knex.client.config.client
    })
  }
  /** @type {StorageAdapter['translateFilterValue']} */
  const translateFilterValue = (field, value) => {
    const searchField = schemaInfo.searchSchemaStructure?.[field]
    const fieldName = searchField?.actualField || field
    const schemaField = schemaInfo.schemaStructure?.[fieldName]
    assertScalarQueryField(schemaField, fieldName, 'filter')
    const fieldStorage = getStorageInfo(schemaInfo).fields[fieldName]
    if (fieldStorage?.serialize) {
      /** @param {unknown} entry */
      const serialize = (entry) => serializeFieldValueForStorage(entry, {
        fieldName,
        columnName: fieldStorage.column,
        definition: fieldStorage.definition,
        schemaInfo,
        context: null,
        operation: 'filter'
      })
      return Array.isArray(value) ? value.map(serialize) : serialize(value)
    }
    const definition = searchField || schemaField || {}
    const isRelationship = Boolean(
      searchField?.isRelationship ||
      schemaField?.belongsTo ||
      schemaField?.belongsToPolymorphic
    )
    return normalizeFilterValueForDefinition(value, definition, { isRelationship, databaseClient: knex.client.config.client })
  }

  return baseAdapter({
    knex,
    tableName,
    idColumn,
    translateColumn,
    translateFilterValue,
    translateCursorValue,
    applyResourceScope: passthrough,
    toStorageRow,
    getFieldValue,
    isCanonical: false,
  })
}

/** @param {StorageAdapterOptions & { descriptor: CanonicalDescriptor }} options @returns {StorageAdapter} */
const createCanonicalAdapter = ({ knex, schemaInfo, descriptor }) => {
  const canonical = descriptor.canonical
  const canonicalFieldMap = descriptor.canonicalFieldMap || {}
  const fieldsInfo = descriptor.fields || {}
  const belongsToInfo = descriptor.belongsTo || {}
  const idProperty = schemaInfo.idProperty || descriptor.idProperty || 'id'
  /** @param {string} field */
  const isLogicalIdField = (field) => field === 'id' || field === idProperty
  const descriptorWithIdProperty = descriptor.idProperty === idProperty
    ? descriptor
    : { ...descriptor, idProperty }

  /** @type {StorageAdapter['translateColumn']} */
  const translateColumn = (field) => {
    if (!field) return field
    if (isLogicalIdField(field)) return getCanonicalResourceIdColumn(descriptor)

    const canonicalEntry = canonicalFieldMap[field]
    if (typeof canonicalEntry === 'string') {
      return canonicalEntry
    }
    if (canonicalEntry && typeof canonicalEntry === 'object') {
      if (canonicalEntry.slot) return canonicalEntry.slot
      if (canonicalEntry.slotColumn) return canonicalEntry.slotColumn
      if (canonicalEntry.idSlot) return canonicalEntry.idSlot
      if (canonicalEntry.typeSlot && field.endsWith('_type')) return canonicalEntry.typeSlot
    }

    if (!canonicalEntry && field.endsWith('_id')) {
      const alias = field.slice(0, -3)
      const aliasEntry = canonicalFieldMap[alias]
      if (typeof aliasEntry === 'string') return aliasEntry
      if (aliasEntry?.idSlot) return aliasEntry.idSlot
    }

    if (!canonicalEntry && field.endsWith('_type')) {
      const alias = field.slice(0, -5)
      const aliasEntry = canonicalFieldMap[alias]
      if (typeof aliasEntry === 'object' && aliasEntry?.typeSlot) return aliasEntry.typeSlot
    }

    const fieldInfo = fieldsInfo[field]
    if (fieldInfo?.slot) return fieldInfo.slot

    const belongsInfo = belongsToInfo[field]
    if (belongsInfo?.idColumn) return belongsInfo.idColumn

    return field
  }

  /** @type {StorageAdapter['translateFilterValue']} */
  const translateFilterValue = (field, value) => {
    const searchField = schemaInfo.searchSchemaStructure?.[field]
    const fieldName = searchField?.actualField || field
    const schemaField = schemaInfo.schemaStructure?.[fieldName]
    assertScalarQueryField(schemaField, fieldName, 'filter')
    if (schemaField?.storage?.serialize) {
      /** @param {unknown} entry */
      const serialize = entry => {
        const serialized = serializeFieldValueForStorage(entry, {
          fieldName,
          columnName: translateColumn(fieldName),
          definition: schemaField,
          schemaInfo,
          operation: 'filter'
        })
        return schemaField.type === 'id' ? normalizeBelongsToValue(serialized) : serialized
      }
      return Array.isArray(value) ? value.map(serialize) : serialize(value)
    }
    if (isLogicalIdField(fieldName) || schemaField?.type === 'id') return normalizeBelongsToValue(value)
    const isRelationship = Boolean(
      searchField?.isRelationship ||
      schemaField?.belongsTo ||
      schemaField?.belongsToPolymorphic
    )
    const definition = searchField || schemaField || {}

    return normalizeFilterValueForDefinition(value, definition, { isRelationship, databaseClient: knex.client.config.client, textStorage: fieldsInfo[fieldName]?.slotType === 'string' })
  }

  /** @type {StorageAdapter['translateCursorValue']} */
  const translateCursorValue = (field, value) => {
    const definition = schemaInfo.schemaStructure?.[field]
    if (isLogicalIdField(field) || definition?.type === 'id') return normalizeBelongsToValue(value)
    return normalizeFilterValueForDefinition(value, definition, {
      isRelationship: Boolean(definition?.belongsTo || definition?.belongsToPolymorphic),
      databaseClient: knex.client.config.client,
      textStorage: fieldsInfo[field]?.slotType === 'string'
    })
  }

  /** @type {StorageAdapter['applyResourceScope']} */
  const applyResourceScope = (query, tableAlias) => {
    const prefix = tableAlias ? `${tableAlias}.` : ''
    return query
      .where(`${prefix}${canonical.tenantColumn}`, descriptor.tenant)
      .where(`${prefix}${canonical.resourceColumn}`, descriptor.resource)
  }

  /** @type {StorageAdapter['toStorageRow']} */
  const toStorageRow = (attributes, options = {}) => translateCanonicalAttributesForStorage(attributes, descriptor, { ...options, schemaInfo, databaseClient: knex.client.config.client })
  /** @type {StorageAdapter['getFieldValue']} */
  const getFieldValue = (record, fieldName) => (
    getCanonicalFieldValue(record, isLogicalIdField(fieldName) ? descriptorWithIdProperty : descriptor, fieldName)
  )

  return baseAdapter({
    knex,
    tableName: canonical.tableName,
    idColumn: getCanonicalResourceIdColumn(descriptor),
    translateColumn,
    translateFilterValue,
    translateCursorValue,
    applyResourceScope,
    toStorageRow,
    getFieldValue,
    isCanonical: true,
  })
}

/** @param {StorageAdapterOptions} options @returns {StorageAdapter} */
export const createStorageAdapter = ({ knex, schemaInfo }) => {
  if (!schemaInfo) {
    throw new Error('createStorageAdapter requires schemaInfo')
  }

  const descriptor = schemaInfo.descriptor
  if (descriptor?.canonical?.tableName) {
    return createCanonicalAdapter({ knex, schemaInfo, descriptor })
  }

  return createTableAdapter({ knex, schemaInfo })
}

/** @param {StorageAdapterLookupOptions} options @returns {(scopeName: string) => StorageAdapter | null} */
export function createStorageAdapterLookup ({ knex, getResource }) {
  /** @type {Map<string, { schemaInfo: StorageSchemaInfo, adapter: StorageAdapter }>} */
  const adapters = new Map()
  return scopeName => {
    if (!scopeName) return null
    const resource = getResource(scopeName)
    const schemaInfo = resource?.vars?.schemaInfo
    if (!schemaInfo) return null
    const cached = adapters.get(scopeName)
    if (cached && cached.schemaInfo === schemaInfo) return cached.adapter
    const adapter = createStorageAdapter({ knex, schemaInfo })
    adapters.set(scopeName, { adapter, schemaInfo })
    if (resource?.vars) resource.vars.storageAdapter = adapter
    return adapter
  }
}
