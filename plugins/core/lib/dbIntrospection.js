const TABLE_NAME_PATTERN = /^[A-Za-z0-9_]+$/
const MYSQL_BOOLEAN_TINYINT_PATTERN = /^tinyint\(1\)/i

function normalizeText (value) {
  if (value == null) return ''
  return String(value).trim()
}

function toCamelCase (value) {
  const source = normalizeText(value)
  if (!source) return ''

  return source.replace(/[_-]([a-z0-9])/gi, (_match, next) => next.toUpperCase())
}

function requireKnexRaw (knex) {
  if (!knex || typeof knex.raw !== 'function') {
    throw new TypeError('introspectKnexTableSnapshot requires knex with raw().')
  }
}

function requireTableName (value) {
  const tableName = normalizeText(value)
  if (!tableName) {
    throw new TypeError('introspectKnexTableSnapshot requires tableName.')
  }
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    throw new Error(`Invalid table name "${tableName}". Use letters, numbers, and underscore only.`)
  }

  return tableName
}

function detectDialect (knex) {
  const clientName = normalizeText(
    knex?.client?.config?.client ||
    knex?.client?.dialect ||
    knex?.client?.driverName
  ).toLowerCase()

  if (clientName.includes('sqlite')) {
    return 'sqlite'
  }
  if (clientName.includes('mysql')) {
    return 'mysql2'
  }

  throw new Error(`Unsupported knex client "${clientName || 'unknown'}" for introspectKnexTableSnapshot.`)
}

function normalizeRows (rawResult) {
  if (Array.isArray(rawResult)) {
    if (rawResult.length > 0 && Array.isArray(rawResult[0])) {
      return rawResult[0]
    }
    return rawResult
  }
  if (rawResult && typeof rawResult === 'object' && Array.isArray(rawResult.rows)) {
    return rawResult.rows
  }
  return []
}

function toNullableNumber (value) {
  if (value == null) return null
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeColumnDefault (value) {
  if (value == null) {
    return null
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text || text.toLowerCase() === 'null') {
      return null
    }
    if (text.startsWith("'") && text.endsWith("'")) {
      return text.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'")
    }
    if (text.startsWith('"') && text.endsWith('"')) {
      return text.slice(1, -1).replace(/""/g, '"')
    }
    return text
  }

  return value
}

function parseEnumLikeValues (columnType = '', typeName = 'enum') {
  const source = normalizeText(columnType)
  const normalizedType = `${String(typeName || '').toLowerCase()}(`
  if (!source.toLowerCase().startsWith(normalizedType) || !source.endsWith(')')) {
    return []
  }

  const body = source.slice(normalizedType.length, -1)
  const values = []
  const pattern = /'((?:''|\\'|[^'])*)'/g
  let match = null
  while ((match = pattern.exec(body)) != null) {
    values.push(match[1].replace(/''/g, "'").replace(/\\'/g, "'"))
  }

  return values
}

function resolveTypeKind ({ name = '', dataType = '', columnType = '' } = {}) {
  const normalizedType = normalizeText(dataType).toLowerCase()
  const normalizedColumnType = normalizeText(columnType).toLowerCase()

  if (
    normalizedType === 'varchar' ||
    normalizedType === 'char' ||
    normalizedType === 'text' ||
    normalizedType === 'tinytext' ||
    normalizedType === 'mediumtext' ||
    normalizedType === 'longtext' ||
    normalizedType === 'enum' ||
    normalizedType === 'set'
  ) {
    return 'string'
  }

  if (
    normalizedType === 'int' ||
    normalizedType === 'integer' ||
    normalizedType === 'smallint' ||
    normalizedType === 'mediumint' ||
    normalizedType === 'bigint'
  ) {
    return 'integer'
  }

  if (normalizedType === 'tinyint') {
    if (MYSQL_BOOLEAN_TINYINT_PATTERN.test(normalizedColumnType)) {
      return 'boolean'
    }
    return 'integer'
  }

  if (
    normalizedType === 'decimal' ||
    normalizedType === 'numeric' ||
    normalizedType === 'float' ||
    normalizedType === 'double' ||
    normalizedType === 'real'
  ) {
    return 'number'
  }

  if (normalizedType === 'boolean' || normalizedType === 'bool') {
    return 'boolean'
  }

  if (normalizedType === 'datetime' || normalizedType === 'timestamp') {
    return 'datetime'
  }
  if (normalizedType === 'date') {
    return 'date'
  }
  if (normalizedType === 'time') {
    return 'time'
  }
  if (normalizedType === 'json') {
    return 'json'
  }
  if (
    normalizedType === 'blob' ||
    normalizedType === 'binary' ||
    normalizedType === 'varbinary'
  ) {
    return 'binary'
  }

  throw new Error(`Unsupported column type "${normalizedType}" for column "${name}".`)
}

function buildColumnSnapshot ({
  name = '',
  dataType = '',
  columnType = '',
  nullable = false,
  defaultValue = null,
  extra = '',
  autoIncrement = false,
  unsigned = false,
  maxLength = null,
  numericPrecision = null,
  numericScale = null,
  datetimePrecision = null,
  characterSetName = '',
  collationName = '',
  ordinalPosition = null
} = {}) {
  const normalizedName = normalizeText(name)
  const normalizedDataType = normalizeText(dataType).toLowerCase()
  const normalizedColumnType = normalizeText(columnType)
  const normalizedDefaultValue = normalizeColumnDefault(defaultValue)

  return {
    name: normalizedName,
    key: toCamelCase(normalizedName),
    dataType: normalizedDataType,
    columnType: normalizedColumnType,
    extra: normalizeText(extra).toLowerCase(),
    typeKind: resolveTypeKind({
      name: normalizedName,
      dataType: normalizedDataType,
      columnType: normalizedColumnType
    }),
    nullable: Boolean(nullable),
    defaultValue: normalizedDefaultValue,
    hasDefault: normalizedDefaultValue != null,
    autoIncrement: Boolean(autoIncrement),
    unsigned: Boolean(unsigned),
    maxLength: toNullableNumber(maxLength),
    numericPrecision: toNullableNumber(numericPrecision),
    numericScale: toNullableNumber(numericScale),
    datetimePrecision: toNullableNumber(datetimePrecision),
    characterSetName: normalizeText(characterSetName),
    collationName: normalizeText(collationName),
    ordinalPosition: toNullableNumber(ordinalPosition),
    enumValues: parseEnumLikeValues(normalizedColumnType, 'enum'),
    setValues: parseEnumLikeValues(normalizedColumnType, 'set')
  }
}

function normalizePrimaryKeyColumns (rows = []) {
  return rows
    .map((row) => normalizeText(row.columnName || row.column_name || row.name))
    .filter(Boolean)
}

function normalizeIndexes (rows = []) {
  const byName = new Map()

  for (const row of Array.isArray(rows) ? rows : []) {
    const indexName = normalizeText(row.indexName || row.index_name || row.name)
    const columnName = normalizeText(row.columnName || row.column_name || row.name)
    if (!indexName || !columnName) {
      continue
    }

    const seqInIndex = toNullableNumber(row.seqInIndex ?? row.seq_in_index ?? row.seqno) || 0
    const nonUnique = Number(row.nonUnique ?? row.non_unique) === 1
    const existing = byName.get(indexName) || {
      name: indexName,
      unique: !nonUnique,
      indexType: normalizeText(row.indexType || row.index_type).toUpperCase(),
      columns: []
    }

    existing.columns.push({
      name: columnName,
      order: seqInIndex
    })
    byName.set(indexName, existing)
  }

  return [...byName.values()]
    .map((index) => ({
      name: index.name,
      unique: index.unique,
      indexType: index.indexType,
      columns: index.columns
        .sort((left, right) => left.order - right.order)
        .map((column) => column.name)
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeForeignKeys (rows = [], parsedForeignKeys = [], tableName = '') {
  const grouped = new Map()

  for (const row of Array.isArray(rows) ? rows : []) {
    const groupId = normalizeText(row.groupId ?? row.id ?? row.constraintName ?? row.constraint_name)
    const columnName = normalizeText(row.columnName || row.column_name || row.from)
    const referencedTableName = normalizeText(row.referencedTableName || row.referenced_table_name || row.table)
    const referencedColumnName = normalizeText(row.referencedColumnName || row.referenced_column_name || row.to)
    if (!groupId || !columnName || !referencedTableName || !referencedColumnName) {
      continue
    }

    const ordinalPosition = toNullableNumber(row.ordinalPosition ?? row.ordinal_position ?? row.seq) || 0
    const existing = grouped.get(groupId) || {
      groupId,
      name: normalizeText(row.constraintName || row.constraint_name),
      referencedTableName,
      updateRule: normalizeText(row.updateRule || row.update_rule || row.on_update).toUpperCase(),
      deleteRule: normalizeText(row.deleteRule || row.delete_rule || row.on_delete).toUpperCase(),
      columns: []
    }

    existing.columns.push({
      name: columnName,
      referencedName: referencedColumnName,
      order: ordinalPosition
    })
    grouped.set(groupId, existing)
  }

  const entries = [...grouped.values()]
    .sort((left, right) => String(left.groupId).localeCompare(String(right.groupId), undefined, { numeric: true }))
    .map((foreignKey, index) => {
      const normalizedColumns = foreignKey.columns
        .sort((left, right) => left.order - right.order)
        .map((column) => ({
          name: column.name,
          referencedName: column.referencedName
        }))

      const parsedMatch = parsedForeignKeys.find((parsed, parsedIndex) => {
        if (parsed._used) return false
        if (normalizeText(parsed.referencedTableName) !== foreignKey.referencedTableName) return false
        if ((parsed.columns || []).length !== normalizedColumns.length) return false

        return parsed.columns.every((column, columnIndex) => {
          const target = normalizedColumns[columnIndex]
          return target &&
            normalizeText(column.name) === target.name &&
            normalizeText(column.referencedName) === target.referencedName
        })
      }) || parsedForeignKeys[index] || null

      if (parsedMatch) {
        parsedMatch._used = true
      }

      return {
        name: normalizeText(parsedMatch?.name) || normalizeText(foreignKey.name) || `${tableName}_foreign_${index + 1}`,
        referencedTableName: foreignKey.referencedTableName,
        updateRule: foreignKey.updateRule,
        deleteRule: foreignKey.deleteRule,
        columns: normalizedColumns
      }
    })

  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeCheckConstraints (constraints = [], tableName = '') {
  return constraints
    .map((constraint, index) => {
      const name = normalizeText(constraint.name)
      const clause = normalizeText(constraint.clause)
      if (!clause) return null

      return {
        name: name || `${tableName}_check_${index + 1}`,
        clause
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name))
}

function requireIdColumn (columns, idColumn) {
  const normalizedIdColumn = normalizeText(idColumn) || 'id'
  const idSpec = columns.find((column) => column.name === normalizedIdColumn) || null
  if (!idSpec) {
    throw new Error(`Could not find id column "${normalizedIdColumn}" in table.`)
  }
  if (idSpec.typeKind !== 'integer') {
    throw new Error(`Id column "${normalizedIdColumn}" must use an integer type.`)
  }
  if (idSpec.nullable) {
    throw new Error(`Id column "${normalizedIdColumn}" must be not-null.`)
  }
  if (!idSpec.autoIncrement && !idSpec.hasDefault) {
    throw new Error(`Id column "${normalizedIdColumn}" must be auto-incrementing or have a database default.`)
  }

  return normalizedIdColumn
}

function requirePrimaryKeyContainsId (primaryKeyColumns, idColumn) {
  if (!Array.isArray(primaryKeyColumns) || !primaryKeyColumns.includes(idColumn)) {
    throw new Error(`Primary key must include id column "${idColumn}".`)
  }
  if (primaryKeyColumns.length !== 1 || primaryKeyColumns[0] !== idColumn) {
    throw new Error(`Composite primary keys are not supported. Primary key must be only "${idColumn}".`)
  }
}

function quoteSqliteIdentifier (identifier) {
  return `"${String(identifier || '').replace(/"/g, '""')}"`
}

function extractParenthesizedContent (source = '', openIndex = -1) {
  if (openIndex < 0 || source[openIndex] !== '(') {
    return null
  }

  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        index += 1
        continue
      }
      if (char === "'") inSingleQuote = false
      continue
    }
    if (inDoubleQuote) {
      if (char === '"' && next === '"') {
        index += 1
        continue
      }
      if (char === '"') inDoubleQuote = false
      continue
    }
    if (inBacktick) {
      if (char === '`') inBacktick = false
      continue
    }

    if (char === "'") {
      inSingleQuote = true
      continue
    }
    if (char === '"') {
      inDoubleQuote = true
      continue
    }
    if (char === '`') {
      inBacktick = true
      continue
    }

    if (char === '(') {
      depth += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth === 0) {
        return {
          content: source.slice(openIndex + 1, index),
          endIndex: index
        }
      }
    }
  }

  return null
}

function splitTopLevelSqlList (source = '') {
  const entries = []
  let buffer = ''
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (inSingleQuote) {
      buffer += char
      if (char === "'" && next === "'") {
        buffer += next
        index += 1
        continue
      }
      if (char === "'") inSingleQuote = false
      continue
    }
    if (inDoubleQuote) {
      buffer += char
      if (char === '"' && next === '"') {
        buffer += next
        index += 1
        continue
      }
      if (char === '"') inDoubleQuote = false
      continue
    }
    if (inBacktick) {
      buffer += char
      if (char === '`') inBacktick = false
      continue
    }

    if (char === "'") {
      inSingleQuote = true
      buffer += char
      continue
    }
    if (char === '"') {
      inDoubleQuote = true
      buffer += char
      continue
    }
    if (char === '`') {
      inBacktick = true
      buffer += char
      continue
    }

    if (char === '(') {
      depth += 1
      buffer += char
      continue
    }
    if (char === ')') {
      depth -= 1
      buffer += char
      continue
    }

    if (char === ',' && depth === 0) {
      const entry = buffer.trim()
      if (entry) entries.push(entry)
      buffer = ''
      continue
    }

    buffer += char
  }

  const finalEntry = buffer.trim()
  if (finalEntry) entries.push(finalEntry)

  return entries
}

function extractCreateTableEntries (tableSql = '') {
  const source = normalizeText(tableSql)
  const openIndex = source.indexOf('(')
  if (openIndex < 0) return []

  const body = extractParenthesizedContent(source, openIndex)
  if (!body?.content) return []

  return splitTopLevelSqlList(body.content)
}

function unquoteSqlIdentifier (value = '') {
  const source = normalizeText(value)
  if (!source) return ''
  if (
    (source.startsWith('"') && source.endsWith('"')) ||
    (source.startsWith('`') && source.endsWith('`')) ||
    (source.startsWith('[') && source.endsWith(']'))
  ) {
    return source.slice(1, -1)
  }

  return source
}

function parseIdentifierList (source = '') {
  return splitTopLevelSqlList(source)
    .map((entry) => unquoteSqlIdentifier(entry))
    .filter(Boolean)
}

function readLeadingIdentifier (entry = '') {
  const match = String(entry).match(/^\s*("([^"]|"")*"|`[^`]+`|\[[^\]]+\]|[A-Za-z0-9_]+)/)
  if (!match) return ''
  return unquoteSqlIdentifier(match[1])
}

function extractConstraintName (entry = '') {
  const match = String(entry).match(/^\s*CONSTRAINT\s+("([^"]|"")*"|`[^`]+`|\[[^\]]+\]|[A-Za-z0-9_]+)/i)
  if (!match) return ''
  return unquoteSqlIdentifier(match[1])
}

function extractFkAction (entry = '', action = 'UPDATE') {
  const pattern = new RegExp(`ON\\s+${action}\\s+(SET\\s+NULL|SET\\s+DEFAULT|NO\\s+ACTION|CASCADE|RESTRICT)`, 'i')
  const match = String(entry).match(pattern)
  return match ? normalizeText(match[1]).replace(/\s+/g, ' ').toUpperCase() : ''
}

function parseSqliteForeignKeyEntry (entry = '') {
  const constraintName = extractConstraintName(entry)
  const trimmed = String(entry).trim()
  const working = constraintName
    ? trimmed.replace(/^\s*CONSTRAINT\s+("([^"]|"")*"|`[^`]+`|\[[^\]]+\]|[A-Za-z0-9_]+)\s+/i, '')
    : trimmed

  const upper = working.toUpperCase()

  if (upper.startsWith('FOREIGN KEY')) {
    const columnsStart = working.indexOf('(')
    const sourceColumns = extractParenthesizedContent(working, columnsStart)
    if (!sourceColumns) return null

    const afterColumns = working.slice(sourceColumns.endIndex + 1)
    const refMatch = afterColumns.match(/REFERENCES\s+("([^"]|"")*"|`[^`]+`|\[[^\]]+\]|[A-Za-z0-9_]+)\s*/i)
    if (!refMatch) return null

    const referencedTableName = unquoteSqlIdentifier(refMatch[1])
    const refOpenIndex = afterColumns.indexOf('(', refMatch.index + refMatch[0].length - 1)
    const referencedColumns = extractParenthesizedContent(afterColumns, refOpenIndex)
    if (!referencedColumns) return null

    const columns = parseIdentifierList(sourceColumns.content)
    const referencedNames = parseIdentifierList(referencedColumns.content)

    return {
      name: constraintName,
      referencedTableName,
      updateRule: extractFkAction(working, 'UPDATE'),
      deleteRule: extractFkAction(working, 'DELETE'),
      columns: columns.map((columnName, index) => ({
        name: columnName,
        referencedName: referencedNames[index] || ''
      }))
    }
  }

  if (!/\bREFERENCES\b/i.test(working)) {
    return null
  }

  const columnName = readLeadingIdentifier(working)
  const refMatch = working.match(/REFERENCES\s+("([^"]|"")*"|`[^`]+`|\[[^\]]+\]|[A-Za-z0-9_]+)\s*/i)
  if (!columnName || !refMatch) return null

  const referencedTableName = unquoteSqlIdentifier(refMatch[1])
  const refOpenIndex = working.indexOf('(', refMatch.index + refMatch[0].length - 1)
  const referencedColumns = extractParenthesizedContent(working, refOpenIndex)
  const referencedNames = referencedColumns ? parseIdentifierList(referencedColumns.content) : ['id']

  return {
    name: constraintName,
    referencedTableName,
    updateRule: extractFkAction(working, 'UPDATE'),
    deleteRule: extractFkAction(working, 'DELETE'),
    columns: [{
      name: columnName,
      referencedName: referencedNames[0] || 'id'
    }]
  }
}

function parseSqliteCheckEntry (entry = '') {
  const checkIndex = entry.toUpperCase().indexOf('CHECK')
  if (checkIndex < 0) return null

  const openIndex = entry.indexOf('(', checkIndex)
  const clause = extractParenthesizedContent(entry, openIndex)
  if (!clause?.content) return null

  return {
    name: extractConstraintName(entry),
    clause: clause.content.trim()
  }
}

function parseSqliteConstraintMetadata (entries = []) {
  const foreignKeys = []
  const checks = []

  for (const entry of entries) {
    const foreignKey = parseSqliteForeignKeyEntry(entry)
    if (foreignKey) {
      foreignKeys.push(foreignKey)
    }

    const checkConstraint = parseSqliteCheckEntry(entry)
    if (checkConstraint) {
      checks.push(checkConstraint)
    }
  }

  return {
    foreignKeys,
    checkConstraints: checks
  }
}

function parseSqliteDeclaredType (columnType = '') {
  const source = normalizeText(columnType)
  const match = source.match(/^([A-Za-z0-9_]+)\s*(?:\((.*)\))?/i)
  return {
    dataType: normalizeText(match?.[1]).toLowerCase(),
    args: normalizeText(match?.[2]),
    columnType: source,
    unsigned: /\bunsigned\b/i.test(source)
  }
}

function deriveSqliteColumnNumbers (dataType, args = '') {
  if (!args) {
    return {
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      datetimePrecision: null
    }
  }

  const parts = args.split(',').map((entry) => normalizeText(entry))
  if (dataType === 'varchar' || dataType === 'char') {
    return {
      maxLength: toNullableNumber(parts[0]),
      numericPrecision: null,
      numericScale: null,
      datetimePrecision: null
    }
  }

  if (dataType === 'decimal' || dataType === 'numeric') {
    return {
      maxLength: null,
      numericPrecision: toNullableNumber(parts[0]),
      numericScale: toNullableNumber(parts[1]),
      datetimePrecision: null
    }
  }

  if (dataType === 'datetime' || dataType === 'timestamp' || dataType === 'time') {
    return {
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      datetimePrecision: toNullableNumber(parts[0])
    }
  }

  return {
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    datetimePrecision: null
  }
}

async function introspectSqliteTableSnapshot (knex, { tableName, idColumn }) {
  const quotedTableName = quoteSqliteIdentifier(tableName)
  const tableRows = normalizeRows(await knex.raw(
    `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    [tableName]
  ))
  const firstTableRow = Array.isArray(tableRows) ? tableRows[0] : null
  if (!firstTableRow?.sql) {
    throw new Error(`Could not introspect table "${tableName}".`)
  }

  const tableSql = String(firstTableRow.sql)
  const tableEntries = extractCreateTableEntries(tableSql)
  const parsedConstraints = parseSqliteConstraintMetadata(tableEntries)
  const tableEntriesByLeadingIdentifier = new Map(
    tableEntries.map((entry) => [readLeadingIdentifier(entry), entry])
  )

  const columnRows = normalizeRows(await knex.raw(`PRAGMA table_xinfo(${quotedTableName})`))
    .filter((row) => Number(row.hidden || 0) === 0)
  if (columnRows.length < 1) {
    throw new Error(`Could not introspect table "${tableName}".`)
  }

  const columns = columnRows
    .sort((left, right) => Number(left.cid) - Number(right.cid))
    .map((row) => {
      const declared = parseSqliteDeclaredType(row.type)
      const derived = deriveSqliteColumnNumbers(declared.dataType, declared.args)
      const upperEntry = tableEntriesByLeadingIdentifier.get(normalizeText(row.name)) || ''
      const autoIncrement = Number(row.pk) > 0 &&
        declared.dataType === 'integer' &&
        /\bPRIMARY\s+KEY\b/i.test(upperEntry)

      return buildColumnSnapshot({
        name: row.name,
        dataType: declared.dataType,
        columnType: declared.columnType,
        nullable: Number(row.pk) > 0 ? false : Number(row.notnull) !== 1,
        defaultValue: row.dflt_value,
        extra: autoIncrement ? 'auto_increment' : '',
        autoIncrement,
        unsigned: declared.unsigned,
        maxLength: derived.maxLength,
        numericPrecision: derived.numericPrecision,
        numericScale: derived.numericScale,
        datetimePrecision: derived.datetimePrecision,
        ordinalPosition: Number(row.cid) + 1
      })
    })

  const primaryKeyColumns = columnRows
    .filter((row) => Number(row.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((row) => normalizeText(row.name))

  const indexListRows = normalizeRows(await knex.raw(`PRAGMA index_list(${quotedTableName})`))
  const indexRows = []
  for (const row of indexListRows) {
    if (normalizeText(row.origin).toLowerCase() === 'pk') {
      continue
    }

    const indexName = normalizeText(row.name)
    const quotedIndexName = quoteSqliteIdentifier(indexName)
    const columnsForIndex = normalizeRows(await knex.raw(`PRAGMA index_info(${quotedIndexName})`))

    for (const columnRow of columnsForIndex) {
      indexRows.push({
        indexName,
        nonUnique: Number(row.unique) === 1 ? 0 : 1,
        indexType: '',
        columnName: normalizeText(columnRow.name),
        seqInIndex: Number(columnRow.seqno) + 1
      })
    }
  }

  const foreignKeyRows = normalizeRows(await knex.raw(`PRAGMA foreign_key_list(${quotedTableName})`))
    .map((row) => ({
      groupId: row.id,
      columnName: row.from,
      referencedTableName: row.table,
      referencedColumnName: row.to,
      ordinalPosition: Number(row.seq) + 1,
      updateRule: row.on_update,
      deleteRule: row.on_delete
    }))

  const resolvedIdColumn = requireIdColumn(columns, idColumn)
  requirePrimaryKeyContainsId(primaryKeyColumns, resolvedIdColumn)

  return {
    dialect: 'sqlite',
    schemaName: 'main',
    tableName,
    tableCollation: '',
    idColumn: resolvedIdColumn,
    primaryKeyColumns,
    hasWorkspaceIdColumn: columns.some((column) => column.name === 'workspace_id'),
    hasUserIdColumn: columns.some((column) => column.name === 'user_id'),
    columns,
    indexes: normalizeIndexes(indexRows),
    foreignKeys: normalizeForeignKeys(foreignKeyRows, parsedConstraints.foreignKeys, tableName),
    checkConstraints: normalizeCheckConstraints(parsedConstraints.checkConstraints, tableName)
  }
}

function normalizeDbSchemaName (rows = []) {
  const firstRow = Array.isArray(rows) ? rows[0] : null
  const schemaName = normalizeText(firstRow?.schemaName || firstRow?.schema_name)
  if (!schemaName) {
    throw new Error('Could not resolve current database schema name.')
  }

  return schemaName
}

async function introspectMysqlTableSnapshot (knex, { tableName, idColumn }) {
  const schemaRows = normalizeRows(await knex.raw('SELECT DATABASE() AS schemaName'))
  const schemaName = normalizeDbSchemaName(schemaRows)

  const tableRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          t.table_collation AS tableCollation
        FROM information_schema.tables t
        WHERE t.table_schema = ?
          AND t.table_name = ?
        LIMIT 1
      `,
      [schemaName, tableName]
    )
  )

  const columnRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          c.column_name AS columnName,
          c.data_type AS dataType,
          c.column_type AS columnType,
          c.is_nullable AS isNullable,
          c.column_default AS columnDefault,
          c.extra AS extra,
          c.character_maximum_length AS characterMaximumLength,
          c.character_set_name AS characterSetName,
          c.collation_name AS collationName,
          c.numeric_precision AS numericPrecision,
          c.numeric_scale AS numericScale,
          c.datetime_precision AS datetimePrecision,
          c.ordinal_position AS ordinalPosition
        FROM information_schema.columns c
        WHERE c.table_schema = ?
          AND c.table_name = ?
        ORDER BY c.ordinal_position ASC
      `,
      [schemaName, tableName]
    )
  )
  if (columnRows.length < 1) {
    throw new Error(`Could not introspect table "${tableName}" in schema "${schemaName}".`)
  }

  const primaryRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          k.column_name AS columnName,
          k.ordinal_position AS ordinalPosition
        FROM information_schema.table_constraints t
        JOIN information_schema.key_column_usage k
          ON k.constraint_name = t.constraint_name
         AND k.table_schema = t.table_schema
         AND k.table_name = t.table_name
        WHERE t.table_schema = ?
          AND t.table_name = ?
          AND t.constraint_type = 'PRIMARY KEY'
        ORDER BY k.ordinal_position ASC
      `,
      [schemaName, tableName]
    )
  )

  const indexRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          s.index_name AS indexName,
          s.non_unique AS nonUnique,
          s.index_type AS indexType,
          s.column_name AS columnName,
          s.seq_in_index AS seqInIndex
        FROM information_schema.statistics s
        WHERE s.table_schema = ?
          AND s.table_name = ?
          AND s.index_name <> 'PRIMARY'
        ORDER BY s.index_name ASC, s.seq_in_index ASC
      `,
      [schemaName, tableName]
    )
  )

  const foreignKeyRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          rc.constraint_name AS constraintName,
          k.column_name AS columnName,
          k.referenced_table_name AS referencedTableName,
          k.referenced_column_name AS referencedColumnName,
          k.ordinal_position AS ordinalPosition,
          rc.update_rule AS updateRule,
          rc.delete_rule AS deleteRule
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage k
          ON k.constraint_name = rc.constraint_name
         AND k.constraint_schema = rc.constraint_schema
         AND k.table_name = rc.table_name
        WHERE rc.constraint_schema = ?
          AND rc.table_name = ?
        ORDER BY rc.constraint_name ASC, k.ordinal_position ASC
      `,
      [schemaName, tableName]
    )
  )

  const checkConstraintRows = normalizeRows(
    await knex.raw(
      `
        SELECT
          tc.constraint_name AS constraintName,
          cc.check_clause AS checkClause
        FROM information_schema.table_constraints tc
        JOIN information_schema.check_constraints cc
          ON cc.constraint_schema = tc.constraint_schema
         AND cc.constraint_name = tc.constraint_name
        WHERE tc.table_schema = ?
          AND tc.table_name = ?
          AND tc.constraint_type = 'CHECK'
        ORDER BY tc.constraint_name ASC
      `,
      [schemaName, tableName]
    )
  )

  const columns = columnRows.map((row) => buildColumnSnapshot({
    name: row.columnName,
    dataType: row.dataType,
    columnType: row.columnType,
    nullable: normalizeText(row.isNullable).toUpperCase() === 'YES',
    defaultValue: Object.prototype.hasOwnProperty.call(row, 'columnDefault') ? row.columnDefault : row.column_default,
    extra: row.extra,
    autoIncrement: normalizeText(row.extra).toLowerCase().includes('auto_increment'),
    unsigned: normalizeText(row.columnType).toLowerCase().includes('unsigned'),
    maxLength: row.characterMaximumLength,
    numericPrecision: row.numericPrecision,
    numericScale: row.numericScale,
    datetimePrecision: row.datetimePrecision,
    characterSetName: row.characterSetName,
    collationName: row.collationName,
    ordinalPosition: row.ordinalPosition
  }))

  const resolvedIdColumn = requireIdColumn(columns, idColumn)
  const primaryKeyColumns = normalizePrimaryKeyColumns(primaryRows)
  requirePrimaryKeyContainsId(primaryKeyColumns, resolvedIdColumn)

  return {
    dialect: 'mysql2',
    schemaName,
    tableName,
    tableCollation: normalizeText((Array.isArray(tableRows) ? tableRows[0] : null)?.tableCollation),
    idColumn: resolvedIdColumn,
    primaryKeyColumns,
    hasWorkspaceIdColumn: columns.some((column) => column.name === 'workspace_id'),
    hasUserIdColumn: columns.some((column) => column.name === 'user_id'),
    columns,
    indexes: normalizeIndexes(indexRows),
    foreignKeys: normalizeForeignKeys(foreignKeyRows, [], tableName),
    checkConstraints: normalizeCheckConstraints(
      checkConstraintRows.map((row) => ({
        name: row.constraintName,
        clause: row.checkClause
      })),
      tableName
    )
  }
}

export async function introspectKnexTableSnapshot (knex, { tableName = '', idColumn = 'id' } = {}) {
  requireKnexRaw(knex)
  const resolvedTableName = requireTableName(tableName)
  const dialect = detectDialect(knex)

  if (dialect === 'sqlite') {
    return introspectSqliteTableSnapshot(knex, {
      tableName: resolvedTableName,
      idColumn
    })
  }

  if (dialect === 'mysql2') {
    return introspectMysqlTableSnapshot(knex, {
      tableName: resolvedTableName,
      idColumn
    })
  }

  throw new Error(`Unsupported dialect "${dialect}" for introspectKnexTableSnapshot.`)
}
