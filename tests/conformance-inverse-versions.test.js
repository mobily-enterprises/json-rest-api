import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi, createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createPivotRecords, updateManyToManyRelationship } from '../plugins/core/lib/writing/many-to-many-manipulations.js'

describe(`Inverse resource revisions (${storageMode.mode})`, () => {
  let fixture, first, second
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createQueryConformanceApi,
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' },
      apiOptions: {
        groupOptions: {
          schema: { id: { type: 'id' }, name: { type: 'string', required: true }, revision: { type: 'string', required: true } },
          versionField: 'revision'
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    first = await fixture.seed('groups', { name: 'First' })
    second = await fixture.seed('groups', { name: 'Second' })
  })
  after(async () => { await fixture?.close() })
  const revision = async group => (await fixture.api.resources.groups.get({ id: group.id, format: 'plain' })).revision
  const link = group => ({ group: { data: { type: 'groups', id: group.id } } })

  it('invalidates a parent after child creation and prevents a stale membership replacement', async () => {
    const token = await revision(first)
    const child = await fixture.seed('items', { name: 'Child' }, link(first))
    assert.notEqual(await revision(first), token)
    assert.equal(await revision(second), second.attributes.revision)
    await assert.rejects(fixture.api.resources.groups.patchRelationship({ id: first.id, relationshipName: 'items', relationshipData: [], expectedVersion: token }), error => error.code === 'REST_API_VERSION_CONFLICT')
    assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: first.id, relationshipName: 'items' })).data.map(record => record.id), [child.id])
  })

  it('invalidates both parents when a child moves, but not on an attribute-only edit', async () => {
    const child = await fixture.seed('items', { name: 'Child' }, link(first))
    const oldFirst = await revision(first)
    const oldSecond = await revision(second)
    await fixture.api.resources.items.patch({ id: child.id, inputRecord: { data: { type: 'items', relationships: link(second) } } })
    assert.notEqual(await revision(first), oldFirst)
    assert.notEqual(await revision(second), oldSecond)
    const current = await revision(second)
    await fixture.api.resources.items.patch({ id: child.id, inputRecord: { name: 'Renamed' }, format: 'plain' })
    assert.equal(await revision(second), current)
  })

  it('invalidates parent membership after child deletion and restores it on caller rollback', async () => {
    const child = await fixture.seed('items', { name: 'Child' }, link(first))
    const token = await revision(first)
    const failure = new Error('Caller rollback')
    await assert.rejects(fixture.api.transaction(async transaction => {
      await fixture.api.resources.items.delete({ id: child.id, transaction })
      const changed = await fixture.api.resources.groups.get({ id: first.id, format: 'plain', transaction })
      assert.notEqual(changed.revision, token)
      throw failure
    }), error => error === failure || error.cause === failure)
    assert.equal(await revision(first), token)
    await fixture.api.resources.items.delete({ id: child.id })
    assert.notEqual(await revision(first), token)
  })

  it('tracks PUT-create and PUT replacement references', async () => {
    const put = group => fixture.api.resources.items.put({
      id: '91',
      inputRecord: {
        data: { type: 'items', attributes: { name: 'Child', active: true, score: 0 }, relationships: { ...link(group), collections: { data: [] } } }
      }
    })
    await put(first)
    const token = await revision(first)
    assert.notEqual(token, first.attributes.revision)
    await put(second)
    assert.notEqual(await revision(first), token)
    assert.notEqual(await revision(second), second.attributes.revision)
  })

  for (const method of ['postRelationship', 'patchRelationship', 'deleteRelationship']) {
    it(`invalidates many-to-many inverse revisions through ${method}`, async () => {
      const child = await fixture.seed('items', { name: 'Child' }, { collections: { data: [{ type: 'groups', id: first.id }] } })
      const oldFirst = await revision(first)
      const oldSecond = await revision(second)
      const target = method === 'deleteRelationship' ? first : second
      await fixture.api.resources.items[method]({ id: child.id, relationshipName: 'collections', relationshipData: [{ type: 'groups', id: target.id }] })
      assert.notEqual(await revision(target), target === first ? oldFirst : oldSecond)
      if (method === 'patchRelationship') assert.notEqual(await revision(first), oldFirst)
      else assert.equal(await revision(target === first ? second : first), target === first ? oldSecond : oldFirst)
      await assert.rejects(fixture.api.resources.groups.patchRelationship({ id: target.id, relationshipName: 'members', relationshipData: [], expectedVersion: target === first ? oldFirst : oldSecond }), error => error.code === 'REST_API_VERSION_CONFLICT')
    })
  }

  for (const method of ['post', 'patch', 'put']) {
    it(`invalidates many-to-many inverse revisions through resource ${method}`, async () => {
      const child = method === 'post' ? undefined : await fixture.seed('items', { name: 'Child' }, { collections: { data: [{ type: 'groups', id: first.id }] } })
      const oldFirst = await revision(first)
      const oldSecond = await revision(second)
      await fixture.api.resources.items[method]({
        id: child?.id,
        inputRecord: {
          data: {
            type: 'items',
            attributes: { name: 'Child', active: true, score: 0 },
            relationships: { group: { data: null }, collections: { data: [{ type: 'groups', id: second.id }] } }
          }
        }
      })
      assert.notEqual(await revision(second), oldSecond)
      if (method !== 'post') assert.notEqual(await revision(first), oldFirst)
    })
  }

  it('batches large inverse invalidations and rolls back removed-member revisions', async () => {
    const groups = [first, second]
    for (let index = 2; index < 205; index++) groups.push(await fixture.seed('groups', { name: `Group ${index}` }))
    const unrelated = await fixture.seed('groups', { name: 'Unrelated' })
    const child = await fixture.seed('items', { name: 'Child' })
    const identifiers = groups.map(group => ({ type: 'groups', id: group.id }))
    const adapter = fixture.api.helpers.getStorageAdapter('groups')
    const idColumn = adapter.getIdColumn()
    const versionColumn = adapter.translateColumn('revision')
    const revisions = async () => new Map((await adapter.buildBaseQuery().select(idColumn, versionColumn)).map(row => [String(row[idColumn]), row[versionColumn]]))
    const updates = []
    const capture = query => { if (/^update /i.test(query.sql) && /CASE .* WHEN /i.test(query.sql)) updates.push(query) }
    fixture.knex.on('query', capture)
    try {
      await fixture.api.resources.items.postRelationship({ id: child.id, relationshipName: 'collections', relationshipData: identifiers })
      assert.equal(updates.length, 3)
      assert.ok(updates.every(query => query.bindings.length <= 302))
      const linked = await revisions()
      assert.equal(new Set(groups.map(group => linked.get(group.id))).size, groups.length)
      for (const group of groups) assert.notEqual(linked.get(group.id), group.attributes.revision)
      assert.equal(linked.get(unrelated.id), unrelated.attributes.revision)
      const failure = new Error('Rollback link replacement')
      await assert.rejects(fixture.api.transaction(async transaction => {
        await fixture.api.resources.items.patchRelationship({ id: child.id, relationshipName: 'collections', relationshipData: [identifiers[0]], transaction })
        throw failure
      }), error => error === failure || error.cause === failure)
      assert.deepEqual(await revisions(), linked)
      assert.equal(await fixture.count('memberships'), groups.length)
      updates.length = 0
      await fixture.api.resources.items.deleteRelationship({ id: child.id, relationshipName: 'collections', relationshipData: identifiers })
      assert.equal(updates.length, 3)
      assert.ok(updates.every(query => query.bindings.length <= 302))
      const removed = await revisions()
      for (const group of groups) assert.notEqual(removed.get(group.id), linked.get(group.id))
      assert.equal(removed.get(unrelated.id), unrelated.attributes.revision)
      assert.equal(await fixture.count('memberships'), 0)
    } finally { fixture.knex.off('query', capture) }
  })

  it('rejects direct versioned link writes without a transaction before changing membership', async () => {
    const child = await fixture.seed('items', { name: 'Child' })
    const relData = [{ type: 'groups', id: first.id }]
    const operation = fixture.storage === 'anyapi'
      ? () => fixture.api.anyapi.links.attachMany({ scopeName: 'items', relName: 'collections', relData, context: { id: child.id, db: fixture.knex } })
      : () => createPivotRecords(fixture.api, child.id, fixture.api.resources.items.vars.schemaInfo.schemaRelationships.collections, relData, fixture.knex)
    await assert.rejects(operation, /require an active transaction/)
    assert.equal(await fixture.count('memberships'), 0)
    assert.equal(await revision(first), first.attributes.revision)
    await fixture.api.resources.items.postRelationship({ id: child.id, relationshipName: 'collections', relationshipData: relData })
    const linked = await revision(first)
    const replacement = fixture.storage === 'anyapi'
      ? () => fixture.api.anyapi.links.syncMany({ scopeName: 'items', relName: 'collections', relData: [], isUpdate: true, context: { id: child.id, db: fixture.knex } })
      : () => updateManyToManyRelationship(null, { api: fixture.api, context: { resourceId: child.id, relDef: fixture.api.resources.items.vars.schemaInfo.schemaRelationships.collections, relData: [], transaction: fixture.knex } })
    await assert.rejects(replacement, /require an active transaction/)
    if (fixture.storage === 'anyapi') {
      await assert.rejects(fixture.api.anyapi.links.removeMany({ scopeName: 'items', relName: 'collections', relData, context: { id: child.id, db: fixture.knex } }), /require an active transaction/)
    }
    assert.equal(await fixture.count('memberships'), 1)
    assert.equal(await revision(first), linked)
  })

  it('tracks direct pivot rows according to their storage relationship semantics', async () => {
    const child = await fixture.seed('items', { name: 'Child' })
    const other = await fixture.seed('items', { name: 'Other child' })
    const pivot = await fixture.seed('memberships', {}, { group: { data: { type: 'groups', id: first.id } }, item: { data: { type: 'items', id: child.id } } })
    const members = async group => (await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members' })).data.map(record => record.id)
    if (fixture.storage === 'anyapi') {
      // Canonical through-resource records are separate from canonical links.
      assert.deepEqual(await members(first), [])
      assert.equal(await revision(first), first.attributes.revision)
      return
    }
    assert.deepEqual(await members(first), [child.id])
    const created = await revision(first)
    assert.notEqual(created, first.attributes.revision)
    await fixture.api.resources.memberships.patch({ id: pivot.id, inputRecord: { data: { type: 'memberships', relationships: { item: { data: { type: 'items', id: other.id } } } } } })
    const replaced = await revision(first)
    assert.notEqual(replaced, created)
    assert.deepEqual(await members(first), [other.id])
    await fixture.api.resources.memberships.patch({ id: pivot.id, inputRecord: { data: { type: 'memberships', relationships: { group: { data: { type: 'groups', id: second.id } } } } } })
    assert.notEqual(await revision(first), replaced)
    const moved = await revision(second)
    assert.notEqual(moved, second.attributes.revision)
    assert.deepEqual(await members(first), [])
    assert.deepEqual(await members(second), [other.id])
    const failure = new Error('Rollback pivot deletion')
    await assert.rejects(fixture.api.transaction(async transaction => {
      await fixture.api.resources.memberships.delete({ id: pivot.id, transaction })
      const changed = await fixture.api.resources.groups.get({ id: second.id, format: 'plain', transaction })
      assert.notEqual(changed.revision, moved)
      throw failure
    }), error => error === failure || error.cause === failure)
    assert.equal(await revision(second), moved)
    assert.deepEqual(await members(second), [other.id])
    await fixture.api.resources.memberships.delete({ id: pivot.id })
    assert.notEqual(await revision(second), moved)
    assert.deepEqual(await members(second), [])
  })

  it('invalidates surviving many-to-many parents when a member resource is deleted', async () => {
    const child = await fixture.seed('items', { name: 'Child' }, { collections: { data: [{ type: 'groups', id: first.id }] } })
    const token = await revision(first)
    const members = async () => (await fixture.api.resources.groups.getRelationship({ id: first.id, relationshipName: 'members' })).data.map(record => record.id)
    assert.deepEqual(await members(), [child.id])
    const failure = new Error('Rollback member deletion')
    await assert.rejects(fixture.api.transaction(async transaction => {
      await fixture.api.resources.items.delete({ id: child.id, transaction })
      const parent = await fixture.api.resources.groups.get({ id: first.id, format: 'plain', transaction })
      assert.notEqual(parent.revision, token)
      assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: first.id, relationshipName: 'members', transaction })).data, [])
      throw failure
    }), error => error === failure || error.cause === failure)
    assert.equal(await revision(first), token)
    assert.deepEqual(await members(), [child.id])
    await fixture.api.resources.items.delete({ id: child.id })
    assert.deepEqual(await members(), [])
    assert.notEqual(await revision(first), token)
    assert.equal(await revision(second), second.attributes.revision)
    await fixture.api.resources.items.post({ inputRecord: { data: { type: 'items', id: child.id, attributes: { name: 'Recreated' } } } })
    assert.deepEqual(await members(), [])
  })
})

describe(`Polymorphic inverse revisions (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        fields: { revision: { type: 'string', required: true }, subjectId: { type: 'id', nullable: true }, subjectType: { type: 'string', nullable: true } },
        resourceOptions: {
          versionField: 'revision',
          relationships: {
            subject: { belongsToPolymorphic: { types: ['items'], idField: 'subjectId', typeField: 'subjectType' } },
            children: { type: 'hasMany', target: 'items', via: 'subject' }
          }
        }
      }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('invalidates old and new parents when a polymorphic reference moves or clears', async () => {
    const first = await fixture.seed('items', { name: 'First' })
    const second = await fixture.seed('items', { name: 'Second' })
    const subject = parent => ({ subject: { data: parent ? { type: 'items', id: parent.id } : null } })
    const child = await fixture.seed('items', { name: 'Child' }, subject(first))
    const items = fixture.api.resources.items
    const revision = async parent => (await items.get({ id: parent.id, format: 'plain' })).revision
    const initial = await revision(first)
    assert.notEqual(initial, first.attributes.revision)
    await items.patch({ id: child.id, inputRecord: { data: { type: 'items', relationships: subject(second) } } })
    assert.notEqual(await revision(first), initial)
    const linked = await revision(second)
    assert.notEqual(linked, second.attributes.revision)
    await items.patch({ id: child.id, inputRecord: { data: { type: 'items', relationships: subject(null) } } })
    assert.notEqual(await revision(second), linked)
  })
})
