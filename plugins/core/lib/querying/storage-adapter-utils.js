export const createStorageAdapterUtilities = (hookParams, { getStorageAdapter } = {}) => {
  const context = hookParams?.context || {}
  const activeQuery = context.knexQuery || {}
  const activeScopeName = activeQuery.scopeName
  const activeTableName = activeQuery.tableName
  const activeStorageAdapter = activeQuery.storageAdapter || context.storageAdapter
  const storageCache = new Map()

  const fetchStorageAdapter = (scopeName) => {
    if (!scopeName) return null
    if (storageCache.has(scopeName)) return storageCache.get(scopeName)

    let adapter = null
    if (scopeName === activeScopeName) {
      adapter = activeStorageAdapter ||
        (typeof getStorageAdapter === 'function' ? getStorageAdapter(scopeName) : null)
    } else {
      adapter = typeof getStorageAdapter === 'function' ? getStorageAdapter(scopeName) : null
    }

    storageCache.set(scopeName, adapter)
    return adapter
  }

  const defaultAliasForScope = (scopeName) => {
    if (scopeName === activeScopeName) {
      return activeTableName || scopeName
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
