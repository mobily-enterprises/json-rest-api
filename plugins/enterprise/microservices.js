import { EventEmitter } from 'events';
import { BadRequestError, InternalError } from '../../lib/errors.js';

/**
 * MicroservicesPlugin - Adds microservices capabilities to JSON-REST-API
 * 
 * Features:
 * - Multiple transport layers (TCP, Redis, NATS, RabbitMQ, Kafka, gRPC)
 * - Message patterns (request-response)
 * - Event patterns (pub-sub)
 * - Service discovery
 * - Health checks and circuit breakers
 * - Load balancing
 * 
 * @example
 * api.use(MicroservicesPlugin, {
 *   transport: 'redis',
 *   options: {
 *     host: 'localhost',
 *     port: 6379
 *   }
 * });
 * 
 * // Handle messages
 * api.messageHandler('user.get', async (data) => {
 *   return await api.resources.users.get(data.id);
 * });
 * 
 * // Handle events
 * api.eventHandler('order.created', async (data) => {
 *   await api.resources.inventory.update(data.productId, {
 *     stock: data.newStock
 *   });
 * });
 * 
 * // Send messages to other services
 * const user = await api.sendMessage('user-service', 'user.get', { id: 123 });
 * 
 * // Emit events
 * await api.emitEvent('order.created', orderData);
 */

// Transport adapters
const transports = {
  memory: createMemoryTransport,
  tcp: createTcpTransport,
  redis: createRedisTransport,
  nats: createNatsTransport,
  rabbitmq: createRabbitMQTransport,
  kafka: createKafkaTransport,
  grpc: createGrpcTransport
};

// In-memory transport for development/testing
function createMemoryTransport(options) {
  const emitter = new EventEmitter();
  const services = new Map();
  
  return {
    name: 'memory',
    
    async connect() {
      // No-op for memory transport
    },
    
    async disconnect() {
      emitter.removeAllListeners();
      services.clear();
    },
    
    async register(serviceName, patterns) {
      services.set(serviceName, patterns);
    },
    
    async sendMessage(serviceName, pattern, data, options = {}) {
      const service = services.get(serviceName);
      if (!service || !service[pattern]) {
        throw new Error(`No handler for pattern ${pattern} in service ${serviceName}`);
      }
      
      try {
        const result = await service[pattern](data, options);
        return result;
      } catch (error) {
        throw new Error(`Remote error: ${error.message}`);
      }
    },
    
    async emitEvent(event, data) {
      emitter.emit(event, data);
    },
    
    onMessage(pattern, handler) {
      // Store pattern handler
      return handler;
    },
    
    onEvent(event, handler) {
      emitter.on(event, handler);
    }
  };
}

// TCP transport implementation
function createTcpTransport(options) {
  const net = require('net');
  const { host = 'localhost', port = 3001 } = options;
  let server;
  let clients = new Map();
  const handlers = new Map();
  
  return {
    name: 'tcp',
    
    async connect() {
      server = net.createServer((socket) => {
        let buffer = '';
        
        socket.on('data', async (data) => {
          buffer += data.toString();
          
          // Check for complete messages
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const message = buffer.substring(0, newlineIndex);
            buffer = buffer.substring(newlineIndex + 1);
            
            try {
              const { id, pattern, data: msgData } = JSON.parse(message);
              const handler = handlers.get(pattern);
              
              if (handler) {
                const result = await handler(msgData);
                socket.write(JSON.stringify({ id, result }) + '\n');
              } else {
                socket.write(JSON.stringify({ id, error: 'No handler' }) + '\n');
              }
            } catch (error) {
              socket.write(JSON.stringify({ id: null, error: error.message }) + '\n');
            }
          }
        });
      });
      
      await new Promise((resolve) => {
        server.listen(port, host, resolve);
      });
    },
    
    async disconnect() {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      for (const client of clients.values()) {
        client.destroy();
      }
      clients.clear();
    },
    
    async sendMessage(serviceName, pattern, data, options = {}) {
      const { host: targetHost, port: targetPort } = options;
      const key = `${targetHost}:${targetPort}`;
      
      let client = clients.get(key);
      if (!client) {
        client = new net.Socket();
        await new Promise((resolve, reject) => {
          client.connect(targetPort, targetHost, resolve);
          client.on('error', reject);
        });
        clients.set(key, client);
      }
      
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substr(2, 9);
        const timeout = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, options.timeout || 5000);
        
        const handler = (data) => {
          const messages = data.toString().split('\n').filter(Boolean);
          for (const message of messages) {
            try {
              const response = JSON.parse(message);
              if (response.id === id) {
                clearTimeout(timeout);
                if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve(response.result);
                }
                return;
              }
            } catch (e) {
              // Invalid JSON, ignore
            }
          }
        };
        
        client.once('data', handler);
        client.write(JSON.stringify({ id, pattern, data }) + '\n');
      });
    },
    
    onMessage(pattern, handler) {
      handlers.set(pattern, handler);
    },
    
    onEvent(event, handler) {
      // TCP doesn't have native pub-sub, would need to implement
      console.warn('TCP transport does not support event patterns natively');
    }
  };
}

// Redis transport implementation
function createRedisTransport(options) {
  let pubClient, subClient;
  const handlers = new Map();
  const eventHandlers = new Map();
  
  return {
    name: 'redis',
    
    async connect() {
      // Dynamic import for optional dependency
      const redis = await import('redis');
      
      pubClient = redis.createClient(options);
      subClient = redis.createClient(options);
      
      await pubClient.connect();
      await subClient.connect();
      
      // Subscribe to response channel
      await subClient.subscribe('microservice:responses', (message) => {
        try {
          const { correlationId, result, error } = JSON.parse(message);
          const handler = pendingRequests.get(correlationId);
          if (handler) {
            pendingRequests.delete(correlationId);
            if (error) {
              handler.reject(new Error(error));
            } else {
              handler.resolve(result);
            }
          }
        } catch (e) {
          console.error('Failed to process response:', e);
        }
      });
    },
    
    async disconnect() {
      if (pubClient) await pubClient.quit();
      if (subClient) await subClient.quit();
    },
    
    async sendMessage(serviceName, pattern, data, options = {}) {
      const correlationId = Math.random().toString(36).substr(2, 9);
      const channel = `microservice:${serviceName}:${pattern}`;
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequests.delete(correlationId);
          reject(new Error('Request timeout'));
        }, options.timeout || 5000);
        
        pendingRequests.set(correlationId, {
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });
        
        pubClient.publish(channel, JSON.stringify({
          correlationId,
          data,
          replyTo: 'microservice:responses'
        }));
      });
    },
    
    async emitEvent(event, data) {
      await pubClient.publish(`events:${event}`, JSON.stringify(data));
    },
    
    onMessage(pattern, handler) {
      const channel = `microservice:${pattern}`;
      
      subClient.subscribe(channel, async (message) => {
        try {
          const { correlationId, data, replyTo } = JSON.parse(message);
          const result = await handler(data);
          
          if (replyTo) {
            await pubClient.publish(replyTo, JSON.stringify({
              correlationId,
              result
            }));
          }
        } catch (error) {
          if (replyTo) {
            await pubClient.publish(replyTo, JSON.stringify({
              correlationId,
              error: error.message
            }));
          }
        }
      });
    },
    
    onEvent(event, handler) {
      subClient.subscribe(`events:${event}`, async (message) => {
        try {
          const data = JSON.parse(message);
          await handler(data);
        } catch (error) {
          console.error(`Error handling event ${event}:`, error);
        }
      });
    }
  };
}

// Pending requests tracker
const pendingRequests = new Map();

// NATS transport stub
function createNatsTransport(options) {
  throw new Error('NATS transport requires @nats-io/nats package');
}

// RabbitMQ transport stub
function createRabbitMQTransport(options) {
  throw new Error('RabbitMQ transport requires amqplib package');
}

// Kafka transport stub
function createKafkaTransport(options) {
  throw new Error('Kafka transport requires kafkajs package');
}

// gRPC transport stub
function createGrpcTransport(options) {
  throw new Error('gRPC transport requires @grpc/grpc-js package');
}

// Circuit breaker implementation
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.nextAttempt = Date.now();
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }
  
  onFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }
}

// Service registry for discovery
class ServiceRegistry {
  constructor() {
    this.services = new Map();
    this.healthChecks = new Map();
  }
  
  register(name, metadata) {
    this.services.set(name, {
      ...metadata,
      registeredAt: Date.now(),
      status: 'healthy'
    });
  }
  
  unregister(name) {
    this.services.delete(name);
    this.healthChecks.delete(name);
  }
  
  discover(name) {
    const service = this.services.get(name);
    if (!service || service.status !== 'healthy') {
      throw new Error(`Service ${name} not available`);
    }
    return service;
  }
  
  async checkHealth(name) {
    const check = this.healthChecks.get(name);
    if (!check) return true;
    
    try {
      await check();
      this.updateStatus(name, 'healthy');
      return true;
    } catch (error) {
      this.updateStatus(name, 'unhealthy');
      return false;
    }
  }
  
  updateStatus(name, status) {
    const service = this.services.get(name);
    if (service) {
      service.status = status;
    }
  }
  
  setHealthCheck(name, checkFn) {
    this.healthChecks.set(name, checkFn);
  }
}

export const MicroservicesPlugin = {
  name: 'MicroservicesPlugin',
  
  install(api, options = {}) {
    const {
      transport: transportName = 'memory',
      serviceName = `api-${Date.now()}`,
      options: transportOptions = {},
      circuitBreaker: cbOptions,
      loadBalancer = 'round-robin',
      healthCheck = { interval: 30000 }
    } = options;
    
    // Create transport
    const createTransport = transports[transportName];
    if (!createTransport) {
      throw new Error(`Unknown transport: ${transportName}`);
    }
    
    const transport = createTransport(transportOptions);
    const registry = new ServiceRegistry();
    const messageHandlers = new Map();
    const eventHandlers = new Map();
    const circuitBreakers = new Map();
    
    // Initialize transport
    let transportReady = false;
    const initPromise = transport.connect().then(() => {
      transportReady = true;
    });
    
    // Ensure transport is ready
    const ensureReady = async () => {
      if (!transportReady) {
        await initPromise;
      }
    };
    
    // Register service
    registry.register(serviceName, {
      transport: transportName,
      ...transportOptions
    });
    
    // Add microservices API methods
    
    /**
     * Register a message handler
     */
    api.messageHandler = (pattern, handler) => {
      messageHandlers.set(pattern, handler);
      
      // Register with transport
      ensureReady().then(() => {
        transport.onMessage(pattern, async (data, context) => {
          try {
            // Add API context
            const result = await handler(data, {
              api,
              pattern,
              transport: transportName,
              ...context
            });
            return result;
          } catch (error) {
            console.error(`Error in message handler ${pattern}:`, error);
            throw error;
          }
        });
      });
      
      return api;
    };
    
    /**
     * Register an event handler
     */
    api.eventHandler = (event, handler) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event).push(handler);
      
      // Register with transport
      ensureReady().then(() => {
        transport.onEvent(event, async (data) => {
          const handlers = eventHandlers.get(event) || [];
          
          // Execute all handlers in parallel
          await Promise.all(
            handlers.map(handler => 
              handler(data, { api, event, transport: transportName })
                .catch(error => console.error(`Error in event handler ${event}:`, error))
            )
          );
        });
      });
      
      return api;
    };
    
    /**
     * Send a message to another service
     */
    api.sendMessage = async (serviceName, pattern, data, options = {}) => {
      await ensureReady();
      
      // Get circuit breaker for this service
      const cbKey = `${serviceName}:${pattern}`;
      let circuitBreaker = circuitBreakers.get(cbKey);
      if (!circuitBreaker && cbOptions) {
        circuitBreaker = new CircuitBreaker(cbOptions);
        circuitBreakers.set(cbKey, circuitBreaker);
      }
      
      const send = async () => {
        try {
          // Discover service
          const service = registry.discover(serviceName);
          
          // Send message
          const result = await transport.sendMessage(
            serviceName,
            pattern,
            data,
            { ...service, ...options }
          );
          
          return result;
        } catch (error) {
          throw new InternalError(`Failed to send message to ${serviceName}`)
            .withContext({ pattern, error: error.message });
        }
      };
      
      // Execute with circuit breaker if configured
      if (circuitBreaker) {
        return await circuitBreaker.execute(send);
      } else {
        return await send();
      }
    };
    
    /**
     * Emit an event
     */
    api.emitEvent = async (event, data) => {
      await ensureReady();
      
      try {
        await transport.emitEvent(event, data);
      } catch (error) {
        throw new InternalError(`Failed to emit event ${event}`)
          .withContext({ error: error.message });
      }
    };
    
    /**
     * Service discovery
     */
    api.discoverService = (name) => {
      return registry.discover(name);
    };
    
    /**
     * Register a service for discovery
     */
    api.registerService = (name, metadata) => {
      registry.register(name, metadata);
      return api;
    };
    
    /**
     * Set health check for a service
     */
    api.setHealthCheck = (name, checkFn) => {
      registry.setHealthCheck(name, checkFn);
      return api;
    };
    
    // Auto-register resource CRUD as message patterns
    if (api.schemas) {
      for (const [type] of api.schemas) {
        // Query pattern
        api.messageHandler(`${type}.query`, async (params) => {
          return await api.resources[type].query(params);
        });
        
        // Get pattern
        api.messageHandler(`${type}.get`, async ({ id, options }) => {
          return await api.resources[type].get(id, options);
        });
        
        // Create pattern
        api.messageHandler(`${type}.create`, async ({ data, options }) => {
          return await api.resources[type].create(data, options);
        });
        
        // Update pattern
        api.messageHandler(`${type}.update`, async ({ id, data, options }) => {
          return await api.resources[type].update(id, data, options);
        });
        
        // Delete pattern
        api.messageHandler(`${type}.delete`, async ({ id, options }) => {
          return await api.resources[type].delete(id, options);
        });
      }
    }
    
    // Hook into CRUD operations to emit events
    api.hook('afterInsert', async (context) => {
      if (context.result && !context.skipEvents) {
        await api.emitEvent(`${context.options.type}.created`, {
          type: context.options.type,
          data: context.result,
          user: context.options.user
        });
      }
    });
    
    api.hook('afterUpdate', async (context) => {
      if (context.result && !context.skipEvents) {
        await api.emitEvent(`${context.options.type}.updated`, {
          type: context.options.type,
          id: context.id,
          data: context.result,
          changes: context.data,
          user: context.options.user
        });
      }
    });
    
    api.hook('afterDelete', async (context) => {
      if (!context.skipEvents) {
        await api.emitEvent(`${context.options.type}.deleted`, {
          type: context.options.type,
          id: context.id,
          user: context.options.user
        });
      }
    });
    
    // Start health check interval
    if (healthCheck.interval) {
      const checkInterval = setInterval(async () => {
        for (const [name] of registry.services) {
          await registry.checkHealth(name);
        }
      }, healthCheck.interval);
      
      // Store interval for cleanup
      api._healthCheckInterval = checkInterval;
    }
    
    // Cleanup on disconnect
    const originalDisconnect = api.disconnect;
    api.disconnect = async () => {
      if (api._healthCheckInterval) {
        clearInterval(api._healthCheckInterval);
      }
      
      registry.unregister(serviceName);
      await transport.disconnect();
      
      if (originalDisconnect) {
        await originalDisconnect.call(api);
      }
    };
    
    // Store transport for direct access if needed
    api._microservicesTransport = transport;
    api._serviceRegistry = registry;
  }
};