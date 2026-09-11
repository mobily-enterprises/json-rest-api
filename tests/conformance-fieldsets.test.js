import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi, createReverseRelationshipApi } from './fixtures/api-configs.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Sparse resource fields (${storageMode.mode})`, () => {
  let fixture, item, group, computations
  before(async () => {
    fixture = await createConformanceFixture({
      apiOptions: {
        itemOptions: {
          schema: {
            key: { type: 'id' },
            name: { type: 'string', required: true },
            transient: { type: 'string', virtual: true },
            groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true, storage: { column: 'parent_key' } },
            display: { type: 'string', computed: true, dependencies: ['name'], compute: ({ attributes }) => { computations++; return attributes.name.toUpperCase() } }
          },
          idProperty: 'key',
          sortableFields: ['id', 'name']
        }
      }
    })
    const addLateWriteFields = ({ context }) => {
      if (!context.addLateWriteFields || !['post', 'put', 'patch'].includes(context.method)) return
      if (context.simplified) {
        context.responseRecord.late = 'Not requested'
        context.responseRecord.group = { id: group.id, name: 'Late group', late: 'Not requested' }
      } else {
        for (const row of [context.responseRecord.data, ...(context.responseRecord.included || [])]) {
          row.attributes = { ...row.attributes, late: 'Not requested' }
          row.relationships = { ...row.relationships, late: { data: null } }
        }
      }
    }
    await fixture.api.customize({
      hooks: {
        finish: {
          functionName: 'probe-fieldset-output-boundary',
          handler: async ({ context }) => {
            if (context.addLateWriteFields === 'finish') addLateWriteFields({ context })
            if (!context.addLateFields) return
            for (const row of [context.record?.data, ...(context.record?.included || [])].flat()) {
              if (!row) continue
              row.attributes.late = 'Not requested'
              row.relationships = { ...row.relationships, late: { data: null } }
            }
          }
        },
        ...Object.fromEntries(['Post', 'Put', 'Patch'].map(suffix => [`finish${suffix}`, {
          functionName: 'probe-write-fieldset-output-boundary',
          handler: params => { if (params.context.addLateWriteFields === 'specific') addLateWriteFields(params) }
        }])),
        afterCommit: {
          functionName: 'probe-committed-fieldset-output-boundary',
          handler: params => { if (params.context.addLateWriteFields === 'afterCommit') addLateWriteFields(params) }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Item' }, { group: { data: { type: 'groups', id: group.id } } })
    computations = 0
  })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    for (const method of ['get', 'query']) {
      const read = async (queryParams, context) => fixture.api.resources.items[method]({ id: item.id, format, queryParams }, context)
      const rows = result => method === 'query' ? result.data : [format === 'plain' ? result : result.data]

      for (const fields of ['', 'id', 'name', 'group', 'name,group', 'display,group']) {
        it(`${method} returns only the selected attributes and relationships for '${fields}' (${format})`, async () => {
          const result = await read({ fields: { items: fields, groups: 'name' }, include: ['group'] })
          const selected = fields.split(',')
          for (const row of rows(result)) {
            assert.equal(row.id, item.id)
            const names = selected.filter(name => ['name', 'display'].includes(name))
            if (format === 'plain') {
              assert.deepEqual(Object.keys(row).sort(), ['id', ...names, ...(selected.includes('group') ? ['group'] : [])].sort())
              if (selected.includes('group')) assert.deepEqual(row.group, { id: group.id, name: 'Group' })
            } else {
              assert.deepEqual(Object.keys(row.attributes || {}).sort(), names.sort())
              assert.deepEqual(Object.keys(row.relationships || {}), selected.includes('group') ? ['group'] : [])
              if (selected.includes('group')) assert.deepEqual(row.relationships.group.data, { type: 'groups', id: group.id })
            }
          }
          assert.equal(computations, selected.includes('display') ? 1 : 0)
          if (format === 'jsonapi') {
            assert.deepEqual(result.included.map(row => [row.id, row.attributes]), [[group.id, { name: 'Group' }]])
            assert.deepEqual(Object.keys(result.included[0].relationships || {}), [])
          }
        })
      }

      it(`${method} keeps empty fieldsets empty after finish hooks (${format})`, async () => {
        const result = await read({ fields: { items: '', groups: '' }, include: ['group'] }, { addLateFields: true })
        for (const row of rows(result)) {
          if (format === 'plain') assert.deepEqual(row, { id: item.id })
          else {
            assert.deepEqual(row.attributes || {}, {})
            assert.deepEqual(row.relationships || {}, {})
          }
        }
        if (format === 'jsonapi') {
          assert.deepEqual(result.included[0].attributes || {}, {})
          assert.deepEqual(result.included[0].relationships || {}, {})
        }
        assert.equal(computations, 0)
      })

      it(`${method} leaves resource types without a fieldset unrestricted (${format})`, async () => {
        const result = await read({ fields: { groups: '' }, include: ['group'] })
        const row = rows(result)[0]
        assert.equal(format === 'plain' ? row.name : row.attributes.name, 'Item')
        assert.equal(format === 'plain' ? row.display : row.attributes.display, 'ITEM')
        if (format === 'plain') assert.deepEqual(row.group, { id: group.id })
        else assert.deepEqual(result.included[0].attributes || {}, {})
        assert.equal(computations, 1)
      })
    }

    it(`selects reverse relationships and nested included fieldsets (${format})`, async () => {
      const result = await fixture.api.resources.groups.get({
        id: group.id,
        format,
        queryParams: { include: ['items.group'], fields: { groups: 'items', items: 'name' } }
      })
      if (format === 'plain') assert.deepEqual(result, { id: group.id, items: [{ id: item.id, name: 'Item' }] })
      else {
        assert.deepEqual(result.data.attributes || {}, {})
        assert.deepEqual(Object.keys(result.data.relationships), ['items'])
        const includedItem = result.included.find(row => row.type === 'items')
        assert.deepEqual(includedItem.attributes, { name: 'Item' })
        assert.deepEqual(includedItem.relationships || {}, {})
      }
    })

    for (const method of ['post', 'patch', 'put']) {
      for (const phase of ['finish', 'specific', 'afterCommit']) {
        for (const fields of ['', 'name,group']) {
          it(`${method} preserves '${fields}' on primary and included fields through ${phase} hooks (${format})`, async () => {
            const id = method === 'post' ? '99' : item.id
            const inputRecord = format === 'plain'
              ? { id, name: 'Changed', group: group.id }
              : { data: { type: 'items', id, attributes: { name: 'Changed' }, relationships: { group: { data: { type: 'groups', id: group.id } } } } }
            const result = await fixture.api.resources.items[method]({
              id,
              inputRecord,
              format,
              returning: 'full',
              queryParams: { fields: { items: fields, groups: '' }, include: ['group'] }
            }, { addLateWriteFields: phase })
            if (format === 'plain') {
              assert.deepEqual(result, fields ? { id, name: 'Changed', group: { id: group.id } } : { id })
            } else {
              assert.deepEqual(result.data.attributes || {}, fields ? { name: 'Changed' } : {})
              assert.deepEqual(Object.keys(result.data.relationships || {}), fields ? ['group'] : [])
              assert.deepEqual(result.included[0].attributes || {}, {})
              assert.deepEqual(result.included[0].relationships || {}, {})
            }
          })
        }
      }
      it(`${method} applies the fieldset to its full response without losing stored input (${format})`, async () => {
        const attributes = { name: 'Changed', transient: 'Input only' }
        const inputRecord = format === 'plain'
          ? { ...attributes, group: group.id }
          : createJsonApiDocument('items', attributes, { group: { data: { type: 'groups', id: group.id } } })
        if (method === 'post') {
          if (format === 'plain') inputRecord.id = '99'
          else inputRecord.data.id = '99'
        }
        const result = await fixture.api.resources.items[method]({
          ...(method === 'post' ? {} : { id: item.id }),
          format,
          returning: 'full',
          inputRecord,
          queryParams: { fields: { items: '' } }
        })
        const row = format === 'plain' ? result : result.data
        if (format === 'plain') assert.deepEqual(row, { id: row.id })
        else {
          assert.deepEqual(row.attributes || {}, {})
          assert.deepEqual(row.relationships || {}, {})
        }
        assert.equal(computations, 0)
        const saved = await fixture.api.resources.items.get({ id: row.id, format: 'jsonapi' })
        assert.equal(saved.data.attributes.name, 'Changed')
      })
    }
  }
})

for (const kind of ['hasOne', 'polymorphic', 'manyToMany']) {
  describe(`Sparse ${kind} relationships (${storageMode.mode})`, () => {
    let fixture, parent, child
    const many = kind === 'manyToMany'
    const source = many ? 'groups' : kind === 'hasOne' ? 'parents' : 'comments'
    const target = many ? 'items' : kind === 'hasOne' ? 'profiles' : 'parents'
    const relationshipName = many ? 'members' : kind === 'hasOne' ? 'profile' : 'subject'
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: many ? createQueryConformanceApi : createReverseRelationshipApi,
        tables: many
          ? { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
          : Object.fromEntries(['parents', 'others', 'children', 'profiles', 'requiredChildren', 'comments'].map(type => [type, `reverse_${type}`]))
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      if (kind === 'polymorphic') {
        child = await fixture.seed('parents', { name: 'Target' })
        parent = await fixture.seed('comments', { name: 'Source' }, { subject: { data: { type: 'parents', id: child.id } } })
      } else {
        parent = await fixture.seed(source, { name: 'Source' })
        child = await fixture.seed(target, { name: 'Target' }, many ? {} : { parent: { data: { type: 'parents', id: parent.id } } })
        if (many) await fixture.api.resources.groups.postRelationship({ id: parent.id, relationshipName, relationshipData: [{ type: target, id: child.id }] })
      }
    })
    after(async () => { await fixture?.close() })
    for (const format of ['jsonapi', 'plain']) {
      for (const selected of [false, true]) {
        for (const method of ['get', 'query']) {
          it(`${method} ${selected ? 'selects' : 'omits'} the relationship while retaining requested included data (${format})`, async () => {
            const result = await fixture.api.resources[source][method]({
              id: parent.id,
              format,
              queryParams: { fields: { [source]: selected ? relationshipName : '', [target]: 'name' }, include: [relationshipName] }
            })
            const row = method === 'query' ? result.data[0] : format === 'plain' ? result : result.data
            if (format === 'jsonapi') {
              assert.deepEqual(row.attributes || {}, {})
              assert.deepEqual(Object.keys(row.relationships || {}), selected ? [relationshipName] : [])
              if (selected) {
                const identifier = { type: target, id: child.id }
                assert.deepEqual(row.relationships[relationshipName].data, many ? [identifier] : identifier)
              }
              assert.deepEqual(result.included.map(row => [row.type, row.id, row.attributes]), [[target, child.id, { name: 'Target' }]])
              assert.deepEqual(result.included[0].relationships || {}, {})
            } else {
              const related = { id: child.id, name: 'Target', ...(kind === 'polymorphic' ? { _type: target } : {}) }
              assert.deepEqual(row, { id: parent.id, ...(selected ? { [relationshipName]: many ? [related] : related } : {}) })
            }
          })
        }
      }
    }
  })
}
