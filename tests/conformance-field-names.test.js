import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { RestApiFieldsetError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { buildStorageInfo, getFieldValue, getLogicalFieldName } from '../plugins/core/lib/storage/storage-mapping.js'
import { getForeignKeyFields } from '../plugins/core/lib/querying-writing/field-utils.js'
import { generateKnexMigration } from '../plugins/core/lib/dbTablesOperations.js'

const names = ['constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']
const storedField = name => ({ type: 'string', nullable: true, search: true, ...(['constructor', 'prototype'].includes(name) ? { storage: { column: `${name}_value` } } : {}) })
const tables = { items: 'schema_enrichment_items' }
const attributes = (result, format) => format === 'plain' ? result : result.data.attributes
const input = (record, format) => format === 'plain' ? record : createJsonApiDocument('items', record)

for (const naming of ['snake_case', 'exact']) {
  describe(`Declared prototype-named attributes (${storageMode.mode}, ${naming})`, () => {
    let fixture, items
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          fields: { obsolete: { type: 'string', virtual: true }, ...Object.fromEntries(names.map(name => [name, storedField(name)])) },
          resourceOptions: { storage: { naming }, sortableFields: ['id', ...names] }
        }
      })
      items = fixture.api.resources.items
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    for (const name of names) {
      for (const format of ['jsonapi', 'plain']) {
        it(`round-trips ${name} through POST/PATCH/PUT and sparse GET (${format})`, async () => {
          const created = await items.post({ format, returning: 'full', [format === 'plain' ? 'data' : 'document']: input({ name: 'Record', [name]: 'Original' }, format) })
          const id = format === 'plain' ? created.id : created.data.id
          assert.equal(attributes(created, format)[name], 'Original')
          assert.equal(Object.hasOwn(attributes(created, format), name), true)
          for (const method of ['patch', 'put']) {
            const value = `After ${method}`
            const changed = await items[method]({ id, format, returning: 'full', [format === 'plain' ? 'data' : 'document']: input({ name: 'Record', [name]: value }, format) })
            assert.equal(attributes(changed, format)[name], value)
            const fetched = await items.get({ id, format, queryParams: { fields: { items: name } } })
            assert.equal(attributes(fetched, format)[name], value)
            assert.deepEqual(Object.keys(attributes(fetched, format)).sort(), format === 'plain' ? [name, 'id'].sort() : [name])
          }
        })

        it(`filters and traverses ${name} cursors with sparse output (${format})`, async () => {
          for (const value of ['B', 'A', 'C']) await fixture.seed('items', { name: 'Record', [name]: value })
          const filtered = await items.query({ format, queryParams: { filters: { [name]: 'A' }, fields: { items: name } } })
          assert.deepEqual(filtered.data.map(row => [row.id, format === 'plain' ? row[name] : row.attributes[name]]), [['2', 'A']])
          let queryParams = { sort: [name], fields: { items: 'name' }, page: { size: 1 } }
          const ids = []
          for (let page = 0; page < 3; page++) {
            const result = await items.query({ format, queryParams })
            ids.push(...result.data.map(row => row.id))
            for (const row of result.data) assert.equal(Object.hasOwn(format === 'plain' ? row : row.attributes, name), false)
            if (!result.links.next) break
            queryParams = parseJsonApiQuery(new URL(result.links.next, 'http://test.invalid').search.slice(1))
          }
          assert.deepEqual(ids, ['2', '1', '3'])
        })
      }
    }
  })
}

describe(`Prototype-named callback fields (${storageMode.mode})`, () => {
  let fixture, items
  const calls = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        fields: {
          constructor: { ...storedField('constructor'), normallyHidden: true, getter: value => { calls.push(['constructor', value]); return value.toUpperCase() } },
          toString: { type: 'string', virtual: true, getter: value => { calls.push(['toString', value]); return `virtual:${value}` } },
          valueOf: { type: 'string', computed: true, normallyHidden: true, dependencies: ['constructor'], compute: ({ attributes }) => `computed:${attributes.constructor}` }
        }
      }
    })
    items = fixture.api.resources.items
  })
  beforeEach(async () => { await fixture.reset(); calls.length = 0 })
  after(async () => fixture?.close())
  for (const format of ['jsonapi', 'plain']) {
    it(`uses virtual input as an own value and computes from the stored getter (${format})`, async () => {
      const created = await items.post({
        format,
        returning: 'full',
        [format === 'plain' ? 'data' : 'document']: input({ name: 'Record', constructor: 'source', toString: 'input' }, format),
        queryParams: { fields: { items: 'name,toString,valueOf' } }
      })
      assert.equal(attributes(created, format).toString, 'virtual:input')
      assert.equal(attributes(created, format).valueOf, 'computed:SOURCE')
      assert.deepEqual(calls.map(([name]) => name).sort(), ['constructor', 'toString'])
      assert.equal(Object.hasOwn(attributes(created, format), 'constructor'), false)
    })
    it(`does not run getters for inherited or unselected values (${format})`, async () => {
      const created = await items.post({ returning: 'none', document: createJsonApiDocument('items', { name: 'Record', constructor: 'source' }) })
      assert.equal(created, undefined)
      calls.length = 0
      const result = await items.query({ format, queryParams: { fields: { items: 'name' } } })
      assert.equal(result.data.length, 1)
      assert.deepEqual(calls, [])
    })
  }
})

describe(`Undeclared prototype-named fields (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables })
    await fixture.seed('items', { name: 'Record' })
  })
  after(async () => fixture?.close())
  it('rejects inherited names as requested fields or filters', async () => {
    for (const name of names) {
      await assert.rejects(fixture.api.resources.items.query({ queryParams: { fields: { items: name } } }), RestApiFieldsetError)
      await assert.rejects(fixture.api.resources.items.query({ queryParams: { filters: { [name]: 'Value' } } }), RestApiValidationError)
    }
  })
  it('does not return inherited properties for missing storage values or mappings', () => {
    const schemaInfo = fixture.api.resources.items.vars.schemaInfo
    for (const name of names) {
      assert.equal(getLogicalFieldName(schemaInfo, name), name)
      assert.equal(getFieldValue({}, schemaInfo, name), undefined)
    }
  })
})

describe(`Prototype-named setters (${storageMode.mode})`, () => {
  let fixture, items
  const calls = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        fields: {
          constructor: { ...storedField('constructor'), setter: (value, { originalValue }) => { calls.push(['constructor', value, originalValue]); return value.toUpperCase() } },
          toString: { type: 'string', nullable: true, runSetterAfter: ['name'], setter: (value, { originalValue }) => { calls.push(['toString', value, originalValue]); return value ?? 'derived' } }
        }
      }
    })
    items = fixture.api.resources.items
  })
  beforeEach(async () => { await fixture.reset(); calls.length = 0 })
  after(async () => fixture?.close())
  for (const format of ['jsonapi', 'plain']) {
    it(`runs supplied setters with own values (${format})`, async () => {
      const result = await items.post({ format, returning: 'full', [format === 'plain' ? 'data' : 'document']: input({ name: 'Record', constructor: 'input', toString: 'supplied' }, format) })
      assert.equal(attributes(result, format).constructor, 'INPUT')
      assert.equal(attributes(result, format).toString, 'supplied')
      assert.deepEqual(calls, [['constructor', 'input', 'input'], ['toString', 'supplied', 'supplied']])
    })
    it(`skips absent independent setters and passes undefined to dependent setters (${format})`, async () => {
      const created = await fixture.seed('items', { name: 'Record' })
      assert.deepEqual(calls, [['toString', undefined, undefined]])
      calls.length = 0
      const result = await items.patch({ id: created.id, format, returning: 'full', [format === 'plain' ? 'data' : 'document']: input({ name: 'Updated' }, format) })
      assert.equal(attributes(result, format).constructor, null)
      assert.equal(attributes(result, format).toString, 'derived')
      assert.deepEqual(calls, [['toString', undefined, undefined]])
    })
  }
})

describe(`Prototype-named configuration (${storageMode.mode})`, () => {
  for (const name of ['constructor', 'prototype']) {
    it(`handles an unmapped public ${name} according to the storage backend`, async () => {
      let fixture
      const createFixture = async () => {
        fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { fields: { [name]: { type: 'string' } } } })
      }
      try {
        if (storageMode.mode === 'knex') await assert.rejects(createFixture, /unsupported Knex storage column/)
        else {
          await createFixture()
          const created = await fixture.seed('items', { name: 'Record', [name]: 'Before' })
          const changed = await fixture.api.resources.items.patch({ id: created.id, returning: 'full', document: createJsonApiDocument('items', { [name]: 'After' }) })
          assert.equal(changed.data.attributes[name], 'After')
        }
      } finally { await fixture?.close() }
    })
  }
  for (const name of ['constructor', 'toString']) {
    it(`rejects hidden stored sort field ${name} despite an inherited query-field name`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({
            createApi: createSchemaEnrichmentApi,
            tables,
            apiOptions: {
              fields: { [name]: { ...storedField(name), hidden: true } },
              resourceOptions: { sortableFields: [name] }
            }
          })
        }, error => error instanceof RestApiValidationError && error.details.violations[0].rule === 'hidden_sort')
      } finally { await fixture?.close() }
    })
  }

  for (const column of ['constructor', 'prototype', '__proto__']) {
    it(`rejects unsupported physical Knex column ${column} before table creation`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({
            storage: 'knex',
            createApi: createSchemaEnrichmentApi,
            tables,
            apiOptions: {
              fields: { value: { type: 'string', storage: { column } } }
            }
          })
        }, /unsupported Knex storage column.*storage.column/)
      } finally { await fixture?.close() }
    })
    it(`rejects unsupported physical Knex column ${column} in adapters and generated migrations`, () => {
      const schemaStructure = { value: { type: 'string', storage: { column } } }
      const schemaInfo = { tableName: 'items', schemaStructure, storageInfo: buildStorageInfo({ schemaStructure }) }
      assert.throws(() => createStorageAdapter({ schemaInfo }), /unsupported Knex storage column/)
      assert.throws(() => generateKnexMigration('items', { structure: schemaStructure }), /unsupported Knex storage column/)
    })
    it(`rejects unsupported Knex idProperty ${column}`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({ storage: 'knex', createApi: createSchemaEnrichmentApi, tables, apiOptions: { resourceOptions: { idProperty: column } } })
        }, /Unsupported Knex id column/)
      } finally { await fixture?.close() }
    })
  }
})

describe(`Overlapping logical and physical field mappings (${storageMode.mode})`, () => {
  let fixture, minimal
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        fields: {
          first: { type: 'string', storage: { column: 'second' } },
          second: { type: 'string', storage: { column: 'third' } }
        },
        hooks: { beforeDataCall: { functionName: 'capture-minimal-mapped-fields', handler: ({ context }) => { minimal = context.minimalRecord } } }
      }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())
  for (const format of ['jsonapi', 'plain']) {
    it(`translates minimal records once before PATCH and PUT (${format})`, async () => {
      const created = await fixture.seed('items', { name: 'Record', first: 'One', second: 'Two' })
      for (const method of ['patch', 'put']) {
        const result = await fixture.api.resources.items[method]({
          id: created.id,
          format,
          returning: 'full',
          [format === 'plain' ? 'data' : 'document']: input({ name: 'Record', first: 'One', second: 'Two' }, format)
        })
        assert.equal(minimal.attributes.first, 'One')
        assert.equal(minimal.attributes.second, 'Two')
        assert.equal(attributes(result, format).first, 'One')
        assert.equal(attributes(result, format).second, 'Two')
      }
    })
  }
})

describe(`Structure-named field metadata (${storageMode.mode})`, () => {
  it('finds relationship identities beside an attribute named structure', () => {
    const fields = {
      structure: { type: 'string' },
      ownerId: { type: 'id', belongsTo: 'items', as: 'owner' }
    }
    assert.deepEqual([...getForeignKeyFields(fields)], ['ownerId'])
  })

  it('rejects identity serialization beside an attribute named structure', async () => {
    let unexpectedFixture
    try {
      await assert.rejects(async () => {
        unexpectedFixture = await createConformanceFixture({
          createApi: createSchemaEnrichmentApi,
          tables,
          apiOptions: {
            fields: {
              structure: { type: 'string', nullable: true },
              ownerId: { type: 'id', nullable: true, belongsTo: 'items', as: 'owner', storage: { serialize: value => value } }
            }
          }
        })
      }, /identity fields must preserve resource IDs/)
    } finally { await unexpectedFixture?.close() }
  })
})

describe(`Structure-named attribute and relationship output (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        fields: {
          structure: { type: 'string', nullable: true },
          ownerId: { type: 'id', nullable: true, belongsTo: 'items', as: 'owner' }
        }
      }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('keeps the named attribute while excluding relationship backing values', async () => {
    const owner = await fixture.seed('items', { name: 'Owner', structure: 'Parent structure' })
    const child = await fixture.seed('items', { name: 'Child', structure: 'Child structure' }, {
      owner: { data: { type: 'items', id: owner.id } }
    })
    const fetched = await fixture.api.resources.items.get({ id: child.id })
    const queried = await fixture.api.resources.items.query({ queryParams: { sort: ['id'] } })
    for (const record of [fetched.data, ...queried.data]) {
      assert.equal(Object.hasOwn(record.attributes, 'ownerId'), false)
      assert.equal(record.attributes.structure, record.id === child.id ? 'Child structure' : 'Parent structure')
    }
    assert.deepEqual(fetched.data.relationships.owner.data, { type: 'items', id: owner.id })
  })
})
