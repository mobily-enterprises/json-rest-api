import { databaseClient } from './test-database.js'

// Lock-wait detection for two-transaction tests on MySQL, MariaDB and PostgreSQL.
const isMysql = databaseClient === 'mysql2'
const rowsOf = result => isMysql ? result[0] : result.rows

/** The server's id for the connection a transaction holds. */
export const connectionId = async transaction =>
  rowsOf(await transaction.raw(isMysql ? 'SELECT CONNECTION_ID() AS id' : 'SELECT pg_backend_pid() AS id'))[0].id

// InnoDB refreshes information_schema.innodb_trx only when nothing read it in
// the last 100 ms, so polling it faster would keep showing the snapshot taken
// before the waiter blocked. Two test files polling the same server at a fixed
// interval can likewise keep each other's reads under 100 ms apart, so neither
// ever sees the wait: a random extra delay lets longer gaps through.
const pollDelay = () => isMysql ? 150 + Math.random() * 150 : 20

/**
 * Resolves once connection `id` waits for a row lock. Fails at once, with the
 * waiter's own outcome, if `waiter` ends before it waits.
 * @param {import('knex').Knex} knex another connection's Knex
 * @param {unknown} id
 * @param {Promise<unknown>} waiter
 */
export const waitForLockWait = async (knex, id, waiter) => {
  let outcome
  waiter.then(() => { outcome = 'finished without waiting for the lock' }, error => { outcome = `failed before it waited: ${error?.cause?.message || error?.message}` })
  const sql = isMysql
    ? "SELECT COUNT(*) AS waiting FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = ? AND trx_state = 'LOCK WAIT'"
    : "SELECT COUNT(*) AS waiting FROM pg_stat_activity WHERE pid = ? AND wait_event_type = 'Lock'"
  for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
    if (outcome) throw new Error(`the second transaction ${outcome}`)
    if (Number(rowsOf(await knex.raw(sql, [id]))[0].waiting) > 0) return
    await new Promise(resolve => setTimeout(resolve, pollDelay()))
  }
  const state = isMysql
    ? 'SELECT p.command, p.state, p.info, t.trx_state, t.trx_query FROM information_schema.processlist p LEFT JOIN information_schema.innodb_trx t ON t.trx_mysql_thread_id = p.id WHERE p.id = ?'
    : 'SELECT state, wait_event_type, wait_event, query FROM pg_stat_activity WHERE pid = ?'
  throw new Error(`the second transaction never waited for the lock: ${JSON.stringify(rowsOf(await knex.raw(state, [id])))}`)
}
