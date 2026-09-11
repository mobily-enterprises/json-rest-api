import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { whereInIdentifiers } from '../plugins/core/lib/querying/identifier-query.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const seed = (fixture, type, rows) => seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, rows)
const adapterFor = fixture => createStorageAdapter({ knex: fixture.knex, schemaInfo: fixture.api.resources.groups.vars.schemaInfo })
const createFixture = apiOptions => createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions })

// The database supplies comparison semantics; the helper changes list transport.
for (const idCaseInsensitive of [false, true]) {
  describe(`Text identifier lists (${storageMode.mode}, case-insensitive ${idCaseInsensitive})`, () => {
    let fixture, adapter
    const ids = ['001', '1', 'Alpha', "O'Reilly", 'A\\B', '😊', "x' OR 1=1 --", 'tab\tlf\n', 'Résumé', '9007199254740992', '9007199254740993']
    before(async () => {
      fixture = await createFixture({ idType: 'string', idCaseInsensitive })
      adapter = adapterFor(fixture)
    })
    beforeEach(async () => { await fixture.reset(); await seed(fixture, 'groups', ids.map(id => ({ id, name: id }))) })
    after(async () => { await fixture?.close() })

    it('retains literal values, large digit strings, nulls and actual column collation', async () => {
      const column = adapter.getIdColumn()
      const fillers = Array.from({ length: 101 }, (_, index) => `missing-${index}`)
      for (const selected of [...ids.map(id => [id]), ['alpha'], ['resume'], [null], ['001', 'alpha', '1', '1']]) {
        const expected = await adapter.buildBaseQuery().whereIn(column, selected).select(column)
        const query = adapter.buildBaseQuery().select(column)
        assert.equal(whereInIdentifiers(query, column, [...fillers, ...selected]), query)
        assert.deepEqual((await query).map(row => row[column]).sort(), expected.map(row => row[column]).sort())
      }
    })

    it('deduplicates repeated IDs, preserves existing predicates, and handles empty input', async () => {
      const column = adapter.getIdColumn()
      const query = whereInIdentifiers(adapter.buildBaseQuery(), column, Array(33000).fill('Alpha'))
      assert.ok(query.toSQL().bindings.length <= 3)
      assert.equal((await query).length, 1)
      assert.deepEqual(await whereInIdentifiers(adapter.buildBaseQuery(), column, []).select(column), [])
      assert.deepEqual(await whereInIdentifiers(adapter.buildBaseQuery().where(column, '1'), column, ['Alpha']), [])
    })
  })
}

describe(`Large numeric identifier lists (${storageMode.mode})`, () => {
  let fixture, adapter, ids
  before(async () => {
    fixture = await createFixture()
    adapter = adapterFor(fixture)
    ids = Array.from({ length: 33000 }, (_, index) => fixture.storage === 'anyapi' ? String(index + 1) : index + 1)
  })
  beforeEach(async () => {
    await fixture.reset()
    await seed(fixture, 'groups', [1, 101, 201, 33000].map(id => ({ id: String(id), name: `Group ${String(id).padStart(5, '0')}` })))
  })
  after(async () => { await fixture?.close() })

  it('applies a single database sort, filter and global limit to 33,000 IDs', async () => {
    const column = adapter.getIdColumn()
    const query = whereInIdentifiers(adapter.buildBaseQuery(), column, ids)
      .whereNot(column, '201').orderBy(adapter.translateColumn('name'), 'desc').limit(2)
    assert.deepEqual((await query).map(row => adapter.getFieldValue(row, 'name')), ['Group 33000', 'Group 00101'])
    if (fixture.knex.client.config.client !== 'mysql2') assert.ok(query.toSQL().bindings.length <= 5)
  })

  it('retains aliases, subqueries and a caller-owned transaction', async () => {
    const transaction = await fixture.knex.transaction()
    const column = adapter.getIdColumn()
    try {
      await adapter.buildBaseQuery({ transaction }).where(column, '33000').update(adapter.toStorageRow({ name: 'Changed' }))
      const selection = whereInIdentifiers(adapter.buildBaseQuery({ transaction }), column, ids).select(column)
      const query = adapter.buildBaseQuery({ transaction }).whereIn(column, selection).where(column, '33000')
      assert.equal(adapter.getFieldValue(await query.first(), 'name'), 'Changed')
      const aliased = transaction.from(adapter.buildBaseQuery({ transaction }).as('selected'))
      whereInIdentifiers(aliased, `selected.${column}`, ids).where(`selected.${column}`, '33000')
      assert.equal(adapter.getFieldValue(await aliased.first(), 'name'), 'Changed')
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
    assert.equal(adapter.getFieldValue(await adapter.buildBaseQuery().where(column, '33000').first(), 'name'), 'Group 33000')
  })
})

describe('Identifier lists on ordinary SQL bigint columns', () => {
  let fixture, adapter
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'knex', createApi: createIdConformanceApi, tables, apiOptions: { idType: 'string', idColumnType: 'bigint' } })
    adapter = adapterFor(fixture)
  })
  beforeEach(async () => {
    await fixture.reset()
    await seed(fixture, 'groups', [{ id: '9223372036854775806', name: 'First' }, { id: '9223372036854775807', name: 'Second' }])
  })
  after(async () => { await fixture?.close() })
  it('keeps adjacent 64-bit integer values distinct without converting them to JavaScript numbers', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => String(index + 1))
    ids.push('9223372036854775806')
    const rows = await whereInIdentifiers(adapter.buildBaseQuery(), adapter.getIdColumn(), ids).select(adapter.translateColumn('name'))
    assert.deepEqual(rows.map(row => adapter.getFieldValue(row, 'name')), ['First'])
  })
})

describe(`Large nested collection ID lists (${storageMode.mode})`, () => {
  let fixture
  const size = 33000
  const rootId = '100000'
  before(async () => { fixture = await createFixture({ collectionInclude: { limit: null }, inverseMembership: true }) })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('loads all parents through nested hasMany, hasOne, polymorphic and pivot queries', async () => {
    await seed(fixture, 'groups', [{ id: rootId, name: 'Parent' }])
    for (let offset = 0; offset < size; offset += 200) {
      const ids = Array.from({ length: Math.min(200, size - offset) }, (_, index) => String(offset + index + 1))
      await seed(fixture, 'groups', ids.map(id => ({ id, name: `Group ${id}` })))
      await seed(fixture, 'items', ids.map(id => ({ id, name: `Child ${id}`, groupId: id, subjectType: 'groups', subjectId: rootId, active: true, score: 0 })))
    }
    const special = ['1', '100', '101', '200', '33000']
    await seed(fixture, 'items', special.map((id, index) => ({ id: String(size + index + 1), name: `Mention ${id}`, groupId: null, subjectType: 'groups', subjectId: id, active: true, score: 0 })))
    for (const id of special) await fixture.api.resources.items.postRelationship({ id, relationshipName: 'groups', relationshipData: [{ type: 'groups', id }], returning: 'none' })
    const result = await fixture.api.resources.groups.get({ id: rootId, queryParams: { include: ['mentions.group.items', 'mentions.group.firstItem', 'mentions.group.mentions', 'mentions.group.members'] } })
    assert.equal(result.data.relationships.mentions.data.length, size)
    const groups = result.included.filter(row => row.type === 'groups')
    assert.equal(groups.length, size)
    assert.equal(result.included.filter(row => row.type === 'items').length, size + special.length)
    for (const group of groups) {
      assert.deepEqual(group.relationships.items.data, [{ type: 'items', id: group.id }])
      assert.deepEqual(group.relationships.firstItem.data, { type: 'items', id: group.id })
      const index = special.indexOf(group.id)
      assert.deepEqual(group.relationships.mentions.data, index < 0 ? [] : [{ type: 'items', id: String(size + index + 1) }])
      assert.deepEqual(group.relationships.members.data, index < 0 ? [] : [{ type: 'items', id: group.id }])
    }
  })
})
