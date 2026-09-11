// @ts-check
import { defaultDataHelpers } from '../../plugins/core/lib/querying-writing/default-data-helpers.js'
/** @import { OrdinaryDataReadHelpers, CanonicalDataReadHelpers, OrdinaryDataWriteHelpers, CanonicalDataWriteHelpers, DataIdentityContext } from '../../plugins/core/lib/storage/storage-types.js' */

/** @type {OrdinaryDataReadHelpers} */
export const ordinaryReads = defaultDataHelpers
/** @type {CanonicalDataReadHelpers} */
export const canonicalReads = defaultDataHelpers
/** @type {OrdinaryDataWriteHelpers} */
export const ordinaryWrites = defaultDataHelpers
/** @type {CanonicalDataWriteHelpers} */
export const canonicalWrites = defaultDataHelpers

/** @param {DataIdentityContext} context */
export function checkMissingStorage (context) {
  defaultDataHelpers.dataExists({ scopeName: 'items', context })
  // @ts-expect-error Storage helpers receive one request envelope.
  defaultDataHelpers.dataExists('items', { context })
  // @ts-expect-error Resource identity is required at the helper boundary.
  defaultDataHelpers.dataDelete({ context })
  // @ts-expect-error Write helpers require prepared input, not just an ID context.
  defaultDataHelpers.dataPost({ scopeName: 'items', context })
  defaultDataHelpers.dataExists({ scopeName: 'items', context }).then(result => {
    // @ts-expect-error Missing-storage placeholders never resolve a usable result.
    result.valueOf()
  })
}
