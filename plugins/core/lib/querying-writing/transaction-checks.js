// @ts-check
import { isOpenManagedTransaction, onTransactionFinished } from '../../../../lib/error-context.js'
import { databaseFamily } from './database-capabilities.js'

// A write checks each row it links to, and a read each to-one link it answers,
// with a scoped read of the rows' ids. One transaction often checks the same row
// many times: a setup writing many rows that each name the same user, or a row
// it has just checked and linked again. Inside a transaction from
// api.transaction, a check is answered from the transaction's own earlier
// check of the same row when nothing it sent since could have changed the
// answer, so each row is read once per transaction instead of once per write.
//
// A check is remembered under its statement: the table, the scope the context
// gave it (ownership, row policy, any filter hook) and their bound values, as
// SQL with the id list left out. Two checks share an answer only when they would
// send the same statement for the row, so another workspace, user or policy
// outcome never reads another's answer; the hooks still run for every check, as
// before. Only rows found are remembered; a row not found is read again.
//
// A remembered row also keeps the lock its read took: a later check needing the
// same or a weaker lock reuses it, a stronger one reads again. A locked answer
// also answers a later plain read of the row, as of the moment it was locked.
// An answer holds for the rest of the transaction as of its first check: under
// REPEATABLE READ the database would answer the same from the transaction's
// snapshot or locks; under READ COMMITTED a later read could see another
// transaction's commit, and the remembered answer does not.
//
// The memo watches every statement the transaction sends, the library's and any
// sent on it by hand:
// - a SELECT changes nothing;
// - an INSERT or UPDATE of a table forgets every check whose statement names that
//   table, its policy's subqueries included;
// - an UPDATE that sets a column any remembered check names (an ownership column
//   such as workspace_id, an id) forgets everything, since another table's
//   foreign key may cascade it;
// - a DELETE (whose foreign key actions reach other tables), an upsert, a
//   savepoint's rollback or release, several statements sent as one, and any
//   other statement forget everything.
// It cannot see what the database does by itself: a trigger's writes, a cascade
// from a key column no remembered check names, or a policy that reads a table
// only through a view, a function or session state.
//
// The memo belongs to the transaction object and ends with it: never shared
// with another transaction, and none outside a transaction.

/** Lock strengths, weakest first: a row held at one strength answers a check needing it or less. */
export const LOCK_STRENGTH = Object.freeze({ none: 0, keyShare: 1, share: 2, update: 3 })

// The most rows one transaction remembers; past it, checks still read.
const MAX_REMEMBERED_ROWS = 10000

/**
 * @typedef {{ key: string, words: Set<string> }} CheckScope
 * @typedef {{ words: Set<string>, rows: Map<string, number> }} RememberedCheck
 * @typedef {{
 *   scopeOf: (query: any, idPredicate: unknown, idColumn: string) => CheckScope | undefined,
 *   known: (scope: CheckScope, ids: Iterable<string>, strength: number) => Set<string>,
 *   started: () => number,
 *   remember: (scope: CheckScope, ids: Iterable<string>, strength: number, started: number) => void
 * }} TransactionChecks
 */

/** @type {WeakMap<object, TransactionChecks>} */
const memos = new WeakMap()

/**
 * The lock strength a check read with `lock` takes, as lockTargetRows takes it.
 * @param {{ exclusive?: boolean, keyShare?: boolean } | undefined} lock
 * @param {import('knex').Knex} db
 */
export function lockStrength (lock, db) {
  if (!lock) return LOCK_STRENGTH.none
  if (lock.exclusive) return LOCK_STRENGTH.update
  return lock.keyShare && databaseFamily(db) === 'pg' ? LOCK_STRENGTH.keyShare : LOCK_STRENGTH.share
}

/**
 * The checks `db` remembers when it is an open transaction from api.transaction;
 * undefined otherwise.
 * @param {unknown} db
 * @returns {TransactionChecks | undefined}
 */
export function transactionChecks (db) {
  if (!db || !isOpenManagedTransaction(db)) return undefined
  const transaction = /** @type {import('knex').Knex.Transaction} */ (db)
  let memo = memos.get(transaction)
  if (!memo) {
    memo = createTransactionChecks(transaction)
    memos.set(transaction, memo)
  }
  return memo
}

/** @param {import('knex').Knex.Transaction} transaction @returns {TransactionChecks} */
function createTransactionChecks (transaction) {
  /** @type {Map<string, RememberedCheck>} */
  const checks = new Map()
  let rows = 0
  let writes = 0
  const forgetAll = () => {
    checks.clear()
    rows = 0
  }
  /** @param {(check: RememberedCheck) => boolean} matches */
  const forget = matches => {
    for (const [key, check] of checks) {
      if (!matches(check)) continue
      rows -= check.rows.size
      checks.delete(key)
    }
  }
  /** @param {{ sql?: unknown }} query */
  const onQuery = ({ sql }) => {
    const statement = classifyStatement(String(sql ?? ''))
    if (statement.reads) return
    writes += 1
    if (statement.table === undefined) return forgetAll()
    const columns = statement.columns || []
    if (columns.some(column => [...checks.values()].some(check => check.words.has(column)))) return forgetAll()
    const table = statement.table
    forget(check => check.words.has(table))
  }
  transaction.on('query', onQuery)
  onTransactionFinished(transaction, () => {
    transaction.off('query', onQuery)
    forgetAll()
    memos.delete(transaction)
  })

  return {
    scopeOf: checkScope,
    known (scope, ids, strength) {
      const remembered = checks.get(scope.key)?.rows
      const known = new Set()
      if (!remembered) return known
      for (const id of ids) {
        if ((remembered.get(id) ?? -1) >= strength) known.add(id)
      }
      return known
    },
    started: () => writes,
    remember (scope, ids, strength, started) {
      // A statement sent while the check ran may have changed its answer.
      if (started !== writes) return
      let check = checks.get(scope.key)
      for (const id of ids) {
        if (!check) {
          check = { words: scope.words, rows: new Map() }
          checks.set(scope.key, check)
        }
        const held = check.rows.get(id)
        if (held === undefined) {
          if (rows >= MAX_REMEMBERED_ROWS) return
          rows += 1
        }
        check.rows.set(id, Math.max(held ?? -1, strength))
      }
    }
  }
}

// Builder parts that make a check's answer for one row depend on the other rows it reads.
const ROW_SET_GROUPINGS = new Set(['group', 'having', 'union'])

/**
 * The scope a check read applies to its rows: `query` without its id list
 * (`idPredicate`, the where statement that names the ids) and without its select
 * list, order and lock, compiled with its bindings. Undefined when the query is
 * not a plain filter of the rows by id (a limit, a grouping, a union, the id
 * predicate missing or repeated) or a binding has no exact text form; such a
 * check is not remembered.
 * @param {any} query
 * @param {unknown} idPredicate
 * @param {string} idColumn
 * @returns {CheckScope | undefined}
 */
function checkScope (query, idPredicate, idColumn) {
  /** @type {Array<{ grouping?: string }> | undefined} */
  const statements = query?._statements
  if (!Array.isArray(statements) || statements.filter(statement => statement === idPredicate).length !== 1) return undefined
  if (statements.some(statement => ROW_SET_GROUPINGS.has(String(statement.grouping)))) return undefined
  if (query._single?.limit !== undefined || query._single?.offset !== undefined) return undefined
  const probe = query.clone()
  probe._statements = statements.filter(statement => statement !== idPredicate && statement.grouping !== 'columns' && statement.grouping !== 'order')
  const { lock: _lock, lockTables: _lockTables, waitMode: _waitMode, ...single } = probe._single
  probe._single = single
  const { sql, bindings } = probe.toSQL()
  const values = []
  for (const binding of bindings || []) {
    const value = bindingText(binding)
    if (value === undefined) return undefined
    values.push(value)
  }
  const words = new Set(String(sql).toLowerCase().match(/[a-z_][\w$]*/g) || [])
  words.add(idColumn.split('.').pop()?.toLowerCase() ?? idColumn)
  return { key: `${sql}\u0000${values.join('\u0001')}`, words }
}

/**
 * A binding's exact text, by type, or undefined when it has none.
 * @param {unknown} value
 * @returns {string | undefined}
 */
function bindingText (value) {
  if (value === null || value === undefined) return 'n'
  switch (typeof value) {
    case 'string': return `s${value}`
    case 'number': return `d${value}`
    case 'bigint': return `b${value}`
    case 'boolean': return value ? 't' : 'f'
  }
  if (value instanceof Date) return `D${value.getTime()}`
  if (Buffer.isBuffer(value)) return `x${value.toString('hex')}`
  if (Array.isArray(value)) {
    const items = value.map(bindingText)
    return items.every(item => item !== undefined) ? `[${items.map(item => JSON.stringify(item)).join(',')}]` : undefined
  }
  return undefined
}

/** @typedef {{ reads?: true, table?: string, columns?: string[] }} StatementEffect */

const READS = /** @type {StatementEffect} */ (Object.freeze({ reads: true }))
const FORGETS_ALL = /** @type {StatementEffect} */ (Object.freeze({}))
// A table name, optionally qualified and quoted.
const TABLE = String.raw`((?:[\`"]?[\w$]+[\`"]?\s*\.\s*)*[\`"]?[\w$]+[\`"]?)`
const INSERT_INTO = new RegExp(String.raw`^insert\s+(?:ignore\s+)?into\s+${TABLE}`, 'i')
const UPDATE_SET = new RegExp(String.raw`^update\s+${TABLE}\s+set\s`, 'i')
const ASSIGNED_COLUMN = new RegExp(String.raw`^\s*${TABLE}\s*=`, 'i')
// The clause that ends an UPDATE's SET list, at a given position.
const AFTER_SET = /\s(?:where|returning|from|order\s+by|limit)\b/iy

/** @param {string} name */
const unqualified = name => (name.split('.').pop() || name).replace(/[`"\s]/g, '').toLowerCase()

/**
 * What a statement the transaction sends may change: nothing (a read), one
 * table's rows (`table`, and the `columns` an UPDATE sets), or anything.
 * @param {string} sql
 * @returns {StatementEffect}
 */
export function classifyStatement (sql) {
  const text = sql.trimStart().replace(/^\(+\s*/, '')
  // Several statements in one (PostgreSQL runs them when nothing is bound).
  if (/;\s*\S/.test(text)) return FORGETS_ALL
  const head = /^[a-z]+/i.exec(text)?.[0].toLowerCase()
  if (head === 'select') return READS
  if (head === 'with') return /\b(?:insert|update|delete|merge)\b/i.test(text) ? FORGETS_ALL : READS
  if (head === 'insert') {
    if (/\bon\s+duplicate\s+key\s+update\b|\bdo\s+update\b/i.test(text)) return FORGETS_ALL
    const table = INSERT_INTO.exec(text)?.[1]
    return table ? { table: unqualified(table) } : FORGETS_ALL
  }
  if (head === 'update') {
    const match = UPDATE_SET.exec(text)
    const columns = match && assignedColumns(text.slice(match[0].length))
    return match?.[1] && columns ? { table: unqualified(match[1]), columns } : FORGETS_ALL
  }
  return FORGETS_ALL
}

/**
 * The columns an UPDATE's SET list assigns, from the text after SET, or
 * undefined when an assignment does not start with a column name.
 * @param {string} text
 * @returns {string[] | undefined}
 */
function assignedColumns (text) {
  const assignments = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let index = 0; index <= text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    AFTER_SET.lastIndex = index
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '(') depth++
    else if (char === ')') depth--
    else if (depth === 0 && (char === ',' || char === undefined || (/\s/.test(char) && AFTER_SET.test(text)))) {
      assignments.push(text.slice(start, index))
      if (char !== ',') break
      start = index + 1
    }
  }
  const columns = []
  for (const assignment of assignments) {
    const column = ASSIGNED_COLUMN.exec(assignment)?.[1]
    if (!column) return undefined
    columns.push(unqualified(column))
  }
  return columns
}
