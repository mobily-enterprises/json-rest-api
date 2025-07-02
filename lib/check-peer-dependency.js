/**
 * Utility for checking and handling peer dependencies in plugins
 */

/**
 * Checks if a peer dependency is available and handles missing dependencies gracefully
 * 
 * @param {string} packageName - The name of the package to check
 * @param {Object} options - Configuration options
 * @param {boolean} [options.optional=false] - Whether the dependency is optional
 * @param {*} [options.fallback=null] - Fallback implementation if optional and missing
 * @param {string} [options.installCommand] - Custom install command to show in error/warning
 * @param {Function} [options.log] - Logger function for warnings
 * @param {string} [options.pluginName] - Name of the plugin requiring the dependency
 * @returns {*} The required module or fallback
 * @throws {Error} If dependency is required but missing
 */
export function checkPeerDependency(packageName, options = {}) {
  const {
    optional = false,
    fallback = null,
    installCommand = `npm install ${packageName}`,
    log = console,
    pluginName = 'This plugin'
  } = options;

  try {
    // Try to import the module dynamically
    // Using createRequire for better compatibility
    const module = require(packageName);
    return module;
  } catch (error) {
    // Check if it's actually a module not found error
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes(packageName)) {
      // Some other error occurred, re-throw it
      throw error;
    }

    const message = `${pluginName} requires "${packageName}". Please install it:\n  ${installCommand}`;

    if (optional && fallback !== null) {
      // Log warning but continue with fallback
      if (log && log.warn) {
        log.warn(message);
        log.warn(`Using fallback implementation (limited functionality)`);
      }
      return fallback;
    }

    // Required dependency is missing
    const fullError = new Error(
      `${message}\n\n` +
      `This is a peer dependency of the jsonrestapi package.`
    );
    fullError.code = 'PEER_DEPENDENCY_MISSING';
    fullError.packageName = packageName;
    throw fullError;
  }
}

/**
 * Async version using dynamic import
 * Useful for ESM environments
 */
export async function checkPeerDependencyAsync(packageName, options = {}) {
  const {
    optional = false,
    fallback = null,
    installCommand = `npm install ${packageName}`,
    log = console,
    pluginName = 'This plugin'
  } = options;

  try {
    // Try dynamic import
    const module = await import(packageName);
    return module.default || module;
  } catch (error) {
    // Check if it's actually a module not found error
    if (error.code !== 'ERR_MODULE_NOT_FOUND' && !error.message.includes(packageName)) {
      // Some other error occurred, re-throw it
      throw error;
    }

    const message = `${pluginName} requires "${packageName}". Please install it:\n  ${installCommand}`;

    if (optional && fallback !== null) {
      // Log warning but continue with fallback
      if (log && log.warn) {
        log.warn(message);
        log.warn(`Using fallback implementation (limited functionality)`);
      }
      return fallback;
    }

    // Required dependency is missing
    const fullError = new Error(
      `${message}\n\n` +
      `This is a peer dependency of the jsonrestapi package.`
    );
    fullError.code = 'PEER_DEPENDENCY_MISSING';
    fullError.packageName = packageName;
    throw fullError;
  }
}

/**
 * Creates a basic query string parser fallback
 * For use when qs is not available
 */
export function createBasicQueryParser() {
  return {
    parse(queryString, options = {}) {
      if (!queryString) return {};
      
      // Remove leading ? if present
      if (queryString.startsWith('?')) {
        queryString = queryString.slice(1);
      }

      const result = {};
      const params = new URLSearchParams(queryString);

      for (const [key, value] of params) {
        // Try to handle bracket notation like filter[status]
        const bracketMatch = key.match(/^(\w+)\[(\w+)\]$/);
        if (bracketMatch) {
          const [, objName, propName] = bracketMatch;
          if (!result[objName]) result[objName] = {};
          result[objName][propName] = value;
        } else {
          // Simple key-value
          result[key] = value;
        }
      }

      return result;
    },

    stringify(obj) {
      const params = new URLSearchParams();
      
      const addParams = (obj, prefix = '') => {
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}[${key}]` : key;
          
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            addParams(value, fullKey);
          } else if (Array.isArray(value)) {
            value.forEach(v => params.append(fullKey, v));
          } else {
            params.append(fullKey, value);
          }
        }
      };
      
      addParams(obj);
      return params.toString();
    }
  };
}