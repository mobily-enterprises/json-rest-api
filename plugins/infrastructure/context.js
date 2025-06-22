import { AsyncLocalStorage } from 'async_hooks';

export const ContextPlugin = {
  install(api, options = {}) {
    const {
      enableRequestId = true,
      enableTracing = true,
      enableUserContext = true,
      enableMetrics = true,
      requestIdHeader = 'x-request-id',
      correlationIdHeader = 'x-correlation-id',
      generateRequestId = () => crypto.randomUUID(),
      contextKeys = [],
      propagateToChildren = true
    } = options;

    // Create async local storage instance
    const asyncLocalStorage = new AsyncLocalStorage();

    // Store reference on API
    api.context = {
      storage: asyncLocalStorage,
      
      // Run function with context
      run(context, fn) {
        return asyncLocalStorage.run(context, fn);
      },

      // Get current context
      get(key) {
        const store = asyncLocalStorage.getStore();
        return key ? store?.[key] : store;
      },

      // Set value in current context
      set(key, value) {
        const store = asyncLocalStorage.getStore();
        if (store) {
          store[key] = value;
        }
      },

      // Update multiple values
      update(values) {
        const store = asyncLocalStorage.getStore();
        if (store) {
          Object.assign(store, values);
        }
      },

      // Check if running in context
      has() {
        return asyncLocalStorage.getStore() !== undefined;
      }
    };

    // Initialize context for all hooks
    api.hook('beforeAll', (hookContext) => {
      // Skip if already in async context
      if (api.context.has()) {
        // Propagate existing context
        const existingContext = api.context.get();
        if (propagateToChildren) {
          Object.assign(hookContext, existingContext);
        }
        return;
      }

      // Create new context
      const context = {
        startTime: Date.now(),
        hookPath: [],
        metrics: {}
      };

      // Add request ID
      if (enableRequestId) {
        context.requestId = hookContext.request?.headers?.[requestIdHeader] || 
                           hookContext.requestId ||
                           generateRequestId();
        
        // Add to hook context for propagation
        hookContext.requestId = context.requestId;
      }

      // Add correlation ID
      if (hookContext.request?.headers?.[correlationIdHeader]) {
        context.correlationId = hookContext.request.headers[correlationIdHeader];
        hookContext.correlationId = context.correlationId;
      }

      // Add user context
      if (enableUserContext && hookContext.user) {
        context.user = hookContext.user;
        context.userId = hookContext.user.id;
        context.userRoles = hookContext.user.roles;
      }

      // Add custom context keys
      for (const key of contextKeys) {
        if (hookContext[key] !== undefined) {
          context[key] = hookContext[key];
        }
      }

      // Run the rest of the hook chain in context
      const originalNext = hookContext.next;
      hookContext.next = async (...args) => {
        return api.context.run(context, async () => {
          return originalNext(...args);
        });
      };
    }, { priority: -1000 }); // Run very early

    // Track hook execution path
    if (enableTracing) {
      api.hook('beforeHook', (context) => {
        const ctx = api.context.get();
        if (ctx && ctx.hookPath) {
          ctx.hookPath.push({
            hook: context.hookName,
            resource: context.options?.type,
            timestamp: Date.now()
          });
        }
      });

      api.hook('afterHook', (context) => {
        const ctx = api.context.get();
        if (ctx && ctx.hookPath) {
          const lastHook = ctx.hookPath[ctx.hookPath.length - 1];
          if (lastHook && lastHook.hook === context.hookName) {
            lastHook.duration = Date.now() - lastHook.timestamp;
          }
        }
      });
    }

    // Collect metrics
    if (enableMetrics) {
      api.hook('afterAll', (hookContext) => {
        const ctx = api.context.get();
        if (ctx && ctx.metrics) {
          ctx.metrics.totalDuration = Date.now() - ctx.startTime;
          
          // Add metrics to response headers if HTTP
          if (hookContext.response && enableRequestId) {
            hookContext.response.setHeader('x-request-duration', ctx.metrics.totalDuration);
            if (ctx.requestId) {
              hookContext.response.setHeader('x-request-id', ctx.requestId);
            }
          }
        }
      }, { priority: 1000 }); // Run very late
    }

    // Add context-aware logging
    api.log = api.log || {};
    const originalLog = { ...api.log };

    ['debug', 'info', 'warn', 'error'].forEach(level => {
      api.log[level] = (message, data = {}) => {
        const ctx = api.context.get();
        const enrichedData = {
          ...data,
          requestId: ctx?.requestId,
          correlationId: ctx?.correlationId,
          userId: ctx?.userId,
          duration: ctx?.startTime ? Date.now() - ctx.startTime : undefined
        };

        if (originalLog[level]) {
          originalLog[level](message, enrichedData);
        } else {
          console[level](`[${level.toUpperCase()}]`, message, enrichedData);
        }
      };
    });

    // Context-aware error handling
    api.hook('beforeError', (context) => {
      const ctx = api.context.get();
      if (ctx && context.error) {
        // Enrich error with context
        context.error.requestId = ctx.requestId;
        context.error.correlationId = ctx.correlationId;
        context.error.userId = ctx.userId;
        context.error.hookPath = ctx.hookPath;
        
        // Add execution trace
        if (ctx.hookPath && ctx.hookPath.length > 0) {
          context.error.executionTrace = ctx.hookPath.map(h => 
            `${h.hook}${h.resource ? `:${h.resource}` : ''}${h.duration ? ` (${h.duration}ms)` : ''}`
          ).join(' → ');
        }
      }
    });

    // Helper to run arbitrary async functions with context
    api.runWithContext = (contextData, fn) => {
      const context = {
        ...contextData,
        startTime: Date.now(),
        requestId: contextData.requestId || generateRequestId()
      };

      return api.context.run(context, fn);
    };

    // Helper to create child contexts
    api.createChildContext = (parentContext = {}) => {
      const current = api.context.get() || {};
      return {
        ...current,
        ...parentContext,
        parentRequestId: current.requestId,
        requestId: generateRequestId()
      };
    };

    // Utility to trace async operations
    api.trace = async (name, fn, metadata = {}) => {
      const ctx = api.context.get();
      if (!ctx) {
        return fn();
      }

      const trace = {
        name,
        startTime: Date.now(),
        metadata
      };

      ctx.traces = ctx.traces || [];
      ctx.traces.push(trace);

      try {
        const result = await fn();
        trace.duration = Date.now() - trace.startTime;
        trace.status = 'success';
        return result;
      } catch (error) {
        trace.duration = Date.now() - trace.startTime;
        trace.status = 'error';
        trace.error = error.message;
        throw error;
      }
    };

    // Context middleware for HTTP requests
    api.hook('beforeHTTP', (context) => {
      if (!context.request || !context.response) return;

      // Create context for HTTP request
      const requestContext = {
        method: context.request.method,
        url: context.request.url,
        path: context.request.path,
        query: context.request.query,
        headers: context.request.headers,
        ip: context.request.ip || context.request.connection?.remoteAddress
      };

      // Merge with existing hook context
      const ctx = api.context.get();
      if (ctx) {
        Object.assign(ctx, requestContext);
      }

      // Add context helpers to request object
      context.request.getContext = () => api.context.get();
      context.request.setContext = (key, value) => api.context.set(key, value);
    });

    // Background task context propagation
    api.runBackgroundTask = (name, fn, parentContext = {}) => {
      const currentContext = api.context.get() || {};
      const taskContext = {
        ...currentContext,
        ...parentContext,
        taskName: name,
        isBackgroundTask: true,
        parentRequestId: currentContext.requestId,
        requestId: generateRequestId(),
        startTime: Date.now()
      };

      // Run task with its own context
      return new Promise((resolve, reject) => {
        api.context.run(taskContext, async () => {
          try {
            const result = await fn();
            api.log.info(`Background task completed: ${name}`, {
              duration: Date.now() - taskContext.startTime
            });
            resolve(result);
          } catch (error) {
            api.log.error(`Background task failed: ${name}`, {
              error: error.message,
              duration: Date.now() - taskContext.startTime
            });
            reject(error);
          }
        });
      });
    };

    // Parallel execution with context
    api.parallel = async (tasks, options = {}) => {
      const { preserveContext = true, shareContext = false } = options;
      const currentContext = api.context.get();

      if (!preserveContext || !currentContext) {
        return Promise.all(tasks.map(t => typeof t === 'function' ? t() : t));
      }

      return Promise.all(tasks.map((task, index) => {
        const taskFn = typeof task === 'function' ? task : () => task;
        
        if (shareContext) {
          // All tasks share the same context
          return api.context.run(currentContext, taskFn);
        } else {
          // Each task gets its own child context
          const childContext = {
            ...currentContext,
            parentRequestId: currentContext.requestId,
            requestId: `${currentContext.requestId}-${index}`,
            taskIndex: index
          };
          return api.context.run(childContext, taskFn);
        }
      }));
    };

    // Context serialization for debugging
    api.hook('afterHTTPResponse', (context) => {
      if (context.request?.headers?.['x-debug-context'] === 'true') {
        const ctx = api.context.get();
        if (ctx && context.response) {
          // Add debug headers
          context.response.setHeader('x-debug-context', JSON.stringify({
            requestId: ctx.requestId,
            duration: Date.now() - ctx.startTime,
            hookCount: ctx.hookPath?.length || 0,
            traces: ctx.traces?.map(t => ({
              name: t.name,
              duration: t.duration,
              status: t.status
            }))
          }));
        }
      }
    });
  }
};