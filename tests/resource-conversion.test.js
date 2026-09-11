import { it } from 'node:test'
import assert from 'node:assert/strict'
import { toJsonApiRecordWithBelongsTo } from '../plugins/core/lib/querying-writing/knex-json-api-transformers.js'

const scope = {
  vars: {
    schemaInfo: {
      tableName: 'items',
      idProperty: 'item_key',
      schemaStructure: {
        id: { type: 'id', storage: { column: 'item_key' } },
        name: { type: 'string', storage: { column: 'display_name' } },
        ownerId: { type: 'id', belongsTo: 'users', as: 'owner', storage: { column: 'owner_key' } },
        subjectType: { type: 'string', storage: { column: 'subject_kind' } },
        subjectId: { type: 'id', storage: { column: 'subject_key' } }
      },
      foreignKeyFields: new Set(['ownerId', 'subjectType', 'subjectId']),
      schemaRelationships: { subject: { belongsToPolymorphic: { typeField: 'subjectType', idField: 'subjectId', types: ['users'] } } }
    }
  }
}

it('converts mapped storage keys into string identity and linkage without changing the row', () => {
  const row = { item_key: 0, display_name: 'Mapped', owner_key: 42, subject_kind: 'users', subject_key: 9007199254740993n }
  const before = structuredClone(row)
  assert.deepEqual(toJsonApiRecordWithBelongsTo(scope, row, 'items'), {
    type: 'items',
    id: '0',
    attributes: { name: 'Mapped' },
    relationships: { owner: { data: { type: 'users', id: '42' } }, subject: { data: { type: 'users', id: '9007199254740993' } } }
  })
  assert.deepEqual(row, before)
})

it('retains absent rows and explicit null linkage', () => {
  for (const row of [null, undefined]) assert.equal(toJsonApiRecordWithBelongsTo(scope, row, 'items'), null)
  const result = toJsonApiRecordWithBelongsTo(scope, { item_key: 1, display_name: 'Empty', owner_key: null, subject_kind: null, subject_key: null }, 'items')
  assert.deepEqual(result.relationships, { owner: { data: null }, subject: { data: null } })
  assert.deepEqual(result.attributes, { name: 'Empty' })
})
