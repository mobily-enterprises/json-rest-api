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
  const client = knex.client.config.client;
  
  try {
    let versionString;
    
    switch (client) {
      case 'pg':
      case 'postgresql':
        // PostgreSQL 8.4+ supports window functions (all modern versions)
        return true;
        
      case 'mysql':
      case 'mysql2':
        versionString = await knex.raw('SELECT VERSION() as version');
        const mysqlVersion = parseVersion(versionString[0].version);
        return mysqlVersion && mysqlVersion.major >= 8;
        
      case 'sqlite3':
      case 'better-sqlite3':
        versionString = await knex.raw('SELECT sqlite_version() as version');
        const sqliteVersion = versionString[0].version;
        // SQLite 3.25.0+ supports window functions
        const parsed = parseVersion(sqliteVersion);
        return parsed && (parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 25));
        
      case 'mssql':
        // SQL Server 2005+ supports window functions
        return true;
        
      case 'oracledb':
        // Oracle has supported window functions for a long time
        return true;
        
      default:
        // For MariaDB, we need to check if it's actually MariaDB or MySQL
        if (client.includes('maria')) {
          versionString = await knex.raw('SELECT VERSION() as version');
          const version = versionString[0].version.toLowerCase();
          if (version.includes('mariadb')) {
            const mariaVersion = parseVersion(version);
            // MariaDB 10.2+ supports window functions
            return mariaVersion && (mariaVersion.major > 10 || 
              (mariaVersion.major === 10 && mariaVersion.minor >= 2));
          }
        }
        return false;
    }
  } catch (error) {
    // If we can't determine, assume no support
    console.warn('Could not determine database window function support:', error);
    return false;
  }
};

/**
 * Get database info for error messages
 */
export const getDatabaseInfo = async (knex) => {
  const client = knex.client.config.client;
  
  try {
    let versionString;
    switch (client) {
      case 'mysql':
      case 'mysql2':
        versionString = await knex.raw('SELECT VERSION() as version');
        return { client: 'MySQL', version: versionString[0].version };
        
      case 'sqlite3':
      case 'better-sqlite3':
        versionString = await knex.raw('SELECT sqlite_version() as version');
        return { client: 'SQLite', version: versionString[0].version };
        
      case 'pg':
      case 'postgresql':
        versionString = await knex.raw('SELECT version() as version');
        return { client: 'PostgreSQL', version: versionString.rows[0].version };
        
      default:
        return { client, version: 'unknown' };
    }
  } catch (error) {
    return { client, version: 'unknown' };
  }
};