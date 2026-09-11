import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError, RestApiWriteError } from '../lib/rest-api-errors.js'
import { withWriteOutcome, wrapUnexpectedError, wrapWriteError } from '../lib/error-context.js'
import { mapRestApiErrorToHttp } from '../plugins/core/connectors/lib/transport-http-helpers.js'

describe('Unexpected error context', () => {
  const typed = new RestApiValidationError('Invalid included value')
  it('retains a typed API error by identity', () => {
    assert.equal(wrapUnexpectedError(typed, { message: 'Include failed' }), typed)
  })

  it('reads an accessor message once when retaining an unexpected cause', () => {
    let reads = 0
    const cause = {
      get message () {
        if (++reads > 1) throw new Error('Message read twice')
        return 'Original failure'
      }
    }
    const wrapped = wrapUnexpectedError(cause, { message: 'Write failed' })
    assert.equal(wrapped.message, 'Write failed: Original failure')
    assert.equal(wrapped.cause, cause)
    assert.equal(reads, 1)
  })

  for (const [label, original, detail] of [
    ['frozen error', Object.freeze(new Error('Primary')), 'Primary'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['string', 'Primary', 'Primary'],
    ['zero', 0, '0'],
    ['false', false, 'false'],
    ['symbol', Symbol('Primary'), 'Symbol(Primary)'],
    ['object', { reason: 'Primary' }, '[object Object]'],
    ['unprintable object', Object.create(null), 'Non-Error value thrown']
  ]) {
    it(`retains the cause and context for ${label}`, () => {
      const context = { resource: 'groups', relationship: 'items' }
      const wrapped = wrapUnexpectedError(original, { message: 'Include failed', context })
      assert.equal(wrapped.cause, original)
      assert.ok(Object.hasOwn(wrapped, 'cause'))
      assert.equal(wrapped.context, context)
      assert.equal(wrapped.message, `Include failed: ${detail}`)
    })
  }
})

describe('Write error snapshots', () => {
  for (const cause of [Object.freeze(new Error('Frozen')), null, undefined, false, 0, 'failure', Symbol('failure'), Object.create(null)]) {
    it(`preserves ${typeof cause} failures without modifying them`, async () => {
      const context = { transactionOutcome: 'committed', transaction: {}, transactionCommitted: true }
      const write = withWriteOutcome(async () => { throw cause })
      await assert.rejects(write({ context }), error => {
        assert.ok(error instanceof RestApiWriteError)
        assert.equal(error.cause, cause)
        assert.equal(error.transactionOutcome, 'none')
        assert.equal(context.error, cause)
        assert.equal(context.transaction, undefined)
        assert.equal(context.transactionCommitted, false)
        return true
      })
    })
  }

  it('preserves typed fields and independent immutable outcomes when a frozen error is reused', () => {
    const cause = Object.freeze(new RestApiValidationError('Invalid name', { fields: ['name'] }))
    const pending = wrapWriteError(cause, { transaction: { isCompleted: () => false } })
    const committed = wrapWriteError(cause, { transactionOutcome: 'committed' })
    assert.notEqual(pending, committed)
    for (const error of [pending, committed]) {
      assert.equal(error.cause, cause)
      assert.equal(error.code, cause.code)
      assert.equal(error.type, cause.type)
      assert.equal(error.details, cause.details)
      assert.throws(() => { error.transactionOutcome = 'rolledBack' }, TypeError)
      assert.equal(Object.hasOwn(error.toJSON(), 'cause'), false)
      assert.equal(Object.hasOwn(error.toJSON(), 'transaction'), false)
    }
    assert.equal(pending.transactionOutcome, 'pending')
    assert.equal(committed.transactionOutcome, 'committed')
    assert.equal(Object.hasOwn(cause, 'transactionOutcome'), false)
  })

  it('does not invoke a throwing diagnostic getter while retaining the failure', () => {
    let calls = 0
    const cause = Object.defineProperty(new Error('Primary'), 'code', { get () { calls++; throw new Error('Secondary') } })
    const error = wrapWriteError(cause, {})
    assert.equal(error.cause, cause)
    assert.equal(error.code, 'REST_API_WRITE')
    assert.equal(error.message, 'Primary')
    assert.equal(calls, 0)
  })

  it('preserves inherited HTTP status data without cloning the original error class', () => {
    const cause = Object.assign(Object.create({ status: 413, statusCode: 413 }), { message: 'Too large' })
    const error = wrapWriteError(cause, {})
    assert.equal(error.status, 413)
    assert.equal(error.statusCode, 413)
    assert.equal(mapRestApiErrorToHttp(error).status, 413)
    assert.equal(error.cause, cause)
  })

  it('retains separate child and owner outcomes without rewriting the child error', () => {
    const cause = new RestApiValidationError('Child failed')
    const child = wrapWriteError(cause, { transaction: { isCompleted: () => false } })
    const owner = wrapWriteError(child, { transactionOutcome: 'rolledBack' })
    assert.equal(owner.cause, child)
    assert.equal(child.cause, cause)
    assert.equal(owner.transactionOutcome, 'rolledBack')
    assert.equal(child.transactionOutcome, 'pending')
  })

  for (const transactionOutcome of ['none', 'pending', 'committed', 'rolledBack', 'unknown']) {
    it(`maps ${transactionOutcome} to each HTTP error without changing classification or exposing its cause`, () => {
      const cause = new RestApiValidationError('Invalid fields', {
        violations: [
          { field: 'name', message: 'Name required' }, { field: 'score', message: 'Score invalid' }
        ]
      })
      const error = wrapWriteError(cause, { transactionOutcome, transaction: { secret: 'internal' } })
      const response = mapRestApiErrorToHttp(error)
      assert.equal(response.status, 422)
      assert.deepEqual(response.body.errors.map(item => item.meta), [{ transactionOutcome }, { transactionOutcome }])
      assert.deepEqual(response.body.errors.map(item => item.source.pointer), ['name', 'score'])
      assert.equal(JSON.stringify(response).includes('internal'), false)
      assert.equal(JSON.stringify(response).includes('cause'), false)
    })
  }
})
