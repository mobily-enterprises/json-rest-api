import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { addVersionedTeams, createVersionedFanApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { items: 'conformance_items', groups: 'conformance_groups' }
const link = group => ({ group: { data: { type: 'groups', id: group.id } } })

// Counts the reads of each named resource's relationships while `work` runs.
async function relationshipReads (api, names, work) {
  let reads = 0
  const published = names.map(name => [name, api.resources[name].vars.schemaInfo])
  for (const [name, schemaInfo] of published) {
    api.resources[name].vars.schemaInfo = new Proxy(schemaInfo, {
      get (target, property, receiver) {
        if (property === 'schemaRelationships') reads += 1
        return Reflect.get(target, property, receiver)
      }
    })
  }
  try {
    await work()
  } finally {
    for (const [name, schemaInfo] of published) api.resources[name].vars.schemaInfo = schemaInfo
  }
  return reads
}

describe(`Inverse revisions follow the references to the written resource (${storageMode.mode})`, () => {
  // Beside 5 and 50 versioned resources an item never reaches, and beside none for a resource added later.
  const fixtures = {}
  before(async () => {
    for (const [size, unrelated] of [['few', 5], ['many', 50], ['none', 0]]) {
      fixtures[size] = await createConformanceFixture({ createApi: createVersionedFanApi, apiOptions: { unrelated }, tables })
    }
  })
  after(async () => {
    for (const fixture of Object.values(fixtures)) await fixture.close()
  })

  // An item seeded in the first of two groups, and how to move it.
  async function movable (fixture) {
    const first = await fixture.seed('groups', { name: 'First' })
    const second = await fixture.seed('groups', { name: 'Second' })
    const item = await fixture.seed('items', { name: 'Moved' }, link(first))
    const move = group => fixture.api.resources.items.patch({ id: item.id, document: { data: { type: 'items', id: item.id, relationships: link(group) } } })
    return { first, second, move }
  }

  // Ten moves of the item between the groups, counting the reads of the unrelated resources' relationships.
  async function moveCost (fixture, unrelated) {
    const { api } = fixture
    const { first, second, move } = await movable(fixture)
    const revision = async group => (await api.resources.groups.get({ id: group.id, format: 'plain' })).revision
    await move(second)
    const earlier = await revision(first)
    const names = Array.from({ length: unrelated }, (_, index) => `shelves_${index}`)
    const reads = await relationshipReads(api, names, async () => {
      for (let index = 0; index < 10; index += 1) await move(index % 2 ? second : first)
    })
    assert.notEqual(await revision(first), earlier, 'the moves still advance the groups they leave and join')
    return reads
  }

  it('reads the relationships of the resources that reference the written one, at 5 unrelated resources as at 50', async () => {
    assert.equal(await moveCost(fixtures.many, 50), await moveCost(fixtures.few, 5))
  })

  it('takes in a versioned resource added after the writes before it', {
    skip: storageMode.mode === 'anyapi' && "anyapi storage keys a hasMany by the target's own belongsTo, which names groups"
  }, async () => {
    const fixture = fixtures.none
    const { api, knex } = fixture
    const { first, second, move } = await movable(fixture)
    await move(second)
    await addVersionedTeams(knex, api)
    // Teams with the groups' ids, in a table of their own.
    const teams = [await fixture.seed('teams', { name: 'First team' }), await fixture.seed('teams', { name: 'Second team' })]
    assert.deepEqual(teams.map(team => team.id), [first.id, second.id])
    const revision = async team => (await api.resources.teams.get({ id: team.id, format: 'plain' })).revision
    const earlier = [await revision(teams[0]), await revision(teams[1])]
    await move(first)
    assert.notEqual(await revision(teams[0]), earlier[0])
    assert.notEqual(await revision(teams[1]), earlier[1])
  })
})
