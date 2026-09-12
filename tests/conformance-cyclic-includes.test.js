import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { validateJsonApiStructure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const fields = { items: 'derivedName,group,subject,groups', groups: 'derivedName,items,firstItem,mentions,members' }
const resources = document => [...(Array.isArray(document.data) ? document.data : [document.data]), ...(document.included || [])]
const identity = ({ type, id }) => JSON.stringify([type, id])
const cycles = [
  ['items', 'group.items'], ['items', 'subject.mentions'], ['items', 'groups.members'],
  ['groups', 'items.group'], ['groups', 'firstItem.group'], ['groups', 'mentions.subject']
]

for (const strategy of ['standard', 'window']) {
  describe(`Cyclic compound documents, ${strategy} (${storageMode.mode})`, () => {
    let fixture
    const calls = []
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables,
        apiOptions: {
          inverseMembership: true,
          collectionInclude: { strategy, limit: 20, orderBy: ['id'] },
          manyToManyInclude: { strategy, limit: 20, orderBy: ['id'] },
          resourcePolicy: ({ query, column, context }) => { if (context.hideTwo) query.whereNot(column('name'), 'Two'); return true },
          fieldCallback: (phase, type, value, context) => {
            if (phase === 'computed') calls.push(identity({ type, id: context.id }))
            return phase === 'computed' ? `Computed ${value}` : value
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      for (const name of ['Group', 'Other']) await fixture.seed('groups', { name })
      for (const [name, group, groups] of [['One', '1', ['1']], ['Two', '1', ['1', '2']], ['Three', '2', ['2']]]) {
        await fixture.seed('items', { name }, {
          group: { data: { type: 'groups', id: group } },
          subject: { data: { type: 'groups', id: group } },
          groups: { data: groups.map(id => ({ type: 'groups', id })) }
        })
      }
      calls.length = 0
    })
    after(async () => { await fixture?.close() })

    const check = document => {
      validateJsonApiStructure(document, Array.isArray(document.data))
      const all = resources(document)
      assert.deepEqual([...calls].sort(), all.map(identity).sort(), 'compute each represented resource once')
      for (const row of all) {
        assert.deepEqual(Object.keys(row.attributes), ['derivedName'])
        assert.ok(row.attributes.derivedName.startsWith('Computed '))
      }
      return all
    }

    for (const [type, path] of cycles) {
      for (const method of ['get', 'query']) {
        it(`${method} traverses ${type}.${path} without duplicating primary resources or computations`, async () => {
          const document = await fixture.api.resources[type][method]({ id: '1', queryParams: { fields, include: [path], filters: { name: type === 'items' ? 'One' : 'Group' } } })
          const all = check(document)
          assert.ok(all.length >= 2)
          assert.ok((document.included || []).every(row => row.type !== type || row.id !== '1'))
          const root = Array.isArray(document.data) ? document.data[0] : document.data
          const [first, second] = path.split('.')
          const links = root.relationships[first].data
          for (const link of Array.isArray(links) ? links : [links]) {
            const child = all.find(row => identity(row) === identity(link))
            const back = child.relationships[second].data
            assert.ok((Array.isArray(back) ? back : [back]).some(row => identity(row) === identity(root)))
          }
        })
      }
    }

    for (const type of ['items', 'groups']) {
      it(`shares ${type} across collection primaries and independent include paths`, async () => {
        const include = type === 'items' ? ['group.items', 'groups.members', 'subject.mentions'] : ['items.group', 'mentions.subject', 'members.groups']
        const document = await fixture.api.resources[type].query({ queryParams: { fields, include } })
        check(document)
        assert.equal(document.data.length, type === 'items' ? 3 : 2)
        assert.ok(document.included.every(row => row.type !== type))
      })
    }

    it('keeps relationships discovered only after returning to a primary resource', async () => {
      const document = await fixture.api.resources.groups.get({ id: '1', queryParams: { fields, include: ['items.group.mentions'] } })
      check(document)
      assert.deepEqual(document.data.relationships.mentions.data.map(row => row.id), ['1', '2'])
      assert.deepEqual(document.included.filter(row => row.type === 'items').map(row => row.id).sort(), ['1', '2'])
      for (const row of document.included) assert.deepEqual(row.relationships.subject.data, { type: 'groups', id: '1' })
    })

    it('preserves sparse attributes when relationship field names are omitted', async () => {
      const document = await fixture.api.resources.items.query({ queryParams: { fields: { items: 'derivedName', groups: 'derivedName' }, include: ['groups.members.group'] } })
      check(document)
      assert.equal(document.data.length, 3)
      assert.equal(document.included.length, 2)
    })

    it('expands peer primary records in plain collections and terminates actual cycles', async () => {
      const document = await fixture.api.resources.items.query({ format: 'plain', queryParams: { fields, include: ['group.items'] } })
      assert.deepEqual([...calls].sort(), ['items:1', 'items:2', 'items:3', 'groups:1', 'groups:2'].map(value => identity({ type: value.split(':')[0], id: value.split(':')[1] })).sort())
      const one = document.data.find(row => row.id === '1')
      assert.equal(one.group.derivedName, 'Computed Group')
      assert.deepEqual(one.group.items.find(row => row.id === '1'), { id: '1' })
      const peer = one.group.items.find(row => row.id === '2')
      assert.equal(peer.derivedName, 'Computed Two')
      assert.deepEqual(peer.group, { id: '1' })
      assert.deepEqual(JSON.parse(JSON.stringify(document)), document)
    })

    it('applies visibility before resolving cyclic resource identities', async () => {
      const document = await fixture.api.resources.items.get({ id: '1', queryParams: { fields, include: ['groups.members.group'] } }, { hideTwo: true })
      const all = check(document)
      assert.ok(all.every(row => row.type !== 'items' || row.id !== '2'))
      assert.deepEqual(document.included[0].relationships.members.data, [{ type: 'items', id: '1' }])
    })

    it('returns unique related collection resources with cyclic includes', async () => {
      const document = await fixture.api.resources.groups.getRelated({ id: '1', relationshipName: 'items', queryParams: { fields, include: ['group.items'] } })
      check(document)
      assert.deepEqual(document.data.map(row => row.id), ['1', '2'])
    })

    for (const method of ['post', 'patch', 'put']) {
      it(`${method} full responses compute cyclic resources once inside a borrowed transaction`, async () => {
        const unit = await holdManagedTransaction(fixture.api)
        const transaction = unit.transaction
        try {
          const id = method === 'post' ? '4' : '1'
          const document = await fixture.api.resources.items[method]({
            id,
            transaction,
            returning: 'full',
            document: { data: { type: 'items', id, attributes: { name: 'Written', active: true, score: 0 }, relationships: { group: { data: { type: 'groups', id: '1' } }, subject: { data: { type: 'groups', id: '1' } }, groups: { data: [{ type: 'groups', id: '1' }] } } } },
            queryParams: { fields, include: ['group.items'] }
          })
          check(document)
          assert.equal(document.data.attributes.derivedName, 'Computed Written')
          assert.equal(transaction.isCompleted(), false)
        } finally { await unit.rollback() }
        const original = await fixture.api.resources.items.get({ id: '1', queryParams: { fields: { items: 'name' } } })
        assert.equal(original.data.attributes.name, 'One')
      })
    }
  })

  describe(`Cyclic include limits, ${strategy} (${storageMode.mode})`, () => {
    let fixture
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables,
        apiOptions: {
          inverseMembership: true,
          collectionInclude: { strategy, limit: 1, orderBy: ['id'] },
          manyToManyInclude: { strategy, limit: 1, orderBy: ['id'] }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      await fixture.seed('groups', { name: 'Group' })
      for (const name of ['One', 'Two']) {
        await fixture.seed('items', { name }, {
          group: { data: { type: 'groups', id: '1' } },
          subject: { data: { type: 'groups', id: '1' } },
          groups: { data: [{ type: 'groups', id: '1' }] }
        })
      }
    })
    after(async () => { await fixture?.close() })

    for (const [relationship, cycle] of [['items', 'members.group.mentions'], ['members', 'items.group.mentions'], ['mentions', 'items.group.members']]) {
      for (const reverse of [false, true]) {
        it(`retains the explicit ${relationship} limit across ${cycle} (${reverse ? 'cycle first' : 'direct first'})`, async () => {
          const include = reverse ? [cycle, relationship] : [relationship, cycle]
          const document = await fixture.api.resources.groups.get({ id: '1', queryParams: { include } })
          validateJsonApiStructure(document)
          assert.deepEqual(document.data.relationships[relationship].data, [{ type: 'items', id: '1' }])
          assert.deepEqual(document.included.map(identity), [identity({ type: 'items', id: '1' })])
        })
      }
    }

    it('retains separate limited relationships on an included resource shared by sibling paths', async () => {
      const document = await fixture.api.resources.items.get({ id: '1', queryParams: { include: ['group.items', 'groups.members', 'subject.mentions'] } })
      validateJsonApiStructure(document)
      assert.equal(document.included.length, 1)
      for (const name of ['items', 'members', 'mentions']) assert.deepEqual(document.included[0].relationships[name].data, [{ type: 'items', id: '1' }])
    })
  })
}
