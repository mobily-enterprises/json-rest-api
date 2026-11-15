import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLockedLinkFixture, STAGES_PER_WORKSPACE } from './fixtures/locked-link-api.js'
import { NOWAIT_MYSQL_CODE } from './helpers/transaction-completion.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'

// A lock read (lockWhere, lockByIds) checks its rows' to-one links with a
// locking read of the linked table, scoped to the caller, so a target committed
// after the transaction's first plain read is seen. InnoDB locks every row a
// locking read examines, until the transaction ends. Read through the
// planner's choice, the check examined the caller's whole range of an index
// that starts with the owner, or, on MariaDB with a long id list, every row of
// the table, and held them shared until commit: rows of the caller that no
// task names, and in the full scan every other owner's rows. Through the
// primary key it examines, and holds, the linked rows alone.

const isMysql = databaseClient === 'mysql2'
const asCaller = { scopeValues: { workspaceId: 'ws-a' } }
const ROLLED_BACK = new Error('probe rolled back')

for (const ownerIndex of [false, true]) {
  const label = ownerIndex ? 'stages with an index that starts with the workspace' : 'stages with no index but the primary key'
  describe(`A lock read's link check holds the linked rows alone: ${label} (${databaseClient})`, { skip: storageMode.isAnyApi() && 'locks need table storage' }, () => {
    let fixture
    // Each task's stage: task 1 names another workspace's stage, hidden from the caller; every other task a stage
    // of its own workspace, a different one each, spread over its stages.
    const stageOf = new Map()
    let taskIds
    let probes
    before(async () => {
      fixture = await createLockedLinkFixture({ ownerIndex })
      const { knex } = fixture.database
      const tasks = [{ workspace_id: 'ws-a', name: 'T0000', stage_id: fixture.others[5] }]
      for (let index = 1; index < 1500; index++) {
        tasks.push({ workspace_id: 'ws-a', name: `T${String(index).padStart(4, '0')}`, stage_id: fixture.own[Math.floor(index * STAGES_PER_WORKSPACE / 1500)] })
      }
      for (let start = 0; start < tasks.length; start += 500) await knex(fixture.tasks).insert(tasks.slice(start, start + 500))
      await knex(fixture.tasks).insert(fixture.others.slice(0, 300).map((stage, index) => ({ workspace_id: 'ws-b', name: `X${index}`, stage_id: stage })))
      taskIds = (await knex(fixture.tasks).where({ workspace_id: 'ws-a' }).orderBy('id').select('id', 'stage_id')).map(task => {
        stageOf.set(String(task.id), String(task.stage_id))
        return String(task.id)
      })
      if (isMysql) await knex.raw('analyze table ??, ??', [fixture.stages, fixture.tasks])
      const linked = new Set(stageOf.values())
      const byName = async (workspace, name) => String((await knex(fixture.stages).where({ workspace_id: workspace, name }).first('id')).id)
      probes = {
        // Two stages the first 999 tasks name, which the check holds shared until commit.
        linked: [stageOf.get(taskIds[1]), stageOf.get(taskIds[500])],
        // The caller's stages no task names.
        unlinked: fixture.own.filter(id => !linked.has(id)).filter((_, index) => index % 40 === 7).slice(0, 3),
        // Other workspaces' stages: the first after the caller's in the workspace index, where a scan of the
        // caller's range of it stops, and one of each other workspace in the table's middle.
        others: [await byName('ws-b', 'S0000'), await byName('ws-b', 'S0800'), await byName('ws-c', 'S0801'), await byName('ws-d', 'S1599')]
      }
    })
    after(async () => { await fixture?.database.close() })

    // Whether another transaction can write the stage now: it changes the name, which an index that starts with
    // the workspace holds too, and waits at most a second for a lock.
    const writable = id => fixture.database.knex.transaction(async probe => {
      await probe.raw('set session innodb_lock_wait_timeout = 1')
      try {
        await probe(fixture.stages).where({ id }).update({ name: probe.raw('concat(name, ?)', ['*']) })
      } finally {
        await probe.raw('set session innodb_lock_wait_timeout = default')
      }
      throw ROLLED_BACK
    }).then(() => { throw new Error('the probe committed') }, error => {
      if (error === ROLLED_BACK) return true
      if (NOWAIT_MYSQL_CODE.test(error?.code ?? '')) return false
      throw error
    })

    // Runs the lock read in a transaction, recording its link check, and answers the records, the check's
    // statement and which probed stages another transaction could write while the lock read's transaction held them.
    const lockRead = async read => {
      const checks = []
      const record = query => { if (query.sql.includes(`\`${fixture.stages}\``) && / lock in share mode$/.test(query.sql)) checks.push(query) }
      fixture.database.knex.on('query', record)
      const free = {}
      let records
      try {
        await fixture.api.transaction(async transaction => {
          records = (await read(transaction)).data
          for (const [kind, ids] of Object.entries(probes)) {
            free[kind] = []
            for (const id of ids) free[kind].push(await writable(id))
          }
        })
      } finally { fixture.database.knex.removeListener('query', record) }
      assert.equal(checks.length, 1, 'one link check reads the linked stages')
      return { records, check: checks[0], free }
    }

    // The planner's plan for the check, and on MariaDB the rows it read: a table's rows read are its rows read per
    // loop times its loops.
    const planOf = async ({ sql, bindings }) => {
      const select = sql.replace(/ lock in share mode$/, '')
      const [plan] = await fixture.database.knex.raw(`explain ${select}`, bindings)
      const version = (await fixture.database.knex.raw('select version() as version'))[0][0].version
      let read = ''
      if (/mariadb/i.test(version)) {
        const [rows] = await fixture.database.knex.raw(`analyze format=json ${select}`, bindings)
        const tables = []
        const walk = node => {
          if (!node || typeof node !== 'object') return
          if (node.table?.table_name) tables.push(`${node.table.table_name} ${node.table.access_type} read ${node.table.r_rows * node.table.r_loops}`)
          Object.values(node).forEach(walk)
        }
        walk(JSON.parse(Object.values(rows[0])[0]))
        read = `; read: ${tables.join(', ')}`
      }
      return { plan, text: `${plan.map(row => `${row.table} ${row.type} ${row.key ?? '-'} rows ${row.rows}`).join(', ')}${read}` }
    }

    const checkHoldsLinkedRowsAlone = async (t, { records, check, free }, linkedTasks) => {
      const ids = check.bindings.length - 1
      const { plan, text } = await planOf(check)
      t.diagnostic(`${ids} linked ids; plan: ${text}; writable while held: ${JSON.stringify(free)}`)
      // The answer is the scoped check's: the other workspace's stage stays hidden, every other link as stored.
      assert.equal(records.length, linkedTasks.length)
      for (const task of records) {
        const expected = task.id === taskIds[0] ? null : stageOf.get(task.id)
        assert.equal(task.relationships.stage.data?.id ?? null, expected, `task ${task.id}`)
      }
      assert.deepEqual(free.linked, probes.linked.map(() => false), 'the linked stages are held shared until commit')
      assert.deepEqual(free.unlinked, probes.unlinked.map(() => true), 'the caller\'s other stages stay free')
      assert.deepEqual(free.others, probes.others.map(() => true), 'other workspaces\' stages stay free')
      // It holds them because it reads them alone, through the primary key.
      const stagesRead = plan.filter(row => row.table === fixture.stages)
      assert.equal(stagesRead.length, 1, text)
      const [read] = stagesRead
      assert.equal(read.key, 'PRIMARY', `the check reads the stages by their primary key: ${text}`)
      // A range of the listed ids, or one lookup of each listed id from the list (MariaDB can turn a list of 1,000
      // values or more into a table it reads first).
      assert.ok(read.type === 'range' ? Number(read.rows) <= ids : read.type === 'eq_ref' && Number(read.rows) === 1, `only the listed stages: ${text}`)
      // MySQL picks the primary key here unhinted, so the plan alone would pass without the hint there.
      assert.match(check.sql, new RegExp(`from \`${fixture.stages}\` force index \\(primary\\)`))
    }

    it('lockWhere of 999 tasks reads and holds only the stages they name, through the primary key', { skip: !isMysql && 'MySQL and MariaDB only' }, async t => {
      const result = await lockRead(transaction => fixture.api.resources[fixture.tasks].lockWhere({
        transaction, limit: 999, lockMode: 'share', queryParams: { fields: { [fixture.tasks]: 'name,stage' } }
      }, asCaller))
      await checkHoldsLinkedRowsAlone(t, result, taskIds.slice(0, 999))
    })

    it('lockByIds of 1,500 tasks reads and holds only the stages they name, through the primary key', { skip: !isMysql && 'MySQL and MariaDB only' }, async t => {
      const result = await lockRead(transaction => fixture.api.resources[fixture.tasks].lockByIds({
        transaction, ids: taskIds, queryParams: { fields: { [fixture.tasks]: 'name,stage' } }
      }, asCaller))
      await checkHoldsLinkedRowsAlone(t, result, taskIds)
    })

    it('PostgreSQL and SQLite: the check reads the stages as it did, with no index hint, and answers the same links', { skip: isMysql && 'PostgreSQL and SQLite only' }, async () => {
      const statements = []
      const record = query => { if (new RegExp(`["\`]${fixture.stages}["\`]`).test(query.sql)) statements.push(query.sql) }
      fixture.database.knex.on('query', record)
      let records
      try {
        records = (await fixture.api.transaction(transaction => fixture.api.resources[fixture.tasks].lockWhere({
          transaction, limit: 999, queryParams: { fields: { [fixture.tasks]: 'name,stage' } }
        }, asCaller))).data
      } finally { fixture.database.knex.removeListener('query', record) }
      assert.equal(records.length, 999)
      for (const task of records) assert.equal(task.relationships.stage.data?.id ?? null, task.id === taskIds[0] ? null : stageOf.get(task.id), `task ${task.id}`)
      assert.ok(statements.length > 0)
      assert.ok(statements.every(sql => !/force index/i.test(sql)), statements.join(' | '))
    })
  })
}
