import mysql from 'mysql2/promise';
import { InternalError } from '../../lib/errors.js';

/**
 * MySQL Database Adapter
 * 
 * Implements the database interface for MySQL connections.
 * All SQL-specific logic is handled by the SQL plugin layer.
 */
export const MySQLAdapter = {
  install(api, options = {}) {
    // Initialize connection pools
    const pools = new Map();
    
    if (options.connections) {
      for (const conn of options.connections) {
        const pool = mysql.createPool(conn.config);
        pools.set(conn.name || 'default', {
          pool,
          options: conn.options || {}
        });
      }
    } else if (options.connection) {
      const pool = mysql.createPool(options.connection);
      pools.set('default', { pool, options: {} });
    }
    
    // Store pools on API instance for cleanup
    api._mysqlPools = pools;
    
    // Implement database interface
    api.implement('db.query', async (context) => {
      const { sql, params, connection = 'default' } = context;
      const poolInfo = pools.get(connection);
      
      if (!poolInfo) {
        throw new InternalError(`Connection '${connection}' not found`);
      }
      
      try {
        const [rows, fields] = await poolInfo.pool.execute(sql, params);
        return { rows, fields, info: rows };
      } catch (error) {
        // Re-throw with original error info
        error.sql = sql;
        error.params = params;
        throw error;
      }
    });
    
    api.implement('db.connect', async (context) => {
      // Test all connections
      for (const [name, { pool }] of pools) {
        try {
          const connection = await pool.getConnection();
          await connection.ping();
          connection.release();
        } catch (error) {
          throw new InternalError(`Failed to connect to MySQL (${name}): ${error.message}`);
        }
      }
    });
    
    api.implement('db.disconnect', async (context) => {
      for (const [, { pool }] of pools) {
        await pool.end();
      }
    });
    
    // MySQL-specific formatting
    api.implement('db.formatIdentifier', (context) => {
      // MySQL uses ?? for identifier placeholders
      return '??';
    });
    
    api.implement('db.formatParam', (context) => {
      // MySQL uses ? for value placeholders
      return '?';
    });
    
    api.implement('db.formatIdentifier', (context) => {
      const { identifier } = context;
      // MySQL uses backticks
      return `\`${identifier.replace(/`/g, '``')}\``;
    });
    
    api.implement('db.convertId', (context) => {
      // MySQL handles string/number IDs automatically
      return context.id;
    });
    
    api.implement('db.getInsertId', (context) => {
      const { result } = context;
      return result.info.insertId;
    });
    
    api.implement('db.getAffectedRows', (context) => {
      const { result } = context;
      return result.info.affectedRows;
    });
    
    // MySQL-specific features
    api.implement('db.features', (context) => {
      return {
        transactions: true,
        returning: false, // MySQL doesn't support RETURNING
        arrays: false,    // No native array type
        json: true,       // Native JSON support
        upsert: true,     // INSERT ... ON DUPLICATE KEY UPDATE
        schemas: true,    // Database schemas
        tableCreation: true
      };
    });
    
    // Table creation for MySQL
    api.implement('db.createTable', async (context) => {
      const { table, schema, idProperty, connection = 'default' } = context;
      const poolInfo = pools.get(connection);
      
      if (!poolInfo) {
        throw new InternalError(`Connection '${connection}' not found`);
      }
      
      // Check if table exists
      const [tables] = await poolInfo.pool.query(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table]
      );
      
      if (tables.length > 0) {
        // Table exists, sync schema if needed
        // ... (schema sync logic from original MySQL plugin)
        return;
      }
      
      // Create table
      const columns = [`\`${idProperty}\` INT AUTO_INCREMENT PRIMARY KEY`];
      
      for (const [field, def] of Object.entries(schema.structure)) {
        if (field === idProperty) continue;
        
        let sqlType = 'VARCHAR(255)';
        if (def.type === 'number') {
          // Use BIGINT for timestamp fields (milliseconds since epoch)
          // Check if this might be a timestamp field
          if (field.toLowerCase().includes('at') || field.toLowerCase().includes('time')) {
            sqlType = 'BIGINT';
          } else {
            sqlType = 'DOUBLE';
          }
        } else if (def.type === 'integer') {
          sqlType = 'INT';
        } else if (def.type === 'boolean') {
          sqlType = 'BOOLEAN';
        } else if (def.type === 'timestamp') {
          sqlType = 'TIMESTAMP';
        } else if (def.type === 'object' || def.type === 'array') {
          sqlType = 'JSON';
        } else if (def.type === 'blob') {
          sqlType = 'TEXT';
        }
        
        let columnDef = `\`${field}\` ${sqlType}`;
        if (def.required && !def.default) {
          columnDef += ' NOT NULL';
        }
        if (def.default !== undefined) {
          columnDef += ` DEFAULT ${mysql.escape(def.default)}`;
        }
        
        columns.push(columnDef);
      }
      
      const createSql = `CREATE TABLE \`${table}\` (${columns.join(', ')})`;
      await poolInfo.pool.query(createSql);
      
      // Create indexes
      for (const [field, def] of Object.entries(schema.structure)) {
        if (def.searchable || def.dbIndex) {
          const indexName = `idx_${table}_${field}`;
          const uniquePart = def.dbUnique ? 'UNIQUE' : '';
          await poolInfo.pool.query(
            `CREATE ${uniquePart} INDEX \`${indexName}\` ON \`${table}\`(\`${field}\`)`
          );
        }
      }
    });
  }
};