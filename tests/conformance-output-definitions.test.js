import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { findRelationshipDefinition } from '../plugins/core/lib/querying-writing/relationship-contracts.js'
import { toJsonApiRecord } from '../plugins/core/lib/querying/knex-json-api-transformers-querying.js'
import enrichAttributesMethod from '../plugins/core/rest-api-plugin-methods/enrich-attributes.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Compiled output definition indexes (${storageMode.mode})`, () => {
  let fixture, parent, child
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        projections: true,
        fields: {
          active: { type: 'boolean' },
          privateValue: { type: 'string', hidden: true },
          optInValue: { type: 'string', normallyHidden: true },
          derived: { type: 'boolean', computed: true, compute: () => 1 },
          parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true }
        },
        resourceOptions: {
          queryFields: { projected: { type: 'boolean', select: ({ knex }) => knex.raw('1') } },
          relationships: { children: { type: 'hasMany', target: 'items', foreignKey: 'parentId' } }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    parent = await fixture.seed('items', { name: 'parent', active: true })
    child = await fixture.seed('items', { name: 'child', active: false }, { parent: { data: { type: 'items', id: parent.id } } })
  })
  after(async () => fixture?.close())

  it('indexes the existing definitions without copying their identities', () => {
    const info = fixture.api.resources.items.vars.schemaInfo
    assert.equal(info.outputFields.active, info.schemaStructure.active)
    assert.equal(info.outputFields.derived, info.computed.derived)
    assert.equal(info.outputFields.projected, info.queryFields.projected)
    assert.equal(info.outputRelationships.parent, info.schemaStructure.parentId)
    assert.equal(info.outputRelationships.children, info.schemaRelationships.children)
  })

  it('resolves relationship names from the compiled index without scanning source declarations', () => {
    const info = fixture.api.resources.items.vars.schemaInfo
    const indexed = new Proxy(info, {
      get (target, key, receiver) {
        if (key === 'schemaStructure' || key === 'schemaRelationships') throw new Error('Source declarations read during lookup')
        return Reflect.get(target, key, receiver)
      }
    })
    assert.equal(findRelationshipDefinition(indexed, 'parent'), info.schemaStructure.parentId)
    assert.equal(findRelationshipDefinition(indexed, 'children'), info.schemaRelationships.children)
    for (const name of ['missing', 'constructor', 'toString']) assert.equal(findRelationshipDefinition(indexed, name), null)
  })

  it('converts using compiled membership without reading relationship declarations again', () => {
    const info = fixture.api.resources.items.vars.schemaInfo
    const schemaInfo = new Proxy(info, {
      get (target, key, receiver) {
        if (key === 'schemaRelationships') throw new Error('Relationship declarations read during conversion')
        return Reflect.get(target, key, receiver)
      }
    })
    const scope = { vars: { schemaInfo } }
    assert.deepEqual(toJsonApiRecord(scope, { id: child.id, name: 'child', parentId: parent.id }, 'items'), {
      type: 'items', id: child.id, attributes: { name: 'child' }
    })
  })

  it('filters enrichment output through compiled definitions without rebuilding a field map per record', async () => {
    const info = fixture.api.resources.items.vars.schemaInfo
    const scans = { schemaStructure: 0, computed: 0, queryFields: 0 }
    const schemaInfo = { ...info }
    for (const field of Object.keys(scans)) {
      schemaInfo[field] = new Proxy(info[field], {
        ownKeys (target) { scans[field]++; return Reflect.ownKeys(target) }
      })
    }
    for (const requested of [undefined, { items: 'name,active,derived,projected,privateValue,optInValue' }]) {
      const result = await enrichAttributesMethod({
        context: {},
        scopeName: 'items',
        api: fixture.api,
        helpers: fixture.api.helpers,
        scopes: { items: { vars: { schemaInfo } } },
        params: {
          id: child.id,
          attributes: { name: 'child', active: true, projected: true, privateValue: 'private', optInValue: 'opt-in' },
          requestedComputedFields: ['derived'],
          parentContext: { queryParams: { fields: requested } }
        },
        runHooks: async () => {}
      })
      assert.deepEqual(result, { name: 'child', active: true, projected: true, derived: 1, ...(requested ? { optInValue: 'opt-in' } : {}) })
    }
    // Virtual-field selection still scans stored definitions once per resource.
    assert.deepEqual(scans, { schemaStructure: 2, computed: 0, queryFields: 0 })
    assert.equal(schemaInfo.outputFields, info.outputFields)
  })

  it('retains the compiled foreign-key set without adding resource IDs during reads', async () => {
    const resource = fixture.api.resources.items
    const fields = resource.vars.schemaInfo.foreignKeyFields
    assert.deepEqual([...fields], ['parentId'])
    await resource.get({ id: child.id })
    await resource.query()
    await resource.patch({ id: child.id, returning: 'minimal', document: createJsonApiDocument('items', { active: true }) })
    assert.equal(resource.vars.schemaInfo.foreignKeyFields, fields)
    assert.deepEqual([...fields], ['parentId'])
  })

  for (const format of ['jsonapi', 'plain']) {
    it(`normalizes stored, computed and projected values in primary and included ${format} output`, async () => {
      const resource = fixture.api.resources.items
      const fields = resource.vars.schemaInfo.outputFields
      const result = await resource.get({ id: child.id, format, queryParams: { include: ['parent'] } })
      const attributes = format === 'plain' ? result : result.data.attributes
      const included = format === 'plain' ? result.parent : result.included.find(entry => entry.id === parent.id).attributes
      assert.equal(attributes.active, false)
      assert.equal(included.active, true)
      for (const record of [attributes, included]) {
        assert.equal(record.derived, true)
        assert.equal(record.projected, true)
      }
      assert.equal(resource.vars.schemaInfo.outputFields, fields)
    })
  }

  if (storageMode.mode === 'anyapi') {
    it('retains the published owner after a misplaced polymorphic field addition', async () => {
      const resource = fixture.api.resources.items
      const original = resource.vars.schemaInfo
      await assert.rejects(resource.addKnexFields({
        fields: { misplaced: { type: 'string', as: 'parent', belongsToPolymorphic: { types: ['items'], typeField: 'name', idField: 'parentId' } } }
      }), /Field 'misplaced' in resource 'items' cannot declare belongsToPolymorphic; declare it in relationships/)
      assert.equal(resource.vars.schemaInfo, original)
      assert.equal(findRelationshipDefinition(original, 'parent'), original.schemaStructure.parentId)
      const descriptor = await fixture.api.anyapi.registry.getDescriptor(fixture.api.anyapi.tenantId, 'items')
      assert.equal(Object.hasOwn(descriptor.fields, 'misplaced'), false)
      const result = await resource.get({ id: child.id, queryParams: { include: ['parent'] } })
      assert.deepEqual(result.data.relationships.parent.data, { type: 'items', id: parent.id })
    })

    it('retains the published relationship index after a derived relationship addition is rejected', async () => {
      const resource = fixture.api.resources.items
      const original = resource.vars.schemaInfo
      await assert.rejects(resource.addKnexFields({
        fields: { derivedParent: { type: 'string', computed: true, compute: () => parent.id, belongsTo: 'items', as: 'parent' } }
      }), /Computed field 'derivedParent' in scope 'items' cannot declare relationships/)
      assert.equal(resource.vars.schemaInfo, original)
      assert.equal(original.outputRelationships.parent, original.schemaStructure.parentId)
      assert.equal(Object.hasOwn(original.outputFields, 'derivedParent'), false)
      const result = await resource.get({ id: child.id, format: 'plain', queryParams: { include: ['parent'] } })
      assert.equal(result.parent.id, parent.id)
    })

    it('retains the published schema and data after an alias-colliding field addition', async () => {
      const resource = fixture.api.resources.items
      const original = resource.vars.schemaInfo
      await assert.rejects(resource.addKnexFields({
        fields: {
          conflictingParentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true }
        }
      }), /Relationship name 'parent' in resource 'items' is declared more than once/)
      assert.equal(resource.vars.schemaInfo, original)
      assert.equal(Object.hasOwn(original.schemaStructure, 'conflictingParentId'), false)
      assert.equal(original.foreignKeyFields.has('conflictingParentId'), false)
      const result = await resource.get({ id: child.id, queryParams: { include: ['parent'] } })
      assert.deepEqual(result.data.relationships.parent.data, { type: 'items', id: parent.id })
      const descriptor = await fixture.api.anyapi.registry.getDescriptor(fixture.api.anyapi.tenantId, 'items')
      assert.equal(Object.hasOwn(descriptor.fields, 'conflictingParentId'), false)
    })

    it('refreshes foreign-key membership after adding a belongs-to field', async () => {
      const resource = fixture.api.resources.items
      const original = resource.vars.schemaInfo.foreignKeyFields
      await resource.addKnexFields({ fields: { otherParentId: { type: 'id', belongsTo: 'items', as: 'otherParent', nullable: true } } })
      const fields = resource.vars.schemaInfo.foreignKeyFields
      assert.notEqual(fields, original)
      assert.equal(fields.has('otherParentId'), true)
      assert.equal(original.has('otherParentId'), false)
      const inputRecord = createJsonApiDocument('items', {}, { otherParent: { data: { type: 'items', id: parent.id } } })
      const result = await resource.patch({ id: child.id, document: inputRecord })
      assert.equal(Object.hasOwn(result.data.attributes, 'otherParentId'), false)
      assert.deepEqual(result.data.relationships.otherParent.data, { type: 'items', id: parent.id })
    })

    it('replaces output indexes on a committed field addition', async () => {
      const resource = fixture.api.resources.items
      const original = resource.vars.schemaInfo.outputFields
      await resource.addKnexFields({ fields: { added: { type: 'boolean', nullable: true } } })
      assert.notEqual(resource.vars.schemaInfo.outputFields, original)
      assert.equal(resource.vars.schemaInfo.outputFields.added, resource.vars.schemaInfo.schemaStructure.added)
      const result = await resource.patch({ id: child.id, document: createJsonApiDocument('items', { added: true }) })
      assert.equal(result.data.attributes.added, true)
      assert.equal(Object.hasOwn(original, 'added'), false)
    })
  }
})
