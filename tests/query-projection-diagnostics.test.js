import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { QueryProjectionsPlugin } from '../plugins/core/rest-api-query-projections-plugin.js'

function installWarning (log) {
  const hooks = new Map()
  QueryProjectionsPlugin.install({ log, addHook: (name, label, options, handler) => hooks.set(name, handler) })
  return hooks.get('beforeSchemaValidate')
}

function request (names) {
  const attributes = Object.fromEntries([['name', 'Retained'], ...names.map(name => [name, 'PRIVATE_INPUT_VALUE'])])
  return {
    scopeName: 'items',
    context: { method: 'post', inputRecord: { data: { type: 'items', attributes } } },
    scope: { vars: { schemaInfo: { queryFields: Object.fromEntries(names.map(name => [name, {}])) } } }
  }
}

describe('Projection input diagnostics', () => {
  it('bounds field metadata while retaining operation, resource and total count', async () => {
    const events = []
    const strip = installWarning({ warn: (...args) => events.push(args) })
    const names = Array.from({ length: 200 }, (_, index) => `projection_${index}_${'x'.repeat(1000)}`)
    const input = request(names)
    await strip(input)
    assert.deepEqual(input.context.inputRecord.data.attributes, { name: 'Retained' })
    assert.equal(events.length, 1)
    const serialized = JSON.stringify(events)
    assert.ok(serialized.length < 20000)
    assert.ok(!serialized.includes('PRIVATE_INPUT_VALUE'))
    const details = events[0][1]
    assert.equal(details.operation, 'post')
    assert.equal(details.scopeName, 'items')
    assert.equal(details.phase, 'beforeSchemaValidate')
    assert.equal(details.fieldCount, 200)
  })

  it('does not replace successful input stripping with a logging failure', async () => {
    const strip = installWarning({ warn: () => { throw new Error('Logging unavailable') } })
    const input = request(['fullName'])
    await assert.doesNotReject(() => strip(input))
    assert.deepEqual(input.context.inputRecord.data.attributes, { name: 'Retained' })
  })

  it('awaits and contains an asynchronously rejected diagnostic', async () => {
    let attempted = false
    const strip = installWarning({
      warn: async () => {
        await new Promise(resolve => setImmediate(resolve))
        attempted = true
        throw new Error('Asynchronous logging unavailable')
      }
    })
    const input = request(['fullName'])
    await assert.doesNotReject(() => strip(input))
    assert.equal(attempted, true)
    assert.deepEqual(input.context.inputRecord.data.attributes, { name: 'Retained' })
  })

  it('does not fall back to global console output when no logger was supplied', async t => {
    const warnings = t.mock.method(console, 'warn', () => {})
    const strip = installWarning(undefined)
    const input = request(['fullName'])
    await strip(input)
    assert.deepEqual(input.context.inputRecord.data.attributes, { name: 'Retained' })
    assert.equal(warnings.mock.callCount(), 0)
  })
})
