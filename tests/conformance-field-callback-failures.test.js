import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import express from 'express'
import fastify from 'fastify'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const errors = [
  ['forbidden', new RestApiResourceError('Callback denied', { subtype: 'forbidden' }), false],
  ['validation', new RestApiValidationError('Callback input rejected'), false],
  ['frozen', Object.freeze(new Error('Callback failed')), false],
  ['null', null, true],
  ['undefined', undefined, true],
  ['string', 'Callback failed', false]
]
const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const relationships = [
  { name: 'belongsTo', source: 'items', target: 'groups', include: 'group', value: 'Group' },
  { name: 'hasMany', source: 'groups', target: 'items', include: 'items', value: 'Item' },
  { name: 'hasOne', source: 'groups', target: 'items', include: 'firstItem', value: 'Item' },
  { name: 'manyToMany', source: 'groups', target: 'items', include: 'members', value: 'Item' },
  { name: 'polymorphic', source: 'items', target: 'groups', include: 'subject', value: 'Other group' },
  { name: 'reverse polymorphic', source: 'groups', record: 'other', target: 'items', include: 'mentions', value: 'Item' }
]

function callback (getProbe) {
  return (phase, scopeName, value) => {
    const probe = getProbe()
    if (probe && probe.phase === phase && probe.scopeName === scopeName && (!probe.value || probe.value === value)) {
      probe.calls++
      if (probe.async) return Promise.reject(probe.error)
      throw probe.error
    }
    return phase === 'computed' ? `Computed ${value}` : value
  }
}

function assertFailure (error, original, phase, scopeName, writeOutcome) {
  if (writeOutcome) assertWriteFailure(error, { outcome: writeOutcome })
  const chain = [error]
  while (error && typeof error === 'object' && Object.hasOwn(error, 'cause') && !chain.includes(error.cause)) {
    error = error.cause
    chain.push(error)
  }
  assert.equal(chain.at(-1), original)
  if (original === errors[0][1] || original === errors[1][1]) {
    if (writeOutcome) assertWriteFailure(chain[0], { cause: original })
    else assert.equal(chain[0], original)
  } else {
    assert.ok(chain.some(value => value?.context?.phase === phase && value.context.scopeName === scopeName &&
    value.context.fieldName === (phase === 'computed' ? 'derivedName' : 'name')))
  }
  return true
}

async function seed (fixture) {
  await fixture.reset()
  const group = await fixture.seed('groups', { name: 'Group' })
  const other = await fixture.seed('groups', { name: 'Other group' })
  const item = await fixture.seed('items', { name: 'Item' }, {
    group: { data: { type: 'groups', id: group.id } },
    subject: { data: { type: 'groups', id: other.id } },
    groups: { data: [{ type: 'groups', id: group.id }] }
  })
  return { groups: group, items: item, other }
}

async function snapshot (fixture) {
  const names = fixture.storage === 'anyapi' ? ['any_records', 'any_links'] : ['conformance_items', 'conformance_memberships']
  const state = {}
  for (const name of names) state[name] = await fixture.knex(name).orderBy(name === 'conformance_items' ? 'items_key' : 'id')
  return state
}

describe(`Field callback failures (${storageMode.mode})`, () => {
  let fixture, records, probe
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables,
      apiOptions: { inverseMembership: true, fieldCallback: callback(() => probe) }
    })
  })
  beforeEach(async () => { probe = undefined; records = await seed(fixture) })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    for (const phase of ['getter', 'computed']) {
      for (const method of ['get', 'query']) {
        for (const [label, error, async] of errors) {
          it(`${method} ${format} propagates primary ${phase} ${label} failure`, async () => {
            const read = () => fixture.api.resources.items[method]({ id: records.items.id, format })
            probe = { phase, scopeName: 'items', error, async, calls: 0 }
            try {
              await assert.rejects(read(), actual => assertFailure(actual, error, phase, 'items'))
              assert.equal(probe.calls, 1)
            } finally { probe = undefined }
            assert.ok(await read())
          })
        }
      }

      for (const relationship of relationships) {
        for (const [label, error, async] of [errors[0], errors[3]]) {
          it(`${relationship.name} ${format} propagates included ${phase} ${label} failure`, async () => {
            const read = () => fixture.api.resources[relationship.source].get({
              id: records[relationship.record || relationship.source].id,
              format,
              queryParams: { include: [relationship.include] }
            })
            probe = { phase, scopeName: relationship.target, value: relationship.value, error, async, calls: 0 }
            try {
              await assert.rejects(read(), actual => assertFailure(actual, error, phase, relationship.target))
              assert.equal(probe.calls, 1)
            } finally { probe = undefined }
            assert.ok(await read())
          })
        }
      }

      it(`${format} propagates a nested ${phase} failure after primary enrichment`, async () => {
        probe = { phase, scopeName: 'groups', value: 'Other group', error: errors[2][1], calls: 0 }
        await assert.rejects(fixture.api.resources.groups.get({
          id: records.groups.id, format, queryParams: { include: ['items.subject'] }
        }), error => assertFailure(error, probe.error, phase, 'groups'))
        assert.equal(probe.calls, 1)
      })

      it(`${format} does not run an unselected ${phase}`, async () => {
        probe = { phase, scopeName: 'items', error: errors[2][1], calls: 0 }
        const response = await fixture.api.resources.items.get({ id: records.items.id, format, queryParams: { fields: { items: 'id' } } })
        assert.equal(probe.calls, 0)
        assert.equal(format === 'plain' ? response.id : response.data.id, records.items.id)
      })

      for (const returning of ['minimal', 'none']) {
        it(`${format}/${returning} does not evaluate an unused write-response ${phase}`, async () => {
          probe = { phase, scopeName: 'items', value: 'Changed', error: errors[2][1], calls: 0 }
          const inputRecord = format === 'plain' ? { name: 'Changed' } : { data: { type: 'items', id: records.items.id, attributes: { name: 'Changed' } } }
          await fixture.api.resources.items.patch({ id: records.items.id, [format === 'plain' ? 'data' : 'document']: inputRecord, format, returning })
          assert.equal(probe.calls, 0)
          probe = undefined
          assert.equal((await fixture.api.resources.items.get({ id: records.items.id, format: 'plain' })).name, 'Changed')
        })
      }
    }

    for (const phase of ['setter', 'getter', 'computed']) {
      for (const operation of [{ method: 'post', creates: true }, { method: 'put', creates: true }, { method: 'put' }, { method: 'patch' }]) {
        for (const borrowed of [false, true]) {
          it(`${operation.method} ${operation.creates ? 'create' : 'update'} ${format} rejects ${phase} before ${borrowed ? 'borrowed' : 'owned'} commit`, async () => {
            const id = operation.creates ? '99' : records.items.id
            const attributes = { name: 'Changed', ...(operation.method === 'put' ? { active: true, score: 0 } : {}) }
            const relationships = {
              groups: { data: [{ type: 'groups', id: records.other.id }] },
              ...(operation.method === 'put'
                ? {
                    group: { data: { type: 'groups', id: records.groups.id } },
                    subject: { data: { type: 'groups', id: records.other.id } }
                  }
                : {})
            }
            const inputRecord = format === 'plain'
              ? { id, ...attributes, groups: [records.other.id], ...(operation.method === 'put' ? { group: records.groups.id, subject: { _type: 'groups', id: records.other.id } } : {}) }
              : { data: { type: 'items', id, attributes, relationships } }
            const beforeState = await snapshot(fixture)
            const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
            const transaction = unit?.transaction
            const context = {}
            const [label, original, async] = errors[format === 'plain' ? (borrowed ? 4 : 3) : (borrowed ? 0 : 2)]
            probe = { phase, scopeName: 'items', value: 'Changed', error: original, async, calls: 0 }
            try {
              await assert.rejects(fixture.api.resources.items[operation.method]({ id, [format === 'plain' ? 'data' : 'document']: inputRecord, format, returning: 'full', transaction }, context),
                error => assertFailure(error, original, phase, 'items', borrowed ? 'pending' : 'rolledBack'), label)
              assert.equal(probe.calls, 1)
              assert.equal(context.transactionCommitted, false)
              if (context.transaction) assert.equal(context.transaction.isCompleted(), !borrowed)
              if (borrowed) assert.equal(transaction.isCompleted(), false)
            } finally {
              probe = undefined
              await unit?.rollback()
            }
            assert.deepEqual(await snapshot(fixture), beforeState)
            await fixture.api.resources.items[operation.method]({ id, [format === 'plain' ? 'data' : 'document']: inputRecord, format, returning: 'full' })
            assert.equal((await fixture.api.resources.items.get({ id, format: 'plain' })).name, 'Changed')
          })
        }
      }
    }
  }

  for (const operation of ['post', 'patch', 'put']) {
    for (const phase of ['getter', 'computed']) {
      for (const [label, original, async] of [errors[0], errors[2], errors[3]]) {
        for (const borrowed of [false, true]) {
          it(`${operation} preserves included ${phase} ${label} failure in a full write response (${borrowed ? 'borrowed' : 'owned'})`, async () => {
            const beforeState = await snapshot(fixture)
            const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
            const transaction = unit?.transaction
            const context = {}
            const id = operation === 'post' ? '99' : records.items.id
            probe = { phase, scopeName: 'groups', value: 'Other group', error: original, async, calls: 0 }
            const write = () => fixture.api.resources.items[operation]({
              id,
              transaction,
              format: 'jsonapi',
              returning: 'full',
              queryParams: { include: ['groups'] },
              document: {
                data: {
                  type: 'items',
                  id,
                  attributes: { name: 'Changed', ...(operation === 'put' ? { active: true, score: 0 } : {}) },
                  relationships: {
                    ...(operation === 'put' ? { group: { data: { type: 'groups', id: records.groups.id } }, subject: { data: { type: 'groups', id: records.other.id } } } : {}),
                    groups: { data: [{ type: 'groups', id: records.other.id }] }
                  }
                }
              }
            }, context)
            try {
              await assert.rejects(write(), error => assertFailure(error, original, phase, 'groups', borrowed ? 'pending' : 'rolledBack'))
              assert.equal(probe.calls, 1)
              assert.equal(context.transactionCommitted, false)
              if (context.transaction) assert.equal(context.transaction.isCompleted(), !borrowed)
            } finally {
              probe = undefined
              await unit?.rollback()
            }
            assert.deepEqual(await snapshot(fixture), beforeState)
          })
        }
      }
    }
  }

  for (const phase of ['getter', 'computed']) {
    for (const borrowed of [false, true]) {
      it(`relationship replacement does not run target ${phase} callbacks (${borrowed ? 'borrowed' : 'owned'})`, async () => {
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        probe = { phase, scopeName: 'groups', value: 'Other group', error: errors[0][1], async: false, calls: 0 }
        try {
          await fixture.api.resources.items.patchRelationship({ id: records.items.id, relationshipName: 'groups', relationshipData: [{ type: 'groups', id: records.other.id }], transaction })
          assert.equal(probe.calls, 0)
          if (borrowed) assert.equal(transaction.isCompleted(), false)
          probe = undefined
          assert.deepEqual((await fixture.api.resources.items.getRelationship({ id: records.items.id, relationshipName: 'groups', transaction })).data, [{ type: 'groups', id: records.other.id }])
        } finally {
          probe = undefined
          await unit?.rollback()
        }
      })
    }
  }
})

for (const connector of ['express', 'fastify']) {
  describe(`Real ${connector} field callback failures (${storageMode.mode})`, () => {
    let fixture, app, server, baseUrl, records, probe
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables,
        apiOptions: { app, connector, inverseMembership: true, fieldCallback: callback(() => probe) }
      })
      if (connector === 'express') {
        server = await new Promise(resolve => {
          const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
        })
        baseUrl = `http://127.0.0.1:${server.address().port}`
      } else baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    })
    beforeEach(async () => { probe = undefined; records = await seed(fixture) })
    after(async () => {
      try {
        if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        if (connector === 'fastify') await app?.close()
      } finally { await fixture?.close() }
    })

    for (const phase of ['setter', 'getter', 'computed']) {
      for (const [label, original] of [errors[0], errors[1], errors[2], errors[3]]) {
        it(`${phase} ${label} failures retain their HTTP classification`, async () => {
          const beforeState = await snapshot(fixture)
          const url = `${baseUrl}/api/items/${records.items.id}`
          const options = {
            method: 'PATCH',
            headers: { 'content-type': 'application/vnd.api+json' },
            body: JSON.stringify({ data: { type: 'items', id: records.items.id, attributes: { name: 'Changed' } } })
          }
          probe = { phase, scopeName: 'items', value: 'Changed', error: original, async: true, calls: 0 }
          try {
            const response = await fetch(url, options)
            const body = await response.json()
            assert.equal(response.status, label === 'forbidden' ? 403 : label === 'validation' ? 422 : 500)
            assert.equal(body.errors[0].status, String(response.status))
            assert.ok(body.errors.every(error => error.meta.transactionOutcome === 'rolledBack'))
            assert.equal(Object.hasOwn(body, 'data'), false)
            assert.equal(probe.calls, 1)
          } finally { probe = undefined }
          assert.deepEqual(await snapshot(fixture), beforeState)
          const recovered = await fetch(url, options)
          assert.equal(recovered.status, 200)
          assert.equal((await recovered.json()).data.attributes.name, 'Changed')
        })
      }
    }
  })
}
