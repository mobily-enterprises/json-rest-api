import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const relationships = [
  { name: 'belongsTo', source: 'items', target: 'groups', include: 'group' },
  { name: 'hasMany', source: 'groups', target: 'items', include: 'items' },
  { name: 'hasOne', source: 'groups', target: 'items', include: 'firstItem' },
  { name: 'manyToMany', source: 'groups', target: 'items', include: 'members' },
  { name: 'polymorphic', source: 'items', target: 'groups', include: 'subject' },
  { name: 'reverse polymorphic', source: 'groups', target: 'items', include: 'mentions' }
]
const originalCause = error => {
  const seen = new Set()
  while (error && typeof error === 'object' && Object.hasOwn(error, 'cause') && !seen.has(error)) {
    seen.add(error)
    error = error.cause
  }
  return error
}

describe(`Include projection failure boundaries (${storageMode.mode})`, () => {
  let fixture, records, probe
  const typed = new RestApiValidationError('Invalid projected value')
  const frozen = Object.freeze(new Error('Projection failed'))
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: {
        inverseMembership: true,
        includeProjection: true,
        projectionSelect: ({ knex, column, scopeName }) => {
          if (probe && scopeName === probe.target) {
            probe.calls++
            if (!probe.failAt || probe.calls === probe.failAt) {
              if (probe.async) return Promise.reject(probe.error)
              throw probe.error
            }
          }
          return knex.raw('upper(??)', [column('name')])
        }
      },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
  })
  beforeEach(async () => {
    probe = undefined
    await fixture.reset()
    const group = await fixture.seed('groups', { name: 'Group' })
    const item = await fixture.seed('items', { name: 'Item' }, {
      group: { data: { type: 'groups', id: group.id } },
      subject: { data: { type: 'groups', id: group.id } },
      groups: { data: [{ type: 'groups', id: group.id }] }
    })
    records = { items: item, groups: group }
  })
  after(async () => { await fixture?.close() })

  for (const method of ['get', 'query']) {
    for (const format of ['jsonapi', 'plain']) {
      it(`${method} ${format} rejects a nested projection failure after the primary projection succeeds`, async () => {
        probe = { target: 'groups', error: null, async: true, calls: 0, failAt: 2 }
        try {
          await assert.rejects(fixture.api.resources.groups[method]({
            id: records.groups.id,
            format,
            queryParams: { include: ['items.group'] }
          }), error => originalCause(error) === null)
          assert.equal(probe.calls, 2)
        } finally { probe = undefined }
      })
    }
  }

  for (const relationship of relationships) {
    for (const format of ['jsonapi', 'plain']) {
      const queryParams = { include: [relationship.include], fields: { [relationship.target]: 'id,name,displayName' } }
      for (const [label, error, async] of [['typed', typed, false], ['frozen', frozen, false], ['null', null, true], ['undefined', undefined, true], ['string', 'Projection failed', false]]) {
        it(`${relationship.name} GET ${format} retains ${label} projection failure`, async () => {
          probe = { target: relationship.target, error, async, calls: 0 }
          try {
            await assert.rejects(fixture.api.resources[relationship.source].get({ id: records[relationship.source].id, format, queryParams }), caught => {
              assert.equal(originalCause(caught), error)
              if (error === typed) assert.equal(caught, typed)
              return true
            })
            assert.equal(probe.calls, 1)
          } finally { probe = undefined }
          const response = await fixture.api.resources[relationship.source].get({ id: records[relationship.source].id, format: 'jsonapi', queryParams })
          assert.equal(response.included.find(record => record.type === relationship.target).attributes.displayName, relationship.target === 'groups' ? 'GROUP' : 'ITEM')
        })
      }

      it(`${relationship.name} full query include ${format} rejects a null projection failure`, async () => {
        probe = { target: relationship.target, error: null, async: true, calls: 0 }
        try {
          await assert.rejects(fixture.api.resources[relationship.source].query({ format, queryParams: { include: [relationship.include] } }), error => originalCause(error) === null)
          assert.equal(probe.calls, 1)
        } finally { probe = undefined }
      })

      for (const borrowed of [false, true]) {
        it(`${relationship.name} PATCH ${format} fails before ${borrowed ? 'borrowed' : 'owned'} commit on a ${borrowed ? 'sparse' : 'full'} included projection error`, async () => {
          const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
          const transaction = unit?.transaction
          const context = {}
          probe = { target: relationship.target, error: null, async: true, calls: 0 }
          try {
            await assert.rejects(fixture.api.resources[relationship.source].patch({
              id: records[relationship.source].id,
              [format === 'plain' ? 'data' : 'document']: format === 'plain' ? { name: 'Changed' } : { data: { type: relationship.source, id: records[relationship.source].id, attributes: { name: 'Changed' } } },
              format,
              returning: 'full',
              queryParams: borrowed ? queryParams : { include: [relationship.include] },
              transaction
            }, context), error => originalCause(error) === null)
            assert.equal(probe.calls, 1)
            assert.equal(context.transactionCommitted, false)
            assert.equal(context.transaction.isCompleted(), !borrowed)
            if (borrowed) {
              assert.equal(context.transaction, transaction)
              probe = undefined
              assert.equal((await fixture.api.resources[relationship.source].get({ id: records[relationship.source].id, format: 'plain', transaction })).name, 'Changed')
            }
          } finally {
            probe = undefined
            await unit?.rollback()
          }
          assert.equal((await fixture.api.resources[relationship.source].get({ id: records[relationship.source].id, format: 'plain' })).name, relationship.source === 'groups' ? 'Group' : 'Item')
        })
      }
    }
  }
})
