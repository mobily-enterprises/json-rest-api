import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { assertWriteFailure, createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

const tables = { items: 'schema_enrichment_items' }

async function assertInvalidSchema (apiOptions, expected) {
  let fixture
  try {
    await assert.rejects(async () => {
      fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions })
    }, expected)
  } finally { await fixture?.close() }
}

async function assertLabelReads (items, id, expected) {
  for (const format of ['jsonapi', 'plain']) {
    for (const sparse of [false, true]) {
      const queryParams = sparse ? { fields: { items: 'label' } } : {}
      const result = await items.get({ id, format, queryParams })
      const attributes = format === 'plain' ? result : result.data.attributes
      assert.equal(attributes.label, expected)
      const query = await items.query({ format, queryParams })
      assert.equal(format === 'plain' ? query.data[0].label : query.data[0].attributes.label, expected)
      if (sparse) {
        assert.deepEqual(Object.keys(attributes).sort(), format === 'plain' ? ['id', 'label'] : ['label'])
      }
    }
  }
}

function searchHooks (change, calls) {
  return {
    'searchSchema:enrich': {
      functionName: 'customize-search-contract',
      handler: ({ context }) => {
        calls.push(context)
        change(context)
      }
    }
  }
}

for (const replacement of [false, true]) {
  describe(`Computed enrichment ${replacement ? 'replacement' : 'mutation'} (${storageMode.mode})`, () => {
    let fixture, enriched
    const calls = []
    const originalCompute = () => 'Original'
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          fields: {
            summary: { type: 'string', computed: true, compute: originalCompute },
            removed: { type: 'string', computed: true, compute: () => 'Removed' }
          },
          hooks: {
            'schema:enrich': {
              functionName: 'prepare-computed-input',
              handler: ({ context }) => {
                calls.push('attributes')
                context.fields.name.getter = value => value?.toUpperCase()
              }
            },
            'searchSchema:enrich': {
              functionName: 'prepare-computed-search',
              handler: ({ context }) => {
                calls.push('search')
                context.fields = { lookup: { type: 'string', actualField: 'name', globalSearch: true } }
              }
            },
            'computedSchema:enrich': {
              functionName: 'derive-computed-output',
              handler: async ({ context }) => {
                await Promise.resolve()
                calls.push('computed')
                enriched = context
                assert.equal(typeof context.schemaStructure.name.getter, 'function')
                assert.equal(context.searchSchemaStructure.lookup.actualField, 'name')
                if (replacement) context.fields = { ...context.fields }
                delete context.fields.removed
                context.fields.summary.compute = ({ attributes }) => `Summary ${attributes.name}`
                context.fields.summary.dependencies = ['name']
                context.fields.extraComputed = { type: 'string', computed: true, compute: ({ id }) => `ID ${id}` }
              }
            }
          }
        }
      })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    it('awaits enrichment, validates output fields and keeps them separate from stored attributes', async () => {
      assert.deepEqual(calls, ['attributes', 'search', 'computed'])
      assert.equal(enriched.originalFields.summary.compute, originalCompute)
      assert.ok(enriched.originalFields.removed)
      const info = fixture.api.resources.items.vars.schemaInfo
      assert.equal(info.schemaStructure.summary, undefined)
      assert.equal(info.schemaStructure.extraComputed, undefined)
      assert.equal(info.computed.removed, undefined)
      const item = await fixture.seed('items', { name: 'Name' })
      assert.equal(item.attributes.summary, 'Summary NAME')
      assert.equal(item.attributes.extraComputed, `ID ${item.id}`)
      assert.equal(item.attributes.removed, undefined)
      for (const format of ['jsonapi', 'plain']) {
        const result = await fixture.api.resources.items.get({ id: item.id, format, queryParams: { fields: { items: 'summary,extraComputed' } } })
        const attributes = format === 'plain' ? result : result.data.attributes
        assert.equal(attributes.summary, 'Summary NAME')
        assert.equal(attributes.extraComputed, `ID ${item.id}`)
        assert.equal(attributes.name, undefined)
        assert.equal(attributes.removed, undefined)
      }
      if (fixture.storage === 'anyapi') await fixture.api.resources.items.createKnexTable()
      assert.deepEqual(calls, ['attributes', 'search', 'computed'])
    })
  })
}

for (const [name, field, definition, message] of [
  ['missing computed marker', 'invalid', { type: 'string' }, /must set computed: true/],
  ['missing type', 'invalid', { computed: true }, /must have a type/],
  ['stored field collision', 'name', { type: 'string', computed: true, compute: () => 'Invalid' }, /conflicts with an attribute field/]
]) {
  it(`rejects computed enrichment with ${name} (${storageMode.mode})`, async () => {
    await assertInvalidSchema({
      hooks: {
        'computedSchema:enrich': {
          functionName: 'invalid-computed-field',
          handler: ({ context }) => { context.fields[field] = definition }
        }
      }
    }, message)
  })
}

for (const origin of ['authored', 'hook']) {
  for (const compute of ['invalid', false, 0, null, '', {}]) {
    it(`rejects ${origin} computed callback ${JSON.stringify(compute)} (${storageMode.mode})`, async () => {
      const definition = { type: 'string', computed: true, compute }
      const apiOptions = origin === 'authored'
        ? { fields: { invalid: definition } }
        : {
            hooks: {
              'computedSchema:enrich': {
                functionName: 'invalid-computed-callback',
                handler: ({ context }) => { context.fields.invalid = definition }
              }
            }
          }
      await assertInvalidSchema(apiOptions, /invalid compute function/)
    })
  }
}

for (const replacement of [false, true]) {
  describe(`Search enrichment ${replacement ? 'replacement' : 'mutation'} (${storageMode.mode})`, () => {
    let fixture
    const calls = []
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          searchSchema: { nameMatch: { type: 'string', actualField: 'name', filterOperator: '=' } },
          hooks: searchHooks(context => {
            assert.ok(context.fields.nameMatch, 'the hook receives search aliases')
            if (replacement) context.fields = { ...context.fields }
            delete context.fields.obsolete
            context.fields.nameMatch.filterOperator = 'contains'
            context.fields.amountMatch = { type: 'string', actualField: 'amount', filterOperator: '=' }
          }, calls)
        }
      })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    it('publishes search changes without adding writable attributes or rerunning hooks', async () => {
      const info = fixture.api.resources.items.vars.schemaInfo
      assert.equal(calls.length, 1)
      assert.equal(calls[0].originalFields.nameMatch.filterOperator, '=')
      assert.ok(calls[0].originalFields.obsolete)
      assert.equal(info.searchSchemaStructure.nameMatch.filterOperator, 'contains')
      assert.equal(info.searchSchemaStructure.amountMatch.indexed, true)
      assert.equal(info.searchSchemaStructure.obsolete, undefined)
      assert.equal(info.schemaStructure.nameMatch, undefined)
      assert.equal(info.schemaStructure.amountMatch, undefined)
      assert.equal(info.schemaStructure.obsolete.type, 'string')
      const first = await fixture.seed('items', { name: 'First item', amount: 'one', obsolete: 'kept' })
      await fixture.seed('items', { name: 'Second', amount: 'two' })
      const result = await fixture.api.resources.items.query({ queryParams: { filters: { nameMatch: 'item', amountMatch: 'one' } } })
      assert.deepEqual(result.data.map(row => row.id), [first.id])
      assert.equal(result.data[0].attributes.obsolete, 'kept')
      await assert.rejects(fixture.api.resources.items.query({ queryParams: { filters: { obsolete: 'kept' } } }), RestApiValidationError)
      await assert.rejects(fixture.api.resources.items.post({ inputRecord: createJsonApiDocument('items', { nameMatch: 'not writable' }) }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' }))
      if (fixture.storage === 'anyapi') await fixture.api.resources.items.createKnexTable()
      assert.equal(calls.length, 1)
      assert.deepEqual((await fixture.api.resources.items.query({ queryParams: { filters: { nameMatch: 'item' } } })).data.map(row => row.id), [first.id])
    })
  })
}

if (storageMode.isAnyApi()) {
  for (const invalidDefinition of [false, true]) {
    describe(`Canonical failed computed ${invalidDefinition ? 'validation' : 'enrichment'}`, () => {
      let fixture
      const failure = new Error('Computed enrichment failed')
      before(async () => {
        fixture = await createConformanceFixture({
          createApi: createSchemaEnrichmentApi,
          tables,
          apiOptions: {
            label: true,
            hooks: {
              'computedSchema:enrich': {
                functionName: 'fail-computed-addition',
                handler: async ({ context }) => {
                  if (!context.schemaStructure.extra) return
                  await Promise.resolve()
                  if (invalidDefinition) context.fields.invalid = { computed: true }
                  else throw failure
                }
              }
            }
          }
        })
      })
      beforeEach(async () => fixture.reset())
      after(async () => fixture?.close())

      it('keeps the published schema and stored data unchanged', async () => {
        const items = fixture.api.resources.items
        const item = await fixture.seed('items', { name: 'Existing label' })
        const schemaInfo = items.vars.schemaInfo
        const descriptor = await fixture.api.anyapi.registry.getDescriptor('schema_enrichment', 'items')
        const records = await fixture.knex('any_records').orderBy('id')
        await assert.rejects(items.addKnexFields({ fields: { extra: { type: 'string' } } }), error => {
          if (invalidDefinition) assert.match(error.message, /must have a type/)
          else assert.equal(error, failure)
          return true
        })
        assert.equal(items.vars.schemaInfo, schemaInfo)
        assert.deepEqual(await fixture.api.anyapi.registry.getDescriptor('schema_enrichment', 'items'), descriptor)
        assert.deepEqual(await fixture.knex('any_records').orderBy('id'), records)
        await assertLabelReads(items, item.id, 'Existing label')
        const created = await fixture.seed('items', { name: 'Still writable' })
        assert.equal(created.attributes.label, 'Still writable')
      })
    })
  }

  describe('Canonical generated labels through schema recompilation', () => {
    let fixture
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { label: true } })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    it('retains labels through repeated additions, descriptor refresh and restart', async () => {
      const items = fixture.api.resources.items
      const item = await fixture.seed('items', { name: 'Kept label' })
      await assertLabelReads(items, item.id, 'Kept label')
      const fields = { extra: { type: 'string', nullable: true }, another: { type: 'string', nullable: true } }
      for (const [name, definition] of Object.entries(fields)) {
        await items.addKnexFields({ fields: { [name]: definition } })
        await assertLabelReads(items, item.id, 'Kept label')
      }
      await items.createKnexTable()
      await assertLabelReads(items, item.id, 'Kept label')
      const { canonicalFieldMap } = await fixture.api.anyapi.registry.getDescriptor('schema_enrichment', 'items')
      const restarted = await createSchemaEnrichmentApi(fixture.knex, {
        label: true, fields, resourceOptions: { canonicalFieldsMap: canonicalFieldMap }
      })
      await assertLabelReads(restarted.resources.items, item.id, 'Kept label')
      const created = await restarted.resources.items.post({ inputRecord: createJsonApiDocument('items', { name: 'New label', extra: 'Extra' }) })
      assert.equal(created.data.attributes.label, 'New label')
    })
  })

  describe('Canonical label source changes after enrichment', () => {
    let fixture
    const calls = []
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          label: true,
          hooks: searchHooks(context => {
            context.fields = {
              ...context.fields,
              labelSource: { type: 'string', actualField: context.fields.extra ? 'extra' : 'amount', globalSearch: true }
            }
          }, calls)
        }
      })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    it('rebuilds candidates from the final enriched search contract', async () => {
      const items = fixture.api.resources.items
      const item = await fixture.seed('items', { name: 'Name fallback', amount: 'Initial source' })
      await assertLabelReads(items, item.id, 'Initial source')
      await items.addKnexFields({ fields: { extra: { type: 'string', nullable: true, search: true } } })
      await assertLabelReads(items, item.id, 'Name fallback')
      const patched = await items.patch({ id: item.id, inputRecord: createJsonApiDocument('items', { extra: 'New source' }) })
      assert.equal(patched.data.attributes.label, 'New source')
      await assertLabelReads(items, item.id, 'New source')
      assert.equal(calls.length, 2, 'reads and descriptor refreshes do not recompile label candidates')
    })
  })

  for (const [name, label, fields, input, expected] of [
    ['stored', true, { label: { type: 'string' } }, { label: 'Authored label' }, 'Authored label'],
    ['computed', true, { label: { type: 'string', computed: true, dependencies: ['name'], compute: ({ attributes }) => `Authored ${attributes.name}` } }, {}, 'Authored Name'],
    ['disabled', { disable: true }, {}, {}, undefined]
  ]) {
    describe(`Canonical ${name} label after field addition`, () => {
      let fixture
      before(async () => {
        fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { label, fields } })
      })
      beforeEach(async () => fixture.reset())
      after(async () => fixture?.close())

      it('keeps the selected label behavior', async () => {
        const item = await fixture.seed('items', { name: 'Name', ...input })
        await fixture.api.resources.items.addKnexFields({ fields: { extra: { type: 'string', nullable: true } } })
        const result = await fixture.api.resources.items.get({ id: item.id })
        assert.equal(result.data.attributes.label, expected)
      })
    })
  }

  for (const [name, enrich] of [
    ['changes an existing slot pool', context => { context.fields.amount.type = 'integer' }],
    ['removes a stored field', context => { delete context.fields.obsolete }],
    ['moves an existing slot', context => { context.fields = { prefix: { type: 'string' }, ...context.fields } }]
  ]) {
    describe(`Canonical schema migration guard: ${name}`, () => {
      let fixture
      before(async () => { fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables }) })
      beforeEach(async () => fixture.reset())
      after(async () => fixture?.close())
      it('rejects registration without changing stored rows or metadata', async () => {
        const item = await fixture.seed('items', { name: 'Original', amount: '7', obsolete: 'Keep me' })
        const snapshot = async () => {
          const result = {}
          for (const table of ['any_records', 'any_links', 'any_resource_configs', 'any_field_configs', 'any_relationship_configs']) {
            result[table] = await fixture.knex(table).orderBy('id')
          }
          return result
        }
        const original = await snapshot()
        await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
          hooks: { 'schema:enrich': { functionName: 'change-existing-layout', handler: ({ context }) => enrich(context) } }
        }), /Canonical storage migration required/)
        assert.deepEqual(await snapshot(), original)
        assert.deepEqual((await fixture.api.resources.items.get({ id: item.id })).data.attributes, item.attributes)
        const restarted = await createSchemaEnrichmentApi(fixture.knex)
        assert.deepEqual((await restarted.resources.items.get({ id: item.id })).data.attributes, item.attributes)
      })

      it('allows the same schema change when there are no stored records', async () => {
        await createSchemaEnrichmentApi(fixture.knex, {
          hooks: { 'schema:enrich': { functionName: 'change-empty-layout', handler: ({ context }) => enrich(context) } }
        })
      })
    })
  }

  describe('Canonical registration with preserved explicit slots', () => {
    let fixture
    before(async () => { fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables }) })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())
    it('allows reordered declarations and an appended allocation without moving existing data', async () => {
      const item = await fixture.seed('items', { name: 'Original', amount: '7', obsolete: 'Kept' })
      const descriptor = await fixture.api.anyapi.registry.getDescriptor('schema_enrichment', 'items')
      const restarted = await createSchemaEnrichmentApi(fixture.knex, {
        hooks: {
          'schema:enrich': {
            functionName: 'prepend-field-with-explicit-slot',
            handler: ({ context }) => { context.fields = { prefix: { type: 'string', defaultTo: 'New' }, ...context.fields } }
          }
        },
        resourceOptions: { canonicalFieldsMap: { ...descriptor.canonicalFieldMap, prefix: 'string_4' } }
      })
      const read = (await restarted.resources.items.get({ id: item.id })).data.attributes
      for (const field of ['name', 'amount', 'obsolete']) assert.equal(read[field], item.attributes[field])
      const created = await restarted.resources.items.post({ inputRecord: createJsonApiDocument('items', { name: 'Added', amount: '8' }) })
      assert.equal(created.data.attributes.prefix, 'New')
    })
  })

  describe('Canonical schema enrichment through field additions and restart', () => {
    let fixture
    const calls = []
    const hooks = fieldHooks(calls)
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { hooks } })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    it('recompiles once for addition, retains fields and keeps explicit declarations on restart', async () => {
      const items = fixture.api.resources.items
      const item = await fixture.seed('items', { name: 'Before', amount: 4 })
      await items.query()
      const fields = { extra: { type: 'string', defaultTo: 'Added later', getter: value => value?.toUpperCase() } }
      await items.addKnexFields({ fields })
      assert.equal(calls.length, 2)
      const added = await fixture.seed('items', { name: 'After', amount: 6 })
      assert.equal(added.attributes.extra, 'ADDED LATER')
      assert.equal(added.attributes.amount, 6)
      assert.equal(added.attributes.added, 'Added by hook')
      await assert.rejects(items.query({ queryParams: { filters: { name: 'After' } } }), RestApiValidationError)
      assert.deepEqual((await items.query({ queryParams: { filters: { amountMatch: 12 } } })).data.map(row => row.id), [added.id])
      await items.createKnexTable()
      assert.equal(calls.length, 2)
      const { canonicalFieldMap } = await fixture.api.anyapi.registry.getDescriptor('schema_enrichment', 'items')
      const restarted = await createSchemaEnrichmentApi(fixture.knex, {
        hooks, fields, resourceOptions: { canonicalFieldsMap: canonicalFieldMap }
      })
      assert.equal(calls.length, 3)
      assert.equal((await restarted.resources.items.get({ id: item.id })).data.attributes.amount, 4)
      assert.equal((await restarted.resources.items.get({ id: added.id })).data.attributes.extra, 'ADDED LATER')
      assert.deepEqual((await restarted.resources.items.query({ queryParams: { filters: { amountMatch: 12 } } })).data.map(row => row.id), [added.id])
      assert.equal(restarted.resources.items.vars.schemaInfo.schemaStructure.obsolete, undefined)
      assert.equal(restarted.resources.items.vars.schemaInfo.searchSchemaStructure.name, undefined)
      assert.equal(calls.length, 3)
    })
  })
}

for (const connector of ['express', 'fastify']) {
  describe(`Schema enrichment HTTP ${connector} (${storageMode.mode})`, () => {
    let fixture, app, server, origin
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: { app, connector, hooks: fieldHooks([]) }
      })
      if (connector === 'fastify') {
        origin = await app.listen({ host: '127.0.0.1', port: 0 })
      } else {
        server = await new Promise((resolve, reject) => {
          const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
          listening.once('error', reject)
        })
        origin = `http://127.0.0.1:${server.address().port}`
      }
    })
    beforeEach(async () => fixture.reset())
    after(async () => {
      try {
        if (connector === 'fastify') await app?.close()
        else if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      } finally { await fixture?.close() }
    })

    const send = async (attributes, relationships, { method = 'POST', id } = {}) => {
      const document = createJsonApiDocument('items', attributes, relationships)
      if (id) document.data.id = id
      const response = await fetch(`${origin}/api/items${id ? `/${id}` : ''}`, {
        method,
        headers: { 'content-type': 'application/vnd.api+json' },
        body: JSON.stringify(document)
      })
      return { status: response.status, body: await response.json() }
    }

    it('uses enriched field and filter contracts over real HTTP', async () => {
      const created = await send({ name: 'HTTP', amount: 5 })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      assert.equal(created.body.data.attributes.amount, 5)
      assert.equal(created.body.data.attributes.added, 'Added by hook')
      assert.equal((await send({ amount: 'invalid' })).status, 422)
      assert.equal((await send({ obsolete: 'removed' })).status, 422)
      const response = await fetch(`${origin}/api/items?filter[amountMatch]=10`)
      const body = await response.json()
      assert.equal(response.status, 200, JSON.stringify(body))
      assert.deepEqual(body.data.map(row => row.id), [created.body.data.id])
    })

    if (storageMode.isAnyApi()) {
      it('validates field additions after routes and request contracts are initialized', async () => {
        await fixture.seed('items', { name: 'Warm contracts', amount: 1 })
        await fixture.api.resources.items.addKnexFields({ fields: { extra: { type: 'integer', nullable: true } } })
        const item = await fixture.seed('items', { amount: 2, extra: 8 })
        assert.equal(item.attributes.extra, 8)
        const created = await send({ amount: 3, extra: 9 })
        assert.equal(created.status, 201, JSON.stringify(created.body))
        assert.equal(created.body.data.attributes.extra, 9)
        assert.equal((await send({ extra: 'invalid' })).status, 422)
      })

      it('validates added relationship aliases after route initialization', async () => {
        const parent = await fixture.seed('items', { name: 'Parent', amount: 1 })
        await fixture.api.resources.items.addKnexFields({ fields: { parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true } } })
        const relationships = { parent: { data: { type: 'items', id: parent.id } } }
        const item = await fixture.seed('items', { name: 'Programmatic', amount: 2 }, relationships)
        assert.equal(item.relationships.parent.data.id, parent.id)
        const created = await send({ name: 'HTTP', amount: 3 }, relationships)
        assert.equal(created.status, 201, JSON.stringify(created.body))
        assert.equal(created.body.data.relationships.parent.data.id, parent.id)
        assert.equal((await send({ amount: 4 }, { parent: { data: [] } })).status, 422)
        for (const method of ['PUT', 'PATCH']) {
          const attributes = { ...item.attributes, name: 'Updated', amount: 4 }
          const updated = await send(attributes, relationships, { method, id: item.id })
          assert.equal(updated.status, 200, JSON.stringify(updated.body))
          assert.equal(updated.body.data.relationships.parent.data.id, parent.id)
          assert.equal((await send(attributes, { parent: { data: [] } }, { method, id: item.id })).status, 422)
        }
      })
    }
  })
}

for (const initiallyEmpty of [false, true]) {
  describe(`Search enrichment ${initiallyEmpty ? 'adds first filter' : 'removes all filters'} (${storageMode.mode})`, () => {
    let fixture
    const calls = []
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          ...(initiallyEmpty ? { fields: { name: { type: 'string' }, amount: { type: 'string' }, obsolete: { type: 'string' } } } : {}),
          hooks: searchHooks(context => {
            context.fields = initiallyEmpty ? { nameMatch: { type: 'string', actualField: 'name' } } : {}
          }, calls)
        }
      })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())
    it('uses the complete hook result through repeated table creation', async () => {
      const item = await fixture.seed('items', { name: 'Stored' })
      if (fixture.storage === 'anyapi') await fixture.api.resources.items.createKnexTable()
      assert.equal(calls.length, 1)
      assert.deepEqual(Object.keys(fixture.api.resources.items.vars.schemaInfo.searchSchemaStructure), initiallyEmpty ? ['nameMatch'] : [])
      const items = fixture.api.resources.items
      await assert.rejects(items.query({ queryParams: { filters: { name: 'Stored' } } }), RestApiValidationError)
      if (initiallyEmpty) {
        assert.deepEqual((await items.query({ queryParams: { filters: { nameMatch: 'Stored' } } })).data.map(row => row.id), [item.id])
      }
    })
  })
}

function fieldHooks (calls, replacement = false) {
  return {
    'schema:enrich': {
      functionName: 'customize-field-contract',
      handler: ({ context }) => {
        calls.push(context)
        if (replacement) context.fields = { ...context.fields }
        delete context.fields.obsolete
        context.fields.amount = {
          ...context.fields.amount,
          type: 'integer',
          setter: value => value * 2,
          getter: value => value / 2
        }
        context.fields.added = { type: 'string', search: true, defaultTo: 'Added by hook' }
      }
    },
    'searchSchema:enrich': {
      functionName: 'customize-enriched-filter',
      handler: ({ context }) => {
        context.fields = { amountMatch: { type: 'integer', actualField: 'amount' } }
      }
    }
  }
}

for (const replacement of [false, true]) {
  describe(`Field enrichment ${replacement ? 'replacement' : 'mutation'} (${storageMode.mode})`, () => {
    let fixture
    const calls = []
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { hooks: fieldHooks(calls, replacement) } })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())
    it('uses enriched types, fields and callbacks for validation, storage and filtering', async () => {
      const items = fixture.api.resources.items
      const info = items.vars.schemaInfo
      assert.equal(calls.length, 1)
      assert.equal(info.schemaStructure.amount.type, 'integer')
      assert.equal(info.schemaStructure.obsolete, undefined)
      assert.equal(info.storageInfo.fields.obsolete, undefined)
      assert.equal(info.storageInfo.fields.amount.definition, info.schemaStructure.amount)
      if (fixture.storage === 'anyapi') {
        assert.equal(info.descriptor.fields.amount.slotType, 'number')
        assert.equal(info.descriptor.fields.obsolete, undefined)
        assert.ok(info.descriptor.fields.added)
      }
      const item = await fixture.seed('items', { name: 'Enriched', amount: 7 })
      assert.equal(item.attributes.amount, 7)
      assert.equal(item.attributes.added, 'Added by hook')
      await assert.rejects(fixture.seed('items', { amount: 'invalid' }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' }))
      await assert.rejects(fixture.seed('items', { obsolete: 'removed' }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' }))
      if (fixture.storage === 'anyapi') await items.createKnexTable()
      assert.equal(calls.length, 1)
      const result = await items.query({ queryParams: { filters: { amountMatch: 14 } } })
      assert.deepEqual(result.data.map(row => row.id), [item.id])
      assert.equal(result.data[0].attributes.amount, 7)
      assert.equal((await items.get({ id: item.id, format: 'plain' })).added, 'Added by hook')
      await assert.rejects(items.query({ queryParams: { filters: { amountMatch: 'invalid' } } }), RestApiValidationError)
    })
  })
}

describe(`Relationship alias ownership (${storageMode.mode})`, () => {
  for (const enriched of [false, true]) {
    for (const declared of [false, true]) {
      it(`rejects ${enriched ? 'enriched' : 'authored'} aliases colliding with ${declared ? 'declared relationships' : 'another backing field'}`, async () => {
        const fields = {
          parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true },
          ...(!declared && { otherParentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true } })
        }
        await assertInvalidSchema({
          fields: enriched ? {} : fields,
          resourceOptions: declared
            ? {
                relationships: { parent: { type: 'hasMany', target: 'items', foreignKey: 'parentId' } }
              }
            : {},
          hooks: enriched
            ? {
                'schema:enrich': {
                  functionName: 'add-conflicting-relationship-aliases',
                  handler: ({ context }) => Object.assign(context.fields, fields)
                }
              }
            : {}
        }, /Relationship name 'parent' in resource 'items' is declared more than once/)
      })
    }
  }
})

describe(`Derived fields cannot declare relationships (${storageMode.mode})`, () => {
  for (const kind of ['computed', 'projection']) {
    for (const enriched of [false, true]) {
      for (const relationship of ['belongsTo', 'belongsToPolymorphic']) {
        it(`rejects ${enriched ? 'enriched' : 'authored'} ${kind} ${relationship}`, async () => {
          const definition = {
            type: 'string',
            as: 'parent',
            [relationship]: relationship === 'belongsTo' ? 'items' : { types: ['items'], typeField: 'subjectType', idField: 'subjectId' },
            ...(kind === 'computed' ? { computed: true, compute: () => '1' } : { select: ({ knex }) => knex.raw('1') })
          }
          await assertInvalidSchema({
            projections: kind === 'projection',
            fields: kind === 'computed' && !enriched ? { derived: definition } : {},
            resourceOptions: kind === 'projection' && !enriched ? { queryFields: { derived: definition } } : {},
            hooks: enriched
              ? {
                  [kind === 'computed' ? 'computedSchema:enrich' : 'schema:enrich']: {
                    functionName: 'inject-derived-relationship',
                    handler: ({ context }) => {
                      if (kind === 'computed') context.fields.derived = definition
                      else context.queryFields.derived = definition
                    }
                  }
                }
              : {}
          }, /(?:Computed|Query) field 'derived' in scope 'items' cannot declare relationships/)
        })
      }
    }
  }
})

describe(`Polymorphic declaration location (${storageMode.mode})`, () => {
  for (const enriched of [false, true]) {
    it(`rejects ${enriched ? 'enriched' : 'authored'} polymorphic relationships inside stored fields`, async () => {
      const definition = {
        type: 'string',
        nullable: true,
        as: 'subject',
        belongsToPolymorphic: { types: ['items'], typeField: 'subjectType', idField: 'subjectId' }
      }
      await assertInvalidSchema({
        fields: {
          subjectType: { type: 'string', nullable: true },
          subjectId: { type: 'id', nullable: true },
          ...(!enriched && { misplaced: definition })
        },
        hooks: enriched
          ? {
              'schema:enrich': {
                functionName: 'misplace-polymorphic-relationship',
                handler: ({ context }) => { context.fields.misplaced = definition }
              }
            }
          : {}
      }, /Field 'misplaced' in resource 'items' cannot declare belongsToPolymorphic; declare it in relationships/)
    })
  }
})
