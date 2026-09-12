import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi, seedCanonicalLinkRows, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const groupOptions = {
  schema: { id: { type: 'id' }, name: { type: 'string', required: true }, revision: { type: 'string', required: true } },
  versionField: 'revision'
}

if (storageMode.mode === 'anyapi') {
  describe('Canonical member deletion scope', () => {
    let fixture
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createQueryConformanceApi, tables: { links: 'any_links', records: 'any_records' }, apiOptions: { groupOptions } })
    })
    beforeEach(async () => { await fixture.reset() })
    after(async () => { await fixture?.close() })
    for (const source of ['items', 'groups']) {
      it(`preserves overlapping foreign records and links when deleting ${source}`, async () => {
        const parent = await fixture.seed('groups', { name: 'Parent' })
        const child = await fixture.seed('items', { name: 'Child' }, { collections: { data: [{ type: 'groups', id: parent.id }] } })
        const token = (await fixture.api.resources.groups.get({ id: parent.id, format: 'plain' })).revision
        const { id: physicalId, ...link } = await fixture.knex('any_links').first()
        assert.ok(physicalId)
        const foreignLinks = [
          { ...link, tenant_id: 'neighbor' },
          { ...link, left_resource: `foreign_${link.left_resource}`, right_resource: `foreign_${link.right_resource}` }
        ]
        await seedCanonicalLinkRows(fixture.knex, foreignLinks)
        for (const type of ['items', 'groups']) {
          const schema = fixture.api.resources[type].vars.schemaInfo
          for (const scope of [{ tenant: 'neighbor' }, { resource: `foreign_${type}` }]) {
            await seedStorageAdapterRecords(fixture.knex, { ...schema, descriptor: { ...schema.descriptor, ...scope } }, [
              { id: '1', name: 'Foreign record', ...(type === 'groups' ? { revision: 'foreign-revision' } : {}) }
            ])
          }
        }
        const foreignRecords = () => fixture.knex('any_records').where(query => query.where('tenant_id', 'neighbor').orWhereIn('resource', ['foreign_items', 'foreign_groups'])).orderBy('id')
        const before = await foreignRecords()
        assert.equal(before.length, 4)
        await fixture.api.resources[source].delete({ id: source === 'items' ? child.id : parent.id })
        assert.deepEqual(await foreignRecords(), before)
        assert.deepEqual((await fixture.knex('any_links').orderBy('id')).map(({ id, ...row }) => row), foreignLinks)
        if (source === 'items') {
          assert.notEqual((await fixture.api.resources.groups.get({ id: parent.id, format: 'plain' })).revision, token)
        } else {
          assert.equal((await fixture.api.resources.items.get({ id: child.id, format: 'plain' })).name, 'Child')
        }
      })
    }
  })
}

if (storageMode.mode === 'knex') {
  for (const rule of ['RESTRICT', 'CASCADE']) {
    describe(`Member deletion with SQL ${rule}`, () => {
      let fixture
      before(async () => {
        fixture = await createConformanceFixture({ createApi: createQueryConformanceApi, tables, apiOptions: { groupOptions, pivotOnDelete: rule } })
        if (fixture.knex.client.config.client === 'better-sqlite3') await fixture.knex.raw('PRAGMA foreign_keys = ON')
      })
      beforeEach(async () => { await fixture.reset() })
      after(async () => { await fixture?.close() })
      it('honors the database rule and keeps membership revisions consistent', async () => {
        const parent = await fixture.seed('groups', { name: 'Parent' })
        const child = await fixture.seed('items', { name: 'Child' }, { collections: { data: [{ type: 'groups', id: parent.id }] } })
        const revision = async () => (await fixture.api.resources.groups.get({ id: parent.id, format: 'plain' })).revision
        const token = await revision()
        // Prove the constraint is active independently of public delete behavior.
        const sentinel = new Error('Rollback database probe')
        if (rule === 'RESTRICT') {
          await assert.rejects(fixture.knex('conformance_items').where('id', child.id).delete(), error => /foreign key/i.test(error.message))
          await assert.rejects(fixture.api.resources.items.delete({ id: child.id }))
          assert.equal(await revision(), token)
          assert.equal(await fixture.count('items'), 1)
          assert.equal(await fixture.count('memberships'), 1)
          assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: parent.id, relationshipName: 'members' })).data.map(record => record.id), [child.id])
        } else {
          await assert.rejects(fixture.knex.transaction(async transaction => {
            await transaction('conformance_items').where('id', child.id).delete()
            assert.deepEqual(await transaction('conformance_memberships').select('*'), [])
            throw sentinel
          }), error => error === sentinel)
          await fixture.api.resources.items.delete({ id: child.id })
          assert.notEqual(await revision(), token)
          assert.equal(await fixture.count('memberships'), 0)
          await fixture.api.resources.items.post({ document: { data: { type: 'items', id: child.id, attributes: { name: 'Recreated' } } } })
          assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: parent.id, relationshipName: 'members' })).data, [])
        }
      })
    })
  }
}

describe(`Unversioned member deletion (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createConformanceFixture({ createApi: createQueryConformanceApi, tables }) })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('cleans both link directions without removing unrelated memberships', async () => {
    const first = await fixture.seed('groups', { name: 'First' })
    const second = await fixture.seed('groups', { name: 'Second' })
    const child = await fixture.seed('items', { name: 'Child' }, { collections: { data: [{ type: 'groups', id: first.id }] } })
    const other = await fixture.seed('items', { name: 'Other' }, { collections: { data: [{ type: 'groups', id: second.id }] } })
    await fixture.api.resources.items.delete({ id: child.id })
    await fixture.api.resources.items.post({ document: { data: { type: 'items', id: child.id, attributes: { name: 'Recreated' } } } })
    assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: first.id, relationshipName: 'members' })).data, [])
    assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: second.id, relationshipName: 'members' })).data.map(record => record.id), [other.id])
    await fixture.api.resources.groups.delete({ id: second.id })
    await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id: second.id, attributes: { name: 'Recreated' } } } })
    assert.deepEqual((await fixture.api.resources.items.getRelationship({ id: other.id, relationshipName: 'collections' })).data, [])
  })
})
