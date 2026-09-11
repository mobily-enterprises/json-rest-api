import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { items: 'schema_enrichment_items' }
const createFixture = apiOptions => createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions })

async function rejectConfiguration (options, expected) {
  let fixture
  try {
    await assert.rejects(async () => { fixture = await createFixture(options) }, expected)
  } finally { await fixture?.close() }
}

for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  describe(`Unregistered plugin name ${name} (${storageMode.mode})`, () => {
    it('rejects an inherited row-policy name at registration', async () => {
      await rejectConfiguration({ rowPolicyOptions: {}, resourceOptions: { rowPolicy: name } }, /Unknown row policy/)
    })

    it('rejects an inherited resolver name at registration', async () => {
      await rejectConfiguration({
        autofilterOptions: {},
        resourceOptions: { autofilter: [{ field: 'name', resolver: name }] }
      }, /Unknown autofilter resolver/)
    })

    it('rejects an inherited preset name as unknown', async () => {
      await rejectConfiguration({ autofilterOptions: {}, resourceOptions: { autofilter: name } }, /Unknown autofilter preset/)
    })

    it('rejects an inherited schema field at registration', async () => {
      await rejectConfiguration({
        autofilterOptions: {},
        resourceOptions: { autofilter: [{ field: name, resolve: () => 'value' }] }
      }, /Autofilter field .* does not exist/)
    })
  })

  describe(`Explicit plugin name ${name} (${storageMode.mode})`, () => {
    let fixture, allow, policyCalls
    before(async () => {
      fixture = await createFixture({
        autofilterOptions: {
          resolvers: Object.fromEntries([[name, () => 'visible']]),
          presets: Object.fromEntries([[name, [{ field: 'name', resolver: name }]]])
        },
        rowPolicyOptions: { policies: Object.fromEntries([[name, () => { policyCalls++; return allow }]]) },
        resourceOptions: { rowPolicy: name, autofilter: name }
      })
    })
    beforeEach(async () => { await fixture.reset(); allow = true; policyCalls = 0 })
    after(async () => fixture?.close())

    it('uses explicitly registered own entries and evaluates policy state per request', async () => {
      const resource = fixture.api.resources.items
      await fixture.seed('items', {})
      const visible = await resource.query()
      assert.equal(visible.data.length, 1)
      assert.equal(visible.data[0].attributes.name, 'visible')
      assert.ok(fixture.api.autofilter.getConfig().resolvers.includes(name))
      assert.ok(fixture.api.rowPolicies.getConfig().policies.includes(name))
      assert.ok(policyCalls > 0)
      allow = false
      assert.equal((await resource.query()).data.length, 0)
    })
  })
}

describe(`Installed plugin configuration ownership (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    const resolvers = { selected: () => 'installed', replacement: () => 'mutated' }
    const presets = { selected: [{ field: 'name', resolver: 'selected' }] }
    const policies = { selected: () => true }
    fixture = await createFixture({
      autofilterOptions: { resolvers, presets },
      rowPolicyOptions: { policies },
      resourceOptions: { autofilter: 'selected', rowPolicy: 'selected' },
      hooks: {
        'schema:enrich': {
          functionName: 'mutate-authored-plugin-input-after-install',
          handler: () => {
            presets.selected[0].resolver = 'replacement'
            resolvers.selected = () => 'mutated'
            policies.selected = () => false
          }
        }
      }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())

  it('captures preset declarations and callback maps at plugin installation', async () => {
    await fixture.seed('items', {})
    const result = await fixture.api.resources.items.query()
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].attributes.name, 'installed')
    assert.equal(fixture.api.autofilter.getScopeConfig('items').filters[0].resolver, 'selected')
  })
})

if (storageMode.mode === 'anyapi') {
  describe('Autofilter compiled owner replacement', () => {
    let fixture, alias, removeField
    const observed = []
    before(async () => {
      alias = 'owner'
      removeField = false
      fixture = await createFixture({
        autofilterOptions: {},
        fields: { ownerId: { type: 'id', belongsTo: 'items', as: 'owner', nullable: true } },
        resourceOptions: {
          autofilter: [{ field: 'ownerId', resolve: ({ filter }) => { observed.push(filter.fieldDef.as); return null } }]
        },
        hooks: {
          'schema:enrich': {
            functionName: 'change-autofilter-field',
            handler: ({ context }) => {
              if (removeField) delete context.fields.ownerId
              else context.fields.ownerId.as = alias
            }
          }
        }
      })
    })
    beforeEach(async () => { await fixture.reset(); observed.length = 0 })
    after(async () => fixture?.close())
    it('refreshes resolver metadata after supported recompilation', async () => {
      alias = 'currentOwner'
      await fixture.api.resources.items.addKnexFields({ fields: { extra: { type: 'string', nullable: true } } })
      await fixture.seed('items', { name: 'Current' })
      assert.ok(observed.length > 0)
      assert.ok(observed.every(value => value === 'currentOwner'), JSON.stringify(observed))
    })
    it('rejects invalid candidate filter metadata before replacing the resource', async () => {
      const resource = fixture.api.resources.items
      const original = resource.vars.schemaInfo
      removeField = true
      try {
        await assert.rejects(resource.addKnexFields({ fields: { rejected: { type: 'string', nullable: true } } }), /Autofilter field 'ownerId' does not exist/)
      } finally { removeField = false }
      assert.equal(resource.vars.schemaInfo, original)
      const descriptor = await fixture.api.anyapi.registry.getDescriptor(fixture.api.anyapi.tenantId, 'items')
      assert.equal(Object.hasOwn(descriptor.fields, 'rejected'), false)
      await fixture.seed('items', { name: 'Still valid' })
      assert.ok(observed.every(value => value === 'currentOwner'))
    })
  })
}

describe(`Compiled plugin metadata publication (${storageMode.mode})`, () => {
  let fixture, candidate
  before(async () => {
    fixture = await createFixture({
      autofilterOptions: {},
      resourceOptions: { autofilter: [{ field: 'name', resolve: () => 'owned' }] },
      hooks: {
        'schema:compiled': {
          functionName: 'observe-compiled-plugin-metadata',
          handler: ({ context }) => { candidate = context.schemaInfo }
        }
      }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())
  it('publishes owned plugin metadata with aliases to the final field definitions', async () => {
    const published = fixture.api.resources.items.vars.schemaInfo
    assert.notEqual(candidate, published)
    assert.equal(published.autofilter.filters[0].fieldDef, published.schemaStructure.name)
    candidate.autofilter.filters.length = 0
    assert.equal(fixture.api.autofilter.getScopeConfig('items').filters.length, 1)
    const record = await fixture.seed('items', {})
    assert.equal(record.attributes.name, 'owned')
  })
})
