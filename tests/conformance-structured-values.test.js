import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { assertWriteFailure, createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

for (const type of ['object', 'array']) {
  for (const custom of [false, true]) {
    describe(`Structured ${type} values with ${custom ? 'custom' : 'built-in'} storage (${storageMode.mode})`, () => {
      let fixture, items, adapter, setterValue
      const calls = []
      const original = type === 'object' ? { nested: { value: 'before' }, empty: [], zero: 0, flag: false } : [{ nested: 'before' }, [], 0, false, null]
      const replacement = type === 'object' ? { nested: { value: 'after' }, empty: {} } : [{ nested: 'after' }, {}]
      before(async () => {
        fixture = await createConformanceFixture({
          createApi: createSchemaEnrichmentApi,
          tables: { items: 'schema_enrichment_items' },
          apiOptions: {
            projections: true,
            fields: {
              payload: {
                type,
                nullable: true,
                storage: { column: 'payload "value' },
                setter: value => setterValue === undefined ? value : setterValue,
                ...(custom
                  ? {
                      storage: { column: 'payload "value', serialize: (value, details) => { calls.push(details); return value == null ? null : JSON.stringify({ wrapped: value }) } },
                      getter: value => value == null ? null : (typeof value === 'string' ? JSON.parse(value) : value).wrapped
                    }
                  : {})
              },
              snapshot: { type: 'object', computed: true, dependencies: ['payload'], compute: ({ attributes }) => ({ value: attributes.payload }) }
            },
            resourceOptions: {
              queryFields: {
                projected: {
                  type,
                  normallyHidden: true,
                  select: ({ knex, column }) => knex.raw('??', [column('payload')]),
                  ...(custom ? { getter: value => value == null ? null : (typeof value === 'string' ? JSON.parse(value) : value).wrapped } : {})
                }
              }
            }
          }
        })
        items = fixture.api.resources.items
        adapter = fixture.api.knex.helpers.getStorageAdapter('items')
      })
      beforeEach(async () => { setterValue = undefined; await fixture.reset(); calls.length = 0 })
      after(async () => fixture?.close())

      for (const format of ['jsonapi', 'plain']) {
        it(`round-trips writes, projections and computed dependencies (${format})`, async () => {
          let id
          for (const [method, payload] of [['post', original], ['put', replacement], ['patch', type === 'object' ? {} : []], ['patch', null]]) {
            calls.length = 0
            const input = structuredClone({ payload })
            const response = await items[method]({
              ...(id ? { id } : {}),
              format,
              inputRecord: format === 'plain' ? input : createJsonApiDocument('items', input)
            })
            const attributes = format === 'plain' ? response : response.data.attributes
            id = format === 'plain' ? response.id : response.data.id
            assert.deepEqual(attributes.payload, payload)
            assert.deepEqual(attributes.snapshot, { value: payload })
            assert.deepEqual(input, { payload })
            assert.equal(calls.length, custom ? 1 : 0)
            if (custom) {
              assert.equal(calls[0].operation, method)
              assert.equal(calls[0].fieldName, 'payload')
              assert.equal(calls[0].columnName, adapter.translateColumn('payload'))
              assert.equal(calls[0].context.scopeName, 'items')
            }
            for (const readMethod of ['get', 'query']) {
              const read = await items[readMethod]({ id, format, queryParams: { fields: { items: 'payload,projected,snapshot' } } })
              const record = readMethod === 'query' ? read.data[0] : format === 'plain' ? read : read.data
              const values = format === 'plain' ? record : record.attributes
              assert.deepEqual(values.payload, payload)
              assert.deepEqual(values.projected, payload)
              assert.deepEqual(values.snapshot, { value: payload })
            }
            assert.equal(calls.length, custom ? 1 : 0)
          }
        })
      }

      if (!custom) {
        it('rejects invalid setter output before writing, including with returning none', async () => {
          const item = await fixture.seed('items', { payload: original })
          const circular = type === 'object' ? {} : []
          if (type === 'object') circular.self = circular
          else circular.push(circular)
          const invalidValues = [JSON.stringify(original), type === 'object' ? [] : {}, type === 'object' ? { value: 1n } : [1n], circular]
          for (const invalid of invalidValues) {
            setterValue = invalid
            for (const method of ['post', 'patch', 'put']) {
              await assert.rejects(items[method]({
                ...(method === 'post' ? {} : { id: item.id }),
                returning: 'none',
                inputRecord: createJsonApiDocument('items', { payload: replacement })
              }), error => {
                assertWriteFailure(error, { outcome: 'rolledBack' })
                assert.ok(error.cause.cause instanceof TypeError)
                assert.equal(error.cause.context.fieldName, 'payload')
                return true
              })
            }
            const response = await items.query({})
            assert.equal(response.data.length, 1)
            assert.deepEqual(response.data[0].attributes.payload, original)
          }
        })

        if (storageMode.isAnyApi()) {
          it('adds structured fields and reloads their JSON slot metadata', async () => {
            const item = await fixture.seed('items', { payload: original })
            await items.addKnexFields({ fields: { extra: { type, nullable: true } } })
            await items.patch({ id: item.id, inputRecord: createJsonApiDocument('items', { extra: replacement }) })
            const registry = fixture.api.anyapi.registry
            registry.invalidateDescriptor('schema_enrichment', 'items')
            const descriptor = await registry.getDescriptor('schema_enrichment', 'items')
            assert.equal(descriptor.schema.extra.type, type)
            assert.equal(descriptor.fields.extra.slotType, 'json')
            assert.match(descriptor.fields.extra.slot, /^json_[1-5]$/)
            assert.notEqual(descriptor.fields.extra.slot, descriptor.fields.payload.slot)
            const result = await items.get({ id: item.id })
            assert.deepEqual(result.data.attributes.payload, original)
            assert.deepEqual(result.data.attributes.extra, replacement)
          })
        }

        it('rejects a stored JSON value with the wrong declared shape', async () => {
          const item = await fixture.seed('items', { payload: original })
          const wrong = type === 'object' ? [] : {}
          await adapter.buildBaseQuery().where(adapter.getIdColumn(), item.id).update({ [adapter.translateColumn('payload')]: JSON.stringify(wrong) })
          await assert.rejects(items.get({ id: item.id }), /Invalid.*(object|array).*payload/)
        })
      }
    })
  }
}
