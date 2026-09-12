import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createFieldDependenciesApi, createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createJsonApiDocument } from './helpers/test-utils.js'

describe(`Transitive field dependencies (${storageMode.mode})`, () => {
  let fixture, group, item, failField
  const calls = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createFieldDependenciesApi,
      apiOptions: {
        onCall: async event => {
          await Promise.resolve()
          calls.push(`${event.resourceType}:${event.id}:${event.field}`)
          if (event.field === failField) throw new Error(`Failure in ${event.field}`)
        }
      }
    })
  })
  beforeEach(async () => {
    failField = undefined
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group', base: 'group', upperSource: 'source', suffix: 'middle', secret: 'PRIVATE' })
    item = await fixture.seed('items', { name: 'Item', base: 'item', upperSource: 'source', suffix: 'middle', secret: 'SECRET' }, { group: { data: { type: 'groups', id: group.id } } })
    calls.length = 0
  })
  after(async () => fixture?.close())

  for (const format of ['jsonapi', 'plain']) {
    it(`orders and deduplicates callbacks through full and sparse reads (${format})`, async () => {
      for (const sparse of [false, true]) {
        calls.length = 0
        const queryParams = sparse ? { fields: { items: 'final,final' } } : {}
        const result = await fixture.api.resources.items.get({ id: item.id, format, queryParams })
        const attributes = format === 'plain' ? result : result.data.attributes
        assert.equal(attributes.final, '<item:middle:ITEM:source>|item:middle:ITEM:source|ITEM')
        assert.equal(attributes.base, undefined)
        assert.equal(attributes.projected, undefined)
        assert.equal(attributes.middle, undefined)
        assert.equal(attributes.secret, undefined)
        assert.equal(attributes.hiddenIntermediate, undefined)
        assert.equal(attributes.secretLength, undefined)
        assert.deepEqual(calls, ['suffix', 'upperSource', 'middle', 'final', ...(sparse ? [] : ['side'])].map(field => `items:${item.id}:${field}`))
        if (sparse) assert.deepEqual(Object.keys(attributes).sort(), format === 'plain' ? ['final', 'id'] : ['final'])
      }
    })

    it(`fetches getter dependencies without requiring their own getter (${format})`, async () => {
      const result = await fixture.api.resources.items.get({ id: item.id, format, queryParams: { fields: { items: 'upperSource' } } })
      const attributes = format === 'plain' ? result : result.data.attributes
      assert.equal(attributes.upperSource, 'item:middle:ITEM:source')
      assert.equal(attributes.base, undefined)
      assert.deepEqual(calls, ['suffix', 'upperSource'].map(field => `items:${item.id}:${field}`))
    })

    it(`resolves logical ID dependencies through the callback context (${format})`, async () => {
      const result = await fixture.api.resources.items.get({ id: item.id, format, queryParams: { fields: { items: 'identity' } } })
      const attributes = format === 'plain' ? result : result.data.attributes
      assert.equal(attributes.identity, item.id)
      assert.equal(attributes.record_key, undefined)
      assert.deepEqual(calls, [])
    })

    it(`computes dependency closures for main and included query records (${format})`, async () => {
      const result = await fixture.api.resources.items.query({ format, queryParams: { include: ['group'], fields: { items: 'final,group', groups: 'final' } } })
      const main = format === 'plain' ? result.data[0] : result.data[0].attributes
      const included = format === 'plain' ? result.data[0].group : result.included[0].attributes
      assert.equal(main.final, '<item:middle:ITEM:source>|item:middle:ITEM:source|ITEM')
      assert.equal(included.final, '<group:middle:GROUP:source>|group:middle:GROUP:source|GROUP')
      assert.equal(included.base, undefined)
      assert.equal(included.middle, undefined)
      for (const [type, id] of [['items', item.id], ['groups', group.id]]) {
        assert.deepEqual(calls.filter(call => call.startsWith(`${type}:`)), ['suffix', 'upperSource', 'middle', 'final'].map(field => `${type}:${id}:${field}`))
      }
    })

    it(`allows declared private dependencies without returning private fields (${format})`, async () => {
      const result = await fixture.api.resources.items.get({ id: item.id, format, queryParams: { fields: { items: 'secretLength,secret,hiddenIntermediate' } } })
      const attributes = format === 'plain' ? result : result.data.attributes
      assert.equal(attributes.secretLength, '6')
      assert.equal(attributes.secret, undefined)
      assert.equal(attributes.hiddenIntermediate, undefined)
      assert.deepEqual(calls, [`items:${item.id}:hiddenIntermediate`])
    })
  }

  it('does not execute unrelated computed callbacks for sparse reads', async () => {
    failField = 'side'
    const result = await fixture.api.resources.items.get({ id: item.id, queryParams: { fields: { items: 'final' } } })
    assert.equal(result.data.attributes.final, '<item:middle:ITEM:source>|item:middle:ITEM:source|ITEM')
    assert.equal(calls.some(call => call.endsWith(':side')), false)
  })

  it('does not execute hidden computed fields merely because they were requested', async () => {
    const result = await fixture.api.resources.items.get({ id: item.id, queryParams: { fields: { items: 'secret,hiddenIntermediate' } } })
    assert.deepEqual(result.data.attributes, {})
    assert.deepEqual(calls, [])
  })

  it('stops dependent callbacks and rolls back an owned write when a dependency fails', async () => {
    failField = 'middle'
    await assert.rejects(fixture.api.resources.items.patch({
      id: item.id,
      document: createJsonApiDocument('items', { base: 'changed' }),
      queryParams: { fields: { items: 'final' } }
    }), /Computation for field 'middle' failed/)
    assert.deepEqual(calls, ['suffix', 'upperSource', 'middle'].map(field => `items:${item.id}:${field}`))
    failField = undefined
    const result = await fixture.api.resources.items.get({ id: item.id, queryParams: { fields: { items: 'base' } } })
    assert.equal(result.data.attributes.base, 'item')
  })

  if (storageMode.isAnyApi()) {
    it('recompiles added dependencies and preserves the active graph after rejection', async () => {
      const items = fixture.api.resources.items
      await items.addKnexFields({
        fields: {
          tail: { type: 'string', computed: true, dependencies: ['final', 'final'], compute: ({ attributes }) => `${attributes.final}!` }
        }
      })
      const result = await items.get({ id: item.id, queryParams: { fields: { items: 'tail' } } })
      assert.deepEqual(result.data.attributes, { tail: '<item:middle:ITEM:source>|item:middle:ITEM:source|ITEM!' })
      assert.deepEqual(calls, ['suffix', 'upperSource', 'middle', 'final'].map(field => `items:${item.id}:${field}`))
      const schemaInfo = items.vars.schemaInfo
      await assert.rejects(items.addKnexFields({
        fields: {
          invalid: { type: 'string', computed: true, dependencies: ['invalid'], compute: () => '' }
        }
      }), /Circular dependency detected/)
      assert.equal(items.vars.schemaInfo, schemaInfo)
      for (const fields of [
        { projected: { type: 'string' } },
        { projected: { type: 'string', computed: true, compute: () => '' } },
        { otherGroup: { type: 'id', belongsTo: 'groups', as: 'projected' } }
      ]) {
        await assert.rejects(items.addKnexFields({ fields }), /conflicts with an existing schema, computed, or relationship name/)
        assert.equal(items.vars.schemaInfo, schemaInfo)
      }
      assert.deepEqual((await items.get({ id: item.id, queryParams: { fields: { items: 'tail' } } })).data.attributes, result.data.attributes)
    })
  }
})

describe(`Projection getter dependencies (${storageMode.mode})`, () => {
  let fixture, item, failure
  const calls = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        projections: true,
        fields: {
          amount: { type: 'number', hidden: true, getter: value => { calls.push('amount'); return value * 2 } },
          summary: { type: 'string', computed: true, dependencies: ['projected'], compute: ({ attributes }) => { calls.push('summary'); return `Value ${attributes.projected}` } }
        },
        resourceOptions: {
          queryFields: {
            projected: {
              type: 'number',
              hidden: true,
              select: ({ knex, column }) => knex.raw('??', [column('amount')]),
              runGetterAfter: ['amount'],
              getter: async (value, { attributes }) => {
                await Promise.resolve()
                calls.push('projected')
                if (failure) throw failure
                return value + attributes.amount
              }
            }
          }
        }
      }
    })
  })
  beforeEach(async () => {
    failure = null
    await fixture.reset()
    item = await fixture.seed('items', { name: 'Stored', amount: 2 })
    calls.length = 0
  })
  after(async () => fixture?.close())

  for (const format of ['jsonapi', 'plain']) {
    for (const method of ['get', 'query']) {
      it(`awaits a hidden projection getter before computed output (${method}, ${format})`, async () => {
        const result = await fixture.api.resources.items[method]({ id: item.id, format, queryParams: { fields: { items: 'summary' } } })
        const record = method === 'query' ? result.data[0] : format === 'plain' ? result : result.data
        assert.deepEqual(format === 'plain' ? record : record.attributes, format === 'plain' ? { id: item.id, summary: 'Value 6' } : { summary: 'Value 6' })
        assert.deepEqual(calls, ['amount', 'projected', 'summary'])
      })
    }
  }

  it('propagates a projection getter failure before computed output runs', async () => {
    failure = new Error('Projection getter failed')
    await assert.rejects(fixture.api.resources.items.get({ id: item.id }), error => {
      assert.equal(error.cause, failure)
      return true
    })
    assert.deepEqual(calls, ['amount', 'projected'])
  })
})

describe(`Invalid field dependency declarations (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables: { items: 'schema_enrichment_items' } })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())

  for (const [definition, message] of [
    [{ getter: 'invalid' }, /invalid getter function/],
    [{ getter: value => value, runGetterAfter: ['missing'] }, /dependency 'missing'/],
    [{ getter: value => value, runGetterAfter: ['projected'] }, /Invalid getter dependencies/],
    [{ setter: value => value }, /projections are read-only/],
    [{ runSetterAfter: ['name'] }, /projections are read-only/],
    [{ storage: { serialize: value => value } }, /cannot declare storage/],
    [{ storage: { column: 'amount' } }, /cannot declare storage/]
  ]) {
    it(`rejects invalid projection callback ${Object.keys(definition).join(', ')} ${message}`, async () => {
      await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
        projections: true,
        resourceOptions: { queryFields: { projected: { type: 'string', select: ({ knex }) => knex.raw("'value'"), ...definition } } }
      }), message)
    })
  }

  for (const [kind, property, callback] of [
    ['getter', 'runGetterAfter', 'getter'],
    ['setter', 'runSetterAfter', 'setter'],
    ['computed', 'dependencies', 'compute']
  ]) {
    const definition = dependencies => ({ type: 'string', ...(kind === 'computed' ? { computed: true } : {}), [callback]: () => 'Value', [property]: dependencies })
    for (const dependencies of ['name', null, [3], ['']]) {
      it(`rejects ${kind} dependency shape ${JSON.stringify(dependencies)}`, async () => {
        await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
          fields: { target: definition(dependencies) }
        }), /array of nonempty field names/)
      })
    }
    it(`rejects inherited object names as undeclared ${kind} dependencies`, async () => {
      await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
        fields: { target: definition(['constructor']) }
      }), /dependency 'constructor' that does not exist/)
    })
  }

  it('rejects a missing computed dependency before registration', async () => {
    await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
      fields: { target: { type: 'string', computed: true, compute: () => '', dependencies: ['missing'] } }
    }), /computed dependency 'missing' that does not exist/)
  })
  it('rejects a computed dependency cycle before registration', async () => {
    await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
      fields: {
        first: { type: 'string', computed: true, compute: () => '', dependencies: ['second'] },
        second: { type: 'string', computed: true, compute: () => '', dependencies: ['first'] }
      }
    }), /Circular dependency detected/)
  })
  it('rejects a getter depending on a later computed stage', async () => {
    await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
      fields: {
        first: { type: 'string', getter: value => value, runGetterAfter: ['second'] },
        second: { type: 'string', computed: true, compute: () => '' }
      }
    }), /unavailable at that stage/)
  })
  it('rejects a dependency on a projection without its declaration plugin', async () => {
    await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
      fields: { target: { type: 'string', computed: true, compute: () => '', dependencies: ['projected'] } },
      resourceOptions: { queryFields: { projected: { type: 'string', select: ({ knex }) => knex.raw("'value'") } } }
    }), /computed dependency 'projected' that does not exist/)
  })
  it('rejects a getter dependency on a field represented as relationship linkage', async () => {
    await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
      fields: {
        parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true },
        target: { type: 'string', getter: value => value, runGetterAfter: ['parentId'] }
      }
    }), /unavailable at that stage/)
  })
  it('rejects computed dependencies on polymorphic relationship backing fields', async () => {
    await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
      fields: {
        subjectId: { type: 'id', nullable: true },
        subjectType: { type: 'string', nullable: true },
        target: { type: 'string', computed: true, compute: () => '', dependencies: ['subjectType'] }
      },
      resourceOptions: { relationships: { subject: { belongsToPolymorphic: { types: ['items'], typeField: 'subjectType', idField: 'subjectId' } } } }
    }), /unavailable at that stage/)
  })
  for (const queryFields of [[], { id: { type: 'string', select: () => {} } }]) {
    it(`rejects invalid projection configuration ${JSON.stringify(queryFields)}`, async () => {
      await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
        projections: true, resourceOptions: { queryFields }
      }), Array.isArray(queryFields) ? /Expected an object/ : /conflicts with an existing schema/)
    })
  }
  for (const callback of ['getter', 'setter']) {
    it(`rejects a non-function ${callback} instead of silently ignoring it`, async () => {
      await assert.rejects(createSchemaEnrichmentApi(fixture.knex, {
        fields: { target: { type: 'string', [callback]: false } }
      }), new RegExp(`invalid ${callback} function`))
    })
  }
})

describe(`Dependencies on input fields without setters (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        fields: {
          base: { type: 'integer' },
          doubled: { type: 'integer', runSetterAfter: ['base'], setter: (_, { attributes }) => attributes.base * 2 }
        }
      }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())
  it('runs the dependent setter after validated input is available', async () => {
    const item = await fixture.seed('items', { name: 'Setter', base: 4 })
    assert.equal(item.attributes.doubled, 8)
    const result = await fixture.api.resources.items.patch({ id: item.id, document: createJsonApiDocument('items', { base: 5 }) })
    assert.equal(result.data.attributes.doubled, 10)
  })
})

describe(`Virtual input dependencies (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    const schema = {
      name: { type: 'string' },
      virtualSource: {
        type: 'string',
        virtual: true,
        runGetterAfter: ['name'],
        getter: (value, { attributes, originalValue, originalAttributes }) => {
          assert.equal(originalValue, value)
          assert.equal(originalAttributes.virtualSource, value)
          return `${attributes.name}:${value.toUpperCase()}`
        }
      },
      unusedVirtual: { type: 'string', virtual: true, hidden: true, getter: () => { throw new Error('Unselected virtual getter') } },
      result: { type: 'string', computed: true, dependencies: ['virtualSource'], compute: ({ attributes }) => attributes.virtualSource ?? 'absent' }
    }
    fixture = await createConformanceFixture({
      apiOptions: {
        groupOptions: { schema },
        itemOptions: {
          schema: {
            ...schema,
            parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true },
            groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true }
          },
          sortableFields: ['id', 'name']
        }
      }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())
  it('uses available virtual input after its getter without treating it as a stored column', async () => {
    const created = await fixture.api.resources.items.post({
      document: createJsonApiDocument('items', { name: 'Virtual', virtualSource: 'value' }),
      queryParams: { fields: { items: 'result' } }
    })
    assert.deepEqual(created.data.attributes, { result: 'Virtual:VALUE' })
    const read = await fixture.api.resources.items.get({ id: created.data.id, queryParams: { fields: { items: 'result' } } })
    assert.deepEqual(read.data.attributes, { result: 'absent' })
  })

  it('fetches dependencies of a directly selected virtual getter and skips unused virtual callbacks', async () => {
    const created = await fixture.api.resources.items.post({
      document: createJsonApiDocument('items', { name: 'Virtual', virtualSource: 'value', unusedVirtual: 'unused' }),
      queryParams: { fields: { items: 'virtualSource,unusedVirtual' } }
    })
    assert.deepEqual(created.data.attributes, { virtualSource: 'Virtual:VALUE' })
  })

  for (const format of ['jsonapi', 'plain']) {
    for (const method of ['post', 'patch', 'put']) {
      it(`keeps virtual input on its owner when ${method} includes other records (${format})`, async () => {
        const group = await fixture.seed('groups', { name: 'Group' })
        const parent = await fixture.seed('items', { name: 'Parent' })
        const item = method === 'post' ? null : await fixture.seed('items', { name: 'Item' })
        const result = await fixture.api.resources.items[method]({
          ...(item ? { id: item.id } : {}),
          format,
          [format === 'plain' ? 'data' : 'document']: format === 'plain'
            ? { name: 'Owner', virtualSource: 'owner', group: group.id, parent: parent.id }
            : createJsonApiDocument('items', { name: 'Owner', virtualSource: 'owner' }, {
              group: { data: { type: 'groups', id: group.id } },
              parent: { data: { type: 'items', id: parent.id } }
            }),
          queryParams: { include: ['group', 'parent'], fields: { items: 'result,group,parent', groups: 'result' } }
        })
        const main = format === 'plain' ? result : result.data.attributes
        assert.equal(main.result, 'Owner:OWNER')
        const included = format === 'plain' ? [result.group, result.parent] : result.included.map(record => record.attributes)
        assert.equal(included.length, 2)
        for (const record of included) assert.equal(record.result, 'absent')
      })
    }
  }

  it('ignores inherited input belonging to a different primary resource', async () => {
    const item = await fixture.seed('items', { name: 'Item' })
    for (const [type, id] of [['groups', item.id], ['items', '999']]) {
      const inputRecord = createJsonApiDocument(type, { virtualSource: 'unrelated' })
      inputRecord.data.id = id
      for (const method of ['get', 'query']) {
        const result = await fixture.api.resources.items[method]({
          ...(method === 'get' ? { id: item.id } : {}),
          queryParams: { fields: { items: 'result' } }
        }, { inputRecord })
        const record = method === 'get' ? result.data : result.data[0]
        assert.deepEqual(record.attributes, { result: 'absent' })
      }
    }
  })
})
