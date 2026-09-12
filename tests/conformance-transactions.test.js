import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const identifier = ({ type, id }) => ({ type, id })
const document = (type, id, attributes, relationships) => ({
  data: { type, id, ...(attributes === undefined ? {} : { attributes }), ...(relationships === undefined ? {} : { relationships }) }
})

const sqlite = databaseClient === 'better-sqlite3'

// Bound every rendezvous and release it even if an assertion or competing call fails.
async function withPausedWrite (install, operation, inspect) {
  const reached = Promise.withResolvers()
  const release = Promise.withResolvers()
  let timer
  install(async context => { reached.resolve(context); await release.promise })
  const pending = operation()
  const outcome = pending.then(value => ({ value }), error => ({ error }))
  try {
    const context = await Promise.race([
      reached.promise,
      outcome.then(({ error }) => { throw error || new Error('Write finished before reaching the barrier') }),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Write did not reach the barrier')), 10000) })
    ])
    await inspect(context)
  } finally {
    clearTimeout(timer)
    install(undefined)
    release.resolve()
    await outcome
  }
  return outcome
}

describe(`Concurrent transactions on ${databaseClient} (${storageMode.mode})`, () => {
  let fixture, group, item, other, beforePatch, finish, nextTransactionOptions, effects
  const transactions = new Set()
  const transaction = async options => {
    nextTransactionOptions = options
    const owner = await holdManagedTransaction(fixture.api)
    transactions.add(owner)
    return owner
  }
  const get = async (record, trx) => (await fixture.api.resources[record.type].get({ id: record.id, transaction: trx })).data
  const linkage = async (record, relationshipName, trx) => (await fixture.api.resources[record.type].getRelationship({
    id: record.id, relationshipName, transaction: trx
  })).data
  const patch = (record, attributes, trx, context = {}) => fixture.api.resources[record.type].patch({
    id: record.id, document: document(record.type, record.id, attributes), transaction: trx
  }, context)
  const compete = async (firstWrite, secondWrite) => {
    const first = await transaction()
    const second = await transaction()
    let mysqlTimeout
    if (databaseClient === 'pg') await second.transaction.raw("SET LOCAL lock_timeout = '250ms'")
    if (databaseClient === 'mysql2') {
      mysqlTimeout = (await second.transaction.raw('SELECT @@innodb_lock_wait_timeout AS timeout'))[0][0].timeout
      await second.transaction.raw('SET SESSION innodb_lock_wait_timeout = 1')
    }
    let conflict
    try {
      await firstWrite(first.transaction)
      try { await secondWrite(second.transaction) } catch (error) { conflict = error }
    } finally {
      if (mysqlTimeout !== undefined) await second.transaction.raw('SET SESSION innodb_lock_wait_timeout = ?', [mysqlTimeout])
    }
    if (conflict) {
      assert.ok(['55P03', 'ER_LOCK_WAIT_TIMEOUT', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT'].includes(conflict.code), conflict.stack)
      assert.equal(second.transaction.isCompleted(), false)
      await second.rollback()
      await first.commit()
      await secondWrite()
    } else {
      await second.commit()
      await first.commit()
    }
  }

  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: {
        bulk: true,
        inverseMembership: true,
        fieldCallback: (phase, scopeName, value) => {
          if (effects && phase === 'setter' && scopeName === 'items') effects.push(['setter', value])
          return phase === 'computed' ? `Computed ${value}` : value
        }
      },
      databaseOptions: { concurrent: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      helpers: {
        newTransaction: () => {
          const options = nextTransactionOptions
          nextTransactionOptions = undefined
          return fixture.knex.transaction(options)
        }
      },
      hooks: {
        beforeDataCallPatch: {
          functionName: 'transaction-rendezvous',
          handler: ({ context, scopeName }) => {
            if (effects && scopeName === 'items') effects.push(['hook', context.id])
            return beforePatch?.(context, scopeName)
          }
        },
        beforeDataCallPost: {
          functionName: 'transaction-post-rendezvous',
          handler: ({ context, scopeName }) => beforePatch?.(context, scopeName)
        },
        beforeDataCallPut: {
          functionName: 'transaction-put-rendezvous',
          handler: ({ context, scopeName }) => beforePatch?.(context, scopeName)
        },
        finish: {
          functionName: 'transaction-finish-observer',
          handler: ({ context, scopeName }) => finish?.(context, scopeName)
        }
      }
    })
  })
  beforeEach(async () => {
    beforePatch = finish = effects = undefined
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original', score: 1 })
    other = await fixture.seed('items', { name: 'Other', score: 2 })
    if (fixture.api.anyapi) {
      const { registry, tenantId } = fixture.api.anyapi
      for (const resource of ['items', 'groups', 'memberships']) registry.invalidateDescriptor(tenantId, resource)
    }
  })
  afterEach(async () => {
    beforePatch = finish = effects = undefined
    for (const trx of transactions) if (!trx.transaction.isCompleted()) await trx.rollback()
    transactions.clear()
  })
  after(async () => { await fixture?.close() })

  it('starts an independent top-level unit when a callback calls api.transaction again', async () => {
    const primary = new Error('Roll back the outer unit')
    await assert.rejects(fixture.api.transaction(async outer => {
      const created = await fixture.api.transaction(async inner => {
        assert.notEqual(inner, outer)
        assert.ok(!inner.parentTransaction)
        assert.notEqual(await inner.client.acquireConnection(), await outer.client.acquireConnection())
        return fixture.api.resources.items.post({
          transaction: inner, document: document('items', '99', { name: 'Independent inner write' })
        })
      })
      assert.equal(created.data.id, '99')
      assert.equal(outer.isCompleted(), false)
      await patch(item, { name: 'Outer write' }, outer)
      throw primary
    }), error => error.cause === primary && error.transactionOutcome === 'rolledBack')
    assert.equal(await fixture.count('items'), 3)
    assert.equal((await get(item)).attributes.name, 'Original')
    assert.equal((await get({ type: 'items', id: '99' })).attributes.name, 'Independent inner write')
  })

  for (const commit of [false, true]) {
    it(`keeps created records and included belongsTo data private until the owner ${commit ? 'commits' : 'rolls back'}`, async () => {
      const writer = await transaction()
      const observer = await transaction()
      assert.notEqual(await writer.transaction.client.acquireConnection(), await observer.transaction.client.acquireConnection())
      const newGroup = (await fixture.api.resources.groups.post({
        document: document('groups', '99', { name: 'Uncommitted group' }), transaction: writer.transaction
      })).data
      const created = (await fixture.api.resources.items.post({
        document: document('items', '99', { name: 'Uncommitted item' }, { group: { data: identifier(newGroup) } }),
        queryParams: { include: ['group'] },
        transaction: writer.transaction
      }))
      assert.equal(created.data.relationships.group.data.id, '99')
      assert.equal(created.included.find(row => row.type === 'groups').attributes.name, 'Uncommitted group')
      assert.deepEqual(await linkage(newGroup, 'items', writer.transaction), [identifier(created.data)])
      assert.deepEqual((await fixture.api.resources.groups.getRelated({
        id: '99', relationshipName: 'items', transaction: writer.transaction
      })).data.map(identifier), [identifier(created.data)])
      for (const trx of [undefined, observer.transaction]) {
        const records = (await fixture.api.resources.items.query({ transaction: trx })).data
        assert.equal(records.length, 2)
        assert.ok(records.every(row => row.id !== '99'))
      }
      assert.equal(writer.transaction.isCompleted(), false)
      await observer.rollback()
      if (commit) await writer.commit()
      else await writer.rollback()
      assert.equal(await fixture.count('items'), commit ? 3 : 2)
      assert.equal(await fixture.count('groups'), commit ? 2 : 1)
      if (commit) assert.deepEqual(await linkage(newGroup, 'items'), [identifier(created.data)])
    })
  }

  for (const relationshipName of ['items', 'firstItem', 'mentions']) {
    it(`rolls back reverse ${relationshipName} writes together with many-to-many membership`, async () => {
      const writer = await transaction()
      await fixture.api.resources.groups.patchRelationship({
        id: group.id,
        relationshipName,
        relationshipData: relationshipName === 'firstItem' ? identifier(item) : [identifier(item)],
        transaction: writer.transaction
      })
      await fixture.api.resources.items.postRelationship({
        id: item.id, relationshipName: 'groups', relationshipData: [identifier(group)], transaction: writer.transaction
      })
      assert.deepEqual(await linkage(item, 'groups', writer.transaction), [identifier(group)])
      assert.deepEqual(await linkage(group, relationshipName, writer.transaction), relationshipName === 'firstItem' ? identifier(item) : [identifier(item)])
      assert.deepEqual(await linkage(item, 'groups'), [])
      assert.deepEqual(await linkage(group, relationshipName), relationshipName === 'firstItem' ? null : [])
      assert.equal(writer.transaction.isCompleted(), false)
      await writer.rollback()
      assert.deepEqual(await linkage(item, 'groups'), [])
      assert.deepEqual(await linkage(group, relationshipName), relationshipName === 'firstItem' ? null : [])
      assert.equal(await fixture.count('memberships'), 0)
    })
  }

  it('rolls back all reverse writes after a later child fails, without exposing an earlier child', async () => {
    const visited = []
    finish = async (context, scopeName) => {
      if (scopeName !== 'items' || context.method !== 'patch') return
      visited.push(context.id)
      assert.deepEqual(await linkage(group, 'items'), [])
      if (visited.length === 2) throw new Error('Second child failed')
    }
    await assert.rejects(fixture.api.resources.groups.patchRelationship({
      id: group.id, relationshipName: 'items', relationshipData: [identifier(item), identifier(other)]
    }), /Second child failed/)
    assert.deepEqual(visited, [item.id, other.id])
    assert.deepEqual(await linkage(group, 'items'), [])
  })

  it('preserves a repeatable-read snapshot while a separate writer commits', async () => {
    const observer = await transaction(sqlite ? undefined : { isolationLevel: 'repeatable read' })
    assert.equal((await get(item, observer.transaction)).attributes.name, 'Original')
    await patch(item, { name: 'Committed elsewhere' })
    assert.equal((await get(item)).attributes.name, 'Committed elsewhere')
    assert.equal((await get(item, observer.transaction)).attributes.name, 'Original')
    await observer.commit()
  })

  for (const relationshipName of ['items', 'firstItem', 'mentions']) {
    it(`does not merge competing replacements of reverse ${relationshipName}`, async () => {
      const replace = (record, trx) => fixture.api.resources.groups.patchRelationship({
        id: group.id,
        relationshipName,
        relationshipData: relationshipName === 'firstItem' ? identifier(record) : [identifier(record)],
        transaction: trx
      })
      await compete(trx => replace(item, trx), trx => replace(other, trx))
      // A to-one response could hide a second child; inspect the full inverse collection.
      assert.deepEqual(await linkage(group, relationshipName === 'mentions' ? 'mentions' : 'items'), [identifier(other)])
    })
  }

  it('does not merge competing many-to-many replacements', async () => {
    const otherGroup = await fixture.seed('groups', { name: 'Other group' })
    const replace = (record, trx) => fixture.api.resources.items.patchRelationship({
      id: item.id, relationshipName: 'groups', relationshipData: [identifier(record)], transaction: trx
    })
    await compete(trx => replace(group, trx), trx => replace(otherGroup, trx))
    assert.deepEqual(await linkage(item, 'groups'), [identifier(otherGroup)])
  })

  it('adds the same many-to-many member once across competing requests', async () => {
    const add = trx => fixture.api.resources.items.postRelationship({
      id: item.id, relationshipName: 'groups', relationshipData: [identifier(group)], transaction: trx
    })
    await compete(add, add)
    assert.deepEqual(await linkage(item, 'groups'), [identifier(group)])
    const [{ count }] = await fixture.knex(fixture.storage === 'anyapi' ? 'any_links' : 'conformance_memberships').count('* AS count')
    assert.equal(Number(count), 1)
  })

  it('adds the same many-to-many edge once through opposite relationship endpoints', async () => {
    await compete(
      trx => fixture.api.resources.items.postRelationship({
        id: item.id, relationshipName: 'groups', relationshipData: [identifier(group)], transaction: trx
      }),
      trx => fixture.api.resources.groups.postRelationship({
        id: group.id, relationshipName: 'members', relationshipData: [identifier(item)], transaction: trx
      })
    )
    assert.deepEqual(await linkage(item, 'groups'), [identifier(group)])
    assert.deepEqual(await linkage(group, 'members'), [identifier(item)])
    const [{ count }] = await fixture.knex(fixture.storage === 'anyapi' ? 'any_links' : 'conformance_memberships').count('* AS count')
    assert.equal(Number(count), 1)
  })

  for (const method of ['patch', 'put']) {
    for (const reverse of [false, true]) {
      it(`serializes relationship replacements through resource ${method.toUpperCase()} (${reverse ? 'reverse' : 'many-to-many'})`, async () => {
        const otherGroup = await fixture.seed('groups', { name: 'Other group' })
        const owner = reverse ? group : item
        const relationshipName = reverse ? 'items' : 'groups'
        const replace = (record, trx) => fixture.api.resources[owner.type][method]({
          id: owner.id,
          document: document(owner.type, owner.id,
            method === 'put' ? { name: 'Replacement', ...(reverse ? {} : { active: true, score: 1 }) } : undefined,
            { [relationshipName]: { data: [identifier(record)] }, ...(reverse ? { firstItem: { data: identifier(record) } } : {}) }),
          transaction: trx
        })
        const replacement = reverse ? other : otherGroup
        await compete(trx => replace(reverse ? item : group, trx), trx => replace(replacement, trx))
        assert.deepEqual(await linkage(owner, relationshipName), [identifier(replacement)])
      })
    }
  }

  for (const deletedParent of [false, true]) {
    it(`rejects a relationship write when its ${deletedParent ? 'parent' : 'target'} was deleted after validation`, async () => {
      const deletion = await transaction()
      const writer = await transaction()
      const removed = deletedParent ? item : group
      await fixture.api.resources[removed.type].delete({ id: removed.id, transaction: deletion.transaction })
      const outcome = await withPausedWrite(
        callback => { beforePatch = callback && ((context, scopeName) => context.pause && scopeName === 'items' ? callback(context) : undefined) },
        () => fixture.api.resources.items.patchRelationship({
          id: item.id, relationshipName: 'groups', relationshipData: [identifier(group)], transaction: writer.transaction
        }, { pause: true }),
        () => deletion.commit()
      )
      assert.ok(outcome.error)
      assert.ok(['REST_API_RESOURCE', '40001', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT'].includes(outcome.error.code), outcome.error.stack)
      if (outcome.error.code === 'REST_API_RESOURCE') assert.equal(outcome.error.subtype, 'not_found')
      await writer.rollback()
      assert.equal(await fixture.count('memberships'), 0)
      await assert.rejects(get(removed), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
      if (!deletedParent) assert.deepEqual(await linkage(item, 'groups'), [])
    })
  }

  it('does not replay setters or hook side effects after a real write conflict', async () => {
    const first = await transaction()
    const second = await transaction()
    let mysqlTimeout
    if (databaseClient === 'pg') await second.transaction.raw("SET LOCAL lock_timeout = '250ms'")
    if (databaseClient === 'mysql2') {
      mysqlTimeout = (await second.transaction.raw('SELECT @@innodb_lock_wait_timeout AS timeout'))[0][0].timeout
      await second.transaction.raw('SET SESSION innodb_lock_wait_timeout = 1')
    }
    await patch(item, { name: 'Winning writer' }, first.transaction)
    effects = []
    try {
      await assert.rejects(patch(item, { name: 'Losing writer' }, second.transaction), error => {
        assert.ok(['55P03', 'ER_LOCK_WAIT_TIMEOUT', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT'].includes(error.code), error.stack)
        return true
      })
      assert.deepEqual(effects, [['hook', item.id], ['setter', 'Losing writer']])
      if (mysqlTimeout !== undefined) await second.transaction.raw('SET SESSION innodb_lock_wait_timeout = ?', [mysqlTimeout])
      mysqlTimeout = undefined
      await second.rollback()
      await first.commit()
      assert.deepEqual(effects, [['hook', item.id], ['setter', 'Losing writer']], 'Completion must neither replay nor pretend to undo external effects')
      assert.equal((await get(item)).attributes.name, 'Winning writer')
    } finally {
      if (mysqlTimeout !== undefined) {
        await second.transaction.raw('SET SESSION innodb_lock_wait_timeout = ?', [mysqlTimeout])
      }
    }
  })

  if (!sqlite) {
    it('reports a native deadlock and preserves only the surviving transaction\'s writes', async () => {
      const first = await transaction()
      const second = await transaction()
      if (databaseClient === 'pg') {
        await first.transaction.raw("SET LOCAL lock_timeout = '3s'")
        await second.transaction.raw("SET LOCAL lock_timeout = '3s'")
      }
      await patch(item, { name: 'Writer A' }, first.transaction)
      await patch(other, { name: 'Writer B' }, second.transaction)
      const results = await Promise.allSettled([
        patch(other, { name: 'Writer A' }, first.transaction),
        patch(item, { name: 'Writer B' }, second.transaction)
      ])
      assert.equal(results.filter(result => result.status === 'rejected').length, 1)
      const failed = results.findIndex(result => result.status === 'rejected')
      assert.equal(results[failed].reason.code, databaseClient === 'pg' ? '40P01' : 'ER_LOCK_DEADLOCK')
      assert.equal(first.transaction.isCompleted(), false)
      assert.equal(second.transaction.isCompleted(), false)
      await (failed === 0 ? first : second).rollback()
      await (failed === 0 ? second : first).commit()
      const expected = failed === 0 ? 'Writer B' : 'Writer A'
      assert.equal((await get(item)).attributes.name, expected)
      assert.equal((await get(other)).attributes.name, expected)
    })
  }

  for (const method of ['post', 'put', 'patch']) {
    for (const relationshipName of ['group', 'subject']) {
      it(`rejects ${method.toUpperCase()} when its ${relationshipName} target is deleted after validation`, async () => {
        const deletion = await transaction()
        const writer = await transaction()
        await fixture.api.resources.groups.delete({ id: group.id, transaction: deletion.transaction })
        const id = method === 'post' ? '99' : item.id
        const outcome = await withPausedWrite(
          callback => { beforePatch = callback && ((context, scopeName) => context.pause && scopeName === 'items' ? callback(context) : undefined) },
          () => fixture.api.resources.items[method]({
            id,
            document: document('items', id, { name: 'Changed', ...(method === 'put' ? { active: true, score: 1 } : {}) }, {
              [relationshipName]: { data: identifier(group) }
            }),
            transaction: writer.transaction
          }, { pause: true }),
          () => deletion.commit()
        )
        assert.ok(outcome.error, 'A write must not attach a reference to a target that was deleted')
        assert.ok(['REST_API_RESOURCE', '40001', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT'].includes(outcome.error.code), outcome.error.stack)
        if (outcome.error.code === 'REST_API_RESOURCE') assert.equal(outcome.error.subtype, 'not_found')
        await writer.rollback()
        assert.equal(await fixture.count('items'), 2)
        assert.equal((await get(item)).attributes.name, 'Original')
        assert.deepEqual(await linkage(item, relationshipName), null)
      })
    }
  }

  for (const reverse of [false, true]) {
    it(`replaces ${reverse ? 'reverse' : 'many-to-many'} membership after an older snapshot saw the collection empty`, async () => {
      const otherGroup = await fixture.seed('groups', { name: 'Other group' })
      const owner = reverse ? group : item
      const relationshipName = reverse ? 'items' : 'groups'
      const initial = reverse ? item : group
      const replacement = reverse ? other : otherGroup
      const replace = (record, trx, context) => fixture.api.resources[owner.type].patchRelationship({
        id: owner.id, relationshipName, relationshipData: [identifier(record)], transaction: trx
      }, context)
      const first = await transaction()
      const second = await transaction(sqlite ? undefined : { isolationLevel: 'repeatable read' })
      await replace(initial, first.transaction)
      const outcome = await withPausedWrite(
        callback => { beforePatch = callback && ((context, scopeName) => context.pause && scopeName === owner.type ? callback(context) : undefined) },
        () => replace(replacement, second.transaction, { pause: true }),
        async () => {
          assert.deepEqual(await linkage(owner, relationshipName, second.transaction), [])
          await first.commit()
        }
      )
      if (outcome.error) {
        assert.ok(['40001', 'SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT'].includes(outcome.error.code), outcome.error.stack)
        await second.rollback()
        await replace(replacement)
      } else await second.commit()
      assert.deepEqual(await linkage(owner, relationshipName), [identifier(replacement)])
    })
  }

  it('preserves disjoint PATCH fields across overlapping reads and writes', async () => {
    const writer = await transaction()
    const outcome = await withPausedWrite(
      callback => { beforePatch = callback && ((context) => context.pause ? callback(context) : undefined) },
      () => patch(item, { score: 9 }, writer.transaction, { pause: true }),
      async context => {
        assert.equal(context.transaction, writer.transaction)
        await patch(item, { name: 'Other writer' })
        assert.equal((await get(item)).attributes.score, 1)
      }
    )
    if (sqlite) {
      assert.ok(outcome.error, 'A stale SQLite snapshot must not upgrade to a writer')
      assert.match(outcome.error.message, /SQLITE_BUSY|database is locked/)
      await writer.rollback()
      await patch(item, { score: 9 })
    } else {
      assert.ifError(outcome.error)
      assert.equal(writer.transaction.isCompleted(), false)
      await writer.commit()
    }
    const stored = await get(item)
    assert.equal(stored.attributes.name, 'Other writer')
    assert.equal(stored.attributes.score, 9)
  })

  for (const fail of [false, true]) {
    it(`keeps an atomic bulk batch private and ${fail ? 'rolls back every write on failure' : 'publishes all writes on commit'}`, async () => {
      const outcome = await withPausedWrite(
        callback => {
          beforePatch = callback && (async context => {
            if (context.bulkIndex !== 1) return
            await callback(context)
            if (fail) throw new Error('Second bulk item failed')
          })
        },
        () => fixture.api.resources.items.bulkPatch({
          atomic: true,
          operations: [item, other].map(record => ({
            id: record.id, document: document('items', record.id, { score: 9 })
          }))
        }),
        async context => {
          assert.equal((await get(item, context.transaction)).attributes.score, 9)
          assert.equal((await get(item)).attributes.score, 1)
          assert.equal((await get(other)).attributes.score, 2)
        }
      )
      if (fail) assert.match(outcome.error?.message || '', /Second bulk item failed/)
      else {
        assert.ifError(outcome.error)
        assert.equal(outcome.value.meta.succeeded, 2)
      }
      assert.equal((await get(item)).attributes.score, fail ? 1 : 9)
      assert.equal((await get(other)).attributes.score, fail ? 2 : 9)
    })
  }
})

describe(`Concurrent generated IDs on ${databaseClient} (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createConformanceFixture({ databaseOptions: { concurrent: true } }) })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  for (const commit of [false, true]) {
    it(`keeps generated identities consistent when the first writer ${commit ? 'commits' : 'rolls back'}`, async () => {
      const transactions = []
      const post = async (name, transaction) => (await fixture.api.resources.items.post({
        document: { data: { type: 'items', attributes: { name } } }, transaction
      })).data
      try {
        const first = await holdManagedTransaction(fixture.api)
        transactions.push(first)
        const second = await holdManagedTransaction(fixture.api)
        transactions.push(second)
        assert.notEqual(await first.transaction.client.acquireConnection(), await second.transaction.client.acquireConnection())
        const created = await post('First writer', first.transaction)
        let concurrent
        if (sqlite) {
          await assert.rejects(post('Second writer', second.transaction), /SQLITE_BUSY|database is locked/)
          assert.equal(second.transaction.isCompleted(), false)
          await second.rollback()
        } else {
          concurrent = await post('Second writer', second.transaction)
          assert.notEqual(concurrent.id, created.id)
          assert.deepEqual((await fixture.api.resources.items.query({ transaction: second.transaction })).data.map(identifier), [identifier(concurrent)])
        }
        assert.equal(await fixture.count('items'), 0)
        if (commit) await first.commit()
        else await first.rollback()
        if (sqlite) concurrent = await post('Second writer')
        else await second.commit()
        if (commit) assert.notEqual(concurrent.id, created.id)
        const records = (await fixture.api.resources.items.query()).data
        assert.equal(records.length, commit ? 2 : 1)
        assert.equal(records.find(row => row.id === concurrent.id).attributes.name, 'Second writer')
        if (commit) assert.equal(records.find(row => row.id === created.id).attributes.name, 'First writer')
        else assert.ok(records.every(row => row.attributes.name !== 'First writer'))
      } finally {
        for (const trx of transactions) if (!trx.transaction.isCompleted()) await trx.rollback()
      }
    })
  }
})
