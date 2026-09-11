import * as fc from 'fast-check'

export const itemValues = fc.record({
  name: fc.array(fc.constantFrom('a', 'b', 'Z', ':', ',', '~'), { minLength: 1, maxLength: 12 }).map(chars => chars.join('')),
  note: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  rank: fc.option(fc.integer({ min: -2, max: 2 }), { nil: null }),
  active: fc.boolean(),
  score: fc.integer({ min: -10, max: 10 })
})

export function generatedCaseOptions (defaultSeed, numRuns = 40) {
  const seed = process.env.FC_SEED === undefined ? defaultSeed : Number(process.env.FC_SEED)
  const runs = process.env.FC_RUNS === undefined ? numRuns : Number(process.env.FC_RUNS)
  if (!Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647) {
    throw new Error('FC_SEED must be a signed 32-bit integer')
  }
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('FC_RUNS must be a positive integer')
  return { seed, numRuns: runs, verbose: true, includeErrorInReport: true, ...(process.env.FC_PATH ? { path: process.env.FC_PATH } : {}) }
}
