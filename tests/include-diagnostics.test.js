import { it } from 'node:test'
import assert from 'node:assert/strict'
import { loadHasOne } from '../plugins/core/lib/querying/include-to-one.js'

it('uses a supplied include logger without requiring a child factory', async t => {
  const events = []
  const globalTrace = t.mock.method(console, 'trace', () => {})
  await loadHasOne({ records: [], scopeName: 'items' }, { context: { log: { trace: message => events.push(message) } } })
  assert.deepEqual(events, ['[INCLUDE] No records to load hasOne for'])
  assert.equal(globalTrace.mock.callCount(), 0)
})

it('keeps an empty include quiet without a configured logger', async t => {
  const globalTrace = t.mock.method(console, 'trace', () => {})
  await loadHasOne({ records: [], scopeName: 'items' }, { context: {} })
  assert.equal(globalTrace.mock.callCount(), 0)
})
