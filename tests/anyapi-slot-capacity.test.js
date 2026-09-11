import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAnyApiFieldEvolutionApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { cleanTables } from './helpers/test-utils.js'

const tables = ['any_links', 'any_records', 'any_relationship_configs', 'any_field_configs', 'any_resource_configs']
const tenant = 'field_evolution'
const pools = [
  ['string', 10, { type: 'string' }],
  ['number', 10, { type: 'number' }],
  ['boolean', 5, { type: 'boolean' }],
  ['date', 5, { type: 'dateTime' }],
  ['json', 5, { type: 'object' }],
  ['belongsTo', 5, { type: 'id', belongsTo: 'groups' }]
]

describe('Canonical slot capacity preserves metadata on rejection', () => {
  let fixture, registry
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'anyapi', createApi: createAnyApiFieldEvolutionApi })
    registry = fixture.api.anyapi.registry
  })
  beforeEach(async () => {
    await cleanTables(fixture.knex, tables, { storage: 'knex' })
    registry.cache.clear()
  })
  after(async () => { await fixture?.close() })
  const snapshot = async () => {
    const result = {}
    for (const table of tables) result[table] = await fixture.knex(table).orderBy('id')
    return result
  }
  for (const [pool, count, definition] of pools) {
    for (const operation of ['register new', 'register existing', 'allocate field']) {
      it(`${operation} rejects exhausted ${pool} slots without persisting or caching partial metadata`, async () => {
        const schema = { id: { type: 'id' }, ...Object.fromEntries(Array.from({ length: count }, (_, index) => [`field${index}`, { ...definition }])) }
        let cached = null
        if (operation !== 'register new') cached = await registry.registerResource({ tenant, resource: 'items', schema })
        const beforeState = await snapshot()
        const run = operation === 'allocate field'
          ? registry.allocateField({ tenant, resource: 'items', fieldName: 'extra', definition })
          : registry.registerResource({ tenant, resource: 'items', schema: { ...schema, extra: definition } })
        await assert.rejects(run, new RegExp(`No available ${pool} slots remaining`))
        assert.deepEqual(await snapshot(), beforeState)
        assert.deepEqual(await registry.getDescriptor(tenant, 'items'), cached)
        assert.deepEqual(await registry.getDescriptor(tenant, 'items', { bypassCache: true }), cached)
      })
    }
  }
})
