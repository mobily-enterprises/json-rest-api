import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { cleanTables } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createAnyApiTemporalMigrationApi, seedLegacyAnyApiTemporalData } from './fixtures/api-configs.js'
import { migrateAnyApiTemporalFields } from '../examples/migrations/anyapi-temporal-v2.js'
import { applyDatabaseReadOptions, normalizeDateValue } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'
import { AnyapiRegistry } from '../plugins/core/lib/anyapi/anyapi-registry.js'
import { createCursor } from '../plugins/core/lib/querying/knex-pagination-helpers.js'

// The old fixture used UTC timestamps, or epoch milliseconds / bare times on SQLite.
const moves = (tenant = 'migration_a') => [
  { tenant, resource: 'events', field: 'day', from: 'date_1', to: 'string_8', convert: value => normalizeDateValue(value, 'date') },
  {
    tenant,
    resource: 'events',
    field: 'atTime',
    from: 'date_2',
    to: 'string_10',
    convert: value => typeof value === 'string' && /^\d{2}:/.test(value)
      ? value
      : normalizeDateValue(value, 'dateTime').slice(11, -1)
  }
]

// This suite always tests canonical storage, including the runner's regular invocation.
describe(`Existing AnyAPI temporal migration (${databaseClient}, canonical storage)`, () => {
  let database, db, api
  before(async () => {
    database = await createTestDatabase()
    db = database.knex
    for (const tenantId of ['migration_a', 'migration_b']) api = await createAnyApiTemporalMigrationApi(db, { tenantId })
  })
  after(async () => {
    try { await database?.close() } finally { if (db) storageMode.clearRegistry(db) }
  })
  const precision = async value => {
    if (databaseClient === 'better-sqlite3') return
    // These fixture columns are nullable, have no defaults, and use Knex's default timezone type.
    await db.schema.alterTable('any_records', table => {
      for (let index = 1; index <= 5; index++) table.dateTime(`date_${index}`, { precision: value }).nullable().alter()
    })
  }
  beforeEach(async () => {
    await cleanTables(db, ['any_links', 'any_records'], { storage: 'knex' })
    await precision(3)
    await seedLegacyAnyApiTemporalData(db)
  })
  const read = table => applyDatabaseReadOptions(db(table).select().orderBy('id'))
  const snapshot = async () => {
    const result = {}
    for (const table of ['any_records', 'any_links', 'any_resource_configs', 'any_field_configs', 'any_relationship_configs']) result[table] = await read(table)
    return result
  }
  const migrate = selected => db.transaction(trx => migrateAnyApiTemporalFields(trx, selected || moves()))

  it('rejects resource registration before it can replace unmigrated temporal metadata', async () => {
    const original = await snapshot()
    const config = original.any_resource_configs.find(row => row.tenant_id === 'migration_a' && row.resource === 'events')
    const definition = {
      tenant: 'migration_a',
      resource: 'events',
      schema: JSON.parse(config.schema_json),
      relationships: JSON.parse(config.relationships_json),
      canonicalFieldMap: { name: 'string_1', day: 'string_8', atTime: 'string_10', occurredAt: 'date_3', personId: 'rel_1_id' }
    }
    const registry = new AnyapiRegistry({ knex: db })
    await assert.rejects(registry.registerResource(definition), /temporal storage migration required/)
    assert.deepEqual(await snapshot(), original)
    await assert.rejects(api.transaction(async transaction => {
      await assert.rejects(registry.registerResource(definition, { transaction }), /temporal storage migration required/)
      assert.equal(transaction.isCompleted(), false)
    }), /temporal storage migration required/)
    assert.deepEqual(await snapshot(), original)
  })

  it('rejects fresh API initialization before rebinding an unmigrated resource', async () => {
    await precision(6)
    const original = await snapshot()
    const config = original.any_resource_configs.find(row => row.tenant_id === 'migration_a' && row.resource === 'events')
    await assert.rejects(createAnyApiTemporalMigrationApi(db), /temporal storage migration required/)
    const current = await snapshot()
    assert.deepEqual(current.any_records, original.any_records)
    assert.deepEqual(current.any_links, original.any_links)
    assert.deepEqual(current.any_resource_configs.find(row => row.id === config.id), config)
    for (const table of ['any_field_configs', 'any_relationship_configs']) {
      assert.deepEqual(current[table].filter(row => row.resource_config_id === config.id), original[table].filter(row => row.resource_config_id === config.id))
    }
  })

  it('copies only the selected tenant/resource fields and preserves all other rows and metadata', async () => {
    const original = await snapshot()
    const registry = new AnyapiRegistry({ knex: db })
    await assert.rejects(registry.getDescriptor('migration_a', 'events'), /temporal storage migration required/)
    const result = await migrate()
    assert.deepEqual(result.map(entry => entry.rows), [4, 4])
    const current = await snapshot()
    const expected = structuredClone(original)
    for (const row of expected.any_records) {
      if (row.tenant_id !== 'migration_a' || row.resource !== 'events') continue
      row.string_8 = row.logical_id === '4' ? null : Number(row.logical_id) < 3 ? '2024-02-29' : '2024-03-01'
      row.string_10 = row.logical_id === '4' ? null : '12:34:56.123000'
    }
    const config = expected.any_resource_configs.find(row => row.tenant_id === 'migration_a' && row.resource === 'events')
    for (const row of expected.any_field_configs) {
      if (row.resource_config_id !== config.id || !['day', 'atTime'].includes(row.field_name)) continue
      row.slot_type = 'string'
      row.slot_index = row.field_name === 'day' ? 8 : 10
      row.slot_column = `string_${row.slot_index}`
    }
    assert.deepEqual(current, expected)
    const descriptor = await registry.getDescriptor('migration_a', 'events', { bypassCache: true })
    assert.equal(descriptor.fields.day.slot, 'string_8')
    assert.equal(descriptor.fields.occurredAt.slot, 'date_3')
    await assert.rejects(registry.getDescriptor('migration_b', 'events'), /temporal storage migration required/)
    await assert.rejects(migrate(), /Source mapping changed/)
    assert.deepEqual(await snapshot(), expected)
  })

  for (const format of ['jsonapi', 'plain']) {
    it(`preserves values, relationships, filtering and bidirectional cursors after a fresh API starts (${format})`, async () => {
      const beforeRows = await read('any_records')
      await migrate([...moves(), ...moves('migration_b')])
      if (databaseClient !== 'better-sqlite3') await assert.rejects(ensureAnyApiSchema(db), /temporal storage migration required/)
      await precision(6)
      await ensureAnyApiSchema(db)
      const withoutTargets = rows => rows.map(({ string_8: day, string_10: atTime, ...row }) => row)
      if (databaseClient === 'mysql2') {
        // MySQL's raw driver strings pad to the newly declared column precision.
        for (const row of beforeRows) {
          for (let index = 1; index <= 5; index++) {
            if (row[`date_${index}`] !== null) row[`date_${index}`] = row[`date_${index}`].replace(/\.(\d{3})$/, '.$1000')
          }
        }
      }
      assert.deepEqual(withoutTargets(await read('any_records')), withoutTargets(beforeRows))
      for (const tenantId of ['migration_a', 'migration_b']) {
        const api = await createAnyApiTemporalMigrationApi(db, { tenantId })
        const events = api.resources.events
        const fetched = await events.get({ id: '1', format, queryParams: { include: ['person', 'guests'] } })
        const attributes = format === 'plain' ? fetched : fetched.data.attributes
        assert.equal(attributes.name, `${tenantId} event 1`)
        assert.equal(attributes.day, '2024-02-29')
        assert.equal(attributes.atTime, '12:34:56.123000')
        assert.equal(attributes.occurredAt, '2024-02-29T23:59:59.987Z')
        if (format === 'plain') {
          assert.equal(fetched.person.name, tenantId)
          assert.deepEqual(fetched.guests.map(row => row.name), [tenantId])
        } else {
          assert.deepEqual(fetched.data.relationships.person.data, { type: 'people', id: '1' })
          assert.deepEqual(fetched.data.relationships.guests.data, [{ type: 'people', id: '1' }])
          assert.deepEqual(fetched.included.map(row => row.attributes.name), [tenantId])
        }
        const filtered = await events.query({ format, queryParams: { filters: { day: '2024-02-29', atTime: '12:34:56.123' } } })
        assert.deepEqual(filtered.data.map(row => row.id), ['1', '2'])
        for (const field of ['day', 'atTime']) {
          const page = cursor => events.query({ format, queryParams: { sort: [field], fields: { events: field }, page: { size: 1, ...cursor } } })
          const seen = []
          let after
          for (let index = 0; index < 4; index++) {
            const response = await page(after ? { after } : {})
            assert.equal(response.data.length, 1)
            seen.push(response.data[0].id)
            if (index === 3) assert.equal((format === 'plain' ? response.data[0] : response.data[0].attributes)[field], null)
            after = response.meta.pagination.cursor?.next
          }
          assert.deepEqual(seen, ['1', '2', '3', '4'])
          assert.equal(after, undefined)
          const reversed = []
          let before = createCursor({ id: '4', [field]: null }, [field, 'id'])
          for (let index = 0; index < 3; index++) {
            const response = await page({ before })
            reversed.unshift(response.data[0].id)
            before = response.meta.pagination.cursor?.next
          }
          assert.deepEqual(reversed, ['1', '2', '3'])
          assert.equal(before, undefined)
        }
        await events.post({ format: 'plain', data: { id: '5', name: 'New write', day: '2024-03-02', atTime: '00:00:00.123456', occurredAt: '2024-03-02T00:00:00.123Z' } })
        const created = await events.get({ id: '5', format: 'plain' })
        assert.equal(created.atTime, '00:00:00.123456')
        assert.equal(created.occurredAt, '2024-03-02T00:00:00.123Z')
      }
    })
  }

  for (const failure of ['throw', 'invalid', 'null', 'precision']) {
    it(`rolls back earlier fields and records when conversion fails (${failure})`, async () => {
      const original = await snapshot()
      const selected = moves()
      selected[1].convert = (value, row) => {
        if (row.id !== '3') return '12:34:56.123'
        if (failure === 'throw') throw new Error('conversion failed')
        return { invalid: '25:00:00', null: null, precision: '12:34:56.1234567' }[failure]
      }
      await assert.rejects(migrate(selected), failure === 'throw'
        ? /conversion failed/
        : failure === 'null' ? /Conversion must return a string/ : { code: 'REST_API_TEMPORAL_DATA_INVALID' })
      assert.deepEqual(await snapshot(), original)
    })
  }

  for (const failure of ['occupied', 'duplicate', 'data', 'source', 'missing', 'invalidSlot', 'noConverter']) {
    it(`rejects an unsafe mapping without changing stored data (${failure})`, async () => {
      const selected = moves()
      if (failure === 'occupied') selected[0].to = 'string_1'
      if (failure === 'duplicate') selected[1].to = selected[0].to
      if (failure === 'data') await db('any_records').where({ tenant_id: 'migration_a', resource: 'events', logical_id: '4' }).update({ string_8: 'preserve me' })
      if (failure === 'source') selected[0].from = 'date_4'
      if (failure === 'missing') selected[0].field = 'unknown'
      if (failure === 'invalidSlot') selected[0].to = 'string_11'
      if (failure === 'noConverter') delete selected[0].convert
      const original = await snapshot()
      await assert.rejects(migrate(selected))
      assert.deepEqual(await snapshot(), original)
    })
  }

  it('requires the caller transaction and leaves commit/rollback to its owner', async () => {
    const original = await snapshot()
    await assert.rejects(migrateAnyApiTemporalFields(db, moves()), /caller-owned Knex transaction/)
    await assert.rejects(db.transaction(async trx => {
      await migrateAnyApiTemporalFields(trx, moves())
      assert.equal(trx.isCompleted(), false)
      assert.equal((await trx('any_records').where({ tenant_id: 'migration_a', resource: 'events', logical_id: '1' }).first()).string_8, '2024-02-29')
      throw new Error('caller rollback')
    }), /caller rollback/)
    assert.deepEqual(await snapshot(), original)
  })

  it('copies across batch boundaries including null and soft-deleted records', async () => {
    await cleanTables(db, ['any_links', 'any_records'], { storage: 'knex' })
    await seedLegacyAnyApiTemporalData(db, { count: 205 })
    await db('any_records').where({ tenant_id: 'migration_a', resource: 'events', logical_id: '205' }).update({ deleted_at: '2024-03-02 00:00:00' })
    const result = await migrate()
    assert.deepEqual(result.map(entry => entry.rows), [205, 205])
    const rows = await db('any_records').where({ tenant_id: 'migration_a', resource: 'events' })
    assert.equal(rows.filter(row => row.string_8 === '2024-03-01').length, 202)
    assert.equal(rows.filter(row => row.string_8 === null).length, 1)
    assert.equal(rows.find(row => row.logical_id === '205').string_10, '12:34:56.123000')
  })

  it('preserves microseconds already present in the old slot without driver Date conversion', async () => {
    await precision(6)
    const value = databaseClient === 'pg'
      ? '2000-01-01 12:34:56.123456Z'
      : databaseClient === 'mysql2' ? '2000-01-01 12:34:56.123456' : '12:34:56.123456'
    await db('any_records').where({ tenant_id: 'migration_a', resource: 'events', logical_id: '1' }).update({ date_2: value })
    const selected = moves()
    const convert = selected[1].convert
    const calls = []
    selected[1].convert = (value, row) => {
      calls.push({ value, row })
      return convert(value)
    }
    await migrate(selected)
    assert.equal(calls.length, 3, 'Null values bypass conversion')
    assert.equal(typeof calls[0].value, 'string')
    assert.match(calls[0].value, /\.123456/)
    assert.deepEqual(calls[0].row, { tenant: 'migration_a', resource: 'events', field: 'atTime', id: '1' })
    assert.equal((await db('any_records').where({ tenant_id: 'migration_a', resource: 'events', logical_id: '1' }).first()).string_10, '12:34:56.123456')
  })

  it('migrates metadata for an empty resource without affecting other tenants', async () => {
    await db('any_records').where({ tenant_id: 'migration_a', resource: 'events' }).delete()
    const original = await read('any_records')
    assert.deepEqual((await migrate()).map(entry => entry.rows), [0, 0])
    assert.deepEqual(await read('any_records'), original)
    const descriptor = await new AnyapiRegistry({ knex: db }).getDescriptor('migration_a', 'events')
    assert.equal(descriptor.fields.day.slot, 'string_8')
    assert.equal(descriptor.fields.atTime.slot, 'string_10')
  })
})
