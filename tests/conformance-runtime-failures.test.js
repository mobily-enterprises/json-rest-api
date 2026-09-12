import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
let fixture, probe
before(async () => {
  fixture = await createConformanceFixture({ createApi: createIdConformanceApi })
  await fixture.api.customize({
    hooks: Object.fromEntries(['beforeProcessing', 'finish', 'afterCommit'].map(phase => [phase, {
      functionName: `fail-${phase}`, handler: () => { if (probe?.phase === phase) throw probe.value }
    }]))
  })
})
beforeEach(async () => { probe = undefined; await fixture.reset() })
after(async () => { await fixture?.close() })
for (const phase of ['beforeProcessing', 'finish', 'afterCommit']) {
  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['unreadable error metadata', new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('Metadata inspection failed') } })],
    ['unreadable error prototype', new Proxy({}, { getPrototypeOf: () => { throw new Error('Prototype inspection failed') } })]
  ]) {
    for (const failLogging of [false, true]) {
      test(`${phase} retains ${label} with ${failLogging ? 'failed' : 'successful'} logging`, async t => {
        probe = { phase, value }
        const context = {}
        const loggingError = new Error('Diagnostic logger failed')
        if (failLogging) t.mock.method(fixture.api.log, 'error', () => { throw loggingError })
        await assert.rejects(fixture.api.resources.items.post({ document: { data: { type: 'items', id: '1', attributes: { name: 'Item' } } } }, context), error => {
          assert.equal(error.transactionOutcome, phase === 'afterCommit' ? 'committed' : 'rolledBack')
          let cause = error
          while (cause !== value && cause && typeof cause === 'object' && Object.hasOwn(cause, 'cause')) cause = cause.cause
          assert.equal(cause, value)
          return true
        })
        assert.equal(await fixture.count('items'), phase === 'afterCommit' ? 1 : 0)
        if (failLogging) {
          assert.ok(context.cleanupErrors.length >= 1)
          assert.ok(context.cleanupErrors.every(entry => entry.phase === 'logging' && entry.error === loggingError))
        }
      })
    }
  }
}
