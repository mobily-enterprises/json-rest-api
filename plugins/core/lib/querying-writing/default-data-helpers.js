/**
 * Default data helper implementations that instruct users to install a storage plugin
 * 
 * @description
 * These default implementations ensure the REST API plugin fails gracefully
 * when no storage plugin is installed. Each method throws a descriptive error
 * guiding users to install a storage implementation.
 * 
 * @example
 * // When no storage plugin is installed:
 * try {
 *   await api.resources.articles.get({ id: 1 });
 * } catch (error) {
 *   console.log(error.message);
 *   // "No storage implementation for get. Install a storage plugin."
 * }
 * 
 * @example
 * // After installing rest-api-knex-plugin:
 * api.use(RestApiKnexPlugin, { knex });
 * // Now data helpers are replaced with actual implementations
 * const article = await api.resources.articles.get({ id: 1 });
 * // Works! Returns article from database
 * 
 * Used by:
 * - rest-api-plugin sets these as initial data helpers
 * - Storage plugins replace these with actual implementations
 * 
 * Purpose:
 * - Provides clear error messages when storage is missing
 * - Ensures REST API plugin can be installed independently
 * - Allows storage plugins to be swapped without changing API
 * 
 * Data flow:
 * 1. REST API plugin initializes with these defaults
 * 2. User tries to use API without storage plugin
 * 3. Clear error message guides them to install storage
 * 4. Storage plugin replaces these with real implementations
 */
export const defaultDataHelpers = {
  dataExists: async function(scope, deps) {
    throw new Error(`No storage implementation for exists. Install a storage plugin.`);
  },

  dataGet: async function(scope, deps) {
    throw new Error(`No storage implementation for get. Install a storage plugin.`);
  },

  dataGetMinimal: async function(scope, deps) {
    throw new Error(`No storage implementation for getMinimal. Install a storage plugin.`);
  },
  
  dataQuery: async function(scope, deps) {
    throw new Error(`No storage implementation for query. Install a storage plugin.`);
  },
  
  dataPost: async function(scope, deps) {
    throw new Error(`No storage implementation for post. Install a storage plugin.`);
  },

  dataPatch: async function(scope, deps) {
    throw new Error(`No storage implementation for patch. Install a storage plugin.`);
  },
  
  dataPut: async function(scope, deps) {
    throw new Error(`No storage implementation for put. Install a storage plugin.`);
  },
  
  dataDelete: async function(scope, deps) {
    throw new Error(`No storage implementation for delete. Install a storage plugin.`);
  }
};