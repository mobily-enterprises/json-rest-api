import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
if (process.env.PATCHED_HOOKED_API) {
  const directory = process.env.PATCHED_HOOKED_API
  registerHooks({ resolve (specifier, context, next) {
    return specifier === 'hooked-api' ? { url: pathToFileURL(`${directory}/index.js`).href, shortCircuit: true } : next(specifier, context)
  } })
}
const { createConformanceFixture } = await import('../../../tests/fixtures/conformance.js')
const { createIdConformanceApi } = await import('../../../tests/fixtures/api-configs.js')
let fixture, probe
before(async () => {
  fixture = await createConformanceFixture({ createApi: createIdConformanceApi })
  await fixture.api.customize({ hooks: Object.fromEntries(['beforeProcessing', 'finish', 'afterCommit'].map(phase => [phase, {
    functionName: `fail-${phase}`, handler: () => { if (probe?.phase === phase) throw probe.value }
  }])) })
})
beforeEach(async () => { probe = undefined; await fixture.reset() })
after(async () => { await fixture?.close() })
for (const phase of ['beforeProcessing', 'finish', 'afterCommit']) {
  for (const value of [null, undefined]) {
    for (const failLogging of [false, true]) {
      test(`${phase} retains ${String(value)} with ${failLogging ? 'failed' : 'successful'} logging`, async t => {
        probe = { phase, value }
        const context = {}
        const loggingError = new Error('Diagnostic logger failed')
        if (failLogging) t.mock.method(console, 'error', () => { throw loggingError })
        await assert.rejects(fixture.api.resources.items.post({ inputRecord: { data: { type: 'items', id: '1', attributes: { name: 'Item' } } } }, context), error => {
          assert.equal(error.transactionOutcome, phase === 'afterCommit' ? 'committed' : 'rolledBack')
          let cause = error
          while (cause && typeof cause === 'object' && Object.hasOwn(cause, 'cause')) cause = cause.cause
          assert.equal(cause, value)
          return true
        })
        assert.equal(await fixture.count('items'), phase === 'afterCommit' ? 1 : 0)
        if (failLogging) {
          assert.ok(context.cleanupErrors.length >= 2)
          assert.ok(context.cleanupErrors.every(entry => entry.phase === 'logging' && entry.error === loggingError))
        }
      })
    }
  }
}
