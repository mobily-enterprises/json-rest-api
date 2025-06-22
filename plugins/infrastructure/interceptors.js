export const InterceptorsPlugin = {
  install(api, options = {}) {
    const {
      enableRequestInterceptors = true,
      enableResponseInterceptors = true,
      enableErrorInterceptors = true,
      enableTimingInterceptors = true,
      maxInterceptors = 100,
      timeout = 5000
    } = options;

    // Initialize interceptor registry
    const interceptors = {
      request: [],
      response: [],
      error: [],
      timing: []
    };

    // Add interceptor management API
    api.interceptors = {
      request: createInterceptorManager('request', interceptors.request, maxInterceptors),
      response: createInterceptorManager('response', interceptors.response, maxInterceptors),
      error: createInterceptorManager('error', interceptors.error, maxInterceptors),
      timing: createInterceptorManager('timing', interceptors.timing, maxInterceptors),

      // Clear all interceptors
      clear() {
        Object.values(interceptors).forEach(arr => arr.length = 0);
      },

      // Get interceptor stats
      stats() {
        return {
          request: interceptors.request.length,
          response: interceptors.response.length,
          error: interceptors.error.length,
          timing: interceptors.timing.length
        };
      }
    };

    // Request interceptors - run before any processing
    if (enableRequestInterceptors) {
      api.hook('beforeAll', async (context) => {
        if (interceptors.request.length === 0) return;

        // Create interceptor chain
        const chain = createInterceptorChain(interceptors.request, timeout);
        
        try {
          // Run request through interceptors
          const modifiedContext = await chain.run({
            data: context.data,
            query: context.query,
            params: context.params,
            headers: context.request?.headers,
            method: context.method,
            resource: context.options?.type,
            user: context.user
          }, 'request');

          // Apply modifications back to context
          if (modifiedContext.data !== undefined) {
            context.data = modifiedContext.data;
          }
          if (modifiedContext.query !== undefined) {
            context.query = modifiedContext.query;
          }
          if (modifiedContext.params !== undefined) {
            context.params = modifiedContext.params;
          }
          if (modifiedContext.user !== undefined) {
            context.user = modifiedContext.user;
          }
          
          // Store for later use
          context._interceptedRequest = modifiedContext;
        } catch (error) {
          context.error = error;
          context.skip = true;
        }
      }, { priority: 10 }); // Run early but after context
    }

    // Response interceptors - run after processing
    if (enableResponseInterceptors) {
      api.hook('afterAll', async (context) => {
        if (interceptors.response.length === 0 || context.error) return;

        const chain = createInterceptorChain(interceptors.response, timeout);
        
        try {
          // Run response through interceptors
          const modifiedResponse = await chain.run({
            data: context.result,
            status: context.status || 200,
            headers: context.responseHeaders || {},
            meta: context.meta,
            resource: context.options?.type,
            method: context.method,
            request: context._interceptedRequest
          }, 'response');

          // Apply modifications
          if (modifiedResponse.data !== undefined) {
            context.result = modifiedResponse.data;
          }
          if (modifiedResponse.status !== undefined) {
            context.status = modifiedResponse.status;
          }
          if (modifiedResponse.headers !== undefined) {
            context.responseHeaders = modifiedResponse.headers;
          }
          if (modifiedResponse.meta !== undefined) {
            context.meta = modifiedResponse.meta;
          }
        } catch (error) {
          context.error = error;
        }
      }, { priority: 90 }); // Run late but before final response
    }

    // Error interceptors
    if (enableErrorInterceptors) {
      api.hook('beforeError', async (context) => {
        if (interceptors.error.length === 0) return;

        const chain = createInterceptorChain(interceptors.error, timeout);
        
        try {
          const modifiedError = await chain.run({
            error: context.error,
            resource: context.options?.type,
            method: context.method,
            request: context._interceptedRequest,
            context: {
              user: context.user,
              requestId: context.requestId
            }
          }, 'error');

          if (modifiedError.error) {
            context.error = modifiedError.error;
          }
          
          // Allow error recovery
          if (modifiedError.recover) {
            delete context.error;
            context.result = modifiedError.result;
            context.skip = true;
          }
        } catch (interceptorError) {
          // Replace with interceptor error if it fails
          context.error = interceptorError;
        }
      }, { priority: 10 });
    }

    // Timing interceptors for performance monitoring
    if (enableTimingInterceptors) {
      // Before timing
      api.hook('beforeAll', (context) => {
        context._timings = {
          start: Date.now(),
          marks: []
        };
      }, { priority: -10 });

      // After timing
      api.hook('afterAll', async (context) => {
        if (interceptors.timing.length === 0) return;

        const duration = Date.now() - context._timings.start;
        
        const chain = createInterceptorChain(interceptors.timing, timeout);
        
        await chain.run({
          duration,
          marks: context._timings.marks,
          resource: context.options?.type,
          method: context.method,
          status: context.error ? 'error' : 'success',
          error: context.error?.message
        }, 'timing');
      }, { priority: 100 });

      // Helper to add timing marks
      api.mark = (name) => {
        const context = api.context?.get?.() || {};
        if (context._timings) {
          context._timings.marks.push({
            name,
            time: Date.now() - context._timings.start
          });
        }
      };
    }

    // HTTP-specific interceptors
    api.hook('beforeHTTP', (context) => {
      if (!context.request || !context.response) return;

      // Add convenience methods to request
      context.request.intercept = (type, interceptor) => {
        api.interceptors[type].use(interceptor);
      };

      // Add response interceptor helper
      context.response.intercept = (interceptor) => {
        api.interceptors.response.use(interceptor);
      };
    });

    // Common interceptor patterns as static methods
    api.interceptors.common = {
      // Authentication interceptor
      auth(options = {}) {
        return {
          name: 'auth',
          priority: 10,
          async process(context) {
            const token = context.headers?.authorization;
            if (!token && options.required) {
              throw new Error('Authentication required');
            }
            
            if (token && options.validate) {
              context.user = await options.validate(token);
            }
            
            return context;
          }
        };
      },

      // Rate limiting interceptor
      rateLimit(options = {}) {
        const { max = 100, window = 60000 } = options;
        const requests = new Map();

        return {
          name: 'rateLimit',
          priority: 20,
          async process(context) {
            const key = context.user?.id || context.headers?.['x-forwarded-for'] || 'anonymous';
            const now = Date.now();
            
            const userRequests = requests.get(key) || [];
            const recentRequests = userRequests.filter(time => now - time < window);
            
            if (recentRequests.length >= max) {
              const error = new Error('Rate limit exceeded');
              error.status = 429;
              error.retryAfter = Math.ceil((recentRequests[0] + window - now) / 1000);
              throw error;
            }
            
            recentRequests.push(now);
            requests.set(key, recentRequests);
            
            return context;
          }
        };
      },

      // Caching interceptor
      cache(options = {}) {
        const { ttl = 300000, key = (ctx) => `${ctx.resource}:${ctx.method}` } = options;
        const cache = new Map();

        return {
          name: 'cache',
          priority: 30,
          async process(context, type) {
            if (type === 'request' && context.method === 'GET') {
              const cacheKey = key(context);
              const cached = cache.get(cacheKey);
              
              if (cached && Date.now() - cached.time < ttl) {
                context.cached = true;
                context.cachedData = cached.data;
                return context;
              }
            } else if (type === 'response' && context.method === 'GET' && !context.request?.cached) {
              const cacheKey = key(context.request);
              cache.set(cacheKey, {
                data: context.data,
                time: Date.now()
              });
            }
            
            return context;
          }
        };
      },

      // Transform interceptor
      transform(options = {}) {
        const { request: reqTransform, response: resTransform } = options;

        return {
          name: 'transform',
          priority: 50,
          async process(context, type) {
            if (type === 'request' && reqTransform) {
              context.data = await reqTransform(context.data, context);
            } else if (type === 'response' && resTransform) {
              context.data = await resTransform(context.data, context);
            }
            
            return context;
          }
        };
      },

      // Validation interceptor
      validate(schema) {
        return {
          name: 'validate',
          priority: 40,
          async process(context) {
            if (context.method === 'POST' || context.method === 'PUT') {
              const errors = validateData(context.data, schema);
              if (errors.length > 0) {
                const error = new Error('Validation failed');
                error.status = 400;
                error.errors = errors;
                throw error;
              }
            }
            
            return context;
          }
        };
      },

      // Logging interceptor
      logger(options = {}) {
        const { level = 'info', includeData = false } = options;

        return {
          name: 'logger',
          priority: 100,
          async process(context, type) {
            const log = {
              type,
              resource: context.resource,
              method: context.method,
              timestamp: new Date().toISOString()
            };

            if (type === 'request') {
              log.user = context.user?.id;
              if (includeData) log.data = context.data;
            } else if (type === 'response') {
              log.status = context.status;
              if (includeData) log.data = context.data;
            } else if (type === 'error') {
              log.error = context.error.message;
              log.stack = context.error.stack;
            }

            console[level](`[${type.toUpperCase()}]`, JSON.stringify(log));
            
            return context;
          }
        };
      }
    };
  }
};

// Create interceptor manager for a specific type
function createInterceptorManager(type, interceptorArray, maxInterceptors) {
  return {
    use(interceptor, options = {}) {
      if (interceptorArray.length >= maxInterceptors) {
        throw new Error(`Maximum number of ${type} interceptors (${maxInterceptors}) reached`);
      }

      const id = Date.now() + Math.random();
      
      const interceptorConfig = {
        id,
        type,
        priority: options.priority || 50,
        enabled: options.enabled !== false,
        timeout: options.timeout,
        ...interceptor
      };

      // Insert sorted by priority
      const insertIndex = interceptorArray.findIndex(i => i.priority > interceptorConfig.priority);
      if (insertIndex === -1) {
        interceptorArray.push(interceptorConfig);
      } else {
        interceptorArray.splice(insertIndex, 0, interceptorConfig);
      }

      // Return function to remove interceptor
      return () => this.remove(id);
    },

    remove(id) {
      const index = interceptorArray.findIndex(i => i.id === id);
      if (index !== -1) {
        interceptorArray.splice(index, 1);
        return true;
      }
      return false;
    },

    clear() {
      interceptorArray.length = 0;
    },

    enable(id) {
      const interceptor = interceptorArray.find(i => i.id === id);
      if (interceptor) {
        interceptor.enabled = true;
        return true;
      }
      return false;
    },

    disable(id) {
      const interceptor = interceptorArray.find(i => i.id === id);
      if (interceptor) {
        interceptor.enabled = false;
        return true;
      }
      return false;
    },

    list() {
      return interceptorArray.map(i => ({
        id: i.id,
        name: i.name,
        priority: i.priority,
        enabled: i.enabled
      }));
    }
  };
}

// Create interceptor chain executor
function createInterceptorChain(interceptors, defaultTimeout) {
  return {
    async run(context, type) {
      let result = context;

      for (const interceptor of interceptors) {
        if (!interceptor.enabled) continue;

        const timeout = interceptor.timeout || defaultTimeout;
        
        try {
          result = await Promise.race([
            interceptor.process(result, type),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Interceptor ${interceptor.name || interceptor.id} timed out`)), timeout)
            )
          ]);
        } catch (error) {
          if (interceptor.onError) {
            result = await interceptor.onError(error, result, type);
          } else {
            throw error;
          }
        }
      }

      return result;
    }
  };
}

// Simple validation helper
function validateData(data, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    if (rules.required && value === undefined) {
      errors.push(`${field} is required`);
    }

    if (value !== undefined) {
      if (rules.type && typeof value !== rules.type) {
        errors.push(`${field} must be of type ${rules.type}`);
      }

      if (rules.min !== undefined && value < rules.min) {
        errors.push(`${field} must be at least ${rules.min}`);
      }

      if (rules.max !== undefined && value > rules.max) {
        errors.push(`${field} must be at most ${rules.max}`);
      }

      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push(`${field} does not match required pattern`);
      }

      if (rules.custom) {
        const customError = rules.custom(value, data);
        if (customError) {
          errors.push(customError);
        }
      }
    }
  }

  return errors;
}