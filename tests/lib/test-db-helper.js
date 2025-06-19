import { Api } from '../../lib/api.js';
import { MemoryPlugin } from '../../plugins/memory.js';
import { MySQLPlugin } from '../../plugins/mysql.js';
import mysql from 'mysql2/promise';

/**
 * Test Database Helper
 * 
 * Provides environment-based database selection for tests.
 * Default: MemoryPlugin (AlaSQL) - no setup required
 * MySQL: Set DB_TYPE=mysql with MYSQL_USER and MYSQL_PASSWORD
 */

// Get the database type from environment
export function getDbType() {
  return process.env.DB_TYPE || 'memory';
}

// Get the appropriate plugin and configuration
export function getTestPlugin() {
  const dbType = getDbType();
  
  switch(dbType) {
    case 'mysql':
      // Validate required env vars
      if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
        console.error('❌ MySQL credentials not provided!');
        console.error('   Please set environment variables:');
        console.error('   MYSQL_USER=<username> MYSQL_PASSWORD=<password>');
        console.error('   Optional: MYSQL_HOST=<host> MYSQL_DATABASE=<database>');
        console.error('');
        console.error('   Example: DB_TYPE=mysql MYSQL_USER=root MYSQL_PASSWORD=mypass npm test');
        process.exit(1);
      }
      
      return {
        name: 'MySQL',
        plugin: MySQLPlugin,
        config: {
          connection: {
            host: process.env.MYSQL_HOST || 'localhost',
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE || 'jsonrestapi_test',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
          }
        },
        cleanup: cleanupMySQL
      };
      
    case 'memory':
    default:
      return {
        name: 'Memory (AlaSQL)',
        plugin: MemoryPlugin,
        config: {},
        cleanup: cleanupMemory
      };
  }
}

// Create and setup test API instance
export async function setupTestApi(options = {}) {
  const { plugin, config } = getTestPlugin();
  const api = new Api(options);
  api.use(plugin, config);
  return api;
}

// Clean database between tests
export async function cleanDatabase(api) {
  const { cleanup } = getTestPlugin();
  await cleanup(api);
}

// Cleanup function for Memory/AlaSQL
async function cleanupMemory(api) {
  // Recreate the AlaSQL database
  if (api._alasqlDb) {
    // Drop all tables
    const tables = api._alasqlDb.tables;
    for (const tableName in tables) {
      try {
        api._alasqlDb.exec(`DROP TABLE \`${tableName}\``);
      } catch (e) {
        // Ignore errors
      }
    }
  }
}

// Cleanup function for MySQL
async function cleanupMySQL(api) {
  if (api._mysqlPools) {
    const pool = api._mysqlPools.get('default')?.pool;
    if (pool) {
      // Get all tables
      const [tables] = await pool.query(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
      );
      
      // Disable foreign key checks
      await pool.query('SET FOREIGN_KEY_CHECKS = 0');
      
      // Drop all tables
      for (const { TABLE_NAME } of tables) {
        await pool.query(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);
      }
      
      // Re-enable foreign key checks
      await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  }
}

// Create MySQL database if it doesn't exist
export async function ensureMySQLDatabase() {
  if (getDbType() !== 'mysql') return;
  
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD
  });
  
  const database = process.env.MYSQL_DATABASE || 'jsonrestapi_test';
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  await connection.end();
}

// Robust teardown helper
export async function robustTeardown({ api, connection }) {
  const errors = [];
  
  try {
    if (api) {
      // Try to disconnect
      if (typeof api.disconnect === 'function') {
        await api.disconnect().catch(e => errors.push(e));
      }
      
      // Clean up MySQL pools
      if (api._mysqlPools) {
        for (const [, { pool }] of api._mysqlPools) {
          await pool.end().catch(e => errors.push(e));
        }
      }
    }
    
    if (connection) {
      await connection.end().catch(e => errors.push(e));
    }
  } catch (e) {
    errors.push(e);
  }
  
  if (errors.length > 0 && process.env.DEBUG) {
    console.error('Teardown errors:', errors);
  }
}