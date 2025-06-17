import semver from 'semver';

// Global registry for all APIs
const globalRegistry = new Map();

/**
 * Core API class with plugin system for JSON REST APIs
 */
export class Api {
  constructor(options = {}) {
    
    // Core properties
    this.options = {
      idProperty: 'id',
      name: null,
      version: null,
      artificialDelay: 0,  // Milliseconds to delay operations (for testing)
      ...options
    };
    
    // Plugin system
    this.plugins = [];
    this.hooks = new Map();
    
    // Storage for different implementations
    this.implementers = new Map();
    
    // Initialize hook points
    this._initializeHooks();
    
    // Auto-register if name and version provided
    if (this.options.name && this.options.version) {
      this.register();
    }
  }
  
  /**
   * Register this API in the global registry
   */
  register() {
    const { name, version } = this.options;
    
    if (!name || !version) {
      throw new Error('API name and version required for registration');
    }
    
    if (!globalRegistry.has(name)) {
      globalRegistry.set(name, new Map());
    }
    
    globalRegistry.get(name).set(version, this);
    return this;
  }
  
  /**
   * Get all versions of an API by name
   */
  static getVersions(name) {
    const versions = globalRegistry.get(name);
    return versions ? Array.from(versions.keys()) : [];
  }
  
  /**
   * Get a compatible API version
   */
  static get(name, version = 'latest') {
    const versions = globalRegistry.get(name);
    if (!versions) return null;
    
    // Sort versions for lookup
    const sortedVersions = Array.from(versions.entries())
      .sort(([a], [b]) => semver.compare(b, a));
    
    // Latest version
    if (version === 'latest') {
      return sortedVersions[0]?.[1];
    }
    
    // Exact match
    if (versions.has(version)) {
      return versions.get(version);
    }
    
    // Compatible version
    for (const [ver, api] of sortedVersions) {
      // If no operators, treat as minimum version
      if (!version.match(/[<>^~]/)) {
        if (semver.gte(ver, version)) {
          return api;
        }
      } else if (semver.satisfies(ver, version)) {
        return api;
      }
    }
    
    return null;
  }
  
  /**
   * Alias for get() with a more explicit name
   */
  static find(name, version = 'latest') {
    return this.get(name, version);
  }
  
  /**
   * Enhanced registry access
   */
  static registry = {
    get(name, version = 'latest') {
      return Api.get(name, version);
    },
    
    find(name, version = 'latest') {
      return Api.get(name, version);
    },
    
    list() {
      return Api.getRegistry();
    },
    
    has(name, version) {
      if (!name) return false;
      const versions = globalRegistry.get(name);
      if (!versions) return false;
      return version ? versions.has(version) : versions.size > 0;
    },
    
    versions(name) {
      return Api.getVersions(name);
    }
  }
  
  /**
   * Get all registered APIs
   */
  static getRegistry() {
    const registry = {};
    for (const [name, versions] of globalRegistry) {
      registry[name] = Array.from(versions.keys()).sort(semver.rcompare);
    }
    return registry;
  }
  

  /**
   * Add a plugin to the API
   */
  use(plugin, options = {}) {
    if (typeof plugin.install === 'function') {
      plugin.install(this, options);
    }
    this.plugins.push({ plugin, options });
    return this;
  }
  
  /**
   * Check if a plugin is already installed
   */
  hasPlugin(plugin) {
    return this.plugins.some(p => p.plugin === plugin);
  }

  /**
   * Register a hook handler
   */
  hook(name, handler, priority = 50) {
    if (!this.hooks.has(name)) {
      this.hooks.set(name, []);
    }
    const handlers = this.hooks.get(name);
    handlers.push({ handler, priority });
    handlers.sort((a, b) => a.priority - b.priority);
    return this;
  }

  /**
   * Execute hooks
   */
  async executeHook(name, context) {
    const handlers = this.hooks.get(name) || [];
    for (const { handler } of handlers) {
      const result = await handler(context);
      if (result === false) break; // Allow hooks to stop the chain
    }
    return context;
  }
  
  /**
   * Apply artificial delay if configured
   */
  async _applyDelay(options = {}) {
    const delay = options.artificialDelay ?? this.options.artificialDelay;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Register an implementation for a method
   */
  implement(method, handler) {
    this.implementers.set(method, handler);
    return this;
  }

  /**
   * Initialize core hooks
   */
  _initializeHooks() {
    const hookNames = [
      'beforeValidate',
      'afterValidate',
      'beforeGet',
      'afterGet',
      'beforeQuery',
      'afterQuery',
      'beforeInsert',
      'afterInsert',
      'beforeUpdate',
      'afterUpdate',
      'beforeDelete',
      'afterDelete',
      'beforeSend',
      'transformResult'
    ];
    
    hookNames.forEach(name => this.hooks.set(name, []));
  }

  /**
   * Get a single resource
   */
  async get(id, options = {}) {
    // Apply artificial delay for testing
    await this._applyDelay(options);
    
    const context = {
      api: this,
      method: 'get',
      id,
      options: { ...this.options, ...options },
      result: null,
      errors: []
    };

    // Execute before hook
    await this.executeHook('beforeGet', context);

    // Get the implementation
    const impl = this.implementers.get('get');
    if (!impl) {
      throw new Error('No implementation for get method');
    }

    // Execute the implementation
    context.result = await impl(context);

    // Execute after hook
    await this.executeHook('afterGet', context);

    // Transform result
    await this.executeHook('transformResult', context);

    return this._formatResponse(context);
  }

  /**
   * Query multiple resources
   */
  async query(params = {}, options = {}) {
    // Apply artificial delay for testing
    await this._applyDelay(options);
    
    const context = {
      api: this,
      method: 'query',
      params,
      options: { ...this.options, ...options },
      results: [],
      meta: {},
      errors: []
    };

    // Execute before hook
    await this.executeHook('beforeQuery', context);

    // Get the implementation
    const impl = this.implementers.get('query');
    if (!impl) {
      throw new Error('No implementation for query method');
    }

    // Execute the implementation
    const queryResult = await impl(context);
    context.results = queryResult.results || [];
    context.meta = queryResult.meta || {};

    // Execute after hook
    await this.executeHook('afterQuery', context);

    // Transform results
    for (let i = 0; i < context.results.length; i++) {
      const itemContext = { ...context, result: context.results[i] };
      await this.executeHook('transformResult', itemContext);
      context.results[i] = itemContext.result;
    }

    return this._formatQueryResponse(context);
  }

  /**
   * Insert a new resource
   */
  async insert(data, options = {}) {
    // Apply artificial delay for testing
    await this._applyDelay(options);
    
    const context = {
      api: this,
      method: 'insert',
      data,
      options: { ...this.options, ...options },
      result: null,
      errors: []
    };

    // Validation
    await this.executeHook('beforeValidate', context);
    await this.executeHook('afterValidate', context);

    if (context.errors.length > 0) {
      throw this._createValidationError(context.errors);
    }

    // Execute before hook
    await this.executeHook('beforeInsert', context);

    // Get the implementation
    const impl = this.implementers.get('insert');
    if (!impl) {
      throw new Error('No implementation for insert method');
    }

    // Execute the implementation
    context.result = await impl(context);

    // Execute after hook
    await this.executeHook('afterInsert', context);

    // Transform result
    await this.executeHook('transformResult', context);

    return this._formatResponse(context);
  }

  /**
   * Update an existing resource
   */
  async update(id, data, options = {}) {
    // Apply artificial delay for testing
    await this._applyDelay(options);
    
    const context = {
      api: this,
      method: 'update',
      id,
      data,
      options: { ...this.options, ...options },
      result: null,
      errors: []
    };

    // Validation
    await this.executeHook('beforeValidate', context);
    await this.executeHook('afterValidate', context);

    if (context.errors.length > 0) {
      throw this._createValidationError(context.errors);
    }

    // Execute before hook
    await this.executeHook('beforeUpdate', context);

    // Get the implementation
    const impl = this.implementers.get('update');
    if (!impl) {
      throw new Error('No implementation for update method');
    }

    // Execute the implementation
    context.result = await impl(context);

    // Execute after hook
    await this.executeHook('afterUpdate', context);

    // Transform result
    await this.executeHook('transformResult', context);

    return this._formatResponse(context);
  }

  /**
   * Delete a resource
   */
  async delete(id, options = {}) {
    // Apply artificial delay for testing
    await this._applyDelay(options);
    
    const context = {
      api: this,
      method: 'delete',
      id,
      options: { ...this.options, ...options },
      result: null,
      errors: []
    };

    // Execute before hook
    await this.executeHook('beforeDelete', context);

    // Get the implementation
    const impl = this.implementers.get('delete');
    if (!impl) {
      throw new Error('No implementation for delete method');
    }

    // Execute the implementation
    await impl(context);

    // Execute after hook
    await this.executeHook('afterDelete', context);

    return { data: null };
  }

  /**
   * Format a single resource response
   */
  _formatResponse(context) {
    if (!context.result) {
      return { data: null };
    }

    return {
      data: this._formatResource(context.result, context.options.type)
    };
  }

  /**
   * Format a query response
   */
  _formatQueryResponse(context) {
    return {
      data: context.results.map(item => 
        this._formatResource(item, context.options.type)
      ),
      meta: context.meta,
      links: context.links || {}
    };
  }

  /**
   * Format a resource according to JSON:API
   */
  _formatResource(resource, type) {
    if (!resource) return null;

    const { [this.options.idProperty]: id, ...attributes } = resource;

    return {
      id: String(id),
      type: type || 'resource',
      attributes
    };
  }

  /**
   * Create a validation error
   */
  _createValidationError(errors) {
    const error = new Error('Validation failed');
    error.status = 422;
    error.errors = errors.map(err => ({
      status: '422',
      title: 'Validation Error',
      detail: err.message,
      source: { pointer: `/data/attributes/${err.field}` }
    }));
    return error;
  }
  
  /**
   * Create a search schema from an existing schema
   */
  createSearchSchema(schema, fields) {
    const searchStructure = {};
    
    // Include only specified fields
    fields.forEach(field => {
      if (schema.structure[field]) {
        searchStructure[field] = { ...schema.structure[field] };
        // Make search fields optional
        delete searchStructure[field].required;
      }
    });
    
    return new schema.constructor(searchStructure);
  }
  
  /**
   * Register a resource type with schema and hooks
   */
  addResource(type, schema, hooks = {}) {
    if (!type || typeof type !== 'string') {
      throw new Error('Resource type must be a non-empty string');
    }
    
    if (!schema || typeof schema.validate !== 'function') {
      throw new Error('Schema must have a validate method');
    }
    
    if (!this.schemas) {
      this.schemas = new Map();
    }
    
    if (!this.resourceHooks) {
      this.resourceHooks = new Map();
    }
    
    if (!this._resourceProxies) {
      this._resourceProxies = new Map();
    }
    
    this.schemas.set(type, schema);
    
    // Register hooks for this resource type
    if (hooks && typeof hooks === 'object') {
      for (const [hookName, handler] of Object.entries(hooks)) {
        if (typeof handler === 'function') {
          // Create a wrapper that only runs for this resource type
          this.hook(hookName, async (context) => {
            if (context.options.type === type) {
              await handler.call(this, context);
            }
          }, 10); // Higher priority to run before other hooks
        }
      }
      this.resourceHooks.set(type, hooks);
    }
    
    // Create resource proxy for intuitive access
    const resourceProxy = this._createResourceProxy(type);
    this._resourceProxies.set(type, resourceProxy);
    
    return this;
  }

  /**
   * Create a resource proxy for intuitive API access
   */
  _createResourceProxy(type) {
    const api = this;
    
    return {
      // Get a single resource
      get: (id, options = {}) => api.get(id, { ...options, type }),
      
      // Query resources
      query: (params = {}, options = {}) => api.query(params, { ...options, type }),
      
      // Create a new resource
      post: (data, options = {}) => api.insert(data, { ...options, type }),
      create: (data, options = {}) => api.insert(data, { ...options, type }), // Alias
      
      // Update a resource
      put: (id, data, options = {}) => api.update(id, data, { ...options, type }),
      update: (id, data, options = {}) => api.update(id, data, { ...options, type }), // Alias
      
      // Delete a resource
      delete: (id, options = {}) => api.delete(id, { ...options, type }),
      remove: (id, options = {}) => api.delete(id, { ...options, type }), // Alias
      
      // Access schema
      get schema() {
        return api.schemas.get(type);
      },
      
      // Access hooks
      get hooks() {
        return api.resourceHooks.get(type);
      },
      
      // Versioned access
      version: (ver) => {
        // Get or create versioned API
        const versionedApi = Api.get(api.options.name, ver);
        if (!versionedApi) {
          throw new Error(`No API version ${ver} found for ${api.options.name}`);
        }
        
        // Return the resource proxy from the versioned API
        const versionedResource = versionedApi._resourceProxies?.get(type);
        if (!versionedResource) {
          throw new Error(`Resource ${type} not found in API version ${ver}`);
        }
        
        return versionedResource;
      },
      
      // Batch operations
      batch: {
        create: (items, options = {}) => 
          Promise.all(items.map(item => api.post(item, { ...options, type }))),
        
        update: (updates, options = {}) => 
          Promise.all(updates.map(({ id, data }) => 
            api.update(id, data, { ...options, type })
          )),
        
        delete: (ids, options = {}) => 
          Promise.all(ids.map(id => api.delete(id, { ...options, type })))
      }
    };
  }

  /**
   * Get resources accessor
   */
  get resources() {
    const self = this;
    
    if (!this._resourcesProxy) {
      this._resourcesProxy = new Proxy({}, {
        get(target, prop) {
          // Check if resource exists
          const resourceProxy = self._resourceProxies?.get(prop);
          if (!resourceProxy) {
            throw new Error(`Resource '${prop}' not found. Did you forget to call addResource('${prop}', schema)?`);
          }
          return resourceProxy;
        },
        
        has(target, prop) {
          return self._resourceProxies?.has(prop) || false;
        },
        
        ownKeys(target) {
          return Array.from(self._resourceProxies?.keys() || []);
        },
        
        getOwnPropertyDescriptor(target, prop) {
          if (self._resourceProxies?.has(prop)) {
            return {
              enumerable: true,
              configurable: true,
              value: self._resourceProxies.get(prop)
            };
          }
        }
      });
    }
    
    return this._resourcesProxy;
  }

  /**
   * Alternative syntax - direct property access
   */
  resource(type) {
    const resourceProxy = this._resourceProxies?.get(type);
    if (!resourceProxy) {
      throw new Error(`Resource '${type}' not found. Did you forget to call addResource('${type}', schema)?`);
    }
    return resourceProxy;
  }
}