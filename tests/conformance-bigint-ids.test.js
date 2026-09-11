import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const first = '9223372036854775806'
const second = '9223372036854775807'
const owner = '9007199254740993'
const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }

for (const strategy of ['standard', 'window']) {
  describe(`Lossless stored IDs, ${strategy} (${storageMode.mode})`, () => {
    let fixture
    const seed = (type, records) => seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records)
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables,
        apiOptions: {
          idType: 'string',
          idColumnType: 'bigint',
          inverseMembership: true,
          referenceCollation: 'native',
          collectionInclude: { strategy, limit: 20, orderBy: ['id'] },
          manyToManyInclude: { strategy, limit: 20, orderBy: ['id'] }
        }
      })
      assert.equal(fixture.storage, storageMode.mode)
    })
    beforeEach(async () => {
      await fixture.reset()
      await seed('groups', [{ id: first, name: 'First' }, { id: second, name: 'Second' }])
      await seed('items', [{ id: owner, name: 'Owner', groupId: first, subjectType: 'groups', subjectId: second }])
      if (fixture.storage === 'knex') await seed('memberships', [{ itemId: owner, groupId: first }, { itemId: owner, groupId: second }])
      else await fixture.api.anyapi.links.attachMany({ scopeName: 'items', relName: 'groups', relData: [first, second].map(id => ({ type: 'groups', id })), context: { id: owner, db: fixture.knex } })
    })
    after(async () => { await fixture?.close() })

    for (const format of ['jsonapi', 'plain']) {
      it(`returns exact primary and to-one IDs (${format})`, async () => {
        const fetched = await fixture.api.resources.items.get({ id: owner, format })
        const row = format === 'plain' ? fetched : fetched.data
        assert.equal(row.id, owner)
        assert.equal((format === 'plain' ? row.group : row.relationships.group.data).id, first)
        assert.equal((format === 'plain' ? row.subject : row.relationships.subject.data).id, second)
        assert.deepEqual((format === 'plain' ? row.groups : row.relationships.groups.data).map(row => row.id).sort(), [first, second])
      })

      it(`includes both adjacent targets and their reverse relationships (${format})`, async () => {
        const fetched = await fixture.api.resources.items.get({ id: owner, format, queryParams: { include: ['groups.items', 'group', 'subject'] } })
        const row = format === 'plain' ? fetched : fetched.data
        const groups = format === 'plain' ? row.groups : row.relationships.groups.data
        assert.deepEqual(groups.map(row => row.id), [first, second])
        if (format === 'plain') assert.equal(groups[0].items[0].id, owner)
        else {
          assert.deepEqual(fetched.included.filter(row => row.type === 'groups').map(row => row.id).sort(), [first, second])
          assert.ok(fetched.included.every(row => row.type !== 'items' || row.id !== owner))
          assert.deepEqual(fetched.included.find(row => row.id === first).relationships.items.data, [{ type: 'items', id: owner }])
        }
      })

      it(`reads related collections and reverse polymorphic linkage (${format})`, async () => {
        const related = await fixture.api.resources.groups.getRelated({ id: first, relationshipName: 'items', format })
        assert.deepEqual(related.data.map(row => row.id), [owner])
        const fetched = await fixture.api.resources.groups.get({ id: second, format, queryParams: { include: ['mentions'] } })
        const rows = format === 'plain' ? fetched.mentions : fetched.data.relationships.mentions.data
        assert.deepEqual(rows.map(row => row.id), [owner])
      })

      for (const returning of ['minimal', 'full']) {
        it(`creates an explicit bigint ID with ${returning} ${format} output`, async () => {
          const id = '9007199254740995'
          const result = await fixture.api.resources.items.post({
            format,
            returning,
            inputRecord: format === 'plain'
              ? { id, name: 'Created', group: first, groups: [first, second] }
              : { data: { type: 'items', id, attributes: { name: 'Created' }, relationships: { group: { data: { type: 'groups', id: first } }, groups: { data: [first, second].map(id => ({ type: 'groups', id })) } } } }
          })
          assert.equal((format === 'plain' ? result : result.data).id, id)
          const fetched = await fixture.api.resources.items.get({ id })
          assert.deepEqual(fetched.data.relationships.groups.data.map(row => row.id).sort(), [first, second])
        })
      }
    }

    it('updates both adjacent targets without collapsing locks or pivot membership', async () => {
      const items = fixture.api.resources.items
      for (let attempt = 0; attempt < 2; attempt++) {
        await items.patch({ id: owner, format: 'plain', inputRecord: { groups: [first, second], group: second } })
        const result = await items.get({ id: owner })
        assert.equal(result.data.relationships.group.data.id, second)
        assert.deepEqual(result.data.relationships.groups.data.map(row => row.id).sort(), [first, second])
      }
      assert.equal(await fixture.count('memberships'), 2)
      await items.put({ id: owner, format: 'plain', inputRecord: { name: 'Replaced', active: true, score: 0, group: first, groups: [second] } })
      assert.deepEqual((await items.get({ id: owner })).data.relationships.groups.data, [{ type: 'groups', id: second }])
      await items.delete({ id: owner })
      assert.equal(await fixture.count('items'), 0)
    })

    it('retains exact reference values in sparse cursor pages', async () => {
      await seed('items', [{ id: '9007199254740995', name: 'Other', groupId: second }])
      let queryParams = { fields: { items: 'name' }, sort: ['group'], page: { size: 1 } }
      const seen = []
      for (let page = 0; page < 4; page++) {
        const result = await fixture.api.resources.items.query({ queryParams })
        seen.push(...result.data.map(row => row.id))
        if (!result.links.next) break
        assert.ok(page < 3, 'Reference cursor traversal must terminate')
        queryParams = parseJsonApiQuery(new URL(result.links.next, 'https://example.test').search.slice(1))
      }
      assert.deepEqual(seen, [owner, '9007199254740995'])
    })

    it('removes reverse children using exact stored IDs', async () => {
      await fixture.api.resources.groups.patchRelationship({ id: first, relationshipName: 'items', relationshipData: [] })
      assert.equal((await fixture.api.resources.items.get({ id: owner })).data.relationships.group.data, null)
    })

    it('retains caller transaction ownership and exact pending linkage', async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        const pending = await fixture.api.resources.items.patch({ id: owner, transaction, format: 'plain', inputRecord: { name: 'Pending', groups: [second] } })
        assert.equal(pending.id, owner)
        const fetched = await fixture.api.resources.items.get({ id: owner, transaction, queryParams: { include: ['groups'] } })
        assert.deepEqual(fetched.data.relationships.groups.data, [{ type: 'groups', id: second }])
        assert.equal(transaction.isCompleted(), false)
      } finally { await unit.rollback() }
      assert.equal((await fixture.api.resources.items.get({ id: owner })).data.attributes.name, 'Owner')
    })

    it('sorts native numeric IDs across signs and the safe-integer boundary', async () => {
      const extra = ['-9223372036854775808', '-9007199254740993', '2', '10', '9007199254740991', '9007199254740993']
      await seed('groups', extra.map(id => ({ id, name: id })))
      const expected = [...extra, first, second].sort(fixture.storage === 'knex' ? (a, b) => BigInt(a) < BigInt(b) ? -1 : 1 : undefined)
      const result = await fixture.api.resources.groups.query({ queryParams: { fields: { groups: 'name' }, sort: ['id'], page: { size: 20 } } })
      assert.deepEqual(result.data.map(row => row.id), expected)
      for (const sort of ['id', '-id']) {
        let queryParams = { fields: { groups: 'name' }, sort: [sort], page: { size: 2 } }
        const seen = []
        for (let page = 0; page < 6; page++) {
          const result = await fixture.api.resources.groups.query({ queryParams })
          seen.push(...result.data.map(row => row.id))
          if (!result.links.next) break
          assert.ok(page < 5, 'Cursor traversal must terminate')
          queryParams = parseJsonApiQuery(new URL(result.links.next, 'https://example.test').search.slice(1))
        }
        assert.deepEqual(seen, sort === 'id' ? expected : expected.toReversed())
      }
    })
  })
}

if (!storageMode.isAnyApi()) {
  describe('Generated ordinary SQL bigint IDs', () => {
    let fixture
    const previous = '9007199254740992'
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { idType: 'id', idColumnType: 'bigint', generatedIds: true, mappedIds: false } })
    })
    beforeEach(async () => {
      await fixture.reset()
      await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo, [{ id: previous, name: 'Previous' }])
      if (fixture.knex.client.config.client === 'pg') await fixture.knex.raw("SELECT setval(pg_get_serial_sequence('conformance_items', 'id'), ?::bigint)", [previous])
    })
    after(async () => { await fixture?.close() })
    for (const format of ['jsonapi', 'plain']) {
      for (const returning of ['minimal', 'full']) {
        it(`returns exact generated IDs (${format}, ${returning})`, async () => {
          const result = await fixture.api.resources.items.post({ format, returning, inputRecord: format === 'plain' ? { name: 'Generated' } : { data: { type: 'items', attributes: { name: 'Generated' } } } })
          const id = (format === 'plain' ? result : result.data).id
          assert.ok(BigInt(id) > BigInt(previous))
          const textType = fixture.knex.client.config.client === 'mysql2' ? 'char' : 'text'
          const row = await fixture.knex('conformance_items').where('display_name', 'Generated').select({ id: fixture.knex.raw(`cast(?? as ${textType})`, ['id']) }).first()
          assert.equal(id, row.id)
          assert.equal((await fixture.api.resources.items.get({ id })).data.attributes.name, 'Generated')
        })
      }
    }
  })
}
