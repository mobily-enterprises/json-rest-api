// Many-row storage for table-backed resources: scoped builders, visible-id reads,
// multi-row inserts, by-id CASE updates, by-id deletes and row locks. Every write
// runs one statement per chunk; none of them runs through the filter hooks, so
// MySQL never sees an UPDATE or DELETE whose subquery reads its own table.
import { RestApiBulkInsertIdsError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { withQueryFilteringContext } from '../querying/query-builder-utils.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from '../querying-writing/knex-field-helpers.js'
import { applyInsertReturning } from '../querying-writing/database-capabilities.js'
import { loadRelationshipIdentifiers } from '../querying/relationship-identifiers.js'
import { buildJsonApiResponse } from '../querying/knex-json-api-transformers-querying.js'
import { deletePivotReferences } from '../writing/many-to-many-manipulations.js'

// Bound parameters one statement may carry, with headroom for predicates.
const PLACEHOLDER_LIMITS = { sqlite: 32000, pg: 65000, mysql: 65000 }
// Knex writes a SQLite multi-row INSERT as SELECT … UNION ALL, and SQLite caps a compound SELECT at 500 terms.
const SQLITE_INSERT_ROWS = 500

/** @param {import('knex').Knex} db */
export function databaseFamily (db) {
  const client = String(db.client.config.client)
  if (client.includes('sqlite')) return 'sqlite'
  if (client === 'pg' || client === 'postgresql') return 'pg'
  return 'mysql'
}

/** @param {{ dbInfo?: { version?: string } } | undefined} capabilities */
function supportsMariaDbReturning (capabilities) {
  const version = String(capabilities?.dbInfo?.version || '').toLowerCase()
  if (!version.includes('mariadb')) return false
  const [major, minor] = version.split(/[.-]/).map(Number)
  return major > 10 || (major === 10 && minor >= 5)
}

/**
 * Rows per statement: the requested chunk size, lowered so a statement's
 * bound parameters (and a SQLite INSERT's compound terms) stay under the dialect's limit.
 * @param {import('knex').Knex} db
 * @param {number} chunkSize
 * @param {number} bindingsPerRow
 * @param {{ insert?: boolean }} [options]
 */
export function rowsPerStatement (db, chunkSize, bindingsPerRow, { insert = false } = {}) {
  const family = databaseFamily(db)
  const rows = Math.min(chunkSize, Math.floor(PLACEHOLDER_LIMITS[family] / Math.max(1, bindingsPerRow)))
  return Math.max(1, insert && family === 'sqlite' ? Math.min(rows, SQLITE_INSERT_ROWS) : rows)
}

/** @template T @param {T[]} items @param {number} size @returns {T[][]} */
export function chunk (items, size) {
  const chunks = []
  for (let offset = 0; offset < items.length; offset += size) chunks.push(items.slice(offset, offset + size))
  return chunks
}

/** @param {unknown} value @returns {boolean} */
export const isRawValue = value => Boolean(value && typeof value === 'object' && /** @type {{ isRawInstance?: boolean }} */ (value).isRawInstance === true)

// Conflict keys compare by exact value; drivers return numbers for integer keys.
const keyOf = (row, columns) => JSON.stringify(columns.map(column => {
  const value = row[column]
  if (value === null || value === undefined) return null
  return typeof value === 'bigint' || typeof value === 'number' ? String(value) : value instanceof Date ? value.toISOString() : String(value)
}))

/**
 * @param {object} dependencies
 * @param {any} dependencies.api
 * @param {(scopeName: string) => any} dependencies.getScopeStorageAdapter
 * @param {Record<string, any>} dependencies.scopes
 * @param {any} dependencies.log
 */
export function createManyRowDataHelpers ({ api, getScopeStorageAdapter, scopes, log }) {
  const adapterFor = scopeName => {
    const adapter = getScopeStorageAdapter(scopeName)
    if (!adapter) throw new Error(`Storage adapter for resource '${scopeName}' not found`)
    return adapter
  }

  /**
   * The resource's base query with ownership, row policy and `filters` applied,
   * as `{ query }`: a builder is thenable, so an async function cannot return it bare.
   * @param {{ scopeName: string, context: any, runHooks: Function, alias?: string, purpose: string, filters?: Record<string, unknown> }} request
   */
  const dataScopedQuery = async ({ scopeName, context, runHooks, alias, purpose, filters }) => {
    const storageAdapter = adapterFor(scopeName)
    context.storageAdapter = storageAdapter
    const db = context.db || api.knex.instance
    const tableName = storageAdapter.getTableName()
    const tableAlias = alias || tableName
    const state = await withQueryFilteringContext(context, {
      query: storageAdapter.buildBaseQuery({ transaction: db, tableAlias: tableAlias === tableName ? undefined : tableAlias }),
      filters,
      schemaInfo: context.schemaInfo,
      scopeName,
      tableName: tableAlias,
      db,
      queryPurpose: purpose,
      adapter: storageAdapter,
      storageAdapter
    }, () => runHooks('knexQueryFiltering'))
    return { query: state.query }
  }

  /**
   * Identifiers the caller may touch, in id order: those of `ids` that are
   * visible, or one keyset page of the rows `filters` select.
   * @param {{ scopeName: string, context: any, runHooks: Function, ids?: unknown[], filters?: Record<string, unknown>, queryPurpose: string, after?: unknown, limit?: number }} request
   * @returns {Promise<Array<string | number>>}
   */
  const dataVisibleIds = async ({ scopeName, context, runHooks, ids, filters, queryPurpose, after, limit }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.db || api.knex.instance
    const tableName = storageAdapter.getTableName()
    const idColumn = `${tableName}.${storageAdapter.getIdColumn()}`
    const { query } = await dataScopedQuery({ scopeName, context, runHooks, purpose: queryPurpose, filters })
    if (ids) query.whereIn(idColumn, ids.map(id => storageAdapter.translateFilterValue('id', id)))
    if (after !== undefined) query.where(idColumn, '>', storageAdapter.translateFilterValue('id', after))
    // Policy joins can repeat a row; the identity projection keeps big integers exact.
    query.distinct({ id: databaseIdentityExpression(db, idColumn) }).orderBy(idColumn)
    if (limit) query.limit(limit)
    const rows = await applyDatabaseReadOptions(query)
    return rows.map(row => row.id)
  }

  /**
   * Insert validated rows with one statement per chunk and column set.
   * Returns the stored identifier for each input row (undefined for rows an
   * ignore conflict skipped), or nothing when `needIds` is false.
   * @param {{ scopeName: string, context: any, rows: Record<string, unknown>[], chunkSize: number, needIds: boolean, onConflict?: { keys: string[], action: 'ignore' | 'merge', merge: string[] } }} request
   * @returns {Promise<Array<string | number | undefined> | undefined>}
   */
  const dataInsertMany = async ({ scopeName, context, rows, chunkSize, needIds, onConflict }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const tableName = storageAdapter.getTableName()
    const idColumn = storageAdapter.getIdColumn()
    const family = databaseFamily(db)
    const storageRows = rows.map(attributes => storageAdapter.toStorageRow(attributes, { context, operation: 'post' }))
    const keyColumns = onConflict?.keys.map(field => storageAdapter.translateColumn(field))
    const lockVersionColumn = context.schemaInfo.lockVersionField ? storageAdapter.translateColumn(context.schemaInfo.lockVersionField) : null
    /** @type {Array<string | number | undefined>} */
    const ids = new Array(rows.length)

    // Rows with the same columns share a statement; SQLite cannot insert DEFAULT for a missing value.
    const groups = new Map()
    storageRows.forEach((row, index) => {
      const signature = Object.keys(row).sort().join('\u0000')
      if (!groups.has(signature)) groups.set(signature, [])
      groups.get(signature).push(index)
    })
    let increment
    for (const indexes of groups.values()) {
      const columns = Object.keys(storageRows[indexes[0]])
      for (const part of chunk(indexes, rowsPerStatement(db, chunkSize, columns.length + 1, { insert: true }))) {
        const values = part.map(index => storageRows[index])
        let query = db(tableName).insert(values)
        if (onConflict) query = applyConflict(query, { db, family, tableName, idColumn, keyColumns, onConflict, storageAdapter, lockVersionColumn })

        if (onConflict && family === 'mysql') {
          // Neither MySQL nor MariaDB reports which rows an upsert inserted: read the keys around it.
          const existing = onConflict.action === 'ignore' && needIds
            ? new Set((await readByKeys(db, tableName, idColumn, keyColumns, values)).map(row => keyOf(row, keyColumns)))
            : null
          await query
          const found = new Map((await readByKeys(db, tableName, idColumn, keyColumns, values)).map(row => [keyOf(row, keyColumns), row.id]))
          part.forEach((index, position) => {
            const key = keyOf(values[position], keyColumns)
            if (!found.has(key)) throw conflictElsewhere(scopeName, onConflict)
            if (!existing?.has(key)) ids[index] = found.get(key)
          })
          continue
        }

        if (!needIds) {
          await query
          continue
        }

        if (family === 'mysql' && supportsMariaDbReturning(api.knex.capabilities)) {
          const { sql, bindings } = query.toSQL()
          const [returned] = await db.raw(`${sql} returning ${db.raw('??', [idColumn]).toQuery()}`, bindings)
          returned.forEach((row, position) => { ids[part[position]] = row[idColumn] })
          continue
        }

        if (family === 'mysql') {
          if (increment === undefined) {
            const [[setting]] = await db.raw('select @@session.auto_increment_increment as step')
            increment = Number(setting.step)
          }
          const explicit = values.every(row => row[idColumn] !== undefined && row[idColumn] !== null)
          const [firstId] = await query
          const stored = explicit
            ? values.map(row => row[idColumn])
            : await verifyMysqlInsertIds({ db, tableName, idColumn, values, firstId, increment, scopeName, schemaInfo: context.schemaInfo, storageAdapter })
          part.forEach((index, position) => { ids[index] = stored[position] })
          continue
        }

        const returnColumns = { [idColumn]: databaseIdentityExpression(db, idColumn) }
        for (const column of keyColumns || []) returnColumns[`__jra_key_${column}`] = column
        let returned = await applyDatabaseReadOptions(applyInsertReturning(query, returnColumns))
        if (onConflict) {
          // Ignored rows return nothing, so returned rows are matched to inputs by their keys.
          const byKey = new Map(returned.map(row => [keyOf(Object.fromEntries(keyColumns.map(column => [column, row[`__jra_key_${column}`]])), keyColumns), row[idColumn]]))
          part.forEach((index, position) => { ids[index] = byKey.get(keyOf(values[position], keyColumns)) })
          continue
        }
        if (family === 'sqlite' && values.some(row => row[idColumn] === undefined || row[idColumn] === null)) {
          // SQLite does not promise RETURNING order; generated row ids increase in insertion order.
          returned = [...returned].sort((left, right) => Number(left[idColumn]) - Number(right[idColumn]))
        }
        returned.forEach((row, position) => { ids[part[position]] = row[idColumn] })
      }
    }
    return needIds ? ids : undefined
  }

  /**
   * Update visible rows by id: one UPDATE per chunk, `CASE id WHEN … THEN …`
   * for values that differ between rows and a plain SET for shared ones.
   * Returns the identifiers the statements changed.
   * @param {{ scopeName: string, context: any, updates: Array<{ id: string | number, row: Record<string, unknown> }>, onlyIf?: Record<string, unknown>, chunkSize: number }} request
   * @returns {Promise<Array<string | number>>}
   */
  const dataUpdateByIds = async ({ scopeName, context, updates, onlyIf, chunkSize }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const tableName = storageAdapter.getTableName()
    const idColumn = storageAdapter.getIdColumn()
    const family = databaseFamily(db)
    const lockVersionColumn = context.schemaInfo.lockVersionField ? storageAdapter.translateColumn(context.schemaInfo.lockVersionField) : null
    const columnCount = new Set(updates.flatMap(update => Object.keys(update.row))).size
    const changed = []

    for (const part of chunk(updates, rowsPerStatement(db, chunkSize, 2 * columnCount + 1))) {
      const set = {}
      const columns = [...new Set(part.flatMap(update => Object.keys(update.row)))]
      for (const column of columns) {
        const entries = part.filter(update => Object.hasOwn(update.row, column))
        const first = entries[0].row[column]
        const same = entries.length === part.length && entries.every(update => sameValue(update.row[column], first))
        if (same) {
          set[column] = first
          continue
        }
        const bindings = [idColumn]
        let sql = 'case ??'
        for (const update of entries) {
          sql += ' when ? then ?'
          bindings.push(storageAdapter.translateFilterValue('id', update.id), update.row[column])
        }
        set[column] = db.raw(`${sql} else ?? end`, [...bindings, column])
      }
      if (lockVersionColumn) set[lockVersionColumn] = db.raw('?? + 1', [lockVersionColumn])
      if (!Object.keys(set).length) {
        changed.push(...part.map(update => update.id))
        continue
      }
      const ids = part.map(update => storageAdapter.translateFilterValue('id', update.id))
      const query = db(tableName).whereIn(idColumn, ids)
      if (!onlyIf) {
        await query.update(set)
        changed.push(...part.map(update => update.id))
      } else if (family === 'mysql') {
        // MySQL cannot return updated rows: lock the rows that match, then update exactly those.
        const matched = await applyDatabaseReadOptions(applyOnlyIf(db(tableName).whereIn(idColumn, ids), onlyIf)
          .forUpdate().select({ id: databaseIdentityExpression(db, idColumn) }))
        if (matched.length) await db(tableName).whereIn(idColumn, matched.map(row => row.id)).update(set)
        changed.push(...matched.map(row => row.id))
      } else {
        const rows = await applyDatabaseReadOptions(applyOnlyIf(query, onlyIf).returning({ id: databaseIdentityExpression(db, idColumn) }).update(set))
        changed.push(...rows.map(row => row.id))
      }
    }
    return changed
  }

  /**
   * Delete visible rows by id, one DELETE per chunk, then their pivot rows.
   * @param {{ scopeName: string, context: any, ids: Array<string | number>, chunkSize: number }} request
   */
  const dataDeleteByIds = async ({ scopeName, context, ids, chunkSize }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    for (const part of chunk(ids, rowsPerStatement(db, chunkSize, 1))) {
      await db(storageAdapter.getTableName()).whereIn(storageAdapter.getIdColumn(), part.map(id => storageAdapter.translateFilterValue('id', id))).delete()
      await deletePivotReferences(api, scopeName, context, part)
    }
  }

  // Reads rows through the get field selection, so they leave as response records.
  const readRecords = async ({ scopeName, context, query, tableName }) => {
    const scope = api.resources[scopeName]
    const storageAdapter = adapterFor(scopeName)
    const db = context.db
    const fieldSelectionInfo = await buildFieldSelection(scope, { context })
    context.computedDependencies = fieldSelectionInfo.computedDependencies
    const { query: selected } = await applyFieldSelectionToQuery({
      query, scope, fieldSelectionInfo, tableName, useTablePrefix: true, storageAdapter, db, context, scopeName
    })
    const rows = await applyDatabaseReadOptions(selected)
    await loadRelationshipIdentifiers(rows, scopeName, scopes, db, context)
    return buildJsonApiResponse(scope, rows, [], false, scopeName, context)
  }

  const lockRows = (query, db, { skipLocked = false } = {}) => {
    // SQLite has a single writer, so its transaction already excludes other writers.
    if (databaseFamily(db) === 'sqlite') return query
    query.forUpdate()
    return skipLocked ? query.skipLocked() : query
  }

  /**
   * Lock rows already known to be visible, in id order, on the bare table.
   * Returns the rows the locking read saw as a JSON:API document.
   * @param {{ scopeName: string, context: any, ids: Array<string | number> }} request
   */
  const dataLockByIds = async ({ scopeName, context, ids }) => {
    const storageAdapter = adapterFor(scopeName)
    const tableName = storageAdapter.getTableName()
    const idColumn = `${tableName}.${storageAdapter.getIdColumn()}`
    const query = lockRows(context.db(tableName).whereIn(idColumn, ids.map(id => storageAdapter.translateFilterValue('id', id))).orderBy(idColumn), context.db)
    return readRecords({ scopeName, context, query, tableName })
  }

  /**
   * Take up to `limit` matching rows no other transaction holds.
   * @param {{ scopeName: string, context: any, runHooks: Function, filters?: Record<string, unknown>, sort: Array<{ field: string, direction: 'asc' | 'desc' }>, limit: number }} request
   */
  const dataClaim = async ({ scopeName, context, runHooks, filters, sort, limit }) => {
    const storageAdapter = adapterFor(scopeName)
    const tableName = storageAdapter.getTableName()
    const idColumn = `${tableName}.${storageAdapter.getIdColumn()}`
    const db = context.db
    // Resolves to { query }: awaiting a bare builder would run it.
    const scoped = async () => {
      const { query } = await dataScopedQuery({ scopeName, context, runHooks, purpose: 'claim', filters })
      if (query._statements.some(statement => statement.grouping === 'join')) {
        throw new RestApiValidationError(`claim on '${scopeName}' needs a single-table query, but its filters or row policy add joins`, {
          fields: ['filters'],
          violations: [{ field: 'filters', rule: 'claim_single_table', message: 'A row policy or filter that joins tables cannot be combined with SKIP LOCKED' }]
        })
      }
      for (const { field, direction } of sort) query.orderBy(`${tableName}.${storageAdapter.translateColumn(field)}`, direction)
      return { query }
    }
    const { query } = await scoped()
    if (databaseFamily(db) !== 'mysql') {
      // PostgreSQL locks rows as the LIMIT takes them; SQLite has one writer.
      return readRecords({ scopeName, context, query: lockRows(query.limit(limit), db, { skipLocked: true }), tableName })
    }

    // InnoDB locks every row a locking read examines, including rows a sort
    // reads and the LIMIT then drops, so one claim would hold every match.
    // Instead: candidates in sort order by a plain read, then locking reads of
    // windows of candidates by primary key, each no larger than what is still needed.
    const claimed = { data: [] }
    const pageSize = Math.max(limit * 2, 20)
    for (let offset = 0; claimed.data.length < limit; offset += pageSize) {
      const candidates = (await applyDatabaseReadOptions(query.clone().offset(offset).limit(pageSize)
        .select({ id: databaseIdentityExpression(db, idColumn) }))).map(row => row.id)
      for (let next = 0; next < candidates.length && claimed.data.length < limit;) {
        const window = candidates.slice(next, next + limit - claimed.data.length)
        next += window.length
        const locked = (await scoped()).query.whereIn(idColumn, window).forUpdate().skipLocked()
        const document = await readRecords({ scopeName, context, query: locked, tableName })
        claimed.data.push(...document.data)
      }
      if (candidates.length < pageSize) break
    }
    return claimed
  }

  return { dataScopedQuery, dataVisibleIds, dataInsertMany, dataUpdateByIds, dataDeleteByIds, dataLockByIds, dataClaim }
}

const sameValue = (left, right) => {
  if (left === right) return true
  if (isRawValue(left) || isRawValue(right)) return false
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return false
}

function applyOnlyIf (query, onlyIf) {
  for (const [column, value] of Object.entries(onlyIf)) {
    if (value === null) query.whereNull(column)
    else query.where(column, value)
  }
  return query
}

function conflictElsewhere (scopeName, onConflict) {
  return new RestApiValidationError(`A '${scopeName}' row conflicted on a unique index other than (${onConflict.keys.join(', ')})`, {
    fields: onConflict.keys,
    violations: [{ field: 'onConflict.keys', rule: 'conflict_keys', message: 'Every input row must insert or match a row by the conflict keys' }]
  })
}

async function readByKeys (db, tableName, idColumn, keyColumns, values) {
  const rows = await applyDatabaseReadOptions(db(tableName)
    .whereIn(keyColumns, values.map(row => keyColumns.map(column => row[column] ?? null)))
    .select({ id: databaseIdentityExpression(db, idColumn) }, ...keyColumns))
  return rows
}

function applyConflict (query, { db, family, tableName, idColumn, keyColumns, onConflict, storageAdapter, lockVersionColumn }) {
  if (onConflict.action === 'ignore') {
    // INSERT IGNORE would also turn other errors into warnings; keep them errors.
    return family === 'mysql'
      ? query.onConflict(keyColumns).merge({ [idColumn]: db.raw('??', [idColumn]) })
      : query.onConflict(keyColumns).ignore()
  }
  const updates = {}
  for (const field of onConflict.merge) {
    const column = storageAdapter.translateColumn(field)
    updates[column] = family === 'mysql' ? db.raw('values(??)', [column]) : db.raw('excluded.??', [column])
  }
  if (lockVersionColumn) updates[lockVersionColumn] = db.raw('??.?? + 1', [tableName, lockVersionColumn])
  return query.onConflict(keyColumns).merge(updates)
}

// MySQL reports only the first generated id. One multi-row INSERT is expected to
// take consecutive values; prove it by reading the range back inside the
// transaction and comparing the rows with what was inserted.
async function verifyMysqlInsertIds ({ db, tableName, idColumn, values, firstId, increment, scopeName, schemaInfo, storageAdapter }) {
  const start = Number(firstId)
  const expected = values.map((_row, position) => start + position * increment)
  const comparable = comparableColumns(values, schemaInfo, storageAdapter)
  const rows = await applyDatabaseReadOptions(db(tableName).whereIn(idColumn, expected).orderBy(idColumn)
    .select({ __jra_id: idColumn }, ...comparable))
  const verified = rows.length === values.length && rows.every((row, position) =>
    Number(row.__jra_id) === expected[position] && comparable.every(column => String(row[column]) === String(values[position][column])))
  if (!verified) {
    throw new RestApiBulkInsertIdsError({ resourceType: scopeName, expected: values.length, verified: rows.length })
  }
  return expected
}

// Columns whose stored value reads back exactly: strings and integers.
function comparableColumns (values, schemaInfo, storageAdapter) {
  const columns = []
  for (const [field, definition] of Object.entries(schemaInfo.schemaStructure || {})) {
    if (field === 'id' || definition.virtual || definition.computed || definition.storage?.serialize) continue
    const column = storageAdapter.translateColumn(field)
    const sample = values[0][column]
    const textual = ['string', 'email', 'uuid'].includes(definition.type) && typeof sample === 'string'
    const integral = (definition.type === 'integer' || definition.belongsTo) && Number.isSafeInteger(Number(sample)) && sample !== null && sample !== ''
    if ((textual || integral) && values.every(row => row[column] !== null && row[column] !== undefined)) columns.push(column)
  }
  return columns
}
