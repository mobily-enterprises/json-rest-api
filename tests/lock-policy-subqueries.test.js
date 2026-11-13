import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { readOnlyQueryBuilder } from '../index.js'
import { lockConditionSubqueries } from '../plugins/core/lib/querying/subquery-locks.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { connectionId, waitForLockWait } from './helpers/lock-wait.js'
import { DECIDING_SELECTS, POLICY_SHAPES, asUser, createLockPolicyFixture } from './fixtures/lock-policy-api.js'

// A lock read (lockByIds, lockWhere) decides which rows a caller may lock with
// the row policy's subqueries. They lock the rows they read, shared, so the
// decision reads the membership and grant rows as last committed, waits for a
// transaction that is changing them, and holds them until the transaction ends.

const serverDatabase = databaseClient !== 'better-sqlite3'
const isMysql = databaseClient === 'mysql2'
const isPostgres = databaseClient === 'pg'
const tableOnly = storageMode.isAnyApi() && 'locks need table storage'
const ANY_LOCK = /for update|for share|for no key update|for key share|lock in share mode/i
const SHARED_LOCK = /for share|lock in share mode/i
const sharedLocks = sql => sql.split(isMysql ? 'lock in share mode' : 'for share').length - 1
// An error, or one it was caused by, that matches.
const causedBy = matches => error => {
  for (let current = error; current; current = current.cause) if (matches(current)) return true
  return false
}

// Compiled SQL, without a connection.
const compilers = { pg: knexLib({ client: 'pg' }), mysql: knexLib({ client: 'mysql2' }), sqlite: knexLib({ client: 'better-sqlite3', useNullAsDefault: true }) }
const compiled = (family, build) => {
  const db = compilers[family]
  const query = build(db)
  lockConditionSubqueries(query, db)
  return query.toSQL().sql
}

describe('A lock read\'s condition subqueries take a shared lock (compiled)', () => {
  after(async () => { await Promise.all(Object.values(compilers).map(db => db.destroy())) })

  for (const [family, share] of [['pg', 'for share'], ['mysql', 'lock in share mode']]) {
    const count = sql => sql.split(share).length - 1

    it(`${family}: whereExists, whereIn and comparison subqueries, callbacks or builders, take ${share}; the outer read keeps its own lock`, () => {
      const sql = compiled(family, db => db('projects')
        .whereExists(function () { this.select(1).from('members').whereColumn('members.project_id', 'projects.id').where('members.user_id', 7) })
        .whereIn('projects.id', db('grants').select('project_id').where('user_id', 7))
        .where('projects.owner_id', '=', db('owners').select('id').where('name', 'x').limit(1))
        .forUpdate())
      assert.equal(count(sql), 3, sql)
      assert.match(sql, /for update$/)
    })

    it(`${family}: a builder or read-only view the conditions name is copied, never changed`, () => {
      const db = compilers[family]
      const plain = db('grants').select('project_id').where('user_id', 7)
      const view = readOnlyQueryBuilder(db('members')).select(1).whereColumn('members.project_id', 'projects.id')
      const before = [plain.toSQL().sql, view.toSQL().sql]
      const query = db('projects').whereIn('projects.id', plain).whereExists(view)
      lockConditionSubqueries(query, db)
      assert.equal(count(query.toSQL().sql), 2)
      assert.deepEqual([plain.toSQL().sql, view.toSQL().sql], before)
      assert.throws(() => view.forShare(), /forShare/)
    })

    it(`${family}: a parenthesised group's SELECTs take the lock at any depth, and the group none of its own`, () => {
      const sql = compiled(family, db => db('projects').where(function () {
        this.where('projects.archived', false).whereExists(function () {
          this.select(1).from('members').whereColumn('members.project_id', 'projects.id')
            .whereNotExists(db('bans').select(1).whereColumn('bans.member_id', 'members.id'))
        })
      }))
      assert.equal(count(sql), 2, sql)
    })

    it(`${family}: derived and joined sources, a raw expression's bound subquery and a common table expression take the lock`, () => {
      const sql = compiled(family, db => db('projects')
        .whereExists(db.from(db('members').select('*').where('active', true).as('m')).select(1).whereColumn('m.project_id', 'projects.id'))
        .whereExists(db('grants').select(1).join(db('teams').select('id').as('t'), 't.id', 'grants.team_id').whereColumn('grants.project_id', 'projects.id'))
        .whereRaw('exists ?', [db('audits').select(1).whereColumn('audits.project_id', 'projects.id')])
        .whereIn('projects.id', db.with('recent', db('visits').select('project_id')).select('project_id').from('recent')))
      // m and its derived rows; grants and teams; audits; the CTE body and the read of it.
      assert.equal(count(sql), 7, sql)
    })

    it(`${family}: a subquery's own lock clause stays, and a subquery written as raw SQL text stays as written`, () => {
      const sql = compiled(family, db => db('projects')
        .whereIn('projects.id', db('grants').select('project_id').forUpdate())
        .whereRaw('exists (select 1 from members where members.project_id = projects.id)'))
      assert.equal(count(sql), 0, sql)
      assert.match(sql, /grants. for update\)/)
    })
  }

  it('a SELECT the database refuses a lock clause on stays plain, and the SELECTs nested in it still lock', () => {
    const nested = db => db('bans').select(1).whereColumn('bans.member_id', 'members.id')
    // PostgreSQL refuses FOR SHARE with DISTINCT, GROUP BY, HAVING, an aggregate, the nullable side of an outer join
    // and a set operation; MySQL and MariaDB on a set operation's last SELECT.
    const shapes = {
      distinct: db => db('members').distinct('project_id').whereNotExists(nested(db)),
      groupBy: db => db('members').select('project_id').groupBy('project_id').whereNotExists(nested(db)),
      having: db => db('members').select('project_id').groupBy('project_id').having(db.raw('count(*) > 1')).whereNotExists(nested(db)),
      count: db => db('members').count('*').whereColumn('members.project_id', 'projects.id').whereNotExists(nested(db)),
      leftJoin: db => db('members').select('members.project_id').leftJoin('teams', 'teams.id', 'members.team_id').whereNotExists(nested(db)),
      union: db => db('members').select('project_id').whereNotExists(nested(db)).union(db('owners').select('project_id'))
    }
    for (const [shape, subquery] of Object.entries(shapes)) {
      const pg = compiled('pg', db => db('projects').whereIn('projects.id', subquery(db)))
      assert.equal(pg.split('for share').length - 1, 1, `${shape}: ${pg}`)
      const mysql = compiled('mysql', db => db('projects').whereIn('projects.id', subquery(db)))
      assert.equal(mysql.split('lock in share mode').length - 1, shape === 'union' ? 1 : 2, `${shape}: ${mysql}`)
    }
  })

  it('sqlite: nothing changes', () => {
    const build = db => db('projects')
      .whereExists(function () { this.select(1).from('members').whereColumn('members.project_id', 'projects.id') })
      .whereIn('projects.id', db('grants').select('project_id'))
    const sql = compiled('sqlite', build)
    assert.equal(sql, build(compilers.sqlite).toSQL().sql)
    assert.doesNotMatch(sql, ANY_LOCK)
  })
})

describe(`Lock reads decide visibility from current rows (${storageMode.mode}, ${databaseClient})`, { skip: tableOnly }, () => {
  let fixture
  before(async () => { fixture = await createLockPolicyFixture({ databaseOptions: { maxConnections: 5 } }) })
  after(async () => { await fixture?.close() })

  const ids = document => document.data.map(record => String(record.id))
  const withMode = lockMode => lockMode ? { lockMode } : {}
  // u1's lock of projects 1 to 3.
  const lockers = {
    lockByIds: (transaction, context, lockMode) => fixture.projects.lockByIds({ ids: ['1', '2', '3'], missing: 'skip', transaction, ...withMode(lockMode) }, context),
    lockWhere: (transaction, context, lockMode) => fixture.projects.lockWhere({ transaction, ...withMode(lockMode) }, context)
  }
  // u1's lock of project `id` alone.
  const lockOne = {
    lockByIds: (transaction, context, id) => fixture.projects.lockByIds({ ids: [id], transaction }, context),
    lockWhere: (transaction, context, id) => fixture.projects.lockWhere({ filters: { name: `P${id}` }, transaction }, context)
  }
  const readPlainly = async (transaction, context) => ids(await fixture.projects.query({ transaction, queryParams: { sort: ['id'] } }, context))
  // Another connection's transaction, left open for the test to commit.
  const openWriter = () => fixture.knex.transaction()
  const settleWriter = async writer => { if (!writer.isCompleted()) await writer.rollback() }

  // What another transaction commits, with what u1's lock read must then find among projects 1 to 3 (u1 sees 1).
  const CHANGES = {
    'membership revoked': { write: db => db('lp_members').where({ id: 1 }).del(), visible: [], pending: 'revokes the membership' },
    'grant revoked': { write: db => db('lp_grants').where({ id: 1 }).del(), visible: [], pending: 'revokes the grant' },
    'grant added': { write: db => db('lp_grants').insert({ id: 2, user_id: 'u1', project_id: 2 }), visible: ['1', '2'], pending: 'adds a grant', adds: true },
    'grant moved': { write: db => db('lp_grants').where({ id: 1 }).update({ project_id: 2 }), visible: ['2'], pending: 'moves the grant', adds: true }
  }

  for (const shape of POLICY_SHAPES) {
    for (const [method, lock] of Object.entries(lockers)) {
      for (const [change, { write, visible, pending, adds }] of Object.entries(CHANGES)) {
        it(`${method}, ${shape} policy: ${change} after the transaction's first plain read`, { skip: !serverDatabase && 'needs a second connection' }, async () => {
          await fixture.reset()
          const context = asUser('u1', shape)
          await fixture.api.transaction(async transaction => {
            // On MySQL and MariaDB this read fixes the transaction's REPEATABLE READ snapshot.
            assert.deepEqual(await readPlainly(transaction, context), ['1'])
            await write(fixture.knex)
            assert.deepEqual(ids(await lock(transaction, context)), visible)
          })
        })

        // PostgreSQL never sees a row inserted after its statement began, so it waits for no writer that adds one.
        const skip = (!serverDatabase && 'needs a second connection') || (isPostgres && change === 'grant added' && 'PostgreSQL cannot see an uncommitted insert, so nothing waits')
        it(`${method}, ${shape} policy: waits for a writer that ${pending} and has not committed, then decides from what it committed`, { skip }, async () => {
          await fixture.reset()
          const context = asUser('u1', shape)
          const writer = await openWriter()
          try {
            await write(writer)
            await fixture.api.transaction(async transaction => {
              assert.deepEqual(await readPlainly(transaction, context), ['1'])
              const id = await connectionId(transaction)
              const waiting = lock(transaction, context)
              // The writer commits also when the lock never waited, so a lock still running ends rather than waits for it.
              try { await waitForLockWait(fixture.knex, id, waiting) } finally { await writer.commit() }
              const locked = ids(await waiting)
              // A PostgreSQL statement follows a row it waited for to its committed version, but finds no row that
              // only its writer's commit made match: lockWhere reads again until none appears, lockByIds does not.
              if (isPostgres && adds && method === 'lockByIds') assert.ok(!locked.includes('1'), String(locked))
              else assert.deepEqual(locked, visible)
            })
          } finally { await settleWriter(writer) }
        })
      }

      it(`${method}, ${shape} policy: waits for a writer that locked the row and revoked the grant, then leaves the row out`, { skip: !serverDatabase && 'needs a second connection' }, async () => {
        await fixture.reset()
        const context = asUser('u1', shape)
        const writer = await openWriter()
        try {
          await writer('lp_projects').where({ id: 1 }).update({ name: 'P1 renamed' })
          await writer('lp_grants').where({ id: 1 }).del()
          await fixture.api.transaction(async transaction => {
            assert.deepEqual(await readPlainly(transaction, context), ['1'])
            const id = await connectionId(transaction)
            const waiting = lock(transaction, context)
            try { await waitForLockWait(fixture.knex, id, waiting) } finally { await writer.commit() }
            assert.deepEqual(ids(await waiting), [])
          })
        } finally { await settleWriter(writer) }
      })
    }
  }

  // MariaDB may refuse a locking read of a row written since the snapshot (errno 1020); in this run's shapes it reads
  // the deciding rows, which their indexes cover, as committed. Either way the lock never answers from the snapshot.
  it('MariaDB with innodb_snapshot_isolation ON: a deciding row written since the snapshot is read as committed or fails the lock (ER_CHECKREAD), never answered from the snapshot', { skip: !isMysql && 'MariaDB only' }, async t => {
    try { await fixture.knex.raw('SELECT @@innodb_snapshot_isolation') } catch { return t.skip('the server has no innodb_snapshot_isolation (MySQL)') }
    for (const [method, lock] of Object.entries(lockers)) {
      for (const [change, { write, visible }] of Object.entries(CHANGES)) {
        await fixture.reset()
        const context = asUser('u1', 'callback')
        const outcome = await fixture.api.transaction(async transaction => {
          await transaction.raw('SET SESSION innodb_snapshot_isolation = ON')
          try {
            assert.deepEqual(await readPlainly(transaction, context), ['1'])
            await write(fixture.knex)
            return ids(await lock(transaction, context))
          } finally { await transaction.raw('SET SESSION innodb_snapshot_isolation = DEFAULT') }
        }).catch(error => {
          if (causedBy(cause => cause.errno === 1020)(error)) return 'ER_CHECKREAD'
          throw error
        })
        if (outcome !== 'ER_CHECKREAD') assert.deepEqual(outcome, visible, `${method}, ${change}`)
      }
    }
  })

  it('PostgreSQL at REPEATABLE READ: a deciding row changed since the snapshot fails the lock as a serialization failure instead of answering from the snapshot', { skip: !isPostgres && 'PostgreSQL only' }, async () => {
    for (const [method, lock] of Object.entries(lockers)) {
      for (const change of ['membership revoked', 'grant revoked', 'grant moved']) {
        await fixture.reset()
        const context = asUser('u1', 'callback')
        await assert.rejects(fixture.knex.transaction(async transaction => {
          assert.deepEqual(await readPlainly(transaction, context), ['1'])
          await CHANGES[change].write(fixture.knex)
          return ids(await lock(transaction, context))
        }, { isolationLevel: 'repeatable read' }), causedBy(error => error.code === '40001'), `${method}, ${change}`)
      }
    }
  })

  describe('the deciding rows\' lock mode', { skip: !serverDatabase && 'SQLite takes no row locks' }, () => {
    const OUTER = {
      pg: { update: /for update$/, noKeyUpdate: /for no key update$/, share: /for share$/ },
      mysql2: { update: /for update$/, noKeyUpdate: /for update$/, share: /lock in share mode$/ }
    }
    for (const shape of POLICY_SHAPES) {
      for (const lockMode of ['update', 'noKeyUpdate', 'share']) {
        it(`${shape} policy, lockMode ${lockMode}: the subqueries take a shared lock, the locked rows the lock mode`, async () => {
          await fixture.reset()
          for (const [method, lock] of Object.entries(lockers)) {
            const { sql } = await fixture.measure(() => fixture.api.transaction(transaction => lock(transaction, asUser('u1', shape), lockMode)))
            // PostgreSQL's lockWhere reads again until no new row appears.
            const locking = sql.filter(statement => statement.includes('lp_projects') && ANY_LOCK.test(statement))
            assert.ok(locking.length >= 1, `${method}: ${sql.join(' | ')}`)
            for (const statement of locking) {
              assert.equal(sharedLocks(statement), DECIDING_SELECTS[shape] + (lockMode === 'share' ? 1 : 0), `${method}: ${statement}`)
              assert.match(statement, OUTER[databaseClient][lockMode], `${method}: ${statement}`)
            }
          }
        })
      }
    }

    // A wait for a row lock fails after a second here instead of blocking the test.
    const shortLockWait = transaction => transaction.raw(isMysql ? 'SET SESSION innodb_lock_wait_timeout = 1' : "SET LOCAL lock_timeout = '1s'")
    const defaultLockWait = async transaction => { if (isMysql) await transaction.raw('SET SESSION innodb_lock_wait_timeout = DEFAULT') }

    for (const [method, lock] of Object.entries(lockOne)) {
      it(`${method}: two lock reads that decide from the same membership and grant rows run at once`, async () => {
        await fixture.reset({ grants: [{ id: 2, user_id: 'u1', project_id: 2 }] })
        for (const shape of POLICY_SHAPES) {
          await fixture.api.transaction(async first => {
            assert.deepEqual(ids(await lock(first, asUser('u1', shape), '1')), ['1'])
            await fixture.api.transaction(async second => {
              await shortLockWait(second)
              try {
                assert.deepEqual(ids(await lock(second, asUser('u1', shape), '2')), ['2'], shape)
              } finally { await defaultLockWait(second) }
            })
          })
        }
      })

      it(`${method}: an exclusive lock on a deciding row, which FOR UPDATE subqueries would take, makes a lock read wait`, async () => {
        await fixture.reset()
        const holder = await openWriter()
        try {
          // Through the key the policy reads it by: InnoDB's shared lock of a row read from a covering index holds
          // that index entry, which an exclusive lock through the primary key alone leaves free (a write of the
          // columns the index holds still takes the entry, and waits).
          await holder('lp_members').where({ workspace_id: 'ws-a', user_id: 'u1' }).forUpdate().select('id')
          await fixture.api.transaction(async transaction => {
            const id = await connectionId(transaction)
            const waiting = lock(transaction, asUser('u1'), '1')
            try { await waitForLockWait(fixture.knex, id, waiting) } finally { await holder.commit() }
            assert.deepEqual(ids(await waiting), ['1'])
          })
        } finally { await settleWriter(holder) }
      })

      it(`${method}: a writer of a deciding row waits until the lock read's transaction ends`, async () => {
        await fixture.reset()
        let writer
        await fixture.api.transaction(async transaction => {
          assert.deepEqual(ids(await lock(transaction, asUser('u1'), '1')), ['1'])
          let reportWriter
          const writerId = new Promise(resolve => { reportWriter = resolve })
          writer = fixture.knex.transaction(async other => {
            reportWriter(await connectionId(other))
            return other('lp_members').where({ id: 1 }).del()
          })
          await waitForLockWait(fixture.knex, await writerId, writer)
        })
        assert.equal(await writer, 1)
      })
    }
  })

  it('the database runs every subquery shape with its lock clause, or without one where it refuses it', async () => {
    await fixture.reset({ grants: [{ id: 2, user_id: 'u2', project_id: 1 }] })
    const member = db => db('lp_members').select(1).whereColumn('lp_members.workspace_id', 'lp_projects.workspace_id').where('lp_members.user_id', 'u1')
    const grantedTo = db => db('lp_grants').select('project_id').where('lp_grants.user_id', 'u1')
    const shapes = {
      callback: q => q.whereExists(function () { this.select(1).from('lp_members').whereColumn('lp_members.workspace_id', 'lp_projects.workspace_id').where('lp_members.user_id', 'u1') }),
      'builder in': (q, db) => q.whereIn('lp_projects.id', grantedTo(db)),
      comparison: (q, db) => q.where('lp_projects.id', '=', grantedTo(db).orderBy('project_id').limit(1)),
      nested: (q, db) => q.whereExists(member(db).whereExists(db('lp_grants').select(1).whereColumn('lp_grants.user_id', 'lp_members.user_id'))),
      group: (q, db) => q.where(function () { this.whereExists(readOnlyQueryBuilder(member(db))) }),
      derived: (q, db) => q.whereExists(db.from(db('lp_grants').select('project_id', 'user_id').as('g')).select(1).whereColumn('g.project_id', 'lp_projects.id').where('g.user_id', 'u1')),
      'joined derived': (q, db) => q.whereExists(db('lp_grants').select(1).join(db('lp_members').select('user_id').as('m'), 'm.user_id', 'lp_grants.user_id').whereColumn('lp_grants.project_id', 'lp_projects.id').where('m.user_id', 'u1')),
      'raw binding': (q, db) => q.whereRaw('exists ?', [member(db)]),
      'common table expression': (q, db) => q.whereIn('lp_projects.id', db.with('mine', grantedTo(db)).select('project_id').from('mine')),
      distinct: (q, db) => q.whereIn('lp_projects.id', db('lp_grants').distinct('project_id').where('user_id', 'u1')),
      'group by': (q, db) => q.whereIn('lp_projects.id', db('lp_grants').select('project_id').groupBy('project_id').having(db.raw('count(*) >= 1'))),
      aggregate: (q, db) => q.where(db.raw('0 < ?', [db('lp_grants').count('*').whereColumn('lp_grants.project_id', 'lp_projects.id')])),
      'left join': (q, db) => q.whereIn('lp_projects.id', db('lp_grants').select('lp_grants.project_id').leftJoin('lp_members', 'lp_members.user_id', 'lp_grants.user_id').where('lp_grants.user_id', 'u1')),
      union: (q, db) => q.whereIn('lp_projects.id', db('lp_grants').select('project_id').where('user_id', 'u1').union(db('lp_grants').select('project_id').where('user_id', 'u2')))
    }
    for (const [shape, add] of Object.entries(shapes)) {
      await fixture.api.transaction(async transaction => {
        const query = add(transaction('lp_projects').select('lp_projects.id').orderBy('lp_projects.id'), transaction)
        lockConditionSubqueries(query, transaction)
        if (serverDatabase) query.forUpdate()
        const sql = query.toSQL().sql
        const rows = await query
        assert.deepEqual(rows.map(row => String(row.id)), shape === 'nested' || shape === 'callback' || shape === 'group' || shape === 'raw binding' ? ['1', '2', '3'] : ['1'], `${shape}: ${sql}`)
      })
    }
  })

  it('SQLite: a lock read adds no lock clause and decides from the rows as they are', { skip: serverDatabase && 'SQLite only' }, async () => {
    for (const shape of POLICY_SHAPES) {
      for (const [method, lock] of Object.entries(lockers)) {
        await fixture.reset()
        const { result, sql } = await fixture.measure(() => fixture.api.transaction(transaction => lock(transaction, asUser('u1', shape))))
        assert.deepEqual(ids(result), ['1'], `${method}, ${shape}`)
        assert.deepEqual(sql.filter(statement => ANY_LOCK.test(statement)), [], `${method}, ${shape}`)
        await fixture.knex('lp_members').where({ id: 1 }).del()
        assert.deepEqual(ids(await fixture.api.transaction(transaction => lock(transaction, asUser('u1', shape)))), [], `${method}, ${shape}`)
      }
    }
  })

  it('reads that do not lock keep their subqueries plain: query, get, a scoped query for a lock, and claim', async () => {
    for (const shape of POLICY_SHAPES) {
      await fixture.reset()
      const context = asUser('u1', shape)
      const { sql } = await fixture.measure(async () => {
        assert.deepEqual(await readPlainly(undefined, context), ['1'])
        assert.equal(String((await fixture.projects.get({ id: '1' }, context)).id), '1')
        await fixture.api.transaction(async transaction => {
          const { query } = await fixture.projects.scopedQuery({ transaction, purpose: 'lock' }, context)
          assert.deepEqual((await query.select('id')).map(row => String(row.id)), ['1'])
          assert.deepEqual(ids(await fixture.projects.claim({ transaction, sort: ['id'] }, context)), ['1'])
        })
      })
      assert.deepEqual(sql.filter(statement => SHARED_LOCK.test(statement)), [], shape)
    }
  })
})
