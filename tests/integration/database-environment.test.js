import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from '../fixtures/conformance.js'
import { createConformanceApi } from '../fixtures/api-configs.js'
import { createTestDatabase, databaseClient } from '../helpers/test-database.js'
import { storageMode } from '../helpers/storage-mode.js'
import { ensureAnyApiSchema } from '../../plugins/core/lib/anyapi/schema-utils.js'
import { hasKnexTableIndex } from '../../plugins/core/lib/dbIntrospection.js'

describe(`Disposable database (${databaseClient}, ${storageMode.mode})`, () => {
  let observer
  before(async () => { observer = await createTestDatabase() })
  after(async () => { await observer?.close() })

  const databaseNames = async () => {
    if (databaseClient === 'better-sqlite3') return []
    const knex = observer.knex
    const rows = databaseClient === 'pg'
      ? await knex('pg_database').select('datname as name').where('datname', 'like', `jra_test_${process.pid}_%`)
      : await knex('information_schema.schemata').select('SCHEMA_NAME as name').where('SCHEMA_NAME', 'like', `jra_test_${process.pid}_%`)
    return rows.map(row => row.name).sort()
  }

  it('uses the requested real driver and executes a server query', async () => {
    assert.equal(observer.knex.client.config.client, databaseClient)
    const sql = databaseClient === 'better-sqlite3' ? 'sqlite_version()' : 'version()'
    const row = await observer.knex.first(observer.knex.raw(`${sql} as version`))
    assert.equal(typeof row.version, 'string')
    if (databaseClient === 'pg') assert.match(row.version, /PostgreSQL/)
    if (databaseClient === 'mysql2') assert.doesNotMatch(row.version, /MariaDB/)
  })

  it('isolates identical resource names, resets, and teardown between fixtures', async () => {
    const baseline = await databaseNames()
    const left = await createConformanceFixture()
    let right
    try {
      right = await createConformanceFixture()
      if (databaseClient !== 'better-sqlite3') assert.notEqual(left.databaseName, right.databaseName)
      await left.seed('groups', { name: 'Left' })
      await right.seed('groups', { name: 'Right' })
      assert.deepEqual((await left.api.resources.groups.query()).data.map(row => row.attributes.name), ['Left'])
      await left.reset()
      await left.close()
      assert.deepEqual((await right.api.resources.groups.query()).data.map(row => row.attributes.name), ['Right'])
      assert.equal(right.storage, storageMode.mode)
    } finally {
      try { await left.close() } finally { await right?.close() }
    }
    assert.deepEqual(await databaseNames(), baseline)
  })

  it('drops its database when API initialization fails after creating tables', async () => {
    const baseline = await databaseNames()
    const failure = new Error('Injected API initialization failure')
    await assert.rejects(createConformanceFixture({
      createApi: async (knex, options) => {
        await createConformanceApi(knex, options)
        throw failure
      }
    }), error => error === failure)
    assert.deepEqual(await databaseNames(), baseline)
  })

  it('reuses and restores the canonical unique index without aborting a borrowed transaction', async () => {
    const database = await createTestDatabase()
    const index = 'any_records_tenant_resource_logical_id_unique'
    const columns = ['tenant_id', 'resource', 'logical_id']
    try {
      await ensureAnyApiSchema(database.knex)
      assert.equal(await hasKnexTableIndex(database.knex, 'any_records', index), true)
      await database.knex.schema.table('any_records', table => table.dropUnique(columns, index))
      assert.equal(await hasKnexTableIndex(database.knex, 'any_records', index), false)
      await ensureAnyApiSchema(database.knex)
      await database.knex.transaction(async transaction => {
        await ensureAnyApiSchema(transaction)
        assert.equal(transaction.isCompleted(), false)
        assert.equal(await hasKnexTableIndex(transaction, 'any_records', index), true)
        await transaction('any_records').insert({ tenant_id: 'index-test', resource: 'groups', logical_id: '1' })
      })
      await assert.rejects(database.knex('any_records').insert({ tenant_id: 'index-test', resource: 'groups', logical_id: '1' }))
      assert.equal((await database.knex('any_records').count('* as count').first()).count.toString(), '1')
    } finally { await database.close() }
  })
})
