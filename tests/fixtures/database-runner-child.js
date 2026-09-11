import { it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createConformanceFixture } from './conformance.js'
import { createTestDatabase, databaseClient } from '../helpers/test-database.js'

it('exercises runner cleanup with a live fixture', async () => {
  const fixture = await createConformanceFixture()
  try {
    await fixture.seed('groups', { name: 'Runner cleanup' })
    console.log('DATABASE_RUNNER_CHILD_READY')
    if (process.env.JSON_REST_API_RUNNER_CASE === 'wait') await delay(60000)
    if (process.env.JSON_REST_API_RUNNER_CASE === 'wrong-driver') {
      const wrong = await createTestDatabase({ client: databaseClient === 'better-sqlite3' ? 'pg' : 'better-sqlite3' })
      await wrong.close()
      throw new Error('A fixture silently selected the wrong driver')
    }
    throw new Error('Injected database runner failure')
  } finally { await fixture.close() }
})
