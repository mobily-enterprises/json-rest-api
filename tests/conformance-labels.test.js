import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'

const string = { type: 'string', nullable: true }
const scenarios = [
  { name: 'preferred name', schema: { name: string, title: string }, input: { name: 'Name', title: 'Title' }, expected: 'Name' },
  { name: 'configured preference', options: { preferNameFields: ['title', 'name'] }, schema: { name: string, title: string }, input: { name: 'Name', title: 'Title' }, expected: 'Title' },
  { name: 'global search field', schema: { name: string, title: string }, searchSchema: { title: { type: 'string', globalSearch: true } }, input: { name: 'Name', title: 'Search title' }, expected: 'Search title' },
  { name: 'global search alias', schema: { name: string, title: string }, searchSchema: { lookup: { type: 'string', actualField: 'title', globalSearch: true } }, input: { name: 'Name', title: 'Search title' }, expected: 'Search title' },
  { name: 'global search relationship backing field', schema: { name: string, parentId: { type: 'id', belongsTo: 'groups', as: 'parent', nullable: true } }, searchSchema: { parentId: { type: 'id', globalSearch: true } }, input: { name: 'Name' }, expected: 'Name' },
  { name: 'global search polymorphic backing field', schema: { name: string, subjectId: { type: 'id', nullable: true }, subjectType: string }, relationships: { subject: { belongsToPolymorphic: { types: ['groups'], typeField: 'subjectType', idField: 'subjectId' } } }, searchSchema: { subjectType: { type: 'string', globalSearch: true } }, input: { name: 'Name' }, expected: 'Name' },
  { name: 'first public string', schema: { note: string }, input: { note: 'Note' }, expected: 'Note' },
  { name: 'logical ID fallback', schema: {}, input: {} },
  { name: 'custom logical ID fallback', idProperty: 'key', schema: {}, input: {} },
  { name: 'explicit stored label', schema: { name: string, label: string }, input: { name: 'Name', label: 'Stored label' }, expected: 'Stored label' },
  { name: 'explicit computed label', schema: { name: string, label: { type: 'string', computed: true, dependencies: ['name'], compute: ({ attributes, id }) => `${id}: Custom ${attributes.name}` } }, input: { name: 'Name' }, expected: '1: Custom Name' },
  { name: 'hidden preferred field', schema: { name: { ...string, hidden: true }, title: string }, input: { name: 'Private', title: 'Public' }, expected: 'Public' },
  { name: 'normally hidden preferred field', schema: { name: { ...string, normallyHidden: true }, title: string }, input: { name: 'Private', title: 'Public' }, expected: 'Public' },
  { name: 'hidden global search field', schema: { name: string, secret: { ...string, hidden: true } }, searchSchema: { secret: { type: 'string', globalSearch: true } }, input: { name: 'Public', secret: 'Private' }, expected: 'Public' },
  { name: 'only private strings', schema: { secret: { ...string, hidden: true }, internal: { ...string, normallyHidden: true } }, input: { secret: 'Private', internal: 'Internal' } },
  { name: 'null preferred value', schema: { name: string, title: string }, input: { name: null, title: 'Fallback' }, expected: 'Fallback' },
  { name: 'empty preferred value', schema: { name: string, title: string }, input: { name: '', title: 'Title' }, expected: '' },
  { name: 'zero global search value', schema: { score: { type: 'number' } }, searchSchema: { score: { type: 'number', globalSearch: true } }, input: { score: 0 }, expected: '0' },
  { name: 'false global search value', schema: { active: { type: 'boolean' } }, searchSchema: { active: { type: 'boolean', globalSearch: true } }, input: { active: false }, expected: 'false' },
  { name: 'getter-transformed value', schema: { name: { ...string, getter: value => value.toUpperCase() } }, input: { name: 'Name' }, expected: 'NAME' },
  { name: 'explicit private label', schema: { name: string, label: { ...string, hidden: true } }, input: { name: 'Public', label: 'Private' }, absent: true },
  { name: 'explicit hidden computed label', schema: { label: { type: 'string', computed: true, hidden: true, compute: () => 'Private' } }, input: {}, absent: true },
  { name: 'explicit normally hidden computed label', schema: { label: { type: 'string', computed: true, normallyHidden: true, compute: () => 'Private' } }, input: {}, absent: true, requested: 'Private' },
  { name: 'hidden virtual source', schema: { name: { ...string, virtual: true, hidden: true }, title: string }, input: { name: 'Private', title: 'Public' }, expected: 'Public' },
  { name: 'normally hidden virtual source', schema: { name: { ...string, virtual: true, normallyHidden: true }, title: string }, input: { name: 'Private', title: 'Public' }, expected: 'Public' },
  { name: 'disabled plugin', options: { disable: true }, schema: { name: string }, input: { name: 'Name' }, absent: true }
]

for (const scenario of scenarios) {
  describe(`Labels: ${scenario.name} (${storageMode.mode})`, () => {
    let fixture
    let record
    const attributes = (record, format) => format === 'plain' ? record : record.attributes
    before(async () => {
      const idProperty = scenario.idProperty || 'id'
      fixture = await createConformanceFixture({
        apiOptions: {
          labelOptions: scenario.options || {},
          groupOptions: { relationships: {} },
          itemOptions: {
            idProperty,
            sortableFields: ['id'],
            schema: { [idProperty]: { type: 'id' }, ...scenario.schema },
            ...(scenario.relationships ? { relationships: scenario.relationships } : {}),
            searchSchema: scenario.searchSchema || {}
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      record = await fixture.seed('items', scenario.input)
    })
    after(async () => { await fixture?.close() })

    for (const format of ['jsonapi', 'plain']) {
      it(`preserves authored labels and computes only public values in full and sparse reads (${format})`, async () => {
        const expected = scenario.absent ? undefined : scenario.expected ?? record.id
        assert.equal(record.attributes.label, expected, 'full POST response')
        for (const [field, definition] of Object.entries(scenario.schema)) {
          if (definition.hidden || definition.normallyHidden) assert.equal(record.attributes[field], undefined, `private POST attribute ${field}`)
        }
        const resource = fixture.api.resources.items
        const get = await resource.get({ id: record.id, format })
        assert.equal(attributes(format === 'plain' ? get : get.data, format).label, expected, 'GET response')
        const query = await resource.query({ format })
        assert.equal(attributes(query.data[0], format).label, expected, 'query response')
        if (scenario.requested) {
          const selected = await resource.get({ id: record.id, format, queryParams: { fields: { items: 'label' } } })
          assert.equal(attributes(format === 'plain' ? selected : selected.data, format).label, scenario.requested)
        }
        if (!scenario.absent) {
          const sparse = { fields: { items: 'label' } }
          const result = await resource.get({ id: record.id, format, queryParams: sparse })
          const fetched = attributes(format === 'plain' ? result : result.data, format)
          assert.equal(fetched.label, expected, 'sparse GET response')
          assert.deepEqual(Object.keys(fetched).sort(), format === 'plain' ? ['id', 'label'] : ['label'])
          const selected = await resource.query({ format, queryParams: sparse })
          assert.equal(attributes(selected.data[0], format).label, expected, 'sparse query response')
        }
      })
    }
  })
}

describe(`Label record identity in included resources (${storageMode.mode})`, () => {
  let fixture, first, second
  before(async () => {
    fixture = await createConformanceFixture({
      apiOptions: {
        labelOptions: {},
        groupOptions: { schema: { key: { type: 'id' } }, idProperty: 'key' },
        itemOptions: { schema: { key: { type: 'id' }, groupId: { type: 'id', belongsTo: 'groups', as: 'group' } }, idProperty: 'key' }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    const left = await fixture.seed('groups', {})
    const right = await fixture.seed('groups', {})
    first = await fixture.seed('items', {}, { group: { data: { type: 'groups', id: right.id } } })
    second = await fixture.seed('items', {}, { group: { data: { type: 'groups', id: left.id } } })
  })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    it(`uses each resource's own logical ID for GET and query includes (${format})`, async () => {
      const queryParams = { include: ['group'], fields: { groups: 'label' } }
      const result = await fixture.api.resources.items.get({ id: first.id, format, queryParams })
      if (format === 'plain') {
        assert.equal(result.label, '1')
        assert.equal(result.group.label, '2')
      } else {
        assert.equal(result.data.attributes.label, '1')
        assert.deepEqual(result.included.map(row => [row.id, row.attributes.label]), [['2', '2']])
      }
      const query = await fixture.api.resources.items.query({ format, queryParams })
      assert.deepEqual(query.data.map(row => [row.id, format === 'plain' ? row.label : row.attributes.label]), [[first.id, '1'], [second.id, '2']])
      if (format === 'plain') assert.deepEqual(query.data.map(row => row.group.label), ['2', '1'])
      else assert.deepEqual(query.included.map(row => [row.id, row.attributes.label]).sort(), [['1', '1'], ['2', '2']])
    })
  }
})
