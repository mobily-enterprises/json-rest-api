/**
 * Parses database version string to comparable format
 *
 * @param {string} versionString - Raw version string from database
 * @returns {Object|null} Parsed version with major, minor, patch
 *
 * @example
 * // Input: MySQL version
 * parseVersion("8.0.33");
 * // Output: { major: 8, minor: 0, patch: 33 }
 *
 * @example
 * // Input: PostgreSQL version with extra info
 * parseVersion("14.5 (Ubuntu 14.5-1.pgdg20.04+1)");
 * // Output: { major: 14, minor: 5, patch: 0 }
 *
 * @example
 * // Input: MariaDB version
 * parseVersion("10.6.12-MariaDB");
 * // Output: { major: 10, minor: 6, patch: 12 }
 */
const parseVersion = (versionString) => {
  // MySQL: "8.0.33"
  // PostgreSQL: "14.5 (Ubuntu 14.5-1.pgdg20.04+1)"
  // MariaDB: "10.6.12-MariaDB"
  // SQLite: "3.35.5"

  const match = versionString.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null

  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: match[3] ? parseInt(match[3]) : 0
  }
}

/**
 * Checks if the database supports window functions based on version
 *
 * @param {Object} knex - Knex instance
 * @returns {Promise<boolean>} True if window functions are supported
 *
 * @example
 * // Input: MySQL 8.0.33
 * const supports = await supportsWindowFunctions(knex);
 * // Output: true (MySQL 8.0+ supports window functions)
 *
 * @example
 * // Input: MySQL 5.7.42
 * const supports = await supportsWindowFunctions(knex);
 * // Output: false (MySQL < 8.0 doesn't support window functions)
 *
 * @example
 * // Input: PostgreSQL (any modern version)
 * const supports = await supportsWindowFunctions(knex);
 * // Output: true (PostgreSQL 8.4+ supports window functions)
 *
 * @example
 * // Input: SQLite 3.24.0
 * const supports = await supportsWindowFunctions(knex);
 * // Output: false (SQLite needs 3.25.0+)
 *
 * @description
 * Used by:
 * - buildWindowedIncludeQuery to validate before using window functions
 * - rest-api-knex-plugin to determine query strategies
 *
 * Purpose:
 * - Prevents runtime errors by checking feature support
 * - Enables fallback strategies for older databases
 * - Provides clear error messages about version requirements
 *
 * Data flow:
 * 1. Identifies database client type from Knex config
 * 2. For version-dependent databases, queries version string
 * 3. Parses version and compares against known thresholds
 * 4. Returns boolean indicating support
 * 5. Falls back to false if version can't be determined
 *
 * Version requirements:
 * - PostgreSQL: 8.4+ (all modern versions)
 * - MySQL: 8.0+
 * - MariaDB: 10.2+
 * - SQLite: 3.25.0+
 * - SQL Server: 2005+ (all versions)
 * - Oracle: Supported (long-standing feature)
 */
export const supportsWindowFunctions = async (knex) => {
  try {
    const client = knex.client.config.client

    let versionString

    switch (client) {
      case 'pg':
      case 'postgresql':
        // PostgreSQL 8.4+ supports window functions (all modern versions)
        return true

      case 'mysql':
      case 'mysql2':
        try {
          const row = await knex.first(knex.raw('VERSION() as version'))
          const mysqlVersion = parseVersion(row.version)

          return mysqlVersion && mysqlVersion.major >= 8
        } catch (dbError) {
          console.warn(`[supportsWindowFunctions] Failed to get MySQL version: ${dbError.message}`)
          return false
        }

      case 'sqlite3':
      case 'better-sqlite3':
        try {
          versionString = await knex.raw('SELECT sqlite_version() as version')
          const sqliteVersion = versionString[0].version
          // SQLite 3.25.0+ supports window functions
          const parsed = parseVersion(sqliteVersion)
          return parsed && (parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 25))
        } catch (dbError) {
          console.warn(`[supportsWindowFunctions] Failed to get SQLite version: ${dbError.message}`)
          return false
        }

      case 'mssql':
        // SQL Server 2005+ supports window functions
        return true

      case 'oracledb':
        // Oracle has supported window functions for a long time
        return true

      default:
        // For MariaDB, we need to check if it's actually MariaDB or MySQL
        if (client.includes('maria')) {
          try {
            versionString = await knex.raw('SELECT VERSION() as version')
            const version = versionString[0].version.toLowerCase()
            if (version.includes('mariadb')) {
              const mariaVersion = parseVersion(version)
              // MariaDB 10.2+ supports window functions
              return mariaVersion && (mariaVersion.major > 10 ||
                (mariaVersion.major === 10 && mariaVersion.minor >= 2))
            }
          } catch (dbError) {
            console.warn(`[supportsWindowFunctions] Failed to get MariaDB version: ${dbError.message}`)
            return false
          }
        }
        return false
    }
  } catch (error) {
    // Log error with context
    console.error('[supportsWindowFunctions] Unexpected error checking database capabilities:', {
      error: error.message,
      stack: error.stack,
      client: knex?.client?.config?.client || 'unknown'
    })
    // If we can't determine, assume no support for safety
    return false
  }
}

/**
 * Gets database info for error messages and capability checks
 *
 * @param {Object} knex - Knex instance
 * @returns {Promise<Object>} Database info with client and version
 *
 * @example
 * // Input: MySQL connection
 * const info = await getDatabaseInfo(knex);
 * // Output: { client: 'MySQL', version: '8.0.33' }
 *
 * @example
 * // Input: PostgreSQL connection
 * const info = await getDatabaseInfo(knex);
 * // Output: {
 * //   client: 'PostgreSQL',
 * //   version: 'PostgreSQL 14.5 (Ubuntu 14.5-1.pgdg20.04+1)'
 * // }
 *
 * @example
 * // Input: Connection error case
 * const info = await getDatabaseInfo(knexWithError);
 * // Output: {
 * //   client: 'MySQL',
 * //   version: 'unknown',
 * //   error: 'Connection refused'
 * // }
 *
 * @description
 * Used by:
 * - Error messages to show which database/version lacks a feature
 * - Capability detection for feature flags
 * - Debugging connection issues
 *
 * Purpose:
 * - Provides human-readable database identification
 * - Helps users understand version requirements
 * - Enables detailed error messages
 * - Gracefully handles query failures
 *
 * Data flow:
 * 1. Identifies client type from Knex config
 * 2. Runs version query specific to each database
 * 3. Returns formatted info object
 * 4. Includes error details if version query fails
 * 5. Falls back to 'unknown' for unsupported databases
 */
export const getDatabaseInfo = async (knex) => {
  try {
    const client = knex.client.config.client

    let versionString
    switch (client) {
      case 'mysql':
      case 'mysql2':
        try {
          const row = await knex.first(knex.raw('VERSION() as version'))
          return { client: 'MySQL', version: row.version }
        } catch (dbError) {
          console.warn(`[getDatabaseInfo] Failed to get MySQL version: ${dbError.message}`)
          return { client: 'MySQL', version: 'unknown', error: dbError.message }
        }

      case 'sqlite3':
      case 'better-sqlite3':
        try {
          versionString = await knex.raw('SELECT sqlite_version() as version')
          return { client: 'SQLite', version: versionString[0].version }
        } catch (dbError) {
          console.warn(`[getDatabaseInfo] Failed to get SQLite version: ${dbError.message}`)
          return { client: 'SQLite', version: 'unknown', error: dbError.message }
        }

      case 'pg':
      case 'postgresql':
        try {
          versionString = await knex.raw('SELECT version() as version')
          return { client: 'PostgreSQL', version: versionString.rows[0].version }
        } catch (dbError) {
          console.warn(`[getDatabaseInfo] Failed to get PostgreSQL version: ${dbError.message}`)
          return { client: 'PostgreSQL', version: 'unknown', error: dbError.message }
        }

      default:
        return { client, version: 'unknown' }
    }
  } catch (error) {
    // Log unexpected errors
    console.error('[getDatabaseInfo] Unexpected error getting database info:', {
      error: error.message,
      stack: error.stack,
      client: knex?.client?.config?.client || 'unknown'
    })

    return {
      client: knex?.client?.config?.client || 'unknown',
      version: 'unknown',
      error: error.message
    }
  }
}
