import fs from 'fs/promises';
import { watch } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export const ConfigPlugin = {
  install(api, options = {}) {
    const {
      schemas = {},
      sources = ['env', 'file'],
      envPrefix = 'API_',
      configPath = process.cwd(),
      configFile = 'config.json',
      watch = process.env.NODE_ENV === 'development',
      validateOnChange = true,
      secretsProvider = null,
      defaults = {},
      required = [],
      transformers = {},
      cacheDuration = 5000
    } = options;

    const config = new ConfigManager({
      schemas,
      sources,
      envPrefix,
      configPath,
      configFile,
      watch,
      validateOnChange,
      secretsProvider,
      defaults,
      required,
      transformers,
      cacheDuration
    });

    // Load initial configuration synchronously by storing the promise
    config._loadPromise = config.load().then(() => {
      // Only validate on startup if validateOnStartup is true (default false)
      if (options.validateOnStartup) {
        const errors = config.validate();
        if (errors.length > 0) {
          throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
      }
    });

    // Expose config API
    api.config = config;

    // Add config endpoint if HTTP plugin is loaded
    api.hook('afterHTTPInit', () => {
      if (api.app && options.exposeEndpoint !== false) {
        api.app.get('/api/config', (req, res) => {
          const publicConfig = config.getPublic();
          res.json(publicConfig);
        });

        api.app.get('/api/config/schema', (req, res) => {
          res.json(config.getSchemas());
        });
      }
    });
  }
};

class ConfigManager extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.config = { ...options.defaults };
    this.schemas = options.schemas;
    this.watchers = new Map();
    this.cache = new Map();
    this.lastLoad = 0;
    this.secretsCache = new Map();
  }

  async load() {
    let config = { ...this.options.defaults };

    // Load from each source in order
    for (const source of this.options.sources) {
      const sourceConfig = await this.loadSource(source);
      Object.assign(config, sourceConfig);
    }

    // Apply to current config temporarily for secrets processing
    this.config = config;
    
    // Load secrets
    if (this.options.secretsProvider) {
      config = await this.loadSecrets();
    }

    // Apply transformers
    for (const [key, transformer] of Object.entries(this.options.transformers)) {
      if (config[key] !== undefined) {
        config[key] = await transformer(config[key], config);
      }
    }

    // Validate and emit changes
    const oldConfig = this.config;
    this.config = config;
    this.lastLoad = Date.now();

    // Emit change events
    for (const key of Object.keys(config)) {
      if (oldConfig[key] !== config[key]) {
        this.emit('change', key, config[key], oldConfig[key]);
        this.emit(`change:${key}`, config[key], oldConfig[key]);
      }
    }

    // Start watching if enabled
    if (this.options.watch && this.watchers.size === 0) {
      await this.startWatching();
    }

    return config;
  }

  async loadSource(source) {
    switch (source) {
      case 'env':
        return this.loadFromEnv();
      
      case 'file':
        return this.loadFromFile();
      
      case 'args':
        return this.loadFromArgs();
      
      default:
        if (typeof source === 'function') {
          return await source(this);
        }
        throw new Error(`Unknown config source: ${source}`);
    }
  }

  loadFromEnv() {
    const config = {};
    const prefix = this.options.envPrefix;

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix)) {
        const configKey = this.envKeyToConfigKey(key.substring(prefix.length));
        config[configKey] = this.parseEnvValue(value);
      }
    }

    return config;
  }

  async loadFromFile() {
    const filePath = path.join(this.options.configPath, this.options.configFile);
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      if (filePath.endsWith('.json')) {
        return JSON.parse(content);
      } else if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
        // Dynamic import for JS config files
        const module = await import(`file://${filePath}?t=${Date.now()}`);
        return module.default || module.config;
      }
      
      return {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Failed to load config file ${filePath}:`, err.message);
      }
      return {};
    }
  }

  loadFromArgs() {
    const config = {};
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        let value = true;
        
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          value = this.parseEnvValue(args[++i]);
        }
        
        const configKey = this.argKeyToConfigKey(key);
        config[configKey] = value;
      }
    }

    return config;
  }

  async loadSecrets() {
    const provider = this.options.secretsProvider;
    const secrets = {};

    // Recursively find and replace secret references
    const processValue = async (obj, path = '') => {
      if (typeof obj === 'string' && obj.startsWith('secret:')) {
        const secretKey = obj.substring(7);
        
        // Check cache first
        if (this.secretsCache.has(secretKey)) {
          return this.secretsCache.get(secretKey);
        } else {
          const secretValue = await provider.get(secretKey);
          this.secretsCache.set(secretKey, secretValue);
          return secretValue;
        }
      } else if (typeof obj === 'object' && obj !== null) {
        const result = Array.isArray(obj) ? [] : {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = await processValue(value, path ? `${path}.${key}` : key);
        }
        return result;
      }
      return obj;
    };

    // Process the entire config
    return await processValue(this.config);
  }

  async startWatching() {
    const filePath = path.join(this.options.configPath, this.options.configFile);

    try {
      const watcher = watch(filePath, async (eventType) => {
        if (eventType === 'change') {
          // Debounce rapid changes
          clearTimeout(this.reloadTimer);
          this.reloadTimer = setTimeout(async () => {
            console.log('Config file changed, reloading...');
            
            try {
              await this.load();
              
              if (this.options.validateOnChange) {
                const errors = this.validate();
                if (errors.length > 0) {
                  console.error('Config validation errors after reload:', errors);
                  this.emit('error', errors);
                }
              }
              
              this.emit('reload', this.config);
            } catch (err) {
              console.error('Failed to reload config:', err);
              this.emit('error', err);
            }
          }, 100);
        }
      });

      this.watchers.set(filePath, watcher);
    } catch (err) {
      console.warn('Failed to watch config file:', err.message);
    }

    // Also watch environment for changes (in development)
    if (process.env.NODE_ENV === 'development') {
      this.envWatcher = setInterval(async () => {
        const envConfig = this.loadFromEnv();
        let changed = false;

        for (const [key, value] of Object.entries(envConfig)) {
          if (this.config[key] !== value) {
            changed = true;
            break;
          }
        }

        if (changed) {
          await this.load();
          this.emit('reload', this.config);
        }
      }, 5000);
    }
  }

  async stop() {
    // Close file watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear interval
    if (this.envWatcher) {
      clearInterval(this.envWatcher);
      this.envWatcher = null;
    }

    // Clear reload timer
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  validate() {
    const errors = [];

    // Check required fields
    for (const field of this.options.required) {
      if (this.get(field) === undefined) {
        errors.push(`Required config field missing: ${field}`);
      }
    }

    // Validate against schemas
    for (const [key, schema] of Object.entries(this.schemas)) {
      const value = this.get(key);
      
      if (value !== undefined) {
        const error = this.validateValue(key, value, schema);
        if (error) errors.push(error);
      } else if (schema.required) {
        errors.push(`Required config field missing: ${key}`);
      }
    }

    return errors;
  }

  validateValue(key, value, schema) {
    // Type validation
    if (schema.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      
      if (schema.type !== actualType) {
        return `Config ${key} must be of type ${schema.type}, got ${actualType}`;
      }
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(value)) {
      return `Config ${key} must be one of: ${schema.enum.join(', ')}`;
    }

    // Number validations
    if (schema.type === 'number') {
      if (schema.min !== undefined && value < schema.min) {
        return `Config ${key} must be >= ${schema.min}`;
      }
      if (schema.max !== undefined && value > schema.max) {
        return `Config ${key} must be <= ${schema.max}`;
      }
    }

    // String validations
    if (schema.type === 'string') {
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          return `Config ${key} must match pattern: ${schema.pattern}`;
        }
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return `Config ${key} must be at least ${schema.minLength} characters`;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return `Config ${key} must be at most ${schema.maxLength} characters`;
      }
    }

    // Array validations
    if (schema.type === 'array') {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return `Config ${key} must have at least ${schema.minItems} items`;
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return `Config ${key} must have at most ${schema.maxItems} items`;
      }
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const itemError = this.validateValue(`${key}[${i}]`, value[i], schema.items);
          if (itemError) return itemError;
        }
      }
    }

    // Custom validator
    if (schema.validator) {
      const result = schema.validator(value, this.config);
      if (result !== true) {
        return `Config ${key} validation failed: ${result}`;
      }
    }

    return null;
  }

  async ensureLoaded() {
    if (this._loadPromise) {
      await this._loadPromise;
      this._loadPromise = null;
    }
  }

  get(key, defaultValue) {
    // Check cache for computed values
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (Date.now() - cached.time < this.options.cacheDuration) {
        return cached.value;
      }
      this.cache.delete(key);
    }

    // Handle nested keys
    if (key.includes('.')) {
      const parts = key.split('.');
      let value = this.config;
      
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = value[part];
        } else {
          return defaultValue;
        }
      }
      
      return value !== undefined ? value : defaultValue;
    }

    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  set(key, value) {
    // Handle nested keys
    if (key.includes('.')) {
      const parts = key.split('.');
      const lastPart = parts.pop();
      let target = this.config;
      
      for (const part of parts) {
        if (!target[part] || typeof target[part] !== 'object') {
          target[part] = {};
        }
        target = target[part];
      }
      
      const oldValue = target[lastPart];
      target[lastPart] = value;
      
      this.emit('change', key, value, oldValue);
      this.emit(`change:${key}`, value, oldValue);
    } else {
      const oldValue = this.config[key];
      this.config[key] = value;
      
      this.emit('change', key, value, oldValue);
      this.emit(`change:${key}`, value, oldValue);
    }

    // Clear cache
    this.cache.delete(key);
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  getAll() {
    return { ...this.config };
  }

  getPublic() {
    const publicConfig = {};

    for (const [key, value] of Object.entries(this.config)) {
      const schema = this.schemas[key];
      
      // Include if not marked as private
      if (!schema?.private) {
        // Mask sensitive values
        if (schema?.sensitive) {
          publicConfig[key] = '***';
        } else {
          publicConfig[key] = value;
        }
      }
    }

    return publicConfig;
  }

  getSchemas() {
    const schemas = {};

    for (const [key, schema] of Object.entries(this.schemas)) {
      if (!schema.private) {
        schemas[key] = {
          ...schema,
          current: this.get(key)
        };
      }
    }

    return schemas;
  }

  // Computed values with caching
  compute(key, fn) {
    // Check cache first
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (Date.now() - cached.time < this.options.cacheDuration) {
        return cached.value;
      }
      this.cache.delete(key);
    }
    
    const value = fn(this.config);
    this.cache.set(key, { value, time: Date.now() });
    return value;
  }

  // Watch for specific config changes
  watch(key, callback) {
    this.on(`change:${key}`, callback);
    
    // Return unwatch function
    return () => {
      this.off(`change:${key}`, callback);
    };
  }

  // Helper methods
  envKeyToConfigKey(envKey) {
    // SOME_ENV_VAR -> someEnvVar
    return envKey
      .toLowerCase()
      .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  argKeyToConfigKey(argKey) {
    // some-arg-key -> someArgKey
    return argKey
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  parseEnvValue(value) {
    // Try to parse as JSON first
    try {
      return JSON.parse(value);
    } catch {
      // Handle special string values
      if (value === 'true') return true;
      if (value === 'false') return false;
      if (value === 'null') return null;
      if (value === 'undefined') return undefined;
      
      // Try to parse as number
      if (/^-?\d+(\.\d+)?$/.test(value)) {
        return Number(value);
      }
      
      // Return as string
      return value;
    }
  }
}