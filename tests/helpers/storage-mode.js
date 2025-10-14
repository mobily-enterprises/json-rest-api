const STORAGE_MODE = process.env.JSON_REST_API_STORAGE === 'anyapi' ? 'anyapi' : 'knex'
const DEFAULT_TENANT = 'default'

const tableMetadata = new Map()
let resetMetadataFn = null
const linkMappings = new Map()
let currentTenant = DEFAULT_TENANT

export const storageMode = {
  mode: STORAGE_MODE,
  isAnyApi () {
    return STORAGE_MODE === 'anyapi'
  },
  defaultTenant: DEFAULT_TENANT,
  get currentTenant () {
    return currentTenant
  },
  registerReset (fn) {
    resetMetadataFn = fn
  },
  setCurrentTenant (tenantId) {
    currentTenant = tenantId || DEFAULT_TENANT
  },
  registerTable (tableName, resourceName, tenantId = currentTenant || DEFAULT_TENANT) {
    if (!tableName || !resourceName) return
    tableMetadata.set(tableName, {
      resource: resourceName,
      tenantId: tenantId || DEFAULT_TENANT,
    })
  },
  registerLink (
    tableName,
    ownerResource,
    relationshipName,
    relationshipKey,
    inverseRelationshipKey,
    tenantId = currentTenant || DEFAULT_TENANT
  ) {
    if (!tableName || !ownerResource || !relationshipName) return
    linkMappings.set(tableName, {
      ownerResource,
      relationshipName,
      relationshipKey,
      inverseRelationshipKey,
      tenantId: tenantId || DEFAULT_TENANT,
    })
  },
  getResourceForTable (tableName) {
    return tableMetadata.get(tableName)?.resource
  },
  getTenantForTable (tableName) {
    return tableMetadata.get(tableName)?.tenantId || DEFAULT_TENANT
  },
  getLinkInfo (tableName) {
    return linkMappings.get(tableName)
  },
  clearRegistry () {
    tableMetadata.clear()
    linkMappings.clear()
    currentTenant = DEFAULT_TENANT
    if (resetMetadataFn) {
      resetMetadataFn()
    }
  },
}
