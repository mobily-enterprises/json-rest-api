const EMPTY_STORAGE_INFO = Object.freeze({
  idColumn: 'id',
  fields: Object.freeze({}),
  columns: Object.freeze({})
})

const isPlainObject = (value) => (
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

export const normalizeFieldStorage = (fieldName, definition = {}, { idColumn = 'id' } = {}) => {
  const storage = definition.storage

  if (storage !== undefined && !isPlainObject(storage)) {
    throw new Error(`Field '${fieldName}' has invalid storage metadata. Expected an object.`)
  }

  const column = storage?.column ?? fieldName
  if (typeof column !== 'string' || column.trim() === '') {
    throw new Error(`Field '${fieldName}' has an invalid storage.column value.`)
  }

  if (fieldName === 'id' && column !== idColumn) {
    throw new Error(
      `Field 'id' must use storage.column '${idColumn}' to match the resource id column.`
    )
  }

  if (storage?.serialize !== undefined && typeof storage.serialize !== 'function') {
    throw new Error(`Field '${fieldName}' has an invalid storage.serialize value. Expected a function.`)
  }

  return {
    column,
    serialize: storage?.serialize || null,
    persisted: definition.virtual !== true && definition.computed !== true
  }
}

export const buildStorageInfo = ({ schemaStructure = {}, idProperty = 'id' } = {}) => {
  const idColumn = idProperty || 'id'
  const fields = {}
  const columns = {}
  const usedColumns = new Map([[idColumn, 'id']])

  for (const [fieldName, definition] of Object.entries(schemaStructure)) {
    const normalized = normalizeFieldStorage(fieldName, definition, { idColumn })
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
    fields,
    columns
  }
}

export const getStorageInfo = (schemaInfo = {}) => {
  if (schemaInfo.storageInfo) {
    return schemaInfo.storageInfo
  }

  if (!schemaInfo.schemaStructure) {
    return EMPTY_STORAGE_INFO
  }

  return buildStorageInfo({
    schemaStructure: schemaInfo.schemaStructure,
    idProperty: schemaInfo.idProperty || 'id'
  })
}

export const getIdColumn = (schemaInfo = {}) => {
  return getStorageInfo(schemaInfo).idColumn || schemaInfo.idProperty || 'id'
}

export const getStorageColumn = (schemaInfo = {}, fieldName) => {
  if (!fieldName) return fieldName
  if (fieldName === 'id') return getIdColumn(schemaInfo)

  const fieldStorage = getStorageInfo(schemaInfo).fields[fieldName]
  return fieldStorage?.column || fieldName
}

export const getLogicalFieldName = (schemaInfo = {}, columnName) => {
  if (!columnName) return columnName
  if (columnName === getIdColumn(schemaInfo)) return 'id'

  const logicalField = getStorageInfo(schemaInfo).columns[columnName]
  return logicalField || columnName
}

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

  return translateRecordFromStorage(record, schemaInfo)[fieldName]
}

export const translateAttributesForStorage = (attributes, schemaInfo = {}, options = {}) => {
  if (!attributes) return attributes || {}

  const { context = null, operation = null } = options
  const storageInfo = getStorageInfo(schemaInfo)
  const computed = schemaInfo.computed || {}

  return Object.entries(attributes).reduce((translated, [fieldName, value]) => {
    if (fieldName in computed) {
      return translated
    }

    const fieldStorage = storageInfo.fields[fieldName]
    if (fieldStorage && !fieldStorage.persisted) {
      return translated
    }

    const columnName = fieldName === 'id'
      ? storageInfo.idColumn
      : fieldStorage?.column || fieldName
    const serializedValue = fieldStorage?.serialize
      ? fieldStorage.serialize(value, {
          fieldName,
          columnName,
          definition: fieldStorage.definition,
          schemaInfo,
          context,
          operation
        })
      : value

    translated[columnName] = serializedValue
    return translated
  }, {})
}

export const translateRecordFromStorage = (record, schemaInfo = {}) => {
  if (!record || !schemaInfo) return record

  const storageInfo = getStorageInfo(schemaInfo)
  const translated = {}

  for (const [columnName, value] of Object.entries(record)) {
    if (columnName === storageInfo.idColumn) {
      translated.id = value
      continue
    }

    const logicalField = storageInfo.columns[columnName]
    if (logicalField) {
      translated[logicalField] = value
      continue
    }

    translated[columnName] = value
  }

  return translated
}
