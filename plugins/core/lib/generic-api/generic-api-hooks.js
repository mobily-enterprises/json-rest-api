/**
 * GenericApiHooks
 * 
 * Provides a comprehensive hook system for Generic API resources.
 * Allows intercepting and modifying behavior at various points.
 */

export class GenericApiHooks {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.hooks = new Map(); // Table-specific hooks
    this.globalHooks = new Map(); // Global hooks for all tables
    this.hookMetrics = new Map(); // Track hook execution metrics
  }
  
  /**
   * Register a hook function
   */
  register(tableName, hookName, hookFn) {
    if (typeof hookFn !== 'function') {
      throw new Error(`Hook must be a function, received ${typeof hookFn}`);
    }
    
    // Validate hook name
    if (!this.isValidHookName(hookName)) {
      throw new Error(`Invalid hook name: ${hookName}. See getHookPoints() for valid hooks.`);
    }
    
    if (!tableName || tableName === '*') {
      // Register as global hook
      if (!this.globalHooks.has(hookName)) {
        this.globalHooks.set(hookName, []);
      }
      this.globalHooks.get(hookName).push(hookFn);
      this.log.debug(`Registered global hook: ${hookName}`);
    } else {
      // Register as table-specific hook
      const key = `${tableName}:${hookName}`;
      if (!this.hooks.has(key)) {
        this.hooks.set(key, []);
      }
      this.hooks.get(key).push(hookFn);
      this.log.debug(`Registered hook for ${tableName}: ${hookName}`);
    }
    
    return true;
  }
  
  /**
   * Unregister a hook
   */
  unregister(tableName, hookName, hookFn) {
    if (!tableName || tableName === '*') {
      const hooks = this.globalHooks.get(hookName);
      if (hooks) {
        const index = hooks.indexOf(hookFn);
        if (index > -1) {
          hooks.splice(index, 1);
          return true;
        }
      }
    } else {
      const key = `${tableName}:${hookName}`;
      const hooks = this.hooks.get(key);
      if (hooks) {
        const index = hooks.indexOf(hookFn);
        if (index > -1) {
          hooks.splice(index, 1);
          return true;
        }
      }
    }
    return false;
  }
  
  /**
   * Execute hooks for a given event
   */
  async execute(tableName, hookName, context) {
    if (!this.config.enableHooks) {
      return { success: true, results: [] };
    }
    
    const startTime = Date.now();
    const results = [];
    let aborted = false;
    
    try {
      // Execute global hooks first
      const globalHooks = this.globalHooks.get(hookName) || [];
      for (const hook of globalHooks) {
        try {
          const result = await this.executeHook(hook, context, hookName, 'global');
          
          if (result === false) {
            // Hook returned false to abort operation
            aborted = true;
            this.log.debug(`Global hook ${hookName} aborted operation`);
            break;
          }
          
          if (result !== undefined) {
            results.push(result);
          }
          
          // Allow hooks to modify context
          if (result && typeof result === 'object' && result.modifiedContext) {
            Object.assign(context, result.modifiedContext);
          }
        } catch (error) {
          this.log.error(`Error in global hook ${hookName}:`, error);
          if (this.config.strictHooks) {
            throw error;
          }
        }
      }
      
      // Execute table-specific hooks if not aborted
      if (!aborted && tableName) {
        const key = `${tableName}:${hookName}`;
        const tableHooks = this.hooks.get(key) || [];
        
        for (const hook of tableHooks) {
          try {
            const result = await this.executeHook(hook, context, hookName, tableName);
            
            if (result === false) {
              aborted = true;
              this.log.debug(`Table hook ${hookName} for ${tableName} aborted operation`);
              break;
            }
            
            if (result !== undefined) {
              results.push(result);
            }
            
            // Allow hooks to modify context
            if (result && typeof result === 'object' && result.modifiedContext) {
              Object.assign(context, result.modifiedContext);
            }
          } catch (error) {
            this.log.error(`Error in hook ${hookName} for ${tableName}:`, error);
            if (this.config.strictHooks) {
              throw error;
            }
          }
        }
      }
      
      // Record metrics
      const executionTime = Date.now() - startTime;
      this.recordMetric(hookName, executionTime, !aborted);
      
      return {
        success: !aborted,
        results: results,
        executionTime: executionTime
      };
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.recordMetric(hookName, executionTime, false);
      throw error;
    }
  }
  
  /**
   * Execute a single hook with error handling
   */
  async executeHook(hookFn, context, hookName, scope) {
    // Create a safe context copy to prevent unintended modifications
    const safeContext = this.createSafeContext(context);
    
    // Add hook metadata to context
    safeContext.__hook = {
      name: hookName,
      scope: scope,
      timestamp: new Date()
    };
    
    try {
      // Execute hook with timeout if configured
      if (this.config.hookTimeout) {
        return await this.executeWithTimeout(hookFn, safeContext, this.config.hookTimeout);
      } else {
        return await hookFn(safeContext);
      }
    } catch (error) {
      // Enhance error with hook information
      error.hookName = hookName;
      error.hookScope = scope;
      throw error;
    }
  }
  
  /**
   * Execute hook with timeout
   */
  async executeWithTimeout(hookFn, context, timeout) {
    return new Promise((resolve, reject) => {
      let timeoutId;
      
      const promise = hookFn(context);
      
      timeoutId = setTimeout(() => {
        reject(new Error(`Hook execution timed out after ${timeout}ms`));
      }, timeout);
      
      promise
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
  
  /**
   * Create a safe context copy
   */
  createSafeContext(context) {
    // Deep clone context to prevent unintended modifications
    const safeContext = JSON.parse(JSON.stringify(context));
    
    // Re-add non-serializable properties
    if (context.knex) safeContext.knex = context.knex;
    if (context.api) safeContext.api = context.api;
    if (context.log) safeContext.log = context.log;
    if (context.request) safeContext.request = context.request;
    if (context.response) safeContext.response = context.response;
    if (context.user) safeContext.user = context.user;
    
    return safeContext;
  }
  
  /**
   * Check if hook name is valid
   */
  isValidHookName(hookName) {
    const validHooks = this.getHookPoints();
    return validHooks.includes(hookName);
  }
  
  /**
   * Get all available hook points
   */
  getHookPoints() {
    return [
      // Lifecycle hooks
      'beforeValidate',
      'afterValidate',
      'beforeCreate',
      'afterCreate',
      'beforeUpdate',
      'afterUpdate',
      'beforeDelete',
      'afterDelete',
      'beforeSave', // Fires for both create and update
      'afterSave', // Fires for both create and update
      
      // Query hooks
      'beforeQuery',
      'modifyQuery',
      'afterQuery',
      'beforeGet',
      'afterGet',
      'beforeCount',
      'afterCount',
      'beforeFind',
      'afterFind',
      
      // Relationship hooks
      'beforeLoadRelationship',
      'afterLoadRelationship',
      'beforeUpdateRelationship',
      'afterUpdateRelationship',
      'beforeDeleteRelationship',
      'afterDeleteRelationship',
      
      // Transform hooks
      'beforeSerialize',
      'afterSerialize',
      'beforeDeserialize',
      'afterDeserialize',
      'beforeTransform',
      'afterTransform',
      
      // Include hooks
      'beforeInclude',
      'modifyIncludeQuery',
      'afterInclude',
      'beforeLoadIncludes',
      'afterLoadIncludes',
      
      // Cache hooks
      'beforeCache',
      'afterCache',
      'beforeCacheInvalidation',
      'afterCacheInvalidation',
      'onCacheHit',
      'onCacheMiss',
      
      // Security hooks
      'beforeAuthorize',
      'afterAuthorize',
      'beforeAuthenticate',
      'afterAuthenticate',
      'beforePermissionCheck',
      'afterPermissionCheck',
      
      // Audit hooks
      'beforeAudit',
      'afterAudit',
      'onAuditLog',
      
      // Error handling hooks
      'onError',
      'beforeError',
      'afterError',
      'onValidationError',
      
      // Storage hooks
      'beforeStore',
      'afterStore',
      'beforeRetrieve',
      'afterRetrieve',
      'beforeIndex',
      'afterIndex',
      
      // Optimization hooks
      'beforeOptimize',
      'afterOptimize',
      'onQueryPlan',
      'onIndexSuggestion',
      
      // Custom operation hooks
      'beforeCustomOperation',
      'afterCustomOperation',
      'onCustomEvent'
    ];
  }
  
  /**
   * Get hook documentation
   */
  getHookDocumentation(hookName) {
    const docs = {
      'beforeValidate': {
        description: 'Fires before input validation',
        context: ['inputRecord', 'fields', 'operation'],
        canAbort: true,
        canModify: ['inputRecord']
      },
      'afterValidate': {
        description: 'Fires after successful validation',
        context: ['inputRecord', 'fields', 'validationResult'],
        canAbort: true,
        canModify: ['inputRecord']
      },
      'beforeCreate': {
        description: 'Fires before creating a new record',
        context: ['inputRecord', 'fields', 'tableId'],
        canAbort: true,
        canModify: ['inputRecord']
      },
      'afterCreate': {
        description: 'Fires after record creation',
        context: ['result', 'inputRecord', 'fields'],
        canAbort: false,
        canModify: ['result']
      },
      'beforeUpdate': {
        description: 'Fires before updating a record',
        context: ['id', 'inputRecord', 'existingRecord', 'fields'],
        canAbort: true,
        canModify: ['inputRecord']
      },
      'afterUpdate': {
        description: 'Fires after record update',
        context: ['result', 'inputRecord', 'previousRecord', 'fields'],
        canAbort: false,
        canModify: ['result']
      },
      'beforeDelete': {
        description: 'Fires before deleting a record',
        context: ['id', 'existingRecord', 'fields'],
        canAbort: true,
        canModify: []
      },
      'afterDelete': {
        description: 'Fires after record deletion',
        context: ['deletedRecord', 'fields'],
        canAbort: false,
        canModify: []
      },
      'beforeQuery': {
        description: 'Fires before executing a query',
        context: ['query', 'filters', 'options', 'fields'],
        canAbort: true,
        canModify: ['query', 'filters', 'options']
      },
      'afterQuery': {
        description: 'Fires after query execution',
        context: ['results', 'filters', 'options', 'fields'],
        canAbort: false,
        canModify: ['results']
      },
      'beforeInclude': {
        description: 'Fires before loading included resources',
        context: ['records', 'includeParam', 'relationships'],
        canAbort: true,
        canModify: ['includeParam']
      },
      'afterInclude': {
        description: 'Fires after loading included resources',
        context: ['included', 'records', 'includeParam'],
        canAbort: false,
        canModify: ['included']
      },
      'beforeAuthorize': {
        description: 'Fires before authorization check',
        context: ['user', 'operation', 'resource', 'tableId'],
        canAbort: true,
        canModify: ['user']
      },
      'onError': {
        description: 'Fires when an error occurs',
        context: ['error', 'operation', 'context'],
        canAbort: false,
        canModify: ['error']
      }
    };
    
    return docs[hookName] || {
      description: `Hook: ${hookName}`,
      context: [],
      canAbort: false,
      canModify: []
    };
  }
  
  /**
   * Get registered hooks for a table
   */
  getTableHooks(tableName) {
    const tableHooks = {};
    
    for (const [key, hooks] of this.hooks.entries()) {
      if (key.startsWith(`${tableName}:`)) {
        const hookName = key.split(':')[1];
        tableHooks[hookName] = hooks.length;
      }
    }
    
    return tableHooks;
  }
  
  /**
   * Get all registered hooks
   */
  getAllHooks() {
    const allHooks = {
      global: {},
      tables: {}
    };
    
    // Global hooks
    for (const [hookName, hooks] of this.globalHooks.entries()) {
      allHooks.global[hookName] = hooks.length;
    }
    
    // Table hooks
    for (const [key, hooks] of this.hooks.entries()) {
      const [tableName, hookName] = key.split(':');
      if (!allHooks.tables[tableName]) {
        allHooks.tables[tableName] = {};
      }
      allHooks.tables[tableName][hookName] = hooks.length;
    }
    
    return allHooks;
  }
  
  /**
   * Clear all hooks
   */
  clearHooks(tableName = null) {
    if (!tableName) {
      // Clear all hooks
      this.hooks.clear();
      this.globalHooks.clear();
      this.log.info('Cleared all hooks');
    } else {
      // Clear hooks for specific table
      const keysToDelete = [];
      for (const key of this.hooks.keys()) {
        if (key.startsWith(`${tableName}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.hooks.delete(key));
      this.log.info(`Cleared hooks for table: ${tableName}`);
    }
  }
  
  /**
   * Record hook execution metrics
   */
  recordMetric(hookName, executionTime, success) {
    if (!this.config.enableMetrics) return;
    
    if (!this.hookMetrics.has(hookName)) {
      this.hookMetrics.set(hookName, {
        executions: 0,
        successes: 0,
        failures: 0,
        totalTime: 0,
        avgTime: 0,
        maxTime: 0,
        minTime: Infinity
      });
    }
    
    const metric = this.hookMetrics.get(hookName);
    metric.executions++;
    
    if (success) {
      metric.successes++;
    } else {
      metric.failures++;
    }
    
    metric.totalTime += executionTime;
    metric.avgTime = metric.totalTime / metric.executions;
    metric.maxTime = Math.max(metric.maxTime, executionTime);
    metric.minTime = Math.min(metric.minTime, executionTime);
  }
  
  /**
   * Get hook metrics
   */
  getMetrics() {
    const metrics = {};
    
    for (const [hookName, metric] of this.hookMetrics.entries()) {
      metrics[hookName] = {
        ...metric,
        successRate: metric.executions > 0 
          ? (metric.successes / metric.executions) * 100 
          : 0
      };
    }
    
    return metrics;
  }
}

export default GenericApiHooks;