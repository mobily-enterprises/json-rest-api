import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from './helpers/test-database.js'
import { createReverseRelationshipApi, seedReverseRelationshipRecord } from './fixtures/api-configs.js'
import { cleanTables, countRecords } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

for (const childIdProperty of ['id', 'key']) {
  describe(`Reverse relationship writes, child ID ${childIdProperty} (${storageMode.mode})`, () => {
    let knex
    let database
    let api
    let parent
    let otherParent
    let owned
    let foreign
    let free
    const childWrites = []
    const seed = (type, name, relationships) => seedReverseRelationshipRecord(api, type, name, relationships)
    const identifier = (record) => ({ type: record.type, id: record.id })
    const relationship = (record) => ({ data: record ? identifier(record) : null })
    const linkage = async (record = parent, name = 'children', transaction) => (await api.resources[record.type].getRelationship({
      id: record.id, relationshipName: name, transaction
    })).data
    const children = async () => (await linkage()).map(record => record.id).sort()
    const mutate = (method, records, options = {}, context = {}) => api.resources.parents[method]({
      id: parent.id, relationshipName: 'children', relationshipData: records.map(identifier), ...options
    }, context)

    before(async () => {
      database = await createTestDatabase()
      knex = database.knex
      api = await createReverseRelationshipApi(knex, { childIdProperty })
      assert.equal(api.anyapi ? 'anyapi' : 'knex', storageMode.mode)
      await api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'deny-selected-child-write',
            handler: ({ context, scopeName }) => {
              const request = context.originalContext
              if (scopeName === 'children' && context.method === 'patch' && request?.denyChildId !== undefined && request.denyChildId === request.id) {
                throw new RestApiResourceError('Child write denied', { subtype: 'forbidden' })
              }
            }
          },
          afterDataCallPatch: {
            functionName: 'observe-child-membership-write',
            handler: ({ context, scopeName }) => {
              if (scopeName === 'children') childWrites.push({ id: context.id, transaction: context.transaction, marker: context.marker })
            }
          }
        }
      })
    })
    after(async () => {
      try { await database?.close() } finally { storageMode.clearRegistry(knex) }
    })
    beforeEach(async () => {
      await cleanTables(knex, ['children', 'profiles', 'requiredChildren', 'comments', 'parents', 'others'].map(name => `reverse_${name}`))
      parent = await seed('parents', 'Parent')
      otherParent = await seed('parents', 'Other parent')
      owned = []
      for (let index = 0; index < 4; index++) owned.push(await seed('children', `Owned ${index}`, { parent: relationship(parent) }))
      foreign = await seed('children', 'Foreign', { parent: relationship(otherParent) })
      free = await seed('children', 'Free')
      childWrites.length = 0
    })

    it('adds members once and preserves existing members', async () => {
      assert.equal(await mutate('postRelationship', [free, free, owned[0]], {}, { marker: 'caller' }), undefined)
      assert.deepEqual(await children(), [...owned, free].map(record => record.id).sort())
      assert.deepEqual(childWrites.map(record => record.id), [free.id])
      assert.equal(childWrites[0].marker, 'caller')
      await mutate('postRelationship', [free])
      assert.equal(childWrites.length, 1)
    })

    it('removes members idempotently without detaching another parent or deleting a child', async () => {
      const missing = { type: 'children', id: '99999' }
      assert.equal(await mutate('deleteRelationship', [owned[0], owned[0], foreign, free, missing]), undefined)
      assert.deepEqual(await children(), owned.slice(1).map(record => record.id).sort())
      assert.deepEqual(await linkage(otherParent), [identifier(foreign)])
      assert.equal((await api.resources.children.get({ id: owned[0].id })).data.relationships.parent.data, null)
      await mutate('deleteRelationship', [owned[0], missing])
      assert.deepEqual(childWrites.map(record => record.id), [owned[0].id])
    })

    it('replaces the whole collection beyond query limits and clears it explicitly', async () => {
      assert.equal(await mutate('patchRelationship', [owned[1], free, free]), undefined)
      assert.deepEqual(await children(), [owned[1].id, free.id].sort())
      await mutate('patchRelationship', [])
      assert.deepEqual(await children(), [])
      assert.deepEqual(await linkage(otherParent), [identifier(foreign)])
    })

    for (const method of ['postRelationship', 'patchRelationship', 'deleteRelationship']) {
      it(`${method} rejects the wrong target type even when its ID exists as a child`, async () => {
        await assert.rejects(mutate(method, [{ type: 'parents', id: owned[0].id }]), { code: 'REST_API_VALIDATION' })
        assert.deepEqual(await children(), owned.map(record => record.id).sort())
      })

      it(`${method} rolls back earlier child changes if a later child rejects the write`, async () => {
        const selected = method === 'postRelationship' ? [free, foreign] : [owned[0], owned[1]]
        const denied = method === 'patchRelationship' ? owned[3] : selected[1]
        await assert.rejects(mutate(method, selected, {}, { denyChildId: denied.id }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
        assert.deepEqual(await children(), owned.map(record => record.id).sort())
        assert.deepEqual(await linkage(otherParent), [identifier(foreign)])
        assert.equal((await api.resources.children.get({ id: free.id })).data.relationships.parent.data, null)
      })
    }

    it('keeps a borrowed transaction open and rolls back membership with the caller', async () => {
      const unit = await holdManagedTransaction(api)
      const transaction = unit.transaction
      try {
        await mutate('patchRelationship', [free], { transaction })
        assert.deepEqual(await linkage(parent, 'children', transaction), [identifier(free)])
        assert.equal(transaction.isCompleted(), false)
        assert.ok(childWrites.every(record => record.transaction === transaction))
      } finally { await unit.rollback() }
      assert.deepEqual(await children(), owned.map(record => record.id).sort())
    })

    it('rolls back replacement if a requested child does not exist', async () => {
      await assert.rejects(mutate('patchRelationship', [free, { type: 'children', id: '99999' }]), {
        code: 'REST_API_RESOURCE', subtype: 'not_found'
      })
      assert.deepEqual(await children(), owned.map(record => record.id).sort())
    })

    it('updates reverse relationships in resource POST, PATCH and PUT payloads', async () => {
      const created = (await api.resources.parents.post({
        document: { data: { type: 'parents', attributes: { name: 'Created' }, relationships: { children: { data: [identifier(free)] } } } }
      })).data
      assert.deepEqual(await linkage(created), [identifier(free)])
      await api.resources.parents.patch({
        id: created.id,
        document: {
          data: { type: 'parents', relationships: { children: { data: [identifier(foreign)] } } }
        }
      })
      assert.deepEqual(await linkage(created), [identifier(foreign)])
      await api.resources.parents.put({
        id: created.id,
        document: {
          data: { type: 'parents', attributes: { name: 'Replaced' }, relationships: { children: { data: [identifier(free)] } } }
        }
      })
      assert.deepEqual(await linkage(created), [identifier(free)])
      await api.resources.parents.put({
        id: created.id,
        document: {
          data: { type: 'parents', attributes: { name: 'Cleared' }, relationships: {} }
        }
      })
      assert.deepEqual(await linkage(created), [])
    })

    it('keeps reverse relationships when a PUT has no relationships object', async () => {
      await api.resources.parents.put({ id: parent.id, document: { data: { type: 'parents', attributes: { name: 'Renamed' } } } })
      assert.deepEqual(await children(), owned.map(record => record.id).sort())
    })

    it('creates reverse linkage through PUT creation and plain PATCH input', async () => {
      const created = (await api.resources.parents.put({
        id: '999',
        document: {
          data: { type: 'parents', attributes: { name: 'PUT created' }, relationships: { children: { data: [identifier(free)] } } }
        }
      })).data
      assert.deepEqual(await linkage(created), [identifier(free)])
      await api.resources.parents.patch({ id: parent.id, data: { children: [free.id] }, format: 'plain' })
      assert.deepEqual(await children(), [free.id])
      assert.deepEqual(await linkage(created), [])
    })

    it('rolls back the parent create or attribute update when a reverse child write fails', async () => {
      const document = { data: { type: 'parents', attributes: { name: 'Must roll back' }, relationships: { children: { data: [identifier(free)] } } } }
      await assert.rejects(api.resources.parents.post({ document }, { denyChildId: free.id }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
      assert.equal(await countRecords(knex, 'reverse_parents'), 2)
      await assert.rejects(api.resources.parents.patch({ id: parent.id, document }, { denyChildId: free.id }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
      assert.deepEqual(await children(), owned.map(record => record.id).sort())
      assert.equal((await api.resources.parents.get({ id: parent.id })).data.attributes.name, 'Parent')
    })

    it('leaves a failed borrowed transaction for its owner to roll back', async () => {
      const unit = await holdManagedTransaction(api)
      const transaction = unit.transaction
      try {
        await assert.rejects(mutate('deleteRelationship', [owned[0], owned[1]], { transaction }, { denyChildId: owned[1].id }), {
          code: 'REST_API_RESOURCE', subtype: 'forbidden'
        })
        assert.equal(transaction.isCompleted(), false)
        assert.deepEqual((await linkage(parent, 'children', transaction)).map(record => record.id).sort(), owned.slice(1).map(record => record.id).sort())
      } finally { await unit.rollback() }
      assert.deepEqual(await children(), owned.map(record => record.id).sort())
    })

    it('replaces and clears a hasOne relationship without violating uniqueness', async () => {
      const original = await seed('profiles', 'Original', { parent: relationship(parent) })
      const next = await seed('profiles', 'Next', { parent: relationship(otherParent) })
      await api.resources.parents.patchRelationship({ id: parent.id, relationshipName: 'profile', relationshipData: identifier(next) })
      assert.deepEqual(await linkage(parent, 'profile'), identifier(next))
      assert.equal((await api.resources.parents.getRelated({ id: parent.id, relationshipName: 'profile' })).data.id, next.id)
      assert.equal(await linkage(otherParent, 'profile'), null)
      assert.equal((await api.resources.profiles.get({ id: original.id })).data.relationships.parent.data, null)
      await api.resources.parents.patchRelationship({ id: parent.id, relationshipName: 'profile', relationshipData: null })
      assert.equal(await linkage(parent, 'profile'), null)
    })

    it('reads, replaces and clears the belongsTo side of the same relationship', async () => {
      await api.resources.children.patchRelationship({ id: owned[0].id, relationshipName: 'parent', relationshipData: identifier(otherParent) })
      assert.deepEqual(await linkage(owned[0], 'parent'), identifier(otherParent))
      assert.equal((await api.resources.children.getRelated({ id: owned[0].id, relationshipName: 'parent' })).data.id, otherParent.id)
      await api.resources.children.patchRelationship({ id: owned[0].id, relationshipName: 'parent', relationshipData: null })
      assert.equal(await linkage(owned[0], 'parent'), null)
      assert.equal(await api.resources.children.getRelated({ id: owned[0].id, relationshipName: 'parent', format: 'plain' }), null)
    })

    it('reads both polymorphic target types and empty polymorphic linkage', async () => {
      const comment = await seed('comments', 'Polymorphic child', { subject: relationship(parent) })
      const other = await seed('others', 'Other target')
      const related = await api.resources.comments.getRelated({
        id: comment.id, relationshipName: 'subject', queryParams: { fields: { parents: 'name' } }
      })
      assert.equal(related.data.id, parent.id)
      assert.equal(related.data.type, 'parents')
      await api.resources.comments.patchRelationship({ id: comment.id, relationshipName: 'subject', relationshipData: identifier(other) })
      assert.deepEqual(await linkage(comment, 'subject'), identifier(other))
      const plain = await api.resources.comments.getRelated({ id: comment.id, relationshipName: 'subject', format: 'plain' })
      assert.equal(plain.id, other.id)
      assert.equal(plain.name, 'Other target')
      await api.resources.comments.patchRelationship({ id: comment.id, relationshipName: 'subject', relationshipData: null })
      assert.equal(await linkage(comment, 'subject'), null)
      assert.equal((await api.resources.comments.getRelated({ id: comment.id, relationshipName: 'subject' })).data, null)
    })

    it('updates polymorphic members using both parent type and ID', async () => {
      const other = await seed('others', 'Other type')
      const comment = await seed('comments', 'Owned comment', { subject: relationship(parent) })
      const unrelated = await seed('comments', 'Other type comment', { subject: relationship(other) })
      const next = await seed('comments', 'Free comment')
      await api.resources.parents.postRelationship({ id: parent.id, relationshipName: 'comments', relationshipData: [identifier(next)] })
      await api.resources.parents.deleteRelationship({ id: parent.id, relationshipName: 'comments', relationshipData: [identifier(unrelated)] })
      assert.deepEqual((await linkage(parent, 'comments')).map(record => record.id).sort(), [comment.id, next.id].sort())
      assert.deepEqual((await api.resources.comments.get({ id: unrelated.id })).data.relationships.subject.data, identifier(other))
      await api.resources.parents.patchRelationship({ id: parent.id, relationshipName: 'comments', relationshipData: [identifier(next)] })
      assert.deepEqual(await linkage(parent, 'comments'), [identifier(next)])
      assert.equal((await api.resources.comments.get({ id: comment.id })).data.relationships.subject.data, null)
    })

    it('rejects clearing a required child relationship without changing membership', async () => {
      const child = await seed('requiredChildren', 'Required', { parent: relationship(parent) })
      await assert.rejects(api.resources.parents.patchRelationship({ id: parent.id, relationshipName: 'requiredChildren', relationshipData: [] }), {
        code: 'REST_API_VALIDATION'
      })
      assert.deepEqual(await linkage(parent, 'requiredChildren'), [identifier(child)])
    })
  })
}
