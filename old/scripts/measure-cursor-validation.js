import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createSchema } from 'json-rest-schema'
import { validateCursorValues } from '../plugins/core/lib/querying/query-field-sort-helpers.js'

const iterations = 10000
const descriptors = [
  { field: 'rank', definition: { type: 'number' } },
  { field: 'name', definition: { type: 'string' } },
  { field: 'at', definition: { type: 'dateTime', temporalPrecision: 6 } },
  { field: 'id', definition: { type: 'id' } }
]
const input = { rank: '12.5', name: '  Key  ', at: '2024-02-29T12:34:56.123456Z', id: 'opaque:id' }
const expected = { ...input, rank: 12.5 }
const owner = createSchema({})
const validate = () => validateCursorValues(descriptors, input, 'after', owner)
for (let index = 0; index < 1000; index++) validate()
const rounds = []
for (let round = 0; round < 5; round++) {
  const started = performance.now()
  let result
  for (let index = 0; index < iterations; index++) result = validate()
  rounds.push(Number((performance.now() - started).toFixed(3)))
  assert.deepEqual({ ...result }, expected)
}
console.log(JSON.stringify({ node: process.version, iterations, fieldsPerCursor: descriptors.length, roundsMs: rounds, medianMs: [...rounds].sort((a, b) => a - b)[2] }, null, 2))
