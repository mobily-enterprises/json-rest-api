/**
 * Logging plugin implementing structured logging best practices
 */
export const LoggingPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      level: process.env.LOG_LEVEL || 'info',
      format: 'json', // 'json' or 'pretty'
      includeRequest: true,
      includeResponse: true,
      includeTiming: true,
      sensitiveFields: ['password', 'token', 'secret', 'authorization'],
      logger: console, // Can be replaced with winston, bunyan, etc.
      ...options
    };

    const levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };

    // Create structured logger
    const log = (level, message, meta = {}) => {
      if (levels[level] > levels[defaultOptions.level]) return;

      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message,
        ...meta
      };

      // Remove sensitive data
      const sanitized = sanitizeLogData(logEntry, defaultOptions.sensitiveFields);

      if (defaultOptions.format === 'json') {
        defaultOptions.logger[level](JSON.stringify(sanitized));
      } else {
        defaultOptions.logger[level](`[${timestamp}] ${level.toUpperCase()}: ${message}`, meta);
      }
    };

    // Add logging methods to API
    api.log = {
      error: (message, meta) => log('error', message, meta),
      warn: (message, meta) => log('warn', message, meta),
      info: (message, meta) => log('info', message, meta),
      debug: (message, meta) => log('debug', message, meta)
    };

    // Log all operations
    const timings = new WeakMap();

    // Start timing
    api.hook('beforeValidate', async (context) => {
      if (defaultOptions.includeTiming) {
        timings.set(context, Date.now());
      }

      if (defaultOptions.includeRequest) {
        api.log.info(`${context.method.toUpperCase()} ${context.options.type}`, {
          operation: context.method,
          type: context.options.type,
          id: context.id,
          requestId: context.options.requestId,
          userId: context.options.userId,
          data: context.method === 'query' ? context.params : context.data
        });
      }
    });

    // Log successful operations
    api.hook('beforeSend', async (context) => {
      const duration = defaultOptions.includeTiming && timings.has(context) 
        ? Date.now() - timings.get(context) 
        : undefined;

      if (defaultOptions.includeResponse) {
        api.log.info(`${context.method.toUpperCase()} ${context.options.type} completed`, {
          operation: context.method,
          type: context.options.type,
          id: context.id || context.result?.id,
          requestId: context.options.requestId,
          userId: context.options.userId,
          duration,
          resultCount: context.results?.length
        });
      }

      // Clean up timing
      if (timings.has(context)) {
        timings.delete(context);
      }
    });

    // Log errors
    api.hook('afterValidate', async (context) => {
      if (context.errors.length > 0) {
        api.log.warn('Validation errors', {
          operation: context.method,
          type: context.options.type,
          errors: context.errors,
          requestId: context.options.requestId,
          userId: context.options.userId
        });
      }
    });

    // Log database operations
    if (api.mysqlPools) {
      // Wrap MySQL query method to add logging
      const originalGetConnection = api.getConnection;
      api.getConnection = (name) => {
        const conn = originalGetConnection.call(api, name);
        
        // Wrap the query method
        const originalQuery = conn.pool.query.bind(conn.pool);
        conn.pool.query = async (sql, params) => {
          const start = Date.now();
          
          try {
            const result = await originalQuery(sql, params);
            
            api.log.debug('SQL query executed', {
              sql: sql.substring(0, 200), // Truncate long queries
              duration: Date.now() - start,
              rowCount: result[0]?.length
            });
            
            return result;
          } catch (error) {
            api.log.error('SQL query failed', {
              sql: sql.substring(0, 200),
              error: error.message,
              duration: Date.now() - start
            });
            throw error;
          }
        };
        
        return conn;
      };
    }

    // HTTP request logging
    if (api.router) {
      api.router.use((req, res, next) => {
        const start = Date.now();
        const requestId = req.headers['x-request-id'] || generateId();
        
        // Add request ID to context
        req.requestId = requestId;
        
        // Log request
        api.log.info('HTTP request', {
          method: req.method,
          url: req.url,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          requestId
        });

        // Log response
        const originalSend = res.send;
        res.send = function(data) {
          res.send = originalSend;
          
          api.log.info('HTTP response', {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: Date.now() - start,
            requestId
          });
          
          return res.send(data);
        };

        next();
      });
    }

    // Audit logging for sensitive operations
    api.hook('afterInsert', async (context) => {
      if (options.auditLog) {
        api.log.info('Resource created', {
          audit: true,
          operation: 'create',
          type: context.options.type,
          id: context.result?.id,
          userId: context.options.userId,
          changes: context.data
        });
      }
    });

    api.hook('afterUpdate', async (context) => {
      if (options.auditLog) {
        api.log.info('Resource updated', {
          audit: true,
          operation: 'update',
          type: context.options.type,
          id: context.id,
          userId: context.options.userId,
          changes: context.data
        });
      }
    });

    api.hook('afterDelete', async (context) => {
      if (options.auditLog) {
        api.log.info('Resource deleted', {
          audit: true,
          operation: 'delete',
          type: context.options.type,
          id: context.id,
          userId: context.options.userId
        });
      }
    });
  }
};

// Helper to sanitize sensitive data
function sanitizeLogData(data, sensitiveFields) {
  if (typeof data !== 'object' || data === null) return data;
  
  const sanitized = Array.isArray(data) ? [] : {};
  
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    
    // Check if field is sensitive
    const isSensitive = sensitiveFields.some(field => 
      lowerKey.includes(field.toLowerCase())
    );
    
    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeLogData(value, sensitiveFields);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}