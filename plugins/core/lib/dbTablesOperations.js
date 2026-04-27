/**
 * @file Creates Knex table definitions and migration plans from json-rest-schema definitions
 */

import { buildStorageInfo } from './storage/storage-mapping.js'

const MYSQL_DIALECT_PATTERN = /mysql/i

function normalizeText (value) {
  if (value == null) return ''
  return String(value).trim()
}

function quoteJsString (value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')

  return `'${escaped}'`
}

function formatArrayLiteral (values = []) {
  return `[${values.map((value) => quoteJsString(value)).join(', ')}]`
}

function formatPlainObjectLiteral (value) {
  const entries = Object.entries(value).map(([key, entryValue]) => {
    return `${JSON.stringify(key)}: ${formatCodeLiteral(entryValue)}`
  })

  return `{ ${entries.join(', ')} }`
}

function formatCodeLiteral (value) {
  if (value === undefined) {
    throw new Error('Cannot generate a migration literal from undefined.')
  }

  if (typeof value === 'function') {
    throw new Error('Cannot generate deterministic migrations for function defaults.')
  }

  if (typeof value === 'string') {
    return quoteJsString(value)
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatCodeLiteral(entry)).join(', ')}]`
  }

  if (typeof value === 'object') {
    return formatPlainObjectLiteral(value)
  }

  return JSON.stringify(value)
}

function detectKnexDialect (knex) {
  return normalizeText(
    knex?.client?.config?.client ||
    knex?.client?.dialect ||
    knex?.client?.driverName
  ).toLowerCase()
}

function isMysqlDialect (dialect = '') {
  return MYSQL_DIALECT_PATTERN.test(String(dialect || ''))
}

function ensureStringArray (value, label) {
  const values = Array.isArray(value) ? value : [value]
  const normalized = values
    .map((entry) => normalizeText(entry))
    .filter(Boolean)

  if (normalized.length < 1) {
    throw new Error(`${label} must define at least one column.`)
  }

  return normalized
}

function buildSetColumnType (values = []) {
  const normalized = values.map((value) => normalizeText(value)).filter(Boolean)
  if (normalized.length < 1) {
    throw new Error('setValues must contain at least one value.')
  }

  return `set(${normalized.map((value) => quoteJsString(value)).join(', ')})`
}

function createTableBuilderContext (schemaStructure = {}, idColumn = 'id') {
  return {
    schemaStructure,
    idProperty: idColumn,
    storageInfo: buildStorageInfo({
      schemaStructure,
      idProperty: idColumn
    })
  }
}

function resolveFieldOrColumnName (tableContext, fieldOrColumn) {
  const normalized = normalizeText(fieldOrColumn)
  if (!normalized) return ''

  if (normalized === 'id') {
    return tableContext.storageInfo.idColumn
  }

  return tableContext.storageInfo.fields[normalized]?.column || normalized
}

function getColumnNameForDefinition (tableContext, fieldName) {
  return resolveFieldOrColumnName(tableContext, fieldName)
}

function normalizeTopLevelIndexes (schemaLike, tableName, tableContext) {
  const indexes = Array.isArray(schemaLike?.indexes) ? schemaLike.indexes : []

  return indexes.map((indexDef, indexPosition) => {
    if (!indexDef || typeof indexDef !== 'object' || Array.isArray(indexDef)) {
      throw new Error(`Index metadata for table '${tableName}' must be an object.`)
    }

    const columns = ensureStringArray(indexDef.columns, `Index ${indexPosition + 1}`)
      .map((column) => resolveFieldOrColumnName(tableContext, column))
    const unique = indexDef.unique === true
    const indexType = normalizeText(indexDef.indexType).toUpperCase()
    const name = normalizeText(indexDef.name) || `${unique ? 'uq' : 'idx'}_${tableName}_${columns.join('_')}`

    if (unique && indexType) {
      throw new Error(`Unique index '${name}' on table '${tableName}' cannot define indexType.`)
    }

    return {
      name,
      unique,
      columns,
      indexType
    }
  })
}

function normalizeFieldIndexes (schemaStructure, tableName, tableContext) {
  const indexes = []

  for (const [fieldName, definition] of Object.entries(schemaStructure)) {
    const columnName = getColumnNameForDefinition(tableContext, fieldName)

    if (definition.unique === true) {
      indexes.push({
        name: `uq_${tableName}_${columnName}`,
        unique: true,
        columns: [columnName],
        indexType: ''
      })
    }

    if (definition.index === true) {
      indexes.push({
        name: `idx_${tableName}_${columnName}`,
        unique: false,
        columns: [columnName],
        indexType: ''
      })
    }
  }

  return indexes
}

function normalizeTopLevelForeignKeys (schemaLike, tableName, tableContext) {
  const foreignKeys = Array.isArray(schemaLike?.foreignKeys) ? schemaLike.foreignKeys : []

  return foreignKeys.map((foreignKeyDef, foreignKeyPosition) => {
    if (!foreignKeyDef || typeof foreignKeyDef !== 'object' || Array.isArray(foreignKeyDef)) {
      throw new Error(`Foreign key metadata for table '${tableName}' must be an object.`)
    }

    const columns = ensureStringArray(foreignKeyDef.columns, `Foreign key ${foreignKeyPosition + 1}`)
      .map((column) => resolveFieldOrColumnName(tableContext, column))
    const referencedTableName = normalizeText(
      foreignKeyDef.referencedTableName ||
      foreignKeyDef.table ||
      foreignKeyDef.references?.table
    )

    if (!referencedTableName) {
      throw new Error(`Foreign key ${foreignKeyPosition + 1} on table '${tableName}' requires referencedTableName.`)
    }

    const referencedColumns = ensureStringArray(
      foreignKeyDef.referencedColumns ||
      foreignKeyDef.references?.columns ||
      foreignKeyDef.references?.column ||
      'id',
      `Foreign key ${foreignKeyPosition + 1}`
    )
    const name = normalizeText(foreignKeyDef.name) || `${tableName}_${columns.join('_')}_foreign`

    return {
      name,
      columns,
      referencedTableName,
      referencedColumns,
      deleteRule: normalizeText(foreignKeyDef.deleteRule || foreignKeyDef.onDelete).toUpperCase(),
      updateRule: normalizeText(foreignKeyDef.updateRule || foreignKeyDef.onUpdate).toUpperCase()
    }
  })
}

function normalizeFieldForeignKeys (schemaStructure, tableName, tableContext) {
  const foreignKeys = []

  for (const [fieldName, definition] of Object.entries(schemaStructure)) {
    if (!definition.references) continue

    const columnName = getColumnNameForDefinition(tableContext, fieldName)
    foreignKeys.push({
      name: normalizeText(definition.references.name) || `${tableName}_${columnName}_foreign`,
      columns: [columnName],
      referencedTableName: normalizeText(definition.references.table),
      referencedColumns: [normalizeText(definition.references.column || 'id')],
      deleteRule: normalizeText(definition.references.onDelete).toUpperCase(),
      updateRule: normalizeText(definition.references.onUpdate).toUpperCase()
    })
  }

  return foreignKeys
}

function normalizeCheckConstraints (schemaLike, tableName) {
  const constraints = Array.isArray(schemaLike?.checkConstraints) ? schemaLike.checkConstraints : []

  return constraints.map((constraintDef, constraintIndex) => {
    if (!constraintDef || typeof constraintDef !== 'object' || Array.isArray(constraintDef)) {
      throw new Error(`Check constraint metadata for table '${tableName}' must be an object.`)
    }

    const clause = normalizeText(constraintDef.clause)
    if (!clause) {
      throw new Error(`Check constraint ${constraintIndex + 1} on table '${tableName}' requires a clause.`)
    }

    return {
      name: normalizeText(constraintDef.name) || `${tableName}_check_${constraintIndex + 1}`,
      clause
    }
  })
}

function dedupeBySignature (entries, signatureFn, sortFn) {
  const deduped = new Map()

  for (const entry of entries) {
    deduped.set(signatureFn(entry), entry)
  }

  return [...deduped.values()].sort(sortFn)
}

function compareByName (left, right) {
  return left.name.localeCompare(right.name)
}

function normalizeColumnShape (definition = {}) {
  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return 'enum'
  }
  if (Array.isArray(definition.setValues) && definition.setValues.length > 0) {
    return 'set'
  }

  switch (definition.type) {
    case 'id':
      return 'integer'
    case 'number':
      return definition.precision !== undefined && definition.scale !== undefined ? 'decimal' : 'float'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'dateTime':
      return 'datetime'
    case 'time':
      return 'time'
    case 'timestamp':
      return 'integer'
    case 'array':
    case 'object':
    case 'serialize':
      return 'json'
    case 'blob':
    case 'file':
      return 'binary'
    case 'string':
    case 'none':
    default:
      return 'string'
  }
}

function normalizeDesiredTypeKind (definition = {}) {
  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return 'string'
  }
  if (Array.isArray(definition.setValues) && definition.setValues.length > 0) {
    return 'string'
  }

  switch (definition.type) {
    case 'id':
      return 'integer'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'dateTime':
      return 'datetime'
    case 'time':
      return 'time'
    case 'array':
    case 'object':
    case 'serialize':
      return 'json'
    case 'blob':
    case 'file':
      return 'binary'
    case 'timestamp':
      return 'integer'
    case 'string':
    case 'none':
    default:
      return 'string'
  }
}

function normalizeComparableDefault (value) {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value === null) return null
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function normalizeDesiredColumn (tableContext, fieldName, definition, options = {}) {
  const nullable = definition.nullable === true
    ? true
    : !(definition.required === true || definition.nullable === false)
  const shape = normalizeColumnShape(definition)

  return {
    fieldName,
    name: getColumnNameForDefinition(tableContext, fieldName),
    definition,
    shape,
    typeKind: normalizeDesiredTypeKind(definition),
    nullable,
    required: definition.required === true,
    hasDefault: definition.defaultTo !== undefined,
    defaultValue: normalizeComparableDefault(definition.defaultTo),
    unsigned: definition.type === 'id' ? definition.unsigned !== false : definition.unsigned === true,
    maxLength: definition.maxLength ?? null,
    numericPrecision: definition.precision ?? null,
    numericScale: definition.scale ?? null,
    datetimePrecision: definition.temporalPrecision ?? null,
    enumValues: Array.isArray(definition.enum) ? definition.enum.map((value) => String(value)) : [],
    setValues: Array.isArray(definition.setValues) ? definition.setValues.map((value) => String(value)) : [],
    autoIncrement: options.autoIncrement === true
  }
}

function buildImplicitIdDefinition (idColumn) {
  return {
    type: 'id',
    primary: true,
    storage: {
      column: idColumn
    }
  }
}

function resolveTableSchemaContext (schemaLike, options = {}) {
  const schemaStructure = schemaLike?.structure || schemaLike || {}
  const configuredIdColumn = options.idProperty || schemaStructure.id?.storage?.column || 'id'
  const tableContext = createTableBuilderContext(schemaStructure, configuredIdColumn)

  let resourceIdField = null
  for (const [fieldName, definition] of Object.entries(schemaStructure)) {
    if (definition?.type !== 'id') continue
    const columnName = getColumnNameForDefinition(tableContext, fieldName)
    if (columnName === configuredIdColumn) {
      resourceIdField = fieldName
      break
    }
  }

  const implicitIndexes = normalizeFieldIndexes(schemaStructure, options.tableName || 'table', tableContext)
  const explicitIndexes = normalizeTopLevelIndexes(schemaLike, options.tableName || 'table', tableContext)
  const implicitForeignKeys = normalizeFieldForeignKeys(schemaStructure, options.tableName || 'table', tableContext)
  const explicitForeignKeys = normalizeTopLevelForeignKeys(schemaLike, options.tableName || 'table', tableContext)
  const checkConstraints = normalizeCheckConstraints(schemaLike, options.tableName || 'table')

  return {
    schemaStructure,
    idColumn: configuredIdColumn,
    resourceIdField,
    hasPrimaryIdField: resourceIdField
      ? schemaStructure[resourceIdField]?.primary === true
      : false,
    tableContext,
    indexes: dedupeBySignature(
      [...implicitIndexes, ...explicitIndexes],
      (entry) => `${entry.name}|${entry.unique ? 'unique' : 'index'}|${entry.columns.join(',')}`,
      compareByName
    ),
    foreignKeys: dedupeBySignature(
      [...implicitForeignKeys, ...explicitForeignKeys],
      (entry) => `${entry.name}|${entry.columns.join(',')}|${entry.referencedTableName}|${entry.referencedColumns.join(',')}`,
      compareByName
    ),
    checkConstraints: dedupeBySignature(
      checkConstraints,
      (entry) => `${entry.name}|${entry.clause}`,
      compareByName
    )
  }
}

function mapTypeToKnex (table, columnName, definition, options = {}) {
  const {
    precision,
    scale,
    maxLength,
    unsigned,
    temporalPrecision
  } = definition
  const enumValues = Array.isArray(definition.enum) ? definition.enum : []
  const setValues = Array.isArray(definition.setValues) ? definition.setValues : []
  const dialect = normalizeText(options.dialect).toLowerCase()

  if (setValues.length > 0) {
    if (!isMysqlDialect(dialect)) {
      throw new Error(`Field '${columnName}' uses setValues, which requires a MySQL-compatible knex client.`)
    }
    return table.specificType(columnName, buildSetColumnType(setValues))
  }

  switch (definition.type) {
    case 'string':
      if (enumValues.length > 0) {
        return table.enu(columnName, enumValues)
      }
      return maxLength ? table.string(columnName, maxLength) : table.string(columnName)

    case 'number':
      if (precision !== undefined && scale !== undefined) {
        return table.decimal(columnName, precision, scale)
      }
      return table.float(columnName)

    case 'id': {
      const col = table.integer(columnName)
      return unsigned !== false ? col.unsigned() : col
    }

    case 'boolean':
      return table.boolean(columnName)

    case 'date':
      return table.date(columnName)

    case 'dateTime':
      return temporalPrecision != null
        ? table.datetime(columnName, { precision: temporalPrecision })
        : table.datetime(columnName)

    case 'time':
      return temporalPrecision != null
        ? table.time(columnName, { precision: temporalPrecision })
        : table.time(columnName)

    case 'timestamp':
      return table.integer(columnName)

    case 'array':
    case 'object':
    case 'serialize':
      return table.json(columnName)

    case 'blob':
    case 'file':
      return table.binary(columnName)

    case 'none':
    default:
      return table.string(columnName)
  }
}

function applyColumnConstraints (column, definition) {
  if (definition.nullable === true) {
    column.nullable()
  } else if (definition.required === true || definition.nullable === false) {
    column.notNullable()
  }

  if (definition.defaultTo !== undefined) {
    column.defaultTo(definition.defaultTo)
  }

  if (definition.primary === true) {
    column.primary()
  }

  if (definition.comment) {
    column.comment(definition.comment)
  }
}

function applyTableMetadata (table, tableSchemaContext) {
  for (const index of tableSchemaContext.indexes) {
    if (index.unique) {
      table.unique(index.columns, index.name)
      continue
    }

    const indexOptions = index.indexType
      ? { indexType: index.indexType }
      : undefined
    table.index(index.columns, index.name, indexOptions)
  }

  for (const foreignKey of tableSchemaContext.foreignKeys) {
    const reference = table.foreign(foreignKey.columns, foreignKey.name)
      .references(foreignKey.referencedColumns)
      .inTable(foreignKey.referencedTableName)

    if (foreignKey.deleteRule) {
      reference.onDelete(foreignKey.deleteRule)
    }

    if (foreignKey.updateRule) {
      reference.onUpdate(foreignKey.updateRule)
    }
  }

  for (const constraint of tableSchemaContext.checkConstraints) {
    table.check(constraint.clause, [], constraint.name)
  }
}

function buildColumnBuilderCode (columnName, definition, options = {}) {
  const dialect = normalizeText(options.dialect).toLowerCase()
  const enumValues = Array.isArray(definition.enum) ? definition.enum : []
  const setValues = Array.isArray(definition.setValues) ? definition.setValues : []
  let line = ''

  if (setValues.length > 0) {
    if (dialect && !isMysqlDialect(dialect)) {
      throw new Error(`Field '${columnName}' uses setValues, which requires a MySQL-compatible migration target.`)
    }
    line = `table.specificType(${quoteJsString(columnName)}, ${quoteJsString(buildSetColumnType(setValues))})`
  } else {
    switch (definition.type) {
      case 'string':
        if (enumValues.length > 0) {
          line = `table.enu(${quoteJsString(columnName)}, ${formatArrayLiteral(enumValues)})`
        } else {
          line = definition.maxLength
            ? `table.string(${quoteJsString(columnName)}, ${definition.maxLength})`
            : `table.string(${quoteJsString(columnName)})`
        }
        break

      case 'number':
        if (definition.precision !== undefined && definition.scale !== undefined) {
          line = `table.decimal(${quoteJsString(columnName)}, ${definition.precision}, ${definition.scale})`
        } else {
          line = `table.float(${quoteJsString(columnName)})`
        }
        break

      case 'id':
        line = `table.integer(${quoteJsString(columnName)})`
        if (definition.unsigned !== false) {
          line += '.unsigned()'
        }
        break

      case 'boolean':
        line = `table.boolean(${quoteJsString(columnName)})`
        break

      case 'date':
        line = `table.date(${quoteJsString(columnName)})`
        break

      case 'dateTime':
        if (definition.temporalPrecision != null) {
          line = `table.datetime(${quoteJsString(columnName)}, { precision: ${definition.temporalPrecision} })`
        } else {
          line = `table.datetime(${quoteJsString(columnName)})`
        }
        break

      case 'time':
        if (definition.temporalPrecision != null) {
          line = `table.time(${quoteJsString(columnName)}, { precision: ${definition.temporalPrecision} })`
        } else {
          line = `table.time(${quoteJsString(columnName)})`
        }
        break

      case 'timestamp':
        line = `table.integer(${quoteJsString(columnName)})`
        break

      case 'array':
      case 'object':
      case 'serialize':
        line = `table.json(${quoteJsString(columnName)})`
        break

      case 'blob':
      case 'file':
        line = `table.binary(${quoteJsString(columnName)})`
        break

      case 'none':
      default:
        line = `table.string(${quoteJsString(columnName)})`
    }
  }

  if (definition.nullable === true) {
    line += '.nullable()'
  } else if (definition.required === true || definition.nullable === false) {
    line += '.notNullable()'
  }

  if (definition.defaultTo !== undefined) {
    line += `.defaultTo(${formatCodeLiteral(definition.defaultTo)})`
  }

  if (definition.primary === true && options.includePrimary !== false) {
    line += '.primary()'
  }

  if (definition.comment) {
    line += `.comment(${quoteJsString(definition.comment)})`
  }

  if (options.alter === true) {
    line += '.alter()'
  }

  return line
}

function buildIndexLine (index) {
  if (index.unique) {
    return `table.unique(${formatCodeLiteral(index.columns)}, ${quoteJsString(index.name)})`
  }

  if (index.indexType) {
    return `table.index(${formatCodeLiteral(index.columns)}, ${quoteJsString(index.name)}, ${formatCodeLiteral({ indexType: index.indexType })})`
  }

  return `table.index(${formatCodeLiteral(index.columns)}, ${quoteJsString(index.name)})`
}

function buildForeignKeyLine (foreignKey) {
  let line = `table.foreign(${formatCodeLiteral(foreignKey.columns)}, ${quoteJsString(foreignKey.name)})`
  line += `.references(${formatCodeLiteral(foreignKey.referencedColumns)})`
  line += `.inTable(${quoteJsString(foreignKey.referencedTableName)})`

  if (foreignKey.deleteRule) {
    line += `.onDelete(${quoteJsString(foreignKey.deleteRule)})`
  }

  if (foreignKey.updateRule) {
    line += `.onUpdate(${quoteJsString(foreignKey.updateRule)})`
  }

  return line
}

function buildCheckConstraintLine (constraint) {
  return `table.check(${quoteJsString(constraint.clause)}, [], ${quoteJsString(constraint.name)})`
}

function buildDesiredColumnsMap (tableSchemaContext, options = {}) {
  const desiredColumns = new Map()

  if (!tableSchemaContext.hasPrimaryIdField && options.autoIncrement === true) {
    const implicitIdDefinition = buildImplicitIdDefinition(tableSchemaContext.idColumn)
    desiredColumns.set(
      tableSchemaContext.idColumn,
      normalizeDesiredColumn(
        createTableBuilderContext({ id: implicitIdDefinition }, tableSchemaContext.idColumn),
        'id',
        implicitIdDefinition,
        { autoIncrement: true }
      )
    )
  }

  for (const [fieldName, definition] of Object.entries(tableSchemaContext.schemaStructure)) {
    if (fieldName === tableSchemaContext.resourceIdField && !tableSchemaContext.hasPrimaryIdField && options.autoIncrement === true) {
      continue
    }

    desiredColumns.set(
      getColumnNameForDefinition(tableSchemaContext.tableContext, fieldName),
      normalizeDesiredColumn(tableSchemaContext.tableContext, fieldName, definition)
    )
  }

  return desiredColumns
}

function valuesEqual (left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeSnapshotDefaultValue (column = {}) {
  if (!column.hasDefault) return undefined
  return normalizeComparableDefault(column.defaultValue)
}

function collectDestructiveColumnWarnings (currentColumn, desiredColumn) {
  const warnings = []
  const columnName = desiredColumn.name

  if (currentColumn.nullable === true && desiredColumn.nullable === false) {
    warnings.push(`Column '${columnName}' changes from nullable to not-null and may fail on existing rows.`)
  }

  if (
    currentColumn.maxLength != null &&
    desiredColumn.maxLength != null &&
    desiredColumn.maxLength < currentColumn.maxLength
  ) {
    warnings.push(`Column '${columnName}' reduces maxLength from ${currentColumn.maxLength} to ${desiredColumn.maxLength}.`)
  }

  if (
    currentColumn.numericPrecision != null &&
    desiredColumn.numericPrecision != null &&
    desiredColumn.numericPrecision < currentColumn.numericPrecision
  ) {
    warnings.push(`Column '${columnName}' reduces numeric precision from ${currentColumn.numericPrecision} to ${desiredColumn.numericPrecision}.`)
  }

  if (
    currentColumn.numericScale != null &&
    desiredColumn.numericScale != null &&
    desiredColumn.numericScale < currentColumn.numericScale
  ) {
    warnings.push(`Column '${columnName}' reduces numeric scale from ${currentColumn.numericScale} to ${desiredColumn.numericScale}.`)
  }

  if (!valuesEqual(currentColumn.enumValues || [], desiredColumn.enumValues || [])) {
    warnings.push(`Column '${columnName}' changes enum values and may invalidate existing data.`)
  }

  if (!valuesEqual(currentColumn.setValues || [], desiredColumn.setValues || [])) {
    warnings.push(`Column '${columnName}' changes setValues and may invalidate existing data.`)
  }

  if (normalizeText(currentColumn.typeKind) !== normalizeText(desiredColumn.typeKind)) {
    warnings.push(`Column '${columnName}' changes type semantics from '${currentColumn.typeKind}' to '${desiredColumn.typeKind}'.`)
  }

  return warnings
}

function columnNeedsAlter (currentColumn, desiredColumn, options = {}) {
  const currentNumericShape = (() => {
    const dataType = normalizeText(currentColumn.dataType)
    if (dataType === 'decimal' || dataType === 'numeric') return 'decimal'
    if (dataType === 'float' || dataType === 'double' || dataType === 'real') return 'float'
    return ''
  })()
  const compareUnsigned = isMysqlDialect(normalizeText(options.dialect).toLowerCase())

  return (
    normalizeText(currentColumn.typeKind) !== normalizeText(desiredColumn.typeKind) ||
    (desiredColumn.typeKind === 'number' && currentNumericShape && currentNumericShape !== normalizeText(desiredColumn.shape)) ||
    Boolean(currentColumn.nullable) !== Boolean(desiredColumn.nullable) ||
    (compareUnsigned && Boolean(currentColumn.unsigned) !== Boolean(desiredColumn.unsigned)) ||
    (currentColumn.maxLength ?? null) !== (desiredColumn.maxLength ?? null) ||
    (currentColumn.numericPrecision ?? null) !== (desiredColumn.numericPrecision ?? null) ||
    (currentColumn.numericScale ?? null) !== (desiredColumn.numericScale ?? null) ||
    normalizeSnapshotDefaultValue(currentColumn) !== desiredColumn.defaultValue ||
    Boolean(currentColumn.hasDefault) !== Boolean(desiredColumn.hasDefault) ||
    !valuesEqual(currentColumn.enumValues || [], desiredColumn.enumValues || []) ||
    !valuesEqual(currentColumn.setValues || [], desiredColumn.setValues || [])
  )
}

function mapByName (entries = []) {
  return new Map((entries || []).map((entry) => [entry.name, entry]))
}

function createEmptyDiffPlan () {
  return {
    addColumns: [],
    alterColumns: [],
    dropColumns: [],
    addIndexes: [],
    dropIndexes: [],
    addForeignKeys: [],
    dropForeignKeys: [],
    addCheckConstraints: [],
    warnings: []
  }
}

function assertNoTopLevelTableMetadata (schemaLike, helperName) {
  const metadataKeys = ['indexes', 'foreignKeys', 'checkConstraints']

  for (const key of metadataKeys) {
    if (Array.isArray(schemaLike?.[key]) && schemaLike[key].length > 0) {
      throw new Error(`${helperName} does not accept top-level ${key}. Use createKnexTable(), generateKnexMigration(), or generateKnexMigrationDiff() for table metadata.`)
    }
  }
}

function buildUnsupportedConstraintWarning (constraintType, name, dialect) {
  return `Skipping ${constraintType} '${name}' because automatic ALTER support is not available for dialect '${dialect || 'unknown'}'.`
}

function isSqliteDialectName (dialect = '') {
  return String(dialect || '').toLowerCase().includes('sqlite')
}

function normalizeConstraintClause (clause = '') {
  return normalizeText(clause)
    .replace(/[`"]/g, '')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function isInlineEnumCheckConstraint (currentCheck = {}, desiredColumn = {}) {
  if (!desiredColumn.enumValues || desiredColumn.enumValues.length < 1) {
    return false
  }

  const expectedClause = `${desiredColumn.name} in (${desiredColumn.enumValues.map((value) => quoteJsString(value)).join(', ')})`
  return normalizeConstraintClause(currentCheck.clause) === normalizeConstraintClause(expectedClause)
}

/**
 * Creates a Knex table from a json-rest-schema definition
 * @param {object} knex - The Knex instance
 * @param {object} schemaInfo - Resource schema metadata
 * @param {object} tableSchemaInstance - The json-rest-schema instance or schema-like table metadata object
 * @param {object} [options={}] - Additional options
 * @param {boolean} [options.autoIncrement=true] - Whether to use auto-incrementing IDs
 * @param {boolean} [options.timestamps=false] - Whether to add created_at/updated_at columns
 * @returns {Promise} A promise that resolves when the table is created
 */
export async function createKnexTable (knex, schemaInfo, tableSchemaInstance, options = {}) {
  const { autoIncrement = true, timestamps = false } = options
  const tableName = schemaInfo.tableName
  const dialect = detectKnexDialect(knex)
  const tableSchemaContext = resolveTableSchemaContext(tableSchemaInstance, {
    idProperty: schemaInfo.idProperty,
    tableName
  })

  return knex.schema.createTable(tableName, (table) => {
    if (!tableSchemaContext.hasPrimaryIdField && autoIncrement) {
      table.increments(tableSchemaContext.idColumn).primary()
    }

    for (const [fieldName, definition] of Object.entries(tableSchemaContext.schemaStructure)) {
      if (fieldName === tableSchemaContext.resourceIdField && !tableSchemaContext.hasPrimaryIdField && autoIncrement) {
        continue
      }

      const columnName = getColumnNameForDefinition(tableSchemaContext.tableContext, fieldName)
      const column = mapTypeToKnex(table, columnName, definition, { dialect })
      applyColumnConstraints(column, definition)
    }

    applyTableMetadata(table, tableSchemaContext)

    if (timestamps) {
      table.timestamps(true, true)
    }
  })
}

export async function addKnexFields (knex, tableName, schema, options = {}) {
  assertNoTopLevelTableMetadata(schema, 'addKnexFields')
  const dialect = detectKnexDialect(knex)
  const tableSchemaContext = resolveTableSchemaContext(schema, {
    ...options,
    tableName
  })

  return knex.schema.alterTable(tableName, (table) => {
    for (const [fieldName, definition] of Object.entries(tableSchemaContext.schemaStructure)) {
      const columnName = getColumnNameForDefinition(tableSchemaContext.tableContext, fieldName)
      const column = mapTypeToKnex(table, columnName, definition, { dialect })
      applyColumnConstraints(column, definition)
    }
  })
}

// Helper function to alter multiple fields in an existing table
export async function alterKnexFields (knex, tableName, fields, options = {}) {
  assertNoTopLevelTableMetadata(fields, 'alterKnexFields')
  const dialect = detectKnexDialect(knex)
  const tableSchemaContext = resolveTableSchemaContext(fields, {
    ...options,
    tableName
  })

  return knex.schema.alterTable(tableName, (table) => {
    for (const [fieldName, definition] of Object.entries(tableSchemaContext.schemaStructure)) {
      const columnName = getColumnNameForDefinition(tableSchemaContext.tableContext, fieldName)
      const column = mapTypeToKnex(table, columnName, definition, { dialect })
      column.alter()
      applyColumnConstraints(column, definition)
    }
  })
}

/**
 * Generates a Knex migration string from a json-rest-schema definition
 * @param {string} tableName - The name of the table
 * @param {object} schema - The json-rest-schema instance or schema-like table metadata object
 * @param {object} [options={}] - Additional options
 * @returns {string} The migration code as a string
 */
export function generateKnexMigration (tableName, schema, options = {}) {
  const { autoIncrement = true, timestamps = false, dialect = '' } = options
  const tableSchemaContext = resolveTableSchemaContext(schema, {
    ...options,
    tableName
  })

  const lines = []

  if (!tableSchemaContext.hasPrimaryIdField && autoIncrement) {
    lines.push(`table.increments(${quoteJsString(tableSchemaContext.idColumn)}).primary()`)
  }

  for (const [fieldName, definition] of Object.entries(tableSchemaContext.schemaStructure)) {
    if (fieldName === tableSchemaContext.resourceIdField && !tableSchemaContext.hasPrimaryIdField && autoIncrement) {
      continue
    }

    const columnName = getColumnNameForDefinition(tableSchemaContext.tableContext, fieldName)
    lines.push(buildColumnBuilderCode(columnName, definition, {
      dialect
    }))
  }

  for (const index of tableSchemaContext.indexes) {
    lines.push(buildIndexLine(index))
  }

  for (const foreignKey of tableSchemaContext.foreignKeys) {
    lines.push(buildForeignKeyLine(foreignKey))
  }

  for (const checkConstraint of tableSchemaContext.checkConstraints) {
    lines.push(buildCheckConstraintLine(checkConstraint))
  }

  if (timestamps) {
    lines.push('table.timestamps(true, true)')
  }

  return `exports.up = function(knex) {
  return knex.schema.createTable(${quoteJsString(tableName)}, (table) => {
${lines.map((line) => `    ${line};`).join('\n')}
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable(${quoteJsString(tableName)});
};`
}

/**
 * Generates a deterministic Knex alter migration by diffing a live table snapshot against a desired schema.
 * @param {string} tableName - The table name being diffed
 * @param {object} currentSnapshot - The normalized table snapshot returned by introspection
 * @param {object} schema - The desired schema-like table metadata object
 * @param {object} [options={}] - Diff options
 * @param {boolean} [options.autoIncrement=true] - Whether the resource expects an implicit auto-increment id column
 * @param {boolean} [options.allowDropColumns=false] - Whether removed columns should be dropped automatically
 * @param {string} [options.dialect=''] - Optional target dialect override
 * @returns {{ migration: string, warnings: string[], plan: object }} Diff result
 */
export function generateKnexMigrationDiff (tableName, currentSnapshot, schema, options = {}) {
  const {
    autoIncrement = true,
    allowDropColumns = false,
    dialect = ''
  } = options
  const resolvedDialect = normalizeText(dialect || currentSnapshot?.dialect).toLowerCase()
  const tableSchemaContext = resolveTableSchemaContext(schema, {
    ...options,
    tableName
  })
  const desiredColumns = buildDesiredColumnsMap(tableSchemaContext, { autoIncrement })
  const currentColumns = mapByName(currentSnapshot?.columns || [])
  const desiredIndexes = mapByName(tableSchemaContext.indexes)
  const currentIndexes = mapByName(currentSnapshot?.indexes || [])
  const desiredForeignKeys = mapByName(tableSchemaContext.foreignKeys)
  const currentForeignKeys = mapByName(currentSnapshot?.foreignKeys || [])
  const desiredChecks = mapByName(tableSchemaContext.checkConstraints)
  const currentChecks = mapByName(currentSnapshot?.checkConstraints || [])
  const plan = createEmptyDiffPlan()

  for (const [columnName, desiredColumn] of desiredColumns.entries()) {
    const currentColumn = currentColumns.get(columnName)

    if (!currentColumn) {
      if (desiredColumn.autoIncrement) {
        plan.warnings.push(`Skipping implicit auto-increment id column '${columnName}' because it cannot be added safely to an existing table.`)
        continue
      }

      if (desiredColumn.setValues.length > 0 && !isMysqlDialect(resolvedDialect)) {
        plan.warnings.push(`Skipping setValues column '${columnName}' because it requires a MySQL-compatible ALTER target.`)
        continue
      }

      plan.addColumns.push(desiredColumn)
      continue
    }

    if (desiredColumn.autoIncrement) {
      continue
    }

    if (!columnNeedsAlter(currentColumn, desiredColumn, { dialect: resolvedDialect })) {
      continue
    }

    if (desiredColumn.setValues.length > 0 && !isMysqlDialect(resolvedDialect)) {
      plan.warnings.push(`Skipping setValues alteration for column '${columnName}' because it requires a MySQL-compatible ALTER target.`)
      continue
    }

    plan.alterColumns.push(desiredColumn)
    plan.warnings.push(...collectDestructiveColumnWarnings(currentColumn, desiredColumn))
  }

  for (const currentColumn of currentColumns.values()) {
    if (desiredColumns.has(currentColumn.name)) {
      continue
    }

    const warning = `Column '${currentColumn.name}' exists in the live table but not in the desired schema.`
    if (allowDropColumns) {
      plan.dropColumns.push(currentColumn)
      plan.warnings.push(`${warning} It will be dropped because allowDropColumns=true.`)
    } else {
      plan.warnings.push(`${warning} Skipping automatic drop.`)
    }
  }

  for (const desiredIndex of desiredIndexes.values()) {
    const currentIndex = currentIndexes.get(desiredIndex.name)
    const sameIndexType = normalizeText(currentIndex?.indexType).toUpperCase() === desiredIndex.indexType
    const indexChanged = Boolean(currentIndex) && (
      !valuesEqual(currentIndex.columns, desiredIndex.columns) ||
      Boolean(currentIndex.unique) !== Boolean(desiredIndex.unique) ||
      !sameIndexType
    )

    if (!currentIndex || indexChanged) {
      plan.addIndexes.push(desiredIndex)
      if (indexChanged) {
        plan.dropIndexes.push(currentIndex)
      }
    }
  }

  for (const currentIndex of currentIndexes.values()) {
    if (!desiredIndexes.has(currentIndex.name)) {
      plan.dropIndexes.push(currentIndex)
    }
  }

  for (const desiredForeignKey of desiredForeignKeys.values()) {
    const currentForeignKey = currentForeignKeys.get(desiredForeignKey.name)
    const sameColumns = valuesEqual(
      (currentForeignKey?.columns || []).map((entry) => entry.name),
      desiredForeignKey.columns
    )
    const sameReferencedColumns = valuesEqual(
      (currentForeignKey?.columns || []).map((entry) => entry.referencedName),
      desiredForeignKey.referencedColumns
    )
    const sameTable = normalizeText(currentForeignKey?.referencedTableName) === desiredForeignKey.referencedTableName
    const sameDeleteRule = normalizeText(currentForeignKey?.deleteRule).toUpperCase() === desiredForeignKey.deleteRule
    const sameUpdateRule = normalizeText(currentForeignKey?.updateRule).toUpperCase() === desiredForeignKey.updateRule

    if (!currentForeignKey || !sameColumns || !sameReferencedColumns || !sameTable || !sameDeleteRule || !sameUpdateRule) {
      plan.addForeignKeys.push(desiredForeignKey)
    }
  }

  for (const currentForeignKey of currentForeignKeys.values()) {
    if (!desiredForeignKeys.has(currentForeignKey.name)) {
      plan.dropForeignKeys.push(currentForeignKey)
    }
  }

  for (const desiredCheck of desiredChecks.values()) {
    const currentCheck = currentChecks.get(desiredCheck.name)
    if (currentCheck?.clause === desiredCheck.clause) {
      continue
    }

    if (isSqliteDialectName(resolvedDialect)) {
      plan.warnings.push(buildUnsupportedConstraintWarning('check constraint', desiredCheck.name, resolvedDialect))
      continue
    }

    plan.addCheckConstraints.push(desiredCheck)
  }

  for (const currentCheck of currentChecks.values()) {
    const matchesDesiredEnum = [...desiredColumns.values()].some((desiredColumn) => {
      return isInlineEnumCheckConstraint(currentCheck, desiredColumn)
    })
    if (matchesDesiredEnum) {
      continue
    }

    if (!desiredChecks.has(currentCheck.name)) {
      plan.warnings.push(buildUnsupportedConstraintWarning('check constraint removal', currentCheck.name, resolvedDialect))
      continue
    }

    if (desiredChecks.get(currentCheck.name)?.clause !== currentCheck.clause) {
      plan.warnings.push(buildUnsupportedConstraintWarning('check constraint alteration', currentCheck.name, resolvedDialect))
    }
  }

  plan.addColumns.sort(compareByName)
  plan.alterColumns.sort(compareByName)
  plan.dropColumns.sort(compareByName)
  plan.addIndexes.sort(compareByName)
  plan.dropIndexes.sort(compareByName)
  plan.addForeignKeys.sort(compareByName)
  plan.dropForeignKeys.sort(compareByName)
  plan.addCheckConstraints.sort(compareByName)
  plan.warnings = [...new Set(plan.warnings)]

  const blocks = []

  const addOrAlterColumnLines = [
    ...plan.addColumns.map((column) => buildColumnBuilderCode(column.name, column.definition, { dialect: resolvedDialect })),
    ...plan.alterColumns.map((column) => buildColumnBuilderCode(column.name, column.definition, {
      dialect: resolvedDialect,
      alter: true,
      includePrimary: false
    }))
  ]

  if (plan.dropForeignKeys.length > 0) {
    blocks.push(`  await knex.schema.alterTable(${quoteJsString(tableName)}, (table) => {
${plan.dropForeignKeys.map((foreignKey) => `    table.dropForeign(${formatCodeLiteral(foreignKey.columns.map((entry) => entry.name))}, ${quoteJsString(foreignKey.name)});`).join('\n')}
  });`)
  }

  if (plan.dropIndexes.length > 0) {
    blocks.push(`  await knex.schema.alterTable(${quoteJsString(tableName)}, (table) => {
${plan.dropIndexes.map((index) => {
    if (index.unique) {
      return `    table.dropUnique(${formatCodeLiteral(index.columns)}, ${quoteJsString(index.name)});`
    }
    return `    table.dropIndex(${formatCodeLiteral(index.columns)}, ${quoteJsString(index.name)});`
  }).join('\n')}
  });`)
  }

  if (plan.dropColumns.length > 0) {
    blocks.push(`  await knex.schema.alterTable(${quoteJsString(tableName)}, (table) => {
${plan.dropColumns.map((column) => `    table.dropColumn(${quoteJsString(column.name)});`).join('\n')}
  });`)
  }

  if (addOrAlterColumnLines.length > 0) {
    blocks.push(`  await knex.schema.alterTable(${quoteJsString(tableName)}, (table) => {
${addOrAlterColumnLines.map((line) => `    ${line};`).join('\n')}
  });`)
  }

  const addConstraintLines = [
    ...plan.addIndexes.map((index) => buildIndexLine(index)),
    ...plan.addForeignKeys.map((foreignKey) => buildForeignKeyLine(foreignKey)),
    ...plan.addCheckConstraints.map((constraint) => buildCheckConstraintLine(constraint))
  ]

  if (addConstraintLines.length > 0) {
    blocks.push(`  await knex.schema.alterTable(${quoteJsString(tableName)}, (table) => {
${addConstraintLines.map((line) => `    ${line};`).join('\n')}
  });`)
  }

  const warningComment = plan.warnings.length > 0
    ? `  // Warnings:\n${plan.warnings.map((warning) => `  // - ${warning}`).join('\n')}\n`
    : ''

  return {
    migration: `exports.up = async function(knex) {
${warningComment}${blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '  return Promise.resolve();\n'}};

exports.down = async function() {
  throw new Error(${quoteJsString(`Down migration was not generated automatically for table '${tableName}'.`)});
};`,
    warnings: plan.warnings,
    plan
  }
}
