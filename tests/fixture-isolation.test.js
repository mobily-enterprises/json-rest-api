import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createFixtureIsolationApis, seedFixtureIsolationApis } from './fixtures/api-configs.js'
import { cleanTables, countRecords } from './helpers/test-utils.js'

const sharedDb = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
const separateDb = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })

describe('Fixture isolation between API instances and database connections', () => {
  let fixtures
  before(async () => { fixtures = await createFixtureIsolationApis(sharedDb, separateDb) })
  after(async () => { await Promise.all([sharedDb.destroy(), separateDb.destroy()]) })
  beforeEach(async () => {
    await cleanTables(sharedDb, ['isolation_left_countries', 'isolation_right_countries'])
    await cleanTables(separateDb, ['isolation_left_countries'])
    await seedFixtureIsolationApis(fixtures)
  })

  const names = async api => (await api.resources.countries.query({ format: 'jsonapi' })).data.map(record => record.attributes.name)

  it('preserves existing tenant data when another API is initialized', () => {
    assert.deepEqual(fixtures.afterSetup.data.map(record => record.attributes.name), ['Before another API'])
  })

  it('cleans one tenant without changing other tenants or databases', async () => {
    await cleanTables(sharedDb, ['isolation_left_countries'])
    assert.deepEqual(await names(fixtures.first), [])
    assert.deepEqual(await names(fixtures.second), ['Second'])
    assert.deepEqual(await names(fixtures.third), ['Third'])
  })

  it('counts matching table names using their own database and tenant', async () => {
    assert.equal(await countRecords(sharedDb, 'isolation_left_countries'), 1)
    assert.equal(await countRecords(sharedDb, 'isolation_right_countries'), 1)
    assert.equal(await countRecords(separateDb, 'isolation_left_countries'), 1)
  })

  it('reports missing fixture tables instead of silently passing cleanup or counts', async () => {
    await assert.rejects(cleanTables(sharedDb, ['missing_fixture_table']), /missing_fixture_table/)
    await assert.rejects(countRecords(sharedDb, 'missing_fixture_table'), /missing_fixture_table/)
  })
})
