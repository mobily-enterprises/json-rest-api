// Many-row storage: scoped builders, visible-id reads, multi-row inserts, by-id
// CASE updates, by-id deletes and, on table storage, row locks. Every write
// runs one statement per chunk; none of them runs through the filter hooks, so
// MySQL never sees an UPDATE or DELETE whose subquery reads its own table.
import { RestApiBulkInsertIdsError, RestApiBulkWriteUnsupportedError, RestApiResourceError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { handledQueryError } from '../../../../lib/error-context.js'
import { withQueryFilteringContext } from '../querying/query-builder-utils.js'
import { lockConditionSubqueries } from '../querying/subquery-locks.js'
import { ANY_OWNER, applyWriteConditions, hasWriteConditions, writeConditions } from '../querying/query-constraint.js'
import { applyDatabaseReadOptions, databaseIdentityExpression, normalizeStoredFieldValue } from '../querying-writing/database-value-normalizers.js'
import { currentKnexMysqlSchema, listKnexMysqlIndexes, listKnexUniqueKeyColumns } from '../dbIntrospection.js'
import { applyFieldSelectionToQuery, buildFieldSelection } from '../querying-writing/knex-field-helpers.js'
import { applyInsertReturning, databaseFamily } from '../querying-writing/database-capabilities.js'
import { blobRowsPerStatement } from '../querying-writing/blob-fields.js'
import { loadRelationshipIdentifiers } from '../querying/relationship-identifiers.js'
import { resolveSearchOperator } from '../querying/knex-query-helpers.js'
import { buildJsonApiResponse } from '../querying/knex-json-api-transformers-querying.js'
import { deletePivotReferences } from '../writing/many-to-many-manipulations.js'

// Bound parameters one statement may carry, with headroom for predicates.
const PLACEHOLDER_LIMITS = { sqlite: 32000, pg: 65000, mysql: 65000 }
// Knex writes a SQLite multi-row INSERT as SELECT … UNION ALL, and SQLite caps a compound SELECT at 500 terms.
const SQLITE_INSERT_ROWS = 500

// The mysql and mysql2 drivers' client flag that makes an UPDATE count the rows it matched.
const FOUND_ROWS = 0x2

// The canonical AnyAPI table's own row id, behind each row's logical id.
const CANONICAL_ROW_ID = 'id'

// The row locks lockRows takes (see resolveLockMode).
const LOCK_MODES = new Set(['update', 'noKeyUpdate', 'share'])

/** A column's value as text, for a canonical row's logical id. @param {any} db @param {string} column */
const textOf = (db, column) => db.raw(databaseFamily(db) === 'mysql' ? 'CAST(?? AS CHAR)' : 'CAST(?? AS TEXT)', [column])

/**
 * A MySQL or MariaDB duplicate-key error (ER_DUP_ENTRY, ER_DUP_ENTRY_WITH_KEY_NAME):
 * the statement that met it is undone, and the transaction goes on.
 * @param {any} error
 */
export const isDuplicateKeyError = error => error?.errno === 1062 || error?.errno === 1586

/**
 * Refuses a selection write on MySQL or MariaDB whose scope joins a derived
 * table, as a filter on another table's field does: InnoDB reads a derived
 * table from the snapshot without locking it, so the write could not re-check
 * that filter on a row it waited for.
 * @param {{ db: any, scope: any, filters?: Record<string, unknown>, method: string, scopeName: string }} request
 */
function refuseUnlockedSelection ({ db, scope, filters, method, scopeName }) {
  if (!filters || !Object.keys(filters).length || databaseFamily(db) !== 'mysql') return
  if (!scope._statements.some(statement => statement.grouping === 'join' && typeof statement.table !== 'string')) return
  const message = `${method} on '${scopeName}' filters on another table, which MySQL and MariaDB read from the transaction snapshot without locking it; filter on the row's own columns instead, for example on a link after locking its targets with lockByIds`
  throw new RestApiValidationError(message, { fields: ['filters'], violations: [{ field: 'filters', rule: 'selection_cross_table', message }] })
}

/**
 * Whether an UPDATE's count is the rows it matched. PostgreSQL and SQLite
 * always count those; MySQL and MariaDB do so only on a connection with the
 * FOUND_ROWS client flag, the drivers' default, and count the rows it changed
 * otherwise. A connection this cannot see counts as not.
 * @param {any} db
 */
export async function countsMatchedRows (db) {
  if (databaseFamily(db) !== 'mysql') return true
  if (!db.isTransaction) return false
  // A transaction's client hands back its own connection.
  const connection = await db.client.acquireConnection()
  return ((connection?.config?.clientFlags ?? 0) & FOUND_ROWS) !== 0
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
 * The many-row helpers of table storage and, with the AnyAPI plugin's scoped
 * query and link cleanup, of canonical AnyAPI storage, whose rows of every
 * tenant and resource share one table.
 * @param {object} dependencies
 * @param {any} dependencies.api
 * @param {(scopeName: string) => any} dependencies.getScopeStorageAdapter
 * @param {Record<string, any>} dependencies.scopes
 * @param {any} dependencies.log
 * @param {(request: { scopeName: string, context: any, runHooks: Function, alias?: string, purpose: string, filters?: Record<string, unknown> }) => Promise<{ query: any, alias: string }>} [dependencies.scopedQuery]
 *   The storage's scoped query; table storage's own by default.
 * @param {(scopeName: string, context: any, ids: Array<string | number>) => Promise<void>} [dependencies.deleteLinks]
 *   Removes the many-to-many links of deleted rows; table storage's pivot rows by default.
 */
export function createManyRowDataHelpers ({ api, getScopeStorageAdapter, scopes, log, scopedQuery, deleteLinks }) {
  const adapterFor = scopeName => {
    const adapter = getScopeStorageAdapter(scopeName)
    if (!adapter) throw new Error(`Storage adapter for resource '${scopeName}' not found`)
    return adapter
  }
  // The resource's rows: its table, or its tenant's and resource's rows of the
  // canonical table, where the same logical id can belong to other resources.
  const rowsOf = (storageAdapter, db) => storageAdapter.buildBaseQuery({ transaction: db })
  // AnyAPI's canonical descriptor (tenant, resource and id columns), or null for table storage.
  const canonicalOf = (scopeName, storageAdapter) => storageAdapter.isCanonical() ? scopes[scopeName].vars.schemaInfo.descriptor : null
  // A new row as stored. A canonical row names its tenant and resource, and
  // its logical id when the input gives one.
  const newStorageRow = (scopeName, storageAdapter, attributes, context) => {
    const row = storageAdapter.toStorageRow(attributes, { context, operation: 'post' })
    const canonical = canonicalOf(scopeName, storageAdapter)
    if (!canonical) return row
    const { tenantColumn, resourceColumn } = canonical.canonical
    return { ...row, [tenantColumn]: canonical.tenant, [resourceColumn]: canonical.resource, ...(attributes.id != null ? { [storageAdapter.getIdColumn()]: String(attributes.id) } : {}) }
  }

  // The unique index found to cover each table's key columns. A missing index is
  // looked for again on the next call, so adding one needs no restart.
  /** @type {Map<string, { columns: string[], exact: boolean }>} */
  const coveredKeys = new Map()
  /**
   * Refuses conflict keys that no unique index covers. Without one, the keys
   * could match several rows, and a locking read on them would examine (and on
   * MySQL lock) every row of the table. Returns the index that covers them, one
   * on exactly the keys when there is one: `ON CONFLICT` must name an index's
   * exact columns, and keys that include an ownership column the index lacks
   * name none. (Partial indexes do not count: rows outside their predicate can
   * share the keys.)
   * @returns {Promise<{ columns: string[], exact: boolean }>}
   */
  const requireUniqueKeys = async ({ scopeName, db, tableName, keyColumns, canonical }) => {
    // A canonical row's keys are its tenant's and resource's.
    const columns = canonical ? [canonical.canonical.tenantColumn, canonical.canonical.resourceColumn, ...keyColumns] : keyColumns
    const cacheKey = JSON.stringify([tableName, [...columns].sort()])
    const cached = coveredKeys.get(cacheKey)
    if (cached) return cached
    const covering = (await listKnexUniqueKeyColumns(db, tableName)).filter(unique => unique.every(column => columns.includes(column)))
    const exact = covering.find(unique => unique.length === new Set(columns).size)
    if (!covering.length) {
      throw new RestApiBulkWriteUnsupportedError({
        resourceType: scopeName,
        operation: 'postMany',
        reason: canonical
          ? "AnyAPI storage has a unique key only on the id; use onConflict keys: ['id']"
          : `no unique index of '${tableName}' covers the onConflict keys (${keyColumns.join(', ')}); add one, so that the keys identify one row`
      })
    }
    const index = { columns: exact || covering[0], exact: Boolean(exact) }
    coveredKeys.set(cacheKey, index)
    return index
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
  // The scope of a write, aliased as the table so qualified columns stay valid.
  const writeScope = (request) => (scopedQuery || dataScopedQuery)({ ...request, alias: adapterFor(request.scopeName).getTableName() })

  /**
   * Identifiers the caller may touch, in id order: those of `ids` that are
   * visible, or one keyset page of the rows `filters` select. With `lockMode`
   * (a selection write's), MySQL and MariaDB read the page with that row lock:
   * a plain read there comes from the transaction's snapshot, fixed at its
   * first plain read, so it would miss rows committed since, as UPDATE …
   * WHERE never does. A PostgreSQL statement reads what was committed when it
   * began, and SQLite has one writer.
   * @param {{ scopeName: string, context: any, runHooks: Function, ids?: unknown[], filters?: Record<string, unknown>, queryPurpose: string, after?: unknown, limit?: number, lockMode?: 'update' | 'noKeyUpdate' }} request
   * @returns {Promise<Array<string | number>>}
   */
  const dataVisibleIds = async ({ scopeName, context, runHooks, ids, filters, queryPurpose, after, limit, lockMode }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.db || api.knex.instance
    const tableName = storageAdapter.getTableName()
    const idColumn = `${tableName}.${storageAdapter.getIdColumn()}`
    const { query } = await writeScope({ scopeName, context, runHooks, purpose: queryPurpose, filters })
    // A selection write reads its rows here first, so it is refused here whatever rows match.
    if (queryPurpose === 'bulk-write') refuseUnlockedSelection({ db, scope: query, filters, method: context.method, scopeName })
    if (ids) query.whereIn(idColumn, ids.map(id => storageAdapter.translateFilterValue('id', id)))
    if (after !== undefined) query.where(idColumn, '>', storageAdapter.translateFilterValue('id', after))
    // Policy joins can repeat a row; the identity projection keeps big integers exact.
    query.distinct({ id: databaseIdentityExpression(db, idColumn) }).orderBy(idColumn)
    if (limit) query.limit(limit)
    if (lockMode && databaseFamily(db) === 'mysql') lockRows(query, db, { lockMode })
    const rows = await applyDatabaseReadOptions(query)
    return rows.map(row => row.id)
  }

  /**
   * The stored identifier of the row each input row matches by `keys`, or
   * undefined, read with a row lock (SQLite's single writer needs none), one
   * statement per chunk. Upserts decide from it which rows to insert and which
   * to merge. With `lock: false` a plain read, which locks nothing: on MySQL
   * and MariaDB under REPEATABLE READ it answers from the transaction's
   * snapshot, so its answer is only where to look (see insertIgnoringOnMysql).
   * @param {{ scopeName: string, context: any, rows: Record<string, unknown>[], keys: string[], chunkSize: number, lock?: boolean }} request
   * @returns {Promise<Array<string | number | undefined>>}
   */
  const dataIdsByKeys = async ({ scopeName, context, rows, keys, chunkSize, lock = true }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const tableName = storageAdapter.getTableName()
    const keyColumns = keys.map(field => storageAdapter.translateColumn(field))
    await requireUniqueKeys({ scopeName, db, tableName, keyColumns, canonical: canonicalOf(scopeName, storageAdapter) })
    if (lock) await takeSqliteWriteLock(db, tableName, storageAdapter.getIdColumn())
    const storageRows = rows.map(attributes => newStorageRow(scopeName, storageAdapter, attributes, context))
    const matcher = conflictKeyMatcher(scopes[scopeName].vars.schemaInfo.schemaStructure, keys, keyColumns)
    const inputKeys = rows.map((attributes, index) => matcher.input(attributes, storageRows[index]))
    const wanted = new Set(inputKeys)
    const found = new Map()
    for (const part of chunk(storageRows, rowsPerStatement(db, chunkSize, keyColumns.length))) {
      const query = rowsOf(storageAdapter, db)
        .whereIn(keyColumns, part.map(row => keyColumns.map(column => row[column] ?? null)))
        .select({ id: databaseIdentityExpression(db, storageAdapter.getIdColumn()) }, ...keyColumns)
      for (const row of await applyDatabaseReadOptions(lock ? lockRows(query, db) : query)) {
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

  // The most rows a statement writing `columns` holds by their blobs (see blobRowsPerStatement).
  const blobRows = (scopeName, storageAdapter, db, columns) => blobRowsPerStatement(
    db, scopes[scopeName].vars.schemaInfo, field => storageAdapter.translateColumn(field), columns, api.knex.capabilities?.dbInfo?.maxAllowedPacket
  )

  /**
   * An ignore upsert on MySQL and MariaDB, whose ON DUPLICATE KEY fires on
   * every unique index, the primary key included: the rows whose keys a stored
   * row holds are left out, and the others go in with a plain INSERT, so a
   * clash on any other unique index fails the batch.
   * A locking read of a key no row holds locks the gap where the key would
   * go, and gap locks never wait for each other: two transactions that each
   * read a new key in one gap that way, then insert it, each wait for the
   * other's gap lock, a deadlock. So the keys are first read plainly, which
   * locks nothing; the rows it finds no match for go in at once, and an INSERT
   * takes no gap lock (it waits only for an uncommitted row with its key). The
   * rows it finds are locked by their keys, which as stored keys lock those
   * rows alone; one deleted since the transaction's snapshot is inserted after
   * all. A row the plain read missed, committed since the snapshot or while the
   * INSERT waited for it, fails that INSERT's statement as a duplicate key,
   * which undoes the statement only: the rows from that statement on are then
   * read with the lock, as before, and only the missing ones inserted.
   * @param {{ scopeName: string, context: any, rows: Record<string, unknown>[], chunkSize: number, needIds: boolean, keys: string[] }} request
   * @returns {Promise<Array<string | number | undefined> | undefined>}
   */
  const insertIgnoringOnMysql = async ({ scopeName, context, rows, chunkSize, needIds, keys }) => {
    /** @type {Array<string | number | undefined>} */
    const ids = new Array(rows.length)
    /** @param {number[]} indexes */
    const lockThenInsert = async indexes => {
      const existing = await dataIdsByKeys({ scopeName, context, rows: indexes.map(index => rows[index]), keys, chunkSize })
      const missing = indexes.filter((_index, position) => existing[position] === undefined)
      const inserted = missing.length
        ? await dataInsertMany({ scopeName, context, rows: missing.map(index => rows[index]), chunkSize, needIds })
        : []
      missing.forEach((index, position) => { ids[index] = inserted?.[position] })
    }
    const seen = await dataIdsByKeys({ scopeName, context, rows, keys, chunkSize, lock: false })
    const stored = rows.flatMap((_row, index) => seen[index] === undefined ? [] : [index])
    const fresh = rows.flatMap((_row, index) => seen[index] === undefined ? [index] : [])
    if (stored.length) await lockThenInsert(stored)
    if (fresh.length) {
      const written = new Map()
      try {
        await dataInsertMany({ scopeName, context, rows: fresh.map(index => rows[index]), chunkSize, needIds, written })
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error
        handledQueryError(context.transaction, error)
      }
      fresh.forEach((index, position) => { if (written.has(position)) ids[index] = written.get(position) })
      const rest = fresh.filter((_index, position) => !written.has(position))
      if (rest.length) await lockThenInsert(rest)
    }
    return needIds ? ids : undefined
  }

  /**
   * Insert validated rows with one statement per chunk and column set.
   * Returns the stored identifier for each input row (undefined for rows an
   * ignore conflict skipped), or nothing when `needIds` is false. `written`
   * (without onConflict) records each row once its statement has run, by its
   * position in `rows`, with its stored identifier when the insert reads them:
   * when a later statement fails, it tells which rows are in.
   * @param {{ scopeName: string, context: any, rows: Record<string, unknown>[], chunkSize: number, needIds: boolean, onConflict?: { keys: string[], action: 'ignore' }, written?: Map<number, string | number | undefined> }} request
   * @returns {Promise<Array<string | number | undefined> | undefined>}
   */
  const dataInsertMany = async ({ scopeName, context, rows, chunkSize, needIds, onConflict, written }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const tableName = storageAdapter.getTableName()
    const idColumn = storageAdapter.getIdColumn()
    const family = databaseFamily(db)
    /** @type {Array<string | number | undefined>} */
    const ids = new Array(rows.length)

    if (onConflict && family === 'mysql') return insertIgnoringOnMysql({ scopeName, context, rows, chunkSize, needIds, keys: onConflict.keys })

    const canonical = canonicalOf(scopeName, storageAdapter)
    const storageRows = rows.map(attributes => newStorageRow(scopeName, storageAdapter, attributes, context))
    const keyColumns = onConflict?.keys.map(field => storageAdapter.translateColumn(field))
    // ON CONFLICT names the unique index on the keys. When the only one is on
    // fewer columns (the keys add an ownership column, say), a row it skips
    // clashed on that index, which is a match only if the keys match too.
    const arbiter = onConflict ? await requireUniqueKeys({ scopeName, db, tableName, keyColumns, canonical }) : undefined
    const readIds = needIds || (arbiter !== undefined && !arbiter.exact)

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
      // A canonical row without a logical id gets its row id as one: the
      // insert reads the generated row ids back, and one UPDATE copies them.
      // Such a row cannot clash on the logical id.
      const generated = Boolean(canonical) && !Object.hasOwn(storageRows[indexes[0]], idColumn)
      const returnColumn = generated ? CANONICAL_ROW_ID : idColumn
      const conflict = onConflict && !generated ? onConflict : undefined
      const size = Math.min(rowsPerStatement(db, chunkSize, columns.length + 1, { insert: true }), blobRows(scopeName, storageAdapter, db, columns))
      for (const part of chunk(indexes, size)) {
        const values = part.map(index => storageRows[index])
        let query = db(tableName).insert(values)
        // Only a clash on the conflict keys is skipped; any other unique index still fails.
        if (conflict) query = query.onConflict(arbiter.columns).ignore()

        if (!readIds && !generated) {
          await query
          for (const index of part) written?.set(index, undefined)
          continue
        }

        /** @type {Array<string | number | undefined>} */
        let stored
        if (family === 'mysql' && supportsMariaDbReturning(api.knex.capabilities)) {
          const [returned] = await db.raw('? returning ??', [query, returnColumn])
          stored = returned.map(row => row[returnColumn])
        } else if (family === 'mysql') {
          const explicit = values.every(row => row[returnColumn] !== undefined && row[returnColumn] !== null)
          if (!explicit && increment === undefined) {
            const [[setting]] = await db.raw('select @@session.auto_increment_increment as step')
            increment = Number(setting.step)
          }
          const [firstId] = await query
          stored = explicit
            ? values.map(row => row[returnColumn])
            : await verifyMysqlInsertIds({ db, tableName, idColumn: returnColumn, values, firstId, increment, scopeName, schemaInfo: context.schemaInfo, storageAdapter })
        } else {
          const returnColumns = { [returnColumn]: databaseIdentityExpression(db, returnColumn) }
          for (const column of conflict ? keyColumns : []) returnColumns[`__jra_key_${column}`] = column
          let returned = await applyDatabaseReadOptions(applyInsertReturning(query, returnColumns))
          if (conflict) {
            // Ignored rows return nothing, so returned rows are matched to inputs by their keys.
            const matcher = conflictKeyMatcher(scopes[scopeName].vars.schemaInfo.schemaStructure, conflict.keys, keyColumns)
            const byKey = new Map(returned.map(row => [matcher.stored(Object.fromEntries(keyColumns.map(column => [column, row[`__jra_key_${column}`]]))), row[returnColumn]]))
            stored = part.map((index, position) => byKey.get(matcher.input(rows[index], values[position])))
          } else {
            if (family === 'sqlite' && values.some(row => row[returnColumn] === undefined || row[returnColumn] === null)) {
              // SQLite does not promise RETURNING order; generated row ids increase in insertion order.
              returned = [...returned].sort((left, right) => Number(left[returnColumn]) - Number(right[returnColumn]))
            }
            stored = returned.map(row => row[returnColumn])
          }
        }
        if (generated) {
          await rowsOf(storageAdapter, db).whereIn(CANONICAL_ROW_ID, stored).update({ [idColumn]: textOf(db, CANONICAL_ROW_ID) })
          stored = stored.map(id => String(id))
        }
        part.forEach((index, position) => {
          ids[index] = stored[position]
          written?.set(index, stored[position])
        })
      }
    }
    if (arbiter && !arbiter.exact) {
      const skipped = rows.flatMap((_row, index) => ids[index] === undefined ? [index] : [])
      const matched = skipped.length ? await dataIdsByKeys({ scopeName, context, rows: skipped.map(index => rows[index]), keys: onConflict.keys, chunkSize }) : []
      if (matched.some(id => id === undefined)) {
        throw new RestApiResourceError(`A ${scopeName} row clashes with a stored record on the unique index (${arbiter.columns.join(', ')}) without matching it by the onConflict keys (${onConflict.keys.join(', ')})`, {
          subtype: 'conflict', resourceType: scopeName
        })
      }
    }
    return needIds ? ids : undefined
  }

  // The rows a by-id UPDATE or DELETE writes: the ids, onlyIf, the caller's
  // ownership conditions and, with `scoped`, the caller's scope (with a
  // selection's filters), built once (its filtering hooks record the ownership
  // conditions). `lockMode` is the row lock it takes (see lockRows).
  const writeMatcher = async ({ scopeName, context, runHooks, scoped, onlyIf, filters, lockMode }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const family = databaseFamily(db)
    const tableName = storageAdapter.getTableName()
    const idColumn = storageAdapter.getIdColumn()
    const identity = { id: databaseIdentityExpression(db, `${tableName}.${idColumn}`) }
    const scope = scoped ? (await writeScope({ scopeName, context, runHooks, purpose: 'bulk-write', filters })).query : null
    const guard = query => applyWriteConditions({ query: applyOnlyIf(query, onlyIf || {}, tableName), context, scopeName, storageAdapter, tableName })
    // The WHERE of the write, with the scope as a subquery.
    const matching = ids => {
      const query = guard(rowsOf(storageAdapter, db).whereIn(idColumn, ids))
      return scope ? query.whereIn(idColumn, scope.clone().whereIn(`${tableName}.${idColumn}`, ids).clearSelect().select(`${tableName}.${idColumn}`)) : query
    }
    // A selection's filters must hold for a row as it is once locked, after any
    // wait for another writer, or two writers that both matched the old row
    // would both write it. A subquery does not see that row: InnoDB reads it
    // from the transaction snapshot, PostgreSQL as of the statement's start.
    const selection = Boolean(scope && filters && Object.keys(filters).length)
    if (selection) refuseUnlockedSelection({ db, scope, filters, method: context.method, scopeName })
    return {
      matching,
      // PostgreSQL: lock the rows first, so the statement that writes them
      // starts after any wait and reads what their holder committed.
      settle: async ids => {
        if (selection && family === 'pg') await lockRows(rowsOf(storageAdapter, db).whereIn(idColumn, ids).orderBy(idColumn), db, { lockMode }).select(idColumn)
      },
      // The ids that still match, locked. MySQL and MariaDB check a selection's
      // scope and filters in the locking read's own query block, on the
      // current row.
      locked: async ids => {
        const query = selection && family === 'mysql'
          ? guard(scope.clone().whereIn(`${tableName}.${idColumn}`, ids)).clearSelect()
          : matching(ids)
        const rows = await applyDatabaseReadOptions(lockRows(query, db, { lockMode }).select(identity))
        // A join of the scope or the filters can repeat a row.
        return [...new Map(rows.map(row => [String(row.id), row.id])).values()]
      }
    }
  }

  /**
   * Update visible rows by id: one UPDATE per chunk, `CASE id WHEN … THEN …`
   * for values that differ between rows and a plain SET for shared ones.
   * With `scoped`, each statement carries the caller's scope (row policy
   * included) and `filters` as a subquery.
   * Returns the identifiers the statements changed.
   * @param {{ scopeName: string, context: any, runHooks?: Function, updates: Array<{ id: string | number, row: Record<string, unknown> }>, onlyIf?: Record<string, unknown>, chunkSize: number, scoped?: boolean, filters?: Record<string, unknown>, lockMode?: 'update' | 'noKeyUpdate' }} request
   * @returns {Promise<Array<string | number>>}
   */
  const dataUpdateByIds = async ({ scopeName, context, runHooks, updates, onlyIf, chunkSize, scoped = false, filters, lockMode }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const idColumn = storageAdapter.getIdColumn()
    const family = databaseFamily(db)
    const lockVersionColumn = context.schemaInfo.lockVersionField ? storageAdapter.translateColumn(context.schemaInfo.lockVersionField) : null
    const written = new Set(updates.flatMap(update => Object.keys(update.row)))
    const columnCount = written.size
    const { matching, settle, locked } = await writeMatcher({ scopeName, context, runHooks, scoped, onlyIf, filters, lockMode })
    // onlyIf, the scope and the caller's ownership narrow each statement; without them every listed id is written.
    const guarded = scoped || Boolean(onlyIf) || hasWriteConditions(context, scopeName)
    const changed = []

    // A scoped statement binds each id twice, once more in its subquery.
    const size = Math.min(rowsPerStatement(db, chunkSize, 2 * columnCount + (scoped ? 2 : 1)), blobRows(scopeName, storageAdapter, db, written))
    for (const part of chunk(updates, size)) {
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
        if (writes) await rowsOf(storageAdapter, db).whereIn(idColumn, ids).update(set)
        changed.push(...part.map(update => update.id))
      } else if (family === 'mysql' || !writes) {
        // MySQL cannot return updated rows. One row's UPDATE answers from its
        // count when that counts matched rows; with a scope subquery it would
        // name the updated table, which MySQL refuses.
        if (writes && !scoped && part.length === 1 && await countsMatchedRows(db)) {
          if (await matching(ids).update(set)) changed.push(part[0].id)
          continue
        }
        // Otherwise lock the rows that match, then update exactly those.
        await settle(ids)
        const matched = await locked(ids)
        if (matched.length && writes) await rowsOf(storageAdapter, db).whereIn(idColumn, matched).update(set)
        changed.push(...matched)
      } else {
        await settle(ids)
        const rows = await applyDatabaseReadOptions(matching(ids).returning({ id: databaseIdentityExpression(db, idColumn) }).update(set))
        changed.push(...rows.map(row => row.id))
      }
    }
    return changed
  }

  /**
   * Delete visible rows by id, one DELETE per chunk, then their many-to-many links.
   * With `scoped`, each DELETE carries the caller's scope and `filters` (see
   * dataUpdateByIds).
   * Returns the identifiers the statements deleted.
   * @param {{ scopeName: string, context: any, runHooks?: Function, ids: Array<string | number>, chunkSize: number, scoped?: boolean, filters?: Record<string, unknown> }} request
   * @returns {Promise<Array<string | number>>}
   */
  const dataDeleteByIds = async ({ scopeName, context, runHooks, ids, chunkSize, scoped = false, filters }) => {
    const storageAdapter = adapterFor(scopeName)
    const db = context.transaction
    const family = databaseFamily(db)
    const idColumn = storageAdapter.getIdColumn()
    const identity = { id: databaseIdentityExpression(db, idColumn) }
    const { matching, settle, locked } = await writeMatcher({ scopeName, context, runHooks, scoped, filters })
    const guarded = scoped || hasWriteConditions(context, scopeName)
    const deleted = []
    // A scoped DELETE binds each id twice, and so does AnyAPI's link cleanup.
    const bindings = scoped || storageAdapter.isCanonical() ? 2 : 1
    for (const part of chunk(ids, rowsPerStatement(db, chunkSize, bindings))) {
      let values = part.map(id => storageAdapter.translateFilterValue('id', id))
      if (guarded && family === 'pg') {
        // The scope and the caller's ownership narrow the DELETE, which returns the rows it removed.
        await settle(values)
        values = (await applyDatabaseReadOptions(matching(values).returning(identity).delete())).map(row => row.id)
      } else if (guarded && family === 'sqlite') {
        // Knex reads no rows back from a SQLite DELETE, so its RETURNING runs as
        // raw SQL around the builder, which keeps its own bindings: a '?' inside
        // a string literal of a row policy stays text.
        values = (await db.raw('? returning ? as ??', [matching(values).delete(), identity.id, 'id'])).map(row => row.id)
      } else if (guarded) {
        // MySQL cannot return deleted rows: lock the rows that still match, then delete exactly those.
        values = await locked(values)
        if (values.length) await rowsOf(storageAdapter, db).whereIn(idColumn, values).delete()
      } else {
        await rowsOf(storageAdapter, db).whereIn(idColumn, values).delete()
      }
      if (!values.length) continue
      await (deleteLinks ? deleteLinks(scopeName, context, values) : deletePivotReferences(api, scopeName, context, values))
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

  // SQLite has one writer, but a deferred transaction's reads take only a shared
  // lock: two connections could both read as if they held the rows, and the
  // later write would fail with SQLITE_BUSY halfway through. A write statement
  // takes the write lock even when it changes nothing, so a SQLite lock read
  // starts with one, once per transaction; the lock read itself is then plain.
  const writeLocked = new WeakSet()
  const takeSqliteWriteLock = async (db, tableName, idColumn) => {
    if (databaseFamily(db) !== 'sqlite' || writeLocked.has(db)) return
    await db(tableName).whereRaw('0 = 1').update({ [idColumn]: db.ref(idColumn) })
    writeLocked.add(db)
  }

  /**
   * FOR UPDATE; with lockMode 'noKeyUpdate' on PostgreSQL FOR NO KEY UPDATE,
   * which does not block another transaction's foreign key checks on the rows
   * (elsewhere FOR UPDATE); with 'share' FOR SHARE, which Knex writes LOCK IN
   * SHARE MODE on MySQL and MariaDB. SQLite takes no row lock. Another mode
   * throws instead of locking as for 'update'.
   * @param {any} query @param {import('knex').Knex} db
   * @param {{ skipLocked?: boolean, lockMode?: 'update' | 'noKeyUpdate' | 'share' }} [options]
   */
  const lockRows = (query, db, { skipLocked = false, lockMode = 'update' } = {}) => {
    if (!LOCK_MODES.has(lockMode)) throw new TypeError(`Unknown row lock mode ${JSON.stringify(lockMode)}: it is 'update', 'noKeyUpdate' or 'share'`)
    const family = databaseFamily(db)
    if (family === 'sqlite') return query
    if (lockMode === 'share') query.forShare()
    else if (lockMode === 'noKeyUpdate' && family === 'pg') query.forNoKeyUpdate()
    else query.forUpdate()
    return skipLocked ? query.skipLocked() : query
  }

  // The scoped query of a lock or claim, refused unless it is still a SELECT on
  // the resource's own table: FOR UPDATE on a derived table or a common table
  // expression locks nothing and reads the transaction snapshot, and InnoDB
  // would lock every joined row the read examines. A lock's subqueries (a row
  // policy's, a filter's) lock the rows they read, shared, so it decides from
  // the rows as last committed (see subquery-locks.js). A claim never waits for
  // a lock, so its subqueries stay plain reads.
  const lockingQuery = async ({ scopeName, context, runHooks, operation, purpose, filters }) => {
    const storageAdapter = adapterFor(scopeName)
    const tableName = storageAdapter.getTableName()
    const { query } = await dataScopedQuery({ scopeName, context, runHooks, purpose, filters })
    const added = query._statements.find(statement => ['join', 'with', 'union'].includes(statement.grouping))?.grouping
    if (added || query._single.table !== tableName) {
      const what = { join: 'joins', with: 'a common table expression', union: 'a set operation' }[added] ?? 'another source table'
      const message = `${operation} on '${scopeName}' needs a single-table query, but its filters or row policy add ${what}`
      throw new RestApiValidationError(message, { fields: ['filters'], violations: [{ field: 'filters', rule: `${purpose}_single_table`, message }] })
    }
    if (purpose === 'lock') lockConditionSubqueries(query, context.db)
    await takeSqliteWriteLock(context.db, tableName, storageAdapter.getIdColumn())
    return { query, storageAdapter, tableName, idColumn: `${tableName}.${storageAdapter.getIdColumn()}` }
  }

  /**
   * Lock the visible rows among `ids` in id order and read them, in one locking
   * read that carries the scope and row-policy predicates. No plain read comes
   * first: under REPEATABLE READ (MySQL, MariaDB) it would fix the snapshot
   * before the lock wait, hiding what the lock holder commits meanwhile.
   * Returns the rows the locking read saw as a JSON:API document.
   * @param {{ scopeName: string, context: any, runHooks: Function, ids: Array<string | number>, lockMode?: 'update' | 'noKeyUpdate' | 'share' }} request
   */
  const dataLockByIds = async ({ scopeName, context, runHooks, ids, lockMode }) => {
    const { query, storageAdapter, tableName, idColumn } = await lockingQuery({ scopeName, context, runHooks, operation: 'lockByIds', purpose: 'lock' })
    query.whereIn(idColumn, ids.map(id => storageAdapter.translateFilterValue('id', id))).orderBy(idColumn)
    return readRecords({ scopeName, context, query: lockRows(query, context.db, { lockMode }), tableName })
  }

  // The index lockWhere forces on MySQL and the ORDER BY that reads it, by schema, table, the read's columns and its
  // order (see lockIndexFor).
  const lockIndexes = new Map()

  /**
   * The columns a lockWhere read orders by: `order`'s columns, less those the
   * read fixes to one value (they leave the order as it is), up to the first id
   * or with id added last, so the order is total. Each `{ column, direction }`;
   * an added id takes the direction of the order's last field.
   * @param {Array<{ field: string, direction: 'asc' | 'desc' }>} order
   * @param {any} storageAdapter
   * @param {Set<string>} [fixed] Columns the read compares with one value.
   */
  const lockOrderColumns = (order, storageAdapter, fixed = new Set()) => {
    const idColumn = storageAdapter.getIdColumn()
    const columns = []
    for (const { field, direction } of order) {
      const column = field === 'id' ? idColumn : storageAdapter.translateColumn(field)
      if (fixed.has(column) || columns.some(entry => entry.column === column)) continue
      columns.push({ column, direction })
      if (column === idColumn) return columns
    }
    return [...columns, { column: idColumn, direction: order.at(-1)?.direction ?? 'asc' }]
  }

  /**
   * InnoDB locks every row a locking read examines, and holds those locks until
   * commit. lockWhere on MySQL therefore forces an index that keeps its read
   * inside the caller's rows: one whose leading columns are the whole
   * ownership columns the read is limited to, or, without ownership
   * conditions, one that starts with a column the filters compare. Otherwise
   * the read could walk the primary key, locking other owners' rows and the
   * gaps between them. Invisible and ignored indexes cannot be forced.
   * InnoDB also locks rows in the order it reads them, and a sort it cannot
   * read from the index would lock every match first. So a read with an
   * `order` (a sort or a limit) takes an index that reads in that order: after
   * the columns the read fixes to one value (the ownership columns and the
   * filters' single-value equalities), its columns are the order's, in one
   * direction, the id last or left to the primary key InnoDB ends every
   * secondary index with.
   * Returns the index's name and, for an `order`, the ORDER BY that reads it
   * in that order.
   * @param {{ scopeName: string, context: any, storageAdapter: any, tableName: string, filters?: Record<string, unknown>, order?: Array<{ field: string, direction: 'asc' | 'desc' }> }} request
   * @returns {Promise<{ name: string, orderBy: Array<{ column: string, direction: 'asc' | 'desc' }> | null }>}
   */
  const lockIndexFor = async ({ scopeName, context, storageAdapter, tableName, filters = {}, order }) => {
    const owned = Object.entries(context[writeConditions]?.[scopeName] || {})
      .filter(([, value]) => value !== null && value !== ANY_OWNER)
      .map(([field]) => storageAdapter.translateColumn(field))
    const search = context.schemaInfo.searchSchemaStructure || {}
    const simple = definition => definition && !definition.oneOf && !definition.applyFilter && !definition.polymorphicField && !definition.actualField?.includes('.')
    const columnOf = key => storageAdapter.translateColumn(search[key].actualField || key)
    const compared = Object.keys(filters).filter(key => simple(search[key])).map(columnOf)
    const fixed = new Set([...owned, ...Object.entries(filters)
      .filter(([key, value]) => simple(search[key]) && ['=', '=='].includes(resolveSearchOperator(search[key])) && value !== null && value !== undefined && !Array.isArray(value))
      .map(([key]) => columnOf(key))])
    const ordered = order ? lockOrderColumns(order, storageAdapter, fixed) : null
    // One pool can serve several databases, so the cache is per schema.
    const schema = await currentKnexMysqlSchema(context.db)
    const cacheKey = JSON.stringify([schema, tableName, [...owned].sort(), [...compared].sort(), ordered && [[...fixed].sort(), ordered]])
    if (lockIndexes.has(cacheKey)) return lockIndexes.get(cacheKey)
    const indexes = await listKnexMysqlIndexes(context.db, schema, tableName)
    const leading = owned.length
      ? indexes.filter(({ columns }) => columns.length >= owned.length &&
        columns.slice(0, owned.length).every(column => owned.includes(column.name) && column.prefix === null))
      : indexes.filter(({ columns }) => compared.includes(columns[0]?.name))
    // Among those that read in order, the one that fixes most columns examines the fewest rows.
    const inOrder = ordered && leading.map(candidate => ({ candidate, fixes: fixedColumnsInOrder(candidate.columns, fixed, ordered) }))
      .filter(({ fixes }) => fixes >= 0).sort((left, right) => right.fixes - left.fixes)[0]
    const index = ordered
      ? inOrder?.candidate
      // Among those, one whose next column the filters compare locks fewer rows.
      : leading.find(({ columns }) => compared.includes(columns[owned.length]?.name)) ?? leading[0]
    if (!index) {
      const start = owned.length ? `the whole ownership column(s) ${owned.join(', ')}` : 'a column the filters compare'
      const sorted = ordered?.slice(0, -1).map(({ column }) => column) ?? []
      const then = !ordered
        ? ''
        : `, and after the columns the read fixes to one value holds ${sorted.length ? `${sorted.join(', ')} (all ascending or all descending)` : 'no other column'}, so it reads the rows in the order lockWhere's sort or limit locks them`
      throw new RestApiBulkWriteUnsupportedError({
        resourceType: scopeName,
        operation: 'lockWhere',
        reason: `on MySQL and MariaDB a locking read locks every row it examines, in the order it reads them; add a visible index of '${tableName}' that starts with ${start}${then}`
      })
    }
    // The ORDER BY names the index's own columns after the fixed ones, whose
    // order the rows come in, and the id only where the index holds no other:
    // ties then come in the primary key's order InnoDB ends the index with.
    // MariaDB reads a unique index's implied primary key as no order and would
    // sort the rows, after locking every one, for an ORDER BY that names it.
    const rest = inOrder && index.columns.slice(inOrder.fixes)
    const choice = {
      name: index.name,
      orderBy: !rest ? null : rest.length ? rest.map(({ name }, position) => ({ column: name, direction: ordered[position].direction })) : [ordered.at(-1)]
    }
    lockIndexes.set(cacheKey, choice)
    return choice
  }

  /**
   * Lock up to `limit` visible rows the filters select, waiting for
   * transactions that hold them, in one locking read like dataLockByIds. With
   * `order` (a lock read's sort; empty for id alone) the rows are locked and
   * read in that order, then by id, with ORDER BY; on MySQL on an index that
   * reads in that order, by the ORDER BY lockIndexFor gives. Without it, in id
   * order, except on MySQL, where the read is forced onto the index that
   * lockIndexFor picks and the rows come in its order, as ORDER BY id could
   * walk the primary key. `after` (with an empty `order`) keeps the rows after
   * that id, a range the index's id suffix reads.
   * @param {{ scopeName: string, context: any, runHooks: Function, filters?: Record<string, unknown>, limit: number, order?: Array<{ field: string, direction: 'asc' | 'desc' }>, after?: string | number, lockMode?: 'update' | 'noKeyUpdate' | 'share' }} request
   */
  const dataLockWhere = async ({ scopeName, context, runHooks, filters, limit, order, after, lockMode }) => {
    const read = async () => {
      const { query, storageAdapter, tableName, idColumn } = await lockingQuery({ scopeName, context, runHooks, operation: 'lockWhere', purpose: 'lock', filters })
      if (after !== undefined) query.where(idColumn, '>', storageAdapter.translateFilterValue('id', after))
      let orderBy = order ? lockOrderColumns(order, storageAdapter) : [{ column: storageAdapter.getIdColumn(), direction: 'asc' }]
      if (databaseFamily(context.db) === 'mysql') {
        // Without FORCE INDEX the optimizer could still pick another index or a full scan.
        const index = await lockIndexFor({ scopeName, context, storageAdapter, tableName, filters, order })
        query.from(context.db.raw('?? force index (??)', [tableName, index.name]))
        orderBy = index.orderBy ?? []
      }
      for (const { column, direction } of orderBy) query.orderBy(`${tableName}.${column}`, direction)
      return readRecords({ scopeName, context, query: lockRows(query.limit(limit), context.db, { lockMode }), tableName })
    }
    let document = await read()
    // A PostgreSQL statement finds only the rows committed when it began; after a
    // lock wait it rechecks those, but never sees rows that started to match
    // meanwhile. Read again, under the locks already held, until none appears.
    // (InnoDB's locking reads see the latest rows, and its next-key locks keep
    // new rows out of the range the read has passed.)
    if (databaseFamily(context.db) === 'pg') {
      for (let previous = -1; document.data.length > previous && document.data.length < limit;) {
        previous = document.data.length
        document = await read()
      }
    }
    return document
  }

  /**
   * Take up to `limit` matching rows no other transaction holds.
   * @param {{ scopeName: string, context: any, runHooks: Function, filters?: Record<string, unknown>, sort: Array<{ field: string, direction: 'asc' | 'desc' }>, limit: number, lockMode?: 'update' | 'noKeyUpdate' }} request
   */
  const dataClaim = async ({ scopeName, context, runHooks, filters, sort, limit, lockMode }) => {
    const db = context.db
    const claimQuery = () => lockingQuery({ scopeName, context, runHooks, operation: 'claim', purpose: 'claim', filters })
    const { query, storageAdapter, tableName, idColumn } = await claimQuery()
    for (const { field, direction } of sort) query.orderBy(`${tableName}.${storageAdapter.translateColumn(field)}`, direction)
    if (databaseFamily(db) !== 'mysql') {
      // PostgreSQL locks rows as the LIMIT takes them; SQLite has one writer.
      return readRecords({ scopeName, context, query: lockRows(query.limit(limit), db, { skipLocked: true, lockMode }), tableName })
    }

    // InnoDB locks every row a locking read examines, including rows a sort
    // reads and the LIMIT then drops, so one claim would hold every match.
    // Instead: candidates in sort order by a plain read; then, for windows of
    // candidates no larger than what is still needed, a SKIP LOCKED lock by
    // primary key on the bare table, and a locking read of the held rows that
    // drops any a committed change made stop matching. SKIP LOCKED never waits,
    // so the snapshot the plain read starts misses nothing a lock wait let commit.
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
        const { query: current } = await claimQuery()
        const document = await readRecords({ scopeName, context, query: current.whereIn(idColumn, held).forUpdate().skipLocked(), tableName })
        const order = new Map(window.map((id, position) => [String(id), position]))
        claimed.data.push(...document.data.sort((left, right) => order.get(String(left.id)) - order.get(String(right.id))))
      }
      if (candidates.length < pageSize) break
    }
    return claimed
  }

  return { dataScopedQuery, dataVisibleIds, dataIdsByKeys, dataInsertMany, dataUpdateByIds, dataDeleteByIds, dataLockByIds, dataLockWhere, dataClaim }
}

// How many leading columns of a MySQL index a lockWhere fixes to one value,
// when the index reads its rows in `ordered`'s order; -1 when it does not.
// After those columns it holds the order's, the id last or left to the primary
// key InnoDB ends every secondary index with, all in one direction (InnoDB
// reads an index forward or backward). A column prefix, a descending key part
// and an index that keeps no order (FULLTEXT) order nothing here.
function fixedColumnsInOrder (columns, fixed, ordered) {
  if (ordered.some(({ direction }) => direction !== ordered[0].direction)) return -1
  let start = 0
  while (start < columns.length && columns[start].prefix === null && fixed.has(columns[start].name)) start++
  const rest = columns.slice(start)
  const wanted = ordered.map(({ column }) => column)
  const reads = list => rest.length === list.length && rest.every((column, index) => column.prefix === null && column.ascending && column.name === list[index])
  return reads(wanted) || reads(wanted.slice(0, -1)) ? start : -1
}

const sameValue = (left, right) => {
  if (left === right) return true
  if (isRawValue(left) || isRawValue(right)) return false
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return false
}

function applyOnlyIf (query, onlyIf, tableName) {
  for (const [column, value] of Object.entries(onlyIf)) {
    if (value === null) query.whereNull(`${tableName}.${column}`)
    else query.where(`${tableName}.${column}`, value)
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
  const rows = await applyDatabaseReadOptions(storageAdapter.buildBaseQuery({ transaction: db }).whereIn(idColumn, expected).orderBy(idColumn)
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
