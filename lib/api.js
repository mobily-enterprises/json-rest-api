import semver from 'semver';
import { ValidationError, InternalError, BadRequestError } from './errors.js';

// Global registry for all APIs
const globalRegistry = new Map();

// Security: Sanitize objects to prevent prototype pollution and circular reference DoS
function sanitizeObject(obj, visited = new WeakSet(), depth = 0) {
  // Max depth to prevent stack overflow from deeply nested objects
  const MAX_DEPTH = 100;
  
  if (!obj || typeof obj !== 'object') return obj;
  
  // Check depth limit
  if (depth > MAX_DEPTH) {
    throw new BadRequestError('Object nesting exceeds maximum depth of ' + MAX_DEPTH);
  }
  
  // Check for circular reference
  if (visited.has(obj)) {
    throw new BadRequestError('Circular reference detected in request data');
  }
  
  // Mark this object as visited
  visited.add(obj);
  
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  
  try {
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeObject(item, visited, depth + 1));
    }
    
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      if (!dangerous.includes(key)) {
        clean[key] = sanitizeObject(value, visited, depth + 1);
      }
    }
    
    return clean;
  } finally {
    // Remove from visited set to allow the same object at different paths
    visited.delete(obj);
  }
}

// Security: Validate field access to prevent path traversal
function validateFieldAccess(field, schema, context) {
  // Null/undefined fields are invalid
  if (!field) return false;
  
  // Prevent access to system fields
  if (field.startsWith('_') || field.startsWith('$')) {
    return false;
  }
  
  // For virtual search fields marked with '*', allow them
  // They'll be validated when transformed in hooks
  const resourceOptions = context.api?.resourceOptions?.get(context.options?.type) || {};
  const searchableFields = resourceOptions.searchableFields || {};
  if (searchableFields[field] === '*') {
    return true;
  }
  
  // If no schema, deny by default (shouldn't happen)
  if (!schema) return false;
  
  // Handle nested field paths
  if (field.includes('.')) {
    const parts = field.split('.');
    let currentSchema = schema.structure;
    
    for (const part of parts) {
      // Each part must be valid
      if (part.startsWith('_') || part.startsWith('$') || 
          ['__proto__', 'constructor', 'prototype'].includes(part)) {
        return false;
      }
      
      // Check if field exists in schema
      if (!currentSchema[part]) {
        return false;
      }
      
      // Don't allow traversing through silent fields
      if (currentSchema[part].silent) {
        return false;
      }
      
      // Check field-level permissions
      if (currentSchema[part].permission && context.options?.user) {
        const user = context.options.user;
        if (!user.can || !user.can(currentSchema[part].permission)) {
          return false;
        }
      }
      
      // For nested objects, continue traversal
      if (currentSchema[part].type === 'object' && currentSchema[part].structure) {
        currentSchema = currentSchema[part].structure;
      } else {
        // Can't traverse further
        break;
      }
    }
    
    return true;
  }
  
  // Simple field validation
  const fieldDef = schema.structure[field];
  if (!fieldDef) {
    return false;
  }
  
  // Check if field is silent
  if (fieldDef.silent) {
    return false;
  }
  
  // Check field-level permissions
  if (fieldDef.permission && context.options?.user) {
    const user = context.options.user;
    if (!user.can || !user.can(fieldDef.permission)) {
      return false;
    }
  }
  
  return true;
}

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
    
    // Register core hooks for join processing
    this._registerJoinProcessingHooks();
    
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
    
    if (!semver.valid(version)) {
      throw new BadRequestError(`Invalid version format: ${version}`);
    }
    
    if (!globalRegistry.has(name)) {
      globalRegistry.set(name, new Map());
    }
    
    globalRegistry.get(name).set(version, this);
    return this;
  }

  async close() {
    if (this.pool) {
      console.log('Closing MySQL connection pool...');
      // .end() gracefully closes all connections in the pool.
      await this.pool.end(); 
      console.log('✓ MySQL pool closed.');
    }
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
   * Alias for executeHook for backward compatibility
   */
  async runHooks(name, context) {
    return this.executeHook(name, context);
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
   * Execute an implemented method
   */
  async execute(method, context = {}) {
    const handler = this.implementers.get(method);
    if (!handler) {
      throw new InternalError(`No implementation found for method: ${method}`);
    }
    return await handler(context);
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
      'transformResult',
      'initializeQuery',
      'modifyQuery',
      'finalizeQuery'
    ];
    
    hookNames.forEach(name => this.hooks.set(name, []));
  }
  
  /**
   * Register core hooks for processing joined data
   */
  _registerJoinProcessingHooks() {
    // Process joined fields after get operations
    this.hook('afterGet', async (context) => {
      if (!context.joinFields || Object.keys(context.joinFields).length === 0) {
        return;
      }
      
      await this._processJoinedData(context, context.result);
    }, 90); // High priority to run after other afterGet hooks
    
    // Process joined fields after query operations
    this.hook('afterQuery', async (context) => {
      if (!context.joinFields || Object.keys(context.joinFields).length === 0) {
        return;
      }
      
      // Process each result
      for (const record of context.results) {
        await this._processJoinedData(context, record);
      }
    }, 90); // High priority to run after other afterQuery hooks
    
    // Process joined fields after insert operations
    this.hook('afterInsert', async (context) => {
      if (!context.joinFields || Object.keys(context.joinFields).length === 0) {
        return;
      }
      
      await this._processJoinedData(context, context.result);
    }, 90); // High priority to run after other afterInsert hooks
  }
  
  /**
   * Process joined data for a single record
   * Now handles nested joins - processes from innermost to outermost
   */
  async _processJoinedData(context, record) {
    if (!record) return;
    
    // First, collect all prefixed fields and organize by nesting level
    const prefixedFields = {};
    const keysToDelete = [];
    
    for (const key in record) {
      if (key.startsWith('__')) {
        keysToDelete.push(key);
        
        // Count the number of __ to determine nesting level
        const parts = key.substring(2).split('__'); // Remove first __
        const nestingLevel = parts.length - 1; // fieldName__nestedField__actualField = level 2
        
        if (!prefixedFields[nestingLevel]) {
          prefixedFields[nestingLevel] = {};
        }
        
        prefixedFields[nestingLevel][key] = record[key];
      }
    }
    
    // Remove all prefixed fields from record
    keysToDelete.forEach(key => delete record[key]);
    
    // Process from deepest level to shallowest (level 2, then level 1)
    const levels = Object.keys(prefixedFields)
      .map(Number)
      .sort((a, b) => b - a); // Sort descending
    
    // Store processed data by path for nested placement
    const processedByPath = {};
    
    for (const level of levels) {
      const fieldsAtLevel = prefixedFields[level];
      
      for (const [key, value] of Object.entries(fieldsAtLevel)) {
        const parts = key.substring(2).split('__'); // Remove first __
        
        if (level === 1) {
          // First level join: __fieldName__actualField
          const [fieldName, actualField] = parts;
          const joinMeta = context.joinFields[fieldName];
          if (!joinMeta) continue;
          
          // Initialize joined data for this field
          if (!processedByPath[fieldName]) {
            processedByPath[fieldName] = { _meta: joinMeta };
          }
          
          processedByPath[fieldName][actualField] = value;
          
        } else if (level === 2) {
          // Nested join: __parentField__nestedField__actualField
          const [parentField, nestedField, actualField] = parts;
          const parentJoinMeta = context.joinFields[parentField];
          if (!parentJoinMeta) continue;
          
          const nestedJoinMeta = parentJoinMeta.nestedJoins?.[nestedField];
          if (!nestedJoinMeta) continue;
          
          // Initialize nested structure
          const nestedPath = `${parentField}.${nestedField}`;
          if (!processedByPath[nestedPath]) {
            processedByPath[nestedPath] = { _meta: nestedJoinMeta };
          }
          
          processedByPath[nestedPath][actualField] = value;
        }
      }
    }
    
    // Now process the collected data from innermost to outermost
    // First process level 2 (nested joins)
    for (const path in processedByPath) {
      if (!path.includes('.')) continue; // Skip first-level for now
      
      const [parentField, nestedField] = path.split('.');
      const nestedData = processedByPath[path];
      const nestedMeta = nestedData._meta;
      delete nestedData._meta;
      
      // Check if we have actual data (not just nulls)
      const hasData = Object.values(nestedData).some(v => v !== null);
      if (!hasData) continue;
      
      // Run hooks on nested data if configured
      let processedNestedData = nestedData;
      if (nestedMeta.runHooks) {
        const hookContext = {
          api: this,
          method: 'get',
          id: nestedData.id,
          options: {
            type: nestedMeta.resource,
            isJoinResult: true,
            joinContext: nestedMeta.hookContext,
            parentType: context.joinFields[parentField].resource,
            parentId: processedByPath[parentField]?.id,
            parentField: nestedField
          },
          result: nestedData
        };
        
        await this.executeHook('afterGet', hookContext);
        processedNestedData = hookContext.result;
      }
      
      // Store processed nested data for parent to include
      if (!processedByPath[parentField]._nestedData) {
        processedByPath[parentField]._nestedData = {};
      }
      processedByPath[parentField]._nestedData[nestedField] = {
        data: processedNestedData,
        meta: nestedMeta
      };
    }
    
    // Then process level 1 (first-level joins) with nested data already processed
    for (const fieldName in processedByPath) {
      if (fieldName.includes('.')) continue; // Skip nested
      
      const joinedData = processedByPath[fieldName];
      const joinMeta = joinedData._meta;
      const nestedData = joinedData._nestedData;
      delete joinedData._meta;
      delete joinedData._nestedData;
      
      // Check if we have actual data
      const hasData = Object.values(joinedData).some(v => v !== null);
      if (!hasData) continue;
      
      // Place nested data into joined data based on nested field configs
      if (nestedData) {
        for (const [nestedField, nested] of Object.entries(nestedData)) {
          const { data, meta } = nested;
          
          if (meta.resourceField) {
            joinedData[meta.resourceField] = data;
          } else if (!meta.preserveId) {
            joinedData[nestedField] = data;
          } else {
            const resourceField = nestedField.replace(/Id$/, '');
            joinedData[resourceField] = data;
          }
        }
      }
      
      // Run hooks on first-level joined data (which now includes nested data)
      let processedData = joinedData;
      if (joinMeta.runHooks) {
        const hookContext = {
          api: this,
          method: 'get',
          id: joinedData.id,
          options: {
            type: joinMeta.resource,
            isJoinResult: true,
            joinContext: joinMeta.hookContext,
            parentType: context.options.type,
            parentId: record[this.options.idProperty],
            parentField: fieldName
          },
          result: joinedData
        };
        
        await this.executeHook('afterGet', hookContext);
        processedData = hookContext.result;
      }
      
      // Place the data in the main record based on configuration
      if (joinMeta.resourceField) {
        record[joinMeta.resourceField] = processedData;
      } else if (!joinMeta.preserveId) {
        record[fieldName] = processedData;
      } else {
        const resourceField = fieldName.replace(/Id$/, '');
        record[resourceField] = processedData;
      }
    }
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
      throw new InternalError('No storage plugin installed').withContext({ method: 'get' });
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
    
    // Validate pagination parameters
    if (params.page && Object.keys(params.page).length > 0) {
      if (params.page.size !== undefined) {
        const pageSize = parseInt(params.page.size, 10);
        if (isNaN(pageSize) || pageSize < 1) {
          throw new BadRequestError('Page size must be a positive integer');
        }
        params.page.size = pageSize;
      }
      
      if (params.page.number !== undefined) {
        const pageNumber = parseInt(params.page.number, 10);
        if (isNaN(pageNumber) || pageNumber < 1) {
          throw new BadRequestError('Page number must be a positive integer');
        }
        params.page.number = pageNumber;
      }
    }
    
    if (this.options.debug) {
      console.log('API query called with params:', JSON.stringify(params, null, 2));
    }
    
    // Validate field access in filter parameters
    if (params.filter && options.type) {
      const schema = this.schemas?.get(options.type);
      const validationContext = { 
        api: this,
        options, 
        method: 'query'
      };
      
      for (const field of Object.keys(params.filter)) {
        if (!validateFieldAccess(field, schema, validationContext)) {
          throw new BadRequestError(`Invalid or forbidden field in filter: ${field}`);
        }
      }
    }
    
    // Validate field access in sort parameters
    if (params.sort && options.type) {
      const schema = this.schemas?.get(options.type);
      const validationContext = { 
        api: this,
        options, 
        method: 'query'
      };
      
      const sortFields = Array.isArray(params.sort) ? params.sort : [params.sort];
      for (const sortField of sortFields) {
        // Handle both string and object formats
        let field;
        if (typeof sortField === 'string') {
          // Remove sort direction prefix
          field = sortField.replace(/^[+-]/, '');
        } else if (sortField && typeof sortField === 'object' && sortField.field) {
          field = sortField.field;
        } else {
          continue; // Skip invalid sort fields
        }
        
        if (!validateFieldAccess(field, schema, validationContext)) {
          throw new BadRequestError(`Invalid or forbidden field in sort: ${field}`);
        }
      }
    }
    
    // Validate field access in field selection
    if (params.fields && options.type) {
      const schema = this.schemas?.get(options.type);
      const validationContext = { 
        api: this,
        options, 
        method: 'query'
      };
      
      const fieldsToValidate = params.fields[options.type] || (typeof params.fields === 'string' || Array.isArray(params.fields) ? params.fields : null);
      if (fieldsToValidate) {
        const fields = Array.isArray(fieldsToValidate) ? fieldsToValidate : fieldsToValidate.split(',');
        for (const field of fields) {
          if (!validateFieldAccess(field.trim(), schema, validationContext)) {
            throw new BadRequestError(`Invalid or forbidden field in field selection: ${field}`);
          }
        }
      }
    }
    
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
      throw new InternalError('No storage plugin installed').withContext({ method: 'query' });
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
    
    // Sanitize input data to prevent prototype pollution
    const sanitizedData = sanitizeObject(data);
    
    const context = {
      api: this,
      method: 'insert',
      data: sanitizedData,
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
      throw new InternalError('No storage plugin installed').withContext({ method: 'insert' });
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
    
    // Sanitize input data to prevent prototype pollution
    const sanitizedData = sanitizeObject(data);
    
    const context = {
      api: this,
      method: 'update',
      id,
      data: sanitizedData,
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
      throw new InternalError('No storage plugin installed').withContext({ method: 'update' });
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
      throw new InternalError('No storage plugin installed').withContext({ method: 'delete' });
    }

    // Execute the implementation
    await impl(context);

    // Execute after hook
    await this.executeHook('afterDelete', context);

    return { data: null };
  }

  /**
   * Bulk shift positions for repositioning
   * This is an internal method for plugins that need to efficiently update many records
   */
  async shiftPositions(type, options = {}) {
    const {
      field,           // The position field to update
      from,            // Shift positions >= this value
      delta,           // Amount to shift by (positive or negative)
      filter = {},     // Additional filter conditions
      excludeIds = []  // IDs to exclude from shifting
    } = options;

    if (!field || from === undefined || !delta) {
      throw new ValidationError()
        .addFieldError('options', 'field, from, and delta are required');
    }

    const context = {
      api: this,
      method: 'shiftPositions',
      options: {
        type,
        field,
        from,
        delta,
        filter,
        excludeIds
      }
    };

    // Find implementation
    const impl = this.implementers.get('shiftPositions');
    if (!impl) {
      throw new Error('No shiftPositions implementation found - ensure a storage plugin is installed');
    }

    // Execute the implementation
    const result = await impl(context);
    
    return result;
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
    // Extract fields for the resource type if specified
    const fields = context.params?.fields?.[context.options.type];
    
    return {
      data: context.results.map(item => 
        this._formatResource(item, context.options.type, fields)
      ),
      meta: context.meta,
      links: context.links || {}
    };
  }

  /**
   * Format a resource according to JSON:API
   */
  _formatResource(resource, type, fields = null) {
    if (!resource) return null;

    const { [this.options.idProperty]: id, ...attributes } = resource;
    
    // Filter attributes if fields are specified
    let filteredAttributes = attributes;
    if (fields && Array.isArray(fields) && fields.length > 0) {
      filteredAttributes = {};
      for (const field of fields) {
        if (field in attributes) {
          filteredAttributes[field] = attributes[field];
        }
      }
    }
    
    // Convert ID-type fields to strings in attributes
    const schema = this.schemas?.get(type);
    if (schema) {
      for (const [field, def] of Object.entries(schema.structure)) {
        if (def.type === 'id' && filteredAttributes[field] !== null && filteredAttributes[field] !== undefined) {
          // Convert ID fields to strings unless they're objects (joined data)
          if (typeof filteredAttributes[field] !== 'object') {
            filteredAttributes[field] = String(filteredAttributes[field]);
          }
        }
      }
    }

    return {
      id: id !== null && id !== undefined ? String(id) : null,
      type: type || 'resource',
      attributes: filteredAttributes
    };
  }

  /**
   * Create a validation error
   */
  _createValidationError(errors) {
    const validationError = new ValidationError();
    errors.forEach(err => {
      validationError.addFieldError(err.field, err.message, err.code);
    });
    return validationError;
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
  addResource(type, schema, hooksOrOptions = {}) {
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
    
    if (!this.resourceOptions) {
      this.resourceOptions = new Map();
    }
    
    this.schemas.set(type, schema);
    
    // Handle both old format (just hooks) and new format (options with hooks)
    let hooks = {};
    let options = {};
    
    if (typeof hooksOrOptions === 'function' || 
        (hooksOrOptions && Object.values(hooksOrOptions).some(v => typeof v === 'function'))) {
      // Old format: just hooks
      hooks = hooksOrOptions;
    } else {
      // New format: options object that may contain hooks and searchableFields
      options = hooksOrOptions;
      hooks = options.hooks || {};
    }
    
    // Store resource options (including searchableFields)
    this.resourceOptions.set(type, options);
    
    // Register hooks for this resource type
    if (hooks && typeof hooks === 'object') {
      for (const [hookName, handler] of Object.entries(hooks)) {
        if (typeof handler === 'function') {
          // Create a wrapper that only runs for this resource type
          this.hook(hookName, async (context) => {
            if (context.options?.type === type || context.type === type) {
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
          Promise.all(items.map(item => api.insert(item, { ...options, type }))),
        
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

  /**
   * Get relationship information from a schema field
   * 
   * Schemas can define relationships using the 'refs' property:
   * {
   *   userId: { type: 'id', refs: { resource: 'users' } },
   *   projectId: { type: 'id', refs: { resource: 'projects' } }
   * }
   * 
   * @param {string} type - The resource type
   * @param {string} field - The field name
   * @returns {Object|null} The refs definition or null
   */
  getFieldRelationship(type, field) {
    const schema = this.schemas?.get(type);
    if (!schema) return null;
    
    const fieldDef = schema.structure[field];
    return fieldDef?.refs || null;
  }

  /**
   * Get all fields with relationships for a resource type
   * 
   * @param {string} type - The resource type
   * @returns {Object} Map of field names to their refs definitions
   */
  getRelationshipFields(type) {
    const schema = this.schemas?.get(type);
    if (!schema) return {};
    
    const relationships = {};
    for (const [field, definition] of Object.entries(schema.structure)) {
      if (definition.refs) {
        relationships[field] = definition.refs;
      }
    }
    
    return relationships;
  }

  /**
   * Resolve affected records based on context
   * 
   * This method handles various ways of declaring affected records:
   * 1. context.affectedRecords - Direct list of {type, id} objects
   * 2. context.refetchRelated - Field names that have refs in schema
   * 3. context.calculateAffected - Function to compute affected records
   * 
   * @param {Object} context - The operation context
   * @returns {Array} Array of {type, id} objects to fetch
   */
  async resolveAffectedRecords(context) {
    const affected = [];
    
    // 1. Direct affected records
    if (context.affectedRecords) {
      affected.push(...context.affectedRecords);
    }
    
    // 2. Refetch related fields based on schema refs
    if (context.refetchRelated && context.result) {
      const relationships = this.getRelationshipFields(context.options.type);
      
      for (const fieldName of context.refetchRelated) {
        const refs = relationships[fieldName];
        if (refs && context.result[fieldName]) {
          affected.push({
            type: refs.resource,
            id: context.result[fieldName]
          });
        }
      }
    }
    
    // 3. Calculate affected records dynamically
    if (context.calculateAffected && typeof context.calculateAffected === 'function') {
      const calculated = await context.calculateAffected(context.result);
      if (Array.isArray(calculated)) {
        affected.push(...calculated);
      }
    }
    
    // Remove duplicates
    const seen = new Set();
    return affected.filter(record => {
      const key = `${record.type}:${record.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Fetch multiple related records
   * 
   * @param {Array} records - Array of {type, id} objects
   * @returns {Array} Array of fetched resources in JSON:API format
   */
  async fetchRelatedRecords(records) {
    const fetched = [];
    
    for (const { type, id } of records) {
      try {
        const resource = this._resourceProxies?.get(type);
        if (resource) {
          const result = await resource.get(id, { allowNotFound: true });
          if (result?.data) {
            fetched.push(result.data);
          }
        }
      } catch (error) {
        // Log but don't fail the whole operation
        if (this.options.debug) {
          console.warn(`Failed to fetch related ${type}:${id}`, error);
        }
      }
    }
    
    return fetched;
  }
}