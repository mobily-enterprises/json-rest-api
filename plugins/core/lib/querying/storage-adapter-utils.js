// @ts-check
/** @import { StorageAdapter, StorageHookParams } from '../storage/storage-types.js' */

/** @param {StorageHookParams} hookParams @param {{ getStorageAdapter?: (scopeName: string) => StorageAdapter | null | undefined }} [options] */
export const createStorageAdapterUtilities = (hookParams, { getStorageAdapter } = {}) => {
  const context = hookParams?.context || {}
  const activeQuery = context.knexQuery || {}
  const activeScopeName = activeQuery.scopeName
  const activeTableName = activeQuery.tableName
  const activeStorageAdapter = activeQuery.storageAdapter || context.storageAdapter
  /** @type {Map<string, StorageAdapter | null | undefined>} */
  const storageCache = new Map()

  /** @param {string} scopeName @returns {StorageAdapter | null | undefined} */
  const fetchStorageAdapter = (scopeName) => {
    if (!scopeName) return null
    if (storageCache.has(scopeName)) return storageCache.get(scopeName)

    let adapter = null
    if (scopeName === activeScopeName && activeStorageAdapter) {
      adapter = activeStorageAdapter
    } else if (typeof getStorageAdapter === 'function') {
      adapter = getStorageAdapter(scopeName)
    }

    storageCache.set(scopeName, adapter)
    return adapter
  }

  /** @param {string} scopeName @returns {string} */
  const defaultAliasForScope = (scopeName) => {
    if (scopeName === activeScopeName) {
      return activeTableName || scopeName
    }
    return scopeName
  }

  /** @param {string} scopeName @param {string} field @param {string | null} [alias] @returns {string} */
  const translateColumn = (scopeName, field, alias = defaultAliasForScope(scopeName)) => {
    const adapter = fetchStorageAdapter(scopeName)
    const translated = adapter?.translateColumn?.(field) ?? field
    if (!alias) return translated
    return `${alias}.${translated}`
  }

  /** @param {string} scopeName @param {string} field @param {unknown} value @returns {unknown} */
  const translateFilterValue = (scopeName, field, value) => {
    const adapter = fetchStorageAdapter(scopeName)
    if (!adapter?.translateFilterValue) return value
    return adapter.translateFilterValue(field, value)
  }

  return {
    fetchStorageAdapter,
    defaultAliasForScope,
    translateColumn,
    translateFilterValue,
  }
}
