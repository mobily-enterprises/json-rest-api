/**
 * Detects database capabilities based on client type and version
 */

/**
 * Parse version string to comparable format
 */
const parseVersion = (versionString) => {
  // MySQL: "8.0.33"
  // PostgreSQL: "14.5 (Ubuntu 14.5-1.pgdg20.04+1)"
  // MariaDB: "10.6.12-MariaDB"
  // SQLite: "3.35.5"
  
  const match = versionString.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: match[3] ? parseInt(match[3]) : 0
  };
};

/**
 * Check if database supports window functions
 */
export const supportsWindowFunctions = async (knex) => {
  try {
    const client = knex.client.config.client;
    
    let versionString;
    
    switch (client) {
      case 'pg':
      case 'postgresql':
        // PostgreSQL 8.4+ supports window functions (all modern versions)
        return true;
        
      case 'mysql':
      case 'mysql2':
        try {
          versionString = await knex.raw('SELECT VERSION() as version');
          const mysqlVersion = parseVersion(versionString[0].version);
          return mysqlVersion && mysqlVersion.major >= 8;
        } catch (dbError) {
          console.warn(`[supportsWindowFunctions] Failed to get MySQL version: ${dbError.message}`);
          return false;
        }
        
      case 'sqlite3':
      case 'better-sqlite3':
        try {
          versionString = await knex.raw('SELECT sqlite_version() as version');
          const sqliteVersion = versionString[0].version;
          // SQLite 3.25.0+ supports window functions
          const parsed = parseVersion(sqliteVersion);
          return parsed && (parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 25));
        } catch (dbError) {
          console.warn(`[supportsWindowFunctions] Failed to get SQLite version: ${dbError.message}`);
          return false;
        }
        
      case 'mssql':
        // SQL Server 2005+ supports window functions
        return true;
        
      case 'oracledb':
        // Oracle has supported window functions for a long time
        return true;
        
      default:
        // For MariaDB, we need to check if it's actually MariaDB or MySQL
        if (client.includes('maria')) {
          try {
            versionString = await knex.raw('SELECT VERSION() as version');
            const version = versionString[0].version.toLowerCase();
            if (version.includes('mariadb')) {
              const mariaVersion = parseVersion(version);
              // MariaDB 10.2+ supports window functions
              return mariaVersion && (mariaVersion.major > 10 || 
                (mariaVersion.major === 10 && mariaVersion.minor >= 2));
            }
          } catch (dbError) {
            console.warn(`[supportsWindowFunctions] Failed to get MariaDB version: ${dbError.message}`);
            return false;
          }
        }
        return false;
    }
  } catch (error) {
    // Log error with context
    console.error('[supportsWindowFunctions] Unexpected error checking database capabilities:', {
      error: error.message,
      stack: error.stack,
      client: knex?.client?.config?.client || 'unknown'
    });
    // If we can't determine, assume no support for safety
    return false;
  }
};

/**
 * Get database info for error messages
 */
export const getDatabaseInfo = async (knex) => {
  try {
    const client = knex.client.config.client;
    
    let versionString;
    switch (client) {
      case 'mysql':
      case 'mysql2':
        try {
          versionString = await knex.raw('SELECT VERSION() as version');
          return { client: 'MySQL', version: versionString[0].version };
        } catch (dbError) {
          console.warn(`[getDatabaseInfo] Failed to get MySQL version: ${dbError.message}`);
          return { client: 'MySQL', version: 'unknown', error: dbError.message };
        }
        
      case 'sqlite3':
      case 'better-sqlite3':
        try {
          versionString = await knex.raw('SELECT sqlite_version() as version');
          return { client: 'SQLite', version: versionString[0].version };
        } catch (dbError) {
          console.warn(`[getDatabaseInfo] Failed to get SQLite version: ${dbError.message}`);
          return { client: 'SQLite', version: 'unknown', error: dbError.message };
        }
        
      case 'pg':
      case 'postgresql':
        try {
          versionString = await knex.raw('SELECT version() as version');
          return { client: 'PostgreSQL', version: versionString.rows[0].version };
        } catch (dbError) {
          console.warn(`[getDatabaseInfo] Failed to get PostgreSQL version: ${dbError.message}`);
          return { client: 'PostgreSQL', version: 'unknown', error: dbError.message };
        }
        
      default:
        return { client, version: 'unknown' };
    }
  } catch (error) {
    // Log unexpected errors
    console.error('[getDatabaseInfo] Unexpected error getting database info:', {
      error: error.message,
      stack: error.stack,
      client: knex?.client?.config?.client || 'unknown'
    });
    
    return { 
      client: knex?.client?.config?.client || 'unknown', 
      version: 'unknown',
      error: error.message 
    };
  }
};