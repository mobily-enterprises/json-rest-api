import mysql from 'mysql2/promise';
import { NotFoundError, InternalError, ConflictError, BadRequestError, ValidationError, ErrorCodes } from '../lib/errors.js';
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

/**
 * MySQL storage plugin with query builder pattern
 * 
 * This implementation prioritizes clarity and maintainability.
 * Each method has a clear purpose and the query building process
 * is explicit and debuggable.
 */
export const MySQLPlugin = {
  install(api, options = {}) {
    // Initialize connection pools
    api.mysqlPools = new Map();
    
    // Create connection pools
    if (options.connections) {
      for (const conn of options.connections) {
        const pool = mysql.createPool(conn.config);
        api.mysqlPools.set(conn.name || 'default', {
          pool,
          options: conn.options || {}
        });
      }
    } else if (options.connection) {
      const pool = mysql.createPool(options.connection);
      api.mysqlPools.set('default', { pool, options: {} });
    }

    // Helper to get connection
    api.getConnection = (connectionName = 'default') => {
      const conn = api.mysqlPools.get(connectionName);
      if (!conn) {
        throw new InternalError(`Database connection '${connectionName}' not found`)
          .withContext({ connectionName });
      }
      return conn;
    };

    /**
     * Hook: Initialize query builder
     * This runs FIRST and sets up the basic query
     */
    api.hook('initializeQuery', async (context) => {
      // Run for both query and get operations when joins are needed
      if (context.method !== 'query' && context.method !== 'get') return;
      if (context.method === 'get' && !context.query) return; // Skip if get isn't using query builder
      
      const table = context.options.table || context.options.type;
      const schema = api.schemas.get(context.options.type);
      
      // Create query builder with default fields and API reference
      const query = new QueryBuilder(table, api);
      
      // Add schema fields by default (excluding silent ones)
      if (schema) {
        const fields = schemaFields(schema, table);
        query.select(...fields);
        
        // Handle advanced refs with join configuration
        const requestedJoins = determineRequestedJoins(schema, context.params || context.options);
        
        // Check for nested joins in the original join list
        let nestedJoinPaths = [];
        if (Array.isArray(context.params?.joins || context.options?.joins)) {
          nestedJoinPaths = (context.params?.joins || context.options?.joins)
            .filter(path => path.includes('.'));
        }
        
        // Parse and validate nested join paths if any
        let joinsByResource = new Map();
        if (nestedJoinPaths.length > 0) {
          try {
            joinsByResource = parseNestedJoinPaths(api, context.options.type, nestedJoinPaths);
          } catch (error) {
            // Re-throw with context
            throw error.withContext({ 
              type: context.options.type,
              requestedJoins: nestedJoinPaths 
            });
          }
        }
        
        if (requestedJoins.size > 0 || joinsByResource.size > 0) {
          // Initialize join metadata storage
          context.joinFields = {};
          context.nestedJoins = joinsByResource; // Store for nested processing
          
          // Process first-level joins
          for (const fieldName of requestedJoins) {
            const fieldDef = schema.structure[fieldName];
            if (!fieldDef?.refs?.join) continue;
            
            const refs = fieldDef.refs;
            const joinConfig = refs.join;
            
            // Add the join
            const joinType = joinConfig.type || 'left';
            query[joinType + 'Join'](fieldName);
            
            // Get the join info to see if we used an alias
            const lastJoin = query.parts.joins[query.parts.joins.length - 1];
            const tableRef = lastJoin.alias || refs.resource;
            
            // Determine which fields to select
            const relatedSchema = api.schemas.get(refs.resource);
            let fields;
            
            if (joinConfig.fields) {
              fields = joinConfig.fields;
            } else if (joinConfig.excludeFields) {
              fields = Object.keys(relatedSchema.structure)
                .filter(f => !joinConfig.excludeFields.includes(f))
                .filter(f => joinConfig.includeSilent || !relatedSchema.structure[f].silent);
            } else {
              // Default: all non-silent fields
              fields = Object.keys(relatedSchema.structure)
                .filter(f => !relatedSchema.structure[f].silent);
            }
            
            // Store metadata for result processing
            context.joinFields[fieldName] = {
              resource: refs.resource,
              fields: fields,
              runHooks: joinConfig.runHooks !== false,
              hookContext: joinConfig.hookContext || 'join',
              resourceField: joinConfig.resourceField,
              preserveId: joinConfig.preserveId,
              nestedJoins: {} // Will be populated for nested joins
            };
            
            // Select fields with special prefix for grouping
            fields.forEach(field => {
              query.select(`${tableRef}.${field} as __${fieldName}__${field}`);
            });
            
            // Process nested joins for this resource if any
            if (joinsByResource.has(refs.resource)) {
              const nestedFields = joinsByResource.get(refs.resource);
              
              for (const nestedFieldName of nestedFields) {
                const nestedSchema = api.schemas.get(refs.resource);
                const nestedFieldDef = nestedSchema.structure[nestedFieldName];
                
                if (!nestedFieldDef?.refs?.join) continue;
                
                const nestedRefs = nestedFieldDef.refs;
                const nestedJoinConfig = nestedFieldDef.refs.join;
                
                // Add the nested join with table alias to avoid conflicts
                const nestedJoinType = nestedJoinConfig.type || 'left';
                const tableAlias = `${fieldName}_${nestedFieldName}`;
                
                query[nestedJoinType + 'Join'](
                  `${nestedRefs.resource} AS ${tableAlias}`,
                  `${tableAlias}.id = ${tableRef}.${nestedFieldName}`
                );
                
                // Determine fields for nested join
                const nestedRelatedSchema = api.schemas.get(nestedRefs.resource);
                let nestedFields;
                
                if (nestedJoinConfig.fields) {
                  nestedFields = nestedJoinConfig.fields;
                } else if (nestedJoinConfig.excludeFields) {
                  nestedFields = Object.keys(nestedRelatedSchema.structure)
                    .filter(f => !nestedJoinConfig.excludeFields.includes(f))
                    .filter(f => nestedJoinConfig.includeSilent || !nestedRelatedSchema.structure[f].silent);
                } else {
                  nestedFields = Object.keys(nestedRelatedSchema.structure)
                    .filter(f => !nestedRelatedSchema.structure[f].silent);
                }
                
                // Store nested join metadata
                context.joinFields[fieldName].nestedJoins[nestedFieldName] = {
                  resource: nestedRefs.resource,
                  fields: nestedFields,
                  runHooks: nestedJoinConfig.runHooks !== false,
                  hookContext: nestedJoinConfig.hookContext || 'join',
                  resourceField: nestedJoinConfig.resourceField,
                  preserveId: nestedJoinConfig.preserveId,
                  tableAlias: tableAlias
                };
                
                // Select nested fields with double prefix
                nestedFields.forEach(field => {
                  query.select(
                    `${tableAlias}.${field} as __${fieldName}__${nestedFieldName}__${field}`
                  );
                });
              }
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
        
        // Get searchable fields from options if provided
        const searchableFields = context.options.searchableFields || [];
        
        for (const [field, value] of Object.entries(context.params.filter)) {
          // Check if field contains dot notation (e.g., 'puppyId.name')
          if (field.includes('.')) {
            // Validate against searchableFields if provided
            if (searchableFields.length > 0 && !searchableFields.includes(field)) {
              if (api.options.debug) {
                console.log(`Skipping non-searchable field: ${field}`);
              }
              continue;
            }
            
            const [joinField, targetField] = field.split('.');
            const schema = api.schemas.get(context.options.type);
            const fieldDef = schema?.structure?.[joinField];
            
            // Validate that this is a valid ref field
            if (!fieldDef?.refs?.resource) {
              throw new ValidationError()
                .addFieldError('filter', `Invalid filter field: ${field} - ${joinField} is not a reference field`);
            }
            
            // Check if join already exists
            const existingJoin = query.parts.joins.find(j => j.field === joinField);
            if (!existingJoin) {
              // Add the join if it doesn't exist
              query.leftJoin(joinField);
            }
            
            // Get the joined table name (handle aliases)
            const joinedTable = existingJoin?.alias || fieldDef.refs.resource;
            
            // Apply the filter on the joined table
            if (value === null) {
              query.where(`${joinedTable}.${targetField} IS NULL`);
            } else if (typeof value === 'object' && value.operator) {
              applyOperator(query, joinedTable, targetField, value.operator, value.value);
            } else {
              query.where(`${joinedTable}.${targetField} = ?`, value);
            }
          } else {
            // Regular field on main table
            if (searchableFields.length > 0 && !searchableFields.includes(field)) {
              if (api.options.debug) {
                console.log(`Skipping non-searchable field: ${field}`);
              }
              continue;
            }
            
            if (value === null) {
              query.where(`${table}.${field} IS NULL`);
            } else if (typeof value === 'object' && value.operator) {
              // Support for operators: { operator: '$like', value: '%john%' }
              applyOperator(query, table, field, value.operator, value.value);
            } else {
              query.where(`${table}.${field} = ?`, value);
            }
          }
        }
      }
      
      // Apply sorting
      if (context.params.sort) {
        for (const sortItem of context.params.sort) {
          query.orderBy(`${table}.${sortItem.field}`, sortItem.direction);
        }
      }
      
      // Apply pagination
      const pageSize = Number(context.params.page?.size) || 10;
      const pageNumber = Number(context.params.page?.number) || 1;
      query.limit(pageSize, (pageNumber - 1) * pageSize);
      
      // Store query builder in context
      context.query = query;
    }, 10); // Run early

    /**
     * Hook: Modify query
     * This is where resource-specific modifications happen
     */
    api.hook('modifyQuery', async (context) => {
      // This hook is for user modifications
      // They can access context.query and modify it
    }, 50); // Normal priority

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
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      try {
        // Check if we need to use query builder for joins
        const schema = api.schemas?.get(options.type);
        const needsJoins = schema && options.joins !== false && hasEagerJoins(schema, options);
        
        if (needsJoins) {
          // Use query builder for complex get with joins
          const query = new QueryBuilder(table, api);
          
          // Set up base query
          query.where(`${table}.${idProperty} = ?`, id);
          
          // Create a context for hooks
          const queryContext = {
            ...context,
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
          if (queryContext.nestedJoins) {
            context.nestedJoins = queryContext.nestedJoins;
          }
          
          // Execute query
          const sql = queryContext.query.toSQL();
          const args = queryContext.query.getArgs();
          
          if (api.options.debug) {
            console.log('Query SQL:', sql);
            console.log('Query Args:', args);
          }
          
          const [rows] = await pool.query(sql, args);
          
          if (!rows[0] && !options.allowNotFound) {
            throw new NotFoundError(options.type || table, id);
          }
          
          const schema = api.schemas?.get(options.type);
          return rows[0] ? parseJsonFields(rows[0], schema) : null;
        } else {
          // Simple get without joins
          const [rows] = await pool.query(
            `SELECT * FROM ?? WHERE ?? = ?`,
            [table, idProperty, id]
          );

          if (!rows[0] && !options.allowNotFound) {
            throw new NotFoundError(options.type || table, id);
          }
          
          const schema = api.schemas?.get(options.type);
          return rows[0] ? parseJsonFields(rows[0], schema) : null;
        }
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new InternalError('Database query failed')
          .withContext({ 
            code: ErrorCodes.DATABASE_ERROR,
            originalError: error.message 
          });
      }
    });

    api.implement('query', async (context) => {
      const { options } = context;
      const { pool } = api.getConnection(options.connection);
      
      // Run initialization hooks
      await api.executeHook('initializeQuery', context);
      await api.executeHook('modifyQuery', context);
      await api.executeHook('finalizeQuery', context);
      
      if (!context.query) {
        throw new InternalError('Query builder not initialized');
      }
      
      try {
        // Build SQL queries
        const sql = context.query.toSQL();
        const countSql = context.query.toCountSQL();
        const args = context.query.getArgs();
        
        // Log queries in debug mode
        if (api.options.debug) {
          console.log('Query SQL:', sql);
          console.log('Query Args:', args);
        }
        
        // Execute queries in parallel
        const [
          [rows],
          [countResult]
        ] = await Promise.all([
          pool.query(sql, args),
          pool.query(countSql, args)
        ]);
        
        const total = countResult[0]?.total || 0;
        const pageSize = context.query.parts.limit || 10;
        const pageNumber = Math.floor((context.query.parts.offset || 0) / pageSize) + 1;
        
        // Parse JSON fields in results
        const schema = api.schemas?.get(options.type);
        const parsedRows = rows.map(row => parseJsonFields(row, schema));
        
        return {
          results: parsedRows,
          meta: {
            total,
            pageSize,
            pageNumber,
            totalPages: Math.ceil(total / pageSize)
          }
        };
      } catch (error) {
        throw new InternalError('Database query failed')
          .withContext({ 
            code: ErrorCodes.DATABASE_ERROR,
            sql: context.query.toSQL(),
            originalError: error.message 
          });
      }
    });

    api.implement('insert', async (context) => {
      const { data, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      try {
        // Remove undefined values and handle JSON types
        const cleanData = {};
        const schema = api.schemas?.get(options.type);
        
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) {
            // Check if this field is a JSON type in the schema
            const fieldDef = schema?.structure?.[key] || schema?.fields?.[key];
            if (fieldDef && (fieldDef.type === 'object' || fieldDef.type === 'array')) {
              // Stringify JSON fields
              cleanData[key] = JSON.stringify(value);
            } else {
              cleanData[key] = value;
            }
          }
        }

        // Build INSERT query manually to handle JSON fields properly
        const fields = Object.keys(cleanData);
        const values = Object.values(cleanData);
        const placeholders = fields.map(() => '?').join(', ');
        const fieldList = fields.map(f => `\`${f}\``).join(', ');
        
        if (api.options.debug) {
          console.log('INSERT SQL:', `INSERT INTO \`${table}\` (${fieldList}) VALUES (${placeholders})`);
          console.log('INSERT Values:', values);
          console.log('CleanData:', cleanData);
          console.log('Schema:', schema);
        }
        
        const [result] = await pool.query(
          `INSERT INTO \`${table}\` (${fieldList}) VALUES (${placeholders})`,
          values
        );

        // Return the inserted record with the generated ID
        const insertedData = { ...data }; // Use original data, not stringified
        if (result.insertId) {
          insertedData[idProperty] = result.insertId;
        }

        return insertedData;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          throw new ConflictError('Duplicate entry')
            .withContext({ 
              code: ErrorCodes.DUPLICATE_RESOURCE,
              originalError: error.message 
            });
        }
        throw new InternalError('Database insert failed')
          .withContext({ 
            code: ErrorCodes.DATABASE_ERROR,
            originalError: error.message 
          });
      }
    });

    api.implement('update', async (context) => {
      const { id, data, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      try {
        // Build update query
        const query = new QueryBuilder(table, api);
        query.where(`${idProperty} = ?`, id);
        
        // Allow hooks to modify update conditions
        context.updateQuery = query;
        await api.executeHook('modifyUpdateQuery', context);
        
        // Remove undefined values and id from update data, handle JSON types
        const updateData = {};
        const schema = api.schemas?.get(options.type);
        
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && key !== idProperty) {
            // Check if this field is a JSON type in the schema
            const fieldDef = schema?.structure?.[key] || schema?.fields?.[key];
            if (fieldDef && (fieldDef.type === 'object' || fieldDef.type === 'array')) {
              // Stringify JSON fields
              updateData[key] = JSON.stringify(value);
            } else {
              updateData[key] = value;
            }
          }
        }

        // Build UPDATE query manually to handle JSON fields properly
        const setClause = Object.keys(updateData)
          .map(field => `\`${field}\` = ?`)
          .join(', ');
        const values = Object.values(updateData);
        
        // Build WHERE clause from query builder
        const whereConditions = context.updateQuery.parts.where
          .map(w => w.sql)
          .join(' AND ');
        const whereArgs = context.updateQuery.getArgs();

        const [result] = await pool.query(
          `UPDATE \`${table}\` SET ${setClause} WHERE ${whereConditions}`,
          [...values, ...whereArgs]
        );

        if (result.affectedRows === 0) {
          throw new NotFoundError(options.type || table, id);
        }

        // Return updated data (id + original data, not stringified)
        return { [idProperty]: id, ...data };
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new InternalError('Database update failed')
          .withContext({ 
            code: ErrorCodes.DATABASE_ERROR,
            originalError: error.message 
          });
      }
    });

    api.implement('delete', async (context) => {
      const { id, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      try {
        // Build delete query
        const query = new QueryBuilder(table, api);
        query.where(`${idProperty} = ?`, id);
        
        // Allow hooks to modify delete conditions
        context.deleteQuery = query;
        await api.executeHook('modifyDeleteQuery', context);
        
        // Build WHERE clause from query builder
        const whereConditions = context.deleteQuery.parts.where
          .map(w => w.sql)
          .join(' AND ');
        const whereArgs = context.deleteQuery.getArgs();

        const [result] = await pool.query(
          `DELETE FROM ?? WHERE ${whereConditions}`,
          [table, ...whereArgs]
        );

        if (result.affectedRows === 0) {
          throw new NotFoundError(options.type || table, id);
        }
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new InternalError('Database delete failed')
          .withContext({ 
            code: ErrorCodes.DATABASE_ERROR,
            originalError: error.message 
          });
      }
    });

    // Implement bulk position shifting
    api.implement('shiftPositions', async (context) => {
      const { type, field, from, delta, filter, excludeIds } = context.options;
      const table = type;
      const { pool } = api.getConnection('default');
      
      try {
        // Build WHERE clause
        const whereParts = [`\`${field}\` >= ?`];
        const whereValues = [from];
        
        // Add filter conditions
        if (filter && Object.keys(filter).length > 0) {
          for (const [key, value] of Object.entries(filter)) {
            whereParts.push(`\`${key}\` = ?`);
            whereValues.push(value);
          }
        }
        
        // Add exclusion for specific IDs
        if (excludeIds && excludeIds.length > 0) {
          const placeholders = excludeIds.map(() => '?').join(', ');
          whereParts.push(`id NOT IN (${placeholders})`);
          whereValues.push(...excludeIds);
        }
        
        const whereClause = whereParts.join(' AND ');
        
        // Execute bulk update
        const [result] = await pool.query(
          `UPDATE \`${table}\` SET \`${field}\` = \`${field}\` + ? WHERE ${whereClause}`,
          [delta, ...whereValues]
        );
        
        return { shiftedCount: result.affectedRows };
      } catch (error) {
        throw new InternalError('Bulk position shift failed')
          .withContext({
            code: ErrorCodes.DATABASE_ERROR,
            originalError: error.message
          });
      }
    });

    // Add schema sync functionality
    api.syncDatabase = async () => {
      console.log('Starting database synchronization...');
      
      // Get all resources from the schemas map
      if (!api.schemas || api.schemas.size === 0) {
        console.log('No resources to sync');
        return;
      }
      
      for (const [resourceName, schema] of api.schemas) {
        const table = resourceName; // Table name defaults to resource name
        const connectionName = 'default';
        const { pool } = api.getConnection(connectionName);
        
        console.log(`Syncing table '${table}' for resource '${resourceName}'...`);
        
        try {
          await syncMySQLSchema(pool, schema, table, {
            idProperty: api.options.idProperty || 'id',
            positionField: api.options.positionField,
            dbExtraIndexes: api.options.dbExtraIndexes || [],
            stores: api._resourceProxies, // Use the internal map
            ...api.options
          });
          console.log(`✓ Table '${table}' synced successfully`);
        } catch (error) {
          console.error(`✗ Failed to sync table '${table}':`, error.message);
          throw error;
        }
      }
      
      console.log('Database synchronization complete!');
    };

    // Add single schema sync method
    api.syncSchema = async (schema, table, options = {}) => {
      const connectionName = options.connection || 'default';
      const { pool } = api.getConnection(connectionName);
      
      const syncOptions = {
        idProperty: options.idProperty || api.options.idProperty || 'id',
        positionField: options.positionField || api.options.positionField,
        dbExtraIndexes: options.dbExtraIndexes || api.options.dbExtraIndexes || [],
        stores: api.resources,
        ...options
      };
      
      await syncMySQLSchema(pool, schema, table, syncOptions);
    };
  }
};

/**
 * Apply query operators
 * Kept separate for clarity and maintainability
 */
function applyOperator(query, table, field, operator, value) {
  const fieldName = `${table}.${field}`;
  
  switch (operator) {
    case '$gt':
      query.where(`${fieldName} > ?`, value);
      break;
    case '$gte':
      query.where(`${fieldName} >= ?`, value);
      break;
    case '$lt':
      query.where(`${fieldName} < ?`, value);
      break;
    case '$lte':
      query.where(`${fieldName} <= ?`, value);
      break;
    case '$ne':
      query.where(`${fieldName} != ?`, value);
      break;
    case '$like':
      query.where(`${fieldName} LIKE ?`, value);
      break;
    case '$in':
      if (Array.isArray(value) && value.length > 0) {
        const placeholders = value.map(() => '?').join(',');
        query.where(`${fieldName} IN (${placeholders})`, ...value);
      }
      break;
    case '$nin':
      if (Array.isArray(value) && value.length > 0) {
        const placeholders = value.map(() => '?').join(',');
        query.where(`${fieldName} NOT IN (${placeholders})`, ...value);
      }
      break;
    case '$between':
      if (Array.isArray(value) && value.length === 2) {
        query.where(`${fieldName} BETWEEN ? AND ?`, value[0], value[1]);
      }
      break;
    default:
      throw new BadRequestError(`Unknown operator: ${operator}`);
  }
}

/**
 * Check if a schema has eager joins that should be loaded
 */
function hasEagerJoins(schema, options) {
  // If joins are explicitly disabled, return false
  if (options.joins === false) return false;
  
  // Check for eager joins in schema
  for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
    if (fieldDef.refs?.join?.eager) {
      // Check if this join is excluded
      if (options.excludeJoins?.includes(fieldName)) continue;
      
      // If we have explicit joins list, only include if specified
      if (Array.isArray(options.joins) && !options.joins.includes(fieldName)) continue;
      
      return true;
    }
  }
  
  // Also check if there are explicit joins requested
  if (Array.isArray(options.joins) && options.joins.length > 0) {
    return true;
  }
  
  return false;
}

/**
 * Determine which joins should be performed based on schema and options
 * Now supports nested paths like 'authorId.countryId'
 */
function determineRequestedJoins(schema, options) {
  const requestedJoins = new Set();
  
  // If joins are explicitly disabled, return empty set
  if (options.joins === false) return requestedJoins;
  
  // First, handle explicit joins (may include nested paths)
  if (Array.isArray(options.joins)) {
    for (const joinPath of options.joins) {
      if (joinPath.includes('.')) {
        // Nested path - add the first level only
        const firstLevel = joinPath.split('.')[0];
        requestedJoins.add(firstLevel);
      } else {
        // Simple join
        requestedJoins.add(joinPath);
      }
    }
  }
  
  // Always process eager joins from schema (only first level)
  // unless they are explicitly excluded
  for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
    if (!fieldDef.refs?.join) continue;
    
    const joinConfig = fieldDef.refs.join;
    
    if (joinConfig.eager && !options.excludeJoins?.includes(fieldName)) {
      requestedJoins.add(fieldName);
    }
  }
  
  return requestedJoins;
}

/**
 * Parse nested join paths and validate them
 * Returns a map of resource type to fields that need joining at each level
 */
function parseNestedJoinPaths(api, baseType, joinPaths) {
  // Map of resourceType -> Set of fields to join
  const joinsByResource = new Map();
  joinsByResource.set(baseType, new Set());
  
  for (const path of joinPaths) {
    if (!path.includes('.')) {
      // Simple join - add to base resource
      joinsByResource.get(baseType).add(path);
      continue;
    }
    
    // Parse nested path like 'authorId.countryId.continentId'
    const segments = path.split('.');
    let currentResource = baseType;
    let fullPath = '';
    
    for (let i = 0; i < segments.length; i++) {
      const fieldName = segments[i];
      fullPath = fullPath ? `${fullPath}.${fieldName}` : fieldName;
      
      // Get schema for current resource
      const schema = api.schemas.get(currentResource);
      if (!schema) {
        throw new BadRequestError(
          `Cannot join '${path}' - resource '${currentResource}' not found`
        );
      }
      
      // Get field definition
      const fieldDef = schema.structure[fieldName];
      if (!fieldDef) {
        throw new BadRequestError(
          `Cannot join '${path}' - field '${fieldName}' not found in resource '${currentResource}'`
        );
      }
      
      // Validate it has refs and join config
      if (!fieldDef.refs?.join) {
        throw new BadRequestError(
          `Cannot join '${path}' - field '${fieldName}' in resource '${currentResource}' does not have join configuration`
        );
      }
      
      // Add this field to joins for current resource
      if (!joinsByResource.has(currentResource)) {
        joinsByResource.set(currentResource, new Set());
      }
      joinsByResource.get(currentResource).add(fieldName);
      
      // Move to next resource
      currentResource = fieldDef.refs.resource;
    }
  }
  
  return joinsByResource;
}

/**
 * Schema Synchronization
 * =====================
 * 
 * Port of the comprehensive schema sync functionality from mysql-old.js
 * This handles creating and updating database tables based on Schema definitions
 */

/**
 * Sync MySQL schema with comprehensive features
 */
async function syncMySQLSchema(pool, schema, table, options = {}) {
  const idProperty = options.idProperty || 'id';
  const positionField = options.positionField;
  const dbExtraIndexes = options.dbExtraIndexes || [];

  // Check if table exists
  const [tables] = await pool.query(
    `SHOW TABLES LIKE ?`,
    [table]
  );

  const tableAlreadyExists = tables.length > 0;
  
  // Create table with dummy column if it doesn't exist
  if (!tableAlreadyExists) {
    await pool.query(`CREATE TABLE \`${table}\` (__dummy__ INT(1))`);
  }

  // Get comprehensive table information
  const [columns] = await pool.query(
    `SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  
  const [indexes] = await pool.query(`SHOW INDEX FROM \`${table}\``);
  
  const [constraints] = await pool.query(
    `SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );

  // Create columns hash for easy lookup
  const columnsHash = columns.reduce((map, column) => {
    map[column.COLUMN_NAME] = column;
    return map;
  }, {});

  const primaryKeyColumn = columns.find(el => el.COLUMN_KEY === 'PRI');

  // Convert schema to array format for easier processing
  const schemaFieldsAsArray = Object.keys(schema.structure).map(k => ({ 
    ...schema.structure[k], 
    name: k 
  }));

  // Determine auto-increment field
  let autoIncrementField = schemaFieldsAsArray.find(el => el.autoIncrement);
  if (!autoIncrementField) {
    autoIncrementField = schemaFieldsAsArray.find(el => el.name === idProperty);
  }
  const autoIncrementFieldName = autoIncrementField ? autoIncrementField.name : idProperty;

  // Handle primary key changes if needed
  if (primaryKeyColumn) {
    await maybeChangePrimaryKey(pool, table, primaryKeyColumn, idProperty, schemaFieldsAsArray);
  }

  // Process columns
  const dbIndexes = [];
  const foreignEndpoints = [];
  
  for (let i = 0; i < schemaFieldsAsArray.length; i++) {
    const field = schemaFieldsAsArray[i];
    const creatingNewColumn = !columnsHash[field.name];
    
    await processColumn(
      pool, table, field, i, schemaFieldsAsArray, 
      creatingNewColumn, idProperty, autoIncrementFieldName,
      columnsHash, dbIndexes, foreignEndpoints, positionField, options
    );
  }

  // Add extra indexes
  if (dbExtraIndexes.length > 0) {
    for (const ei of dbExtraIndexes) {
      dbIndexes.push({
        column: ei.column,
        unique: ei.unique,
        name: ei.name
      });
    }
  }

  // Remove dummy column if it exists
  if (columnsHash.__dummy__) {
    await pool.query(`ALTER TABLE \`${table}\` DROP COLUMN \`__dummy__\``);
  }

  // Create indexes
  await createIndexes(pool, table, dbIndexes, indexes);

  // Create foreign key constraints
  await createForeignKeyConstraints(pool, table, foreignEndpoints, constraints, options);
}

/**
 * Get MySQL column definition from schema field
 */
function getMySQLColumnDefinition(fieldName, definition, options = {}) {
  let sqlType;
  let length = 256;
  
  // Allow custom DB type override
  if (definition.dbType) {
    sqlType = definition.dbType;
  } else {
    switch (definition.type) {
      case 'id':
        sqlType = 'INT';
        break;
      case 'number':
        if (definition.float) sqlType = 'FLOAT';
        else if (definition.currency) sqlType = 'NUMERIC(10,2)';
        else if (definition.longInt) sqlType = 'BIGINT';
        else sqlType = 'INT';
        break;
      case 'string':
        if (definition.length) length = definition.length;
        if (definition.max) length = definition.max;
        if (definition.asText || definition.text) sqlType = 'TEXT';
        else sqlType = `VARCHAR(${length})`;
        break;
      case 'boolean':
        sqlType = 'TINYINT';
        break;
      case 'timestamp':
        sqlType = 'BIGINT';
        break;
      case 'date':
        sqlType = 'DATE';
        break;
      case 'dateTime':
        sqlType = 'DATETIME';
        break;
      case 'blob':
        if (definition.length) length = definition.length;
        sqlType = `BLOB`;
        break;
      case 'object':
      case 'array':
      case 'serialize':
        sqlType = 'JSON';
        break;
      default:
        if (definition.type) {
          throw new Error(`${definition.type} not converted automatically. Use dbType instead`);
        }
        sqlType = 'VARCHAR(255)';
    }
  }

  // NULL clause - if required then NOT NULL, otherwise NULL
  const nullable = definition.required ? 'NOT NULL' : 'NULL';
  
  // Default value, giving priority to dbDefault
  let defaultValue = '';
  if (typeof definition.dbDefault !== 'undefined') {
    // MySQL escape for default values
    if (definition.dbDefault === null) {
      defaultValue = ' DEFAULT NULL';
    } else if (typeof definition.dbDefault === 'string') {
      defaultValue = ` DEFAULT '${definition.dbDefault.replace(/'/g, "''")}'`;
    } else {
      defaultValue = ` DEFAULT ${definition.dbDefault}`;
    }
  } else if (typeof definition.default !== 'undefined') {
    if (definition.default === null) {
      defaultValue = ' DEFAULT NULL';
    } else if (typeof definition.default === 'string') {
      defaultValue = ` DEFAULT '${definition.default.replace(/'/g, "''")}'`;
    } else {
      defaultValue = ` DEFAULT ${definition.default}`;
    }
  }

  // AUTO_INCREMENT clause
  const autoIncrement = (definition.autoIncrement || fieldName === options.idProperty) && !options.skipAutoIncrement ? 'AUTO_INCREMENT' : '';

  return `\`${fieldName}\` ${sqlType} ${nullable}${defaultValue} ${autoIncrement}`.trim();
}

/**
 * Process a single column during schema sync
 */
async function processColumn(
  pool, table, field, index, schemaFieldsAsArray,
  creatingNewColumn, idProperty, autoIncrementFieldName,
  columnsHash, dbIndexes, foreignEndpoints, positionField, options = {}
) {
  const changeOrAddStatement = creatingNewColumn ? 'ADD COLUMN' : `CHANGE \`${field.name}\``;
  
  const def = getMySQLColumnDefinition(field.name, field, { 
    idProperty,
    skipAutoIncrement: autoIncrementFieldName !== field.name 
  });
  
  // Handle primary key for new columns
  const maybePrimaryKey = (creatingNewColumn && field.name === idProperty) ? 'PRIMARY KEY' : '';
  
  // Handle column ordering
  const maybeAfter = index > 0 ? `AFTER \`${schemaFieldsAsArray[index - 1].name}\`` : '';

  const sqlQuery = `ALTER TABLE \`${table}\` ${changeOrAddStatement} ${def} ${maybePrimaryKey} ${maybeAfter}`;
  await pool.query(sqlQuery);

  // Collect index information
  if (field.dbIndex || field.searchable || field.name === positionField || field.refs) {
    if (columnsHash[field.name] || creatingNewColumn) {
      if (field.name !== idProperty) {
        dbIndexes.push({
          column: field.name,
          unique: field.dbUnique,
          name: field.dbIndexName || `jrs_${field.name}`
        });
      }
    }
  }

  // Collect foreign key information from refs
  if (field.refs && options.stores) {
    const targetResource = field.refs.resource;
    
    // Check if the target resource exists
    if (options.stores.has(targetResource)) {
      foreignEndpoints.push({
        sourceField: field.name,
        endpointName: targetResource,
        foreignTable: targetResource, // Table name defaults to resource name
        foreignField: options.idProperty || 'id', // Use same idProperty default
        constraintName: field.refs.constraintName || `jra_${table}_${field.name}_to_${targetResource}`
      });
    }
  }
  
  // Also support legacy foreignEndpoint syntax
  if (field.foreignEndpoint) {
    foreignEndpoints.push({
      sourceField: field.name,
      ...field.foreignEndpoint
    });
  }
}

/**
 * Handle primary key changes during schema sync
 */
async function maybeChangePrimaryKey(pool, table, primaryKeyColumn, idProperty, schemaFieldsAsArray) {
  // If primary key hasn't changed, don't do anything
  if (primaryKeyColumn && primaryKeyColumn.COLUMN_NAME === idProperty) {
    return;
  }

  const oldPrimaryKeyColumnName = primaryKeyColumn.COLUMN_NAME;

  // Remove AUTO_INCREMENT from old primary key if present
  if (primaryKeyColumn.EXTRA === 'auto_increment') {
    await pool.query('SET foreign_key_checks = 0');
    const pkc = primaryKeyColumn;
    let defaultClause = '';
    if (pkc.COLUMN_DEFAULT !== null) {
      if (typeof pkc.COLUMN_DEFAULT === 'string') {
        defaultClause = ` DEFAULT '${pkc.COLUMN_DEFAULT.replace(/'/g, "''")}'`;
      } else {
        defaultClause = ` DEFAULT ${pkc.COLUMN_DEFAULT}`;
      }
    }
    const defWithoutAutoIncrement = `\`${pkc.COLUMN_NAME}\` ${pkc.COLUMN_TYPE} ${pkc.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}${defaultClause}`;
    await pool.query(`ALTER TABLE \`${table}\` CHANGE \`${oldPrimaryKeyColumnName}\` ${defWithoutAutoIncrement}`);
    await pool.query('SET foreign_key_checks = 1');
  }

  // Ensure old primary key has an index
  const [indexIsThere] = await pool.query(
    `SHOW INDEX FROM \`${table}\` WHERE Key_name <> 'PRIMARY' AND Seq_in_index = 1 AND Column_name = ?`,
    [oldPrimaryKeyColumnName]
  );
  
  if (indexIsThere.length === 0) {
    const field = schemaFieldsAsArray.find(def => def.name === oldPrimaryKeyColumnName);
    const dbIndex = field?.dbIndex || `jrs_${oldPrimaryKeyColumnName}`;
    await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${dbIndex}\`(\`${oldPrimaryKeyColumnName}\`)`);
  }

  // Drop old primary key and add new one
  await pool.query(`ALTER TABLE \`${table}\` DROP PRIMARY KEY, ADD PRIMARY KEY (\`${idProperty}\`)`);
  return true;
}

/**
 * Create indexes during schema sync
 */
async function createIndexes(pool, table, dbIndexes, existingIndexes) {
  for (const dbi of dbIndexes) {
    // Handle multiple columns
    let columns;
    if (!Array.isArray(dbi.column)) {
      columns = `\`${dbi.column}\``;
    } else {
      columns = dbi.column.map(c => `\`${c}\``).join(',');
    }

    // Generate index name if not provided
    let indexName = dbi.name;
    if (!indexName) {
      if (!Array.isArray(dbi.column)) {
        indexName = `jrs_${dbi.column}`;
      } else {
        indexName = 'jrs_' + dbi.column.join('_');
      }
    }

    // Skip if index already exists
    if (existingIndexes.find(i => i.Key_name === indexName)) {
      continue;
    }

    const sqlQuery = `ALTER TABLE \`${table}\` ADD ${dbi.unique ? 'UNIQUE' : ''} INDEX \`${indexName}\` (${columns})`;
    await pool.query(sqlQuery);
  }
}

/**
 * Create foreign key constraints during schema sync
 */
async function createForeignKeyConstraints(pool, table, foreignEndpoints, existingConstraints, options) {
  const stores = options.stores || new Map();
  
  for (const fe of foreignEndpoints) {
    let foreignTable;
    let foreignField;
    let constraintName;

    // Determine foreign table
    if (fe.foreignTable) {
      foreignTable = fe.foreignTable;
    } else if (fe.endpointName && stores.has && stores.has(fe.endpointName)) {
      // If stores is a Map with has method
      foreignTable = fe.endpointName; // Table name defaults to resource name
    } else if (fe.endpointName) {
      // Fallback: assume table name is same as endpoint name
      foreignTable = fe.endpointName;
    } else {
      throw new Error('Cannot find the foreign table for field: ' + fe.sourceField);
    }

    // Determine foreign field
    if (fe.foreignField) {
      foreignField = fe.foreignField;
    } else {
      foreignField = options.idProperty || 'id';
    }

    // Generate constraint name
    if (fe.constraintName) {
      constraintName = fe.constraintName;
    } else {
      // Include source table name to avoid conflicts
      constraintName = `jra_${table}_${fe.sourceField}_to_${foreignTable}`;
    }

    // Skip if constraint already exists
    if (existingConstraints.find(c => c.CONSTRAINT_NAME === constraintName)) {
      continue;
    }

    // Check if the referenced table exists
    try {
      const [tables] = await pool.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [foreignTable]
      );
      
      if (tables.length === 0) {
        console.log(`⚠️  Skipping foreign key ${constraintName}: table ${foreignTable} does not exist yet`);
        continue;
      }
    } catch (error) {
      console.log(`⚠️  Error checking table ${foreignTable}:`, error.message);
      continue;
    }

    const sqlQuery = `
      ALTER TABLE \`${table}\`
      ADD CONSTRAINT \`${constraintName}\`
      FOREIGN KEY (\`${fe.sourceField}\`)
      REFERENCES \`${foreignTable}\` (\`${foreignField}\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION`;
    
    try {
      await pool.query(sqlQuery);
    } catch (error) {
      console.log(`⚠️  Failed to create foreign key ${constraintName}:`, error.message);
    }
  }
}