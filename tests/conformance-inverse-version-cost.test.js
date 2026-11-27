import { describe, it } from 'node:test'
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
  // Ten moves of an item between two versioned groups, beside `unrelated` versioned resources the item never reaches.
  async function moveCost (unrelated) {
    const fixture = await createConformanceFixture({ createApi: createVersionedFanApi, apiOptions: { unrelated }, tables })
    try {
      const { api } = fixture
      const first = await fixture.seed('groups', { name: 'First' })
      const second = await fixture.seed('groups', { name: 'Second' })
      const item = await fixture.seed('items', { name: 'Moved' }, link(first))
      const move = group => api.resources.items.patch({ id: item.id, document: { data: { type: 'items', id: item.id, relationships: link(group) } } })
      const revision = async group => (await api.resources.groups.get({ id: group.id, format: 'plain' })).revision
      await move(second)
      const before = await revision(first)
      const names = Array.from({ length: unrelated }, (_, index) => `shelves_${index}`)
      const reads = await relationshipReads(api, names, async () => {
        for (let index = 0; index < 10; index += 1) await move(index % 2 ? second : first)
      })
      assert.notEqual(await revision(first), before, 'the moves still advance the groups they leave and join')
      return reads
    } finally {
      await fixture.close()
    }
  }

  it('reads the relationships of the resources that reference the written one, at 5 unrelated resources as at 50', async () => {
    assert.equal(await moveCost(50), await moveCost(5))
  })

  it('takes in a versioned resource added after the writes before it', {
    skip: storageMode.mode === 'anyapi' && "anyapi storage keys a hasMany by the target's own belongsTo, which names groups"
  }, async () => {
    const fixture = await createConformanceFixture({ createApi: createVersionedFanApi, tables })
    try {
      const { api, knex } = fixture
      const first = await fixture.seed('groups', { name: 'First' })
      const second = await fixture.seed('groups', { name: 'Second' })
      const item = await fixture.seed('items', { name: 'Moved' }, link(first))
      const move = group => api.resources.items.patch({ id: item.id, document: { data: { type: 'items', id: item.id, relationships: link(group) } } })
      await move(second)
      await addVersionedTeams(knex, api)
      // Teams with the groups' ids, in a table of their own.
      const teams = [await fixture.seed('teams', { name: 'First team' }), await fixture.seed('teams', { name: 'Second team' })]
      assert.deepEqual(teams.map(team => team.id), [first.id, second.id])
      const revision = async team => (await api.resources.teams.get({ id: team.id, format: 'plain' })).revision
      const before = [await revision(teams[0]), await revision(teams[1])]
      await move(first)
      assert.notEqual(await revision(teams[0]), before[0])
      assert.notEqual(await revision(teams[1]), before[1])
    } finally {
      await fixture.close()
    }
  })
})
