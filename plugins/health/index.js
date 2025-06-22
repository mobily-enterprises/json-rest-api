import { EventEmitter } from 'events';
import client from 'prom-client';

export const HealthPlugin = {
  install(api, options = {}) {
    const {
      path = '/health',
      metricsPath = '/metrics',
      checks = {},
      timeout = 5000,
      gracefulShutdown = true,
      degradedThreshold = 0.5
    } = options;

    // Initialize Prometheus metrics
    const register = new client.Registry();
    
    // Default metrics
    client.collectDefaultMetrics({ register });
    
    // Custom metrics
    const httpDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status'],
      registers: [register]
    });

    const healthCheckDuration = new client.Histogram({
      name: 'health_check_duration_seconds',
      help: 'Duration of health checks in seconds',
      labelNames: ['check'],
      registers: [register]
    });

    const healthCheckStatus = new client.Gauge({
      name: 'health_check_status',
      help: 'Status of health checks (1 = healthy, 0 = unhealthy)',
      labelNames: ['check'],
      registers: [register]
    });

    // Health check registry
    const healthChecks = new Map();
    const checkResults = new Map();
    const emitter = new EventEmitter();

    // Add built-in checks
    healthChecks.set('api', {
      name: 'api',
      check: async () => {
        // Check if API is responding
        return { status: 'healthy', message: 'API is operational' };
      }
    });

    // Add database check if storage adapter is available
    if (api.execute && api.connection) {
      healthChecks.set('database', {
        name: 'database',
        critical: true,
        check: async () => {
          try {
            // Try a simple query
            await api.execute('query', {
              sql: 'SELECT 1',
              args: []
            });
            return { status: 'healthy', message: 'Database connection active' };
          } catch (error) {
            return { 
              status: 'unhealthy', 
              message: 'Database connection failed',
              error: error.message 
            };
          }
        }
      });
    }

    // Add memory check
    healthChecks.set('memory', {
      name: 'memory',
      check: async () => {
        const usage = process.memoryUsage();
        const heapUsedMB = usage.heapUsed / 1024 / 1024;
        const heapTotalMB = usage.heapTotal / 1024 / 1024;
        const percentage = (usage.heapUsed / usage.heapTotal) * 100;

        if (percentage > 90) {
          return {
            status: 'unhealthy',
            message: `Memory usage critical: ${percentage.toFixed(2)}%`,
            data: { heapUsedMB, heapTotalMB, percentage }
          };
        } else if (percentage > 75) {
          return {
            status: 'degraded',
            message: `Memory usage high: ${percentage.toFixed(2)}%`,
            data: { heapUsedMB, heapTotalMB, percentage }
          };
        }

        return {
          status: 'healthy',
          message: `Memory usage normal: ${percentage.toFixed(2)}%`,
          data: { heapUsedMB, heapTotalMB, percentage }
        };
      }
    });

    // Add custom checks from options
    Object.entries(checks).forEach(([name, check]) => {
      if (typeof check === 'function') {
        healthChecks.set(name, { name, check });
      } else {
        healthChecks.set(name, check);
      }
    });

    // Execute a single health check
    async function executeCheck(name, checkConfig) {
      const start = Date.now();
      
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Health check timeout')), timeout);
        });

        const result = await Promise.race([
          checkConfig.check(),
          timeoutPromise
        ]);

        const duration = (Date.now() - start) / 1000;
        healthCheckDuration.observe({ check: name }, duration);
        
        const isHealthy = result.status === 'healthy';
        healthCheckStatus.set({ check: name }, isHealthy ? 1 : 0);

        const finalResult = {
          ...result,
          timestamp: new Date().toISOString(),
          duration: duration * 1000,
          name
        };
        
        checkResults.set(name, finalResult);
        emitter.emit('check:complete', { name, result: finalResult });
        return finalResult;
      } catch (error) {
        const duration = (Date.now() - start) / 1000;
        healthCheckDuration.observe({ check: name }, duration);
        healthCheckStatus.set({ check: name }, 0);

        const result = {
          status: 'unhealthy',
          message: error.message,
          error: error.stack,
          timestamp: new Date().toISOString(),
          duration: duration * 1000,
          name
        };

        checkResults.set(name, result);
        emitter.emit('check:error', { name, error });
        return result;
      }
    }

    // Execute all health checks
    async function executeAllChecks() {
      const results = await Promise.all(
        Array.from(healthChecks.entries()).map(([name, config]) => 
          executeCheck(name, config)
        )
      );

      const summary = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        checks: {}
      };

      let unhealthyCount = 0;
      let degradedCount = 0;
      let criticalFailure = false;

      results.forEach(result => {
        summary.checks[result.name] = result;
        
        if (result.status === 'unhealthy') {
          unhealthyCount++;
          const checkConfig = healthChecks.get(result.name);
          if (checkConfig?.critical) {
            criticalFailure = true;
          }
        } else if (result.status === 'degraded') {
          degradedCount++;
        }
      });

      // Determine overall status
      if (criticalFailure || unhealthyCount > 0) {
        summary.status = 'unhealthy';
      } else if (degradedCount / results.length >= degradedThreshold) {
        summary.status = 'degraded';
      }

      emitter.emit('health:update', summary);
      return summary;
    }

    // API methods
    api.health = {
      // Register a new health check
      register(name, check, options = {}) {
        healthChecks.set(name, {
          name,
          check,
          ...options
        });
      },

      // Remove a health check
      unregister(name) {
        healthChecks.delete(name);
        checkResults.delete(name);
      },

      // Get current health status
      async getStatus() {
        return executeAllChecks();
      },

      // Get specific check result
      getCheck(name) {
        return checkResults.get(name);
      },

      // Get all check results
      getAllChecks() {
        return Object.fromEntries(checkResults);
      },

      // Event emitter for monitoring
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),

      // Prometheus registry
      metricsRegistry: register,

      // Record HTTP metrics
      recordHttpMetric(method, route, status, duration) {
        httpDuration.observe(
          { method, route, status: status.toString() },
          duration
        );
      },

      // Cleanup method
      cleanup() {
        // Remove process listeners
        if (api.health._shutdownHandlers) {
          process.removeListener('SIGTERM', api.health._shutdownHandlers.SIGTERM);
          process.removeListener('SIGINT', api.health._shutdownHandlers.SIGINT);
          delete api.health._shutdownHandlers;
        }
        
        // Clear interval if exists
        if (api.health._intervalId) {
          clearInterval(api.health._intervalId);
          delete api.health._intervalId;
        }
        
        // Clear checks and results
        healthChecks.clear();
        checkResults.clear();
      }
    };

    // Liveness probe (basic check - is the process alive?)
    api.health.liveness = async () => {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: api.version || 'unknown'
      };
    };

    // Readiness probe (are all systems go?)
    api.health.readiness = async () => {
      const health = await executeAllChecks();
      
      return {
        ready: health.status === 'healthy',
        status: health.status,
        timestamp: health.timestamp,
        checks: health.checks
      };
    };

    // Startup probe (for slow-starting apps)
    api.health.startup = async () => {
      // Check only critical services
      const criticalChecks = Array.from(healthChecks.entries())
        .filter(([_, config]) => config.critical);

      const results = await Promise.all(
        criticalChecks.map(([name, config]) => executeCheck(name, config))
      );

      const allHealthy = results.every(r => r.status === 'healthy');

      return {
        ready: allHealthy,
        status: allHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: Object.fromEntries(results.map(r => [r.name, r]))
      };
    };

    // Graceful shutdown support
    if (gracefulShutdown) {
      const shutdown = async (signal) => {
        console.log(`Received ${signal}, starting graceful shutdown...`);
        
        // Mark service as terminating
        healthChecks.set('shutdown', {
          name: 'shutdown',
          check: async () => ({
            status: 'unhealthy',
            message: 'Service is shutting down'
          })
        });

        // Wait for ongoing requests to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Cleanup
        emitter.emit('shutdown', signal);
        process.exit(0);
      };

      const shutdownHandlers = {
        SIGTERM: () => shutdown('SIGTERM'),
        SIGINT: () => shutdown('SIGINT')
      };
      
      process.on('SIGTERM', shutdownHandlers.SIGTERM);
      process.on('SIGINT', shutdownHandlers.SIGINT);
      
      // Store handlers for cleanup
      api.health._shutdownHandlers = shutdownHandlers;
    }

    // Periodic health check execution
    if (options.interval) {
      const intervalId = setInterval(() => {
        executeAllChecks().catch(err => {
          console.error('Periodic health check failed:', err);
        });
      }, options.interval);

      // Store interval ID for cleanup
      api.health._intervalId = intervalId;

      // Clean up on shutdown
      emitter.on('shutdown', () => clearInterval(intervalId));
    }

    // Add HTTP endpoints if HTTPPlugin is available or app is provided
    const app = api.app || options.app;
    if (app) {
      // Liveness endpoint
      app.get(`${path}/live`, async (req, res) => {
        const result = await api.health.liveness();
        res.status(200).json(result);
      });

      // Readiness endpoint
      app.get(`${path}/ready`, async (req, res) => {
        const result = await api.health.readiness();
        res.status(result.ready ? 200 : 503).json(result);
      });

      // Startup endpoint
      app.get(`${path}/startup`, async (req, res) => {
        const result = await api.health.startup();
        res.status(result.ready ? 200 : 503).json(result);
      });

      // Full health check endpoint
      app.get(path, async (req, res) => {
        const result = await api.health.getStatus();
        const statusCode = result.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(result);
      });

      // Metrics endpoint
      app.get(metricsPath, async (req, res) => {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
      });

      // Record HTTP metrics
      app.use((req, res, next) => {
        const start = Date.now();
        
        res.on('finish', () => {
          const duration = (Date.now() - start) / 1000;
          api.health.recordHttpMetric(
            req.method,
            req.route?.path || req.path,
            res.statusCode,
            duration
          );
        });
        
        next();
      });
    }
  }
};

// Built-in health checks
export const DatabaseHealthCheck = {
  name: 'database',
  critical: true,
  check: async function(api) {
    try {
      await api.execute('query', { sql: 'SELECT 1', args: [] });
      return { status: 'healthy', message: 'Database is accessible' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: 'Database connection failed',
        error: error.message 
      };
    }
  }
};

export const RedisHealthCheck = {
  name: 'redis',
  check: async function(redis) {
    try {
      await redis.ping();
      return { status: 'healthy', message: 'Redis is accessible' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        message: 'Redis connection failed',
        error: error.message 
      };
    }
  }
};

export const MemoryHealthCheck = {
  name: 'memory',
  check: async function(threshold = 0.9) {
    const usage = process.memoryUsage();
    const percentage = usage.heapUsed / usage.heapTotal;
    
    if (percentage > threshold) {
      return {
        status: 'unhealthy',
        message: `Memory usage above threshold: ${(percentage * 100).toFixed(2)}%`,
        data: usage
      };
    }
    
    return {
      status: 'healthy',
      message: `Memory usage normal: ${(percentage * 100).toFixed(2)}%`,
      data: usage
    };
  }
};