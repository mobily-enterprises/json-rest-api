import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSystemContext } from '../index.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { LOCK_STRENGTH, classifyStatement, lockStrength, transactionChecks } from '../plugins/core/lib/querying-writing/transaction-checks.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createTransactionCheckApi } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'

// Inside a transaction from api.transaction, a write's check of a row it links
// to, and a response's check of a link it shows, is answered by the
// transaction's own earlier check of the row in the same scope, until anything
// the transaction sends could have changed the answer.
const canonical = storageMode.isAnyApi()
const tables = { tc_people: 'tc_people', tc_notes: 'tc_notes', ...(canonical ? {} : { tc_blocked: 'tc_blocked' }) }
// A request's context, which a call extends: a new one for every call.
const w1 = () => ({ workspace: 'w1' })
const w2 = () => ({ workspace: 'w2' })
const system = () => createSystemContext('transaction check test')

// Every statement a call sends, as { sql, bindings }.
const statementsOf = async (fixture, run) => {
  const queries = []
  const capture = ({ sql, bindings }) => queries.push({ sql, bindings: bindings || [] })
  fixture.knex.on('query', capture)
  try { await run() } finally { fixture.knex.off('query', capture) }
  return queries
}
// The statements that read people.
const peopleReads = queries => queries.filter(({ sql, bindings }) => /^select /i.test(sql) &&
  (canonical ? bindings.includes('tc_people') : sql.includes('tc_people')))

const causes = error => {
  const chain = []
  for (let current = error; current && !chain.includes(current); current = current.cause) chain.push(current)
  return chain
}
// The refusal of a link to a person the caller cannot see, however the transaction wraps it.
const refusedAsMissing = id => error => {
  const message = `Cannot create relationship to non-existent tc_people with id ${id}`
  assert.ok(causes(error).some(cause => cause instanceof RestApiResourceError && cause.message === message), `expected "${message}", got: ${error?.message}`)
  return true
}

describe(`Checks remembered in a transaction (${storageMode.mode})`, () => {
  let fixture
  const note = (author, { editor, workspace = 'w1' } = {}) => ({
    type: 'tc_notes',
    attributes: { title: 'Note', workspace },
    relationships: {
      author: { data: { type: 'tc_people', id: String(author) } },
      ...(editor === undefined ? {} : { editor: { data: { type: 'tc_people', id: String(editor) } } })
    }
  })
  const post = (row, context, { transaction, returning = 'none' } = {}) =>
    fixture.api.resources.tc_notes.post({ document: { data: row }, returning, ...(transaction ? { transaction } : {}) }, context)
  const people = () => fixture.api.knex.helpers.getStorageAdapter('tc_people')
  // A statement the caller sends itself, outside the library's writes.
  const setPerson = (transaction, id, attributes) => {
    const adapter = people()
    return adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), String(id)).update(adapter.toStorageRow(attributes))
  }
  const addPerson = (id, workspace, archived = false) => fixture.api.resources.tc_people.post({
    document: { data: { type: 'tc_people', id: String(id), attributes: { name: `Person ${id}`, workspace, archived } } }
  }, system())

  // Links the person twice in one transaction, the second answered by the
  // first, runs `change` in the transaction, then links the person again: the
  // last link is refused and the transaction writes nothing.
  const refusedAfter = async (id, change) => {
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(note(id), w1(), { transaction })
      const again = peopleReads(await statementsOf(fixture, () => post(note(id), w1(), { transaction })))
      // Canonical storage keeps every resource in one table, so the first note's insert forgets the check.
      if (!canonical) assert.deepEqual(again, [], 'the second link is answered by the first check')
      await change(transaction)
      await post(note(id), w1(), { transaction })
    }), refusedAsMissing(id))
    assert.equal(await fixture.count('tc_notes'), 0)
  }

  before(async () => { fixture = await createConformanceFixture({ createApi: createTransactionCheckApi, tables }) })
  beforeEach(async () => {
    await fixture.reset()
    // People 1 and 2 are in workspace w1, 3 in w2; 4 is in w1 but archived, which the row policy hides.
    await addPerson(1, 'w1')
    await addPerson(2, 'w1')
    await addPerson(3, 'w2')
    await addPerson(4, 'w1', true)
  })
  after(async () => { await fixture?.close() })

  it('checks each linked person once per transaction, however many notes link to them', async () => {
    const reads = async (count, inTransaction) => peopleReads(await statementsOf(fixture, async () => {
      const write = async transaction => {
        for (let index = 0; index < count; index++) await post(note(1, { editor: 2 }), w1(), { transaction, returning: 'full' })
      }
      if (inTransaction) await fixture.api.transaction(write)
      else await write()
    })).length
    const one = await reads(1, true)
    assert.ok(one >= 1)
    // Canonical storage keeps every resource in one table, so each note's insert forgets the checks before it.
    assert.equal(await reads(20, true), canonical ? 20 * one : one)
    // Without a shared transaction each write checks the people again, as before.
    const alone = await reads(1, false)
    assert.equal(alone, one)
    assert.equal(await reads(20, false), 20 * alone)
    assert.equal(await fixture.count('tc_notes'), 42)
  })

  it('refuses a person the transaction deleted after checking them', async () => {
    await refusedAfter(1, transaction => fixture.api.resources.tc_people.delete({ id: '1', transaction }, system()))
  })

  it('refuses a person the transaction moved to another workspace', async () => {
    await refusedAfter(1, transaction => fixture.api.resources.tc_people.patch({
      id: '1', transaction, document: { data: { type: 'tc_people', id: '1', attributes: { workspace: 'w2' } } }
    }, system()))
    await refusedAfter(2, transaction => setPerson(transaction, 2, { workspace: 'w2' }))
  })

  it('refuses a person the transaction archived, which the row policy hides', async () => {
    await refusedAfter(2, transaction => setPerson(transaction, 2, { archived: true }))
  })

  it('refuses a person a row the transaction adds to a table the row policy reads hides', { skip: canonical && 'the policy reads tc_blocked only on ordinary tables' }, async () => {
    await refusedAfter(1, transaction => transaction('tc_blocked').insert({ person_id: 1 }))
  })

  it('refuses a person again once a savepoint the check ran in is rolled back', async () => {
    await assert.rejects(fixture.api.transaction(async transaction => {
      const undo = new Error('undo the savepoint')
      await assert.rejects(transaction.transaction(async savepoint => {
        // Inside the savepoint, archived person 4 is visible and linked.
        await setPerson(savepoint, 4, { archived: false })
        await post(note(4), w1(), { transaction })
        throw undo
      }), error => causes(error).includes(undo))
      await post(note(4), w1(), { transaction })
    }), refusedAsMissing(4))
    assert.equal(await fixture.count('tc_notes'), 0)
  })

  it('never answers one workspace\'s check with another\'s, or a scoped check with a system context\'s', async () => {
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(note(1), w1(), { transaction })
      await post(note(1, { workspace: 'w2' }), w2(), { transaction })
    }), refusedAsMissing(1))
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(note(3), system(), { transaction })
      await post(note(3), w1(), { transaction })
    }), refusedAsMissing(3))
    assert.equal(await fixture.count('tc_notes'), 0)
  })

  it('starts each transaction without what an earlier one checked, rolled back or committed', async () => {
    const rollBack = new Error('roll back')
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(note(1), w1(), { transaction })
      throw rollBack
    }), error => causes(error).includes(rollBack))
    await fixture.api.transaction(transaction => post(note(2), w1(), { transaction }))
    await setPerson(undefined, 1, { archived: true })
    await setPerson(undefined, 2, { archived: true })
    await assert.rejects(fixture.api.transaction(transaction => post(note(1), w1(), { transaction })), refusedAsMissing(1))
    await assert.rejects(fixture.api.transaction(transaction => post(note(2), w1(), { transaction })), refusedAsMissing(2))
    assert.equal(await fixture.count('tc_notes'), 1)
  })

  it('keeps every refusal: another workspace\'s person, a hidden one, a deleted one and a missing one', async () => {
    await addPerson(5, 'w1')
    await fixture.api.resources.tc_people.delete({ id: '5' }, system())
    for (const id of [3, 4, 5, 999]) {
      await assert.rejects(fixture.api.transaction(async transaction => {
        await post(note(1, { editor: 2 }), w1(), { transaction })
        await post(note(1, { editor: id }), w1(), { transaction })
      }), refusedAsMissing(id))
    }
    assert.equal(await fixture.count('tc_notes'), 0)
  })

  it('remembers only inside an open transaction from api.transaction, and only a row found under a lock at least as strong', async () => {
    assert.equal(transactionChecks(fixture.knex), undefined)
    const raw = await fixture.knex.transaction()
    try { assert.equal(transactionChecks(raw), undefined) } finally { await raw.rollback() }
    let finished
    await fixture.api.transaction(async transaction => {
      finished = transaction
      const checks = transactionChecks(transaction)
      assert.equal(transactionChecks(transaction), checks)
      const adapter = people()
      const query = adapter.buildBaseQuery({ transaction }).where(adapter.translateColumn('workspace'), 'w1')
        .whereIn(adapter.getIdColumn(), ['1', '2'])
      const scope = checks.scopeOf(query, query._statements.at(-1), adapter.getIdColumn())
      assert.ok(scope)
      // A different scope value is a different check.
      const other = adapter.buildBaseQuery({ transaction }).where(adapter.translateColumn('workspace'), 'w2')
        .whereIn(adapter.getIdColumn(), ['1', '2'])
      assert.notEqual(checks.scopeOf(other, other._statements.at(-1), adapter.getIdColumn()).key, scope.key)
      // A query whose rows depend on each other, or on a limit, is not remembered.
      assert.equal(checks.scopeOf(query.clone().limit(1), query._statements.at(-1), adapter.getIdColumn()), undefined)
      assert.equal(checks.scopeOf(query, undefined, adapter.getIdColumn()), undefined)

      checks.remember(scope, ['1'], LOCK_STRENGTH.none, checks.started())
      assert.deepEqual([...checks.known(scope, ['1', '2'], LOCK_STRENGTH.none)], ['1'])
      assert.deepEqual([...checks.known(scope, ['1'], LOCK_STRENGTH.keyShare)], [])
      checks.remember(scope, ['1'], LOCK_STRENGTH.share, checks.started())
      assert.deepEqual([...checks.known(scope, ['1'], LOCK_STRENGTH.keyShare)], ['1'])
      assert.deepEqual([...checks.known(scope, ['1'], LOCK_STRENGTH.update)], [])
      // A write sent while a check runs voids what the check found, and the
      // write forgets what was found before it.
      const started = checks.started()
      await setPerson(transaction, 3, { name: 'Renamed' })
      checks.remember(scope, ['2'], LOCK_STRENGTH.share, started)
      assert.deepEqual([...checks.known(scope, ['1', '2'], LOCK_STRENGTH.none)], [])
    })
    assert.equal(transactionChecks(finished), undefined)

    assert.equal(lockStrength(undefined, fixture.knex), LOCK_STRENGTH.none)
    assert.equal(lockStrength({ exclusive: true, keyShare: true }, fixture.knex), LOCK_STRENGTH.update)
    assert.equal(lockStrength({}, fixture.knex), LOCK_STRENGTH.share)
    assert.equal(lockStrength({ keyShare: true }, fixture.knex), databaseClient === 'pg' ? LOCK_STRENGTH.keyShare : LOCK_STRENGTH.share)
  })
})

describe('What a statement a transaction sends may change', () => {
  const forgetsAll = {}
  const cases = [
    ['select "id" from "people" where "id" in (?)', { reads: true }],
    ['(select 1) union (select 2)', { reads: true }],
    ['with recent as (select id from people) select * from recent', { reads: true }],
    ['with gone as (delete from people returning id) select * from gone', forgetsAll],
    ['insert into "people" ("name") values (?) returning "id"', { table: 'people' }],
    ['insert ignore into `app`.`people` (`name`) values (?)', { table: 'people' }],
    ['insert into `people` (`id`) values (?) on duplicate key update `name` = ?', forgetsAll],
    ['insert into "people" ("id") values ($1) on conflict ("id") do update set "name" = excluded."name"', forgetsAll],
    ['insert into "people" ("id") values ($1) on conflict do nothing', { table: 'people' }],
    ['update "people" set "name" = $1, "updated_at" = $2 where "id" = $3 returning "id"', { table: 'people', columns: ['name', 'updated_at'] }],
    ['update `people` set `people`.`name` = ? where `id` = ?', { table: 'people', columns: ['name'] }],
    ["update people set name = 'a where b, c = d', version = (select max(v) from other where x = 1) where id = ?", { table: 'people', columns: ['name', 'version'] }],
    ['update people set workspace = ? from teams where teams.id = people.team_id', { table: 'people', columns: ['workspace'] }],
    ['update people set name = ?', { table: 'people', columns: ['name'] }],
    ['update people join teams on teams.id = people.team_id set people.name = ?', forgetsAll],
    ['update people p set name = ?', forgetsAll],
    ['update people set (name, workspace) = (?, ?)', forgetsAll],
    ['delete from "people" where "id" = ?', forgetsAll],
    ['SAVEPOINT trx2;', forgetsAll],
    ['ROLLBACK TO SAVEPOINT trx2', forgetsAll],
    ['RELEASE SAVEPOINT trx2', forgetsAll],
    ['truncate people', forgetsAll],
    ['select 1; delete from people', forgetsAll],
    ['/* note */ delete from people', forgetsAll],
    ['call refresh_people()', forgetsAll]
  ]
  for (const [sql, effect] of cases) {
    it(sql, () => { assert.deepEqual({ ...classifyStatement(sql) }, effect) })
  }
})
