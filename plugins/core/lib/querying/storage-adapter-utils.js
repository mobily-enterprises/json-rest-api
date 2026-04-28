export const createStorageAdapterUtilities = (hookParams, { getStorageAdapter } = {}) => {
  const context = hookParams?.context || {}
  const storageCache = new Map()

  const fetchStorageAdapter = (scopeName) => {
    if (!scopeName) return null
    if (storageCache.has(scopeName)) return storageCache.get(scopeName)

    let adapter = null
    if (scopeName === context?.knexQuery?.scopeName) {
      adapter = context.storageAdapter ||
        context.knexQuery?.storageAdapter ||
        (typeof getStorageAdapter === 'function' ? getStorageAdapter(scopeName) : null)
      if (adapter && !context.storageAdapter) {
        context.storageAdapter = adapter
      }
    } else {
      adapter = typeof getStorageAdapter === 'function' ? getStorageAdapter(scopeName) : null
    }

    storageCache.set(scopeName, adapter)
    return adapter
  }

  const defaultAliasForScope = (scopeName) => {
    if (scopeName === context?.knexQuery?.scopeName) {
      return context.knexQuery?.tableName || scopeName
    }
    return scopeName
  }

  const translateColumn = (scopeName, field, alias = defaultAliasForScope(scopeName)) => {
    const adapter = fetchStorageAdapter(scopeName)
    const translated = adapter?.translateColumn?.(field) ?? field
    if (!alias) return translated
    return `${alias}.${translated}`
  }

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
