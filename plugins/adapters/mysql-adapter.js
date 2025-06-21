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
    const poolStats = new Map();
    
    // Helper to create pool with enhanced configuration
    const createPool = (config) => {
      const poolConfig = {
        ...config,
        // Apply pool-specific settings if provided
        ...(config.pool ? {
          connectionLimit: config.pool.max || config.connectionLimit || 10,
          queueLimit: config.pool.queueLimit || 0,
          waitForConnections: config.pool.waitForConnections !== false,
          acquireTimeout: config.pool.acquireTimeout || 60000,
          timeout: config.pool.timeout || 60000
        } : {})
      };
      
      return mysql.createPool(poolConfig);
    };
    
    if (options.connections) {
      for (const conn of options.connections) {
        const pool = createPool(conn.config);
        pools.set(conn.name || 'default', {
          pool,
          options: conn.options || {},
          config: conn.config
        });
        poolStats.set(conn.name || 'default', {
          acquired: 0,
          released: 0,
          errors: 0,
          timeouts: 0,
          totalAcquireTime: 0,
          maxUsed: 0
        });
      }
    } else if (options.connection) {
      const pool = createPool(options.connection);
      pools.set('default', { 
        pool, 
        options: {},
        config: options.connection
      });
      poolStats.set('default', {
        acquired: 0,
        released: 0,
        errors: 0,
        timeouts: 0,
        totalAcquireTime: 0,
        maxUsed: 0
      });
    }
    
    // Store pools on API instance for cleanup
    api._mysqlPools = pools;
    api._mysqlPoolStats = poolStats;
    
    // Implement database interface
    api.implement('db.query', async (context) => {
      const { sql, params, connection = 'default', transaction } = context;
      
      // Use transaction connection if available
      if (transaction && transaction.connection) {
        try {
          const [rows, fields] = await transaction.connection.execute(sql, params);
          return { rows, fields, info: rows };
        } catch (error) {
          error.sql = sql;
          error.params = params;
          throw error;
        }
      }
      
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
    
    // Atomic operations support
    api.implement('db.transaction', async (context) => {
      const { fn, connection = 'default' } = context;
      const poolInfo = pools.get(connection);
      
      if (!poolInfo) {
        throw new InternalError(`Connection '${connection}' not found`);
      }
      
      const conn = await poolInfo.pool.getConnection();
      
      try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    });
    
    // Mark that this adapter supports atomic operations
    api.storagePlugin = api.storagePlugin || {};
    api.storagePlugin.supportsAtomicUpdates = true;
    api.storagePlugin.supportsAtomicIncrement = true;
    api.storagePlugin.supportsBulkUpdate = true;
    
    // Atomic get next position using SELECT ... FOR UPDATE
    api.storagePlugin.atomicGetNextPosition = async (type, filter, field) => {
      return await api.execute('db.transaction', {
        fn: async (conn) => {
          // Build WHERE clause
          const conditions = [];
          const values = [];
          
          for (const [key, value] of Object.entries(filter)) {
            conditions.push(`\`${key}\` = ?`);
            values.push(value);
          }
          
          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          
          // Get max position with lock
          const sql = `
            SELECT MAX(\`${field}\`) as maxPos 
            FROM \`${type}\` 
            ${whereClause}
            FOR UPDATE
          `;
          
          const [rows] = await conn.execute(sql, values);
          const nextPos = (rows[0]?.maxPos || 0) + 1;
          
          return nextPos;
        }
      });
    };
    
    // Atomic bulk position shift
    api.storagePlugin.atomicShiftPositions = async (type, params) => {
      const { field, from, delta, filter = {}, excludeIds = [] } = params;
      
      return await api.execute('db.transaction', {
        fn: async (conn) => {
          // Build WHERE clause
          const conditions = [`\`${field}\` >= ?`];
          const values = [from];
          
          for (const [key, value] of Object.entries(filter)) {
            if (key === field && typeof value === 'object') {
              // Handle range conditions like { $lte: 5 }
              for (const [op, val] of Object.entries(value)) {
                if (op === '$lte') conditions.push(`\`${key}\` <= ?`);
                else if (op === '$lt') conditions.push(`\`${key}\` < ?`);
                else if (op === '$gte') conditions.push(`\`${key}\` >= ?`);
                else if (op === '$gt') conditions.push(`\`${key}\` > ?`);
                values.push(val);
              }
            } else {
              conditions.push(`\`${key}\` = ?`);
              values.push(value);
            }
          }
          
          if (excludeIds.length > 0) {
            conditions.push(`\`id\` NOT IN (${excludeIds.map(() => '?').join(',')})`);
            values.push(...excludeIds);
          }
          
          const sql = `
            UPDATE \`${type}\`
            SET \`${field}\` = \`${field}\` + ?
            WHERE ${conditions.join(' AND ')}
          `;
          
          const [result] = await conn.execute(sql, [delta, ...values]);
          return { shifted: result.affectedRows };
        }
      });
    };
    
    // MySQL-specific features
    api.implement('db.features', (context) => {
      return {
        transactions: true,
        returning: false, // MySQL doesn't support RETURNING
        arrays: false,    // No native array type
        json: true,       // Native JSON support
        jsonFunctions: true, // Supports JSON_CONTAINS, JSON_EXTRACT, etc.
        upsert: true,     // INSERT ... ON DUPLICATE KEY UPDATE
        schemas: true,    // Database schemas
        tableCreation: true,
        ilike: false      // MySQL doesn't support ILIKE, use LOWER() instead
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
    
    // Add pool monitoring methods to API
    api.getPoolStats = async (connectionName = 'default') => {
      const poolInfo = pools.get(connectionName);
      const stats = poolStats.get(connectionName);
      
      if (!poolInfo || !stats) {
        throw new InternalError(`Connection '${connectionName}' not found`);
      }
      
      // Get pool status from mysql2
      const pool = poolInfo.pool;
      const poolPromise = pool.pool || pool; // Handle different mysql2 versions
      
      return {
        // Connection counts
        total: poolInfo.config?.pool?.max || poolInfo.config?.connectionLimit || 10,
        active: poolPromise._allConnections?.length || 0,
        idle: poolPromise._freeConnections?.length || 0,
        waiting: poolPromise._connectionQueue?.length || 0,
        
        // Statistics
        acquired: stats.acquired,
        released: stats.released,
        errors: stats.errors,
        timeouts: stats.timeouts,
        averageAcquireTime: stats.acquired > 0 ? stats.totalAcquireTime / stats.acquired : 0,
        maxUsed: stats.maxUsed
      };
    };
    
    // Get all pool stats
    api.getAllPoolStats = async () => {
      const allStats = {};
      for (const [name] of pools) {
        allStats[name] = await api.getPoolStats(name);
      }
      return allStats;
    };
    
    // Enhanced connection acquisition with stats
    const originalExecute = api.implementers.get('db.query');
    api.implement('db.query', async (context) => {
      const connectionName = context.connection || 'default';
      const stats = poolStats.get(connectionName);
      
      if (stats && !context.transaction) {
        const startTime = Date.now();
        stats.acquired++;
        
        try {
          const result = await originalExecute(context);
          stats.released++;
          stats.totalAcquireTime += Date.now() - startTime;
          
          // Update max used
          const poolInfo = pools.get(connectionName);
          if (poolInfo) {
            const pool = poolInfo.pool.pool || poolInfo.pool;
            const active = (pool._allConnections?.length || 0) - (pool._freeConnections?.length || 0);
            stats.maxUsed = Math.max(stats.maxUsed, active);
          }
          
          return result;
        } catch (error) {
          stats.errors++;
          if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
            stats.timeouts++;
          }
          throw error;
        }
      }
      
      return originalExecute(context);
    });
    
    // Mark adapter capabilities
    api.storagePlugin = api.storagePlugin || {};
    api.storagePlugin.supportsTransactions = true;
    api.storagePlugin.supportsSavepoints = true;
    api.storagePlugin.supportsPoolMonitoring = true;
    api.storagePlugin.supportsBulkInsert = true;
    api.storagePlugin.supportsBulkUpdate = true;
  }
};