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
      if (context.method !== 'query') return;
      
      const table = context.options.table || context.options.type;
      const schema = api.schemas.get(context.options.type);
      
      // Create query builder with default fields
      const query = new QueryBuilder(table);
      
      // Add schema fields by default (excluding silent ones)
      if (schema) {
        const fields = schemaFields(schema, table);
        query.select(...fields);
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
        // Simple get - we don't use the query builder for single fetches
        const [rows] = await pool.query(
          `SELECT * FROM ?? WHERE ?? = ?`,
          [table, idProperty, id]
        );

        if (!rows[0] && !options.allowNotFound) {
          throw new NotFoundError(options.type || table, id);
        }
        
        return rows[0] || null;
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
        const query = new QueryBuilder(table);
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
        const query = new QueryBuilder(table);
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