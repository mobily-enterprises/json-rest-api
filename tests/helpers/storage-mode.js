const STORAGE_MODE = process.env.JSON_REST_API_STORAGE || 'knex'
if (!['knex', 'anyapi'].includes(STORAGE_MODE)) {
  throw new Error(`Unknown JSON_REST_API_STORAGE '${STORAGE_MODE}'`)
}
const DEFAULT_TENANT = 'default'

const databases = new WeakMap()

function getRegistry (knex) {
  let registry = databases.get(knex)
  if (!registry) {
    registry = { tables: new Map(), links: new Map() }
    databases.set(knex, registry)
  }
  return registry
}
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
  setCurrentTenant (tenantId) {
    currentTenant = tenantId || DEFAULT_TENANT
  },
  registerTable (knex, tableName, resourceName, tenantId = DEFAULT_TENANT) {
    if (!tableName || !resourceName) return
    getRegistry(knex).tables.set(tableName, {
      resource: resourceName,
      tenantId: tenantId || DEFAULT_TENANT,
    })
  },
  registerLink (
    knex,
    tableName,
    ownerResource,
    relationshipName,
    relationshipKey,
    inverseRelationshipKey,
    tenantId = DEFAULT_TENANT
  ) {
    if (!tableName || !ownerResource || !relationshipName) return
    getRegistry(knex).links.set(tableName, {
      ownerResource,
      relationshipName,
      relationshipKey,
      inverseRelationshipKey,
      tenantId: tenantId || DEFAULT_TENANT,
    })
  },
  getResourceForTable (knex, tableName) {
    return databases.get(knex)?.tables.get(tableName)?.resource
  },
  getTenantForTable (knex, tableName) {
    return databases.get(knex)?.tables.get(tableName)?.tenantId || DEFAULT_TENANT
  },
  getLinkInfo (knex, tableName) {
    return databases.get(knex)?.links.get(tableName)
  },
  clearRegistry (knex) {
    databases.delete(knex)
  },
}
