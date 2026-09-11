import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTemporalBoundaryApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { normalizeAttributes } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'
import { createCursor } from '../plugins/core/lib/querying/knex-pagination-helpers.js'

const input = (format, attributes) => format === 'plain' ? attributes : createJsonApiDocument('events', attributes)
const attributes = (format, result) => format === 'plain' ? result : result.data.attributes
const expectedTransforms = {
  transformedAt: '2024-03-01T00:01:00.987Z',
  producedAt: '2026-09-08T01:02:03Z',
  computedDay: '2024-02-29',
  computedTime: '23:59:59.98',
  computedEpoch: 1709251199987
}

describe(`Shared temporal conformance (${storageMode.mode})`, () => {
  let fixture
  let events
  let columns
  let rowQuery
  let serializationCalls = []
  let serializationError
  before(async () => {
    fixture = await createConformanceFixture({
      storage: storageMode.mode,
      createApi: createTemporalBoundaryApi,
      apiOptions: {
        transforms: true,
        onSerialize: (value, details) => {
          if (serializationError) throw serializationError
          serializationCalls.push({ value, ...details })
        }
      },
      tables: { events: 'temporal_events', people: 'temporal_people' }
    })
    assert.equal(fixture.storage, storageMode.mode)
    events = fixture.api.resources.events
    const descriptor = events.vars.schemaInfo.descriptor
    columns = descriptor
      ? Object.fromEntries(Object.entries(descriptor.fields).map(([field, info]) => [field, info.slot]))
      : {
          occurredAt: 'occurred_at',
          day: 'day',
          atTime: 'at_time',
          observedAtMs: 'observed_at_ms',
          observedAtSeconds: 'observed_at_seconds',
          serializedAt: 'serialized_at',
          transformedAt: 'transformed_at',
          defaultOccurredAt: 'default_occurred_at',
          defaultTime: 'default_time'
        }
    rowQuery = id => descriptor
      ? fixture.knex('any_records').where({ tenant_id: descriptor.tenant, resource: 'events', logical_id: id })
      : fixture.knex('temporal_events').where({ id })
  })
  beforeEach(async () => {
    serializationCalls = []
    serializationError = undefined
    await fixture.reset()
  })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    it(`compares equivalent time spellings using the same stored value (${format})`, async () => {
      for (const atTime of ['00:00', '00:00:00', '00:00:00.000']) {
        await fixture.seed('events', { name: 'Midnight', atTime })
      }
      for (const atTime of ['00:00', '00:00:00', '00:00:00.000']) {
        const result = await events.query({ format, queryParams: { filters: { atTime }, sort: ['atTime'], page: { number: 1, size: 3 } } })
        assert.deepEqual(result.data.map(row => row.id), ['1', '2', '3'])
        assert.equal(result.meta.pagination.total, 3)
        for (const row of result.data) assert.equal((format === 'plain' ? row : row.attributes).atTime, '00:00:00.000')
      }
    })

    it(`handles precision beyond the native SQL time limit explicitly (${format})`, async () => {
      const defaultTime = '12:34:56.1234567'
      const params = { format, inputRecord: input(format, { name: 'Fine time', defaultTime }) }
      if (databaseClient !== 'better-sqlite3' && fixture.storage === 'knex') {
        for (const returning of ['none', 'minimal', 'full']) {
          await assert.rejects(events.post({ ...params, returning }), error => {
            assert.equal(error.code, 'REST_API_VALIDATION')
            assert.equal(error.details.violations[0].rule, 'storage_precision')
            return true
          })
          assert.equal(await fixture.count('events'), 0)
        }
      } else {
        const created = await events.post(params)
        assert.equal(attributes(format, created).defaultTime, defaultTime)
        const found = await events.query({ format, queryParams: { filters: { defaultTime } } })
        assert.equal(found.data.length, 1)
        assert.equal((format === 'plain' ? found.data[0] : found.data[0].attributes).defaultTime, defaultTime)
      }
    })

    it(`traverses sparse temporal projections and their null boundary (${format})`, async () => {
      const values = ['2024-02-29T23:59:59.001Z', '2024-02-29T23:59:59.002Z', null]
      for (const occurredAt of values) await fixture.seed('events', { name: 'Projection', occurredAt })
      const page = cursor => events.query({ format, queryParams: { fields: { events: 'projectedAt' }, sort: ['projectedAt'], page: { size: 1, ...cursor } } })
      const seen = []
      let after
      for (let index = 0; index < 3; index++) {
        const result = await page(after ? { after } : {})
        assert.equal(result.data.length, 1)
        seen.push(result.data[0].id)
        const actual = format === 'plain' ? result.data[0] : result.data[0].attributes
        assert.equal(actual.projectedAt, values[index])
        assert.equal(actual.occurredAt, undefined)
        after = result.meta.pagination.cursor?.next
      }
      assert.deepEqual(seen, ['1', '2', '3'])
      assert.equal(after, undefined)
      const previous = await page({ before: createCursor({ projectedAt: null, id: '3' }, ['projectedAt', 'id']) })
      assert.deepEqual(previous.data.map(row => row.id), ['2'])
    })

    for (const [projection, field, values] of [
      ['projectedDay', 'day', ['2024-02-28', '2024-02-28', '2024-02-29', null]],
      ['projectedTime', 'atTime', ['00:00:00.001', '00:00:00.001', '00:00:00.002', null]],
      ['projectedSerializedAt', 'serializedAt', ['2024-02-29T23:59:59.123001Z', '2024-02-29T23:59:59.123001Z', '2024-02-29T23:59:59.123002Z', null]]
    ]) {
      it(`traverses ${projection} ties and nulls in both directions (${format})`, async () => {
        for (const value of values) await fixture.seed('events', { name: projection, [field]: value })
        const page = cursor => events.query({ format, queryParams: { fields: { events: projection }, sort: [projection], page: { size: 1, ...cursor } } })
        serializationCalls = []
        const seen = []
        let after
        for (let index = 0; index < values.length; index++) {
          const result = await page(after ? { after } : {})
          assert.equal(result.data.length, 1)
          const row = result.data[0]
          seen.push(row.id)
          assert.equal((format === 'plain' ? row : row.attributes)[projection], values[index])
          after = result.meta.pagination.cursor?.next
        }
        assert.deepEqual(seen, ['1', '2', '3', '4'])
        assert.equal(after, undefined)
        const reversed = []
        let before = createCursor({ id: '4', [projection]: null }, [projection, 'id'])
        for (let index = 0; index < 3; index++) {
          const result = await page({ before })
          assert.equal(result.data.length, 1)
          reversed.unshift(result.data[0].id)
          before = result.meta.pagination.cursor?.next
        }
        assert.deepEqual(reversed, ['1', '2', '3'])
        assert.equal(before, undefined)
        if (projection === 'projectedSerializedAt') {
          assert.equal(serializationCalls.length, 0, 'cursor comparisons bind the stored projection value directly')
        }
      })
    }

    for (const method of ['post', 'put', 'patch']) {
      it(`${method} preserves temporal values and transformations for all returns (${format})`, async () => {
        for (const returning of ['none', 'minimal', 'full']) {
          const created = method === 'post' ? null : await fixture.seed('events', { name: 'Before' })
          const values = {
            name: `${method} ${returning}`,
            occurredAt: '2024-03-01T07:59:59.987000+08:00',
            day: '2024-02-29',
            atTime: '23:59:59.987',
            observedAtMs: '1709251199987',
            observedAtSeconds: '1709251199',
            transformedAt: '2024-02-29T23:59:59.987Z'
          }
          const result = await events[method]({
            ...(created ? { id: created.id } : {}), format, returning, inputRecord: input(format, values)
          })
          const records = await events.query({ format: 'jsonapi', queryParams: { page: { size: 3 } } })
          const id = created?.id || records.data.find(row => row.attributes.name === values.name)?.id
          assert.equal(typeof id, 'string')
          if (returning === 'none') assert.equal(result, undefined)
          else if (returning === 'minimal') {
            assert.deepEqual(result, format === 'plain' ? { type: 'events', id } : { data: { type: 'events', id } })
          }
          const fetched = await events.get({ id, format })
          for (const response of returning === 'full' ? [result, fetched] : [fetched]) {
            const actual = attributes(format, response)
            for (const [field, value] of Object.entries({
              ...values,
              occurredAt: '2024-02-29T23:59:59.987Z',
              observedAtMs: 1709251199987,
              observedAtSeconds: 1709251199,
              ...expectedTransforms
            })) assert.equal(actual[field], value, field)
            assert.doesNotThrow(() => JSON.stringify(response))
          }
          const stored = await rowQuery(id).first()
          const storedValue = stored[columns.transformedAt]
          assert.equal(storedValue instanceof Date ? storedValue.getTime() : storedValue, 1709251259987)
        }
      })
    }

    for (const [field, value, expected] of [
      ['occurredAt', '2026-01-01T00:30:00+01:00', '2025-12-31T23:30:00.000Z'],
      ['occurredAt', '2025-12-31T23:30:00-01:00', '2026-01-01T00:30:00.000Z'],
      ['occurredAt', '2024-02-29T23:59:59.100Z', '2024-02-29T23:59:59.100Z'],
      ['serializedAt', '2024-02-29T23:59:59.100000Z', '2024-02-29T23:59:59.100Z'],
      ['defaultOccurredAt', '2024-02-29T23:59:59.987Z', '2024-02-29T23:59:59.987Z'],
      ['defaultTime', '23:59:59.123456', '23:59:59.123456'],
      ['defaultTime', '00:00:00.100000', '00:00:00.1'],
      ['occurredAt', '0000-02-29T12:34:56Z', '0000-02-29T12:34:56.000Z'],
      ['day', '0099-12-31', '0099-12-31'],
      ['day', '0000-02-29', '0000-02-29'],
      ['day', '2000-02-29', '2000-02-29'],
      ['atTime', '00:00', '00:00:00.000'],
      ['atTime', '23:59:59.001', '23:59:59.001'],
      ['observedAtMs', 0, 0],
      ['observedAtMs', '-1', -1],
      ['observedAtMs', '8640000000000000', 8640000000000000],
      ['observedAtSeconds', '-8640000000000', -8640000000000]
    ]) {
      const unsupported = databaseClient === 'mysql2' && (
        (field === 'occurredAt' || (field === 'day' && storageMode.mode === 'knex')) && Number(String(value).slice(0, 4)) < 1000
      )
      it(`${unsupported ? 'rejects unsupported' : 'round-trips and filters'} ${field}=${value} (${format})`, async () => {
        if (unsupported) {
          for (const returning of ['none', 'minimal', 'full']) {
            await assert.rejects(events.post({ format, returning, inputRecord: input(format, { name: 'Range', [field]: value }) }), error => {
              assert.equal(error.code, 'REST_API_VALIDATION')
              assert.equal(error.details.violations[0].rule, 'storage_range')
              return true
            })
            assert.equal(await fixture.count('events'), 0)
          }
          return
        }
        const created = await events.post({ format, inputRecord: input(format, { name: 'Value', [field]: value }) })
        const id = format === 'plain' ? created.id : created.data.id
        assert.equal(attributes(format, created)[field], expected)
        const result = await events.query({ format, queryParams: { filters: { [field]: value } } })
        assert.deepEqual(result.data.map(record => record.id), [id])
        assert.equal(format === 'plain' ? result.data[0][field] : result.data[0].attributes[field], expected)
        await events.patch({ id, format, inputRecord: input(format, { [field]: null }) })
        assert.equal(attributes(format, await events.get({ id, format }))[field], null)
        assert.equal((await rowQuery(id).first())[columns[field]], null)
      })
    }

    it(`rejects invalid temporal inputs before creating or updating rows (${format})`, async () => {
      const created = await fixture.seed('events', { name: 'Keep', day: '2024-02-29' })
      for (const [field, value] of [
        ['day', '1900-02-29'], ['day', '2024-04-31'], ['day', new Date('2024-02-29T00:00:00Z')],
        ['occurredAt', '2024-02-29 00:00:00'], ['occurredAt', '2024-02-29T24:00:00Z'],
        ['occurredAt', '2024-02-29T00:00:00.123456Z'], ['occurredAt', false],
        ['occurredAt', '0000-01-01T00:00:00+01:00'], ['occurredAt', '9999-12-31T23:59:59-01:00'],
        ['atTime', '09:30Z'], ['atTime', '12:30:00.1234'], ['atTime', 0],
        ['observedAtMs', 1.25], ['observedAtMs', 8640000000000001], ['observedAtMs', '01'],
        ['observedAtSeconds', true], ['observedAtSeconds', '8640000000001']
      ]) {
        for (const method of ['post', 'put', 'patch']) {
          await assert.rejects(events[method]({
            ...(method === 'post' ? {} : { id: created.id }),
            format,
            inputRecord: input(format, { name: 'Rejected', [field]: value })
          }), { code: 'REST_API_VALIDATION' }, `${method} ${field}=${String(value)}`)
          assert.equal(await fixture.count('events'), 1)
          const kept = await events.get({ id: created.id, format: 'jsonapi' })
          assert.equal(kept.data.attributes.name, 'Keep')
          assert.equal(kept.data.attributes.day, '2024-02-29')
        }
      }
    })

    it(`rejects unrepresentable UTC dates even when the caller requests no record (${format})`, async () => {
      for (const returning of ['none', 'minimal']) {
        for (const occurredAt of ['0000-01-01T00:00:00+01:00', '9999-12-31T23:59:59-01:00']) {
          await assert.rejects(events.post({
            format, returning, inputRecord: input(format, { name: 'Rejected', occurredAt })
          }), { code: 'REST_API_VALIDATION' })
          assert.equal(await fixture.count('events'), 0)
        }
      }
    })

    it(`normalizes getters and computed fields in sparse queries and reverse includes (${format})`, async () => {
      const person = await fixture.seed('people', { name: 'Person' })
      const event = await fixture.seed('events', { name: 'Event', transformedAt: '2024-02-29T23:59:59.987Z' }, {
        person: { data: { type: 'people', id: person.id } }
      })
      const fields = Object.keys(expectedTransforms).join(',')
      const query = await events.query({ format, queryParams: { fields: { events: fields } } })
      assert.deepEqual(format === 'plain'
        ? Object.fromEntries(Object.entries(query.data[0]).filter(([key]) => key !== 'id' && key !== 'person'))
        : query.data[0].attributes, expectedTransforms)
      const included = await fixture.api.resources.people.get({
        id: person.id, format, queryParams: { include: ['events'], fields: { events: fields } }
      })
      const child = format === 'plain' ? included.events[0] : included.included.find(entry => entry.id === event.id && entry.type === 'events')
      for (const [field, value] of Object.entries(expectedTransforms)) {
        assert.equal(format === 'plain' ? child[field] : child.attributes[field], value)
      }
      const related = await fixture.api.resources.people.getRelated({
        id: person.id, relationshipName: 'events', format, queryParams: { fields: { events: fields } }
      })
      assert.equal(format === 'plain' ? related.data[0].transformedAt : related.data[0].attributes.transformedAt, expectedTransforms.transformedAt)
    })

    for (const field of ['occurredAt', 'day', 'atTime', 'observedAtMs', 'observedAtSeconds', 'serializedAt']) {
      it(`traverses ${field} cursors forward and backward without losing precision (${format})`, async () => {
        const values = {
          occurredAt: ['2024-02-29T23:59:59.001Z', '2024-02-29T23:59:59.002Z', '2024-03-01T00:00:00.003Z'],
          day: ['2024-02-28', '2024-02-29', '2024-03-01'],
          atTime: ['00:00:00.001', '00:00:00.002', '00:00:00.003'],
          observedAtMs: [-1, 0, 1],
          observedAtSeconds: [-1, 0, 1],
          serializedAt: ['2024-02-29T23:59:59.123001Z', '2024-02-29T23:59:59.123002Z', '2024-03-01T00:00:00.123003Z']
        }[field]
        for (const [index, value] of values.entries()) await fixture.seed('events', { name: `Row ${index}`, [field]: value })
        const page = cursor => events.query({ format, queryParams: { sort: [field], page: { size: 1, ...cursor } } })
        const first = await page({})
        const second = await page({ after: first.meta.pagination.cursor.next })
        const third = await page({ after: second.meta.pagination.cursor.next })
        assert.deepEqual([first, second, third].flatMap(result => result.data.map(record => record.id)), ['1', '2', '3'])
        const previous = await page({ before: second.meta.pagination.cursor.next })
        assert.deepEqual(previous.data.map(record => record.id), ['1'])
        assert.equal(format === 'plain' ? previous.data[0][field] : previous.data[0].attributes[field], values[0])
      })
    }

    it(`uses the custom temporal serializer for writes and scalar/array filters (${format})`, async () => {
      const value = '2024-02-29T23:59:59.123456Z'
      const result = await events.post({ format, inputRecord: input(format, { name: 'Serialized', serializedAt: value }) })
      const id = format === 'plain' ? result.id : result.data.id
      assert.equal(attributes(format, result).serializedAt, value)
      const expression = databaseClient === 'pg'
        ? fixture.knex.raw("to_char(?? AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as value", [columns.serializedAt])
        : fixture.knex.raw('cast(?? as char) as value', [columns.serializedAt])
      assert.equal((await rowQuery(id).select(expression).first()).value, '2024-02-29 23:59:59.123456')
      for (const filters of [{ serializedAt: value }, { serializedIn: [value] }]) {
        serializationCalls = []
        const queried = await events.query({ format, queryParams: { filters } })
        assert.deepEqual(queried.data.map(record => record.id), [id])
        assert.equal(serializationCalls.length, 1)
        assert.equal(serializationCalls[0].value, value)
        assert.equal(serializationCalls[0].operation, 'filter')
        assert.equal(serializationCalls[0].fieldName, 'serializedAt')
        assert.equal(serializationCalls[0].columnName, columns.serializedAt)
      }
    })

    it(`serializes temporal array filters using their stored field types (${format})`, async () => {
      const values = { occurredAt: '2024-02-29T23:59:59.987Z', day: '2024-02-29', atTime: '00:00' }
      const created = await fixture.seed('events', { name: 'Arrays', ...values })
      for (const [filter, field] of [['occurredIn', 'occurredAt'], ['daysIn', 'day'], ['timesIn', 'atTime']]) {
        const result = await events.query({ format, queryParams: { filters: { [filter]: [values[field]] } } })
        assert.deepEqual(result.data.map(row => row.id), [created.id], filter)
      }
    })

    it(`passes write context to serializers and rolls back serialization failures (${format})`, async () => {
      const value = '2024-02-29T23:59:59.123456Z'
      let id
      for (const method of ['post', 'put', 'patch']) {
        serializationCalls = []
        const result = await events[method]({
          ...(id ? { id } : {}),
          format,
          inputRecord: input(format, { name: method, serializedAt: value })
        })
        id = format === 'plain' ? result.id : result.data.id
        assert.equal(attributes(format, result).serializedAt, value)
        assert.equal(serializationCalls.length, 1)
        const call = serializationCalls[0]
        assert.equal(call.value, value)
        assert.equal(call.operation, method)
        assert.equal(call.context.scopeName, 'events')
        assert.equal(call.context.method, method)
        assert.equal(call.columnName, columns.serializedAt)
        assert.equal(call.definition.type, 'dateTime')
        assert.equal(call.schemaInfo, events.vars.schemaInfo)
      }
      serializationError = new Error('Temporal serializer failed')
      for (const method of ['post', 'put', 'patch']) {
        await assert.rejects(events[method]({
          ...(method === 'post' ? {} : { id }),
          format,
          inputRecord: input(format, { name: 'Rejected', serializedAt: value })
        }), /Temporal serializer failed/)
        assert.equal(await fixture.count('events'), 1)
        assert.equal(attributes(format, await events.get({ id, format })).name, 'patch')
      }
    })
  }

  if (storageMode.mode === 'anyapi') {
    it('rejects persisted calendar/time metadata that needs slot migration', async () => {
      const registry = fixture.api.anyapi.registry
      const descriptor = events.vars.schemaInfo.descriptor
      const resource = await fixture.knex('any_resource_configs').where({ tenant_id: descriptor.tenant, resource: 'events' }).first()
      for (const field of ['day', 'atTime']) {
        const query = () => fixture.knex('any_field_configs').where({ resource_config_id: resource.id, field_name: field })
        const original = await query().first()
        try {
          await query().update({ slot_type: 'date', slot_column: 'date_5', slot_index: 5 })
          await assert.rejects(registry.getDescriptor(descriptor.tenant, 'events', { bypassCache: true }), /temporal storage migration required/)
        } finally {
          await query().update({ slot_type: original.slot_type, slot_column: original.slot_column, slot_index: original.slot_index })
          registry.invalidateDescriptor(descriptor.tenant, 'events')
        }
        const restored = await registry.getDescriptor(descriptor.tenant, 'events')
        assert.equal(restored.fields[field].slotType, 'string')
      }
    })

    if (databaseClient !== 'better-sqlite3') {
      it('rejects canonical timestamp columns that would discard fractional seconds', async () => {
        try {
          await fixture.knex.schema.alterTable('any_records', table => { table.dateTime('date_5', { precision: 0 }).alter() })
          await assert.rejects(ensureAnyApiSchema(fixture.knex), /temporal storage migration required/)
        } finally {
          await fixture.knex.schema.alterTable('any_records', table => { table.dateTime('date_5', { precision: 6 }).alter() })
        }
        await ensureAnyApiSchema(fixture.knex)
      })
    }
  }

  for (const [field, raw, expected] of [
    ['occurredAt', '2024-02-29 23:59:59.123456', '2024-02-29T23:59:59.123456Z'],
    ['occurredAt', '2024-03-01T07:59:59.123456+08:00', '2024-02-29T23:59:59.123456Z'],
    ['occurredAt', -1, '1969-12-31T23:59:59.999Z'],
    ['day', '0000-02-29', '0000-02-29'],
    ['atTime', '12:34:56.987654', '12:34:56.987'],
    ['observedAtMs', '-1', -1]
  ]) {
    it(`normalizes a stored ${field} value ${raw} through the public read boundary`, async () => {
      const event = await fixture.seed('events', { name: 'Driver value' })
      const rejected = databaseClient !== 'better-sqlite3' && (
        (field === 'occurredAt' && raw === -1) || (field === 'day' && fixture.storage === 'knex')
      )
      if (rejected) {
        await assert.rejects(rowQuery(event.id).update({ [columns[field]]: raw }), {
          code: databaseClient === 'pg' ? (field === 'day' ? '22008' : '22007') : 'ER_TRUNCATED_WRONG_VALUE'
        })
        assert.equal(attributes('jsonapi', await events.get({ id: event.id }))[field], null)
        return
      }
      const stored = databaseClient === 'pg' && field === 'occurredAt' && String(raw).includes(' ')
        ? `${raw}+00`
        : raw
      await rowQuery(event.id).update({ [columns[field]]: stored })
      const publicValue = ['pg', 'mysql2'].includes(databaseClient) && fixture.storage === 'knex' && field === 'atTime'
        ? '12:34:56.988'
        : expected
      for (const format of ['jsonapi', 'plain']) {
        assert.equal(attributes(format, await events.get({ id: event.id, format }))[field], publicValue)
      }
    })
  }

  it('rejects corrupt stored temporal values with field-specific typed errors', async () => {
    const event = await fixture.seed('events', { name: 'Corrupt' })
    for (const [field, raw] of [['day', '2024-02-30'], ['occurredAt', 'not-a-date'], ['atTime', '25:00'], ['observedAtMs', 'unsafe']]) {
      const rejected = databaseClient !== 'better-sqlite3' && (
        field === 'occurredAt' || field === 'observedAtMs' ||
        (fixture.storage === 'knex' && (field === 'day' || (field === 'atTime' && databaseClient === 'pg')))
      )
      if (rejected) {
        const code = databaseClient === 'pg'
          ? (field === 'observedAtMs' ? '22P02' : field === 'occurredAt' ? '22007' : '22008')
          : (field === 'observedAtMs' ? (fixture.storage === 'anyapi' ? 'WARN_DATA_TRUNCATED' : 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') : 'ER_TRUNCATED_WRONG_VALUE')
        await assert.rejects(rowQuery(event.id).update({ [columns[field]]: raw }), { code })
        assert.equal(attributes('jsonapi', await events.get({ id: event.id }))[field], null)
        continue
      }
      await rowQuery(event.id).update({ [columns[field]]: raw })
      for (const format of ['jsonapi', 'plain']) {
        await assert.rejects(events.get({ id: event.id, format }), error => {
          assert.equal(error.code, 'REST_API_TEMPORAL_DATA_INVALID')
          assert.equal(error.details.field, field)
          assert.equal(error.details.resourceType, 'events')
          return true
        })
      }
      await rowQuery(event.id).update({ [columns[field]]: null })
    }
  })
})

for (const strategy of ['standard', 'window']) {
  describe(`Temporal ${strategy} includes (${storageMode.mode})`, () => {
    let fixture
    const values = {
      day: '2024-02-29', atTime: '23:59:59.001', occurredAt: '2024-02-29T23:59:59.987Z', serializedAt: '2024-02-29T23:59:59.123456Z'
    }
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createTemporalBoundaryApi,
        apiOptions: { collectionInclude: { strategy, limit: 2, orderBy: ['serializedAt'] } },
        tables: { events: 'temporal_events', people: 'temporal_people' }
      })
    })
    beforeEach(async () => { await fixture.reset() })
    after(async () => { await fixture?.close() })
    for (const format of ['jsonapi', 'plain']) {
      for (const sparse of [false, true]) {
        it(`preserves temporal values through compound reads (${format}, sparse=${sparse})`, async () => {
          const person = await fixture.seed('people', { name: 'Parent' })
          await fixture.seed('events', { name: 'Precise', ...values }, { person: { data: { type: 'people', id: person.id } } })
          const queryParams = { include: ['events'], ...(sparse ? { fields: { events: Object.keys(values).join(',') } } : {}) }
          const results = [
            await fixture.api.resources.people.get({ id: person.id, format, queryParams }),
            await fixture.api.resources.people.query({ format, queryParams })
          ]
          for (const result of results) {
            const event = format === 'plain'
              ? (result.data ? result.data[0] : result).events[0]
              : result.included.find(row => row.type === 'events').attributes
            for (const [field, value] of Object.entries(values)) assert.equal(event[field], value, field)
          }
          const related = await fixture.api.resources.people.getRelated({ id: person.id, relationshipName: 'events', format })
          const event = format === 'plain' ? related.data[0] : related.data[0].attributes
          for (const [field, value] of Object.entries(values)) assert.equal(event[field], value, field)
        })
      }
    }
  })
}

describe(`Temporal write response completion (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createTemporalBoundaryApi,
      tables: { events: 'temporal_events', people: 'temporal_people' }
    })
    await fixture.api.customize({
      hooks: Object.fromEntries(['finish', 'finishPost', 'finishPut', 'finishPatch', 'afterCommit'].map(name => [name, {
        functionName: `probe-temporal-${name}`,
        handler: async ({ context }) => {
          if (context.writeBoundaryHook !== name || !['post', 'put', 'patch'].includes(context.method)) return
          assert.equal(context.transaction.isCompleted(), name === 'afterCommit')
          const rows = context.simplified
            ? [context.responseRecord, context.responseRecord.person]
            : [context.responseRecord.data, ...context.responseRecord.included].map(row => row.attributes)
          for (const row of rows) row.producedAt = context.writeBoundaryValue
        }
      }]))
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    for (const method of ['post', 'put', 'patch']) {
      for (const phase of ['finish', `finish${method[0].toUpperCase()}${method.slice(1)}`, 'afterCommit']) {
        for (const invalid of [false, true]) {
          it(`${method} handles ${invalid ? 'invalid' : 'native'} dates at ${phase} in primary and included output (${format})`, async () => {
            const person = await fixture.seed('people', { name: 'Person' })
            const original = method === 'post' ? undefined : await fixture.seed('events', { name: 'Original' })
            const inputRecord = format === 'plain'
              ? { name: 'Changed', person: person.id }
              : createJsonApiDocument('events', { name: 'Changed' }, { person: { data: { type: 'people', id: person.id } } })
            const context = {
              writeBoundaryHook: phase,
              writeBoundaryValue: invalid ? new Date(NaN) : new Date('2026-09-09T12:34:56.789Z')
            }
            const write = fixture.api.resources.events[method]({
              ...(original ? { id: original.id } : {}),
              inputRecord,
              format,
              returning: 'full',
              queryParams: { include: ['person'] }
            }, context)
            if (invalid && phase !== 'afterCommit') {
              await assert.rejects(write, { code: 'REST_API_TEMPORAL_DATA_INVALID' })
              assert.equal(context.transactionCommitted, false)
              assert.equal(await fixture.count('events'), original ? 1 : 0)
              if (original) assert.equal((await fixture.api.resources.events.get({ id: original.id, format: 'plain' })).name, 'Original')
            } else {
              const result = await write
              const rows = format === 'plain' ? [result, result.person] : [result.data, ...result.included].map(row => row.attributes)
              for (const row of rows) {
                assert.equal(typeof row.producedAt, 'string')
                assert.equal(row.producedAt, phase === 'afterCommit' ? expectedTransforms.producedAt : '2026-09-09T12:34:56Z')
              }
              assert.equal(context.transactionCommitted, true)
              assert.equal(await fixture.count('events'), 1)
            }
          })
        }
      }
    }
  }
})

describe('Temporal driver and extension values', () => {
  for (const [type, value, precision, expected] of [
    ['dateTime', new Date('2024-02-29T23:59:59.987Z'), 0, '2024-02-29T23:59:59Z'],
    ['dateTime', '2024-02-29T23:59:59.123456-00:30', 6, '2024-03-01T00:29:59.123456Z'],
    ['dateTime', '2024-03-01 07:59:59.123456+08', 6, '2024-02-29T23:59:59.123456Z'],
    ['dateTime', '0001-02-29 20:18:20+07:43:24 BC', 3, '0000-02-29T12:34:56.000Z'],
    ['date', '0001-02-29 BC', undefined, '0000-02-29'],
    ['dateTime', 0n, 3, '1970-01-01T00:00:00.000Z'],
    ['date', new Date('2024-03-01T07:59:59+08:00'), undefined, '2024-02-29'],
    ['time', new Date('2024-02-29T23:59:59.987Z'), 1, '23:59:59.9'],
    ['epochMilliseconds', 8640000000000000n, undefined, 8640000000000000],
    ['epochSeconds', '-8640000000000', undefined, -8640000000000]
  ]) {
    it(`normalizes ${type} ${String(value)} with precision ${precision}`, () => {
      const result = normalizeAttributes({ value }, { value: { type, ...(precision === undefined ? {} : { temporalPrecision: precision }) } })
      assert.deepEqual(result, { value: expected })
    })
  }
})
