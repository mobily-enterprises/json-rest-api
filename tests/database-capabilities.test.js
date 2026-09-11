import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyInsertReturning, getDatabaseCapabilities, getDatabaseInfo, getInsertResultMode, getSchemaCapabilities, getTemporalStorageCapabilities, supportsWindowFunctions } from '../plugins/core/lib/querying-writing/database-capabilities.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { getRelationshipCardinality } from '../plugins/core/lib/querying-writing/relationship-contracts.js'

// Version replies are injected here; real version queries are covered by driver suites.
function versionDatabase (client, version) {
  return {
    client: { config: { client } },
    first: async () => ({ version }),
    raw: () => [{ version }]
  }
}

describe('Window capability version contracts', () => {
  for (const [client, version, supported] of [
    ['mysql2', '8.0.46', true],
    ['mysql2', '5.7.44', false],
    ['mysql', 'unknown', false],
    ['mysql2', 'unknown', false],
    ['better-sqlite3', '3.25.0', true],
    ['better-sqlite3', '3.24.0', false],
    ['sqlite3', 'unknown', false],
    ['better-sqlite3', 'unknown', false],
    ['mariadb', '10.2.0-MariaDB', true],
    ['mariadb', '10.1.48-MariaDB', false],
    ['mariadb', 'unknown-MariaDB', false]
  ]) {
    it(`${client} ${version} returns ${supported}`, async () => {
      assert.equal(await supportsWindowFunctions(versionDatabase(client, version)), supported)
    })
  }
})

describe('Shared capability detection', () => {
  for (const [client, name, version] of [['mysql2', 'MySQL', '8.0.46'], ['better-sqlite3', 'SQLite', '3.49.2'], ['pg', 'PostgreSQL', 'PostgreSQL 16.15']]) {
    it(`observes ${client} version once`, async () => {
      let observations = 0
      const database = {
        client: { config: { client } },
        first: async () => { observations++; return { version } },
        raw: () => {
          if (client === 'mysql2') return 'version expression'
          observations++
          return client === 'pg' ? { rows: [{ version }] } : [{ version }]
        }
      }
      const capabilities = await getDatabaseCapabilities(database)
      assert.deepEqual(capabilities.dbInfo, { client: name, version })
      assert.equal(capabilities.windowFunctions, true)
      assert.equal(observations, 1)
    })
  }
})

describe('Capability observation failures', () => {
  for (const client of ['mysql2', 'better-sqlite3', 'pg']) {
    for (const failure of [null, undefined, 'driver unavailable']) {
      it(`${client} retains ${String(failure)} failure without replacing the fallback`, async () => {
        const events = []
        let observations = 0
        const reject = () => { observations++; throw failure }
        const database = { client: { config: { client } }, first: reject, raw: client === 'mysql2' ? () => 'version expression' : reject }
        const log = { warn: (...args) => events.push(args) }
        const capabilities = await getDatabaseCapabilities(database, log)
        assert.equal(capabilities.dbInfo.version, 'unknown')
        assert.equal(capabilities.dbInfo.error, String(failure))
        assert.equal(capabilities.windowFunctions, client === 'pg')
        assert.equal(observations, 1)
        assert.equal(events.length, 1)
        assert.equal(events[0][1].backend, client)
        assert.equal(events[0][1].operation, 'database-capabilities')
        assert.equal(events[0][1].phase, 'version-observation')
      })
    }
    it(`${client} contains asynchronously rejected observation diagnostics`, async () => {
      let attempted = false
      const failure = new Error('Original observation failure')
      const reject = () => { throw failure }
      const database = { client: { config: { client } }, first: reject, raw: client === 'mysql2' ? () => 'version expression' : reject }
      const info = await getDatabaseInfo(database, {
        warn: async () => {
          await new Promise(resolve => setImmediate(resolve))
          attempted = true
          throw new Error('Async diagnostic failure')
        }
      })
      assert.equal(attempted, true)
      assert.equal(info.version, 'unknown')
      assert.equal(info.error, failure.message)
    })
    it(`${client} retains the observation failure when the diagnostic sink throws`, async () => {
      const failure = new Error('Version query failed')
      const reject = () => { throw failure }
      const database = { client: { config: { client } }, first: reject, raw: client === 'mysql2' ? () => 'version expression' : reject }
      const info = await getDatabaseInfo(database, { warn: () => { throw new Error('Logger failed') } })
      assert.equal(info.version, 'unknown')
      assert.equal(info.error, failure.message)
    })
  }

  for (const client of ['mysql2', 'better-sqlite3', 'pg']) {
    it(`${client} rejects malformed version results without claiming a detected version`, async () => {
      for (const version of [null, undefined, 80046, {}]) {
        const info = await getDatabaseInfo({
          client: { config: { client } },
          first: async () => ({ version }),
          raw: () => client === 'pg' ? { rows: [{ version }] } : [{ version }]
        })
        assert.equal(info.version, 'unknown')
        assert.equal(info.error, 'Database version query did not return a string')
      }
    })
  }

  it('keeps direct window probes conservative after failed version queries', async () => {
    for (const client of ['mysql2', 'better-sqlite3', 'mariadb']) {
      const events = []
      const failure = null
      const reject = () => { throw failure }
      assert.equal(await supportsWindowFunctions({ client: { config: { client } }, first: reject, raw: reject }, undefined, { warn: (...args) => events.push(args) }), false)
      assert.equal(events.length, 1)
    }
  })

  it('bounds nested driver diagnostics without modifying the original error', async () => {
    const failure = new Error('x'.repeat(30000))
    failure.cause = { details: 'y'.repeat(30000) }
    const events = []
    await getDatabaseInfo({ client: { config: { client: 'pg' } }, raw: () => { throw failure } }, { warn: (...args) => events.push(args) })
    assert.equal(events.length, 1)
    assert.ok(JSON.stringify(events).length < 20000)
    assert.equal(failure.message.length, 30000)
    assert.equal(failure.cause.details.length, 30000)
  })
})

describe('Schema operation capabilities', () => {
  for (const [dialects, expected] of [
    [['mysql', 'mysql2'], { recognizedDialect: true, fieldAlteration: 'standalone', callerFieldAlteration: 'forbidden', temporalColumnFractionDigits: 6, setValues: true }],
    [['sqlite3', 'better-sqlite3'], { recognizedDialect: true, fieldAlteration: 'sqlite-rebuild', callerFieldAlteration: 'foreign-keys-off', temporalColumnFractionDigits: null, setValues: false }],
    [['pg', 'postgresql'], { recognizedDialect: true, fieldAlteration: 'transaction', callerFieldAlteration: 'savepoint', temporalColumnFractionDigits: 6, setValues: false }],
    [['custom-driver'], { recognizedDialect: false, fieldAlteration: 'transaction', callerFieldAlteration: 'savepoint', temporalColumnFractionDigits: null, setValues: false }]
  ]) {
    for (const dialect of dialects) {
      it(`describes the ${dialect} field-alteration runner`, () => {
        assert.deepEqual(getSchemaCapabilities(dialect), expected)
      })
    }
  }
})

describe(`Installed database capabilities (${storageMode.mode})`, () => {
  let fixture
  const versionQueries = []
  const returningWarnings = []
  let restoreWarnings
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: async (knex, options) => {
        const logger = knex.client.logger
        const warn = logger.warn
        logger.warn = function (message) {
          if (String(message).includes('.returning() is not supported')) returningWarnings.push(message)
          return warn.call(this, message)
        }
        restoreWarnings = () => { logger.warn = warn }
        const observe = query => { if (/select.*(?:sqlite_version\(\)|version\(\))/i.test(query.sql)) versionQueries.push(query.sql) }
        knex.on('query', observe)
        try { return await createConformanceApi(knex, options) } finally { knex.off('query', observe) }
      }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { restoreWarnings?.(); await fixture?.close() })
  it('publishes version information and include capability from one observation', () => {
    const { dbInfo, windowFunctions, schema } = fixture.api.knex.capabilities
    assert.equal(typeof dbInfo.client, 'string')
    assert.equal(typeof dbInfo.version, 'string')
    assert.notEqual(dbInfo.version, 'unknown')
    assert.equal(windowFunctions, true)
    assert.deepEqual(schema, getSchemaCapabilities(fixture.knex.client.config.client))
    assert.equal(versionQueries.length, 1)
    assert.equal(fixture.api.knex.capabilities.insertResult, getInsertResultMode(fixture.knex.client.config.client))
    assert.deepEqual(fixture.api.knex.capabilities.temporal, {
      native: getTemporalStorageCapabilities(fixture.knex.client.config.client),
      text: getTemporalStorageCapabilities(fixture.knex.client.config.client, { textStorage: true })
    })
    const { serialization, relationships } = fixture.api.knex.capabilities
    assert.deepEqual(serialization, { customSerializerResult: 'synchronous', structuredTypes: ['object', 'array'], structuredEncoding: 'json', wholeDocumentPredicates: false })
    assert.deepEqual(relationships, { attributeKinds: ['belongsTo', 'belongsToPolymorphic'], declaredCardinalities: { hasOne: 'one', hasMany: 'many', manyToMany: 'many' } })
    assert.throws(() => { serialization.structuredTypes.push('string') }, TypeError)
    assert.throws(() => { relationships.declaredCardinalities.hasOne = 'many' }, TypeError)
  })
  it('keeps registry, generated and explicit insert IDs without unsupported RETURNING requests', async () => {
    const generated = await fixture.seed('items', { name: 'Generated' }, undefined, { generatedId: true })
    assert.equal(typeof generated.id, 'string')
    assert.notEqual(generated.id, '')
    const explicit = await fixture.api.resources.items.post({ inputRecord: { data: { type: 'items', id: '42', attributes: { name: 'Explicit' } } } })
    assert.equal(explicit.data.id, '42')
    assert.equal((await fixture.api.resources.items.get({ id: generated.id })).data.attributes.name, 'Generated')
    assert.deepEqual(returningWarnings, [])
  })
})

describe('Relationship capability cardinalities', () => {
  for (const [label, definition, expected] of [
    ['belongsTo', { belongsTo: 'groups' }, 'one'],
    ['polymorphic belongsTo', { belongsToPolymorphic: { types: ['groups'] } }, 'one'],
    ['hasOne', { type: 'hasOne' }, 'one'],
    ['hasMany', { type: 'hasMany' }, 'many'],
    ['manyToMany', { type: 'manyToMany' }, 'many'],
    ['absent', null, null],
    ['unknown', { type: 'unknown' }, null],
    ['inherited object key', { type: 'constructor' }, null],
    ['invalid type value', { type: {} }, null],
    ['attribute precedence', { belongsTo: 'groups', type: 'hasMany' }, 'one']
  ]) {
    it(`retains ${label} cardinality`, () => {
      assert.equal(getRelationshipCardinality(definition), expected)
    })
  }
})

describe('Built-in temporal storage capabilities', () => {
  for (const [dialect, dateMinYear, timeFractionDigits] of [['pg', 0, 6], ['postgresql', 0, 6], ['mysql', 1000, 6], ['mysql2', 1000, 6], ['better-sqlite3', 0, null], ['sqlite3', 0, null]]) {
    it(`describes ${dialect} native conversion limits`, () => {
      assert.deepEqual(getTemporalStorageCapabilities(dialect), {
        dateMinYear, dateTimeMinYear: dateMinYear, maxYear: 9999, dateTimeFractionDigits: 3, timeFractionDigits
      })
    })
    it(`keeps ${dialect} text date/time separate from dateTime conversion`, () => {
      assert.deepEqual(getTemporalStorageCapabilities(dialect, { textStorage: true }), {
        dateMinYear: 0, dateTimeMinYear: dateMinYear, maxYear: 9999, dateTimeFractionDigits: 3, timeFractionDigits: null
      })
    })
  }
})

describe('Insert result query forms', () => {
  for (const [dialect, mode] of [['mysql', 'insert-id'], ['mysql2', 'insert-id'], ['pg', 'rows'], ['postgresql', 'rows'], ['sqlite3', 'rows'], ['better-sqlite3', 'rows'], ['custom-driver', 'driver-defined']]) {
    it(`keeps ${dialect} insert IDs and returning columns in their existing form`, () => {
      const columns = { record_key: 'physical_key' }
      const calls = []
      const query = { client: { config: { client: dialect } }, returning (value) { calls.push(value); return this } }
      assert.equal(getInsertResultMode(dialect), mode)
      assert.equal(applyInsertReturning(query, columns), query)
      assert.deepEqual(calls, mode === 'insert-id' ? [] : [columns])
    })
  }
})
