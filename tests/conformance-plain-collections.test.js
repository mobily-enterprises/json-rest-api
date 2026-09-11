import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Large plain include conversion (${storageMode.mode})`, () => {
  let fixture
  const size = 1500
  const roots = ['100000', '100001']
  const targets = Array.from({ length: size }, (_, index) => ({ id: String(index + 1), name: `${(index + 1) % 100 ? 'Group' : 'Hidden'} ${index + 1}` }))
  const children = targets.map((target, index) => ({ id: target.id, name: `Child ${target.id}`, groupId: target.id, subjectType: 'groups', subjectId: roots[index % 2], active: true, score: 0 }))
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' },
      apiOptions: {
        collectionInclude: { limit: null },
        resourcePolicy: ({ query, context, column }) => {
          if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
          return true
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    const seed = async (type, rows) => {
      for (let offset = 0; offset < rows.length; offset += 100) await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, rows.slice(offset, offset + 100))
    }
    await seed('groups', [...roots.map(id => ({ id, name: 'Parent' })), ...targets])
    await seed('items', children)
  })
  after(async () => { await fixture?.close() })

  for (const method of ['get', 'query']) {
    it(`expands all visible targets through ${method} with sparse fields and cycle references`, async () => {
      const result = await fixture.api.resources.groups[method]({
        ...(method === 'get' ? { id: roots[0] } : {}),
        format: 'plain',
        queryParams: {
          ...(method === 'query' ? { filters: { name: 'Parent' }, sort: ['id'] } : {}),
          include: ['mentions.group.items'],
          fields: { groups: 'name,mentions,items', items: 'name,group' }
        }
      }, { hideRows: true })
      const parents = method === 'get' ? [result] : result.data
      assert.deepEqual(parents.map(parent => parent.id).sort(), method === 'get' ? [roots[0]] : roots)
      for (const parent of parents) {
        assert.equal(parent.name, 'Parent')
        const expected = children.filter(child => child.subjectId === parent.id)
        assert.equal(parent.mentions.length, expected.length)
        const byId = new Map(parent.mentions.map(child => [child.id, child]))
        for (const child of expected) {
          const actual = byId.get(child.id)
          assert.equal(actual.name, child.name)
          assert.equal(actual.score, undefined)
          if (Number(child.id) % 100 === 0) assert.equal(actual.group, undefined)
          else {
            assert.equal(actual.group.name, `Group ${child.id}`)
            assert.deepEqual(actual.group.items, [{ id: child.id }])
          }
        }
      }
      assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
    })
  }
})
