/**
 * Batch operations support with transaction integration
 */
import { ValidationError, InternalError, BadRequestError } from './errors.js';

/**
 * Batch operation executor
 */
export class BatchOperations {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * Execute batch operations within a transaction
   */
  async transaction(fn, options = {}) {
    // Check if storage supports transactions
    if (!this.api.storagePlugin?.supportsTransactions) {
      // Fallback: execute operations sequentially
      const mockBatch = this._createNonTransactionalBatch();
      return await fn(mockBatch);
    }
    
    // Use real transaction
    return await this.api.transaction(options, async (trx) => {
      const batch = this._createTransactionalBatch(trx);
      return await fn(batch);
    });
  }
  
  /**
   * Execute mixed batch operations
   */
  async execute(operations, options = {}) {
    const results = {
      successful: 0,
      failed: 0,
      results: []
    };
    
    // Validate operations
    for (const op of operations) {
      if (!op.method || !op.type) {
        throw new BadRequestError('Each operation must have method and type');
      }
    }
    
    // Group operations by dependency
    const groups = this._groupOperations(operations, options);
    
    // Execute groups
    for (const group of groups) {
      if (options.parallel && group.every(op => !op.dependsOn)) {
        // Execute independent operations in parallel
        const promises = group.map(op => this._executeOperation(op, results, options));
        await Promise.all(promises);
      } else {
        // Execute sequentially
        for (const op of group) {
          await this._executeOperation(op, results, options);
        }
      }
    }
    
    return results;
  }
  
  /**
   * Create batch wrapper for transactional operations
   */
  _createTransactionalBatch(trx) {
    return {
      resources: new Proxy({}, {
        get: (target, resourceType) => {
          return {
            create: async (data, options = {}) => {
              if (Array.isArray(data)) {
                return this._bulkCreate(resourceType, data, { ...options, transaction: trx });
              }
              return trx.resources[resourceType].create(data, options);
            },
            
            update: async (idOrData, data, options = {}) => {
              if (Array.isArray(idOrData)) {
                return this._bulkUpdate(resourceType, idOrData, { ...options, transaction: trx });
              }
              return trx.resources[resourceType].update(idOrData, data, options);
            },
            
            delete: async (ids, options = {}) => {
              if (Array.isArray(ids)) {
                return this._bulkDelete(resourceType, ids, { ...options, transaction: trx });
              }
              return trx.resources[resourceType].delete(ids, options);
            }
          };
        }
      })
    };
  }
  
  /**
   * Create batch wrapper for non-transactional operations
   */
  _createNonTransactionalBatch() {
    const executed = [];
    
    return {
      resources: new Proxy({}, {
        get: (target, resourceType) => {
          return {
            create: async (data, options = {}) => {
              if (Array.isArray(data)) {
                const results = await this._bulkCreate(resourceType, data, options);
                executed.push({ method: 'create', type: resourceType, data, results });
                return results;
              }
              const result = await this.api.resources[resourceType].create(data, options);
              executed.push({ method: 'create', type: resourceType, data, result });
              return result;
            },
            
            update: async (idOrData, data, options = {}) => {
              if (Array.isArray(idOrData)) {
                const results = await this._bulkUpdate(resourceType, idOrData, options);
                executed.push({ method: 'update', type: resourceType, data: idOrData, results });
                return results;
              }
              const result = await this.api.resources[resourceType].update(idOrData, data, options);
              executed.push({ method: 'update', type: resourceType, id: idOrData, data, result });
              return result;
            },
            
            delete: async (ids, options = {}) => {
              if (Array.isArray(ids)) {
                const results = await this._bulkDelete(resourceType, ids, options);
                executed.push({ method: 'delete', type: resourceType, ids, results });
                return results;
              }
              const result = await this.api.resources[resourceType].delete(ids, options);
              executed.push({ method: 'delete', type: resourceType, id: ids, result });
              return result;
            }
          };
        }
      }),
      
      // Provide rollback simulation for non-transactional storage
      _executed: executed,
      rollback: async () => {
        // Attempt to undo operations in reverse order
        for (let i = executed.length - 1; i >= 0; i--) {
          const op = executed[i];
          try {
            if (op.method === 'create' && op.result?.id) {
              await this.api.resources[op.type].delete(op.result.id);
            } else if (op.method === 'delete' && op.result) {
              // Can't easily undo deletes without storing the data
              console.warn('Cannot rollback delete operation');
            }
            // Updates are also hard to rollback without storing previous state
          } catch (e) {
            console.error('Rollback failed:', e);
          }
        }
      }
    };
  }
  
  /**
   * Bulk create implementation
   */
  async _bulkCreate(type, items, options = {}) {
    const { chunk = 1000, validate = true, returnIds = true, onProgress } = options;
    const results = [];
    const schema = this.api.schemas?.get(type);
    
    // Validate all items first if requested
    if (validate && schema) {
      const errors = [];
      items.forEach((item, index) => {
        const itemErrors = schema.validate(item);
        if (itemErrors.length > 0) {
          errors.push({ index, errors: itemErrors });
        }
      });
      
      if (errors.length > 0) {
        throw new ValidationError('Bulk validation failed').withContext({ errors });
      }
    }
    
    // Process in chunks
    for (let i = 0; i < items.length; i += chunk) {
      const batch = items.slice(i, i + chunk);
      
      // Check if we can use optimized bulk insert
      if (this.api.storagePlugin?.supportsBulkInsert && options.transaction) {
        const sql = this._generateBulkInsertSQL(type, batch, schema);
        const params = this._extractBulkInsertParams(batch, schema);
        
        const result = await this.api.execute('db.query', {
          sql,
          params,
          transaction: options.transaction
        });
        
        // Handle returned IDs
        if (returnIds && result.info?.insertId) {
          const startId = result.info.insertId;
          for (let j = 0; j < batch.length; j++) {
            results.push({ id: startId + j, ...batch[j] });
          }
        } else {
          results.push(...batch);
        }
      } else {
        // Fallback to individual inserts
        for (const item of batch) {
          const result = await this.api.insert(item, { ...options, type });
          // Extract just the data from JSON:API response
          results.push(result.data?.attributes ? { id: result.data.id, ...result.data.attributes } : result);
        }
      }
      
      if (onProgress) {
        onProgress(Math.min(i + chunk, items.length), items.length);
      }
    }
    
    return results;
  }
  
  /**
   * Bulk update implementation
   */
  async _bulkUpdate(type, updates, options = {}) {
    // Handle two forms:
    // 1. Array of { id, data } objects
    // 2. { filter, data } for updating by filter
    
    if (!Array.isArray(updates) && updates.filter) {
      // Update by filter
      return this._updateByFilter(type, updates.filter, updates.data, options);
    }
    
    // Individual updates
    const results = [];
    for (const update of updates) {
      if (!update.id) {
        throw new BadRequestError('Each update must have an id');
      }
      
      const result = await this.api.update(update.id, update.data, { ...options, type });
      // Extract just the data from JSON:API response
      results.push(result.data?.attributes ? { id: result.data.id, ...result.data.attributes } : result);
    }
    
    return results;
  }
  
  /**
   * Bulk delete implementation
   */
  async _bulkDelete(type, idsOrFilter, options = {}) {
    // Handle two forms:
    // 1. Array of IDs
    // 2. { filter } object for deleting by filter
    
    if (!Array.isArray(idsOrFilter) && idsOrFilter.filter) {
      // Delete by filter
      return this._deleteByFilter(type, idsOrFilter.filter, options);
    }
    
    // Delete by IDs
    const results = [];
    for (const id of idsOrFilter) {
      await this.api.delete(id, { ...options, type });
      results.push({ id, deleted: true });
    }
    
    return results;
  }
  
  /**
   * Update records by filter
   */
  async _updateByFilter(type, filter, data, options = {}) {
    const table = options.table || type;
    const schema = this.api.schemas?.get(type);
    
    // Build UPDATE query
    const sets = [];
    const params = [];
    
    for (const [field, value] of Object.entries(data)) {
      sets.push(`${field} = ?`);
      params.push(value);
    }
    
    // Add filter conditions
    const conditions = [];
    for (const [field, value] of Object.entries(filter)) {
      conditions.push(`${field} = ?`);
      params.push(value);
    }
    
    const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE ${conditions.join(' AND ')}`;
    
    const result = await this.api.execute('db.query', {
      sql,
      params,
      transaction: options.transaction
    });
    
    return { updated: result.info?.affectedRows || 0 };
  }
  
  /**
   * Delete records by filter
   */
  async _deleteByFilter(type, filter, options = {}) {
    const table = options.table || type;
    
    // Build DELETE query
    const conditions = [];
    const params = [];
    
    for (const [field, value] of Object.entries(filter)) {
      conditions.push(`${field} = ?`);
      params.push(value);
    }
    
    const sql = `DELETE FROM ${table} WHERE ${conditions.join(' AND ')}`;
    
    const result = await this.api.execute('db.query', {
      sql,
      params,
      transaction: options.transaction
    });
    
    return { deleted: result.info?.affectedRows || 0 };
  }
  
  /**
   * Generate optimized bulk INSERT SQL
   */
  _generateBulkInsertSQL(type, items, schema) {
    const table = type;
    const fields = Object.keys(items[0]);
    const placeholders = items.map(() => `(${fields.map(() => '?').join(', ')})`).join(', ');
    
    return `INSERT INTO ${table} (${fields.join(', ')}) VALUES ${placeholders}`;
  }
  
  /**
   * Extract parameters for bulk insert
   */
  _extractBulkInsertParams(items, schema) {
    const params = [];
    
    for (const item of items) {
      for (const value of Object.values(item)) {
        params.push(value);
      }
    }
    
    return params;
  }
  
  /**
   * Execute a single operation
   */
  async _executeOperation(op, results, options) {
    try {
      let result;
      
      switch (op.method) {
        case 'create':
          // Extract attributes from JSON:API format if present
          const createData = op.data?.attributes || op.data;
          result = await this.api.resources[op.type].create(createData, op.options);
          break;
        case 'update':
          // Extract attributes from JSON:API format if present
          const updateData = op.data?.attributes || op.data;
          result = await this.api.resources[op.type].update(op.id, updateData, op.options);
          break;
        case 'delete':
          result = await this.api.resources[op.type].delete(op.id, op.options);
          break;
        case 'query':
          result = await this.api.resources[op.type].query(op.params, op.options);
          break;
        default:
          throw new BadRequestError(`Unknown operation method: ${op.method}`);
      }
      
      results.successful++;
      results.results.push({ success: true, data: result, operation: op });
      
    } catch (error) {
      results.failed++;
      results.results.push({ success: false, error: error.message, operation: op });
      
      if (options.stopOnError) {
        throw error;
      }
    }
  }
  
  /**
   * Group operations by dependencies
   */
  _groupOperations(operations, options) {
    // Simple grouping - could be enhanced with dependency analysis
    return [operations];
  }
}

/**
 * Add batch methods to API
 */
export function addBatchMethods(api) {
  const batch = new BatchOperations(api);
  
  // Add batch namespace
  api.batch = batch.execute.bind(batch);
  api.batch.transaction = batch.transaction.bind(batch);
  
  // Store reference to batch operations so we can access it when creating resource proxies
  api._batchOperations = batch;
}