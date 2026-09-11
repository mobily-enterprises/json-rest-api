// @ts-check
import { normalizeValueForDatabaseStorage } from '../querying-writing/database-value-normalizers.js'
import { assertFieldNameMap } from '../querying-writing/field-utils.js'

/** @import { FieldStorage, StorageConfig, StorageFieldDefinition, StorageInfo, StorageNaming, StorageRow, StorageSchemaInfo, StorageSerializerDetails, StorageWriteOptions } from './storage-types.js' */

/** @type {StorageInfo} */
const EMPTY_STORAGE_INFO = Object.freeze({
  idColumn: 'id',
  storage: Object.freeze({
    naming: 'snake_case'
  }),
  fields: Object.freeze({}),
  columns: Object.freeze({})
})

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const SNAKE_CASE_STORAGE_NAMING = 'snake_case'
const EXACT_STORAGE_NAMING = 'exact'

/** @type {Readonly<Partial<Record<string, StorageNaming>>>} */
const STORAGE_NAMING_ALIASES = Object.freeze({
  snake: SNAKE_CASE_STORAGE_NAMING,
  snake_case: SNAKE_CASE_STORAGE_NAMING,
  snakeCase: SNAKE_CASE_STORAGE_NAMING,
  exact: EXACT_STORAGE_NAMING,
  field: EXACT_STORAGE_NAMING,
  verbatim: EXACT_STORAGE_NAMING
})

/** @param {unknown} value */
const toSnakeCase = (value) => String(value)
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/([A-Z]+)([A-Z][a-z0-9])/g, '$1_$2')
  .toLowerCase()

/** @param {unknown} [storage] @returns {StorageInfo['storage']} */
export const normalizeStorageConfig = (storage = undefined) => {
  if (storage === undefined || storage === null) {
    return {
      naming: SNAKE_CASE_STORAGE_NAMING
    }
  }

  if (!isPlainObject(storage)) {
    throw new Error('Resource storage metadata must be an object.')
  }

  const rawNaming = storage.naming
  const naming = rawNaming === undefined
    ? SNAKE_CASE_STORAGE_NAMING
    : typeof rawNaming === 'string' && Object.hasOwn(STORAGE_NAMING_ALIASES, rawNaming)
      ? STORAGE_NAMING_ALIASES[rawNaming]
      : undefined

  if (!naming) {
    throw new Error(
      `Invalid resource storage.naming value '${String(rawNaming)}'. Expected 'snake_case' or 'exact'.`
    )
  }

  return {
    ...storage,
    naming
  }
}

/** @param {string} fieldName @param {{ idColumn?: string, storageConfig?: StorageConfig }} [options] */
const resolveDefaultStorageColumn = (fieldName, { idColumn = 'id', storageConfig = undefined } = {}) => {
  if (fieldName === 'id') {
    return idColumn
  }

  const normalizedStorage = normalizeStorageConfig(storageConfig)
  if (normalizedStorage.naming === EXACT_STORAGE_NAMING) {
    return fieldName
  }

  return toSnakeCase(fieldName)
}

/**
 * @param {string} fieldName
 * @param {StorageFieldDefinition} [definition]
 * @param {{ idColumn?: string, storageConfig?: StorageConfig }} [options]
 * @returns {Omit<FieldStorage, 'definition'>}
 */
export const normalizeFieldStorage = (fieldName, definition = {}, { idColumn = 'id', storageConfig = undefined } = {}) => {
  const fieldStorage = definition.storage

  if (fieldStorage !== undefined && !isPlainObject(fieldStorage)) {
    throw new Error(`Field '${fieldName}' has invalid storage metadata. Expected an object.`)
  }

  const column = fieldStorage?.column ?? resolveDefaultStorageColumn(fieldName, {
    idColumn,
    storageConfig
  })
  if (typeof column !== 'string' || column.trim() === '') {
    throw new Error(`Field '${fieldName}' has an invalid storage.column value.`)
  }

  if (fieldName === 'id' && column !== idColumn) {
    throw new Error(
      `Field 'id' must use storage.column '${idColumn}' to match the resource id column.`
    )
  }

  if (fieldStorage?.serialize !== undefined && typeof fieldStorage.serialize !== 'function') {
    throw new Error(`Field '${fieldName}' has an invalid storage.serialize value. Expected a function.`)
  }

  return {
    column,
    serialize: fieldStorage?.serialize || null,
    persisted: definition.virtual !== true && definition.computed !== true
  }
}

/** @param {Partial<Pick<StorageSchemaInfo, 'schemaStructure' | 'idProperty' | 'storage'>>} [options] @returns {StorageInfo} */
export const buildStorageInfo = ({ schemaStructure = {}, idProperty = 'id', storage = undefined } = {}) => {
  assertFieldNameMap(schemaStructure, 'storage schema')
  const idColumn = idProperty || 'id'
  const storageConfig = normalizeStorageConfig(storage)
  /** @type {StorageInfo['fields']} */
  const fields = {}
  /** @type {StorageInfo['columns']} */
  const columns = {}
  const usedColumns = new Map([[idColumn, 'id']])

  for (const [fieldName, definition] of Object.entries(schemaStructure)) {
    const normalized = normalizeFieldStorage(fieldName, definition, {
      idColumn,
      storageConfig
    })
    const isIdSurrogateField = fieldName === idColumn && definition.type === 'id'

    if (fieldName !== 'id' && normalized.column === idColumn && !isIdSurrogateField) {
      throw new Error(
        `Field '${fieldName}' cannot use storage.column '${idColumn}' because it is reserved for the resource id.`
      )
    }

    const existingField = usedColumns.get(normalized.column)
    if (existingField && existingField !== fieldName && !(isIdSurrogateField && existingField === 'id')) {
      throw new Error(
        `Fields '${existingField}' and '${fieldName}' both map to storage column '${normalized.column}'.`
      )
    }

    usedColumns.set(normalized.column, fieldName)
    fields[fieldName] = {
      ...normalized,
      definition
    }

    if (normalized.persisted && !isIdSurrogateField) {
      columns[normalized.column] = fieldName
    }
  }

  return {
    idColumn,
    storage: storageConfig,
    fields,
    columns
  }
}

/** @param {Partial<StorageSchemaInfo>} [schemaInfo] @returns {StorageInfo} */
export const getStorageInfo = (schemaInfo = {}) => {
  if (schemaInfo.storageInfo) {
    return schemaInfo.storageInfo
  }

  if (!schemaInfo.schemaStructure) {
    return EMPTY_STORAGE_INFO
  }

  return buildStorageInfo({
    schemaStructure: schemaInfo.schemaStructure,
    idProperty: schemaInfo.idProperty || 'id',
    storage: schemaInfo.storage
  })
}

/** @param {Partial<StorageSchemaInfo>} [schemaInfo] @returns {string} */
export const getIdColumn = (schemaInfo = {}) => {
  return getStorageInfo(schemaInfo).idColumn || schemaInfo.idProperty || 'id'
}

/** @param {Partial<StorageSchemaInfo>} schemaInfo @param {string} fieldName @returns {string} */
export const getStorageColumn = (schemaInfo = {}, fieldName) => {
  if (!fieldName) return fieldName
  if (fieldName === 'id') return getIdColumn(schemaInfo)

  const fieldStorage = getStorageInfo(schemaInfo).fields[fieldName]
  return fieldStorage?.column || fieldName
}

/** @param {Partial<StorageSchemaInfo>} schemaInfo @param {string} columnName @returns {string} */
export const getLogicalFieldName = (schemaInfo = {}, columnName) => {
  if (!columnName) return columnName
  if (columnName === getIdColumn(schemaInfo)) return 'id'

  const columns = getStorageInfo(schemaInfo).columns
  return Object.hasOwn(columns, columnName) ? columns[columnName] || columnName : columnName
}

/** @param {StorageRow | null | undefined} record @param {Partial<StorageSchemaInfo>} schemaInfo @param {string} fieldName @returns {unknown} */
export const getFieldValue = (record, schemaInfo = {}, fieldName) => {
  if (!record || !fieldName) return undefined

  if (fieldName === 'id') {
    if (Object.hasOwn(record, 'id')) {
      return record.id
    }

    const idColumn = getIdColumn(schemaInfo)
    if (Object.hasOwn(record, idColumn)) {
      return record[idColumn]
    }

    return translateRecordFromStorage(record, schemaInfo).id
  }

  if (Object.hasOwn(record, fieldName)) {
    return record[fieldName]
  }

  const columnName = getStorageColumn(schemaInfo, fieldName)
  if (Object.hasOwn(record, columnName)) {
    return record[columnName]
  }

  const translated = translateRecordFromStorage(record, schemaInfo)
  return Object.hasOwn(translated, fieldName) ? translated[fieldName] : undefined
}

/** @param {StorageInfo} storageInfo */
export const assertWritableKnexColumns = (storageInfo) => {
  // Knex's update compiler discards these keys, even in null-prototype input objects.
  const unsupported = new Set(['constructor', 'prototype', '__proto__'])
  for (const [fieldName, field] of Object.entries(storageInfo.fields)) {
    if (field.persisted && unsupported.has(field.column)) {
      throw new Error(`Field '${fieldName}' maps to unsupported Knex storage column '${field.column}'. Set storage.column to a different column name; the public field name can stay the same.`)
    }
  }
  if (unsupported.has(storageInfo.idColumn)) {
    throw new Error(`Unsupported Knex id column '${storageInfo.idColumn}'. Set idProperty to a different column name.`)
  }
}

/** @param {unknown} value @param {Partial<StorageSerializerDetails> & { textStorage?: boolean }} [options] @returns {unknown} */
export const serializeFieldValueForStorage = (value, {
  fieldName, columnName, definition = {}, schemaInfo, context = null, operation = null, databaseClient, textStorage
} = {}) => {
  if (definition.storage?.serialize) {
    const serialized = definition.storage.serialize(value, { fieldName, columnName, definition, schemaInfo, context, operation })
    // Probe the optional property directly: proxies can supply it without a `has` result.
    if (serialized && typeof (/** @type {{ then?: unknown }} */ (serialized)).then === 'function') {
      // Own the rejected promise even though asynchronous serializers are invalid.
      Promise.resolve(serialized).catch(() => {})
      throw new Error(`Field '${fieldName}' storage.serialize must be synchronous. Use a field setter for asynchronous preparation.`)
    }
    return serialized
  }
  return normalizeValueForDatabaseStorage(value, definition.type, {
    databaseClient,
    textStorage,
    temporalPrecision: definition.temporalPrecision,
    fieldName,
    resourceType: context?.scopeName || schemaInfo?.tableName
  })
}

/** @param {StorageRow | null | undefined} attributes @param {Partial<StorageSchemaInfo>} schemaInfo @param {StorageWriteOptions} [options] @returns {StorageRow} */
export const translateAttributesForStorage = (attributes, schemaInfo = {}, options = {}) => {
  if (!attributes) return attributes || {}

  const { context = null, operation = null, databaseClient } = options
  const storageInfo = getStorageInfo(schemaInfo)
  const computed = schemaInfo.computed || {}

  return Object.entries(attributes).reduce((translated, [fieldName, value]) => {
    if (Object.hasOwn(computed, fieldName)) {
      return translated
    }

    const fieldStorage = storageInfo.fields[fieldName]
    if (fieldStorage && !fieldStorage.persisted) {
      return translated
    }

    const columnName = fieldName === 'id'
      ? storageInfo.idColumn
      : fieldStorage?.column || fieldName
    const serializedValue = serializeFieldValueForStorage(value, {
      fieldName, columnName, definition: fieldStorage?.definition, schemaInfo, context, operation, databaseClient
    })

    translated[columnName] = serializedValue
    return translated
  }, /** @type {StorageRow} */ ({}))
}

/** @overload @param {StorageRow} record @param {Partial<StorageSchemaInfo>} [schemaInfo] @returns {StorageRow} */
/** @overload @param {StorageRow | null | undefined} record @param {Partial<StorageSchemaInfo>} [schemaInfo] @returns {StorageRow | null | undefined} */
/** @param {StorageRow | null | undefined} record @param {Partial<StorageSchemaInfo>} [schemaInfo] @returns {StorageRow | null | undefined} */
export const translateRecordFromStorage = (record, schemaInfo = {}) => {
  if (!record || !schemaInfo) return record

  const storageInfo = getStorageInfo(schemaInfo)
  /** @type {StorageRow} */
  const translated = {}

  for (const [columnName, value] of Object.entries(record)) {
    if (columnName === storageInfo.idColumn) {
      translated.id = value
      continue
    }

    const logicalField = Object.hasOwn(storageInfo.columns, columnName) ? storageInfo.columns[columnName] : undefined
    if (logicalField) {
      translated[logicalField] = value
      continue
    }

    translated[columnName] = value
  }

  return translated
}
