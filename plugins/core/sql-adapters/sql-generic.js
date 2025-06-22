import { NotFoundError, InternalError, ConflictError, ValidationError, BadRequestError, ErrorCodes } from '../../../lib/errors.js';
import { QueryBuilder, schemaFields } from '../../../lib/query-builder.js';

// Helper to convert database values to proper JavaScript types
function parseFieldTypes(row, schema) {
  if (!row || !schema?.structure) return row;
  
  const result = { ...row };
  
  for (const [field, def] of Object.entries(schema.structure)) {
    const value = result[field];
    if (value === null || value === undefined) continue;
    
    switch (def.type) {
      case 'object':
      case 'array':
        // MySQL returns JSON as strings
        if (typeof value === 'string') {
          try {
            result[field] = JSON.parse(value);
          } catch (e) {
            // Keep original value if parsing fails
          }
        }
        break;
        
      case 'boolean':
        // MySQL returns booleans as 0/1
        if (typeof value === 'number') {
          result[field] = value === 1;
        }
        break;
    }
  }
  
  return result;
}

// Helper to convert field values for database storage
function prepareValueForStorage(value, fieldDef) {
  if (value === null || value === undefined) return value;
  
  // Convert objects/arrays to JSON strings for storage
  if (fieldDef && (fieldDef.type === 'object' || fieldDef.type === 'array')) {
    return JSON.stringify(value);
  }
  
  return value;
}

// Helper to build searchable fields and mappings
function getSearchableFields(api, schema, resourceType, contextOptions = {}) {
  const allowedFields = new Set();
  const fieldMappings = {};
  
  // 1. Add fields marked as searchable in schema (excluding virtual fields)
  if (schema) {
    for (const [field, def] of Object.entries(schema.structure)) {
      if (def.searchable === true && !def.virtual) {
        allowedFields.add(field);
      }
    }
  }
  
  // 2. Add mapped searchable fields from resource options or context options
  const resourceOptions = api.resourceOptions?.get(resourceType) || {};
  const searchableFieldMappings = contextOptions.searchableFields || resourceOptions.searchableFields || {};
  for (const [friendlyName, path] of Object.entries(searchableFieldMappings)) {
    allowedFields.add(friendlyName);
    fieldMappings[friendlyName] = path;
  }
  
  return { allowedFields, fieldMappings };
}

// Helper to process joins for a query
async function processJoins(query, table, schema, api, requestedJoins, nestedJoinMap, context) {
  const idProperty = api.options.idProperty || 'id';
  
  // Track joined fields in context
  context.joinFields = {};
  
  // Process joins with nesting support
  for (const [field, refs] of requestedJoins) {
    const joinMeta = typeof refs === 'object' ? refs : { resource: refs };
    const joinedResource = joinMeta.resource;
    const joinedSchema = api.schemas.get(joinedResource);
    
    if (!joinedSchema) continue;
    
    // Include the join configuration in the context
    context.joinFields[field] = {
      resource: joinedResource,
      fields: joinMeta.join?.fields || joinMeta.fields,
      preserveId: joinMeta.join?.preserveId !== false, // Default to true if not explicitly false
      runHooks: joinMeta.join?.runHooks,
      nestedJoins: nestedJoinMap.get(field)?.nestedJoins || {}
    };
    
    // Join the table
    const joinAlias = field;
    const escapeId = await api.execute('db.formatIdentifier', { identifier: idProperty });
    const escapeTable = await api.execute('db.formatIdentifier', { identifier: table });
    const escapeField = await api.execute('db.formatIdentifier', { identifier: field });
    const escapeJoinAlias = await api.execute('db.formatIdentifier', { identifier: joinAlias });
    
    // Format the table with alias
    const tableWithAlias = `${joinedResource} AS ${joinAlias}`;
    query.leftJoin(
      tableWithAlias,
      `${escapeTable}.${escapeField} = ${escapeJoinAlias}.${escapeId}`
    );
    
    // Add fields from joined table with prefix
    const fieldsToSelect = joinMeta.fields || (joinMeta.join?.fields);
    
    if (fieldsToSelect && Array.isArray(fieldsToSelect)) {
      for (const f of fieldsToSelect) {
        const escapeF = await api.execute('db.formatIdentifier', { identifier: f });
        query.select(`${escapeJoinAlias}.${escapeF} AS __${field}__${f}`);
      }
    } else {
      // Select all non-silent fields
      const joinedFields = schemaFields(joinedSchema);
      // Always include ID field for joined tables
      const joinedIdProperty = api.options.idProperty || 'id';
      const escapeJoinedId = await api.execute('db.formatIdentifier', { identifier: joinedIdProperty });
      query.select(`${escapeJoinAlias}.${escapeJoinedId} AS __${field}__${joinedIdProperty}`);
      
      for (const f of joinedFields) {
        const escapeF = await api.execute('db.formatIdentifier', { identifier: f });
        query.select(`${escapeJoinAlias}.${escapeF} AS __${field}__${f}`);
      }
    }
  }
}

// Helper to apply filters to a query
async function applyFilters(query, filters, table, schema, api, options = {}) {
  const { allowedFields, fieldMappings, skipJoinedFields = false } = options;
  
  for (const [field, value] of Object.entries(filters)) {
    // Check if field is searchable
    if (!allowedFields.has(field)) {
      throw new ValidationError()
        .addFieldError('filter', `Field '${field}' is not searchable`);
    }
    
    // Get the actual field path (use mapping if exists)
    const actualPath = fieldMappings[field] || field;
    
    // Check if this is a virtual field (marked with '*')
    if (actualPath === '*') {
      // Virtual field - skip automatic query building
      // It will be handled by modifyQuery hooks
      continue;
    }
    
    // Skip joined fields if requested
    if (skipJoinedFields && actualPath.includes('.')) {
      continue;
    }
    
    // Check if value is an object with operators
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Handle operator syntax: { gt: 100, lt: 200 }
      for (const [operator, operatorValue] of Object.entries(value)) {
        await applyFilterOperator(query, table, actualPath, operator, operatorValue, schema, api, options);
      }
    } else {
      // Handle simple equality check
      await applyFilterOperator(query, table, actualPath, 'eq', value, schema, api, options);
    }
  }
}

// Helper to parse sort parameters
function parseSort(sort) {
  if (!sort) return [];
  
  // Handle array format (already parsed)
  if (Array.isArray(sort)) {
    return sort.map(s => {
      if (typeof s === 'string') {
        return { field: s, direction: 'ASC' };
      }
      return { field: s.field, direction: s.direction || 'ASC' };
    });
  }
  
  // Handle string format
  if (typeof sort === 'string') {
    return sort.split(',').map(field => {
      field = field.trim();
      if (field.startsWith('-')) {
        return { field: field.slice(1), direction: 'DESC' };
      }
      return { field, direction: 'ASC' };
    });
  }
  
  return [];
}

/**
 * Generic SQL Plugin
 * 
 * Provides SQL functionality using whatever database adapter is installed.
 * The adapter must implement the db.* interface.
 */
export const SQLPlugin = {
  install(api, options = {}) {
    // Note: Filters are now applied in the initializeQuery hook to avoid duplication
    
    api.hook('afterQuery', async (context) => {
      if (!context.joinFields || Object.keys(context.joinFields).length === 0) {
        return;
      }
      
      // Process each result
      for (const record of context.results) {
        await api._processJoinedData(context, record);
      }
    }, 90);
    
    // Also process joined data for get operations
    api.hook('afterGet', async (context) => {
      if (api.options.debug && context.options?.type === 'offices') {
        console.log('afterGet hook for offices:', {
          hasJoinFields: !!context.joinFields,
          joinFieldsCount: context.joinFields ? Object.keys(context.joinFields).length : 0,
          hasResult: !!context.result
        });
      }
      
      if (!context.joinFields || Object.keys(context.joinFields).length === 0) {
        return;
      }
      
      if (context.result) {
        await api._processJoinedData(context, context.result);
      }
    }, 90);
    // Ensure a database adapter is installed
    api.hook('afterConnect', async () => {
      const hasAdapter = api.implementers.has('db.query');
      if (!hasAdapter) {
        throw new InternalError('No database adapter installed. Install MySQLAdapter or AlaSQLAdapter first.');
      }
      
      // Add transaction methods if storage supports it
      if (api.storagePlugin?.supportsTransactions) {
        const { addTransactionMethods } = await import('../lib/transaction.js');
        addTransactionMethods(api);
      }
      
      // Add batch operations
      const { addBatchMethods } = await import('../../../lib/batch.js');
      addBatchMethods(api);
    });
    
    /**
     * Hook: Initialize query
     * This runs FIRST and sets up the basic query
     */
    api.hook('initializeQuery', async (context) => {
      // Run for both query and get operations when joins are needed
      if (context.method !== 'query' && context.method !== 'get') return;
      if (context.method === 'get' && !context.query) return; // Skip if get isn't using query builder
      
      const table = context.options.table || context.options.type;
      const schema = api.schemas.get(context.options.type);
      
      // Use existing query for GET operations, create new one for QUERY
      const query = context.query || new QueryBuilder(table, api);
      
      // Add schema fields by default (excluding silent ones)
      if (schema) {
        const fields = schemaFields(schema, table);
        // Always include the ID field
        const idProperty = api.options.idProperty || 'id';
        query.select(`${table}.${idProperty}`, ...fields);
        
        // Handle advanced refs with join configuration
        const user = context.options?.user;
        const requestedJoins = await determineRequestedJoins(api, schema, context.params || context.options, user);
        
        // Get nested joins from processed include parameter
        const nestedJoinMap = context.params?._nestedJoins || new Map();
        
        // Process all joins
        await processJoins(query, table, schema, api, requestedJoins, nestedJoinMap, context);
      } else {
        query.select(`${table}.*`);
      }
      
      // Apply filters from params
      if (context.params.filter) {
        if (api.options.debug) {
          console.log('Applying filters:', context.params.filter);
        }
        
        const { allowedFields, fieldMappings } = getSearchableFields(api, schema, context.options.type, context.options);
        
        if (api.options.debug) {
          console.log('Allowed searchable fields:', Array.from(allowedFields));
          console.log('Field mappings:', fieldMappings);
        }
        
        await applyFilters(query, context.params.filter, table, schema, api, {
          allowedFields,
          fieldMappings
        });
      }
      
      // Store query on context
      context.query = query;
    }, 10); // Run early

    /**
     * Hook: Modify query (after initialization)
     * Other plugins can add their modifications here
     */
    api.hook('modifyQuery', async (context) => {
      if (!context.query) return;
      
      const table = context.options.table || context.options.type;
      
      // Apply sorting
      if (context.params.sort) {
        const sorts = parseSort(context.params.sort);
        
        // Get the schema to validate sort fields
        const schema = api.schemas?.get(context.options.type);
        const allowedFields = schema ? Object.keys(schema.structure) : [];
        
        for (const { field, direction } of sorts) {
          // Check if this is a mapped searchable field
          const searchableFields = context.options.searchableFields || {};
          const mappedField = searchableFields[field];
          
          if (mappedField && mappedField !== '*') {
            // Handle mapped relationship fields (e.g., 'author.name' -> 'authorId.name')
            if (mappedField.includes('.')) {
              const [joinField, targetField] = mappedField.split('.');
              const fieldDef = schema.structure[joinField];
              
              if (fieldDef?.refs) {
                // Ensure the join is added
                const joinTable = fieldDef.refs.resource;
                const joinAlias = `__${joinField}_join`;
                
                // Check if join already exists
                if (!context.query.parts.joins.some(j => j.table && j.table.includes(joinAlias))) {
                  const idProperty = api.options.idProperty || 'id';
                  
                  // Properly escape all identifiers
                  const escapeJoinTable = await api.execute('db.formatIdentifier', { identifier: joinTable });
                  const escapeJoinAlias = await api.execute('db.formatIdentifier', { identifier: joinAlias });
                  const escapeId = await api.execute('db.formatIdentifier', { identifier: idProperty });
                  const escapeTable = await api.execute('db.formatIdentifier', { identifier: table });
                  const escapeJoinField = await api.execute('db.formatIdentifier', { identifier: joinField });
                  
                  context.query.leftJoin(
                    `${escapeJoinTable} AS ${escapeJoinAlias}`,
                    `${escapeJoinAlias}.${escapeId} = ${escapeTable}.${escapeJoinField}`
                  );
                }
                
                // Sort by the joined field with proper escaping
                const escapeJoinAlias = await api.execute('db.formatIdentifier', { identifier: joinAlias });
                const escapeTargetField = await api.execute('db.formatIdentifier', { identifier: targetField });
                context.query.orderBy(`${escapeJoinAlias}.${escapeTargetField}`, direction);
              } else {
                throw new BadRequestError(`Invalid sort field mapping: ${field}`);
              }
            } else {
              // Simple mapped field
              const escapedTable = await api.execute('db.formatIdentifier', { identifier: table });
              const escapedField = await api.execute('db.formatIdentifier', { identifier: mappedField });
              context.query.orderBy(`${escapedTable}.${escapedField}`, direction);
            }
          } else if (allowedFields.includes(field)) {
            // Regular field
            const escapedTable = await api.execute('db.formatIdentifier', { identifier: table });
            const escapedField = await api.execute('db.formatIdentifier', { identifier: field });
            context.query.orderBy(`${escapedTable}.${escapedField}`, direction);
          } else {
            throw new BadRequestError(`Invalid sort field: ${field}`);
          }
        }
      }
      
      // Apply pagination  
      if (context.params.page) {
        const pageSize = context.params.page.size || 10;
        const pageNumber = context.params.page.number || 1;
        const offset = (pageNumber - 1) * pageSize;
        
        context.query.limit(pageSize).offset(offset);
      }
    }, 50); // Run middle

    /**
     * Hook: Finalize query
     * Last chance to modify before execution
     */
    api.hook('finalizeQuery', async (context) => {
      // Add any final modifications here
      // For example, soft delete filtering could go here
    }, 90); // Run late

    // Implement CRUD operations
    api.implement('get', async (context) => {
      const { id, options } = context;
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      try {
        // Check if we need to use query builder for joins
        const schema = api.schemas?.get(options.type);
        const needsJoins = schema && options.joins !== false && needsJoinProcessing(schema, options);
        
        if (needsJoins) {
          if (api.options.debug) {
            console.log('Get using query builder for joins');
          }
          // Use query builder for complex get with joins
          const query = new QueryBuilder(table, api);
          
          // Convert ID if needed
          const queryId = await api.execute('db.convertId', { id });
          
          // Set up base query
          query.where(`${table}.${idProperty} = ?`, queryId);
          
          // Create a context for hooks
          const queryContext = {
            ...context,
            method: 'get',
            query,
            params: options
          };
          
          // Run query hooks
          await api.runHooks('initializeQuery', queryContext);
          await api.runHooks('modifyQuery', queryContext);
          await api.runHooks('finalizeQuery', queryContext);
          
          // Copy joinFields back to original context for processing
          if (queryContext.joinFields) {
            context.joinFields = queryContext.joinFields;
          }
          
          // Execute query
          let sql = queryContext.query.toSQL();
          const args = queryContext.query.getArgs();
          
          // Preprocess SQL if adapter needs it
          if (api.implementers.has('db.preprocessSql')) {
            sql = await api.execute('db.preprocessSql', { sql });
          }
          
          if (api.options.debug) {
            console.log('Query SQL:', sql);
            console.log('Query Args:', args);
          }
          
          const result = await api.execute('db.query', { 
            sql, 
            params: args,
            transaction: context.options?.transaction 
          });
          const rows = result.rows;
          
          if (!rows[0] && !options.allowNotFound) {
            throw new NotFoundError(options.type || table, id);
          }
          
          return rows[0] ? parseFieldTypes(rows[0], schema) : null;
        } else {
          // Simple get without joins
          const escapeId = await api.execute('db.formatIdentifier', { identifier: idProperty });
          const escapeTable = await api.execute('db.formatIdentifier', { identifier: table });
          
          // Get schema to check if we need field filtering
          const schema = api.schemas?.get(options.type);
          
          // Use schemaFields helper to get non-silent, non-virtual fields
          let sql;
          if (schema) {
            const fields = schemaFields(schema, table);
            // Always include the ID field
            sql = `SELECT ${escapeTable}.${escapeId}, ${fields.join(', ')} FROM ${escapeTable} WHERE ${escapeId} = ?`;
          } else {
            // No schema, fall back to SELECT *
            sql = `SELECT * FROM ${escapeTable} WHERE ${escapeId} = ?`;
          }
          
          
          // Convert ID if needed
          const queryId = await api.execute('db.convertId', { id });
          
          if (api.options.debug) {
            console.log('Simple GET SQL:', sql);
            console.log('Simple GET params:', [queryId]);
          }
          
          const result = await api.execute('db.query', { 
            sql, 
            params: [queryId],
            transaction: context.options?.transaction 
          });
          // MySQL returns rows directly, not as result.rows
          const rows = result.rows;

          if (!rows[0] && !options.allowNotFound) {
            throw new NotFoundError(options.type || table, id);
          }

          return rows[0] ? parseFieldTypes(rows[0], schema) : null;
        }
      } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE' || 
            (error.message && error.message.includes("Table") && error.message.includes("could not be found")) ||
            (error.message && error.message.includes("Table does not exist"))) {
          // Try to create table if adapter supports it
          const features = await api.execute('db.features', {});
          if (features.tableCreation) {
            const schema = api.schemas?.get(options.type);
            if (schema) {
              await api.execute('db.createTable', { table, schema, idProperty });
              // Retry the operation
              return api.implementers.get('get')(context);
            }
          }
          throw new InternalError(`Table '${table}' does not exist`).withContext({ table });
        }
        throw error;
      }
    });

    const queryImplementation = async (context) => {
      const { params, options } = context;
      const table = options.table || options.type;
      
      try {
        // Get total count first
        const countQuery = new QueryBuilder(table, api);
        countQuery.select('COUNT(*) AS cnt');
        
        // Apply the same filters for count
        if (params.filter) {
          const schema = api.schemas.get(options.type);
          const { allowedFields, fieldMappings } = getSearchableFields(api, schema, options.type, options);
          
          await applyFilters(countQuery, params.filter, table, schema, api, {
            allowedFields,
            fieldMappings,
            skipJoinedFields: true  // Skip joined field filters for count query
          });
        }
        
        let countSql = countQuery.toSQL();
        const countParams = countQuery.getArgs();
        
        // Preprocess SQL if adapter needs it
        if (api.implementers.has('db.preprocessSql')) {
          countSql = await api.execute('db.preprocessSql', { sql: countSql });
        }
        
        const countResult = await api.execute('db.query', { sql: countSql, params: countParams });
        const totalCount = countResult.rows[0]?.cnt || 0;
        
        // Create context for query hooks
        context.query = null;
        context.results = [];
        context.totalCount = totalCount;
        
        // Run query hooks to build the main query
        await api.runHooks('initializeQuery', context);
        await api.runHooks('modifyQuery', context); 
        await api.runHooks('finalizeQuery', context);
        
        if (context.query) {
          let sql = context.query.toSQL();
          const args = context.query.getArgs();
          
          // Preprocess SQL if adapter needs it
          if (api.implementers.has('db.preprocessSql')) {
            sql = await api.execute('db.preprocessSql', { sql });
          }
          
          if (api.options.debug) {
            console.log('Query SQL:', sql);
            console.log('Query Params:', args);
          }
          
          const result = await api.execute('db.query', { 
            sql, 
            params: args,
            transaction: context.options?.transaction 
          });
          const rows = result.rows;
          
          // Parse JSON fields for each row
          const schema = api.schemas?.get(options.type);
          context.results = rows.map(row => parseFieldTypes(row, schema));
        }
        
        // Return results with metadata
        const pageSize = params.page?.size || 10;
        const pageNumber = params.page?.number || 1;
        
        return {
          results: context.results,
          meta: {
            total: totalCount,
            pageSize,
            pageNumber,
            totalPages: Math.ceil(totalCount / pageSize)
          }
        };
      } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE' || 
            (error.message && error.message.includes("Table") && error.message.includes("could not be found")) ||
            (error.message && error.message.includes("Table does not exist"))) {
          // Try to create table if adapter supports it
          const features = await api.execute('db.features', {});
          if (features.tableCreation) {
            const schema = api.schemas?.get(options.type);
            if (schema) {
              await api.execute('db.createTable', { table, schema, idProperty: api.options.idProperty });
              // Retry the operation
              return await queryImplementation(context);
            }
          }
          throw new InternalError(`Table '${table}' does not exist`).withContext({ table });
        }
        throw error;
      }
    };
    
    api.implement('query', queryImplementation);

    const insertImplementation = async (context) => {
      const { data, options } = context;
      const table = options.table || options.type || context.type;
      const idProperty = options.idProperty || api.options.idProperty;
      const schema = api.schemas?.get(options.type || table);
      
      try {
        // Check if adapter requires ID generation
        const features = await api.execute('db.features', {});
        
        // Generate ID if not provided and adapter needs it
        if (!data[idProperty] && features.requiresIdGeneration) {
          data[idProperty] = await api.execute('db.generateId', { table });
        }
        
        // Clean data - remove undefined values, silent fields, and virtual fields
        const cleanData = {};
        if (schema) {
          for (const [key, value] of Object.entries(data)) {
            const fieldDef = schema.structure[key];
            if (value !== undefined && (!fieldDef?.silent || key === idProperty) && !fieldDef?.virtual) {
              cleanData[key] = value;
            }
          }
        } else {
          Object.assign(cleanData, data);
        }
        
        // Prepare INSERT
        const fields = Object.keys(cleanData);
        const escapeTable = await api.execute('db.formatIdentifier', { identifier: table });
        const fieldList = await Promise.all(
          fields.map(f => api.execute('db.formatIdentifier', { identifier: f }))
        );
        const placeholders = fields.map(() => '?').join(', ');
        const values = fields.map(f => prepareValueForStorage(cleanData[f], schema?.structure[f]));
        
        const sql = `INSERT INTO ${escapeTable} (${fieldList.join(', ')}) VALUES (${placeholders})`;
        
        if (api.options.debug) {
          console.log('INSERT SQL:', sql);
          console.log('INSERT Values:', values);
        }
        
        const result = await api.execute('db.query', { sql, params: values });

        // Get the inserted ID
        cleanData[idProperty] = await api.execute('db.getInsertId', { 
          result, 
          table,
          data: cleanData,
          idProperty 
        });
        
        // If we need to perform eager joins, fetch the record
        const hasEagerJoins = schema && Object.values(schema.structure).some(
          field => field.refs?.join?.eager
        );
        
        if (hasEagerJoins) {
          // Fetch the record with joins
          const getContext = {
            api,
            method: 'get',
            id: cleanData[idProperty],
            options: { ...options, type: options.type },
            result: null,
            errors: [],
            joinFields: {} // Initialize joinFields for hook processing
          };
          
          const getImpl = api.implementers.get('get');
          const result = await getImpl(getContext);
          
          // Copy joinFields from get context
          if (getContext.joinFields) {
            context.joinFields = getContext.joinFields;
          }
          
          return result;
        }
        
        return cleanData;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
          const field = extractFieldNameFromDatabaseError(error.message);
          throw new ConflictError(error.message)
            .withContext({ 
              field, 
              value: data[field],
              code: ErrorCodes.DUPLICATE_RESOURCE 
            });
        }
        if (error.code === 'ER_NO_SUCH_TABLE' || 
            (error.message && error.message.includes("Table") && error.message.includes("could not be found")) ||
            (error.message && error.message.includes("Table does not exist"))) {
          // Try to create table if adapter supports it
          const features = await api.execute('db.features', {});
          if (features.tableCreation && schema) {
            await api.execute('db.createTable', { table, schema, idProperty });
            // Retry the operation
            return await insertImplementation(context);
          }
        }
        throw error;
      }
    };
    
    api.implement('insert', insertImplementation);

    api.implement('update', async (context) => {
      const { id, data, options } = context;
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;
      const schema = api.schemas?.get(options.type);
      
      try {
        // Clean data - remove undefined values and silent fields
        const cleanData = {};
        
        // Handle fullRecord (PUT) vs partial update (PATCH)
        if (options.fullRecord && schema) {
          // For PUT: include all schema fields, set missing ones to null/default
          for (const [field, def] of Object.entries(schema.structure)) {
            if (def.silent || field === idProperty) continue;
            
            // Skip auto-generated fields
            if (def.onCreate || def.onUpdate) continue;
            
            if (data.hasOwnProperty(field)) {
              if (data[field] !== undefined) {
                cleanData[field] = data[field];
              }
            } else {
              // Field not provided in PUT request - set to default or null
              if (def.default !== undefined) {
                cleanData[field] = typeof def.default === 'function' ? def.default() : def.default;
              } else if (!def.required) {
                cleanData[field] = null;
              }
              // Required fields without defaults will cause validation error
            }
          }
        } else {
          // For PATCH: only update provided fields
          if (schema) {
            for (const [key, value] of Object.entries(data)) {
              if (value !== undefined && !schema.structure[key]?.silent && key !== idProperty) {
                cleanData[key] = value;
              }
            }
          } else {
            const { [idProperty]: _, ...rest } = data;
            Object.assign(cleanData, rest);
          }
        }
        
        if (Object.keys(cleanData).length === 0) {
          // Nothing to update
          return api.get(id, { ...options, type: options.type });
        }
        
        // Build update query
        const fields = Object.keys(cleanData);
        const escapeTable = await api.execute('db.formatIdentifier', { identifier: table });
        const escapeId = await api.execute('db.formatIdentifier', { identifier: idProperty });
        
        const sets = await Promise.all(
          fields.map(async f => {
            const escaped = await api.execute('db.formatIdentifier', { identifier: f });
            return `${escaped} = ?`;
          })
        );
        
        const values = fields.map(f => prepareValueForStorage(cleanData[f], schema?.structure[f]));
        
        // Convert ID if needed
        const queryId = await api.execute('db.convertId', { id });
        values.push(queryId);
        
        const sql = `UPDATE ${escapeTable} SET ${sets.join(', ')} WHERE ${escapeId} = ?`;
        
        if (api.options.debug) {
          console.log('UPDATE SQL:', sql);
          console.log('UPDATE Values:', values);
        }
        
        const result = await api.execute('db.query', { sql, params: values });
        const affectedRows = await api.execute('db.getAffectedRows', { result });
        
        if (affectedRows === 0) {
          throw new NotFoundError(options.type || table, id);
        }
        
        // Return updated record - get the raw data without formatting
        const getContext = {
          api,
          method: 'get',
          id,
          options: { ...options, type: options.type },
          result: null,
          errors: []
        };
        
        const getImpl = api.implementers.get('get');
        return await getImpl(getContext);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
          const field = extractFieldNameFromDatabaseError(error.message);
          throw new ConflictError(error.message)
            .withContext({ 
              field, 
              value: data[field],
              code: ErrorCodes.DUPLICATE_RESOURCE 
            });
        }
        throw error;
      }
    });

    api.implement('delete', async (context) => {
      const { id, options } = context;
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;
      
      try {
        const escapeTable = await api.execute('db.formatIdentifier', { identifier: table });
        const escapeId = await api.execute('db.formatIdentifier', { identifier: idProperty });
        const sql = `DELETE FROM ${escapeTable} WHERE ${escapeId} = ?`;
        
        // Convert ID if needed
        const queryId = await api.execute('db.convertId', { id });
        
        const result = await api.execute('db.query', { sql, params: [queryId] });
        const affectedRows = await api.execute('db.getAffectedRows', { result });
        
        if (affectedRows === 0) {
          throw new NotFoundError(options.type || table, id);
        }
      } catch (error) {
        if (error.code === 'ER_FOREIGN_KEY_CONSTRAINT' || (error.message && error.message.includes('FOREIGN KEY constraint failed'))) {
          throw new ConflictError('Cannot delete resource due to existing references')
            .withContext({ code: ErrorCodes.FOREIGN_KEY_CONSTRAINT });
        }
        throw error;
      }
    });

    // Position shifting for PositioningPlugin
    api.implement('shiftPositions', async (context) => {
      const { type, field, from, delta, filter = {}, excludeIds = [] } = context.options;
      const idProperty = api.options.idProperty || 'id';
      
      const escapeTable = await api.execute('db.formatIdentifier', { identifier: type });
      const escapeField = await api.execute('db.formatIdentifier', { identifier: field });
      const escapeId = await api.execute('db.formatIdentifier', { identifier: idProperty });
      
      // Build WHERE clause
      const conditions = [`${escapeField} >= ?`];
      const params = [from];
      
      for (const [key, value] of Object.entries(filter)) {
        const escapeKey = await api.execute('db.formatIdentifier', { identifier: key });
        conditions.push(`${escapeKey} = ?`);
        params.push(value);
      }
      
      if (excludeIds.length > 0) {
        const placeholders = excludeIds.map(() => '?').join(', ');
        conditions.push(`${escapeId} NOT IN (${placeholders})`);
        params.push(...excludeIds);
      }
      
      const whereClause = conditions.join(' AND ');
      
      // Add delta to params for the SET clause
      const updateParams = [delta, ...params];
      
      const sql = `UPDATE ${escapeTable} SET ${escapeField} = ${escapeField} + ? WHERE ${whereClause}`;
      
      const result = await api.execute('db.query', { sql, params: updateParams });
      const affectedRows = await api.execute('db.getAffectedRows', { result });
      
      return { shiftedCount: affectedRows };
    });

    // Connect/disconnect
    api.connect = async () => {
      await api.execute('db.connect', {});
      await api.runHooks('afterConnect', { api });
    };
    
    api.disconnect = async () => {
      await api.execute('db.disconnect', {});
    };
  }
};

// Helper functions

function needsJoinProcessing(schema, options) {
  // Check if any fields have refs with eager loading
  for (const [field, def] of Object.entries(schema.structure)) {
    if (def.refs && (def.refs.join?.eager || def.eager)) {
      return true;
    }
  }
  
  // Check if joins are explicitly requested
  if (options.joins && options.joins.length > 0) {
    return true;
  }
  
  // Check if include parameter is present
  if (options.include) {
    return true;
  }
  
  return false;
}

async function determineRequestedJoins(api, schema, params, user) {
  const joins = new Map();
  
  if (api.options.debug && params?.type === 'offices') {
    console.log('determineRequestedJoins for offices:', {
      hasParams: !!params,
      hasInclude: !!params?.include,
      includeValue: params?.include
    });
  }
  
  // Add eager joins only if no include parameter specified
  if (!params?.include) {
    for (const [field, def] of Object.entries(schema.structure)) {
      if (def.refs && def.refs.join?.eager === true) {
        // Check permission for eager joins too
        if (!user || await api.checkIncludePermission(user, def)) {
          joins.set(field, def.refs);
          if (api.options.debug && params?.type === 'offices') {
            console.log(`Added eager join for field: ${field}`);
          }
        }
      }
    }
  }
  
  // Process include parameter
  if (params.include) {
    const includeResult = await api.processIncludeParam(schema, params.include, user);
    
    // Add simple joins
    for (const field of includeResult.joins) {
      const fieldDef = schema.structure[field];
      if (fieldDef?.refs) {
        joins.set(field, fieldDef.refs);
      }
    }
    
    // Store nested joins for later processing
    if (includeResult.nestedJoins.size > 0) {
      params._nestedJoins = includeResult.nestedJoins;
    }
    
    // Store to-many joins for later processing
    if (includeResult.toManyJoins && includeResult.toManyJoins.length > 0) {
      params._toManyJoins = includeResult.toManyJoins;
    }
  }
  
  return joins;
}

// Supported operators and their SQL equivalents
const OPERATORS = {
  'eq': '=',
  'ne': '!=',
  'gt': '>',
  'gte': '>=',
  'lt': '<',
  'lte': '<=',
  'in': 'IN',
  'nin': 'NOT IN',
  'like': 'LIKE',
  'ilike': 'ILIKE',  // Case-insensitive LIKE (Postgres)
  'notlike': 'NOT LIKE',
  'startsWith': 'LIKE',
  'endsWith': 'LIKE',
  'contains': 'LIKE',
  'icontains': 'LIKE',  // Case-insensitive contains
  'between': 'BETWEEN',
  'null': 'IS',
  'notnull': 'IS NOT'
};

// Maximum filter value length to prevent DoS
const MAX_FILTER_VALUE_LENGTH = 1000;
const MAX_ARRAY_FILTER_LENGTH = 100;

// Validate filter value based on field type and operator
function validateFilterValue(field, operator, value, schema) {
  const fieldDef = schema?.structure?.[field];
  
  // Check for dangerous patterns in filter values
  if (typeof value === 'string') {
    // Check length
    if (value.length > MAX_FILTER_VALUE_LENGTH) {
      throw new ValidationError()
        .addFieldError('filter', `Filter value for field '${field}' exceeds maximum length of ${MAX_FILTER_VALUE_LENGTH}`);
    }
    
    // Check for SQL injection patterns
    const dangerousPatterns = [
      /;.*(?:DROP|DELETE|UPDATE|INSERT|CREATE|ALTER|TRUNCATE)/i,
      /\b(?:UNION|SELECT)\b.*\b(?:FROM|WHERE)\b/i,
      /\/\*.*\*\//,  // Block comments
      /--\s*$/,       // SQL comments
      /\0/            // Null bytes
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(value)) {
        throw new ValidationError()
          .addFieldError('filter', `Invalid characters in filter value for field '${field}'`);
      }
    }
  }
  
  // Validate based on operator
  if (operator === 'in' || operator === 'nin') {
    if (!Array.isArray(value)) {
      throw new ValidationError()
        .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
    }
    
    if (value.length > MAX_ARRAY_FILTER_LENGTH) {
      throw new ValidationError()
        .addFieldError('filter', `Array filter for field '${field}' exceeds maximum length of ${MAX_ARRAY_FILTER_LENGTH}`);
    }
    
    // Validate each array element
    for (const item of value) {
      if (typeof item === 'string' && item.length > MAX_FILTER_VALUE_LENGTH) {
        throw new ValidationError()
          .addFieldError('filter', `Array filter value for field '${field}' exceeds maximum length`);
      }
    }
  } else if (operator === 'between') {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ValidationError()
        .addFieldError('filter', `Operator 'between' requires an array with exactly 2 values for field '${field}'`);
    }
  }
  
  // Validate based on field type
  if (fieldDef) {
    const fieldType = fieldDef.type;
    
    switch (fieldType) {
      case 'number':
        if (operator !== 'null' && operator !== 'notnull') {
          if (operator === 'in' || operator === 'nin') {
            for (const item of value) {
              if (isNaN(Number(item))) {
                throw new ValidationError()
                  .addFieldError('filter', `Invalid number value in array filter for field '${field}'`);
              }
            }
          } else if (operator === 'between') {
            if (isNaN(Number(value[0])) || isNaN(Number(value[1]))) {
              throw new ValidationError()
                .addFieldError('filter', `Invalid number values in between filter for field '${field}'`);
            }
          } else if (typeof value !== 'number' && isNaN(Number(value))) {
            throw new ValidationError()
              .addFieldError('filter', `Invalid number filter value for field '${field}'`);
          }
        }
        break;
        
      case 'boolean':
        if (operator !== 'null' && operator !== 'notnull' && operator !== 'eq' && operator !== 'ne') {
          throw new ValidationError()
            .addFieldError('filter', `Operator '${operator}' not supported for boolean field '${field}'`);
        }
        if (operator === 'eq' || operator === 'ne') {
          if (value !== true && value !== false && value !== 'true' && value !== 'false' && value !== 1 && value !== 0) {
            throw new ValidationError()
              .addFieldError('filter', `Invalid boolean filter value for field '${field}'`);
          }
        }
        break;
        
      case 'date':
      case 'datetime':
        if (operator !== 'null' && operator !== 'notnull') {
          // Validate date format
          const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?$/;
          
          if (operator === 'in' || operator === 'nin') {
            for (const item of value) {
              if (!datePattern.test(item) && isNaN(Date.parse(item))) {
                throw new ValidationError()
                  .addFieldError('filter', `Invalid date value in array filter for field '${field}'`);
              }
            }
          } else if (operator === 'between') {
            if ((!datePattern.test(value[0]) && isNaN(Date.parse(value[0]))) ||
                (!datePattern.test(value[1]) && isNaN(Date.parse(value[1])))) {
              throw new ValidationError()
                .addFieldError('filter', `Invalid date values in between filter for field '${field}'`);
            }
          } else if (!datePattern.test(value) && isNaN(Date.parse(value))) {
            throw new ValidationError()
              .addFieldError('filter', `Invalid date filter value for field '${field}'`);
          }
        }
        break;
        
      case 'string':
        // String operators are valid, additional validation done above
        if (fieldDef.pattern && operator === 'eq') {
          const regex = new RegExp(fieldDef.pattern);
          if (!regex.test(value)) {
            throw new ValidationError()
              .addFieldError('filter', `Filter value for field '${field}' does not match required pattern`);
          }
        }
        break;
        
      case 'id':
        // ID fields can be string or number
        break;
        
      case 'array':
      case 'object':
        // Complex types - operator validation already done
        break;
        
      default:
        // Unknown type - allow but log warning
        if (api?.options?.debug) {
          console.warn(`Unknown field type '${fieldType}' for filter field '${field}'`);
        }
    }
  }
  
  return true;
}

// Process value for string operators
function processStringOperatorValue(operator, value) {
  switch (operator) {
    case 'like':
    case 'contains':
      return `%${value}%`;
    case 'startsWith':
      return `${value}%`;
    case 'endsWith':
      return `%${value}`;
    case 'icontains':
      return `%${value}%`;
    case 'null':
    case 'notnull':
      return null;
    default:
      return value;
  }
}

// Apply filter for joined fields
async function applyJoinedFieldFilter(query, field, operator, value, api) {
  const [joinField, targetField] = field.split('.');
  
  // Escape identifiers
  const escapedAlias = await api.execute('db.formatIdentifier', { identifier: joinField });
  const escapedTarget = await api.execute('db.formatIdentifier', { identifier: targetField });
  
  const processedValue = processStringOperatorValue(operator, value);
  
  switch (operator) {
    case 'in':
    case 'nin':
      if (!Array.isArray(value)) {
        throw new ValidationError()
          .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
      }
      const placeholders = value.map(() => '?').join(', ');
      query.where(`${escapedAlias}.${escapedTarget} ${OPERATORS[operator]} (${placeholders})`, ...value);
      break;
      
    case 'ilike':
    case 'icontains':
      // Case-insensitive LIKE
      const features = await api.execute('db.features', {});
      if (features.ilike) {
        query.where(`${escapedAlias}.${escapedTarget} ILIKE ?`, processedValue);
      } else {
        query.where(`LOWER(${escapedAlias}.${escapedTarget}) LIKE LOWER(?)`, processedValue);
      }
      break;
      
    case 'between':
      query.where(`${escapedAlias}.${escapedTarget} BETWEEN ? AND ?`, value[0], value[1]);
      break;
      
    case 'null':
      query.where(`${escapedAlias}.${escapedTarget} IS NULL`);
      break;
      
    case 'notnull':
      query.where(`${escapedAlias}.${escapedTarget} IS NOT NULL`);
      break;
      
    default:
      query.where(`${escapedAlias}.${escapedTarget} ${OPERATORS[operator]} ?`, processedValue);
  }
}

// Apply filter for array fields
async function applyArrayFieldFilter(query, table, field, operator, value, api) {
  const escapedTable = await api.execute('db.formatIdentifier', { identifier: table });
  const escapedField = await api.execute('db.formatIdentifier', { identifier: field });
  const features = await api.execute('db.features', {});
  
  if (operator === 'eq') {
    if (features.jsonFunctions) {
      // MySQL: Use JSON_CONTAINS
      query.where(`JSON_CONTAINS(${escapedTable}.${escapedField}, ?)`, JSON.stringify(value));
    } else {
      // AlaSQL/Others: Use LIKE with JSON string matching
      query.where(`${escapedTable}.${escapedField} LIKE ?`, `%"${value}"%`);
    }
  } else if (operator === 'in' || operator === 'nin') {
    if (operator === 'in') {
      // Array should contain at least one of the values
      if (features.jsonFunctions) {
        const conditions = value.map(() => `JSON_CONTAINS(${escapedTable}.${escapedField}, ?)`).join(' OR ');
        query.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
      } else {
        const conditions = value.map(() => `${escapedTable}.${escapedField} LIKE ?`).join(' OR ');
        query.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
      }
    } else {
      // nin - Array should not contain any of the values
      if (features.jsonFunctions) {
        const conditions = value.map(() => `NOT JSON_CONTAINS(${escapedTable}.${escapedField}, ?)`).join(' AND ');
        query.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
      } else {
        const conditions = value.map(() => `${escapedTable}.${escapedField} NOT LIKE ?`).join(' AND ');
        query.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
      }
    }
  }
}

// Consolidated filter operator function that handles all cases
async function applyFilterOperator(query, table, field, operator, value, schema, api, options = {}) {
  const { skipJoinedFields = false } = options;
  const fieldDef = schema?.structure?.[field];
  const isArrayField = fieldDef?.type === 'array';
  
  // Validate operator
  if (!OPERATORS[operator]) {
    throw new ValidationError()
      .addFieldError('filter', `Unknown operator '${operator}' for field '${field}'`);
  }
  
  // Validate filter value
  validateFilterValue(field, operator, value, schema);
  
  // Special validation for between operator
  if (operator === 'between' && (!Array.isArray(value) || value.length !== 2)) {
    throw new ValidationError()
      .addFieldError('filter', `Operator 'between' requires an array with exactly 2 values for field '${field}'`);
  }
  
  // Build the SQL condition
  if (field.includes('.')) {
    // Delegate to joined field handler
    await applyJoinedFieldFilter(query, field, operator, value, api);
  } else if (isArrayField && (operator === 'eq' || operator === 'in' || operator === 'nin')) {
    // Delegate to array field handler for array-specific operations
    await applyArrayFieldFilter(query, table, field, operator, value, api);
  } else {
    // Regular field with regular operators
    const escapedTable = await api.execute('db.formatIdentifier', { identifier: table });
    const escapedField = await api.execute('db.formatIdentifier', { identifier: field });
    const processedValue = processStringOperatorValue(operator, value);
    
    switch (operator) {
      case 'in':
      case 'nin':
        if (!Array.isArray(value)) {
          throw new ValidationError()
            .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
        }
        const placeholders = value.map(() => '?').join(', ');
        query.where(`${escapedTable}.${escapedField} ${OPERATORS[operator]} (${placeholders})`, ...value);
        break;
        
      case 'ilike':
      case 'icontains':
        // Case-insensitive LIKE
        const features = await api.execute('db.features', {});
        if (features.ilike) {
          query.where(`${escapedTable}.${escapedField} ILIKE ?`, processedValue);
        } else {
          query.where(`LOWER(${escapedTable}.${escapedField}) LIKE LOWER(?)`, processedValue);
        }
        break;
        
      case 'between':
        query.where(`${escapedTable}.${escapedField} BETWEEN ? AND ?`, value[0], value[1]);
        break;
        
      case 'null':
        query.where(`${escapedTable}.${escapedField} IS NULL`);
        break;
        
      case 'notnull':
        query.where(`${escapedTable}.${escapedField} IS NOT NULL`);
        break;
        
      default:
        query.where(`${escapedTable}.${escapedField} ${OPERATORS[operator]} ?`, processedValue);
    }
  }
}



function extractFieldNameFromDatabaseError(message) {
  // Try to extract field name from various database error messages
  const patterns = [
    /for key '([^']+)'/,
    /column '([^']+)'/,
    /field '([^']+)'/,
    /constraint failed: ([^\s]+)/
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }
  
  return 'unknown';
}