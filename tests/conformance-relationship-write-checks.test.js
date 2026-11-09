import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

// A relationship write checks and locks its targets once per type, and decides
// which links already exist from one read per batch: naming more targets adds
// no statements, and each child of a has-many write costs what patching it
// costs, not another check and lock of the parent they all name.
describe(`Relationship write checks per type, not per target (${storageMode.mode})`, () => {
  let fixture
  const groups = id => ({ type: 'groups', id: String(id) })
  const items = id => ({ type: 'items', id: String(id) })
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: { inverseMembership: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    for (const id of range(1, 8)) await fixture.seed('groups', { name: `Group ${id}` })
    for (const id of range(1, 8)) await fixture.seed('items', { name: `Item ${id}` })
  })
  after(async () => { await fixture?.close() })

  const statements = async operation => {
    let count = 0
    const counted = () => { count++ }
    fixture.knex.on('query', counted)
    try { await operation() } finally { fixture.knex.off('query', counted) }
    return count
  }
  const linkedGroups = async id => (await fixture.api.resources.items.getRelationship({ id, relationshipName: 'groups' })).data.map(row => row.id).sort()

  // Item 1 already links groups 1 and 2; the write adds `added` more.
  const manyToManyWrites = {
    postRelationship: added => fixture.api.resources.items.postRelationship({
      id: '1', relationshipName: 'groups', relationshipData: added.map(groups)
    }),
    patchRelationship: added => fixture.api.resources.items.patchRelationship({
      id: '1', relationshipName: 'groups', relationshipData: [1, 2, ...added].map(groups)
    }),
    patch: added => fixture.api.resources.items.patch({
      id: '1', returning: 'minimal', document: { data: { type: 'items', id: '1', relationships: { groups: { data: [1, 2, ...added].map(groups) } } } }
    })
  }
  for (const [method, write] of Object.entries(manyToManyWrites)) {
    it(`${method} adds many-to-many links beside existing ones in as many statements for 6 targets as for 2`, async () => {
      const counts = []
      for (const added of [range(3, 4), range(3, 8)]) {
        await fixture.api.resources.items.patchRelationship({ id: '1', relationshipName: 'groups', relationshipData: [groups(1), groups(2)] })
        counts.push(await statements(() => write(added)))
        assert.deepEqual(await linkedGroups('1'), [1, 2, ...added].map(String).sort())
      }
      assert.equal(counts[1], counts[0], `statements for 2 and 6 added targets: ${counts}`)
    })
  }

  it('checks and locks the parent of a has-many write once, however many children it links', async () => {
    const perChild = async operation => {
      const counts = []
      for (const children of [range(1, 2), range(1, 4)]) {
        await fixture.reset()
        await fixture.seed('groups', { name: 'Parent' })
        for (const id of range(1, 4)) await fixture.seed('items', { name: `Item ${id}` })
        counts.push(await statements(() => operation(children)))
      }
      return (counts[1] - counts[0]) / 2
    }
    const linking = await perChild(children => fixture.api.resources.groups.postRelationship({
      id: '1', relationshipName: 'items', relationshipData: children.map(items)
    }))
    const members = await fixture.api.resources.groups.getRelationship({ id: '1', relationshipName: 'items' })
    assert.deepEqual(members.data.map(row => row.id).sort(), range(1, 4).map(String))
    // Each child is patched; patching those children's names in one transaction is the floor.
    const patching = await perChild(async children => {
      const unit = await holdManagedTransaction(fixture.api)
      try {
        for (const id of children) {
          await fixture.api.resources.items.patch({
            id: String(id), returning: 'none', transaction: unit.transaction, document: { data: { type: 'items', id: String(id), attributes: { name: 'Renamed' } } }
          })
        }
      } finally { await unit.rollback() }
    })
    assert.equal(linking, patching, `statements per linked child ${linking}, per patched child ${patching}`)
  })

  it('still refuses a has-many write naming a missing child, and links none', async () => {
    await assert.rejects(fixture.api.resources.groups.postRelationship({
      id: '1', relationshipName: 'items', relationshipData: [items(1), items(99), items(2)]
    }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
    const members = await fixture.api.resources.groups.getRelationship({ id: '1', relationshipName: 'items' })
    assert.deepEqual(members.data, [])
  })
})
