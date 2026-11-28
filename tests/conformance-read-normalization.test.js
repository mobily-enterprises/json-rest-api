import { after, before, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createSchema } from 'json-rest-schema'
import { createTemporalBoundaryApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'
import { normalizeAttributes, normalizeRecordAttributes } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'

// What a read costs beyond its statements: the schemas it validates with and the values it parses, per read.

const tables = { events: 'temporal_events', people: 'temporal_people' }
const PAGE_PARAMETERS = ['after', 'before', 'cursor', 'limit', 'number', 'offset', 'size']
const TEMPORAL_TYPES = new Set(['date', 'dateTime', 'time'])
// Every json-rest-schema schema validates through its prototype's validateWith (patch, create and replace call it).
const schemaPrototype = Object.getPrototypeOf(createSchema({}))

/** The schemas `work` validated with, one entry per validation. */
async function schemaValidations (work) {
  const schemas = []
  const validateWith = schemaPrototype.validateWith
  mock.method(schemaPrototype, 'validateWith', function (...args) {
    schemas.push(this)
    return validateWith.apply(this, args)
  })
  try {
    await work()
  } finally {
    mock.restoreAll()
  }
  return schemas
}

/** How many values `work` parsed into a Date and wrote back as text. */
function datesFormatted (work) {
  const toISOString = Date.prototype.toISOString
  let calls = 0
  mock.method(Date.prototype, 'toISOString', function () {
    calls += 1
    return toISOString.call(this)
  })
  try {
    work()
  } finally {
    mock.restoreAll()
  }
  return calls
}

const isPageSchema = schema => Object.keys(schema.structure).sort().join() === PAGE_PARAMETERS.join()
const isTemporalValueSchema = schema => Object.keys(schema.structure).join() === 'value' &&
  TEMPORAL_TYPES.has(schema.structure.value?.type)

describe(`Read validation per read (${storageMode.mode})`, () => {
  let fixture
  let events
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createTemporalBoundaryApi, tables })
    events = fixture.api.resources.events
  })
  beforeEach(async () => {
    await fixture.reset()
    for (const index of [1, 2, 3]) {
      await fixture.seed('events', {
        name: `Event ${index}`,
        occurredAt: `2024-02-2${index}T23:59:59.123Z`,
        day: `2024-02-2${index}`,
        atTime: `23:59:5${index}.001`
      })
    }
  })
  after(async () => { await fixture?.close() })

  it('checks the page parameters of queries of one shape with one schema', async () => {
    const schemas = await schemaValidations(async () => {
      for (let call = 0; call < 5; call += 1) {
        assert.equal((await events.query({ queryParams: { page: { size: 2 } } })).data.length, 2)
      }
    })
    const pageValidations = schemas.filter(isPageSchema)
    assert.ok(pageValidations.length >= 5, `${pageValidations.length} page validations`)
    assert.equal(new Set(pageValidations).size, 1)
  })

  it('checks a read\'s date, time and dateTime values without a schema per value', async () => {
    let result
    const schemas = await schemaValidations(async () => {
      result = await events.query({ queryParams: { page: { size: 3 } } })
    })
    assert.deepEqual(result.data.map(entry => entry.attributes.day), ['2024-02-21', '2024-02-22', '2024-02-23'])
    assert.deepEqual(result.data.map(entry => entry.attributes.atTime), ['23:59:51.001', '23:59:52.001', '23:59:53.001'])
    assert.deepEqual(result.data.map(entry => entry.attributes.occurredAt), [
      '2024-02-21T23:59:59.123Z', '2024-02-22T23:59:59.123Z', '2024-02-23T23:59:59.123Z'
    ])
    assert.equal(schemas.filter(isTemporalValueSchema).length, 0)
  })

  it('refuses invalid page parameters with the same codes and messages', async () => {
    const atLeastOne = ['MIN_VALUE', 'Value must be at least 1.']
    const notAnInteger = ['TYPE_CAST_FAILED', 'Value could not be cast to the required type.']
    const noCursor = ['INVALID_PAGE', 'page[after] must contain a cursor.']
    const oneMode = ['INVALID_PAGE', 'Use either page[number], page[after], or page[before].']
    for (const [page, [rule, message]] of [
      [{ size: 0 }, atLeastOne], [{ size: -1 }, atLeastOne], [{ size: 0.5 }, notAnInteger], [{ size: 'two' }, notAnInteger],
      [{ number: 0 }, atLeastOne], [{ number: -1 }, atLeastOne], [{ number: 1.5 }, notAnInteger],
      [{ after: '' }, noCursor], [{ after: ' ' }, noCursor],
      [{ after: 'id:1', before: 'id:8' }, oneMode], [{ number: 1, after: 'id:1' }, oneMode]
    ]) {
      await assert.rejects(events.query({ queryParams: { page } }), error => {
        assert.equal(error.code, 'REST_API_VALIDATION', JSON.stringify(page))
        assert.equal(error.message, message, JSON.stringify(page))
        assert.deepEqual(error.details, {
          fields: ['queryParams.page'],
          violations: [{ field: 'queryParams.page', rule, message }]
        }, JSON.stringify(page))
        return true
      })
    }
  })
})

describe('The response pass after a read', () => {
  const outputFields = {
    occurredAt: { type: 'dateTime', temporalPrecision: 6 },
    day: { type: 'date' },
    atTime: { type: 'time', temporalPrecision: 3 },
    createdAt: { type: 'dateTime' }
  }
  const scopes = { events: { vars: { schemaInfo: { outputFields } } } }
  const stored = index => ({
    type: 'events',
    id: String(index),
    attributes: {
      occurredAt: `2024-02-2${index} 23:59:59.123456`,
      day: `2024-02-2${index}`,
      atTime: `23:59:5${index}.001`,
      createdAt: new Date(`2024-02-2${index}T10:00:00.250Z`)
    }
  })

  it('parses no value the database pass answered and nothing changed since', () => {
    const document = { data: [1, 2, 3].map(stored) }
    assert.equal(datesFormatted(() => normalizeRecordAttributes(document, scopes)), 6)
    const answered = structuredClone(document)
    assert.equal(datesFormatted(() => normalizeRecordAttributes(document, scopes, { source: 'response' })), 0)
    assert.deepEqual(document, answered)
  })

  it('normalizes each value something changed after the database pass, in place or by replacement', () => {
    const document = { data: [1, 2, 3].map(stored), included: [] }
    normalizeRecordAttributes(document, scopes)
    // An enricher that replaced the attributes, a hook that changed the same object, and a record added after.
    document.data[0].attributes = { ...document.data[0].attributes, occurredAt: new Date('2026-09-09T12:34:56.789Z') }
    document.data[1].attributes.atTime = '23:59'
    document.data[1].attributes.day = new Date('2024-03-01T07:59:59+08:00')
    document.included.push({ type: 'events', id: '4', attributes: { createdAt: '2024-02-24 10:00:00' } })
    normalizeRecordAttributes(document, scopes, { source: 'response' })
    assert.equal(document.data[0].attributes.occurredAt, '2026-09-09T12:34:56.789Z')
    assert.equal(document.data[1].attributes.atTime, '23:59:00.000')
    assert.equal(document.data[1].attributes.day, '2024-02-29')
    assert.equal(document.included[0].attributes.createdAt, '2024-02-24T10:00:00.000Z')
    assert.equal(document.data[2].attributes.occurredAt, '2024-02-23T23:59:59.123456Z')
  })

  it('answers what the database pass answered when the response pass normalizes it again', () => {
    for (const [type, value, temporalPrecision] of [
      ['dateTime', new Date('2024-02-29T23:59:59.987Z'), 0],
      ['dateTime', new Date('2024-02-29T23:59:59.987Z'), undefined],
      ['dateTime', '2024-02-29 23:59:59', undefined],
      ['dateTime', '2024-02-29 23:59:59.100', 3],
      ['dateTime', '2024-02-29T23:59:59.123456-00:30', 6],
      ['dateTime', '2024-03-01 07:59:59.123456+08', 6],
      ['dateTime', '0001-02-29 20:18:20+07:43:24 BC', 3],
      ['dateTime', 0n, 3],
      ['dateTime', 1709251199987, undefined],
      ['date', '0001-02-29 BC', undefined],
      ['date', '2024-02-29', undefined],
      ['date', new Date('2024-03-01T07:59:59+08:00'), undefined],
      ['time', new Date('2024-02-29T23:59:59.987Z'), 1],
      ['time', '23:59', undefined],
      ['time', '23:59:59.120', 3],
      ['epochMilliseconds', 8640000000000000n, undefined],
      ['epochSeconds', '-8640000000000', undefined]
    ]) {
      const definition = { value: { type, ...(temporalPrecision === undefined ? {} : { temporalPrecision }) } }
      const database = normalizeAttributes({ value }, definition)
      assert.deepEqual(normalizeAttributes(database, definition, { source: 'response' }), database, `${type} ${String(value)}`)
    }
  })
})

describe(`A finish hook registered between two reads (${storageMode.mode})`, () => {
  let fixture
  let events
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createTemporalBoundaryApi, tables })
    events = fixture.api.resources.events
    await fixture.reset()
    await fixture.seed('events', { name: 'Stored', occurredAt: '2024-02-29T23:59:59.123Z' })
  })
  after(async () => { await fixture?.close() })

  it('has the value it sets normalized by the next read, as a response value', async () => {
    const first = await events.get({ id: '1', format: 'jsonapi' })
    assert.equal(first.data.attributes.occurredAt, '2024-02-29T23:59:59.123Z')

    await fixture.api.customize({
      hooks: {
        finish: {
          functionName: 'late-occurred-at',
          handler: async ({ context }) => {
            if (context.lateOccurredAt === undefined || !context.record?.data?.attributes) return
            context.record.data.attributes.occurredAt = context.lateOccurredAt
          }
        }
      }
    })

    for (const format of ['jsonapi', 'plain']) {
      const second = await events.get({ id: '1', format }, { lateOccurredAt: new Date('2026-09-09T12:34:56.789Z') })
      assert.equal((format === 'plain' ? second : second.data.attributes).occurredAt, '2026-09-09T12:34:56.789Z')
      await assert.rejects(events.get({ id: '1', format }, { lateOccurredAt: new Date(NaN) }), error => {
        assert.equal(error.code, 'REST_API_TEMPORAL_DATA_INVALID')
        assert.equal(error.message, "Invalid response value for dateTime field 'events.occurredAt'.")
        assert.deepEqual(error.details, { field: 'occurredAt', resourceType: 'events', fieldType: 'dateTime', source: 'response' })
        return true
      })
    }
    assert.equal((await events.get({ id: '1', format: 'jsonapi' })).data.attributes.occurredAt, '2024-02-29T23:59:59.123Z')
  })
})
