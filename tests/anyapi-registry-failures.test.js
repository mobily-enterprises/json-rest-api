import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createAnyApiFieldEvolutionApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { assertWriteFailure, cleanTables } from './helpers/test-utils.js'
import { databaseClient } from './helpers/test-database.js'
import { abortTransactionBeforeCommit, interceptTransactionCompletion } from './helpers/transaction-completion.js'

const tenant = 'field_evolution'
const schema = { id: { type: 'id' }, name: { type: 'string', required: true } }
const extra = { type: 'id', belongsTo: 'groups', as: 'group', nullable: true }
const tables = ['any_links', 'any_records', 'any_relationship_configs', 'any_field_configs', 'any_resource_configs']
const operations = ['register new', 'register existing', 'allocate field']
const rollbackRequested = new Error('Callback requested metadata rollback')

describe(`AnyAPI registry failures (${databaseClient}, canonical storage)`, () => {
  let fixture, registry, cached, otherCached, storedRecords

  before(async () => {
    fixture = await createConformanceFixture({ storage: 'anyapi', createApi: createAnyApiFieldEvolutionApi, databaseOptions: { concurrent: true, maxConnections: 2 } })
    registry = fixture.api.anyapi.registry
  })
  beforeEach(async () => {
    await cleanTables(fixture.knex, tables, { storage: 'knex' })
    registry.cache.clear()
    cached = await registry.registerResource({ tenant, resource: 'items', schema })
    otherCached = await registry.registerResource({ tenant, resource: 'groups', schema })
    await fixture.seed('groups', { name: 'Group' })
    await fixture.seed('items', { name: 'Item' })
    storedRecords = await fixture.knex('any_records').orderBy('id')
  })
  after(async () => { await fixture?.close() })

  const resourceFor = operation => operation === 'register new' ? 'new_items' : 'items'
  const descriptor = (operation, options) => registry.getDescriptor(tenant, resourceFor(operation), options)
  const run = (operation, options, invalid = false) => operation === 'allocate field'
    ? registry.allocateField({ tenant, resource: 'items', fieldName: invalid ? 'name' : 'groupId', definition: extra }, options)
    : registry.registerResource({
      tenant,
      resource: resourceFor(operation),
      schema: { ...schema, groupId: extra },
      ...(invalid ? { canonicalFieldMap: { name: 'string_1' } } : {})
    }, options)
  const snapshot = async (db = fixture.knex) => {
    const result = {}
    for (const table of tables) result[table] = await db(table).orderBy('id')
    return result
  }

  async function intercept (t, { failCommit, failRollback = false, failLog, configure, transaction: suppliedTransaction } = {}) {
    const state = { commits: 0, rollbacks: 0, acquisitions: 0, logs: [], secondary: new Error('Registry rollback failed') }
    const prepare = transaction => {
      state.transaction = transaction
      state.commit = transaction.commit.bind(transaction)
      state.rollback = transaction.rollback.bind(transaction)
      t.mock.method(transaction, 'commit', async () => {
        state.commits++
        if (failCommit) return failCommit(state)
        return state.commit()
      })
      t.mock.method(transaction, 'rollback', async () => {
        state.rollbacks++
        if (failRollback) throw state.secondary
        return state.rollback()
      })
      configure?.(transaction)
      return transaction
    }
    if (suppliedTransaction) prepare(suppliedTransaction)
    t.mock.method(registry.log, 'error', (...args) => {
      state.logs.push(args)
      if (failLog) return failLog()
    })
    registry.knex = new Proxy(fixture.knex, {
      get (target, key) {
        if (key === 'transaction') {
          return async (...args) => {
            state.acquisitions++
            return suppliedTransaction || prepare(await target.transaction(...args))
          }
        }
        return Reflect.get(target, key)
      }
    })
    state.close = async () => {
      registry.knex = fixture.knex
      t.mock.restoreAll()
      if (state.transaction && !state.transaction.isCompleted()) await state.rollback()
      await state.transaction?.executionPromise.catch(() => {})
    }
    return state
  }

  async function assertUnchanged (operation, beforeState) {
    assert.deepEqual(await snapshot(), beforeState)
    assert.deepEqual(await descriptor(operation), operation === 'register new' ? null : cached)
    assert.deepEqual(await registry.getDescriptor(tenant, 'groups'), otherCached)
  }

  async function assertStored (operation) {
    const current = await descriptor(operation)
    assert.equal(current.schema.groupId.belongsTo, 'groups')
    assert.equal(current.belongsTo.group.target, 'groups')
    assert.deepEqual(current, await descriptor(operation, { bypassCache: true }))
    const row = await fixture.knex('any_resource_configs').where({ tenant_id: tenant, resource: resourceFor(operation) }).first()
    assert.ok(row)
    assert.equal((await fixture.knex('any_field_configs').where({ resource_config_id: row.id, field_name: 'groupId' })).length, 1)
    assert.equal((await fixture.knex('any_relationship_configs').where({ resource_config_id: row.id, relationship_name: 'group' })).length, 1)
    assert.deepEqual(await fixture.knex('any_records').orderBy('id'), storedRecords)
    assert.deepEqual(await registry.getDescriptor(tenant, 'groups'), otherCached)
  }

  for (const operation of operations) {
    it(`${operation} bounds rollback diagnostics without exposing transaction internals`, async t => {
      const primary = new Error('Registry write failed')
      primary.details = { upload: Buffer.from('PRIVATE_REGISTRY_BYTES'), text: 'x'.repeat(100000) }
      const beforeState = await snapshot()
      const state = await intercept(t, {
        failCommit: state => {
          state.secondary.details = { text: 'y'.repeat(100000) }
          throw primary
        },
        failRollback: true
      })
      try {
        await assert.rejects(run(operation), error => assertWriteFailure(error, { cause: primary, outcome: 'unknown' }))
        assert.equal(state.logs.length, 1)
        const event = state.logs[0][1]
        const output = JSON.stringify(state.logs[0])
        assert.ok(output.length < 30000, `Diagnostic length: ${output.length}`)
        assert.deepEqual(Object.keys(event).sort(), ['backend', 'cleanupErrors', 'error', 'method', 'phase', 'scopeName', 'tenant', 'transactionOutcome'])
        assert.equal(event.method, operation === 'allocate field' ? 'allocateField' : 'registerResource')
        assert.equal(event.scopeName, resourceFor(operation))
        assert.equal(event.phase, 'registryRollback')
        assert.equal(event.backend, fixture.knex.client.config.client)
        assert.equal(event.transactionOutcome, 'unknown')
        assert.doesNotMatch(output, /PRIVATE_REGISTRY_BYTES/)
        assert.equal(primary.details.upload.toString(), 'PRIVATE_REGISTRY_BYTES')
        assert.equal(primary.details.text.length, 100000)
        assert.equal(state.secondary.details.text.length, 100000)
      } finally { await state.close() }
      await assertUnchanged(operation, beforeState)
    })

    it(`${operation} rejects owned savepoint completion without publishing metadata or completing its parent`, async t => {
      const beforeState = await snapshot()
      const parent = await fixture.knex.transaction()
      const transaction = await parent.transaction()
      const state = await intercept(t, { transaction })
      try {
        await assert.rejects(run(operation), error => {
          assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' })
          assert.match(error.message, /owned transactions must be top-level/i)
          return true
        })
        assert.equal(state.commits, 0)
        assert.equal(state.rollbacks, 1)
        assert.equal(transaction.parentTransaction, parent)
        assert.equal(transaction.isCompleted(), true)
        assert.equal(parent.isCompleted(), false)
        assert.deepEqual(await snapshot(parent), beforeState)
        await parent.commit()
      } finally {
        await state.close()
        if (!parent.isCompleted()) await parent.rollback()
      }
      await assertUnchanged(operation, beforeState)
    })

    if (databaseClient === 'pg') {
      it(`${operation} rejects a PostgreSQL commit that rolls back and invalidates the descriptor`, async t => {
        const beforeState = await snapshot()
        let completion
        const state = await intercept(t, { configure: transaction => { completion = abortTransactionBeforeCommit(transaction) } })
        let error
        try {
          try { await run(operation) } catch (caught) { error = caught }
          assert.equal(completion.command, 'ROLLBACK')
          assert.equal(completion.resolved, true)
          assert.equal(completion.commits, 1)
          assert.equal(completion.rollbacks, 0)
          assert.equal(state.transaction.isCompleted(), true)
        } finally {
          try { await completion.close() } finally { await state.close() }
        }
        assert.deepEqual(await snapshot(), beforeState)
        assert.ok(error instanceof Error, 'Registry writes must reject a confirmed rollback')
        assert.match(error.message, /rolled back instead of committed/i)
        assert.equal([...registry.cache.values()].some(value => value.tenant === tenant && value.resource === resourceFor(operation)), false)
        assert.equal(state.logs.length, 0)
        await assertUnchanged(operation, beforeState)
      })
    }

    for (const phase of ['commit', 'rollback']) {
      for (const afterExecution of [false, true]) {
        it(`driver completion for ${operation}: ${phase} failure ${afterExecution ? 'after execution' : 'from SQL'} is retained`, async t => {
          const beforeState = await snapshot()
          let completion
          const state = await intercept(t, { configure: transaction => { completion = interceptTransactionCompletion(transaction, fixture.knex, { phase, afterExecution }) } })
          let primary
          try {
            await assert.rejects(run(operation, undefined, phase === 'rollback'), error => {
              primary = error.cause
              if (phase === 'commit') assertWriteFailure(error, { cause: completion.error, outcome: 'unknown' })
              else assert.notEqual(error.cause, completion.error)
              return true
            })
            assert.equal(completion.calls, 1)
            assert.equal(completion.methodResolved, true)
            assert.equal(completion.executionError, completion.error)
            assert.equal(state.transaction.isCompleted(), true)
            assert.equal([...registry.cache.values()].some(value => value.tenant === tenant && value.resource === resourceFor(operation)), false)
            assert.equal(state.logs.length, phase === 'rollback' ? 1 : 0)
            if (phase === 'rollback') {
              assert.equal(state.logs[0][1].error.message, primary.message)
              assert.equal(state.logs[0][1].cleanupErrors[0].phase, 'rollback')
              assert.equal(state.logs[0][1].cleanupErrors[0].error.message, completion.error.message)
            }
          } finally {
            try { await completion.close() } finally { await state.close() }
          }
          if (phase === 'commit' && afterExecution) await assertStored(operation)
          else await assertUnchanged(operation, beforeState)
        })
      }
    }
  }

  it('isolates tenant/resource pairs containing the cache key delimiter', async () => {
    const firstKey = { tenant: `${tenant}::extra`, resource: 'items' }
    const secondKey = { tenant, resource: 'extra::items' }
    const first = await registry.registerResource({ ...firstKey, schema })
    const second = await registry.registerResource({ ...secondKey, schema: { ...schema, active: { type: 'boolean' } } })
    assert.deepEqual(await registry.getDescriptor(firstKey.tenant, firstKey.resource), first)
    assert.deepEqual(await registry.getDescriptor(secondKey.tenant, secondKey.resource), second)
    const updated = await registry.allocateField({ ...firstKey, fieldName: 'groupId', definition: extra })
    assert.deepEqual(await registry.getDescriptor(firstKey.tenant, firstKey.resource), updated)
    assert.deepEqual(await registry.getDescriptor(secondKey.tenant, secondKey.resource), second)
    registry.invalidateDescriptor(firstKey.tenant, firstKey.resource)
    assert.deepEqual(await registry.getDescriptor(firstKey.tenant, firstKey.resource), updated)
    assert.deepEqual(await registry.getDescriptor(secondKey.tenant, secondKey.resource), second)
  })

  for (const operation of operations) {
    for (const [label, primary] of [
      ['typed error', new RestApiValidationError('Registry write failed')],
      ['frozen error', Object.freeze(new Error('Registry write failed'))],
      ['null', null],
      ['undefined', undefined]
    ]) {
      for (const failRollback of [false, true]) {
        it(`${operation} preserves ${label} when commit rejects and rollback ${failRollback ? 'rejects' : 'succeeds'}`, async t => {
          const beforeState = await snapshot()
          const state = await intercept(t, { failCommit: () => { throw primary }, failRollback })
          try {
            await assert.rejects(run(operation), error => assertWriteFailure(error, { cause: primary, outcome: failRollback ? 'unknown' : 'rolledBack' }))
            assert.equal(state.acquisitions, 1)
            assert.equal(state.commits, 1)
            assert.equal(state.rollbacks, 1)
            assert.equal(state.transaction.isCompleted(), !failRollback)
            if (failRollback) {
              assert.equal(state.logs.length, 1)
              const context = state.logs[0][1]
              if (primary instanceof Error) assert.equal(context.error.message, primary.message)
              else assert.equal(context.error, primary)
              assert.equal(context.tenant, tenant)
              assert.equal(context.scopeName, resourceFor(operation))
              assert.equal(context.cleanupErrors.length, 1)
              assert.equal(context.cleanupErrors[0].phase, 'rollback')
              assert.equal(context.cleanupErrors[0].error.message, state.secondary.message)
            } else assert.equal(state.logs.length, 0)
          } finally { await state.close() }
          await assertUnchanged(operation, beforeState)
          await run(operation)
          await assertStored(operation)
        })
      }
    }

    for (const logging of ['throws', 'rejects']) {
      it(`${operation} preserves its error when rollback rejects and logging ${logging}`, async t => {
        const primary = Object.freeze(new Error('Registry write failed'))
        const loggerError = new Error('Registry logger failed')
        const beforeState = await snapshot()
        const state = await intercept(t, {
          failCommit: () => { throw primary },
          failRollback: true,
          failLog: () => { if (logging === 'throws') throw loggerError; return Promise.reject(loggerError) }
        })
        try {
          await assert.rejects(run(operation), error => assertWriteFailure(error, { cause: primary }))
          assert.equal(state.rollbacks, 1)
          assert.equal(state.logs.length, 1)
          assert.equal(state.logs[0][1].cleanupErrors.length, 1)
          assert.equal(state.logs[0][1].cleanupErrors[0].phase, 'rollback')
          assert.equal(state.logs[0][1].cleanupErrors[0].error.message, state.secondary.message)
        } finally { await state.close() }
        await assertUnchanged(operation, beforeState)
      })
    }

    for (const completion of ['commit', 'rollback']) {
      it(`${operation} skips a second rollback and reloads its cache after ${completion} completes but commit rejects`, async t => {
        const primary = new Error('Commit acknowledgement failed')
        const beforeState = await snapshot()
        const state = await intercept(t, { failCommit: async tx => { await tx[completion](); throw primary } })
        try {
          await assert.rejects(run(operation), error => assertWriteFailure(error, { cause: primary }))
          assert.equal(state.commits, 1)
          assert.equal(state.transaction.isCompleted(), true)
          assert.equal(state.logs.length, 0)
        } finally { await state.close() }
        if (completion === 'commit') await assertStored(operation)
        else await assertUnchanged(operation, beforeState)
        assert.equal(state.rollbacks, 0)
      })
    }

    it(`${operation} preserves a validation failure when rollback rejects`, async t => {
      const beforeState = await snapshot()
      const state = await intercept(t, { failRollback: true })
      try {
        await assert.rejects(run(operation, undefined, true), error => {
          assert.match(error.message, operation === 'allocate field' ? /already exists/ : /missing entry/)
          assert.notEqual(error, state.secondary)
          return true
        })
        assert.equal(state.commits, 0)
        assert.equal(state.rollbacks, 1)
        assert.equal(state.logs.length, 1)
      } finally { await state.close() }
      await assertUnchanged(operation, beforeState)
    })

    it(`${operation} leaves a failing participant pending until its owner rolls back and preserves the committed cache`, async t => {
      const beforeState = await snapshot()
      let state
      try {
        await assert.rejects(fixture.api.transaction(async transaction => {
          state = await intercept(t, { transaction })
          await assert.rejects(run(operation, { transaction: state.transaction }, true),
            error => {
              assertWriteFailure(error, { outcome: 'pending' })
              assert.match(error.message, operation === 'allocate field' ? /already exists/ : /missing entry/)
              return true
            })
          assert.equal(state.acquisitions, 0)
          assert.equal(state.commits, 0)
          assert.equal(state.rollbacks, 0)
          assert.equal(state.transaction.isCompleted(), false)
          assert.deepEqual(await registry.getDescriptor(tenant, 'items'), cached)
          assert.equal(state.logs.length, 0)
        }), error => {
          assertWriteFailure(error, { outcome: 'rolledBack' })
          assert.match(error.message, operation === 'allocate field' ? /already exists/ : /missing entry/)
          return true
        })
        assert.equal(state.commits, 0)
        assert.equal(state.rollbacks, 1)
        assert.equal(state.transaction.isCompleted(), true)
      } finally { await state?.close() }
      await assertUnchanged(operation, beforeState)
    })

    for (const completion of ['commit', 'rollback']) {
      it(`${operation} keeps successful managed metadata private until the owner ${completion}s`, async t => {
        const beforeState = await snapshot()
        let state
        try {
          const pending = fixture.api.transaction(async transaction => {
            state = await intercept(t, { transaction })
            const local = await run(operation, { transaction: state.transaction })
            assert.equal(local.schema.groupId.belongsTo, 'groups')
            assert.deepEqual(await descriptor(operation, { transaction: state.transaction }), local)
            assert.deepEqual(await registry.getDescriptor(tenant, 'items'), cached)
            assert.equal(registry.cache.size, 2)
            assert.equal(state.acquisitions, 0)
            assert.equal(state.commits, 0)
            assert.equal(state.rollbacks, 0)
            assert.equal(state.transaction.isCompleted(), false)
            if (completion === 'rollback') throw rollbackRequested
          })
          if (completion === 'rollback') await assert.rejects(pending, error => assertWriteFailure(error, { cause: rollbackRequested, outcome: 'rolledBack' }))
          else await pending
          assert.equal(state.commits, completion === 'commit' ? 1 : 0)
          assert.equal(state.rollbacks, completion === 'rollback' ? 1 : 0)
          assert.equal(state.transaction.isCompleted(), true)
        } finally { await state?.close() }
        registry.invalidateDescriptor(tenant, resourceFor(operation))
        if (completion === 'commit') await assertStored(operation)
        else await assertUnchanged(operation, beforeState)
      })
    }
  }
})
