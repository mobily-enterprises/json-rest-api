import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const relationships = [
  { parent: 'items', name: 'group', target: 'groups', include: 'firstItem' },
  { parent: 'items', name: 'subject', target: 'groups', include: 'firstItem' },
  { parent: 'groups', name: 'firstItem', target: 'items', include: 'group' }
]
const linkageRelationships = [
  ...relationships,
  { parent: 'groups', name: 'items' },
  { parent: 'groups', name: 'mentions' },
  { parent: 'items', name: 'groups' }
]
const permissionHooks = ['checkPermissions', 'checkDataPermissions', 'checkDataPermissionsGet']
const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const queryOptions = {
  none: () => ({}),
  fields: target => ({ fields: { [target]: 'name' } }),
  include: (target, include) => ({ include: [include] })
}

async function installReadHooks (api) {
  const hooks = {}
  for (const name of [...permissionHooks, 'finishGet']) {
    hooks[name] = {
      functionName: `related-target-${name}`,
      handler: ({ context, scopeName }) => {
        const original = name === 'checkPermissions' ? context.originalContext : context
        if (name === 'checkDataPermissions' && context.parentReadRestriction === scopeName && context.record.data.attributes.name === (scopeName === 'items' ? 'Item' : 'Group')) {
          throw new RestApiResourceError('Parent read denied', { subtype: 'forbidden' })
        }
        const policy = original?.relatedRead
        if (!policy || policy.target !== scopeName || context.method !== 'get') return
        policy.trace?.push(name)
        assert.equal(original.id, '0')
        assert.equal(original.schemaInfo, api.resources[scopeName].vars.schemaInfo)
        if (policy.transaction) assert.equal(original.transaction, policy.transaction)
        if (policy.deny === name) throw new RestApiResourceError('Target read denied', { subtype: 'forbidden' })
        if (name === 'finishGet' && policy.rename) context.record.data.attributes.name = policy.rename
      }
    }
  }
  await api.customize({ hooks })
}

async function seedRelated (fixture) {
  await fixture.reset()
  await fixture.api.resources.groups.post({ format: 'plain', inputRecord: { id: 0, name: 'Group' } })
  await fixture.api.resources.items.post({
    format: 'plain', inputRecord: { id: 0, name: 'Item', group: 0, subject: { _type: 'groups', id: 0 } }
  })
}

describe(`To-one related permission conformance (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables })
    await installReadHooks(fixture.api)
  })
  beforeEach(async () => { await seedRelated(fixture) })
  after(async () => { await fixture?.close() })

  for (const [selection, queryParams] of Object.entries(queryOptions)) {
    it(`preserves parent record permission checks with ${selection}`, async () => {
      const context = { parentReadRestriction: 'items' }
      const expected = { code: 'REST_API_RESOURCE', subtype: 'forbidden' }
      await assert.rejects(fixture.api.resources.items.get({ id: 0 }, context), expected)
      await assert.rejects(fixture.api.resources.items.getRelated({
        id: 0, relationshipName: 'group', queryParams: queryParams('groups', 'firstItem')
      }, context), expected)
    })
  }

  for (const { parent, name } of linkageRelationships) {
    it(`retains parent attributes for ${parent}.${name} linkage permissions`, async () => {
      const context = { parentReadRestriction: parent }
      const expected = { code: 'REST_API_RESOURCE', subtype: 'forbidden' }
      await assert.rejects(fixture.api.resources[parent].get({ id: 0 }, context), expected)
      await assert.rejects(fixture.api.resources[parent].getRelationship({ id: 0, relationshipName: name }, context), expected)
    })
  }

  for (const { parent, name, target, include } of relationships) {
    for (const format of ['jsonapi', 'plain']) {
      for (const [selection, queryParams] of Object.entries(queryOptions)) {
        for (const deny of permissionHooks) {
          it(`enforces ${deny} for ${parent}.${name}, ${selection}, ${format}`, async () => {
            const context = { relatedRead: { target, deny } }
            const expected = { code: 'REST_API_RESOURCE', subtype: 'forbidden' }
            await assert.rejects(fixture.api.resources[target].get({ id: 0, format }, context), expected)
            await assert.rejects(fixture.api.resources[parent].getRelated({
              id: 0, relationshipName: name, format, queryParams: queryParams(target, include)
            }, context), expected)
          })
        }

        it(`runs target GET hooks once for ${parent}.${name}, ${selection}, ${format}`, async () => {
          const trace = []
          const result = await fixture.api.resources[parent].getRelated({
            id: 0, relationshipName: name, format, queryParams: queryParams(target, include)
          }, { relatedRead: { target, trace, rename: 'From target finish hook' } })
          assert.deepEqual(trace, [...permissionHooks, 'finishGet'])
          const record = format === 'plain' ? result : result.data
          assert.equal(record.id, '0')
          assert.equal(format === 'plain' ? record.name : record.attributes.name, 'From target finish hook')
          if (selection === 'include') {
            if (format === 'plain') assert.equal(record[include].id, '0')
            else assert.ok(result.included.some(row => row.id === '0' && row.type === parent))
          }
        })
      }
    }

    it(`uses and leaves open a caller transaction for ${parent}.${name}`, async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        await fixture.api.resources[target].patch({
          id: 0, format: 'plain', returning: 'none', transaction, inputRecord: { name: 'Uncommitted name' }
        })
        const result = await fixture.api.resources[parent].getRelated({ id: 0, relationshipName: name, transaction, format: 'plain' }, {
          relatedRead: { target, transaction }
        })
        assert.equal(result.name, 'Uncommitted name')
        assert.equal(transaction.isCompleted(), false)
        await assert.rejects(fixture.api.resources[parent].getRelated({ id: 0, relationshipName: name, transaction }, {
          relatedRead: { target, transaction, deny: 'checkDataPermissionsGet' }
        }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
        assert.equal(transaction.isCompleted(), false)
      } finally { await unit.rollback() }
      assert.equal((await fixture.api.resources[target].get({ id: 0, format: 'plain' })).name, target === 'groups' ? 'Group' : 'Item')
    })
  }
})

for (const connector of ['express', 'fastify']) {
  describe(`Related HTTP authorization through ${connector} (${storageMode.mode})`, () => {
    let app, fixture
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({ createApi: createIdConformanceApi, apiOptions: { connector, app }, tables })
      await installReadHooks(fixture.api)
      await fixture.api.customize({
        hooks: {
          'transport:request': {
            functionName: 'related-http-permissions',
            handler: ({ context }) => {
              const headers = context.transport.request.headers
              context.relatedRead = { target: headers['x-target'], deny: headers['x-deny'] }
              context.parentReadRestriction = headers['x-deny-parent']
            }
          }
        }
      })
      if (connector === 'fastify') await app.ready()
    })
    beforeEach(async () => { await seedRelated(fixture) })
    after(async () => {
      try { if (connector === 'fastify') await app?.close() } finally { await fixture?.close() }
    })
    for (const { parent, name } of linkageRelationships) {
      it(`rejects ${parent}.${name} linkage when the parent GET is forbidden`, async () => {
        const url = `/api/${parent}/0/relationships/${name}`
        const headers = { 'x-deny-parent': parent }
        const response = connector === 'express'
          ? await request(app).get(url).set(headers)
          : await app.inject({ method: 'GET', url, headers })
        assert.equal(response.statusCode, 403)
        const body = connector === 'express' ? response.body : response.json()
        assert.equal(Object.hasOwn(body, 'data'), false)
        assert.equal(body.errors[0].detail, 'Parent read denied')
      })
    }
    for (const { parent, name, target } of relationships) {
      for (const deny of permissionHooks) {
        it(`rejects ${parent}.${name} at ${deny} without returning target data`, async () => {
          const url = `/api/${parent}/0/${name}`
          const headers = { 'x-target': target, 'x-deny': deny }
          const response = connector === 'express'
            ? await request(app).get(url).set(headers)
            : await app.inject({ method: 'GET', url, headers })
          assert.equal(response.statusCode, 403)
          const body = connector === 'express' ? response.body : response.json()
          assert.equal(Object.hasOwn(body, 'data'), false)
          assert.equal(body.errors[0].status, '403')
          assert.equal(body.errors[0].detail, 'Target read denied')
        })
      }
    }
  })
}
