/**
 * @module defaultDataHelpers
 * @description Default data helper implementations that throw errors
 * 
 * This module provides default implementations of data helpers that throw
 * errors instructing users to install a storage plugin. These are used
 * when no storage plugin has been installed.
 */

export const createDefaultDataHelpers = (api) => {
  return {
    /**
     * Default implementation of dataExists that throws an error
     * @param {Object} scope - The scope object
     * @param {Object} deps - Dependencies object
     * @param {Object} deps.context - Request context with id, transaction, etc
     * @throws {Error} Always throws error about missing storage plugin
     */
    dataExists: async function(scope, deps) {
      throw new Error(`No storage implementation for exists. Install a storage plugin.`);
    },

    /**
     * Default implementation of dataGet that throws an error
     * @param {Object} scope - The scope object
     * @param {Object} deps - Dependencies object
     * @param {Object} deps.context - Request context with id, queryParams, transaction, etc
     * @throws {Error} Always throws error about missing storage plugin
     */
    dataGet: async function(scope, deps) {
      throw new Error(`No storage implementation for get. Install a storage plugin.`);
    },
    
    /**
     * Default implementation of dataQuery that throws an error
     * @param {Object} scope - The scope object
     * @param {Object} deps - Dependencies object
     * @param {Object} deps.context - Request context with queryParams, transaction, etc
     * @param {Function} deps.runHooks - Hook runner function
     * @throws {Error} Always throws error about missing storage plugin
     */
    dataQuery: async function(scope, deps) {
      throw new Error(`No storage implementation for query. Install a storage plugin.`);
    },
    
    /**
     * Default implementation of dataPost that throws an error
     * @param {Object} scope - The scope object
     * @param {Object} deps - Dependencies object
     * @param {Object} deps.context - Request context with inputRecord, transaction, etc
     * @throws {Error} Always throws error about missing storage plugin
     */
    dataPost: async function(scope, deps) {
      throw new Error(`No storage implementation for post. Install a storage plugin.`);
    },

    /**
     * Default implementation of dataPatch that throws an error
     * @param {Object} scope - The scope object
     * @param {Object} deps - Dependencies object
     * @param {Object} deps.context - Request context with id, inputRecord, queryParams, transaction, etc
     * @throws {Error} Always throws error about missing storage plugin
     */
    dataPatch: async function(scope, deps) {
      throw new Error(`No storage implementation for patch. Install a storage plugin.`);
    },
    /**
     * Default implementation of dataPut that throws an error
     * @param {Object} scope - The scope object
     * @param {Object} deps - Dependencies object
     * @param {Object} deps.context - Request context with id, inputRecord, isCreate, transaction, etc
     * @throws {Error} Always throws error about missing storage plugin
     */
    dataPut: async function(scope, deps) {
      throw new Error(`No storage implementation for put. Install a storage plugin.`);
    },
    
    /**
     * Default implementation of dataDelete that throws an error
     * @param {Object} scope - The scope object
     * @param {Object} deps - Dependencies object
     * @param {Object} deps.context - Request context with id, transaction, etc
     * @throws {Error} Always throws error about missing storage plugin
     */
    dataDelete: async function(scope, deps) {
      throw new Error(`No storage implementation for delete. Install a storage plugin.`);
    }
  };
};