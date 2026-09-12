import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createEnhancedLogger } from '../lib/enhanced-logger.js'

const iterations = 5000
const samples = 5
const secret = 'diagnostic-measurement-secret'
const schemaInfo = { outputFields: { password: { hidden: true }, token: { normallyHidden: true } } }
const error = Object.assign(new Error('Write failed', { cause: new Error('Storage rejected the write') }), {
  details: { password: secret, nested: { token: secret }, file: Buffer.alloc(4096), values: Array(1000).fill('x'.repeat(4096)) }
})
const metadata = { method: 'patch', scopeName: 'books', phase: 'operation', backend: 'pg', transactionOutcome: 'rolledBack' }
const noop = () => {}
const boundedNoop = createEnhancedLogger({ trace: noop, error: noop }, { schemaInfo })
let encoded = ''
const boundedSink = createEnhancedLogger({ error: (...args) => { encoded = JSON.stringify(args) } }, { schemaInfo })
boundedSink.logError('Small preview', Object.assign(new Error('Write failed'), {
  details: { password: secret, token: secret, visible: 'Retained marker' }
}), metadata)
const preview = JSON.parse(encoded)[1].error.details
assert.equal(preview.password, '[Redacted]')
assert.equal(preview.token, '[Redacted]')
assert.equal(preview.visible, 'Retained marker')
boundedSink.logError('Operation failed', error, metadata)
assert.equal(encoded.includes(secret), false)
assert.ok(encoded.length < 40000, 'The measured error must remain bounded')

const cases = [
  ['direct no-op trace', () => noop('Reading record', metadata)],
  ['bounded trace with no-op writer', () => boundedNoop.trace('Reading record', metadata)],
  ['bounded nested error with no-op writer', () => boundedNoop.logError('Operation failed', error, metadata)],
  ['bounded nested error with JSON sink', () => boundedSink.logError('Operation failed', error, metadata)]
]
const results = new Map(cases.map(([name]) => [name, []]))
for (const [, run] of cases) for (let i = 0; i < 500; i++) run()
for (let sample = 0; sample < samples; sample++) {
  // Alternate order to reduce the effect of warm-up and competing local work.
  for (const [name, run] of sample % 2 ? [...cases].reverse() : cases) {
    const start = performance.now()
    for (let i = 0; i < iterations; i++) run()
    results.get(name).push((performance.now() - start) * 1000 / iterations)
  }
}

console.log(JSON.stringify({
  node: process.version,
  iterationsPerSample: iterations,
  samples,
  errorEventBytes: Buffer.byteLength(encoded),
  microsecondsPerCall: Object.fromEntries([...results].map(([name, timings]) => {
    timings.sort((a, b) => a - b)
    return [name, { min: timings[0], median: timings[Math.floor(samples / 2)], max: timings.at(-1) }]
  }))
}, null, 2))
