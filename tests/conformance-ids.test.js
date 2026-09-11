import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Generated mapped ID conformance (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ apiOptions: { itemOptions: { idProperty: 'record_key' }, groupOptions: { idProperty: 'group_key' } } })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  for (const format of ['jsonapi', 'plain']) {
    for (const returning of ['none', 'minimal', 'full']) {
      it(`returns generated IDs and preserves their relationships (${format}, ${returning})`, async () => {
        const group = await fixture.api.resources.groups.post({ inputRecord: createJsonApiDocument('groups', { name: 'Parent' }) })
        const createdIds = []
        for (const name of ['First', 'Second']) {
          const attributes = { name, active: false, rank: 0 }
          const result = await fixture.api.resources.items.post({
            format,
            returning,
            inputRecord: format === 'plain' ? { ...attributes, group: group.data.id } : createJsonApiDocument('items', attributes, { group: { data: { type: 'groups', id: group.data.id } } })
          })
          const found = await fixture.api.resources.items.query({ queryParams: { filters: { name } } })
          assert.equal(found.data.length, 1)
          const row = found.data[0]
          assert.equal(typeof row.id, 'string')
          assert.notEqual(row.id, '')
          assert.equal(row.attributes.active, false)
          assert.equal(row.attributes.rank, 0)
          assert.deepEqual(row.relationships.group.data, { type: 'groups', id: group.data.id })
          createdIds.push(row.id)
          if (returning === 'none') assert.equal(result, undefined)
          else if (returning === 'minimal') assert.deepEqual(result, format === 'plain' ? { type: 'items', id: row.id } : { data: { type: 'items', id: row.id } })
          else assert.equal((format === 'plain' ? result : result.data).id, row.id)
          const fetched = await fixture.api.resources.items.get({ id: row.id })
          assert.equal(fetched.data.attributes.name, name)
          if (fixture.storage === 'knex') {
            const stored = await fixture.knex('conformance_items').where('record_key', row.id).first()
            assert.equal(String(stored.record_key), row.id)
          }
        }
        assert.equal(new Set(createdIds).size, 2)
        const children = await fixture.api.resources.groups.getRelated({ id: group.data.id, relationshipName: 'items' })
        assert.deepEqual(new Set(children.data.map(row => row.id)), new Set(createdIds))
      })
    }
  }
})

for (const idType of ['integer', 'string']) {
  describe(`Shared mapped ${idType} ID conformance (${storageMode.mode})`, () => {
    let fixture
    let items
    const body = (format, id, attributes = { name: 'Changed' }) => format === 'plain'
      ? { id, ...attributes }
      : { data: { type: 'items', id, attributes } }
    const seedZero = async () => {
      await items.post({ format: 'jsonapi', inputRecord: body('jsonapi', 0, { name: 'Zero' }) })
    }
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        apiOptions: { idType },
        tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
      })
      items = fixture.api.resources.items
      assert.equal(fixture.storage, storageMode.mode)
    })
    beforeEach(async () => { await fixture.reset() })
    after(async () => { await fixture?.close() })

    it('does not accept an object as a path ID through implicit string conversion', async () => {
      await seedZero()
      for (const method of ['get', 'delete']) {
        for (const id of [{ toString: () => '0' }, Object.create(null), { toString: null }]) {
          await assert.rejects(items[method]({ id }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
        }
      }
      assert.equal(await fixture.count('items'), 1)
    })

    it('uses custom ID and attribute columns without leaking storage names', async () => {
      await seedZero()
      const fetched = await items.get({ id: '0', format: 'jsonapi', queryParams: { fields: { items: 'name' } } })
      assert.deepEqual(fetched.data.attributes, { name: 'Zero' })
      assert.equal(fetched.data.id, '0')
      const row = fixture.storage === 'knex'
        ? await fixture.knex('conformance_items').where('items_key', '0').first()
        : await fixture.knex('any_records').where({ tenant_id: fixture.api.anyapi.tenantId, resource: 'items', logical_id: '0' }).first()
      assert.ok(row)
      if (fixture.storage === 'knex') {
        assert.equal(String(row.items_key), '0')
        assert.equal(row.display_name, 'Zero')
        assert.equal(Object.hasOwn(row, 'id'), false)
        assert.equal(Object.hasOwn(row, 'name'), false)
        const columns = await fixture.knex('conformance_memberships').columnInfo()
        const expectedType = {
          'better-sqlite3': { integer: 'integer', string: 'varchar' },
          pg: { integer: 'integer', string: 'character varying' },
          mysql2: { integer: 'int', string: 'varchar' }
        }[fixture.knex.client.config.client][idType]
        assert.equal(columns.item_key.type, expectedType)
        assert.equal(columns.group_key.type, expectedType)
      } else {
        assert.equal(row.logical_id, '0')
        const descriptor = await fixture.api.anyapi.registry.getDescriptor(fixture.api.anyapi.tenantId, 'items')
        assert.equal(row[descriptor.fields.name.slot], 'Zero')
      }
      const query = await items.query({ format: 'jsonapi', queryParams: { filters: { name: 'Zero' }, sort: ['id'] } })
      assert.deepEqual(query.data.map(record => record.id), ['0'])
    })

    if (idType === 'string') {
      for (const id of ['Case-sensitive', '0007', '9007199254740993', 'part/one?x#% β', '__proto__', 'constructor']) {
        it(`preserves opaque ID ${JSON.stringify(id)} across CRUD and relationships`, async () => {
          await fixture.api.resources.groups.post({
            format: 'plain', inputRecord: { id, name: 'Opaque group' }
          })
          for (const format of ['plain', 'jsonapi']) {
            const created = await items.post({ format, inputRecord: body(format, id, { name: 'Opaque' }) })
            assert.equal(format === 'plain' ? created.id : created.data.id, id)
            await items.patch({ id, format: 'plain', inputRecord: { group: id, groups: [id], subject: { _type: 'groups', id } } })
            const fetched = await items.get({ id: ` ${id} `, format: 'jsonapi', queryParams: { include: ['group', 'groups', 'subject'] } })
            assert.equal(fetched.data.id, id)
            assert.equal(fetched.data.relationships.group.data.id, id)
            assert.deepEqual(fetched.data.relationships.groups.data, [{ type: 'groups', id }])
            assert.deepEqual(fetched.data.relationships.subject.data, { type: 'groups', id })
            assert.deepEqual(fetched.included.map(record => record.id), [id])
            const parent = await fixture.api.resources.groups.get({ id, format: 'jsonapi', queryParams: { include: ['items.group', 'firstItem', 'mentions.subject'] } })
            assert.deepEqual(parent.data.relationships.items.data, [{ type: 'items', id }])
            assert.deepEqual(parent.data.relationships.firstItem.data, { type: 'items', id })
            assert.deepEqual(parent.data.relationships.mentions.data, [{ type: 'items', id }])
            assert.ok(parent.included.some(record => record.type === 'items' && record.id === id))
            await items.put({ id, format: 'plain', inputRecord: { name: 'Replaced', active: true, score: 0, group: id, groups: [id], subject: { _type: 'groups', id } } })
            assert.equal((await items.get({ id, format: 'plain' })).name, 'Replaced')
            await items.delete({ id })
            assert.equal(await fixture.count('items'), 0)
          }
        })
      }
    }

    for (const format of ['jsonapi', 'plain']) {
      it(`keeps zero primary and pivot IDs in many-to-many writes and includes (${format})`, async () => {
        await fixture.api.resources.groups.post({ format: 'plain', inputRecord: { id: 0, name: 'Zero group' } })
        const inputRecord = format === 'plain'
          ? { id: 0, name: 'Zero item', groups: [0] }
          : {
              data: { type: 'items', id: 0, attributes: { name: 'Zero item' }, relationships: { groups: { data: [{ type: 'groups', id: 0 }] } } }
            }
        await items.post({ format, inputRecord })
        const fetched = await items.get({ id: 0, format: 'jsonapi', queryParams: { include: ['groups'] } })
        assert.deepEqual(fetched.data.relationships.groups.data, [{ type: 'groups', id: '0' }])
        assert.ok(fetched.included.some(record => record.type === 'groups' && record.id === '0'))
        const params = { id: 0, relationshipName: 'groups', relationshipData: [{ type: 'groups', id: 0 }] }
        await items.deleteRelationship(params)
        assert.deepEqual((await items.getRelationship({ id: 0, relationshipName: 'groups' })).data, [])
        await items.postRelationship(params)
        assert.deepEqual((await items.getRelationship({ id: 0, relationshipName: 'groups' })).data, [{ type: 'groups', id: '0' }])
        await items.patchRelationship({ ...params, relationshipData: [] })
        assert.deepEqual((await items.getRelated({ id: 0, relationshipName: 'groups', format: 'plain' })).data, [])
      })
      it(`preserves zero IDs in hasOne and polymorphic relationships (${format})`, async () => {
        await fixture.api.resources.groups.post({ format: 'plain', inputRecord: { id: 0, name: 'Zero group' } })
        await seedZero()
        const inputRecord = format === 'plain'
          ? { firstItem: 0 }
          : { data: { type: 'groups', relationships: { firstItem: { data: { type: 'items', id: 0 } } } } }
        await fixture.api.resources.groups.patch({ id: 0, format, inputRecord })
        const subject = format === 'plain'
          ? { subject: { _type: 'groups', id: 0 } }
          : { data: { type: 'items', relationships: { subject: { data: { type: 'groups', id: 0 } } } } }
        await items.patch({ id: 0, format, inputRecord: subject })
        const fetched = await items.get({ id: 0, format: 'jsonapi', queryParams: { include: ['subject.firstItem'] } })
        assert.deepEqual(fetched.data.relationships.subject.data, { type: 'groups', id: '0' })
        assert.equal((await items.getRelated({ id: 0, relationshipName: 'subject', format: 'plain' }))?.id, '0')
        assert.ok(fetched.included.some(record => record.type === 'groups' && record.id === '0'))
        const parent = await fixture.api.resources.groups.get({ id: 0, format: 'jsonapi', queryParams: { include: ['firstItem', 'mentions.subject'] } })
        assert.deepEqual(parent.data.relationships.firstItem.data, { type: 'items', id: '0' })
        assert.deepEqual(parent.data.relationships.mentions.data, [{ type: 'items', id: '0' }])
        assert.ok(parent.included.some(record => record.type === 'items' && record.id === '0'))
      })
      it(`rejects invalid explicit POST IDs before creating a row (${format})`, async () => {
        for (const id of [null, '', false, true, NaN, Infinity, [], {}, '   ']) {
          await assert.rejects(items.post({ format, inputRecord: body(format, id) }), { code: 'REST_API_VALIDATION' })
          assert.equal(await fixture.count('items'), 0)
        }
      })
      for (const returning of ['none', 'minimal', 'full']) {
        it(`preserves an explicit zero POST ID (${format}, ${returning})`, async () => {
          const result = await items.post({ format, returning, inputRecord: body(format, 0, { name: 'Zero' }) })
          if (returning === 'none') assert.equal(result, undefined)
          else assert.equal(format === 'plain' ? result.id : result.data.id, '0')
          assert.equal((await items.get({ id: 0, format: 'jsonapi' })).data.attributes.name, 'Zero')
          assert.equal(await fixture.count('items'), 1)
        })
      }

      for (const method of ['patch', 'put']) {
        it(`rejects a mismatching zero body ID before changing either row (${format}, ${method})`, async () => {
          await seedZero()
          const other = await fixture.seed('items', { name: 'Other' })
          await assert.rejects(items[method]({
            id: other.id, format, inputRecord: body(format, 0, { name: 'Wrong', active: true, score: 0 })
          }), error => {
            assert.equal(error.code, 'REST_API_VALIDATION')
            assert.equal(error.details.violations[0].rule, 'id_consistency')
            return true
          })
          assert.equal((await items.get({ id: 0, format: 'jsonapi' })).data.attributes.name, 'Zero')
          assert.equal((await items.get({ id: other.id, format: 'jsonapi' })).data.attributes.name, 'Other')
          assert.equal(await fixture.count('items'), 2)
        })

        it(`accepts numeric/string zero identity and a body-only ID (${format}, ${method})`, async () => {
          await seedZero()
          for (const params of [{ id: '0' }, {}]) {
            const result = await items[method]({
              ...params, format, inputRecord: body(format, 0, { name: 'Changed', active: true, score: 0 })
            })
            assert.equal(format === 'plain' ? result.id : result.data.id, '0')
          }
          await items.delete({ id: 0 })
          assert.equal(await fixture.count('items'), 0)
        })

        it(`rejects invalid explicit body IDs instead of borrowing the path ID (${format}, ${method})`, async () => {
          const other = await fixture.seed('items', { name: 'Other' })
          for (const id of [null, '', false, NaN, Infinity, [], {}, '   ']) {
            await assert.rejects(items[method]({
              id: other.id, format, inputRecord: body(format, id, { name: 'Wrong', active: true, score: 0 })
            }), { code: 'REST_API_VALIDATION' })
            assert.equal((await items.get({ id: other.id, format: 'jsonapi' })).data.attributes.name, 'Other')
          }
        })
      }

      it(`keeps a zero belongsTo ID in writes, linkage and includes (${format})`, async () => {
        await fixture.api.resources.groups.post({
          format: 'jsonapi', inputRecord: { data: { type: 'groups', id: 0, attributes: { name: 'Zero group' } } }
        })
        const inputRecord = format === 'plain'
          ? { id: 9, name: 'Child', group: 0 }
          : createJsonApiDocument('items', { name: 'Child' }, {
            group: { data: { type: 'groups', id: 0 } }
          })
        if (format === 'jsonapi') inputRecord.data.id = 9
        const result = await items.post({ format, inputRecord })
        const id = format === 'plain' ? result.id : result.data.id
        const fetched = await items.get({ id, format: 'jsonapi', queryParams: { include: ['group'] } })
        assert.deepEqual(fetched.data.relationships.group.data, { type: 'groups', id: '0' })
        assert.deepEqual(fetched.included.map(record => record.id), ['0'])
        assert.equal((await items.getRelated({ id, relationshipName: 'group', format: 'plain' })).id, '0')
      })
    }

    it('keeps zero parent and child IDs in reverse linkage, related queries and includes', async () => {
      await fixture.api.resources.groups.post({
        format: 'jsonapi', inputRecord: { data: { type: 'groups', id: 0, attributes: { name: 'Zero group' } } }
      })
      await items.post({
        format: 'jsonapi',
        inputRecord: {
          data: { type: 'items', id: 0, attributes: { name: 'Zero child' }, relationships: { group: { data: { type: 'groups', id: 0 } } } }
        }
      })
      const groups = fixture.api.resources.groups
      const fetched = await groups.get({ id: 0, format: 'jsonapi', queryParams: { include: ['items.group'] } })
      assert.deepEqual(fetched.data.relationships.items.data, [{ type: 'items', id: '0' }])
      assert.ok(fetched.included.some(record => record.type === 'items' && record.id === '0'))
      assert.deepEqual((await groups.getRelationship({ id: 0, relationshipName: 'items' })).data, [{ type: 'items', id: '0' }])
      const related = await groups.getRelated({ id: 0, relationshipName: 'items', format: 'plain' })
      assert.deepEqual(related.data.map(record => record.id), ['0'])
    })
  })
}
