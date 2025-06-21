/**
 * Transaction wrapper for high-level transaction API
 */
export class Transaction {
  constructor(api, connection, options = {}) {
    this.api = api;
    this.connection = connection;
    this.options = options;
    this.savepoints = [];
    this.committed = false;
    this.rolledBack = false;
    
    // Create transaction-wrapped API instance
    this.resources = new Proxy({}, {
      get: (target, resourceType) => {
        if (!(resourceType in api.resources)) {
          throw new Error(`Resource '${resourceType}' not found`);
        }
        
        // Return resource proxy with transaction context
        return new Proxy({}, {
          get: (target, method) => {
            const originalMethod = api.resources[resourceType][method];
            if (typeof originalMethod !== 'function') {
              return originalMethod;
            }
            
            // Wrap method to include transaction
            return (...args) => {
              // Add transaction to options
              const lastArg = args[args.length - 1];
              const options = (lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg)) 
                ? { ...lastArg, transaction: this }
                : { transaction: this };
              
              if (lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg)) {
                args[args.length - 1] = options;
              } else {
                args.push(options);
              }
              
              return originalMethod.apply(api.resources[resourceType], args);
            };
          }
        });
      }
    });
  }
  
  /**
   * Create a savepoint
   */
  async savepoint(name, fn) {
    if (!this.api.storagePlugin?.supportsSavepoints) {
      // Fallback: just execute the function without savepoint
      return await fn();
    }
    
    const savepointName = `sp_${name}_${Date.now()}`;
    
    try {
      // Create savepoint
      await this.connection.execute(`SAVEPOINT ${savepointName}`);
      this.savepoints.push(savepointName);
      
      // Execute function
      const result = await fn();
      
      // Remove savepoint from stack on success
      this.savepoints = this.savepoints.filter(sp => sp !== savepointName);
      
      return result;
    } catch (error) {
      // Rollback to savepoint
      await this.connection.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      this.savepoints = this.savepoints.filter(sp => sp !== savepointName);
      throw error;
    }
  }
  
  /**
   * Commit the transaction
   */
  async commit() {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already finalized');
    }
    
    await this.connection.commit();
    this.committed = true;
  }
  
  /**
   * Rollback the transaction
   */
  async rollback() {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already finalized');
    }
    
    await this.connection.rollback();
    this.rolledBack = true;
  }
  
  /**
   * Execute a query within the transaction
   */
  async query(sql, params) {
    return await this.connection.execute(sql, params);
  }
}

/**
 * Add transaction methods to API
 */
export function addTransactionMethods(api) {
  /**
   * Execute operations within a transaction
   */
  api.transaction = async function(optionsOrFn, fn) {
    // Handle overloaded parameters
    let options = {};
    let callback = fn;
    
    if (typeof optionsOrFn === 'function') {
      callback = optionsOrFn;
    } else {
      options = optionsOrFn;
    }
    
    // Check if storage supports transactions
    if (!api.storagePlugin?.supportsTransactions) {
      // Fallback for storages without transaction support
      const mockTrx = {
        resources: api.resources,
        savepoint: async (name, fn) => fn(),
        commit: async () => {},
        rollback: async () => {}
      };
      
      try {
        const result = await callback(mockTrx);
        return result;
      } catch (error) {
        throw error;
      }
    }
    
    // Get connection from pool
    const poolInfo = api._mysqlPools?.get(options.connection || 'default');
    if (!poolInfo) {
      throw new Error('Database connection not found');
    }
    
    const connection = await poolInfo.pool.getConnection();
    let retries = options.retries || 0;
    const retryDelay = options.retryDelay || 100;
    
    while (true) {
      try {
        // Set transaction options
        if (options.isolationLevel) {
          const levels = {
            'READ_UNCOMMITTED': 'READ UNCOMMITTED',
            'READ_COMMITTED': 'READ COMMITTED',
            'REPEATABLE_READ': 'REPEATABLE READ',
            'SERIALIZABLE': 'SERIALIZABLE'
          };
          await connection.execute(`SET TRANSACTION ISOLATION LEVEL ${levels[options.isolationLevel]}`);
        }
        
        if (options.readOnly) {
          await connection.execute('SET TRANSACTION READ ONLY');
        }
        
        // Begin transaction
        await connection.beginTransaction();
        
        // Create transaction wrapper
        const trx = new Transaction(api, connection, options);
        
        // Set timeout if specified
        let timeoutId;
        if (options.timeout) {
          timeoutId = setTimeout(async () => {
            if (!trx.committed && !trx.rolledBack) {
              await trx.rollback();
              throw new Error(`Transaction timeout after ${options.timeout}ms`);
            }
          }, options.timeout);
        }
        
        try {
          // Execute callback
          const result = await callback(trx);
          
          // Auto-commit if not already done
          if (!trx.committed && !trx.rolledBack) {
            await trx.commit();
          }
          
          if (timeoutId) clearTimeout(timeoutId);
          
          return result;
        } catch (error) {
          // Auto-rollback if not already done
          if (!trx.committed && !trx.rolledBack) {
            await trx.rollback();
          }
          
          if (timeoutId) clearTimeout(timeoutId);
          
          throw error;
        }
      } catch (error) {
        // Check for deadlock
        if (retries > 0 && error.code === 'ER_LOCK_DEADLOCK') {
          retries--;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue; // Retry
        }
        
        throw error;
      } finally {
        connection.release();
      }
    }
  };
  
  /**
   * Execute read-only operations within a transaction
   */
  api.readTransaction = async function(optionsOrFn, fn) {
    // Handle overloaded parameters
    let options = {};
    let callback = fn;
    
    if (typeof optionsOrFn === 'function') {
      callback = optionsOrFn;
      options = {};
    } else {
      options = { ...optionsOrFn };
    }
    
    // Force read-only
    options.readOnly = true;
    
    return api.transaction(options, callback);
  };
  
  /**
   * Check if currently in a transaction
   */
  api.isInTransaction = function(context) {
    return !!(context.options?.transaction || context.transaction);
  };
  
  /**
   * Get current transaction from context
   */
  api.getTransaction = function(context) {
    return context.options?.transaction || context.transaction || null;
  };
}