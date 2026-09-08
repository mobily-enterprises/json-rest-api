import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyFieldSetters, handleRecordReturnAfterWrite } from '../plugins/core/rest-api-plugin-methods/common.js'
import knexLib from 'knex'
import { createTemporalBoundaryApi } from './fixtures/api-configs.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'
import { mapRestApiErrorToHttp } from '../plugins/core/connectors/lib/transport-http-helpers.js'
import { normalizeAttributes, normalizeRecordAttributes } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiTemporalDataError } from '../lib/rest-api-errors.js'

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
let api
let finishValue
const document = (attributes = {}) => createJsonApiDocument('events', { name: 'Event', ...attributes })
const assertValidationError = (error) => {
  assert.equal(error.code, 'REST_API_VALIDATION')
  assert.equal(mapRestApiErrorToHttp(error).status, 422)
  return true
}

describe('Temporal storage and response boundaries', () => {
  before(async () => {
    api = await createTemporalBoundaryApi(knex)
    const handler = async ({ context }) => {
      if (finishValue === undefined || context.scopeName !== 'events') return
      const attributes = context.simplified ? context.responseRecord : context.responseRecord?.data?.attributes
      if (attributes) attributes.producedAt = finishValue
      if (context.simplified && attributes?.person) attributes.person.producedAt = finishValue
      for (const included of context.responseRecord?.included || []) included.attributes.producedAt = finishValue
    }
    await api.customize({ hooks: {
      finishPost: { functionName: 'temporal-finish-post', handler },
      finishPut: { functionName: 'temporal-finish-put', handler },
      finishPatch: { functionName: 'temporal-finish-patch', handler }
    } })
  })
  after(async () => { await knex.destroy() })
  beforeEach(async () => {
    finishValue = undefined
    await cleanTables(knex, ['temporal_events', 'temporal_people'])
  })

  it('rejects submillisecond writes without inserting or changing data', async () => {
    const precise = '2026-09-01T10:20:30.123456Z'
    await assert.rejects(api.resources.events.post({ inputRecord: document({ occurredAt: precise }) }), assertValidationError)
    assert.equal((await api.resources.events.query()).data.length, 0)
    const created = await api.resources.events.post({ inputRecord: document({ occurredAt: '2026-09-01T10:20:30.123000Z' }) })
    for (const method of ['put', 'patch']) {
      const inputRecord = document({ occurredAt: precise })
      inputRecord.data.id = created.data.id
      await assert.rejects(api.resources.events[method]({ id: created.data.id, inputRecord }), assertValidationError)
      const result = await api.resources.events.get({ id: created.data.id })
      assert.equal(result.data.attributes.occurredAt, '2026-09-01T10:20:30.123Z')
    }
  })

  it('retains submillisecond precision supplied by storage, including timezone offsets', () => {
    for (const value of ['2026-09-01 10:20:30.123456', '2026-09-01T18:20:30.123456+08:00']) {
      const result = normalizeAttributes({ occurredAt: value }, { occurredAt: { type: 'dateTime', temporalPrecision: 6 } })
      assert.equal(result.occurredAt, '2026-09-01T10:20:30.123456Z')
    }
  })

  it('normalizes numeric epoch values returned as strings or bigints by drivers', () => {
    const schema = { milliseconds: { type: 'epochMilliseconds' }, seconds: { type: 'epochSeconds' } }
    assert.deepEqual(normalizeAttributes({ milliseconds: '1788258030123', seconds: 1788258030n }, schema), {
      milliseconds: 1788258030123, seconds: 1788258030
    })
    for (const value of ['bad', '8640000000000001', 1.25]) {
      assert.throws(() => normalizeAttributes({ milliseconds: value }, schema), { code: 'REST_API_TEMPORAL_DATA_INVALID' })
    }
  })

  it('normalizes temporal query projections and follows their cursors', async () => {
    for (let index = 0; index < 4; index++) {
      await api.resources.events.post({ inputRecord: document({ occurredAt: `2026-09-01T10:20:3${index}.123Z` }) })
    }
    const queryParams = { sort: ['projectedAt'], fields: { events: 'projectedAt' }, page: { size: 2 } }
    const first = await api.resources.events.query({ queryParams })
    assert.equal(first.data[0].attributes.projectedAt, '2026-09-01T10:20:30.123Z')
    const second = await api.resources.events.query({ queryParams: {
      ...queryParams, page: { size: 2, after: first.meta.pagination.cursor.next }
    } })
    assert.equal(second.data[0].attributes.projectedAt, '2026-09-01T10:20:32.123Z')
  })

  it('uses a custom serializer consistently for writes and filters', { skip: storageMode.isAnyApi() }, async () => {
    const value = '2026-09-01T10:20:30.123456Z'
    const created = await api.resources.events.post({ inputRecord: document({ serializedAt: value }) })
    assert.equal(created.data.attributes.serializedAt, value)
    const filtered = await api.resources.events.query({ queryParams: { filters: { serializedAt: value } } })
    assert.deepEqual(filtered.data.map(entry => entry.id), [created.data.id])
  })

  it('validates included fieldsets even when the relationship or collection is empty', async () => {
    const queryParams = { include: ['person'], fields: { people: 'missingField' } }
    await assert.rejects(api.resources.events.query({ queryParams }), { code: 'REST_API_FIELDSET_INVALID' })
    const created = await api.resources.events.post({ inputRecord: document() })
    await assert.rejects(api.resources.events.get({ id: created.data.id, queryParams }), { code: 'REST_API_FIELDSET_INVALID' })
  })

  it('rejects inherited object names as unknown sparse fields', async () => {
    for (const field of ['constructor', 'toString', '__proto__']) {
      await assert.rejects(api.resources.events.query({ queryParams: { fields: { events: field } } }), {
        code: 'REST_API_FIELDSET_INVALID'
      })
    }
  })

  it('normalizes nested simplified to-many and polymorphic resources without changing ordinary objects', () => {
    const date = new Date('2026-09-08T11:22:33.987Z')
    const child = { id: 'child', producedAt: date }
    const payload = { id: 'event', person: { id: 'person', events: [child, child] },
      subject: { id: 'person', _type: 'people', producedAt: date },
      arbitrary: { producedAt: date, value: 'unchanged' } }
    const result = normalizeRecordAttributes(payload, api.resources, { simplified: true, resourceType: 'events', source: 'response' })
    assert.equal(result.person.events[0].producedAt, '2026-09-08T11:22:33Z')
    assert.equal(result.person.events[0], result.person.events[1])
    assert.equal(result.subject.producedAt, '2026-09-08T11:22:33Z')
    assert.equal(result.subject._type, 'people')
    assert.equal(result.arbitrary, payload.arbitrary)
    assert.equal(child.producedAt, date)
  })

  it('preserves typed API errors thrown by computed fields', async () => {
    const created = await api.resources.events.post({ inputRecord: document() })
    const definition = api.resources.events.vars.schemaInfo.computed.producedAt
    const original = definition.compute
    const error = new RestApiTemporalDataError({ field: 'producedAt', resourceType: 'events', fieldType: 'dateTime', source: 'response' })
    definition.compute = () => { throw error }
    try {
      await assert.rejects(api.resources.events.get({ id: created.data.id }), actual => actual === error)
    } finally {
      definition.compute = original
    }
  })

  it('preserves typed API errors thrown by getters', async () => {
    const created = await api.resources.events.post({ inputRecord: document() })
    const schemaInfo = api.resources.events.vars.schemaInfo
    const originalGetters = schemaInfo.fieldGetters
    const originalOrder = schemaInfo.sortedGetterFields
    const error = new RestApiTemporalDataError({ field: 'name', resourceType: 'events', source: 'response' })
    schemaInfo.fieldGetters = { name: { getter: () => { throw error } } }
    schemaInfo.sortedGetterFields = ['name']
    try {
      await assert.rejects(api.resources.events.get({ id: created.data.id }), actual => actual === error)
    } finally {
      schemaInfo.fieldGetters = originalGetters
      schemaInfo.sortedGetterFields = originalOrder
    }
  })

  it('preserves typed errors from setters and post-write storage reads', async () => {
    const error = new RestApiTemporalDataError({ field: 'occurredAt', resourceType: 'events' })
    await assert.rejects(applyFieldSetters({ occurredAt: '2026-09-08T00:00:00Z' }, {
      fieldSetters: { occurredAt: { setter: () => { throw error } } },
      sortedSetterFields: ['occurredAt']
    }, { scopeName: 'events' }), actual => actual === error)
    await assert.rejects(handleRecordReturnAfterWrite({
      context: { method: 'POST' }, scopeName: 'events',
      helpers: { dataGetMinimal: async () => { throw error } },
      log: { warn () {} }
    }), actual => actual === error)
  })

  for (const direction of ['after', 'before']) {
    it(`rejects malformed temporal and numeric values in page[${direction}] as client errors`, async () => {
      for (const [field, value] of [['occurredAt', 'garbage'], ['day', '2026-02-30'], ['atTime', '25:30'], ['observedAtMs', 'NaN']]) {
        await assert.rejects(api.resources.events.query({ queryParams: {
          sort: [field], page: { size: 2, [direction]: `${field}:${encodeURIComponent(value)},id:1` }
        } }), (error) => {
          assertValidationError(error)
          assert.deepEqual(error.details.fields, [`page.${direction}`])
          return true
        })
      }
    })
  }

  for (const simplified of [false, true]) {
    for (const method of ['post', 'put', 'patch']) {
      it(`normalizes ${method} finish values and included resources with simplified=${simplified}`, async () => {
        const person = await api.resources.people.post({ inputRecord: createJsonApiDocument('people', { name: 'Person' }) })
        const inputRecord = document()
        inputRecord.data.relationships = { person: { data: { type: 'people', id: person.data.id } } }
        const created = method === 'post' ? null : await api.resources.events.post({ inputRecord })
        if (created) inputRecord.data.id = created.data.id
        finishValue = new Date('2026-09-08T11:22:33.987Z')
        const result = await api.resources.events[method]({
          ...(created ? { id: created.data.id } : {}), inputRecord,
          queryParams: { include: ['person'] }, simplified
        })
        assert.equal((simplified ? result : result.data.attributes).producedAt, '2026-09-08T11:22:33Z')
        assert.equal((simplified ? result.person : result.included[0].attributes).producedAt, '2026-09-08T11:22:33Z')
      })
    }
    it(`rejects invalid finish values with simplified=${simplified}`, async () => {
      finishValue = 'not-a-date'
      await assert.rejects(api.resources.events.post({ inputRecord: document(), simplified }), (error) => {
        assert.equal(error.code, 'REST_API_TEMPORAL_DATA_INVALID')
        assert.equal(mapRestApiErrorToHttp(error).status, 500)
        return true
      })
    })
  }
})
