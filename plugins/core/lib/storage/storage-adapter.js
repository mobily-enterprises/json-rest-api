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

const baseAdapter = ({
  knex,
  tableName,
  idColumn,
  translateColumn,
  translateFilterValue = identityTranslate,
  applyResourceScope = identityScope,
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
    buildBaseQuery,
    selectColumns: (builder, columns) => selectColumnsOnBuilder(builder, columns),
  }
}

const createLegacyAdapter = ({ knex, schemaInfo }) => {
  const tableName = schemaInfo.tableName
  const idColumn = schemaInfo.idProperty || 'id'

  const translateColumn = (column) => column

  return baseAdapter({
    knex,
    tableName,
    idColumn,
    translateColumn,
    translateFilterValue: identityTranslate,
    applyResourceScope: identityScope,
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
    if (field === 'id') return 'id'

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
    if (value === null || value === undefined) return value

    const searchField = schemaInfo.searchSchemaStructure?.[field]
    const schemaField = schemaInfo.schemaStructure?.[field]
    const isRelationship = Boolean(
      searchField?.isRelationship ||
      schemaField?.belongsTo ||
      schemaField?.belongsToPolymorphic
    )

    if (!isRelationship) {
      if (Array.isArray(value)) {
        return normalizeArray(value, passthrough)
      }
      return value
    }

    return normalizeBelongsToValue(value)
  }

  const applyResourceScope = (query) => {
    return query
      .where(canonical.tenantColumn, descriptor.tenant)
      .where(canonical.resourceColumn, descriptor.resource)
  }

  return baseAdapter({
    knex,
    tableName: canonical.tableName,
    idColumn: 'id',
    translateColumn,
    translateFilterValue,
    applyResourceScope,
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
