const STORAGE_MODE = process.env.JSON_REST_API_STORAGE === 'anyapi' ? 'anyapi' : 'knex';
const DEFAULT_TENANT = 'default';

const tableToResource = new Map();
let resetMetadataFn = null;
const linkMappings = new Map();

export const storageMode = {
  mode: STORAGE_MODE,
  isAnyApi() {
    return STORAGE_MODE === 'anyapi';
  },
  defaultTenant: DEFAULT_TENANT,
  registerReset(fn) {
    resetMetadataFn = fn;
  },
  registerTable(tableName, resourceName) {
    if (!tableName || !resourceName) return;
    tableToResource.set(tableName, resourceName);
  },
  registerLink(tableName, ownerResource, relationshipName, relationshipKey, inverseRelationshipKey) {
    if (!tableName || !ownerResource || !relationshipName) return;
    linkMappings.set(tableName, {
      ownerResource,
      relationshipName,
      relationshipKey,
      inverseRelationshipKey,
    });
  },
  getResourceForTable(tableName) {
    return tableToResource.get(tableName);
  },
  getLinkInfo(tableName) {
    return linkMappings.get(tableName);
  },
  clearRegistry() {
    tableToResource.clear();
    linkMappings.clear();
    if (resetMetadataFn) {
      resetMetadataFn();
    }
  },
};
