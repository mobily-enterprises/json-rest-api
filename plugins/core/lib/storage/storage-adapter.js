import {
  getFieldValue as getLegacyFieldValue,
  getIdColumn,
  getStorageColumn,
  translateAttributesForStorage,
} from './storage-mapping.js'
import {
  getCanonicalFieldValue,
  getCanonicalResourceIdColumn,
  translateCanonicalAttributesForStorage,
} from './canonical-storage-mapping.js'
import { normalizeDateValue } from '../querying-writing/database-value-normalizers.js'

const passthrough = (value) => value
const identityTranslate = (_field, value) => value
const identityScope = (query) => query

const selectColumnsOnBuilder = (builder, columns) => {
  if (!columns) return builder
  if (Array.isArray(columns)) {
    columns.forEach((column) => builder.select(column))
  } else if (typeof columns === 'object') {
    builder.select(columns)
  }
  return builder
}

const normalizeArray = (value, normalizeFn) => value.map((entry) => normalizeFn(entry))

const normalizeBelongsToValue = (value) => {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return normalizeArray(value, normalizeBelongsToValue)
  }
  return String(value)
}

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

const normalizeFilterValueForDefinition = (value, definition = {}, { isRelationship = false } = {}) => {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return normalizeArray(
      value,
      (entry) => normalizeFilterValueForDefinition(entry, definition, { isRelationship })
    )
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
    return normalizeDateValue(value, type)
  }

  return value
}

const translateSourceColumn = (source, adapter) => {
  if (!adapter || source === '*') return source
  return adapter.translateColumn(source) || source
}

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

export const translateSelectFieldsForAdapter = (fields, adapter) => {
  if (!adapter || !fields) return fields

  const translateField = createSelectTranslator(adapter)

  return fields.map((field) => {
    if (typeof field !== 'string') return field
    if (field === '*') return '*'

    const aliasMatch = field.match(/\s+as\s+/i)
    if (aliasMatch) {
      const [source, alias] = field.split(/\s+as\s+/i)
      const translatedSource = translateSourceColumn(source.trim(), adapter)
      return `${translatedSource} as ${alias.trim()}`
    }

    return translateField(field)
  })
}

const baseAdapter = ({
  knex,
  tableName,
  idColumn,
  translateColumn,
  translateFilterValue = identityTranslate,
  applyResourceScope = identityScope,
  toStorageRow = passthrough,
  getFieldValue = (record, fieldName) => record?.[fieldName],
  isCanonical = false,
}) => {
  const buildBaseQuery = ({ transaction } = {}) => {
    const query = (transaction || knex)(tableName)
    return applyResourceScope(query)
  }

  return {
    isCanonical: () => isCanonical,
    getTableName: () => tableName,
    getIdColumn: () => idColumn,
    translateColumn,
    translateFilterValue,
    applyResourceScope,
    toStorageRow,
    getFieldValue,
    buildBaseQuery,
    selectColumns: (builder, columns) => selectColumnsOnBuilder(builder, columns),
  }
}

const createLegacyAdapter = ({ knex, schemaInfo }) => {
  const tableName = schemaInfo.tableName
  const idColumn = getIdColumn(schemaInfo)

  const translateColumn = (field) => getStorageColumn(schemaInfo, field)
  const toStorageRow = (attributes, options = {}) => translateAttributesForStorage(attributes, schemaInfo, options)
  const getFieldValue = (record, fieldName) => getLegacyFieldValue(record, schemaInfo, fieldName)
  const translateFilterValue = (field, value) => {
    const searchField = schemaInfo.searchSchemaStructure?.[field]
    const schemaField = schemaInfo.schemaStructure?.[field]
    const definition = searchField || schemaField || {}
    const isRelationship = Boolean(
      searchField?.isRelationship ||
      schemaField?.belongsTo ||
      schemaField?.belongsToPolymorphic
    )
    return normalizeFilterValueForDefinition(value, definition, { isRelationship })
  }

  return baseAdapter({
    knex,
    tableName,
    idColumn,
    translateColumn,
    translateFilterValue,
    applyResourceScope: identityScope,
    toStorageRow,
    getFieldValue,
    isCanonical: false,
  })
}

const createCanonicalAdapter = ({ knex, schemaInfo }) => {
  const descriptor = schemaInfo.descriptor || {}
  const canonical = descriptor.canonical || {}
  const canonicalFieldMap = descriptor.canonicalFieldMap || {}
  const fieldsInfo = descriptor.fields || {}
  const belongsToInfo = descriptor.belongsTo || {}

  const translateColumn = (field) => {
    if (!field) return field
    if (field === 'id') return getCanonicalResourceIdColumn(descriptor)

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
      if (aliasEntry?.typeSlot) return aliasEntry.typeSlot
    }

    const fieldInfo = fieldsInfo[field]
    if (fieldInfo?.slot) return fieldInfo.slot

    const belongsInfo = belongsToInfo[field]
    if (belongsInfo?.idColumn) return belongsInfo.idColumn

    return field
  }

  const translateFilterValue = (field, value) => {
    const searchField = schemaInfo.searchSchemaStructure?.[field]
    const schemaField = schemaInfo.schemaStructure?.[field]
    const isRelationship = Boolean(
      searchField?.isRelationship ||
      schemaField?.belongsTo ||
      schemaField?.belongsToPolymorphic
    )
    const definition = searchField || schemaField || {}

    return normalizeFilterValueForDefinition(value, definition, { isRelationship })
  }

  const applyResourceScope = (query) => {
    return query
      .where(canonical.tenantColumn, descriptor.tenant)
      .where(canonical.resourceColumn, descriptor.resource)
  }

  const toStorageRow = (attributes) => translateCanonicalAttributesForStorage(attributes, descriptor)
  const getFieldValue = (record, fieldName) => getCanonicalFieldValue(record, descriptor, fieldName)

  return baseAdapter({
    knex,
    tableName: canonical.tableName,
    idColumn: getCanonicalResourceIdColumn(descriptor),
    translateColumn,
    translateFilterValue,
    applyResourceScope,
    toStorageRow,
    getFieldValue,
    isCanonical: true,
  })
}

export const createStorageAdapter = ({ knex, schemaInfo }) => {
  if (!schemaInfo) {
    throw new Error('createStorageAdapter requires schemaInfo')
  }

  if (schemaInfo?.descriptor?.canonical?.tableName) {
    return createCanonicalAdapter({ knex, schemaInfo })
  }

  return createLegacyAdapter({ knex, schemaInfo })
}
