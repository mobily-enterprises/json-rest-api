import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

describe(`Post-write refresh failures (${storageMode.mode})`, () => {
  let fixture, group, other, item, failure, completions
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: { inverseMembership: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    const read = fixture.api.helpers.dataGetMinimal
    await fixture.api.customize({
      helpers: {
        dataGetMinimal: async args => {
          if (failure && args.scopeName === 'items' && args.context.afterRefreshTestWrite && ['post', 'put', 'patch'].includes(args.context.method)) {
            failure.calls++
            throw failure.error
          }
          return read(args)
        }
      },
      hooks: {
        afterDataCall: {
          functionName: 'mark-write-before-refresh-failure',
          handler: ({ context }) => { if (['post', 'put', 'patch'].includes(context.method)) context.afterRefreshTestWrite = true }
        },
        finish: {
          functionName: 'observe-finish-after-refresh',
          handler: ({ context }) => { if (failure && context.scopeName === 'items' && context.method !== 'get') completions.push('finish') }
        },
        afterCommit: {
          functionName: 'observe-commit-after-refresh',
          handler: ({ context }) => { if (failure && context.scopeName === 'items') completions.push('commit') }
        }
      }
    })
  })
  beforeEach(async () => {
    failure = undefined
    completions = []
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Original group' })
    other = await fixture.seed('groups', { name: 'Replacement group' })
    item = await fixture.seed('items', { name: 'Original' }, { groups: { data: [{ type: 'groups', id: group.id }] } })
  })
  after(async () => { await fixture?.close() })
  const snapshot = async () => {
    const tables = fixture.storage === 'anyapi' ? ['any_records', 'any_links'] : ['conformance_items', 'conformance_memberships']
    const result = {}
    for (const table of tables) result[table] = await fixture.knex(table).orderBy(table === 'conformance_items' ? 'items_key' : 'id')
    return result
  }

  for (const operation of [{ method: 'post', creates: true }, { method: 'put', creates: true }, { method: 'put' }, { method: 'patch' }]) {
    for (const format of ['jsonapi', 'plain']) {
      for (const returning of ['full', 'minimal', 'none']) {
        for (const borrowed of [false, true]) {
          it(`${operation.method} ${operation.creates ? 'create' : 'update'} ${format}/${returning} aborts refresh failure (${borrowed ? 'borrowed' : 'owned'})`, async () => {
            const original = returning === 'none'
              ? new RestApiValidationError('Refresh denied')
              : returning === 'minimal' ? (borrowed ? undefined : null) : Object.freeze(new Error('Refresh failed'))
            const id = operation.creates ? '99' : item.id
            const attributes = { name: 'Changed', ...(operation.method === 'put' ? { active: true, score: 0 } : {}) }
            const inputRecord = format === 'plain'
              ? { id, ...attributes, groups: [other.id] }
              : { data: { type: 'items', id, attributes, relationships: { groups: { data: [{ type: 'groups', id: other.id }] } } } }
            const beforeState = await snapshot()
            const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
            const transaction = unit?.transaction
            const context = {}
            failure = { error: original, calls: 0 }
            const write = transaction => fixture.api.resources.items[operation.method]({ id, [format === 'plain' ? 'data' : 'document']: inputRecord, format, returning, transaction }, context)
            try {
              await assert.rejects(write(transaction), error => {
                assertWriteFailure(error, { outcome: borrowed ? 'pending' : 'rolledBack' })
                if (returning === 'none') assert.equal(error.cause, original)
                else {
                  assert.equal(error.cause.cause, original)
                  assert.deepEqual(error.cause.context, { scopeName: 'items', phase: 'postWriteRead' })
                }
                return true
              })
              assert.equal(failure.calls, 1)
              assert.equal(context.afterRefreshTestWrite, true)
              assert.equal(context.transactionCommitted, false)
              assert.equal(context.transaction.isCompleted(), !borrowed)
              assert.deepEqual(completions, [])
              if (borrowed) {
                assert.equal(context.transaction, transaction)
                failure = undefined
                const local = await fixture.api.resources.items.get({ id, transaction, format: 'jsonapi', queryParams: { include: ['groups'] } })
                assert.equal(local.data.attributes.name, 'Changed')
                assert.deepEqual(local.data.relationships.groups.data, [{ type: 'groups', id: other.id }])
              }
            } finally {
              failure = undefined
              await unit?.rollback()
            }
            assert.deepEqual(await snapshot(), beforeState)
            await write()
            const stored = await fixture.api.resources.items.get({ id, format: 'jsonapi', queryParams: { include: ['groups'] } })
            assert.equal(stored.data.attributes.name, 'Changed')
            assert.deepEqual(stored.data.relationships.groups.data, [{ type: 'groups', id: other.id }])
          })
        }
      }
    }
  }
})
