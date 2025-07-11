export const createDefaultDataHelpers = (api) => {
  return {
    dataExists: async function({ scopeName, id, idProperty, runHooks, transaction }) {      
      throw new Error(`No storage implementation for exists. Install a storage plugin.`);
    },

    dataGet: async function({ scopeName, id, queryParams, idProperty, runHooks, transaction }) {      
      throw new Error(`No storage implementation for get. Install a storage plugin.`);
    },
    
    dataQuery: async function({ scopeName, queryParams, idProperty, searchSchema, runHooks, context, transaction }) {      
      throw new Error(`No storage implementation for query. Install a storage plugin.`);
    },
    
    dataPost: async function({ scopeName, inputRecord, idProperty, runHooks, transaction }) {      
      throw new Error(`No storage implementation for post. Install a storage plugin.`);
    },

    dataPatch: async function({ scopeName, id, inputRecord, schema, queryParams, idProperty, runHooks, transaction }) {
      throw new Error(`No storage implementation for patch. Install a storage plugin.`);
    },
    dataPut: async function({ scopeName, id, schema, inputRecord, isCreate, idProperty, runHooks, transaction }) {      
      throw new Error(`No storage implementation for put. Install a storage plugin.`);
    },
    
  dataDelete: async function({ scopeName, id, idProperty, runHooks, transaction }) {
      throw new Error(`No storage implementation for delete. Install a storage plugin.`);
    }
  };
};