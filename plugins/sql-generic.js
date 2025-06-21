import { NotFoundError, InternalError, ConflictError, ValidationError, BadRequestError, ErrorCodes } from '../lib/errors.js';
import { QueryBuilder, schemaFields } from '../lib/query-builder.js';

// Helper to parse JSON fields in a row
function parseJsonFields(row, schema) {
  if (!row || !schema) return row;
  
  const result = { ...row };
  for (const [field, def] of Object.entries(schema.structure || schema.fields || {})) {
    if (result[field] !== null && result[field] !== undefined && 
        (def.type === 'object' || def.type === 'array')) {
      try {
        // MySQL returns JSON fields as strings
        if (typeof result[field] === 'string') {
          result[field] = JSON.parse(result[field]);
        }
      } catch (e) {
        // If parsing fails, leave as is
      }
    }
  }
  return result;
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
      const { addBatchMethods } = await import('../lib/batch.js');
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
          const idProperty = api.options.idProperty || 'id';
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
      } else {
        query.select(`${table}.*`);
      }
      
      // Apply filters from params
      if (context.params.filter) {
        if (api.options.debug) {
          console.log('Applying filters:', context.params.filter);
        }
        
        // Build set of allowed searchable fields
        const allowedFields = new Set();
        const fieldMappings = {};
        
        // 1. Add fields marked as searchable in schema (excluding virtual fields)
        const schema = api.schemas.get(context.options.type);
        if (schema) {
          for (const [field, def] of Object.entries(schema.structure)) {
            if (def.searchable === true && !def.virtual) {
              allowedFields.add(field);
            }
          }
        }
        
        // 2. Add mapped searchable fields from resource options or context options
        const resourceOptions = api.resourceOptions?.get(context.options.type) || {};
        const searchableFieldMappings = context.options.searchableFields || resourceOptions.searchableFields || {};
        for (const [friendlyName, path] of Object.entries(searchableFieldMappings)) {
          allowedFields.add(friendlyName);
          fieldMappings[friendlyName] = path;
        }
        
        if (api.options.debug) {
          console.log('Allowed searchable fields:', Array.from(allowedFields));
          console.log('Field mappings:', fieldMappings);
        }
        
        for (const [field, value] of Object.entries(context.params.filter)) {
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
          
          // Check if value is an object with operators
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Handle operator syntax: { gt: 100, lt: 200 }
            for (const [operator, operatorValue] of Object.entries(value)) {
              await applyAdvancedFilterOperator(query, table, actualPath, operator, operatorValue, schema, api);
            }
          } else {
            // Handle simple equality check
            await applyAdvancedFilterOperator(query, table, actualPath, 'eq', value, schema, api);
          }
        }
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
                  
                  // Don't double-escape identifiers - just use the raw names
                  context.query.leftJoin(
                    `${joinTable} AS ${joinAlias}`,
                    `${joinAlias}.${idProperty} = ${table}.${joinField}`
                  );
                }
                
                // Sort by the joined field
                context.query.orderBy(`${joinAlias}.${targetField}`, direction);
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
        const needsJoins = schema && options.joins !== false && hasEagerJoins(schema, options);
        
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
          
          return rows[0] ? parseJsonFields(rows[0], schema) : null;
        } else {
          // Simple get without joins
          const escapeId = await api.execute('db.formatIdentifier', { identifier: idProperty });
          const escapeTable = await api.execute('db.formatIdentifier', { identifier: table });
          const sql = `SELECT * FROM ${escapeTable} WHERE ${escapeId} = ?`;
          
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
          const rows = result.rows;

          if (!rows[0] && !options.allowNotFound) {
            throw new NotFoundError(options.type || table, id);
          }

          const schema = api.schemas?.get(options.type);
          return rows[0] ? parseJsonFields(rows[0], schema) : null;
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
              return api.implement('get')(context);
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
          const allowedFields = new Set();
          const fieldMappings = {};
          
          if (schema) {
            for (const [field, def] of Object.entries(schema.structure)) {
              if (def.searchable === true && !def.virtual) {
                allowedFields.add(field);
              }
            }
          }
          
          const resourceOptions = api.resourceOptions?.get(options.type) || {};
          const searchableFieldMappings = options.searchableFields || resourceOptions.searchableFields || {};
          for (const [friendlyName, path] of Object.entries(searchableFieldMappings)) {
            allowedFields.add(friendlyName);
            fieldMappings[friendlyName] = path;
          }
          
          for (const [field, value] of Object.entries(params.filter)) {
            if (!allowedFields.has(field)) {
              throw new ValidationError()
                .addFieldError('filter', `Field '${field}' is not searchable`);
            }
            
            const actualPath = fieldMappings[field] || field;
            if (actualPath.includes('.')) {
              // Skip joined field filters for count query
              continue;
            } else {
              // Check if value is an object with operators
              if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Handle operator syntax: { gt: 100, lt: 200 }
                for (const [operator, operatorValue] of Object.entries(value)) {
                  await applyCountFilterOperator(countQuery, table, actualPath, operator, operatorValue, schema, api);
                }
              } else {
                // Handle simple equality check
                await applyCountFilterOperator(countQuery, table, actualPath, 'eq', value, schema, api);
              }
            }
          }
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
          context.results = rows.map(row => parseJsonFields(row, schema));
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
        const values = fields.map(f => {
          const value = cleanData[f];
          // Convert objects/arrays to JSON strings for storage
          if (schema?.structure[f] && (schema.structure[f].type === 'object' || schema.structure[f].type === 'array')) {
            return JSON.stringify(value);
          }
          return value;
        });
        
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
          const field = extractFieldFromError(error.message);
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
        
        const values = fields.map(f => {
          const value = cleanData[f];
          // Convert objects/arrays to JSON strings
          if (schema?.structure[f] && (schema.structure[f].type === 'object' || schema.structure[f].type === 'array')) {
            return JSON.stringify(value);
          }
          return value;
        });
        
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
          const field = extractFieldFromError(error.message);
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

function hasEagerJoins(schema, options) {
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

async function applyAdvancedFilterOperator(query, table, field, operator, value, schema, api) {
  const fieldDef = schema?.structure?.[field];
  const isArrayField = fieldDef?.type === 'array';
  
  // Validate operator
  if (!OPERATORS[operator]) {
    throw new ValidationError()
      .addFieldError('filter', `Unknown operator '${operator}' for field '${field}'`);
  }
  
  // Handle special cases for string operators
  let processedValue = value;
  if (operator === 'like' || operator === 'contains') {
    processedValue = `%${value}%`;
  } else if (operator === 'startsWith') {
    processedValue = `${value}%`;
  } else if (operator === 'endsWith') {
    processedValue = `%${value}`;
  } else if (operator === 'icontains') {
    processedValue = `%${value}%`;
  } else if (operator === 'between') {
    // Validate between operator has array with 2 values
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ValidationError()
        .addFieldError('filter', `Operator 'between' requires an array with exactly 2 values for field '${field}'`);
    }
  } else if (operator === 'null' || operator === 'notnull') {
    // For null checks, we ignore the value and use NULL
    processedValue = null;
  }
  
  // Build the SQL condition
  if (field.includes('.')) {
    // Joined field
    const [joinField, targetField] = field.split('.');
    
    // Escape identifiers
    const escapedAlias = await api.execute('db.formatIdentifier', { identifier: joinField });
    const escapedTarget = await api.execute('db.formatIdentifier', { identifier: targetField });
    
    if (operator === 'in' || operator === 'nin') {
      if (!Array.isArray(value)) {
        throw new ValidationError()
          .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
      }
      const placeholders = value.map(() => '?').join(', ');
      query.where(`${escapedAlias}.${escapedTarget} ${OPERATORS[operator]} (${placeholders})`, ...value);
    } else if (operator === 'ilike' || operator === 'icontains') {
      // Case-insensitive LIKE
      const features = await api.execute('db.features', {});
      if (features.ilike) {
        query.where(`${escapedAlias}.${escapedTarget} ILIKE ?`, processedValue);
      } else {
        query.where(`LOWER(${escapedAlias}.${escapedTarget}) LIKE LOWER(?)`, processedValue);
      }
    } else if (operator === 'between') {
      // BETWEEN requires two values
      query.where(`${escapedAlias}.${escapedTarget} BETWEEN ? AND ?`, value[0], value[1]);
    } else if (operator === 'null') {
      // IS NULL
      query.where(`${escapedAlias}.${escapedTarget} IS NULL`);
    } else if (operator === 'notnull') {
      // IS NOT NULL
      query.where(`${escapedAlias}.${escapedTarget} IS NOT NULL`);
    } else {
      query.where(`${escapedAlias}.${escapedTarget} ${OPERATORS[operator]} ?`, processedValue);
    }
  } else {
    // Regular field
    const escapedTable = await api.execute('db.formatIdentifier', { identifier: table });
    const escapedField = await api.execute('db.formatIdentifier', { identifier: field });
    
    if (isArrayField && operator === 'eq') {
      // Special handling for array fields with equality
      const features = await api.execute('db.features', {});
      
      if (features.jsonFunctions) {
        // MySQL: Use JSON_CONTAINS
        query.where(`JSON_CONTAINS(${escapedTable}.${escapedField}, ?)`, JSON.stringify(value));
      } else {
        // AlaSQL/Others: Use LIKE with JSON string matching
        query.where(`${escapedTable}.${escapedField} LIKE ?`, `%"${value}"%`);
      }
    } else if (operator === 'in' || operator === 'nin') {
      if (!Array.isArray(value)) {
        throw new ValidationError()
          .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
      }
      
      if (isArrayField) {
        // For array fields with IN operator, check if array contains any of the values
        const features = await api.execute('db.features', {});
        
        if (operator === 'in') {
          // Array should contain at least one of the values
          if (features.jsonFunctions) {
            // MySQL: Use JSON_CONTAINS with OR
            const conditions = value.map(() => `JSON_CONTAINS(${escapedTable}.${escapedField}, ?)`).join(' OR ');
            query.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
          } else {
            // AlaSQL: Use LIKE with OR
            const conditions = value.map(() => `${escapedTable}.${escapedField} LIKE ?`).join(' OR ');
            query.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
          }
        } else {
          // nin - Array should not contain any of the values
          if (features.jsonFunctions) {
            // MySQL: Use NOT JSON_CONTAINS with AND
            const conditions = value.map(() => `NOT JSON_CONTAINS(${escapedTable}.${escapedField}, ?)`).join(' AND ');
            query.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
          } else {
            // AlaSQL: Use NOT LIKE with AND
            const conditions = value.map(() => `${escapedTable}.${escapedField} NOT LIKE ?`).join(' AND ');
            query.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
          }
        }
      } else {
        // Regular field IN/NIN
        const placeholders = value.map(() => '?').join(', ');
        query.where(`${escapedTable}.${escapedField} ${OPERATORS[operator]} (${placeholders})`, ...value);
      }
    } else if (operator === 'ilike' || operator === 'icontains') {
      // Case-insensitive LIKE
      const features = await api.execute('db.features', {});
      if (features.ilike) {
        query.where(`${escapedTable}.${escapedField} ILIKE ?`, processedValue);
      } else {
        query.where(`LOWER(${escapedTable}.${escapedField}) LIKE LOWER(?)`, processedValue);
      }
    } else if (operator === 'between') {
      // BETWEEN requires two values
      query.where(`${escapedTable}.${escapedField} BETWEEN ? AND ?`, value[0], value[1]);
    } else if (operator === 'null') {
      // IS NULL
      query.where(`${escapedTable}.${escapedField} IS NULL`);
    } else if (operator === 'notnull') {
      // IS NOT NULL
      query.where(`${escapedTable}.${escapedField} IS NOT NULL`);
    } else {
      query.where(`${escapedTable}.${escapedField} ${OPERATORS[operator]} ?`, processedValue);
    }
  }
}

async function applyCountFilterOperator(countQuery, table, field, operator, value, schema, api) {
  const fieldDef = schema?.structure?.[field];
  const isArrayField = fieldDef?.type === 'array';
  
  // Validate operator
  if (!OPERATORS[operator]) {
    throw new ValidationError()
      .addFieldError('filter', `Unknown operator '${operator}' for field '${field}'`);
  }
  
  // Handle special cases for string operators
  let processedValue = value;
  if (operator === 'like' || operator === 'contains') {
    processedValue = `%${value}%`;
  } else if (operator === 'startsWith') {
    processedValue = `${value}%`;
  } else if (operator === 'endsWith') {
    processedValue = `%${value}`;
  } else if (operator === 'icontains') {
    processedValue = `%${value}%`;
  } else if (operator === 'between') {
    // Validate between operator has array with 2 values
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ValidationError()
        .addFieldError('filter', `Operator 'between' requires an array with exactly 2 values for field '${field}'`);
    }
  } else if (operator === 'null' || operator === 'notnull') {
    // For null checks, we ignore the value and use NULL
    processedValue = null;
  }
  
  // Regular field (no joined fields in count query)
  if (isArrayField && operator === 'eq') {
    // Special handling for array fields with equality
    const features = await api.execute('db.features', {});
    
    if (features.jsonFunctions) {
      // MySQL: Use JSON_CONTAINS
      countQuery.where(`JSON_CONTAINS(${table}.${field}, ?)`, JSON.stringify(value));
    } else {
      // AlaSQL/Others: Use LIKE with JSON string matching
      countQuery.where(`${table}.${field} LIKE ?`, `%"${value}"%`);
    }
  } else if (operator === 'in' || operator === 'nin') {
    if (!Array.isArray(value)) {
      throw new ValidationError()
        .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
    }
    
    if (isArrayField) {
      // For array fields with IN operator, check if array contains any of the values
      const features = await api.execute('db.features', {});
      
      if (operator === 'in') {
        // Array should contain at least one of the values
        if (features.jsonFunctions) {
          // MySQL: Use JSON_CONTAINS with OR
          const conditions = value.map(() => `JSON_CONTAINS(${table}.${field}, ?)`).join(' OR ');
          countQuery.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
        } else {
          // AlaSQL: Use LIKE with OR
          const conditions = value.map(() => `${table}.${field} LIKE ?`).join(' OR ');
          countQuery.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
        }
      } else {
        // nin - Array should not contain any of the values
        if (features.jsonFunctions) {
          // MySQL: Use NOT JSON_CONTAINS with AND
          const conditions = value.map(() => `NOT JSON_CONTAINS(${table}.${field}, ?)`).join(' AND ');
          countQuery.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
        } else {
          // AlaSQL: Use NOT LIKE with AND
          const conditions = value.map(() => `${table}.${field} NOT LIKE ?`).join(' AND ');
          countQuery.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
        }
      }
    } else {
      // Regular field IN/NIN  
      const placeholders = value.map(() => '?').join(', ');
      countQuery.where(`${table}.${field} ${OPERATORS[operator]} (${placeholders})`, ...value);
    }
  } else if (operator === 'ilike' || operator === 'icontains') {
    // Case-insensitive LIKE
    const features = await api.execute('db.features', {});
    if (features.ilike) {
      countQuery.where(`${table}.${field} ILIKE ?`, processedValue);
    } else {
      countQuery.where(`LOWER(${table}.${field}) LIKE LOWER(?)`, processedValue);
    }
  } else if (operator === 'between') {
    // BETWEEN requires two values
    countQuery.where(`${table}.${field} BETWEEN ? AND ?`, value[0], value[1]);
  } else if (operator === 'null') {
    // IS NULL
    countQuery.where(`${table}.${field} IS NULL`);
  } else if (operator === 'notnull') {
    // IS NOT NULL
    countQuery.where(`${table}.${field} IS NOT NULL`);
  } else {
    countQuery.where(`${table}.${field} ${OPERATORS[operator]} ?`, processedValue);
  }
}

async function applyFilterOperator(query, table, field, operator, value, schema, api) {
  const fieldDef = schema?.structure?.[field];
  const isArrayField = fieldDef?.type === 'array';
  
  // Validate operator
  if (!OPERATORS[operator]) {
    throw new ValidationError()
      .addFieldError('filter', `Unknown operator '${operator}' for field '${field}'`);
  }
  
  // Handle special cases for string operators
  let processedValue = value;
  if (operator === 'like' || operator === 'contains') {
    processedValue = `%${value}%`;
  } else if (operator === 'startsWith') {
    processedValue = `${value}%`;
  } else if (operator === 'endsWith') {
    processedValue = `%${value}`;
  } else if (operator === 'icontains') {
    processedValue = `%${value}%`;
  } else if (operator === 'between') {
    // Validate between operator has array with 2 values
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ValidationError()
        .addFieldError('filter', `Operator 'between' requires an array with exactly 2 values for field '${field}'`);
    }
  } else if (operator === 'null' || operator === 'notnull') {
    // For null checks, we ignore the value and use NULL
    processedValue = null;
  }
  
  // Build the SQL condition
  let condition;
  if (field.includes('.')) {
    // Joined field
    const escapedField = `\`${field.replace('.', '`.`')}\``;
    
    if (operator === 'in' || operator === 'nin') {
      if (!Array.isArray(value)) {
        throw new ValidationError()
          .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
      }
      const placeholders = value.map(() => '?').join(', ');
      condition = `${escapedField} ${OPERATORS[operator]} (${placeholders})`;
      query.where(condition, ...value);
    } else if (operator === 'ilike' || operator === 'icontains') {
      // Case-insensitive LIKE for joined fields
      const features = await api.execute('db.features', {});
      if (features.ilike) {
        query.where(`${escapedField} ILIKE ?`, processedValue);
      } else {
        query.where(`LOWER(${escapedField}) LIKE LOWER(?)`, processedValue);
      }
    } else if (operator === 'between') {
      // BETWEEN requires two values
      query.where(`${escapedField} BETWEEN ? AND ?`, value[0], value[1]);
    } else if (operator === 'null') {
      // IS NULL
      query.where(`${escapedField} IS NULL`);
    } else if (operator === 'notnull') {
      // IS NOT NULL
      query.where(`${escapedField} IS NOT NULL`);
    } else {
      condition = `${escapedField} ${OPERATORS[operator]} ?`;
      query.where(condition, processedValue);
    }
  } else {
    // Regular field
    const escapedField = `\`${table}\`.\`${field}\``;
    
    if (isArrayField && operator === 'eq') {
      // Special handling for array fields with equality
      const features = await api.execute('db.features', {});
      
      if (features.jsonFunctions) {
        // MySQL: Use JSON_CONTAINS
        query.where(`JSON_CONTAINS(${escapedField}, ?)`, JSON.stringify(value));
      } else {
        // AlaSQL/Others: Use LIKE with JSON string matching
        query.where(`${escapedField} LIKE ?`, `%"${value}"%`);
      }
    } else if (operator === 'in' || operator === 'nin') {
      if (!Array.isArray(value)) {
        throw new ValidationError()
          .addFieldError('filter', `Operator '${operator}' requires an array value for field '${field}'`);
      }
      
      if (isArrayField) {
        // For array fields with IN operator, check if array contains any of the values
        const features = await api.execute('db.features', {});
        
        if (operator === 'in') {
          // Array should contain at least one of the values
          if (features.jsonFunctions) {
            // MySQL: Use JSON_CONTAINS with OR
            const conditions = value.map(() => `JSON_CONTAINS(${escapedField}, ?)`).join(' OR ');
            query.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
          } else {
            // AlaSQL: Use LIKE with OR
            const conditions = value.map(() => `${escapedField} LIKE ?`).join(' OR ');
            query.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
          }
        } else {
          // nin - Array should not contain any of the values
          if (features.jsonFunctions) {
            // MySQL: Use NOT JSON_CONTAINS with AND
            const conditions = value.map(() => `NOT JSON_CONTAINS(${escapedField}, ?)`).join(' AND ');
            query.where(`(${conditions})`, ...value.map(v => JSON.stringify(v)));
          } else {
            // AlaSQL: Use NOT LIKE with AND
            const conditions = value.map(() => `${escapedField} NOT LIKE ?`).join(' AND ');
            query.where(`(${conditions})`, ...value.map(v => `%"${v}"%`));
          }
        }
      } else {
        // Regular field IN/NIN
        const placeholders = value.map(() => '?').join(', ');
        condition = `${escapedField} ${OPERATORS[operator]} (${placeholders})`;
        query.where(condition, ...value);
      }
    } else if (operator === 'ilike' || operator === 'icontains') {
      // Case-insensitive LIKE - use LOWER for databases that don't support ILIKE
      const features = await api.execute('db.features', {});
      if (features.ilike) {
        query.where(`${escapedField} ILIKE ?`, processedValue);
      } else {
        query.where(`LOWER(${escapedField}) LIKE LOWER(?)`, processedValue);
      }
    } else if (operator === 'between') {
      // BETWEEN requires two values
      query.where(`${escapedField} BETWEEN ? AND ?`, value[0], value[1]);
    } else if (operator === 'null') {
      // IS NULL
      query.where(`${escapedField} IS NULL`);
    } else if (operator === 'notnull') {
      // IS NOT NULL
      query.where(`${escapedField} IS NOT NULL`);
    } else {
      condition = `${escapedField} ${OPERATORS[operator]} ?`;
      query.where(condition, processedValue);
    }
  }
}


function extractFieldFromError(message) {
  // Try to extract field name from various error formats
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