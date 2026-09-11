// @ts-check
/** @import { DataWriteHelpers, DataReadHelpers } from '../storage/storage-types.js' */
/**
 * Missing-storage placeholders installed by RestApiPlugin.
 * Storage plugins replace these helpers. They are not a complete custom-backend
 * interface: resource operations also require transaction and query integration.
 * Earlier lifecycle validation may reject a call before one of these runs.
 * @satisfies {DataWriteHelpers<never, never> & DataReadHelpers<never>}
 */
export const defaultDataHelpers = {
  dataExists: async function (request) {
    throw new Error('No storage implementation for exists. Install a storage plugin.')
  },

  dataGet: async function (request) {
    throw new Error('No storage implementation for get. Install a storage plugin.')
  },

  dataGetMinimal: async function (request) {
    throw new Error('No storage implementation for getMinimal. Install a storage plugin.')
  },

  dataQuery: async function (request) {
    throw new Error('No storage implementation for query. Install a storage plugin.')
  },

  dataPost: async function (request) {
    throw new Error('No storage implementation for post. Install a storage plugin.')
  },

  dataPatch: async function (request) {
    throw new Error('No storage implementation for patch. Install a storage plugin.')
  },

  dataPut: async function (request) {
    throw new Error('No storage implementation for put. Install a storage plugin.')
  },

  dataDelete: async function (request) {
    throw new Error('No storage implementation for delete. Install a storage plugin.')
  }
}
