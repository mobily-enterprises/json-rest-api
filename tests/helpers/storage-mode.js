const STORAGE_MODE = process.env.JSON_REST_API_STORAGE === 'anyapi' ? 'anyapi' : 'knex';
const DEFAULT_TENANT = 'default';

const tableToResource = new Map();

export const storageMode = {
  mode: STORAGE_MODE,
  isAnyApi() {
    return STORAGE_MODE === 'anyapi';
  },
  defaultTenant: DEFAULT_TENANT,
  registerTable(tableName, resourceName) {
    if (!tableName || !resourceName) return;
    tableToResource.set(tableName, resourceName);
  },
  getResourceForTable(tableName) {
    return tableToResource.get(tableName);
  },
  clearRegistry() {
    tableToResource.clear();
  },
};
