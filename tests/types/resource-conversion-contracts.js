// @ts-check
import { toJsonApiRecord } from '../../plugins/core/lib/querying/knex-json-api-transformers-querying.js'
import { toJsonApiRecordWithBelongsTo } from '../../plugins/core/lib/querying-writing/knex-json-api-transformers.js'

/** @import { ResourceConversionScope, StorageRow } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageRow | null | undefined} row */
export function checkResourceConversionContracts (row) {
  /** @type {ResourceConversionScope} */
  const scope = {
    vars: {
      schemaInfo: {
        tableName: 'items',
        idProperty: 'key',
        schemaStructure: { id: { type: 'id', storage: { column: 'key' } }, ownerId: { type: 'id', belongsTo: 'users', as: 'owner' } },
        foreignKeyFields: new Set(['ownerId', 'subjectType', 'subjectId']),
        schemaRelationships: { subject: { belongsToPolymorphic: { typeField: 'subjectType', idField: 'subjectId', types: ['users'] } } }
      }
    }
  }
  toJsonApiRecord(scope, { key: 0 }, 'items').id.toUpperCase()
  const related = toJsonApiRecordWithBelongsTo(scope, row, 'items')
  if (related) related.id.toUpperCase()
  const optional = toJsonApiRecord(scope, row, 'items')
  if (optional) optional.type.toUpperCase()

  // @ts-expect-error Possibly absent rows produce nullable resources.
  toJsonApiRecord(scope, row, 'items').id.toUpperCase()
  // @ts-expect-error Belongs-to conversion also preserves row absence.
  toJsonApiRecordWithBelongsTo(scope, row, 'items').id.toUpperCase()
  // @ts-expect-error Compiled foreign-key membership is required before conversion.
  toJsonApiRecord({ vars: { schemaInfo: { tableName: 'items', schemaStructure: {} } } }, {}, 'items')
  // @ts-expect-error Read-side conversion must not mutate compiled membership.
  scope.vars.schemaInfo.foreignKeyFields.add('unexpected')
  // @ts-expect-error Relationship aliases are strings.
  scope.vars.schemaInfo.schemaStructure.ownerId = { type: 'id', belongsTo: 'users', as: 42 }
  // @ts-expect-error A resource type is a string, not an identifier value.
  toJsonApiRecordWithBelongsTo(scope, {}, 42)
  // @ts-expect-error Conversion accepts row objects, not scalar IDs.
  toJsonApiRecord(scope, 42, 'items')
}
