import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createQueryConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { storageMode } from './helpers/storage-mode.js'

for (const declaration of ['omitted', 'disabled', 'field', 'searchSchema']) {
  describe(`Explicit relationship search: ${declaration} (${storageMode.mode})`, () => {
    let fixture, group, item
    const searchable = declaration === 'field' || declaration === 'searchSchema'
    before(async () => {
      const search = {}
      if (declaration === 'disabled') search.search = false
      if (declaration === 'field') search.search = true
      fixture = await createConformanceFixture({
        createApi: createQueryConformanceApi,
        tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' },
        apiOptions: {
          membershipOptions: {
            schema: {
              id: { type: 'id' },
              groupId: { type: 'id', required: true, belongsTo: 'groups', as: 'group', storage: { column: 'parent_key' }, ...search },
              itemId: { type: 'id', required: true, belongsTo: 'items', as: 'item', storage: { column: 'child_key' }, ...search }
            },
            ...(declaration === 'searchSchema' ? { searchSchema: { group: { type: 'id', actualField: 'groupId' } } } : {})
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      group = await fixture.seed('groups', { name: 'Group' })
      item = await fixture.seed('items', { name: 'Item' })
    })
    after(async () => { await fixture?.close() })

    it('exposes only explicitly declared public filters', async () => {
      const memberships = fixture.api.resources.memberships
      const fields = memberships.vars.schemaInfo.searchSchemaInstance.structure
      assert.equal(Object.hasOwn(fields, 'group'), searchable)
      if (!searchable) {
        for (const name of ['group', 'groupId', 'item', 'itemId']) {
          assert.equal(Object.hasOwn(fields, name), false)
          await assert.rejects(memberships.query({
            format: 'jsonapi', queryParams: { filters: { [name]: group.id } }
          }), RestApiValidationError)
        }
        return
      }
      const membership = await fixture.seed('memberships', {}, {
        group: { data: { type: 'groups', id: group.id } },
        item: { data: { type: 'items', id: item.id } }
      })
      const result = await memberships.query({
        format: 'jsonapi', queryParams: { filters: { group: group.id } }
      })
      assert.deepEqual(result.data.map(record => record.id), [membership.id])
    })

    it('adds, reads, replaces and removes membership without inferred filters', async () => {
      const groups = fixture.api.resources.groups
      const params = { id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.id }] }
      await groups.postRelationship(params)
      const included = await groups.get({ id: group.id, format: 'jsonapi', queryParams: { include: ['members'] } })
      assert.deepEqual(included.data.relationships.members.data, [{ type: 'items', id: item.id }])
      const second = await fixture.seed('items', { name: 'Second' })
      const replacement = { ...params, relationshipData: [{ type: 'items', id: second.id }] }
      await groups.patchRelationship(replacement)
      const related = await groups.getRelated({ id: group.id, relationshipName: 'members', format: 'jsonapi' })
      assert.deepEqual(related.data.map(record => record.id), [second.id])
      await groups.deleteRelationship(replacement)
      const empty = await groups.getRelationship({ id: group.id, relationshipName: 'members' })
      assert.deepEqual(empty.data, [])
    })
  })
}
