
export const RestApiKnexPlugin = {
  name: 'rest-api-knex',
  dependencies: ['rest-api'],

  async install({ helpers, vars, pluginOptions, api, log, scopes }) {
    
    // Get Knex configuration from plugin options
    const knexOptions = pluginOptions.knex || pluginOptions['rest-api-knex'];
    if (!knexOptions || !knexOptions.knex) {
      throw new Error('RestApiKnexPlugin requires a knex instance in pluginOptions');
    }
    
    const knex = knexOptions.knex;
    
    // Helper to get table name for a scope
    const getTableName = (scopeName) => {
      const scopeOptions = scopes[scopeName]?.options || {};
      return scopeOptions.tableName || scopeName;
    };
    
    // Helper to convert DB record to JSON:API format
    const toJsonApi = (scopeName, record) => {
      if (!record) return null;
      
      const idProperty = vars.idProperty || 'id';
      const { [idProperty]: id, ...attributes } = record;
      
      return {
        type: scopeName,
        id: String(id),
        attributes
      };
    };

    // GET - retrieve a single record by ID
    helpers.dataGet = async ({ scopeName, id }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] GET ${tableName}/${id}`);
      
      const record = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      if (!record) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      return {
        data: toJsonApi(scopeName, record)
      };
    };
    
    // QUERY - retrieve multiple records
    helpers.dataQuery = async ({ scopeName, queryParams = {} }) => {
      const tableName = getTableName(scopeName);
      
      log.debug(`[Knex] QUERY ${tableName}`, queryParams);
      
      // Very basic implementation - just get all records
      // Ignoring include, fields, filter, sort, page for now
      const records = await knex(tableName).select('*');
      
      return {
        data: records.map(record => toJsonApi(scopeName, record))
      };
    };
    
    // POST - create a new record
    helpers.dataPost = async ({ scopeName, inputRecord }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] POST ${tableName}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Insert and get the new ID
      const [id] = await knex(tableName).insert(attributes).returning(idProperty);
      
      // Fetch the created record
      const newRecord = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: toJsonApi(scopeName, newRecord)
      };
    };
    
    // PUT - replace an entire record
    helpers.dataPut = async ({ scopeName, id, inputRecord }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] PUT ${tableName}/${id}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Check if record exists
      const exists = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Update the record (replace all fields)
      await knex(tableName)
        .where(idProperty, id)
        .update(attributes);
      
      // Fetch the updated record
      const updatedRecord = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: toJsonApi(scopeName, updatedRecord)
      };
    };
    
    // PATCH - partially update a record
    helpers.dataPatch = async ({ scopeName, id, inputRecord }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] PATCH ${tableName}/${id}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Check if record exists
      const exists = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Update only provided fields
      await knex(tableName)
        .where(idProperty, id)
        .update(attributes);
      
      // Fetch the updated record
      const updatedRecord = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: toJsonApi(scopeName, updatedRecord)
      };
    };
    
    // DELETE - remove a record
    helpers.dataDelete = async ({ scopeName, id }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] DELETE ${tableName}/${id}`);
      
      // Check if record exists
      const exists = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Delete the record
      await knex(tableName)
        .where(idProperty, id)
        .delete();
      
      return { success: true };
    };
    
    log.info('RestApiKnexPlugin installed - basic CRUD operations ready');
  }
}