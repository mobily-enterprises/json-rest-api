// Many-row storage for table-backed resources: scoped builders, visible-id reads,
// multi-row inserts, by-id CASE updates, by-id deletes and row locks. Every write
// runs one statement per chunk; none of them runs through the filter hooks, so
// MySQL never sees an UPDATE or DELETE whose subquery reads its own table.
import { RestApiBulkInsertIdsError, RestApiBulkWriteUnsupportedError, RestApiResourceError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { withQueryFilteringContext } from '../querying/query-builder-utils.js'
import { applyWriteConditions, hasWriteConditions } from '../querying/query-constraint.js'
import { applyDatabaseReadOptions, databaseIdentityExpression, normalizeStoredFieldValue } from '../querying-writing/database-value-normalizers.js'
import { listKnexUniqueKeyColumns } from '../dbIntrospection.js'
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

/**
 * A Knex raw expression. JSON input cannot produce one: the check needs its
 * toSQL function, not only the isRawInstance flag.
 * @param {unknown} value @returns {boolean}
 */
export function isRawValue (value) {
  const raw = /** @type {{ isRawInstance?: boolean, toSQL?: unknown } | null} */ (value)
  return Boolean(raw && typeof raw === 'object' && raw.isRawInstance === true && typeof raw.toSQL === 'function')
}

/**
 * Conflict keys compare exactly, in their public form: drivers return booleans
 * as 1 and 0, numbers as strings and dates in their own shapes, so each value
 * goes through its field's read normalization first. Strings compare as they
 * are, without the column's collation. A field with a storage serializer
 * compares its stored form.
 * @param {Record<string, any>} schemaStructure
 * @param {string[]} keys
 * @param {string[]} keyColumns
 */
function conflictKeyMatcher (schemaStructure, keys, keyColumns) {
  const definitions = keys.map(field => schemaStructure[field] || {})
  const canonical = (value, index) => {
    if (value === null || value === undefined) return null
    const definition = definitions[index]
    const normal = definition.storage?.serialize ? value : normalizeStoredFieldValue(value, definition, { fieldName: keys[index] })
    if (normal === null || normal === undefined) return null
    if (normal instanceof Date) return normal.toISOString()
    if (['number', 'integer'].includes(definition.type) && typeof normal === 'string') {
      return /^-?\d+$/.test(normal) ? String(BigInt(normal)) : String(Number(normal))
    }
    return String(normal)
  }
  return {
    /** A row's key from its public attributes, or its storage row for serialized fields. */
    input: (attributes, storageRow) => JSON.stringify(keys.map((field, index) =>
      canonical(definitions[index].storage?.serialize ? storageRow[keyColumns[index]] : attributes[field], index))),
    /** A key read from the table. */
    stored: row => JSON.stringify(keyColumns.map((column, index) => canonical(row[column], index)))
  }
}

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

  // Tables and key columns a unique index was found to cover. A missing index is
  // looked for again on the next call, so adding one needs no restart.
  const coveredKeys = new Set()
  /**
   * Refuses conflict keys that no unique index covers. Without one, the keys
   * could match several rows, and a locking read on them would examine (and on
   * MySQL lock) every row of the table.
   */
  const requireUniqueKeys = async ({ scopeName, db, tableName, keyColumns }) => {
    const cacheKey = JSON.stringify([tableName, [...keyColumns].sort()])
    if (coveredKeys.has(cacheKey)) return
    const uniqueKeys = await listKnexUniqueKeyColumns(db, tableName)
    if (!uniqueKeys.some(columns => columns.every(column => keyColumns.includes(column)))) {
      throw new RestApiBulkWriteUnsupportedError({
        resourceType: scopeName,
        operation: 'postMany',
        reason: `no unique index of '${tableName}' covers the onConflict keys (${keyColumns.join(', ')}); add one, so that the keys identify one row`
      })
    }
    coveredKeys.add(cacheKey)
  }

  /**
   * The resource's base query with ownership, row policy and `filters` applied,
   * as `{ query, alias }`: a builder is thenable, so an async function cannot return it bare.
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
    return { query: state.query, alias: tableAlias }
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
   * The stored identifier of the row each input row matches by `keys`, or
   * undefined, read with a row lock (SQLite's single writer needs none), one
   * statement per chunk. Upserts decide from it which rows to insert and which
   * to merge.
   * @param {{ scopeName: string, context: any, rows: Record<string, unknown>[], keys: string[], chunkSize: number }} request
   * @returns {Promise<Array<string | number | undefined>>}
   */
  const dataIdsByKeys = async ({ scopeName, context, rows, keys, chunkSize }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const tableName = storageAdapter.getTableName()
    const keyColumns = keys.map(field => storageAdapter.translateColumn(field))
    await requireUniqueKeys({ scopeName, db, tableName, keyColumns })
    const storageRows = rows.map(attributes => storageAdapter.toStorageRow(attributes, { context, operation: 'post' }))
    const matcher = conflictKeyMatcher(scopes[scopeName].vars.schemaInfo.schemaStructure, keys, keyColumns)
    const inputKeys = rows.map((attributes, index) => matcher.input(attributes, storageRows[index]))
    const wanted = new Set(inputKeys)
    const found = new Map()
    for (const part of chunk(storageRows, rowsPerStatement(db, chunkSize, keyColumns.length))) {
      const query = db(tableName)
        .whereIn(keyColumns, part.map(row => keyColumns.map(column => row[column] ?? null)))
        .select({ id: databaseIdentityExpression(db, storageAdapter.getIdColumn()) }, ...keyColumns)
      for (const row of await applyDatabaseReadOptions(lockRows(query, db))) {
        const key = matcher.stored(row)
        // The database matched by its own comparison (a collation, say); merging or skipping would guess.
        if (!wanted.has(key)) {
          throw new RestApiResourceError(`A stored ${scopeName} record matches the onConflict keys (${keys.join(', ')}) only as the database compares them, for example ignoring letter case; upsert keys must match exactly`, {
            subtype: 'conflict', resourceType: scopeName
          })
        }
        found.set(key, row.id)
      }
    }
    return inputKeys.map(key => found.get(key))
  }

  /**
   * Insert validated rows with one statement per chunk and column set.
   * Returns the stored identifier for each input row (undefined for rows an
   * ignore conflict skipped), or nothing when `needIds` is false.
   * @param {{ scopeName: string, context: any, rows: Record<string, unknown>[], chunkSize: number, needIds: boolean, onConflict?: { keys: string[], action: 'ignore' } }} request
   * @returns {Promise<Array<string | number | undefined> | undefined>}
   */
  const dataInsertMany = async ({ scopeName, context, rows, chunkSize, needIds, onConflict }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const tableName = storageAdapter.getTableName()
    const idColumn = storageAdapter.getIdColumn()
    const family = databaseFamily(db)
    /** @type {Array<string | number | undefined>} */
    const ids = new Array(rows.length)

    if (onConflict && family === 'mysql') {
      // ON DUPLICATE KEY fires on every unique index, the primary key included:
      // lock the rows that match by the keys, then insert only the others with a
      // plain INSERT, so a clash on any other unique index fails the batch.
      const existing = await dataIdsByKeys({ scopeName, context, rows, keys: onConflict.keys, chunkSize })
      const missing = rows.flatMap((_row, index) => existing[index] === undefined ? [index] : [])
      const inserted = missing.length
        ? await dataInsertMany({ scopeName, context, rows: missing.map(index => rows[index]), chunkSize, needIds })
        : []
      missing.forEach((index, position) => { ids[index] = inserted?.[position] })
      return needIds ? ids : undefined
    }

    const storageRows = rows.map(attributes => storageAdapter.toStorageRow(attributes, { context, operation: 'post' }))
    const keyColumns = onConflict?.keys.map(field => storageAdapter.translateColumn(field))

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
        // Only a clash on the conflict keys is skipped; any other unique index still fails.
        if (onConflict) query = query.onConflict(keyColumns).ignore()

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
          const matcher = conflictKeyMatcher(scopes[scopeName].vars.schemaInfo.schemaStructure, onConflict.keys, keyColumns)
          const byKey = new Map(returned.map(row => [matcher.stored(Object.fromEntries(keyColumns.map(column => [column, row[`__jra_key_${column}`]]))), row[idColumn]]))
          part.forEach((index, position) => { ids[index] = byKey.get(matcher.input(rows[index], values[position])) })
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
    // onlyIf and the caller's ownership narrow each statement; without them every listed id is written.
    const guarded = Boolean(onlyIf) || hasWriteConditions(context, scopeName)
    const matching = ids => applyWriteConditions({
      query: applyOnlyIf(db(tableName).whereIn(idColumn, ids), onlyIf || {}), context, scopeName, storageAdapter, tableName
    })
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
      const writes = Object.keys(set).length > 0
      const ids = part.map(update => storageAdapter.translateFilterValue('id', update.id))
      if (!guarded) {
        if (writes) await db(tableName).whereIn(idColumn, ids).update(set)
        changed.push(...part.map(update => update.id))
      } else if (family === 'mysql' || !writes) {
        // MySQL cannot return updated rows: lock the rows that match, then update exactly those.
        const matched = await applyDatabaseReadOptions(lockRows(matching(ids), db).select({ id: databaseIdentityExpression(db, idColumn) }))
        if (matched.length && writes) await db(tableName).whereIn(idColumn, matched.map(row => row.id)).update(set)
        changed.push(...matched.map(row => row.id))
      } else {
        const rows = await applyDatabaseReadOptions(matching(ids).returning({ id: databaseIdentityExpression(db, idColumn) }).update(set))
        changed.push(...rows.map(row => row.id))
      }
    }
    return changed
  }

  /**
   * Delete visible rows by id, one DELETE per chunk, then their pivot rows.
   * Returns the identifiers the statements deleted.
   * @param {{ scopeName: string, context: any, ids: Array<string | number>, chunkSize: number }} request
   * @returns {Promise<Array<string | number>>}
   */
  const dataDeleteByIds = async ({ scopeName, context, ids, chunkSize }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const tableName = storageAdapter.getTableName()
    const idColumn = storageAdapter.getIdColumn()
    const deleted = []
    for (const part of chunk(ids, rowsPerStatement(db, chunkSize, 1))) {
      let values = part.map(id => storageAdapter.translateFilterValue('id', id))
      if (hasWriteConditions(context, scopeName)) {
        // The caller's ownership narrows the delete too: lock the rows that still match, then delete exactly those.
        const matching = applyWriteConditions({ query: db(tableName).whereIn(idColumn, values), context, scopeName, storageAdapter, tableName })
        values = (await applyDatabaseReadOptions(lockRows(matching, db).select({ id: databaseIdentityExpression(db, idColumn) }))).map(row => row.id)
        if (!values.length) continue
      }
      await db(tableName).whereIn(idColumn, values).delete()
      await deletePivotReferences(api, scopeName, context, values)
      deleted.push(...values)
    }
    return deleted
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
    const query = applyWriteConditions({
      query: context.db(tableName).whereIn(idColumn, ids.map(id => storageAdapter.translateFilterValue('id', id))).orderBy(idColumn),
      context,
      scopeName,
      storageAdapter,
      tableName
    })
    return readRecords({ scopeName, context, query: lockRows(query, context.db), tableName })
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
    const { query } = await dataScopedQuery({ scopeName, context, runHooks, purpose: 'claim', filters })
    if (query._statements.some(statement => statement.grouping === 'join')) {
      throw new RestApiValidationError(`claim on '${scopeName}' needs a single-table query, but its filters or row policy add joins`, {
        fields: ['filters'],
        violations: [{ field: 'filters', rule: 'claim_single_table', message: 'A row policy or filter that joins tables cannot be combined with SKIP LOCKED' }]
      })
    }
    for (const { field, direction } of sort) query.orderBy(`${tableName}.${storageAdapter.translateColumn(field)}`, direction)
    if (databaseFamily(db) !== 'mysql') {
      // PostgreSQL locks rows as the LIMIT takes them; SQLite has one writer.
      return readRecords({ scopeName, context, query: lockRows(query.limit(limit), db, { skipLocked: true }), tableName })
    }

    // InnoDB locks every row a locking read examines, including rows a sort
    // reads and the LIMIT then drops, so one claim would hold every match.
    // Instead: candidates in sort order by a plain read; then, for windows of
    // candidates no larger than what is still needed, a SKIP LOCKED lock by
    // primary key on the bare table, and a read of the held rows under the lock
    // that drops any a committed change made stop matching.
    const claimed = { data: [] }
    const identity = { id: databaseIdentityExpression(db, idColumn) }
    const pageSize = Math.max(limit * 2, 20)
    for (let offset = 0; claimed.data.length < limit; offset += pageSize) {
      const candidates = (await applyDatabaseReadOptions(query.clone().offset(offset).limit(pageSize).select(identity))).map(row => row.id)
      for (let next = 0; next < candidates.length && claimed.data.length < limit;) {
        const window = candidates.slice(next, next + limit - claimed.data.length)
        next += window.length
        const byKey = applyWriteConditions({ query: db(tableName).whereIn(idColumn, window), context, scopeName, storageAdapter, tableName })
        const held = (await applyDatabaseReadOptions(byKey.forUpdate().skipLocked().select(identity))).map(row => row.id)
        if (!held.length) continue
        const { query: current } = await dataScopedQuery({ scopeName, context, runHooks, purpose: 'claim', filters })
        const document = await readRecords({ scopeName, context, query: current.whereIn(idColumn, held).forUpdate().skipLocked(), tableName })
        const order = new Map(window.map((id, position) => [String(id), position]))
        claimed.data.push(...document.data.sort((left, right) => order.get(String(left.id)) - order.get(String(right.id))))
      }
      if (candidates.length < pageSize) break
    }
    return claimed
  }

  return { dataScopedQuery, dataVisibleIds, dataIdsByKeys, dataInsertMany, dataUpdateByIds, dataDeleteByIds, dataLockByIds, dataClaim }
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
