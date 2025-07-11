/**
 * @module knex-helpers
 * @description Knex-specific helper functions for REST API SQL operations
 * 
 * This module contains helper functions used by the REST API Knex plugin
 * for SQL database operations, JSON:API transformations, and query building.
 * These helpers bridge the gap between JSON:API format and SQL database structure.
 * 
 * Why this is useful upstream:
 * - Abstracts SQL-specific logic from the REST API layer
 * - Handles JSON:API to SQL field mapping (relationships to foreign keys)
 * - Manages sparse fieldset optimization for database queries
 * - Provides consistent transformation between database records and JSON:API
 * - Enables relationship loading without N+1 query problems
 * - Supports both standard and polymorphic relationships
 */

/**
 * Gets the table name for a given scope, using custom tableName if specified.
 * 
 * This function allows resources to map to different database table names than their
 * scope names, which is useful for legacy databases or naming convention differences.
 * If no custom tableName is specified in the schema, it defaults to the scope name.
 * 
 * @param {string} scopeName - The name of the scope/resource
 * @param {Object} scopes - The scopes object from the API
 * @returns {Promise<string>} The table name to use for database queries
 * 
 * @example <caption>Default behavior - scope name as table name</caption>
 * const tableName = await getTableName('articles', scopes); 
 * // Returns 'articles' (uses scope name)
 * 
 * @example <caption>Custom table name from schema</caption>
 * // Schema definition: { tableName: 'blog_posts', ... }
 * const tableName = await getTableName('articles', scopes);
 * // Returns 'blog_posts' (uses custom tableName)
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Support legacy databases with different naming conventions
 * // 2. Map resources to views instead of tables
 * // 3. Handle multi-tenant databases with prefixed table names
 * // 4. Abstract table name resolution from query building
 */
export const getTableName = async (scopeName, scopes) => {
  const schema =  scopes[scopeName].vars.schemaInfo.schema;;
  return schema?.tableName || scopeName;
};

/**
 * Extracts all foreign key fields from a schema definition.
 * 
 * This function identifies fields that represent foreign keys based on belongsTo
 * relationships in the schema. These fields need special handling because they're
 * stored in the database but not exposed as attributes in JSON:API responses.
 * Instead, they're represented as relationships.
 * 
 * @param {Object} schema - The schema definition (can be Schema object or plain object)
 * @returns {Set<string>} Set of foreign key field names
 * 
 * @example <caption>Basic foreign key extraction</caption>
 * const schema = {
 *   title: { type: 'string' },
 *   author_id: { type: 'number', belongsTo: 'users', as: 'author' },
 *   category_id: { type: 'number', belongsTo: 'categories', as: 'category' }
 * };
 * const foreignKeys = getForeignKeyFields(schema);
 * // Returns Set(['author_id', 'category_id'])
 * 
 * @example <caption>Schema object vs plain object</caption>
 * // Works with both compiled Schema objects and plain schema definitions
 * const schemaObject = createSchema(schema);
 * const foreignKeys1 = getForeignKeyFields(schemaObject); // Schema object
 * const foreignKeys2 = getForeignKeyFields(schema);       // Plain object
 * // Both return the same Set
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Filter out foreign keys when building JSON:API attributes
 * // 2. Include foreign keys in SELECT even with sparse fieldsets
 * // 3. Identify which fields need relationship transformation
 * // 4. Optimize queries by knowing which fields are joins
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
 * Builds the field selection list for database queries, handling sparse fieldsets.
 * 
 * This function constructs the SELECT clause fields based on JSON:API sparse fieldsets
 * while ensuring all necessary fields are included for proper relationship handling.
 * It always includes ID and foreign key fields even if not explicitly requested,
 * because these are needed for JSON:API relationship links.
 * 
 * @param {string} scopeName - The name of the scope/resource
 * @param {string|null} requestedFields - Comma-separated list of requested fields or null for all
 * @param {Object} schema - The schema definition
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars containing configuration
 * @returns {Promise<Array<string>|string>} Array of field names to select or '*' for all
 * 
 * @example <caption>Sparse fieldset with automatic foreign key inclusion</caption>
 * const fields = await buildFieldSelection('articles', 'title,body', schema, scopes, vars);
 * // Returns ['id', 'title', 'body', 'author_id', 'category_id']
 * // Note: author_id and category_id included automatically for relationships
 * 
 * @example <caption>No specific fields requested - select all</caption>
 * const fields = await buildFieldSelection('articles', null, schema, scopes, vars);
 * // Returns '*' (select all columns)
 * 
 * @example <caption>Polymorphic relationships included</caption>
 * // For a comments table with polymorphic commentable relationship
 * const fields = await buildFieldSelection('comments', 'text', schema, scopes, vars);
 * // Returns ['id', 'text', 'commentable_type', 'commentable_id']
 * // Polymorphic type and id fields included automatically
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Optimize database queries by selecting only needed fields
 * // 2. Ensure relationship fields are always available for JSON:API links
 * // 3. Support JSON:API sparse fieldsets feature efficiently
 * // 4. Handle both regular and polymorphic foreign keys automatically
 * // 5. Reduce data transfer from database for large tables
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
      const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships;
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
 * Converts a database record to JSON:API format.
 * 
 * This function transforms a flat database record into the hierarchical JSON:API
 * structure, separating regular attributes from foreign keys. Foreign key fields
 * are filtered out of attributes because they're represented as relationships
 * in JSON:API format. This maintains the clean separation between data and
 * relationships that JSON:API requires.
 * 
 * @param {string} scopeName - The name of the scope/resource
 * @param {Object} record - The database record
 * @param {Object} schema - The schema definition
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars containing configuration
 * @returns {Promise<Object>} JSON:API formatted resource object
 * 
 * @example <caption>Basic transformation with foreign keys</caption>
 * const dbRecord = {
 *   id: 1,
 *   title: 'Hello World',
 *   content: 'Article content',
 *   author_id: 2,
 *   category_id: 5
 * };
 * const jsonApiRecord = await toJsonApi('articles', dbRecord, schema, scopes, vars);
 * // Returns:
 * // {
 * //   type: 'articles',
 * //   id: '1',
 * //   attributes: {
 * //     title: 'Hello World',
 * //     content: 'Article content'
 * //     // Note: author_id and category_id are NOT in attributes
 * //   }
 * // }
 * 
 * @example <caption>Polymorphic fields are also filtered</caption>
 * const commentRecord = {
 *   id: 10,
 *   text: 'Great article!',
 *   commentable_type: 'articles',
 *   commentable_id: 1
 * };
 * const jsonApiComment = await toJsonApi('comments', commentRecord, schema, scopes, vars);
 * // commentable_type and commentable_id are filtered out of attributes
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Transform flat SQL records to hierarchical JSON:API format
 * // 2. Maintain clean separation between attributes and relationships
 * // 3. Filter out foreign keys that become relationship links
 * // 4. Handle polymorphic relationship fields automatically
 * // 5. Ensure consistent ID formatting (always strings in JSON:API)
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
    const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships;
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
 * Builds the SELECT clause for a Knex query.
 * 
 * This function adds the appropriate SELECT clause to a Knex query builder,
 * handling both wildcard selection and specific field lists. It also supports
 * table prefixing for fields, which is essential when doing joins to avoid
 * column name conflicts.
 * 
 * @param {Object} query - The Knex query builder instance
 * @param {string} tableName - The table name
 * @param {Array<string>|string} fieldsToSelect - Fields to select or '*'
 * @param {boolean} useTablePrefix - Whether to prefix fields with table name
 * @returns {Object} The modified query builder
 * 
 * @example <caption>Select all fields</caption>
 * const query = knex('articles');
 * buildQuerySelection(query, 'articles', '*', false);
 * // Generates: SELECT * FROM articles
 * 
 * @example <caption>Select specific fields</caption>
 * const query = knex('articles');
 * buildQuerySelection(query, 'articles', ['id', 'title', 'author_id'], false);
 * // Generates: SELECT id, title, author_id FROM articles
 * 
 * @example <caption>With table prefix for joins</caption>
 * const query = knex('articles').join('users', 'articles.author_id', 'users.id');
 * buildQuerySelection(query, 'articles', ['id', 'title'], true);
 * // Generates: SELECT articles.id, articles.title FROM articles JOIN users...
 * // Prevents ambiguous column errors when both tables have 'id' column
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Build efficient SELECT clauses based on sparse fieldsets
 * // 2. Avoid ambiguous column errors in JOIN queries
 * // 3. Support both wildcard and specific field selection
 * // 4. Keep query building logic consistent across the codebase
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
 * Processes the ?include= parameter to load related resources.
 * 
 * This function handles the JSON:API include parameter, which allows clients to
 * request related resources in a single request. It supports nested includes
 * (like 'comments.user') and uses efficient batch loading to avoid N+1 queries.
 * The function respects database transactions and sparse fieldsets for included
 * resources.
 * 
 * @param {Array<Object>} records - The primary records to load includes for
 * @param {string} scopeName - The scope name of the primary records
 * @param {Object} queryParams - Query parameters containing include and fields
 * @param {Object} transaction - Optional database transaction
 * @param {Object} dependencies - Helper function dependencies
 * @returns {Promise<Array<Object>>} Array of included resources in JSON:API format
 * 
 * @example <caption>Basic relationship includes</caption>
 * const articles = [{ id: 1, author_id: 10 }, { id: 2, author_id: 11 }];
 * const included = await processIncludes(
 *   articles, 
 *   'articles', 
 *   { include: ['author'] }, 
 *   null, 
 *   dependencies
 * );
 * // Returns: [
 * //   { type: 'users', id: '10', attributes: {...} },
 * //   { type: 'users', id: '11', attributes: {...} }
 * // ]
 * 
 * @example <caption>Nested includes with dot notation</caption>
 * const included = await processIncludes(
 *   articles,
 *   'articles', 
 *   { include: ['author', 'comments.user'] },
 *   null,
 *   dependencies
 * );
 * // Loads authors, then comments for each article, 
 * // then users for each comment - all optimized to avoid N+1
 * 
 * @example <caption>With sparse fieldsets on included resources</caption>
 * const included = await processIncludes(
 *   articles,
 *   'articles',
 *   { 
 *     include: ['author'],
 *     fields: { users: 'name,email' }  // Only load name and email for users
 *   },
 *   trx,  // Within a transaction
 *   dependencies
 * );
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Implement JSON:API compound documents efficiently
 * // 2. Avoid N+1 query problems with batch loading
 * // 3. Support deep relationship includes (author.company.address)
 * // 4. Respect database transactions for consistency
 * // 5. Apply sparse fieldsets to included resources
 * // 6. Handle both belongsTo and hasMany relationships
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
      buildFieldSelection
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
  const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships;
  
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


