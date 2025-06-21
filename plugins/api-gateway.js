import { BadRequestError, InternalError, ServiceUnavailableError } from '../lib/errors.js';
import { EventEmitter } from 'events';

/**
 * ApiGatewayPlugin - Transform JSON-REST-API into an API Gateway/Orchestrator
 * 
 * Instead of database-backed resources, create resources that call external APIs
 * with built-in orchestration, transformations, retries, and saga support.
 * 
 * @example
 * // Basic API-backed resource
 * api.use(ApiGatewayPlugin);
 * 
 * api.addApiResource('users', {
 *   baseUrl: 'https://api.userservice.com',
 *   endpoints: {
 *     get: { path: '/users/:id' },
 *     list: { path: '/users', method: 'GET' },
 *     create: { path: '/users', method: 'POST' },
 *     update: { path: '/users/:id', method: 'PUT' },
 *     delete: { path: '/users/:id', method: 'DELETE' }
 *   },
 *   auth: { type: 'bearer', token: process.env.USER_API_TOKEN }
 * });
 * 
 * // Now use it like a normal resource
 * const user = await api.resources.users.get(123);
 * 
 * @example
 * // Advanced: E-commerce checkout orchestration
 * api.saga('CheckoutSaga', {
 *   startsWith: 'CheckoutStarted',
 *   
 *   async handle(event, { executeStep, compensate }) {
 *     try {
 *       // Step 1: Reserve inventory
 *       const reservation = await executeStep('reserveInventory', async () => {
 *         return await api.resources.inventory.reserve({
 *           items: event.data.items,
 *           orderId: event.data.orderId
 *         });
 *       });
 *       
 *       // Step 2: Process payment
 *       const payment = await executeStep('processPayment', async () => {
 *         return await api.resources.payments.charge({
 *           amount: event.data.total,
 *           customerId: event.data.customerId,
 *           orderId: event.data.orderId
 *         });
 *       }, async () => {
 *         // Compensation: Refund if later steps fail
 *         await api.resources.payments.refund(payment.id);
 *       });
 *       
 *       // Step 3: Create shipment
 *       const shipment = await executeStep('createShipment', async () => {
 *         return await api.resources.shipping.create({
 *           orderId: event.data.orderId,
 *           address: event.data.shippingAddress
 *         });
 *       }, async () => {
 *         // Compensation: Cancel shipment
 *         await api.resources.shipping.cancel(shipment.id);
 *       });
 *       
 *       // Success - confirm everything
 *       await api.resources.inventory.confirm(reservation.id);
 *       await api.emitEvent('CheckoutCompleted', { orderId: event.data.orderId });
 *       
 *     } catch (error) {
 *       // Failure - run compensations
 *       await compensate();
 *       await api.emitEvent('CheckoutFailed', { 
 *         orderId: event.data.orderId,
 *         reason: error.message 
 *       });
 *     }
 *   }
 * });
 */

// Circuit breaker for API resilience
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.lastResetTime = Date.now();
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw new ServiceUnavailableError('Circuit breaker is OPEN');
      }
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
      this.successCount++;
      if (this.successCount >= 3) {
        this.state = 'CLOSED';
        this.lastResetTime = Date.now();
      }
    }
  }
  
  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
  
  getStatus() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailureTime,
      uptime: Date.now() - this.lastResetTime
    };
  }
}

// API Client with retries and transformations
class ApiClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.auth = config.auth;
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.transformers = config.transformers || {};
    this.headers = config.headers || {};
  }
  
  async request(endpoint, data = {}, context = {}) {
    const url = this.buildUrl(endpoint, data);
    const options = {
      method: endpoint.method || 'GET',
      headers: this.buildHeaders(endpoint),
      timeout: this.timeout
    };
    
    if (['POST', 'PUT', 'PATCH'].includes(options.method)) {
      options.body = JSON.stringify(
        this.transformRequest(endpoint, data, context)
      );
    }
    
    // Execute with circuit breaker and retries
    return await this.circuitBreaker.execute(async () => {
      return await this.retryRequest(async () => {
        const response = await fetch(url, options);
        
        if (!response.ok) {
          const error = await this.parseError(response);
          throw error;
        }
        
        const result = await response.json();
        return this.transformResponse(endpoint, result, context);
      });
    });
  }
  
  buildUrl(endpoint, data) {
    let url = this.baseUrl + endpoint.path;
    
    // Replace path parameters
    Object.keys(data).forEach(key => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, encodeURIComponent(data[key]));
      }
    });
    
    // Add query parameters
    if (endpoint.method === 'GET' && data) {
      const params = new URLSearchParams();
      Object.entries(data).forEach(([key, value]) => {
        if (!url.includes(`:${key}`) && value !== undefined) {
          params.append(key, value);
        }
      });
      if (params.toString()) {
        url += '?' + params.toString();
      }
    }
    
    return url;
  }
  
  buildHeaders(endpoint) {
    const headers = {
      'Content-Type': 'application/json',
      ...this.headers,
      ...(endpoint.headers || {})
    };
    
    // Add authentication
    if (this.auth) {
      switch (this.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${this.auth.token}`;
          break;
        case 'apiKey':
          headers[this.auth.header || 'X-API-Key'] = this.auth.key;
          break;
        case 'basic':
          const encoded = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
          break;
      }
    }
    
    return headers;
  }
  
  async retryRequest(fn) {
    let lastError;
    
    for (let i = 0; i <= this.retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Don't retry client errors
        if (error.status && error.status < 500) {
          throw error;
        }
        
        if (i < this.retries) {
          await new Promise(resolve => 
            setTimeout(resolve, this.retryDelay * Math.pow(2, i))
          );
        }
      }
    }
    
    throw lastError;
  }
  
  async parseError(response) {
    try {
      const body = await response.json();
      return new InternalError(
        body.message || body.error || `API error: ${response.status}`
      ).withContext({
        status: response.status,
        api: this.baseUrl,
        details: body
      });
    } catch (e) {
      return new InternalError(`API error: ${response.status} ${response.statusText}`)
        .withContext({ status: response.status, api: this.baseUrl });
    }
  }
  
  transformRequest(endpoint, data, context) {
    const transformer = this.transformers[endpoint.name]?.request;
    if (transformer) {
      return transformer(data, context);
    }
    return data;
  }
  
  transformResponse(endpoint, data, context) {
    const transformer = this.transformers[endpoint.name]?.response;
    if (transformer) {
      return transformer(data, context);
    }
    return data;
  }
}

// Saga orchestration for distributed transactions
class SagaOrchestrator {
  constructor() {
    this.sagas = new Map();
    this.activeSagas = new Map();
    this.eventEmitter = new EventEmitter();
  }
  
  register(name, sagaDefinition) {
    this.sagas.set(name, sagaDefinition);
  }
  
  async handleEvent(event) {
    // Check if any saga should start
    for (const [name, saga] of this.sagas) {
      if (saga.startsWith === event.type) {
        const instance = this.createSagaInstance(name, saga, event);
        await instance.start();
      }
    }
    
    // Check active sagas
    for (const [id, instance] of this.activeSagas) {
      if (instance.handles(event.type)) {
        await instance.handle(event);
      }
    }
  }
  
  createSagaInstance(name, definition, triggerEvent) {
    const id = Math.random().toString(36).substr(2, 9);
    const steps = [];
    const compensations = [];
    let currentStep = 0;
    
    const instance = {
      id,
      name,
      state: 'RUNNING',
      
      async start() {
        this.activeSagas.set(id, this);
        
        try {
          await definition.handle(triggerEvent, {
            executeStep: this.executeStep.bind(this),
            compensate: this.compensate.bind(this),
            getState: () => ({ steps, currentStep }),
            emit: (type, data) => this.eventEmitter.emit(type, { ...data, sagaId: id })
          });
          
          this.state = 'COMPLETED';
          this.activeSagas.delete(id);
        } catch (error) {
          this.state = 'FAILED';
          this.activeSagas.delete(id);
          throw error;
        }
      },
      
      async executeStep(name, action, compensation) {
        const step = {
          name,
          status: 'PENDING',
          startTime: Date.now()
        };
        
        steps.push(step);
        currentStep = steps.length - 1;
        
        try {
          step.status = 'EXECUTING';
          const result = await action();
          step.status = 'COMPLETED';
          step.endTime = Date.now();
          step.result = result;
          
          if (compensation) {
            compensations.push({ step: currentStep, action: compensation });
          }
          
          return result;
        } catch (error) {
          step.status = 'FAILED';
          step.endTime = Date.now();
          step.error = error.message;
          throw error;
        }
      },
      
      async compensate() {
        // Run compensations in reverse order
        for (let i = compensations.length - 1; i >= 0; i--) {
          const { step, action } = compensations[i];
          if (steps[step].status === 'COMPLETED') {
            try {
              await action();
              steps[step].compensated = true;
            } catch (error) {
              console.error(`Compensation failed for step ${steps[step].name}:`, error);
            }
          }
        }
      },
      
      handles(eventType) {
        return definition.handles && definition.handles.includes(eventType);
      },
      
      async handle(event) {
        if (definition.handleEvent) {
          await definition.handleEvent(event, {
            getState: () => ({ steps, currentStep }),
            emit: (type, data) => this.eventEmitter.emit(type, { ...data, sagaId: id })
          });
        }
      }
    };
    
    return instance;
  }
  
  getActiveSagas() {
    const sagas = [];
    for (const [id, instance] of this.activeSagas) {
      sagas.push({
        id,
        name: instance.name,
        state: instance.state
      });
    }
    return sagas;
  }
}

// Main plugin
export const ApiGatewayPlugin = {
  name: 'ApiGatewayPlugin',
  
  install(api, options = {}) {
    const {
      enableSagas = true,
      enableMetrics = true,
      defaultTimeout = 30000,
      defaultRetries = 3
    } = options;
    
    // Initialize components
    const apiClients = new Map();
    const sagaOrchestrator = enableSagas ? new SagaOrchestrator() : null;
    const metrics = enableMetrics ? new Map() : null;
    
    // Store reference
    api._gateway = {
      clients: apiClients,
      orchestrator: sagaOrchestrator,
      metrics
    };
    
    /**
     * Add an API-backed resource
     */
    api.addApiResource = (type, config) => {
      const client = new ApiClient({
        ...config,
        timeout: config.timeout || defaultTimeout,
        retries: config.retries || defaultRetries
      });
      
      apiClients.set(type, client);
      
      // Create resource proxy
      const resource = {
        async get(id, options = {}) {
          const endpoint = config.endpoints.get || { path: `/${type}/:id`, method: 'GET' };
          const startTime = Date.now();
          
          try {
            const result = await client.request(endpoint, { id }, options);
            recordMetric(type, 'get', Date.now() - startTime, true);
            return { data: formatResource(type, result) };
          } catch (error) {
            recordMetric(type, 'get', Date.now() - startTime, false);
            throw error;
          }
        },
        
        async query(params = {}, options = {}) {
          const endpoint = config.endpoints.list || { path: `/${type}`, method: 'GET' };
          const startTime = Date.now();
          
          try {
            const result = await client.request(endpoint, params, options);
            recordMetric(type, 'query', Date.now() - startTime, true);
            
            // Handle pagination
            const data = Array.isArray(result) ? result : result.data || result.items || [];
            const meta = result.meta || result.pagination || {};
            
            return {
              data: data.map(item => formatResource(type, item)),
              meta
            };
          } catch (error) {
            recordMetric(type, 'query', Date.now() - startTime, false);
            throw error;
          }
        },
        
        async create(data, options = {}) {
          const endpoint = config.endpoints.create || { path: `/${type}`, method: 'POST' };
          const startTime = Date.now();
          
          try {
            const result = await client.request(endpoint, data, options);
            recordMetric(type, 'create', Date.now() - startTime, true);
            
            // Emit event for sagas
            if (sagaOrchestrator) {
              await api.emitEvent(`${type}Created`, result);
            }
            
            return { data: formatResource(type, result) };
          } catch (error) {
            recordMetric(type, 'create', Date.now() - startTime, false);
            throw error;
          }
        },
        
        async update(id, data, options = {}) {
          const endpoint = config.endpoints.update || { path: `/${type}/:id`, method: 'PUT' };
          const startTime = Date.now();
          
          try {
            const result = await client.request(endpoint, { id, ...data }, options);
            recordMetric(type, 'update', Date.now() - startTime, true);
            
            // Emit event for sagas
            if (sagaOrchestrator) {
              await api.emitEvent(`${type}Updated`, { id, changes: data });
            }
            
            return { data: formatResource(type, result) };
          } catch (error) {
            recordMetric(type, 'update', Date.now() - startTime, false);
            throw error;
          }
        },
        
        async delete(id, options = {}) {
          const endpoint = config.endpoints.delete || { path: `/${type}/:id`, method: 'DELETE' };
          const startTime = Date.now();
          
          try {
            await client.request(endpoint, { id }, options);
            recordMetric(type, 'delete', Date.now() - startTime, true);
            
            // Emit event for sagas
            if (sagaOrchestrator) {
              await api.emitEvent(`${type}Deleted`, { id });
            }
            
            return { success: true };
          } catch (error) {
            recordMetric(type, 'delete', Date.now() - startTime, false);
            throw error;
          }
        },
        
        // Custom methods
        async execute(method, data, options = {}) {
          const endpoint = config.endpoints[method];
          if (!endpoint) {
            throw new BadRequestError(`Unknown method: ${method}`);
          }
          
          const startTime = Date.now();
          
          try {
            const result = await client.request(endpoint, data, options);
            recordMetric(type, method, Date.now() - startTime, true);
            return result;
          } catch (error) {
            recordMetric(type, method, Date.now() - startTime, false);
            throw error;
          }
        }
      };
      
      // Add to resources
      if (!api.resources) {
        api.resources = {};
      }
      api.resources[type] = resource;
      
      // Add custom methods
      if (config.methods) {
        Object.entries(config.methods).forEach(([name, endpoint]) => {
          resource[name] = async (data, options) => {
            return await resource.execute(name, data, options);
          };
        });
      }
      
      return api;
    };
    
    /**
     * Register a saga for orchestration
     */
    api.saga = (name, definition) => {
      if (!sagaOrchestrator) {
        throw new Error('Sagas not enabled. Set enableSagas: true in plugin options');
      }
      
      sagaOrchestrator.register(name, definition);
      return api;
    };
    
    /**
     * Emit an event (for saga triggers)
     */
    api.emitEvent = async (type, data) => {
      const event = {
        id: Math.random().toString(36).substr(2, 9),
        type,
        data,
        timestamp: Date.now()
      };
      
      if (sagaOrchestrator) {
        await sagaOrchestrator.handleEvent(event);
      }
      
      return event;
    };
    
    /**
     * Get API health status
     */
    api.getApiHealth = () => {
      const health = {};
      
      for (const [name, client] of apiClients) {
        health[name] = {
          url: client.baseUrl,
          circuit: client.circuitBreaker.getStatus()
        };
        
        if (metrics) {
          const typeMetrics = metrics.get(name);
          if (typeMetrics) {
            health[name].metrics = {
              requests: typeMetrics.total || 0,
              errors: typeMetrics.errors || 0,
              avgResponseTime: typeMetrics.totalTime 
                ? Math.round(typeMetrics.totalTime / typeMetrics.total)
                : 0
            };
          }
        }
      }
      
      if (sagaOrchestrator) {
        health.sagas = {
          active: sagaOrchestrator.getActiveSagas()
        };
      }
      
      return health;
    };
    
    /**
     * Configure API transformers
     */
    api.configureApi = (type, config) => {
      const client = apiClients.get(type);
      if (!client) {
        throw new BadRequestError(`API resource '${type}' not found`);
      }
      
      if (config.transformers) {
        Object.assign(client.transformers, config.transformers);
      }
      
      if (config.headers) {
        Object.assign(client.headers, config.headers);
      }
      
      return api;
    };
    
    /**
     * Batch API calls with optional transaction semantics
     */
    api.batchApiCalls = async (calls, options = {}) => {
      const { transactional = false } = options;
      const results = [];
      const completed = [];
      
      try {
        for (const call of calls) {
          const { resource, method, data } = call;
          const result = await api.resources[resource][method](data);
          results.push({ success: true, data: result });
          completed.push(call);
        }
        
        return { results, success: true };
      } catch (error) {
        if (transactional) {
          // Rollback completed calls
          for (const call of completed.reverse()) {
            try {
              await rollbackCall(call);
            } catch (e) {
              console.error('Rollback failed:', e);
            }
          }
        }
        
        results.push({ success: false, error: error.message });
        return { results, success: false, error };
      }
    };
    
    // Helper functions
    function formatResource(type, data) {
      // Ensure JSON:API format
      if (data.type && data.id) {
        return data;
      }
      
      return {
        type,
        id: String(data.id || data._id || data.uuid),
        attributes: Object.keys(data).reduce((attrs, key) => {
          if (!['id', '_id', 'uuid', 'type'].includes(key)) {
            attrs[key] = data[key];
          }
          return attrs;
        }, {})
      };
    }
    
    function recordMetric(type, operation, duration, success) {
      if (!metrics) return;
      
      if (!metrics.has(type)) {
        metrics.set(type, {});
      }
      
      const typeMetrics = metrics.get(type);
      typeMetrics.total = (typeMetrics.total || 0) + 1;
      typeMetrics.totalTime = (typeMetrics.totalTime || 0) + duration;
      
      if (!success) {
        typeMetrics.errors = (typeMetrics.errors || 0) + 1;
      }
      
      // Keep last 100 response times for percentiles
      if (!typeMetrics.durations) {
        typeMetrics.durations = [];
      }
      typeMetrics.durations.push(duration);
      if (typeMetrics.durations.length > 100) {
        typeMetrics.durations.shift();
      }
    }
    
    async function rollbackCall(call) {
      const { resource, method } = call;
      
      // Define rollback operations
      const rollbacks = {
        create: async (result) => {
          if (result.data && result.data.id) {
            await api.resources[resource].delete(result.data.id);
          }
        },
        update: async (result, originalData) => {
          if (result.data && result.data.id && originalData) {
            await api.resources[resource].update(result.data.id, originalData);
          }
        },
        delete: async (deletedId, originalData) => {
          if (originalData) {
            await api.resources[resource].create(originalData);
          }
        }
      };
      
      if (rollbacks[method]) {
        await rollbacks[method](call.result, call.originalData);
      }
    }
  }
};