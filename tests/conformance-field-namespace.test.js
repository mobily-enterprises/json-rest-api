import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { assertWriteFailure, createJsonApiDocument } from './helpers/test-utils.js'
import { parseIncludeTree } from '../plugins/core/lib/querying/include-query-helpers.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { generateKnexMigration } from '../plugins/core/lib/dbTablesOperations.js'
import { buildStorageInfo } from '../plugins/core/lib/storage/storage-mapping.js'

const tables = { items: 'schema_enrichment_items' }
const named = value => Object.fromEntries([['__proto__', value]])
const field = { type: 'string', storage: { column: 'safe_value' } }
const search = { type: 'string', actualField: 'name' }
const computed = { type: 'string', computed: true, compute: () => 'Computed' }
const projection = { type: 'string', select: ({ knex }) => knex.raw('?', ['Projected']) }
const relation = { type: 'hasMany', target: 'items', foreignKey: 'ownerId' }
const configurations = [
  ['stored field', { fields: named(field) }],
  ['computed field', { fields: named(computed) }],
  ['projection', { projections: true, resourceOptions: { queryFields: named(projection) } }],
  ['explicit filter', { searchSchema: named(search) }],
  ['generated filter', { fields: { name: { type: 'string', search: named({ type: 'string', filterOperator: '=' }) } } }],
  ['virtual filter declaration', { fields: { _virtual: { search: named(search) } } }],
  ['belongs-to alias', { fields: { ownerId: { type: 'id', belongsTo: 'items', as: '__proto__', nullable: true } } }],
  ['relationship declaration', { resourceOptions: { relationships: named(relation) } }],
  ['relationship backing field', { resourceOptions: { relationships: { owner: { belongsToPolymorphic: { types: ['items'], typeField: 'ownerType', idField: '__proto__' } } } } }],
  ['schema relationship backing field', { fields: { owner: { belongsToPolymorphic: { types: ['items'], typeField: 'ownerType', idField: '__proto__' } } } }],
  ['inherited schema declaration', { resourceOptions: { schema: { __proto__: field, name: { type: 'string' } } } }],
  ['inherited projection declaration', { projections: true, resourceOptions: { queryFields: { __proto__: projection } } }],
  ['inherited search declaration', { searchSchema: { __proto__: search } }],
  ['inherited relationship declaration', { resourceOptions: { relationships: { __proto__: relation } } }]
]

describe(`Relationship alias types (${storageMode.mode})`, () => {
  for (const [label, as] of [['number', 7], ['boolean', true], ['array', ['owner']], ['object', { name: 'owner' }]]) {
    for (const enriched of [false, true]) {
      it(`rejects a ${label} alias in ${enriched ? 'enriched' : 'authored'} schema`, async () => {
        const definition = { type: 'id', belongsTo: 'items', as, nullable: true }
        const apiOptions = enriched
          ? { hooks: { 'schema:enrich': { functionName: 'invalid-alias', handler: ({ context }) => { context.fields.ownerId = definition } } } }
          : { fields: { ownerId: definition } }
        let fixture
        try {
          await assert.rejects(async () => {
            fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions })
          }, /relationship alias.*items\.ownerId.*must be a string/i)
        } finally { await fixture?.close() }
      })
    }
  }
})

describe(`Relationship mapping name types (${storageMode.mode})`, () => {
  const declarations = [
    ['hasMany target', { type: 'hasMany', target: ['items'], foreignKey: 'ownerId' }, 'target'],
    ['hasOne target', { type: 'hasOne', target: ['items'], foreignKey: 'ownerId' }, 'target'],
    ['manyToMany target', { type: 'manyToMany', target: ['items'], through: 'links', foreignKey: 'ownerId', otherKey: 'itemId' }, 'target'],
    ['manyToMany through', { type: 'manyToMany', target: 'items', through: ['links'], foreignKey: 'ownerId', otherKey: 'itemId' }, 'through'],
    ['hasMany via', { type: 'hasMany', target: 'items', via: ['subject'] }, 'via']
  ]
  for (const [label, definition, option] of declarations) {
    for (const enriched of [false, true]) {
      it(`rejects array ${label} in ${enriched ? 'enriched' : 'authored'} relationships`, async () => {
        const apiOptions = enriched
          ? { hooks: { 'computedSchema:enrich': { functionName: 'invalid-mapping-name', handler: ({ context }) => { context.schemaRelationships.owner = definition } } } }
          : { resourceOptions: { relationships: { owner: definition } } }
        let fixture
        try {
          await assert.rejects(async () => {
            fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions })
          }, new RegExp(`relationship.*items\\.owner.*${option}.*must be a string`, 'i'))
          if (!enriched) {
            const validDefinition = { ...definition, [option]: definition[option][0] }
            const validOptions = { resourceOptions: { relationships: { owner: validDefinition } } }
            fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: validOptions })
            assert.equal(fixture.api.resources.items.vars.schemaInfo.schemaRelationships.owner[option], validDefinition[option])
          }
        } finally { await fixture?.close() }
      })
    }
  }
})

describe(`Enriched relationship backing names (${storageMode.mode})`, () => {
  for (const [type, option] of [['hasMany', 'foreignKey'], ['hasOne', 'foreignKey'], ['manyToMany', 'foreignKey'], ['manyToMany', 'otherKey']]) {
    it(`rejects an array ${type} ${option} introduced by enrichment`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({
            createApi: createSchemaEnrichmentApi,
            tables,
            apiOptions: {
              hooks: {
                'computedSchema:enrich': {
                  functionName: 'invalid-backing-name',
                  handler: ({ context }) => {
                    context.schemaRelationships.owner = { type, target: 'items', through: 'links', foreignKey: 'ownerId', otherKey: 'itemId', [option]: ['ownerId'] }
                  }
                }
              }
            }
          })
        }, new RegExp(`relationship.*items\\.owner.*${option}.*must be a string`, 'i'))
      } finally { await fixture?.close() }
    })
  }
})

describe(`Belongs-to target types (${storageMode.mode})`, () => {
  for (const enriched of [false, true]) {
    it(`rejects an array belongsTo target in ${enriched ? 'enriched' : 'authored'} schema`, async () => {
      const definition = { type: 'id', belongsTo: ['items'], as: 'owner', nullable: true }
      const apiOptions = enriched
        ? { hooks: { 'schema:enrich': { functionName: 'invalid-belongs-to', handler: ({ context }) => { context.fields.ownerId = definition } } } }
        : { fields: { ownerId: definition } }
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions })
        }, /items\.ownerId.*belongsTo.*must be a string/i)
      } finally { await fixture?.close() }
    })
  }
})

describe(`Enriched polymorphic declarations (${storageMode.mode})`, () => {
  const valid = { types: ['items'], typeField: 'subjectType', idField: 'subjectId' }
  for (const [label, override] of [
    ['empty target list', { types: [] }],
    ['string target list', { types: 'items' }],
    ['array target name', { types: [['items']] }],
    ['empty target name', { types: [''] }],
    ['missing discriminator', { typeField: undefined }],
    ['array discriminator', { typeField: ['subjectType'] }],
    ['missing identifier', { idField: undefined }],
    ['array identifier', { idField: ['subjectId'] }]
  ]) {
    it(`rejects a ${label} introduced by enrichment`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({
            createApi: createSchemaEnrichmentApi,
            tables,
            apiOptions: {
              hooks: {
                'computedSchema:enrich': {
                  functionName: 'invalid-polymorphic-shape',
                  handler: ({ context }) => {
                    context.schemaRelationships.subject = { belongsToPolymorphic: { ...valid, ...override } }
                  }
                }
              }
            }
          })
        }, /Invalid polymorphic relationship 'subject' in scope 'items': belongsToPolymorphic\./)
      } finally { await fixture?.close() }
    })
  }
})

describe(`Enriched reverse relationship requirements (${storageMode.mode})`, () => {
  for (const [type, missing] of [
    ['hasMany', 'target'], ['hasMany', 'foreignKey'],
    ['hasOne', 'target'], ['hasOne', 'foreignKey'],
    ['manyToMany', 'through'], ['manyToMany', 'foreignKey'], ['manyToMany', 'otherKey']
  ]) {
    it(`rejects ${type} without ${missing} after enrichment`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({
            createApi: createSchemaEnrichmentApi,
            tables,
            apiOptions: {
              hooks: {
                'computedSchema:enrich': {
                  functionName: 'incomplete-reverse-relationship',
                  handler: ({ context }) => {
                    context.schemaRelationships.owner = { type, target: 'items', through: 'links', foreignKey: 'ownerId', otherKey: 'itemId', [missing]: undefined }
                  }
                }
              }
            }
          })
        }, new RegExp(`Invalid ${type} relationship 'owner' in scope 'items':.*${missing}`))
      } finally { await fixture?.close() }
    })
  }
})

describe(`Rejected field namespace declarations (${storageMode.mode})`, () => {
  for (const [label, apiOptions] of configurations) {
    it(`rejects a ${label} before compiling away its name`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions })
        }, /__proto__|own.*(field|declaration)|prototype.*(map|declaration)/i)
      } finally { await fixture?.close() }
      assert.equal(Object.hasOwn(Object.prototype, 'safe_value'), false)
    })
  }

  for (const [hook, member, definition] of [
    ['schema:enrich', 'fields', field],
    ['schema:enrich', 'queryFields', projection],
    ['searchSchema:enrich', 'fields', search],
    ['computedSchema:enrich', 'fields', computed],
    ['computedSchema:enrich', 'schemaRelationships', relation]
  ]) {
    for (const style of ['own', 'inherited']) {
      it(`rejects ${style} declarations introduced by ${hook}.${member}`, async () => {
        let fixture
        try {
          await assert.rejects(async () => {
            fixture = await createConformanceFixture({
              createApi: createSchemaEnrichmentApi,
              tables,
              apiOptions: {
                hooks: {
                  [hook]: {
                    functionName: 'inject-invalid-field-name',
                    handler: ({ context }) => {
                      if (style === 'own') Object.defineProperty(context[member], '__proto__', { value: definition, enumerable: true })
                      else Object.setPrototypeOf(context[member], definition)
                    }
                  }
                }
              }
            })
          }, /__proto__|own.*(field|declaration)|prototype.*(map|declaration)/i)
        } finally { await fixture?.close() }
      })
    }
  }
})

describe('Own include tree properties', () => {
  it('preserves prototype-named segments without mutating inherited objects', () => {
    const tree = parseIncludeTree(['constructor.toString', '__proto__.nested'])
    assert.deepEqual(tree, JSON.parse('{"constructor":{"toString":{}},"__proto__":{"nested":{}}}'))
    assert.equal(Object.getPrototypeOf(tree), Object.prototype)
    assert.equal(Object.hasOwn(Object.prototype, 'nested'), false)
    assert.equal(Object.hasOwn(Object, 'toString'), false)
  })
})

describe(`Field additions and table declaration maps (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())
  for (const style of ['own', 'inherited']) {
    const fields = () => style === 'own' ? named(field) : { __proto__: field }
    it(`rejects ${style} invalid field additions without changing records or published metadata`, async () => {
      const created = await fixture.seed('items', { name: 'Preserved' })
      const schemaInfo = fixture.api.resources.items.vars.schemaInfo
      await assert.rejects(fixture.api.resources.items.addKnexFields({ fields: fields() }), /__proto__|own field declarations/)
      assert.equal(fixture.api.resources.items.vars.schemaInfo, schemaInfo)
      const result = await fixture.api.resources.items.get({ id: created.id })
      assert.equal(result.data.attributes.name, 'Preserved')
      assert.equal(await fixture.count('items'), 1)
    })
    it(`rejects ${style} invalid names in direct storage mapping and migration generation`, () => {
      assert.throws(() => buildStorageInfo({ schemaStructure: fields() }), /__proto__|own field declarations/)
      assert.throws(() => generateKnexMigration('items', { structure: fields() }), /__proto__|own field declarations/)
    })
    if (storageMode.mode === 'anyapi') {
      it(`rejects ${style} invalid search additions before allocating canonical fields`, async () => {
        const schemaInfo = fixture.api.resources.items.vars.schemaInfo
        await assert.rejects(fixture.api.resources.items.addKnexFields({ fields: { added: { type: 'string' } }, searchSchema: style === 'own' ? named(search) : { __proto__: search } }), /__proto__|own field declarations/)
        assert.equal(fixture.api.resources.items.vars.schemaInfo, schemaInfo)
        assert.equal(Object.hasOwn(schemaInfo.schemaStructure, 'added'), false)
      })
    }
  }
})

describe(`Resource-name contract (${storageMode.mode})`, () => {
  for (const resourceName of ['__proto__', 'constructor', 'prototype']) {
    it(`rejects reserved resource ${resourceName}`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { resourceName } })
        }, { name: 'TypeError', message: `Invalid name '${resourceName}'` })
      } finally { await fixture?.close() }
    })
  }
  for (const resourceName of ['toString', 'valueOf', 'hasOwnProperty']) {
    it(`uses resource ${resourceName} through its own registered scope`, async () => {
      let fixture
      try {
        fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables: { [resourceName]: 'schema_enrichment_items' }, apiOptions: { resourceName } })
        const created = await fixture.seed(resourceName, { name: 'Original' })
        const items = fixture.api.resources[resourceName]
        await items.patch({ id: created.id, document: createJsonApiDocument(resourceName, { name: 'Updated' }) })
        const result = await items.query({ queryParams: { fields: { [resourceName]: 'name' } } })
        assert.equal(result.data[0].type, resourceName)
        assert.deepEqual(result.data[0].attributes, { name: 'Updated' })
      } finally { await fixture?.close() }
    })
  }
})

if (storageMode.mode === 'anyapi') {
  describe('Canonical registry field namespace', () => {
    let fixture, registry, tenant
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          fields: { ownerId: { type: 'id', belongsTo: 'items', as: 'owner', nullable: true } }
        }
      })
      registry = fixture.api.anyapi.registry
      tenant = fixture.api.anyapi.tenantId
    })
    beforeEach(async () => { await fixture.reset(); await fixture.seed('items', { name: 'Preserved' }) })
    after(async () => fixture?.close())
    it('rejects direct registry allocation before writing metadata', async () => {
      const before = await registry.getDescriptor(tenant, 'items')
      await assert.rejects(registry.allocateField({ tenant, resource: 'items', fieldName: '__proto__', definition: { type: 'string' } }), /__proto__/)
      assert.deepEqual(await registry.getDescriptor(tenant, 'items'), before)
      assert.equal(await fixture.count('items'), 1)
    })
    for (const style of ['own', 'inherited']) {
      it(`rejects ${style} declarations through direct registry registration`, async () => {
        await assert.rejects(registry.registerResource({ tenant, resource: 'invalid', schema: style === 'own' ? named(field) : { __proto__: field } }), /__proto__|own field declarations/)
        assert.equal(await fixture.knex('any_resource_configs').where({ tenant_id: tenant, resource: 'invalid' }).first(), undefined)
      })
    }
    for (const [table, column] of [['any_field_configs', 'field_name'], ['any_relationship_configs', 'alias']]) {
      it(`rejects an invalid persisted ${column} before publishing a descriptor`, async () => {
        const row = await fixture.knex(table).first()
        try {
          await fixture.knex(table).where('id', row.id).update({ [column]: '__proto__' })
          registry.invalidateDescriptor(tenant, 'items')
          await assert.rejects(registry.getDescriptor(tenant, 'items'), /__proto__/)
          assert.equal(await fixture.count('items'), 1)
        } finally {
          await fixture.knex(table).where('id', row.id).update({ [column]: row[column] })
          registry.invalidateDescriptor(tenant, 'items')
          // Restore the pre-test cache state as well as the metadata row.
          await registry.getDescriptor(tenant, 'items')
        }
      })
    }
  })
}

describe(`Null-prototype declaration maps (${storageMode.mode})`, () => {
  it('compiles own schema, search and projection fields', async () => {
    let fixture
    const ownMap = entries => Object.assign(Object.create(null), Object.fromEntries(entries))
    try {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          projections: true,
          searchSchema: ownMap([['toString', { type: 'string', actualField: 'name' }]]),
          resourceOptions: {
            schema: ownMap([['name', { type: 'string' }]]),
            queryFields: ownMap([['valueOf', { type: 'string', select: ({ knex, column }) => knex.raw('??', [column('name')]) }]]),
            relationships: Object.create(null)
          }
        }
      })
      await fixture.seed('items', { name: 'Record' })
      const result = await fixture.api.resources.items.query({ queryParams: { filters: { toString: 'Record' }, fields: { items: 'valueOf' } } })
      assert.deepEqual(result.data.map(row => row.attributes), [{ valueOf: 'Record' }])
    } finally { await fixture?.close() }
  })
})

describe(`Prototype-named foreign-key attributes (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        fields: { constructor: { type: 'id', nullable: true, belongsTo: 'items', as: 'owner', storage: { column: 'owner_id' } } }
      }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())
  it('rejects direct foreign-key attributes instead of silently omitting them', async () => {
    await assert.rejects(fixture.api.resources.items.post({ document: createJsonApiDocument('items', { name: 'Record', constructor: '1' }) }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' }))
    assert.equal(await fixture.count('items'), 0)
  })
})

for (const alias of ['constructor', 'toString', 'prototype']) {
  describe(`Own relationship alias ${alias} (${storageMode.mode})`, () => {
    let fixture, parent, child
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables,
        apiOptions: {
          fields: { ownerId: { type: 'id', belongsTo: 'items', as: alias, nullable: true, search: true } }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      parent = await fixture.seed('items', { name: 'Parent' })
      child = await fixture.seed('items', { name: 'Child' }, { [alias]: { data: { type: 'items', id: parent.id } } })
    })
    after(async () => fixture?.close())
    it('builds nested include paths without adding properties to inherited functions', async () => {
      const inherited = Object.prototype[alias]
      const before = inherited && Object.getOwnPropertyDescriptor(inherited, alias)
      try {
        const root = await fixture.seed('items', { name: 'Root' })
        await fixture.api.resources.items.patch({
          id: parent.id,
          format: 'jsonapi',
          returning: 'none',
          document: { data: { type: 'items', id: parent.id, relationships: { [alias]: { data: { type: 'items', id: root.id } } } } }
        })
        const result = await fixture.api.resources.items.get({ id: child.id, format: 'jsonapi', queryParams: { include: [`${alias}.${alias}`] } })
        assert.deepEqual(result.included.map(row => row.attributes.name).sort(), ['Parent', 'Root'])
        if (inherited) assert.deepEqual(Object.getOwnPropertyDescriptor(inherited, alias), before)
      } finally {
        if (inherited) {
          if (before) Object.defineProperty(inherited, alias, before)
          else delete inherited[alias]
        }
      }
    })
    for (const format of ['jsonapi', 'plain']) {
      it(`reads and includes the declared relationship (${format})`, async () => {
        const result = await fixture.api.resources.items.get({ id: child.id, format, queryParams: { include: [alias], fields: { items: `name,${alias}` } } })
        if (format === 'jsonapi') {
          assert.equal(Object.hasOwn(result.data.relationships, alias), true)
          assert.deepEqual(result.data.relationships[alias].data, { type: 'items', id: parent.id })
          assert.equal(result.included[0].attributes.name, 'Parent')
        } else {
          assert.equal(Object.hasOwn(result, alias), true)
          assert.equal(result[alias].id, parent.id)
          assert.equal(result[alias].name, 'Parent')
        }
      })
      it(`filters through the declared relationship alias (${format})`, async () => {
        const result = await fixture.api.resources.items.query({ format, queryParams: { filters: { [alias]: parent.id } } })
        assert.deepEqual(result.data.map(row => row.id), [child.id])
      })
    }
  })
}

describe(`Nested JSON property names (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { fields: { payload: { type: 'object' }, entries: { type: 'array' } } } })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())
  for (const format of ['jsonapi', 'plain']) {
    it(`preserves prototype-named JSON values through writes and reads (${format})`, async () => {
      const payload = JSON.parse('{"__proto__":{"nested":true},"constructor":{"prototype":{"x":1}},"toString":"literal"}')
      const data = { name: 'Record', payload, entries: [payload] }
      const inputRecord = format === 'plain' ? data : createJsonApiDocument('items', data)
      const created = await fixture.api.resources.items.post({ format, returning: 'full', [format === 'plain' ? 'data' : 'document']: inputRecord })
      const id = format === 'plain' ? created.id : created.data.id
      for (const method of ['get', 'patch', 'put']) {
        const result = await fixture.api.resources.items[method]({ id, format, returning: 'full', ...(method === 'get' ? {} : { [format === 'plain' ? 'data' : 'document']: inputRecord }) })
        const attributes = format === 'plain' ? result : result.data.attributes
        assert.deepEqual(attributes.payload, payload)
        assert.deepEqual(attributes.entries, [payload])
        assert.equal(Object.getPrototypeOf(attributes.payload), Object.prototype)
        assert.equal(Object.hasOwn(attributes.payload, '__proto__'), true)
      }
      assert.equal(Object.hasOwn(Object.prototype, 'nested'), false)
      assert.equal(Object.hasOwn(Object.prototype, 'x'), false)
    })
  }
})

describe(`Polymorphic prototype-named resources and aliases (${storageMode.mode})`, () => {
  let fixture, parent, child
  const resourceName = 'toString'
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { [resourceName]: 'schema_enrichment_items' },
      apiOptions: {
        resourceName,
        fields: { ownerType: { type: 'string', nullable: true }, ownerId: { type: 'id', nullable: true } },
        resourceOptions: { relationships: { constructor: { belongsToPolymorphic: { types: [resourceName], typeField: 'ownerType', idField: 'ownerId' } } } }
      }
    })
    parent = await fixture.seed(resourceName, { name: 'Parent' })
    child = await fixture.seed(resourceName, { name: 'Child' }, { constructor: { data: { type: resourceName, id: parent.id } } })
  })
  after(async () => fixture?.close())
  for (const format of ['jsonapi', 'plain']) {
    it(`includes a polymorphic resource whose type is inherited on ordinary objects (${format})`, async () => {
      const result = await fixture.api.resources[resourceName].get({ id: child.id, format, queryParams: { include: ['constructor'] } })
      const included = format === 'plain' ? result.constructor : result.included[0]
      assert.equal(included.id, parent.id)
      assert.equal(format === 'plain' ? included.name : included.attributes.name, 'Parent')
    })
    it(`preserves the empty-relationship representation for a prototype-named alias (${format})`, async () => {
      const result = await fixture.api.resources[resourceName].get({ id: parent.id, format, queryParams: { include: ['constructor'] } })
      if (format === 'plain') assert.equal(Object.hasOwn(result, 'constructor'), false)
      else assert.deepEqual(result.data.relationships.constructor.data, null)
    })
  }
})
