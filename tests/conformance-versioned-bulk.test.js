import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

for (const format of ['jsonapi', 'plain']) {
  describe(`Versioned bulk writes ${format} (${storageMode.mode})`, () => {
    let fixture, items, first, second
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: {
          bulk: true,
          fields: { revision: { type: 'string', required: true } },
          resourceOptions: { versionField: 'revision' }
        }
      })
      items = fixture.api.resources.items
    })
    beforeEach(async () => {
      await fixture.reset()
      first = await fixture.seed('items', { name: 'First' })
      second = await fixture.seed('items', { name: 'Second' })
    })
    after(async () => { await fixture?.close() })
    const read = id => items.get({ id, format: 'plain' })
    const paramsFor = method => method === 'bulkDelete'
      ? { ids: [first.id, second.id] }
      : {
          operations: [first, second].map(record => ({
            id: record.id,
            data: format === 'plain' ? { name: 'Changed' } : { type: 'items', attributes: { name: 'Changed' } }
          }))
        }

    for (const method of ['bulkPatch', 'bulkDelete']) {
      for (const atomic of [true, false]) {
        it(`${method} ${atomic ? 'rolls back the batch' : 'retains only successful children'} on a stale condition`, async () => {
          const initial = await read(first.id)
          const params = { ...paramsFor(method), format, atomic, expectedVersions: [initial.revision, 'stale'] }
          if (atomic) {
            await assert.rejects(items[method](params), error => error.code === 'REST_API_VERSION_CONFLICT' && error.transactionOutcome === 'rolledBack')
            assert.deepEqual(await read(first.id), initial)
          } else {
            const result = await items[method](params)
            assert.equal(result.meta.succeeded, 1)
            assert.equal(result.meta.failed, 1)
            assert.equal(result.errors[0].index, 1)
            assert.equal(result.errors[0].error.code, 'REST_API_VERSION_CONFLICT')
            assert.equal(result.errors[0].error.transactionOutcome, 'rolledBack')
            if (method === 'bulkPatch') {
              const stored = await read(first.id)
              assert.equal(stored.name, 'Changed')
              assert.notEqual(stored.revision, initial.revision)
            } else assert.equal(await fixture.count('items'), 1)
          }
          assert.equal((await read(second.id)).name, 'Second')
        })
      }

      it(`${method} accepts matching conditions and leaves unconditional calls available`, async () => {
        const records = await Promise.all([read(first.id), read(second.id)])
        const result = await items[method]({ ...paramsFor(method), format, expectedVersions: records.map(record => record.revision) })
        assert.equal(result.meta.succeeded, 2)
        if (method === 'bulkPatch') {
          assert.notEqual((await read(first.id)).revision, records[0].revision)
          assert.equal((await items[method]({ ...paramsFor(method), format })).meta.succeeded, 2)
        } else assert.equal(await fixture.count('items'), 0)
      })

      it(`${method} rejects malformed condition arrays before any non-atomic work`, async () => {
        const initial = await read(first.id)
        for (const expectedVersions of [null, 'token', [], [initial.revision], [initial.revision, null], [initial.revision, ''], [initial.revision, 'x'.repeat(129)], new Array(2)]) {
          await assert.rejects(items[method]({ ...paramsFor(method), format, atomic: false, expectedVersions }), error => error.code === 'REST_API_VALIDATION')
          assert.deepEqual(await read(first.id), initial)
          assert.equal(await fixture.count('items'), 2)
        }
      })

      it(`${method} keeps matching writes inside the caller transaction`, async () => {
        const records = await Promise.all([read(first.id), read(second.id)])
        const stop = new Error('Caller rollback')
        await assert.rejects(fixture.api.transaction(async transaction => {
          const result = await items[method]({ ...paramsFor(method), format, transaction, expectedVersions: records.map(record => record.revision) })
          assert.equal(result.meta.succeeded, 2)
          assert.equal(transaction.isCompleted(), false)
          throw stop
        }), error => error === stop || error.cause === stop)
        assert.deepEqual(await read(first.id), records[0])
        assert.deepEqual(await read(second.id), records[1])
      })

      it(`${method} cannot reuse one revision for a repeated target in an atomic batch`, async () => {
        const initial = await read(first.id)
        const params = paramsFor(method)
        if (method === 'bulkPatch') params.operations[1] = params.operations[0]
        else params.ids[1] = params.ids[0]
        await assert.rejects(items[method]({ ...params, format, expectedVersions: [initial.revision, initial.revision] }), error =>
          method === 'bulkPatch' ? error.code === 'REST_API_VERSION_CONFLICT' : error.subtype === 'not_found')
        assert.deepEqual(await read(first.id), initial)
        assert.equal(await fixture.count('items'), 2)
      })
    }

    it('rejects singular bulk conditions and conditional bulk creation', async () => {
      for (const method of ['bulkPatch', 'bulkDelete']) {
        await assert.rejects(items[method]({ ...paramsFor(method), format, expectedVersion: 'token' }), error => error.code === 'REST_API_VALIDATION')
      }
      const inputRecords = [format === 'plain' ? { name: 'Third' } : { type: 'items', attributes: { name: 'Third' } }]
      for (const condition of [{ expectedVersion: 'token' }, { expectedVersions: ['token'] }]) {
        await assert.rejects(items.bulkPost({ inputRecords, format, ...condition }), error => error.code === 'REST_API_VALIDATION')
      }
      assert.equal(await fixture.count('items'), 2)
    })
  })
}

describe(`Bulk conditions on unversioned resources (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables: { items: 'schema_enrichment_items' }, apiOptions: { bulk: true } })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('rejects conditions before starting non-atomic updates or deletes', async () => {
    const first = await fixture.seed('items', { name: 'First' })
    const items = fixture.api.resources.items
    for (const [method, params] of [
      ['bulkPatch', { operations: [{ id: first.id, data: { name: 'Changed' } }] }],
      ['bulkDelete', { ids: [first.id] }]
    ]) {
      await assert.rejects(items[method]({ ...params, format: 'plain', atomic: false, expectedVersions: ['token'] }), error => error.code === 'REST_API_VALIDATION')
      assert.equal((await items.get({ id: first.id, format: 'plain' })).name, 'First')
    }
  })
})

for (const connector of ['express', 'fastify']) {
  describe(`HTTP bulk version conditions ${connector} (${storageMode.mode})`, () => {
    let fixture, app, first, second
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: { app, connector, bulk: true, connectorOptions: { httpValidators: true }, fields: { revision: { type: 'string', required: true } }, resourceOptions: { versionField: 'revision' } }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      first = await fixture.seed('items', { name: 'First' })
      second = await fixture.seed('items', { name: 'Second' })
    })
    after(async () => { if (connector === 'fastify') await app?.close(); await fixture?.close() })
    const send = async (method, body, atomic = true, headers = {}) => {
      const url = `/api/items/bulk?atomic=${atomic}`
      const response = connector === 'express'
        ? await request(app)[method.toLowerCase()](url).set({ 'Content-Type': 'application/vnd.api+json', ...headers }).send(body)
        : await app.inject({ method, url, headers: { 'content-type': 'application/vnd.api+json', ...headers }, payload: body })
      return { status: response.statusCode, body: connector === 'express' ? response.body : response.json() }
    }
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      it(`rejects unsupported ${method} If-Match before non-atomic bulk work`, async () => {
        const records = await Promise.all([first, second].map(record => fixture.api.resources.items.get({ id: record.id, format: 'plain' })))
        const body = method === 'POST'
          ? { data: [{ type: 'items', attributes: { name: 'Third' } }] }
          : method === 'DELETE'
            ? { ids: records.map(record => record.id), expectedVersions: records.map(record => record.revision) }
            : {
                operations: records.map(record => ({ id: record.id, data: { type: 'items', attributes: { name: 'Changed' } } })),
                expectedVersions: records.map(record => record.revision)
              }
        for (const condition of ['*', '"stale"']) {
          const result = await send(method, body, false, { 'if-match': condition })
          assert.equal(result.status, 422)
          assert.match(result.body.errors[0].detail, /If-Match is not supported for this route/)
          assert.equal(await fixture.count('items'), 2)
          for (const record of records) assert.deepEqual(await fixture.api.resources.items.get({ id: record.id, format: 'plain' }), record)
        }
      })
    }
    for (const method of ['PATCH', 'DELETE']) {
      it(`${method} transports conditions and preserves the batch on conflict`, async () => {
        const records = await Promise.all([first, second].map(record => fixture.api.resources.items.get({ id: record.id, format: 'plain' })))
        const body = method === 'DELETE'
          ? { ids: records.map(record => record.id) }
          : {
              operations: records.map(record => ({ id: record.id, data: { type: 'items', attributes: { name: 'Changed' } } }))
            }
        const failed = await send(method, { ...body, expectedVersions: [records[0].revision, 'stale'] })
        assert.equal(failed.status, 409)
        assert.equal(failed.body.errors[0].code, 'REST_API_VERSION_CONFLICT')
        for (const record of records) assert.deepEqual(await fixture.api.resources.items.get({ id: record.id, format: 'plain' }), record)
        const succeeded = await send(method, { ...body, expectedVersions: records.map(record => record.revision) })
        assert.equal(succeeded.status, 200)
        assert.equal(succeeded.body.meta.succeeded, 2)
      })
    }
    it('rejects conditional creation from the HTTP body', async () => {
      const response = await send('POST', { data: [{ type: 'items', attributes: { name: 'Third' } }], expectedVersions: ['token'] }, false)
      assert.equal(response.status, 422)
      assert.equal(await fixture.count('items'), 2)
    })
  })
}
