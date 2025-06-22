import mysql from 'mysql2/promise';
import { InternalError } from '../../../lib/errors.js';

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
        options: options,
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
    
    // Implement database interface
    api.db = {
      // Execute a query with enhanced stats tracking
      async execute(sql, params = [], connection = 'default') {
        const poolData = pools.get(connection);
        if (!poolData) {
          throw new InternalError(`Connection '${connection}' not found`);
        }
        
        const stats = poolStats.get(connection);
        const startTime = Date.now();
        let conn;
        
        try {
          stats.acquired++;
          conn = await poolData.pool.getConnection();
          
          const acquireTime = Date.now() - startTime;
          stats.totalAcquireTime += acquireTime;
          
          // Track max connections used (safely check for internal pool properties)
          if (poolData.pool._allConnections && poolData.pool._freeConnections) {
            const activeConnections = poolData.pool._allConnections.length - poolData.pool._freeConnections.length;
            stats.maxUsed = Math.max(stats.maxUsed, activeConnections);
          }
          
          try {
            const [result] = await conn.execute(sql, params);
            return result;
          } catch (error) {
            // MySQL-specific error enrichment
            if (api.options.debug || process.env.NODE_ENV === 'development') {
              error.sql = sql;
              error.params = params;
            }
            throw error;
          }
        } catch (error) {
          stats.errors++;
          if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
            stats.timeouts++;
          }
          
          // Re-throw with connection context
          if (!error.connection) {
            error.connection = connection;
          }
          throw error;
        } finally {
          if (conn) {
            conn.release();
            stats.released++;
          }
        }
      },
      
      // Query with result processing
      async query(sql, params = [], connection = 'default') {
        const poolData = pools.get(connection);
        if (!poolData) {
          throw new InternalError(`Connection '${connection}' not found`);
        }
        
        try {
          const [result, fields] = await poolData.pool.execute(sql, params);
          
          // For SELECT queries, result is an array of rows
          if (Array.isArray(result)) {
            return {
              rows: result,
              fields: fields || [],
              info: {
                affectedRows: result.length
              }
            };
          }
          
          // For INSERT/UPDATE/DELETE, result is an object with metadata
          return {
            rows: [],
            fields: fields || [],
            info: {
              affectedRows: result.affectedRows || 0,
              insertId: result.insertId || null
            }
          };
        } catch (error) {
          // Re-throw with original error info (only in development)
          if (api.options.debug || process.env.NODE_ENV === 'development') {
            error.sql = sql;
            error.params = params;
          }
          throw error;
        }
      },
      
      // Connect to database(s)
      async connect() {
        // Test all connections
        const connectionPromises = [];
        
        for (const [name, poolData] of pools) {
          connectionPromises.push(
            poolData.pool.execute('SELECT 1')
              .then(() => ({ name, status: 'connected' }))
              .catch(error => {
                throw new InternalError(`Failed to connect to MySQL (${name}): ${error.message}`);
              })
          );
        }
        
        return Promise.all(connectionPromises);
      },
      
      // Disconnect from database(s)
      async disconnect() {
        const promises = [];
        
        for (const [name, poolData] of pools) {
          promises.push(poolData.pool.end());
        }
        
        await Promise.all(promises);
        pools.clear();
        poolStats.clear();
      },
      
      // Get connection pool
      getPool(name = 'default') {
        const poolData = pools.get(name);
        if (!poolData) {
          throw new InternalError(`Connection '${name}' not found`);
        }
        return poolData.pool;
      },
      
      // Get pool statistics
      getStats(connection = 'default') {
        const stats = poolStats.get(connection);
        const poolData = pools.get(connection);
        
        if (!stats || !poolData) {
          throw new InternalError(`Connection '${connection}' not found`);
        }
        
        const pool = poolData.pool;
        
        return {
          ...stats,
          // Add current pool state
          activeConnections: pool._allConnections.length - pool._freeConnections.length,
          totalConnections: pool._allConnections.length,
          freeConnections: pool._freeConnections.length,
          queueLength: pool._connectionQueue.length,
          avgAcquireTime: stats.acquired > 0 ? stats.totalAcquireTime / stats.acquired : 0,
          errorRate: stats.acquired > 0 ? stats.errors / stats.acquired : 0
        };
      },
      
      // Transaction support
      async transaction(callback, connection = 'default') {
        const poolData = pools.get(connection);
        if (!poolData) {
          throw new InternalError(`Connection '${connection}' not found`);
        }
        
        const conn = await poolData.pool.getConnection();
        
        try {
          await conn.beginTransaction();
          
          // Create transaction-scoped db object
          const txDb = {
            async execute(sql, params = []) {
              try {
                const [result] = await conn.execute(sql, params);
                return result;
              } catch (error) {
                await conn.rollback();
                throw error;
              }
            },
            
            async query(sql, params = []) {
              try {
                const [rows] = await conn.execute(sql, params);
                return rows;
              } catch (error) {
                await conn.rollback();
                throw error;
              }
            }
          };
          
          const result = await callback(txDb);
          await conn.commit();
          return result;
        } catch (error) {
          await conn.rollback();
          throw error;
        } finally {
          conn.release();
        }
      },
      
      // Batch operations
      async batch(operations, connection = 'default') {
        const poolData = pools.get(connection);
        if (!poolData) {
          throw new InternalError(`Connection '${connection}' not found`);
        }
        
        const results = [];
        const conn = await poolData.pool.getConnection();
        
        try {
          await conn.beginTransaction();
          
          for (const op of operations) {
            const [result] = await conn.execute(op.sql, op.params || []);
            results.push(result);
          }
          
          await conn.commit();
          return results;
        } catch (error) {
          await conn.rollback();
          throw error;
        } finally {
          conn.release();
        }
      },
      
      // Table management (MySQL-specific)
      async createTable(table, columns, options = {}) {
        // Find primary key columns
        const primaryKeys = columns.filter(col => col.primaryKey).map(col => col.name);
        
        const columnDefs = columns.map(col => {
          let def = `\`${col.name}\` ${col.type}`;
          
          if (col.length) def += `(${col.length})`;
          if (col.unsigned) def += ' UNSIGNED';
          if (col.notNull) def += ' NOT NULL';
          if (col.autoIncrement) def += ' AUTO_INCREMENT';
          if (col.default !== undefined) {
            def += ` DEFAULT ${typeof col.default === 'string' ? `'${col.default}'` : col.default}`;
          }
          
          return def;
        }).join(', ');
        
        let sql = `CREATE TABLE ${options.ifNotExists ? 'IF NOT EXISTS' : ''} \`${table}\` (${columnDefs}`;
        
        // Add primary key constraint
        if (primaryKeys.length > 0) {
          sql += `, PRIMARY KEY (${primaryKeys.map(k => `\`${k}\``).join(', ')})`;
        } else if (options.primaryKey) {
          sql += `, PRIMARY KEY (${Array.isArray(options.primaryKey) ? options.primaryKey.map(k => `\`${k}\``).join(', ') : `\`${options.primaryKey}\``})`;
        }
        
        if (options.indexes) {
          for (const index of options.indexes) {
            sql += `, ${index.unique ? 'UNIQUE ' : ''}INDEX \`${index.name}\` (${index.columns.map(c => `\`${c}\``).join(', ')})`;
          }
        }
        
        sql += `)${options.engine ? ` ENGINE=${options.engine}` : ''}${options.charset ? ` DEFAULT CHARSET=${options.charset}` : ''}`;
        
        return this.execute(sql, [], options.connection);
      },
      
      async dropTable(table, options = {}) {
        const sql = `DROP TABLE ${options.ifExists ? 'IF EXISTS' : ''} \`${table}\``;
        return this.execute(sql, [], options.connection);
      },
      
      async tableExists(table, connection = 'default') {
        const poolData = pools.get(connection);
        if (!poolData) {
          throw new InternalError(`Connection '${connection}' not found`);
        }
        
        const dbName = poolData.config.database;
        const sql = `
          SELECT COUNT(*) as count 
          FROM information_schema.tables 
          WHERE table_schema = ? AND table_name = ?
        `;
        
        const rows = await this.query(sql, [dbName, table], connection);
        return rows[0].count > 0;
      },
      
      // Column management
      async addColumn(table, column, options = {}) {
        let def = `\`${column.name}\` ${column.type}`;
        
        if (column.length) def += `(${column.length})`;
        if (column.unsigned) def += ' UNSIGNED';
        if (column.notNull) def += ' NOT NULL';
        if (column.default !== undefined) {
          def += ` DEFAULT ${typeof column.default === 'string' ? `'${column.default}'` : column.default}`;
        }
        
        let sql = `ALTER TABLE \`${table}\` ADD COLUMN ${def}`;
        
        if (options.after) {
          sql += ` AFTER \`${options.after}\``;
        } else if (options.first) {
          sql += ' FIRST';
        }
        
        return this.execute(sql, [], options.connection);
      },
      
      async dropColumn(table, column, options = {}) {
        const sql = `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``;
        return this.execute(sql, [], options.connection);
      },
      
      async modifyColumn(table, column, options = {}) {
        let def = `\`${column.name}\` ${column.type}`;
        
        if (column.length) def += `(${column.length})`;
        if (column.unsigned) def += ' UNSIGNED';
        if (column.notNull) def += ' NOT NULL';
        if (column.default !== undefined) {
          def += ` DEFAULT ${typeof column.default === 'string' ? `'${column.default}'` : column.default}`;
        }
        
        const sql = `ALTER TABLE \`${table}\` MODIFY COLUMN ${def}`;
        return this.execute(sql, [], options.connection);
      },
      
      // Index management
      async createIndex(table, index, options = {}) {
        const sql = `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX \`${index.name}\` ON \`${table}\` (${index.columns.map(c => `\`${c}\``).join(', ')})`;
        return this.execute(sql, [], options.connection);
      },
      
      async dropIndex(table, indexName, options = {}) {
        const sql = `DROP INDEX \`${indexName}\` ON \`${table}\``;
        return this.execute(sql, [], options.connection);
      },
      
      // Helper to check MySQL version
      async getVersion(connection = 'default') {
        const rows = await this.query('SELECT VERSION() as version', [], connection);
        return rows[0].version;
      },
      
      // MySQL-specific: Check for JSON support
      async hasJsonSupport(connection = 'default') {
        const version = await this.getVersion(connection);
        const major = parseInt(version.split('.')[0]);
        const minor = parseInt(version.split('.')[1]);
        
        // MySQL 5.7+ or MariaDB 10.2+ has JSON support
        if (version.includes('MariaDB')) {
          return major > 10 || (major === 10 && minor >= 2);
        }
        return major > 5 || (major === 5 && minor >= 7);
      },
      
      // Database features
      features() {
        return {
          transactions: true,      // MySQL supports transactions
          returning: false,        // No RETURNING clause (use LAST_INSERT_ID)
          arrays: false,           // No native array support
          json: true,              // JSON support in MySQL 5.7+
          upsert: true,            // INSERT ... ON DUPLICATE KEY UPDATE
          schemas: true,           // Database/schema support
          tableCreation: true,
          requiresIdGeneration: false, // AUTO_INCREMENT handles it
          ilike: false,            // No ILIKE, use LOWER() or COLLATE
          jsonFunctions: true      // JSON_CONTAINS, JSON_EXTRACT, etc.
        };
      },
      
      // ID conversion (MySQL uses numeric IDs)
      convertId(id) {
        return id;
      },
      
      // Get last insert ID
      async getInsertId(result) {
        // Handle both formats: direct result or wrapped result
        if (result.info && result.info.insertId !== undefined) {
          return result.info.insertId;
        }
        return result.insertId;
      },
      
      // Get affected rows
      getAffectedRows(result) {
        // Handle both formats: direct result or wrapped result
        if (result.info && result.info.affectedRows !== undefined) {
          return result.info.affectedRows;
        }
        return result.affectedRows;
      },
      
      // Generate ID (not needed for MySQL - AUTO_INCREMENT)
      generateId() {
        return null;
      },
      
      // Format identifier
      formatIdentifier(name) {
        return `\`${name}\``;
      },
      
      // Escape identifier
      escapeIdentifier(name) {
        return name.replace(/`/g, '``');
      },
      
      // Format parameter placeholder
      formatParam(index) {
        return '?';
      },
      
      // Preprocess SQL (no-op for MySQL)
      preprocessSql(sql) {
        return sql;
      }
    };
    
    // Register implementations for the SQL generic layer
    api.implement('db.features', () => api.db.features());
    api.implement('db.convertId', (context) => api.db.convertId(context.id));
    api.implement('db.getInsertId', (context) => api.db.getInsertId(context.result));
    api.implement('db.getAffectedRows', (context) => api.db.getAffectedRows(context.result));
    api.implement('db.generateId', (context) => api.db.generateId());
    api.implement('db.formatIdentifier', (context) => api.db.formatIdentifier(context.name || context.identifier));
    api.implement('db.escapeIdentifier', (context) => api.db.escapeIdentifier(context.name));
    api.implement('db.formatParam', (context) => api.db.formatParam(context.index));
    api.implement('db.preprocessSql', (context) => api.db.preprocessSql(context.sql));
    api.implement('db.query', (context) => api.db.query(context.sql, context.params));
    api.implement('db.execute', (context) => api.db.execute(context.sql, context.params));
    api.implement('db.transaction', (context) => api.db.transaction(context.callback));
    api.implement('db.connect', () => api.db.connect());
    api.implement('db.disconnect', () => api.db.disconnect());
    api.implement('db.createTable', async (context) => {
      const { table, schema, idProperty } = context;
      
      // Check if table already exists
      try {
        await api.db.query(`SELECT 1 FROM \`${table}\` LIMIT 1`);
        return; // Table exists, no need to create
      } catch (e) {
        // Table doesn't exist, proceed to create it
      }
      
      // Convert schema to columns format
      const columns = [];
      
      // Add ID column
      columns.push({
        name: idProperty || 'id',
        type: 'INT',
        notNull: true,
        autoIncrement: true,
        primaryKey: true
      });
      
      // Add other columns from schema
      if (schema && schema.structure) {
        for (const [field, def] of Object.entries(schema.structure)) {
          if (field === idProperty) continue;
          
          let mysqlType = 'VARCHAR(255)';
          if (def.type === 'number' || def.type === 'integer') {
            mysqlType = 'INT';
          } else if (def.type === 'float' || def.type === 'decimal') {
            mysqlType = 'DECIMAL(10,2)';
          } else if (def.type === 'boolean') {
            mysqlType = 'BOOLEAN';
          } else if (def.type === 'text') {
            mysqlType = 'TEXT';
          } else if (def.type === 'datetime') {
            mysqlType = 'DATETIME';
          } else if (def.type === 'date') {
            mysqlType = 'DATE';
          } else if (def.type === 'json' || def.type === 'object' || def.type === 'array') {
            mysqlType = 'JSON';
          }
          
          columns.push({
            name: field,
            type: mysqlType,
            notNull: def.required === true,
            default: def.default
          });
        }
      }
      
      const options = {
        ifNotExists: true
      };
      
      return api.db.createTable(table, columns, options);
    });
    api.implement('db.dropTable', (context) => api.db.dropTable(context.table, context.options));
    api.implement('db.addColumn', (context) => api.db.addColumn(context.table, context.column, context.options));
    api.implement('db.dropColumn', (context) => api.db.dropColumn(context.table, context.columnName, context.options));
    api.implement('db.addIndex', (context) => api.db.addIndex(context.table, context.columns, context.options));
    api.implement('db.dropIndex', (context) => api.db.dropIndex(context.table, context.indexName, context.options));
    api.implement('db.createMigrationsTable', () => api.db.createMigrationsTable?.() || Promise.resolve());
  }
};