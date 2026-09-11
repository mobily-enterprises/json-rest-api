import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { processIncludes } from '../plugins/core/lib/querying/knex-process-includes.js'
import { loadRelationshipIdentifiers } from '../plugins/core/lib/querying/relationship-identifiers.js'
import { toJsonApiRecord } from '../plugins/core/lib/querying/knex-json-api-transformers-querying.js'
import { buildFieldSelection } from '../plugins/core/lib/querying-writing/knex-field-helpers.js'

const resource = (tableName, structure = {}, schemaRelationships = {}) => ({
  vars: { schemaInfo: { tableName, idProperty: 'id', schemaStructure: { id: { type: 'integer' }, ...structure }, schemaRelationships } }
})

describe('Relationship metadata error boundaries', () => {
  for (const boundary of ['selection', 'conversion']) {
    for (const original of [new RestApiValidationError('Metadata rejected'), Object.freeze(new Error('Metadata failed')), null]) {
      it(`${boundary} retains ${original?.name || 'null'} metadata failures`, async () => {
        const relationships = {}
        Object.defineProperty(relationships, 'subject', { enumerable: true, get () { throw original } })
        const scope = resource('items', {}, relationships)
        if (boundary === 'conversion') {
          Object.defineProperty(scope.vars.schemaInfo, 'foreignKeyFields', { get () { throw original } })
        }
        await assert.rejects(async () => {
          if (boundary === 'selection') return buildFieldSelection(scope, { context: { scopeName: 'items', queryParams: {} } })
          return toJsonApiRecord(scope, { id: 1 }, 'items')
        }, error => {
          assert.equal(originalCause(error), original)
          if (original instanceof RestApiValidationError) assert.equal(error, original)
          else assert.deepEqual(error.context, { scopeName: 'items', phase: 'relationshipMetadata' })
          return true
        })
      })
    }
  }

  for (const boundary of ['includes', 'identifiers']) {
    for (const empty of [false, true]) {
      it(`${boundary} ${empty ? 'accepts empty work' : 'rejects missing required schema'}`, async () => {
        const records = empty ? [] : [{ id: 1 }]
        const log = { trace () {}, debug () {}, warn () {} }
        const read = () => boundary === 'includes'
          ? processIncludes({}, records, { scopes: {}, log, context: { scopeName: 'items', queryParams: { include: ['subject'] } } })
          : loadRelationshipIdentifiers(records, 'items', {})
        if (empty) await read()
        else {
          await assert.rejects(read(), error => {
            assert.match(error.message, /Missing relationship schema for scope 'items'/)
            if (boundary === 'includes') assert.equal(error.context.phase, 'include')
            return true
          })
        }
      })
    }
  }
})
const originalCause = error => {
  while (error && typeof error === 'object' && Object.hasOwn(error, 'cause')) error = error.cause
  return error
}

describe('Include failures and secondary logging', () => {
  const scopes = {
    items: resource('items', { groupId: { type: 'integer', belongsTo: 'groups', as: 'group' } }, {
      subject: { belongsToPolymorphic: { types: ['groups'], typeField: 'subjectType', idField: 'subjectId' } }
    }),
    groups: resource('groups', {}, {
      items: { type: 'hasMany', target: 'items', foreignKey: 'groupId' },
      firstItem: { type: 'hasOne', target: 'items', foreignKey: 'groupId' },
      members: { type: 'manyToMany', target: 'items', through: 'memberships', foreignKey: 'groupId', otherKey: 'itemId' },
      mentions: { type: 'hasMany', target: 'items', via: 'subject' }
    }),
    memberships: resource('memberships')
  }
  const primaryValues = [new RestApiValidationError('Database boundary failed'), Object.freeze(new Error('Database boundary failed')), null]
  for (const [scopeName, include] of [['items', 'group'], ['groups', 'items'], ['groups', 'firstItem'], ['groups', 'members'], ['items', 'subject'], ['groups', 'mentions']]) {
    for (const primary of primaryValues) {
      for (const logging of ['success', 'throw', 'reject']) {
        it(`${scopeName}.${include} retains ${primary?.name || 'null'} with ${logging} logging`, async () => {
          let queryAttempts = 0
          const secondary = new Error('Error logger failed')
          const log = {
            trace () {},
            debug () {},
            warn () {},
            child () { return this },
            error () {
              if (logging === 'throw') throw secondary
              if (logging === 'reject') return Promise.reject(secondary)
            }
          }
          const knex = () => { queryAttempts++; throw primary }
          const context = { scopeName, queryParams: { include: [include] } }
          await assert.rejects(processIncludes(scopes[scopeName], [{ id: 1, groupId: 2, subjectType: 'groups', subjectId: 2 }], { scopes, log, knex, context }), error => {
            if (!(primary instanceof RestApiValidationError)) assert.equal(error.context.phase, 'include')
            for (let current = error; current && current !== primary; current = current.cause) {
              if (current.context) assert.equal(current.context.phase, 'include')
            }
            assert.equal(originalCause(error), primary)
            if (primary instanceof RestApiValidationError) assert.equal(error, primary)
            return true
          })
          assert.equal(queryAttempts, 1)
        })
      }
    }
  }
})
