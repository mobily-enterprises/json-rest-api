// @ts-check
import { applyFieldSelectionToQuery, buildFieldSelection, getRequestedComputedFields, validateRequestedFieldsets } from '../../plugins/core/lib/querying-writing/knex-field-helpers.js'
/** @import { SelectionScope } from '../../plugins/core/lib/querying-writing/field-selection-types.js' */
/** @import { StorageQuery } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageQuery} query */
export async function checkFieldSelectionContracts (query) {
  /** @type {SelectionScope} */
  const scope = { vars: { schemaInfo: { schemaStructure: { name: { type: 'string' } }, readDependencies: { display: ['name'] } } } }
  const selection = await buildFieldSelection(scope, { context: { scopeName: 'items', queryParams: { fields: { items: Object.freeze(['name']) } } } })
  selection.fieldsToSelect.push('name')
  const selected = await applyFieldSelectionToQuery({ query, scope, fieldSelectionInfo: selection, tableName: 'items' })
  selected.query.where('id', '1')
  await validateRequestedFieldsets({ scopeName: 'items' }, { items: scope })
  getRequestedComputedFields('items', Object.freeze(['display']), { display: { normallyHidden: true } })
  // @ts-expect-error Selection can preserve the caller's readonly fieldset.
  selection.requestedFields?.push('extra')
  // @ts-expect-error Selection requires a resource name.
  buildFieldSelection(scope, { context: {} })
  // @ts-expect-error SQL application needs a builder rather than an executed row array.
  applyFieldSelectionToQuery({ query: [], tableName: 'items' })
  // @ts-expect-error The wrapper is deliberately not thenable; its query remains inside.
  selected.then(() => {})
  // @ts-expect-error Compiled dependencies are logical field names.
  buildFieldSelection({ vars: { schemaInfo: { readDependencies: { display: [1] } } } }, { context: { scopeName: 'items' } })
  // @ts-expect-error Requested computed names cannot be numeric IDs.
  getRequestedComputedFields('items', [1], {})
}
