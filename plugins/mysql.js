import mysql from 'mysql2/promise';
import { NotFoundError, InternalError, ConflictError, ErrorCodes } from '../errors.js';
import { QueryBuilder, schemaFields } from '../query-builder.js';

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
        
        if (requestedJoins.size > 0) {
          // Store join metadata for later processing
          context.joinFields = {};
          
          for (const fieldName of requestedJoins) {
            const fieldDef = schema.structure[fieldName];
            if (!fieldDef?.refs?.join) continue;
            
            const refs = fieldDef.refs;
            const joinConfig = refs.join;
            
            // Add the join
            const joinType = joinConfig.type || 'left';
            query[joinType + 'Join'](fieldName);
            
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
              preserveId: joinConfig.preserveId
            };
            
            // Select fields with special prefix for grouping
            fields.forEach(field => {
              query.select(`${refs.resource}.${field} as __${fieldName}__${field}`);
            });
          }
        }
      } else {
        query.select(`${table}.*`);
      }
      
      // Apply filters from params
      if (context.params.filter) {
        for (const [field, value] of Object.entries(context.params.filter)) {
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
          
          // Execute query
          const sql = queryContext.query.toSQL();
          const args = queryContext.query.getArgs();
          const [rows] = await pool.query(sql, args);
          
          if (!rows[0] && !options.allowNotFound) {
            throw new NotFoundError(options.type || table, id);
          }
          
          return rows[0] || null;
        } else {
          // Simple get without joins
          const [rows] = await pool.query(
            `SELECT * FROM ?? WHERE ?? = ?`,
            [table, idProperty, id]
          );

          if (!rows[0] && !options.allowNotFound) {
            throw new NotFoundError(options.type || table, id);
          }
          
          return rows[0] || null;
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
        
        return {
          results: rows,
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
        // Remove undefined values
        const cleanData = {};
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) {
            cleanData[key] = value;
          }
        }

        const [result] = await pool.query(
          `INSERT INTO ?? SET ?`,
          [table, cleanData]
        );

        // Return the inserted record
        if (result.insertId) {
          data[idProperty] = result.insertId;
        }

        return data;
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
        
        // Remove undefined values and id from update data
        const updateData = {};
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && key !== idProperty) {
            updateData[key] = value;
          }
        }

        // Build WHERE clause from query builder
        const whereConditions = context.updateQuery.parts.where
          .map(w => w.sql)
          .join(' AND ');
        const whereArgs = context.updateQuery.getArgs();

        const [result] = await pool.query(
          `UPDATE ?? SET ? WHERE ${whereConditions}`,
          [table, updateData, ...whereArgs]
        );

        if (result.affectedRows === 0) {
          throw new NotFoundError(options.type || table, id);
        }

        // Return updated data (id + updated fields)
        return { [idProperty]: id, ...updateData };
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
 */
function determineRequestedJoins(schema, options) {
  const requestedJoins = new Set();
  
  // If joins are explicitly disabled, return empty set
  if (options.joins === false) return requestedJoins;
  
  // Process each field in the schema
  for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
    if (!fieldDef.refs?.join) continue;
    
    const joinConfig = fieldDef.refs.join;
    
    // Check if this join should be included
    let shouldInclude = false;
    
    if (Array.isArray(options.joins)) {
      // Explicit join list takes precedence
      shouldInclude = options.joins.includes(fieldName);
    } else if (joinConfig.eager) {
      // Check eager joins (unless excluded)
      shouldInclude = !options.excludeJoins?.includes(fieldName);
    }
    
    if (shouldInclude) {
      requestedJoins.add(fieldName);
    }
  }
  
  return requestedJoins;
}