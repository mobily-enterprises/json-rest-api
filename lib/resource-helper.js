import { Api, MySQLPlugin, ValidationPlugin, HTTPPlugin } from './index.js';

// Cache for API instances by version
const apiCache = new Map();

/**
 * Get or create a shared API instance for a version
 */
export function getVersionApi(version, config = {}) {
  const cacheKey = `${config.name || 'app'}-${version}`;
  
  if (apiCache.has(cacheKey)) {
    return apiCache.get(cacheKey);
  }
  
  // Create new API instance for this version
  const api = new Api({
    name: config.name || 'app',
    version,
    ...config.apiOptions
  });
  
  // Add default plugins if not already added
  if (!api.hasPlugin(ValidationPlugin)) {
    api.use(ValidationPlugin);
  }
  
  if (config.mysql && !api.hasPlugin(MySQLPlugin)) {
    api.use(MySQLPlugin, config.mysql);
  }
  
  if (config.http && !api.hasPlugin(HTTPPlugin)) {
    api.use(HTTPPlugin, {
      basePath: `/api/${version}`,
      ...config.http
    });
  }
  
  // Add any additional plugins
  if (config.plugins) {
    for (const [plugin, options] of config.plugins) {
      if (!api.hasPlugin(plugin)) {
        api.use(plugin, options);
      }
    }
  }
  
  apiCache.set(cacheKey, api);
  return api;
}

/**
 * Define a resource with automatic API management
 */
export function defineResource(version, name, definition) {
  const api = getVersionApi(version, definition.api || {});
  
  // Add the resource
  api.addResource(name, definition.schema, definition.hooks);
  
  // Configure storage options if needed
  if (definition.storage) {
    // Store metadata for storage plugins to use
    api.resourceOptions = api.resourceOptions || new Map();
    api.resourceOptions.set(name, definition.storage);
  }
  
  // Sync schema in development
  if (process.env.NODE_ENV === 'development' && definition.syncSchema !== false) {
    const storage = definition.storage || {};
    api.syncSchema(definition.schema, storage.table || name, {
      connection: storage.connection || 'main'
    }).catch(err => {
      console.error(`Failed to sync schema for ${name}:`, err);
    });
  }
  
  return api;
}