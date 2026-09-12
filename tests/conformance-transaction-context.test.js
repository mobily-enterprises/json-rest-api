import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'

const writeMethods = ['post', 'put', 'patch', 'delete', 'postRelationship', 'patchRelationship', 'deleteRelationship']

describe(`Reused write context transaction ownership (${storageMode.mode})`, () => {
  let fixture, group, item, other, failMethod
  const rollbacks = []
  const started = []
  before(async () => {
    fixture = await createConformanceFixture()
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'observe-context-participation',
          handler: ({ context, scopeName }) => {
            if (failMethod && writeMethods.includes(context.method)) started.push({ method: context.method, scopeName })
          }
        },
        finish: {
          functionName: 'fail-before-commit',
          handler: ({ context }) => {
            if (context.method === failMethod) throw new Error('Failure before commit')
          }
        },
        afterRollback: {
          functionName: 'observe-context-rollback',
          handler: ({ context }) => {
            rollbacks.push({ method: context.method, scopeName: context.scopeName, completed: context.transaction.isCompleted() })
          }
        }
      }
    })
  })
  beforeEach(async () => {
    failMethod = undefined
    rollbacks.length = 0
    started.length = 0
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' }, { group: { data: { type: group.type, id: group.id } } })
    other = await fixture.seed('items', { name: 'Other' })
  })
  after(async () => { await fixture?.close() })

  it('validates PUT omissions against this request after an earlier complete payload', async () => {
    const context = {}
    await fixture.api.resources.items.patch({ id: item.id, format: 'plain', returning: 'none', data: { name: 'Original', active: false, score: 7 } }, context)
    await assert.rejects(fixture.api.resources.items.put({ id: item.id, format: 'plain', data: { name: 'Incomplete', group: group.id } }, context), error => {
      assert.equal(error.code, 'REST_API_VALIDATION')
      assert.deepEqual(error.details.fields, ['data.attributes.active', 'data.attributes.score'])
      return true
    })
    const stored = await fixture.api.resources.items.get({ id: item.id, format: 'plain' })
    assert.equal(stored.name, 'Original')
    assert.equal(stored.active, false)
    assert.equal(stored.score, 7)
  })

  it('does not require a previous record\'s populated fields during PUT-create', async () => {
    const context = {}
    await fixture.api.resources.items.patch({ id: item.id, format: 'plain', returning: 'none', data: { name: 'Original' } }, context)
    const created = await fixture.api.resources.items.put({ id: '99', format: 'plain', data: { name: 'New' } }, context)
    assert.equal(created.id, '99')
    assert.equal(created.name, 'New')
    assert.equal(created.active, true)
    assert.equal(created.score, 0)
    assert.equal(created.group, undefined)
    assert.equal(await fixture.count('items'), 3)
  })

  for (const method of writeMethods) {
    for (const managed of [false, true]) {
      it(`${method} ${managed ? 'defers rollback to the helper' : 'rolls back its transaction'} after a previous committed call`, async () => {
        const context = {}
        await fixture.api.resources.items.patch({ id: item.id, format: 'plain', returning: 'none', data: { name: 'Original' } }, context)
        assert.equal(context.transactionCommitted, true)
        const previous = context.transaction
        const related = method.endsWith('Relationship')
        const params = related
          ? { id: group.id, relationshipName: 'items', relationshipData: [{ type: item.type, id: method === 'deleteRelationship' ? item.id : other.id }] }
          : { id: method === 'post' ? undefined : item.id, format: 'plain', returning: 'none', data: { name: 'Changed', ...(method === 'post' ? { id: '99' } : {}), ...(method === 'put' ? { active: true, score: 0, group: group.id } : {}) } }
        failMethod = method
        try {
          const checkFailure = async transaction => {
            await assert.rejects(fixture.api.resources[related ? 'groups' : 'items'][method]({ ...params, transaction }, context), /Failure before commit/)
            if (managed) {
              assert.equal(context.transaction, transaction)
              assert.equal(transaction.isCompleted(), false)
              assert.deepEqual(rollbacks, [])
            }
          }
          if (managed) await assert.rejects(fixture.api.transaction(checkFailure), /Failure before commit/)
          else await checkFailure()
          assert.equal(context.transactionCommitted, false)
          assert.equal(previous.isCompleted(), true)
          assert.notEqual(context.transaction, previous)
          assert.equal(context.transaction.isCompleted(), true)
          assert.equal(context.transactionOutcome, 'rolledBack')
          assert.equal(started[0].method, method)
          assert.deepEqual(rollbacks, [...started].reverse().map(operation => ({ ...operation, completed: true })))
        } finally {
          // Also release a leaked transaction when this regression fails.
          if (context.transaction && !context.transaction.isCompleted()) await context.transaction.rollback()
        }
        assert.equal(await fixture.count('items'), 2)
        const rows = (await fixture.api.resources.items.query({ format: 'plain' })).data
        assert.equal(rows.find(row => row.id === item.id).name, 'Original')
        assert.equal(rows.find(row => row.id === item.id).group.id, group.id)
        assert.equal(rows.find(row => row.id === other.id).group, undefined)
      })
    }
  }
})
