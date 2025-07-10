/**
 * Knex Helper Functions for REST API SQL Operations
 * 
 * This module contains helper functions used by the REST API Knex plugin
 * for SQL database operations, JSON:API transformations, and query building.
 */

/**
 * Gets the table name for a given scope, using custom tableName if specified
 * @param {string} scopeName - The name of the scope/resource
 * @param {Object} scopes - The scopes object from the API
 * @returns {Promise<string>} The table name to use for database queries
 * 
 * @example
 * const tableName = await getTableName('articles', scopes); // Returns 'articles' or custom table name
 */
export const getTableName = async (scopeName, scopes) => {
  const schema = (await scopes[scopeName].getSchemaInfo()).schema;
  return schema?.tableName || scopeName;
};

/**
 * Extracts all foreign key fields from a schema definition
 * @param {Object} schema - The schema definition (can be Schema object or plain object)
 * @returns {Set<string>} Set of foreign key field names
 * 
 * @example
 * const foreignKeys = getForeignKeyFields(schema);
 * // Returns Set(['author_id', 'category_id']) for schema with belongsTo relationships
 */
export const getForeignKeyFields = (schema) => {
  const foreignKeys = new Set();
  if (!schema) return foreignKeys;
  
  // Handle both Schema objects and plain objects
  const schemaStructure = schema.structure || schema;
  
  Object.entries(schemaStructure).forEach(([field, def]) => {
    if (def.belongsTo) {
      foreignKeys.add(field);
    }
  });
  return foreignKeys;
};

/**
 * Builds the field selection list for database queries, handling sparse fieldsets
 * @param {string} scopeName - The name of the scope/resource
 * @param {string|null} requestedFields - Comma-separated list of requested fields or null for all
 * @param {Object} schema - The schema definition
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars containing configuration
 * @returns {Promise<Array<string>|string>} Array of field names to select or '*' for all
 * 
 * @example
 * const fields = await buildFieldSelection('articles', 'title,body', schema, scopes, vars);
 * // Returns ['id', 'title', 'body', 'author_id'] (includes foreign keys)
 */
export const buildFieldSelection = async (scopeName, requestedFields, schema, scopes, vars) => {
  const dbFields = new Set(['id']); // Always need id
  
  // Handle both Schema objects and plain objects
  const schemaStructure = schema?.structure || schema || {};
  
  // Always include ALL foreign keys (for relationships)
  Object.entries(schemaStructure).forEach(([field, def]) => {
    if (def.belongsTo) {
      dbFields.add(field); // e.g., author_id
    }
  });
  
  // Always include polymorphic type and id fields from relationships
  if (scopes[scopeName]) {
    try {
      const relationships = (await scopes[scopeName].getSchemaInfo()).relationships;
      Object.entries(relationships || {}).forEach(([relName, relDef]) => {
        if (relDef.belongsToPolymorphic) {
          if (relDef.typeField) dbFields.add(relDef.typeField);
          if (relDef.idField) dbFields.add(relDef.idField);
        }
      });
    } catch (e) {
      // Scope might not have relationships
    }
  }
  
  // No specific fields requested = return all fields
  if (!requestedFields) {
    return '*';
  }
  
  // Parse requested fields
  const requested = requestedFields.split(',').map(f => f.trim()).filter(f => f);
  
  // Add each valid requested field
  for (const field of requested) {
    if (schemaStructure[field]) {
      dbFields.add(field);
    }
  }
  
  return Array.from(dbFields);
};

/**
 * Converts a database record to JSON:API format
 * @param {string} scopeName - The name of the scope/resource
 * @param {Object} record - The database record
 * @param {Object} schema - The schema definition
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars containing configuration
 * @returns {Promise<Object>} JSON:API formatted resource object
 * 
 * @example
 * const jsonApiRecord = await toJsonApi('articles', dbRecord, schema, scopes, vars);
 * // Converts { id: 1, title: 'Hello', author_id: 2 } to JSON:API format
 */
export const toJsonApi = async (scopeName, record, schema, scopes, vars) => {
  if (!record) return null;
  
  const idProperty = vars.idProperty || 'id';
  const { [idProperty]: id, ...allAttributes } = record;
  
  // Handle both Schema objects and plain objects
  const schemaStructure = schema?.structure || schema || {};
  
  // Filter out foreign keys from attributes
  const foreignKeys = getForeignKeyFields(schema);
  const attributes = {};
  
  // Also filter out polymorphic type and id fields
  const polymorphicFields = new Set();
  try {
    const relationships = (await scopes[scopeName].getSchemaInfo()).relationships;
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        if (relDef.typeField) polymorphicFields.add(relDef.typeField);
        if (relDef.idField) polymorphicFields.add(relDef.idField);
      }
    });
  } catch (e) {
    // Scope might not have relationships
  }
  
  // Only include non-foreign-key attributes
  Object.entries(allAttributes).forEach(([key, value]) => {
    if (!foreignKeys.has(key) && !polymorphicFields.has(key)) {
      attributes[key] = value;
    }
  });
  
  return {
    type: scopeName,
    id: String(id),
    attributes
  };
};

/**
 * Builds the SELECT clause for a Knex query
 * @param {Object} query - The Knex query builder instance
 * @param {string} tableName - The table name
 * @param {Array<string>|string} fieldsToSelect - Fields to select or '*'
 * @param {boolean} useTablePrefix - Whether to prefix fields with table name
 * @returns {Object} The modified query builder
 */
export const buildQuerySelection = (query, tableName, fieldsToSelect, useTablePrefix = false) => {
  if (fieldsToSelect === '*') {
    return useTablePrefix ? query.select(`${tableName}.*`) : query;
  } else {
    const fields = useTablePrefix 
      ? fieldsToSelect.map(field => `${tableName}.${field}`)
      : fieldsToSelect;
    return query.select(fields);
  }
};

/**
 * Processes the ?include= parameter to load related resources
 * @param {Array<Object>} records - The primary records to load includes for
 * @param {string} scopeName - The scope name of the primary records
 * @param {Object} queryParams - Query parameters containing include and fields
 * @param {Object} transaction - Optional database transaction
 * @param {Object} dependencies - Helper function dependencies
 * @returns {Promise<Array<Object>>} Array of included resources in JSON:API format
 * 
 * @example
 * const included = await processIncludes(articles, 'articles', { include: ['author', 'comments.user'] }, null, dependencies);
 * // Returns array of author and comment user resources
 */
export const processIncludes = async (records, scopeName, queryParams, transaction, dependencies) => {
  const { log, relationshipIncludeHelpers, createRelationshipIncludeHelpers } = dependencies;
  
  if (!queryParams.include) {
    return [];
  }
  
  log.debug('[PROCESS-INCLUDES] Processing includes:', queryParams.include);
  
  // If we have a transaction, we need to create a modified version of the helpers
  // that uses the transaction instead of the base knex instance
  let helpers = relationshipIncludeHelpers;
  if (transaction) {
    // Create a new instance of the helpers with the transaction
    helpers = createRelationshipIncludeHelpers(dependencies.scopes, log, transaction, {
      getForeignKeyFields,
      buildFieldSelection,
      polymorphicHelpers: dependencies.polymorphicHelpers
    });
  }
  
  const includeResult = await helpers.buildIncludedResources(
    records,
    scopeName,
    queryParams.include,
    queryParams.fields || {}
  );
  
  log.debug('[PROCESS-INCLUDES] Include result:', {
    includedCount: includeResult.included.length,
    types: [...new Set(includeResult.included.map(r => r.type))]
  });
  
  return includeResult.included;
};

/**
 * Builds the final JSON:API response with data and optional included resources
 * @param {Array<Object>} records - The primary records
 * @param {string} scopeName - The scope name
 * @param {Object} schema - The schema definition
 * @param {Array<Object>} included - Optional included resources
 * @param {boolean} isSingle - Whether this is a single resource response
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars
 * @returns {Promise<Object>} Complete JSON:API response object
 * 
 * @example
 * const response = await buildJsonApiResponse([article], 'articles', schema, [author], true, scopes, vars);
 * // Returns { data: { type: 'articles', id: '1', ... }, included: [...] }
 */
export const buildJsonApiResponse = async (records, scopeName, schema, included = [], isSingle = false, scopes, vars) => {
  // Get relationships configuration
  const relationships = (await scopes[scopeName].getSchemaInfo()).relationships;
  
  // Handle both Schema objects and plain objects
  const schemaStructure = schema?.structure || schema || {};
  
  // Process records to JSON:API format
  const processedRecords = await Promise.all(records.map(async record => {
    const { _relationships, ...cleanRecord } = record;
    const jsonApiRecord = await toJsonApi(scopeName, cleanRecord, schema, scopes, vars);
    
    // Add any loaded relationships
    if (_relationships) {
      jsonApiRecord.relationships = _relationships;
    }
    
    // Add regular belongsTo relationships (only if not already loaded)
    for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
      if (fieldDef.belongsTo && fieldDef.as && cleanRecord[fieldName]) {
        jsonApiRecord.relationships = jsonApiRecord.relationships || {};
        if (!jsonApiRecord.relationships[fieldDef.as]) {
          jsonApiRecord.relationships[fieldDef.as] = {
            data: {
              type: fieldDef.belongsTo,
              id: String(cleanRecord[fieldName])
            }
          };
        }
      }
    }
    
    // Add polymorphic relationships
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        const typeValue = cleanRecord[relDef.typeField];
        const idValue = cleanRecord[relDef.idField];
        
        if (typeValue && idValue) {
          jsonApiRecord.relationships = jsonApiRecord.relationships || {};
          jsonApiRecord.relationships[relName] = {
            data: {
              type: typeValue,
              id: String(idValue)
            }
          };
        } else if (typeValue === null || idValue === null) {
          // Explicitly null relationship
          jsonApiRecord.relationships = jsonApiRecord.relationships || {};
          jsonApiRecord.relationships[relName] = {
            data: null
          };
        }
      }
    });
    
    return jsonApiRecord;
  }));
  
  const response = {
    data: isSingle ? processedRecords[0] : processedRecords
  };
  
  if (included.length > 0) {
    response.included = included;
  }
  
  return response;
};

/**
 * Processes belongsTo relationships from JSON:API input to foreign key updates
 * @param {Object} inputRecord - The JSON:API input record
 * @param {Object} schema - The schema definition
 * @returns {Object} Object mapping foreign key fields to their values
 * 
 * @example
 * const updates = processBelongsToRelationships(inputRecord, schema);
 * // Converts relationships.author.data.id to { author_id: '123' }
 */
export const processBelongsToRelationships = (inputRecord, schema) => {
  const foreignKeyUpdates = {};
  
  if (!inputRecord.data.relationships) {
    return foreignKeyUpdates;
  }
  
  // Schema might be a Schema object or plain object
  const schemaStructure = schema.structure || schema;
  
  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (fieldDef.belongsTo && fieldDef.as) {
      const relName = fieldDef.as;
      if (inputRecord.data.relationships[relName] !== undefined) {
        const relData = inputRecord.data.relationships[relName];
        foreignKeyUpdates[fieldName] = relData.data?.id || null;
      }
    }
  }
  
  return foreignKeyUpdates;
};


