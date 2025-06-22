import { EventEmitter } from 'events';
import { RedisProvider } from './providers/redis.js';
import { ConsulProvider } from './providers/consul.js';
import { KubernetesProvider } from './providers/kubernetes.js';
import { DNSProvider } from './providers/dns.js';
import { LoadBalancer } from './load-balancer.js';
import { CircuitBreaker } from './circuit-breaker.js';

export const ServiceDiscoveryPlugin = {
  install(api, options = {}) {
    const {
      provider = 'redis',
      service = {},
      healthCheck = {
        interval: 30000,
        timeout: 5000,
        failureThreshold: 3
      },
      loadBalancing = {
        strategy: 'round-robin'
      },
      circuitBreaker: circuitBreakerConfig = {
        enabled: true,
        threshold: 5,
        timeout: 60000,
        bucketSize: 10000
      },
      cache = {
        ttl: 60000,
        checkPeriod: 120000
      }
    } = options;

    // Initialize provider
    let discoveryProvider;
    switch (provider) {
      case 'redis':
        discoveryProvider = new RedisProvider(api.redis || options.redis, options);
        break;
      case 'consul':
        discoveryProvider = new ConsulProvider(options.consul);
        break;
      case 'kubernetes':
      case 'k8s':
        discoveryProvider = new KubernetesProvider(options.kubernetes);
        break;
      case 'dns':
        discoveryProvider = new DNSProvider(options.dns);
        break;
      default:
        if (typeof provider === 'object' && provider.register) {
          discoveryProvider = provider;
        } else {
          throw new Error(`Unknown service discovery provider: ${provider}`);
        }
    }

    // Initialize components
    const loadBalancer = new LoadBalancer(loadBalancing.strategy);
    const circuitBreakers = new Map();
    const serviceCache = new Map();
    const healthCheckTimers = new Map();
    const emitter = new EventEmitter();

    // Service registration info
    const localService = {
      id: service.id || `${service.name}-${process.pid}`,
      name: service.name || 'api-service',
      address: service.address || getLocalAddress(),
      port: service.port || process.env.PORT || 3000,
      tags: service.tags || [],
      metadata: {
        version: service.version || api.version || '1.0.0',
        pid: process.pid,
        ...service.metadata
      },
      health: {
        status: 'healthy',
        lastCheck: new Date()
      }
    };

    // API methods
    api.discovery = {
      provider: discoveryProvider,
      localService,
      emitter,

      // Register this service
      async register(serviceOverride = {}) {
        const serviceToRegister = { ...localService, ...serviceOverride };
        
        try {
          await discoveryProvider.register(serviceToRegister);
          
          // Start health check
          if (healthCheck.interval > 0) {
            startHealthCheck(serviceToRegister);
          }
          
          emitter.emit('service:registered', serviceToRegister);
          
          return serviceToRegister;
        } catch (error) {
          emitter.emit('service:register:error', { service: serviceToRegister, error });
          throw error;
        }
      },

      // Deregister this service
      async deregister(serviceId = localService.id) {
        try {
          await discoveryProvider.deregister(serviceId);
          
          // Stop health check
          if (healthCheckTimers.has(serviceId)) {
            clearInterval(healthCheckTimers.get(serviceId));
            healthCheckTimers.delete(serviceId);
          }
          
          emitter.emit('service:deregistered', { id: serviceId });
        } catch (error) {
          emitter.emit('service:deregister:error', { id: serviceId, error });
          throw error;
        }
      },

      // Discover services
      async discover(serviceName, options = {}) {
        const cacheKey = `${serviceName}:${JSON.stringify(options)}`;
        
        // Check cache
        if (!options.noCache && serviceCache.has(cacheKey)) {
          const cached = serviceCache.get(cacheKey);
          if (Date.now() - cached.timestamp < cache.ttl) {
            return cached.services;
          }
        }

        try {
          let services = await discoveryProvider.discover(serviceName, options);
          
          // Filter by tags if specified
          if (options.tags && options.tags.length > 0) {
            services = services.filter(service => 
              options.tags.every(tag => service.tags.includes(tag))
            );
          }
          
          // Filter by metadata
          if (options.metadata) {
            services = services.filter(service => 
              Object.entries(options.metadata).every(([key, value]) => 
                service.metadata && service.metadata[key] === value
              )
            );
          }
          
          // Filter healthy services only
          if (options.healthyOnly !== false) {
            services = services.filter(service => 
              !service.health || service.health.status === 'healthy'
            );
          }
          
          // Update cache
          serviceCache.set(cacheKey, {
            services,
            timestamp: Date.now()
          });
          
          emitter.emit('service:discovered', { name: serviceName, count: services.length });
          
          return services;
        } catch (error) {
          emitter.emit('service:discover:error', { name: serviceName, error });
          throw error;
        }
      },

      // Get next service instance using load balancing
      async getService(serviceName, options = {}) {
        const services = await this.discover(serviceName, options);
        
        if (services.length === 0) {
          throw new Error(`No healthy services found for: ${serviceName}`);
        }

        // Apply load balancing
        const service = loadBalancer.next(serviceName, services);
        
        // Check circuit breaker
        if (circuitBreakerConfig.enabled) {
          const breakerKey = `${service.address}:${service.port}`;
          
          if (!circuitBreakers.has(breakerKey)) {
            circuitBreakers.set(breakerKey, new CircuitBreaker({
              ...circuitBreakerConfig,
              name: breakerKey
            }));
          }
          
          const breaker = circuitBreakers.get(breakerKey);
          if (!breaker.isAvailable()) {
            // Try next service
            const remainingServices = services.filter(s => 
              `${s.address}:${s.port}` !== breakerKey
            );
            
            if (remainingServices.length > 0) {
              return this.getService(serviceName, { 
                ...options, 
                exclude: [service] 
              });
            }
            
            throw new Error(`Service circuit breaker open: ${serviceName}`);
          }
        }
        
        return service;
      },

      // Execute request with service discovery
      async request(serviceName, requestFn, options = {}) {
        const service = await this.getService(serviceName, options);
        const breakerKey = `${service.address}:${service.port}`;
        const breaker = circuitBreakers.get(breakerKey);
        
        try {
          const result = breaker 
            ? await breaker.execute(() => requestFn(service))
            : await requestFn(service);
            
          emitter.emit('service:request:success', { 
            service: serviceName, 
            instance: service 
          });
          
          return result;
        } catch (error) {
          emitter.emit('service:request:error', { 
            service: serviceName, 
            instance: service, 
            error 
          });
          
          // Try failover if enabled
          if (options.failover) {
            const services = await this.discover(serviceName, options);
            const remainingServices = services.filter(s => s !== service);
            
            if (remainingServices.length > 0) {
              return this.request(serviceName, requestFn, {
                ...options,
                exclude: [...(options.exclude || []), service]
              });
            }
          }
          
          throw error;
        }
      },

      // Health check for a service
      async checkHealth(service) {
        if (discoveryProvider.checkHealth) {
          return discoveryProvider.checkHealth(service);
        }
        
        // Default health check (HTTP)
        if (service.healthEndpoint) {
          try {
            const response = await fetch(
              `http://${service.address}:${service.port}${service.healthEndpoint}`,
              { 
                signal: AbortSignal.timeout(healthCheck.timeout)
              }
            );
            
            return {
              status: response.ok ? 'healthy' : 'unhealthy',
              statusCode: response.status,
              timestamp: new Date()
            };
          } catch (error) {
            return {
              status: 'unhealthy',
              error: error.message,
              timestamp: new Date()
            };
          }
        }
        
        return { status: 'healthy', timestamp: new Date() };
      },

      // Update service health
      async updateHealth(serviceId, health) {
        if (discoveryProvider.updateHealth) {
          await discoveryProvider.updateHealth(serviceId, health);
          emitter.emit('service:health:updated', { id: serviceId, health });
        }
      },

      // Load balancer management
      setLoadBalancingStrategy(strategy) {
        loadBalancer.setStrategy(strategy);
      },

      // Circuit breaker management
      getCircuitBreaker(serviceKey) {
        return circuitBreakers.get(serviceKey);
      },

      resetCircuitBreaker(serviceKey) {
        const breaker = circuitBreakers.get(serviceKey);
        if (breaker) {
          breaker.reset();
        }
      },

      // Cache management
      clearCache(serviceName) {
        if (serviceName) {
          for (const key of serviceCache.keys()) {
            if (key.startsWith(serviceName)) {
              serviceCache.delete(key);
            }
          }
        } else {
          serviceCache.clear();
        }
      },

      // Statistics
      getStats() {
        return {
          provider: provider,
          localService: localService,
          cache: {
            size: serviceCache.size,
            entries: Array.from(serviceCache.entries()).map(([key, value]) => ({
              key,
              services: value.services.length,
              age: Date.now() - value.timestamp
            }))
          },
          circuitBreakers: Array.from(circuitBreakers.entries()).map(([key, breaker]) => ({
            service: key,
            state: breaker.getState(),
            stats: breaker.getStats()
          })),
          loadBalancer: loadBalancer.getStats()
        };
      },

      // Event handling
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      once: emitter.once.bind(emitter)
    };

    // Start health check for local service
    function startHealthCheck(service) {
      const checkInterval = setInterval(async () => {
        try {
          const health = await api.discovery.checkHealth(service);
          service.health = health;
          
          if (health.status !== 'healthy') {
            service.health.failureCount = (service.health.failureCount || 0) + 1;
            
            if (service.health.failureCount >= healthCheck.failureThreshold) {
              emitter.emit('service:unhealthy', service);
            }
          } else {
            service.health.failureCount = 0;
          }
          
          await api.discovery.updateHealth(service.id, health);
        } catch (error) {
          emitter.emit('health:check:error', { service, error });
        }
      }, healthCheck.interval);
      
      healthCheckTimers.set(service.id, checkInterval);
    }

    // Clean up cache periodically
    if (cache.checkPeriod > 0) {
      setInterval(() => {
        const now = Date.now();
        for (const [key, value] of serviceCache.entries()) {
          if (now - value.timestamp > cache.ttl) {
            serviceCache.delete(key);
          }
        }
      }, cache.checkPeriod);
    }

    // Auto-register on startup if configured
    if (service.autoRegister !== false && service.name) {
      process.nextTick(() => {
        api.discovery.register().catch(error => {
          console.error('Failed to auto-register service:', error);
        });
      });
    }

    // Graceful shutdown
    const shutdown = async () => {
      try {
        await api.discovery.deregister();
        console.log('Service deregistered successfully');
      } catch (error) {
        console.error('Failed to deregister service:', error);
      }
      
      // Clear timers
      for (const timer of healthCheckTimers.values()) {
        clearInterval(timer);
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
};

// Helper to get local address
function getLocalAddress() {
  const interfaces = require('os').networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return '127.0.0.1';
}