import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { transformJsonApiToSimplified } from '../plugins/core/lib/querying-writing/simplified-helpers.js'

const measurements = []
for (const size of [1000, 5000, 10000]) {
  const included = Array.from({ length: size }, (_, index) => ({ type: 'items', id: String(index + 1), attributes: { name: `Item ${index + 1}` } }))
  const record = { data: { type: 'groups', id: '1', relationships: { items: { data: included.map(({ type, id }) => ({ type, id })) } } }, included }
  const run = () => transformJsonApiToSimplified({ record }, { context: {} })
  run()
  const roundsMs = []
  for (let round = 0; round < 5; round++) {
    const start = performance.now()
    const result = run()
    roundsMs.push(Number((performance.now() - start).toFixed(3)))
    assert.deepEqual(result.items, included.map(({ id, attributes }) => ({ id, ...attributes })))
  }
  measurements.push({ size, roundsMs, medianMs: [...roundsMs].sort((a, b) => a - b)[2] })
}
console.log(JSON.stringify({ node: process.version, measurements }, null, 2))
