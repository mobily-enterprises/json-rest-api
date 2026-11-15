import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createLockedInListFixture, currentRevisionOf } from './fixtures/locked-in-list-api.js'
import { NOWAIT_MYSQL_CODE } from './helpers/transaction-completion.js'
import { databaseClient } from './helpers/test-database.js'
import { lockRelationshipTargets } from '../plugins/core/lib/writing/relationship-processor.js'

// MariaDB turns an IN list of in_predicate_conversion_threshold values or more
// (1,000 by default) into a join with a table of its values, which a locking
// read can plan through a key's leading columns, locking every row they match:
// a lock of the current revisions of 1,000 records, by record and revision
// number, held every revision of those records. A locking read keeps each list
// below the threshold, so it stays a range on the whole key. MySQL keeps every
// list a list, and the same reads hold the same rows there.
const asCaller = { scopeValues: { workspaceId: 'ws-a' } }
const ROLLED_BACK = new Error('rolled back')
const UNIQUE_KEY = 'uq_il_revisions_workspace_id_record_id_revision_number'
const records = count => Array.from({ length: count }, (_, index) => index + 1)

describe(`A locking read's long IN lists on ${databaseClient}`, { skip: databaseClient !== 'mysql2' && 'MySQL and MariaDB only' }, () => {
  let fixture
  let knex
  let mariadb
  before(async () => {
    fixture = await createLockedInListFixture()
    knex = fixture.database.knex
    await knex.raw('analyze table il_revisions, il_stages, il_tasks')
    mariadb = /mariadb/i.test((await knex.raw('select version() as version'))[0][0].version)
  })
  after(() => fixture?.database.close())

  // Whether another transaction can delete the row (every index entry of it,
  // as a lock read through a secondary index holds the entry) or, for a stage,
  // change it, without waiting.
  const free = (table, id) => knex.transaction(async probe => {
    await probe.raw('set session innodb_lock_wait_timeout = 1')
    try {
      if (table === 'il_revisions') await probe(table).where({ id }).delete()
      else await probe(table).where({ id }).update({ name: probe.raw('concat(name, ?)', ['*']) })
    } finally { await probe.raw('set session innodb_lock_wait_timeout = default') }
    throw ROLLED_BACK
  }).then(() => { throw new Error('the probe committed') }, error => {
    if (error === ROLLED_BACK) return true
    if (NOWAIT_MYSQL_CODE.test(error?.code ?? '')) return false
    throw error
  })

  // Each table each locking statement on `table` reads, with its access and key, from EXPLAIN.
  const plansOf = async statements => {
    const plans = []
    for (const { sql, bindings } of statements) {
      const [rows] = await knex.raw(`explain ${sql.replace(/ (for update|lock in share mode)$/, '')}`, bindings)
      plans.push(rows.map(row => `${row.table} ${row.type} ${row.key}`))
    }
    return plans
  }

  // Runs `read` in a transaction it rolls back and answers its rows, the plans
  // of its locking statements on `table` and, while it holds its locks, which
  // `rows` are held.
  const whileLocked = async (table, read, rows) => {
    const statements = []
    const record = query => {
      if (query.sql.includes(`\`${table}\``) && /(for update|lock in share mode)$/.test(query.sql)) statements.push(query)
    }
    knex.on('query', record)
    const held = {}
    let answered
    let done = false
    try {
      await fixture.api.transaction(async transaction => {
        answered = (await read(transaction)).length
        for (const [name, [rowTable, id]] of Object.entries(rows)) held[name] = !await free(rowTable, id)
        done = true
        throw ROLLED_BACK
      })
    } catch (error) {
      // api.transaction rolls back and wraps what its callback throws.
      if (!done) throw error
    } finally { knex.removeListener('query', record) }
    return { answered, plans: await plansOf(statements), held }
  }

  it('reads the server\'s threshold once, as the API starts', async () => {
    const { version } = (await knex.raw('select version() as version'))[0][0]
    const { dbInfo } = fixture.api.knex.capabilities
    if (/mariadb/i.test(version)) {
      const [[{ threshold }]] = await knex.raw('select @@in_predicate_conversion_threshold as threshold')
      assert.equal(dbInfo.inPredicateConversionThreshold, Number(threshold))
    } else {
      assert.equal(dbInfo.inPredicateConversionThreshold, undefined)
    }
  })

  // 1,000 records' current revisions; and 1,200 records' revisions numbered 10, the even records' current ones, as
  // lockWhere locks 1,000 rows at most.
  for (const { count, numbers, rows } of [{ count: 1000, numbers: [10, 11], rows: 1000 }, { count: 1200, numbers: [10], rows: 600 }]) {
    for (const lockMode of ['share', 'update']) {
      it(`lockWhere of ${count} records' revisions numbered ${numbers.join(' or ')} (${lockMode}) holds those revisions alone, through a range on the whole unique key`, async () => {
        const revision = (record, number) => ['il_revisions', fixture.revisionsOf.get(record).get(number)]
        const { answered, plans, held } = await whileLocked('il_revisions', async transaction => (await fixture.api.resources.il_revisions.lockWhere({
          transaction, lockMode, filters: { records: records(count), revisions: numbers }, queryParams: { fields: { il_revisions: 'name' } }
        }, asCaller)).data, {
          current: revision(6, 10),
          lastCurrent: revision(count, 10),
          past: revision(6, 1),
          lastPast: revision(count, 2),
          unlisted: count < 1200 ? revision(1100, 10) : revision(5, 11),
          otherWorkspace: ['il_revisions', fixture.otherRevisions[40]]
        })
        assert.equal(answered, rows)
        assert.deepEqual({ held, plans }, {
          held: { current: true, lastCurrent: true, past: false, lastPast: false, unlisted: false, otherWorkspace: false },
          plans: [[`il_revisions range ${UNIQUE_KEY}`]]
        })
      })
    }
  }

  it('a locking aggregate of 1,000 records\' current revisions counts and holds those revisions alone, through a range on the whole unique key', async () => {
    const revision = (record, number) => ['il_revisions', fixture.revisionsOf.get(record).get(number)]
    let totals
    const { answered, plans, held } = await whileLocked('il_revisions', async transaction => {
      totals = (await fixture.api.resources.il_revisions.aggregate({
        transaction, lockMode: 'share', measures: { rows: { count: '*' } }, queryParams: { filters: { records: records(1000), revisions: [10, 11] } }
      }, asCaller)).data[0]
      return [totals]
    }, {
      current: revision(6, 10),
      past: revision(6, 1),
      unlisted: revision(1100, 10)
    })
    assert.equal(answered, 1)
    assert.equal(Number(totals.rows ?? totals.attributes?.rows), 1000)
    assert.deepEqual({ held, plans }, { held: { current: true, past: false, unlisted: false }, plans: [[`il_revisions range ${UNIQUE_KEY}`]] })
  })

  it('lockByIds of 1,200 ids, given as numbers, holds those rows alone, through a range on the primary key', async () => {
    const ids = records(1200).map(record => Number(fixture.revisionsOf.get(record).get(currentRevisionOf(record))))
    const { answered, plans, held } = await whileLocked('il_revisions', async transaction => (await fixture.api.resources.il_revisions.lockByIds({
      transaction, ids, queryParams: { fields: { il_revisions: 'name' } }
    }, asCaller)).data, {
      listed: ['il_revisions', String(ids[4])],
      past: ['il_revisions', fixture.revisionsOf.get(5).get(1)],
      otherWorkspace: ['il_revisions', fixture.otherRevisions[40]]
    })
    assert.equal(answered, 1200)
    assert.ok(plans.length > 0 && plans.every(plan => plan.length === 1 && plan[0] === 'il_revisions range PRIMARY'), JSON.stringify(plans))
    assert.deepEqual(held, { listed: true, past: false, otherWorkspace: false })
  })

  it('lockWhere of 1,000 tasks checks their 1,000 stage links through a range on the primary key, holding those stages alone', async () => {
    const otherStage = (await knex('il_stages').where({ workspace_id: 'ws-b' }).first('id')).id
    const { answered, plans, held } = await whileLocked('il_stages', async transaction => (await fixture.api.resources.il_tasks.lockWhere({
      transaction, limit: 1000, lockMode: 'share', queryParams: { fields: { il_tasks: 'name,stage' } }
    }, asCaller)).data, {
      linked: ['il_stages', fixture.stages[3]],
      unlinked: ['il_stages', fixture.stages[1150]],
      otherWorkspace: ['il_stages', otherStage]
    })
    assert.equal(answered, 1000)
    assert.deepEqual(plans, [['il_stages range PRIMARY']])
    assert.deepEqual(held, { linked: true, unlinked: false, otherWorkspace: false })
  })

  // A write's target lock reads through the primary key too: left to choose, the
  // optimizer reads a list that names much of the table by scanning the whole
  // table, and holds every owner's rows until the transaction ends.
  const stageRows = async () => ({
    linked: ['il_stages', fixture.stages[3]],
    unlinked: ['il_stages', fixture.stages[1150]],
    otherWorkspace: ['il_stages', (await knex('il_stages').where({ workspace_id: 'ws-b' }).first('id')).id]
  })
  it('postMany of 999 tasks naming 999 stages holds those stages alone', async () => {
    const { answered, plans, held } = await whileLocked('il_stages', async transaction => (await fixture.api.resources.il_tasks.postMany({
      transaction, data: fixture.stages.slice(0, 999).map((stage, index) => ({ workspace_id: 'ws-a', name: `N${index}`, stage })), returning: 'minimal'
    }, asCaller)).data, await stageRows())
    assert.equal(answered, 999)
    // The check's scope is a subquery of the stages, which the lock does not
    // lock: MySQL reads it first and the locked rows by primary key (eq_ref).
    assert.ok(plans.length > 0 && plans.every(plan => plan.some(step => /^il_stages (range|eq_ref) PRIMARY$/.test(step))), JSON.stringify(plans))
    assert.deepEqual(held, { linked: true, unlinked: false, otherWorkspace: false })
  })
  it('a relationship write\'s lock of 999 targets holds those targets alone', async t => {
    // MySQL 8.4 reads a list naming two fifths of a small table through the
    // whole primary key, which FORCE INDEX allows, and holds every row; MariaDB
    // reads the listed rows (see the scoped-reads guide).
    if (!mariadb) t.todo('MySQL scans the whole primary key for a list naming two fifths of the table')
    const { answered, plans, held } = await whileLocked('il_stages', async transaction => lockRelationshipTargets(fixture.api, transaction.db ?? transaction,
      fixture.stages.slice(0, 999).map(id => ({ type: 'il_stages', id }))), await stageRows())
    assert.equal(answered, 999)
    assert.deepEqual({ held, plans }, { held: { linked: true, unlinked: false, otherWorkspace: false }, plans: [['il_stages range PRIMARY']] })
  })
})
