import { BadRequestError, InternalError } from '../../lib/errors.js';
import { EventEmitter } from 'events';

/**
 * DDDPlugin - Domain-Driven Design support for JSON-REST-API
 * 
 * Provides rails and structure for implementing DDD correctly:
 * - Aggregates with consistency boundaries
 * - Value objects with immutability
 * - Domain events with proper naming
 * - Repositories abstracting storage
 * - Domain services for cross-aggregate logic
 * - Bounded contexts with clear boundaries
 * 
 * @example
 * // Define your domain model
 * api.use(DDDPlugin);
 * 
 * // Define value objects
 * class Money extends api.ValueObject {
 *   constructor(amount, currency) {
 *     super({ amount, currency });
 *   }
 *   
 *   add(other) {
 *     this.assertSameCurrency(other);
 *     return new Money(this.amount + other.amount, this.currency);
 *   }
 * }
 * 
 * // Define aggregates
 * class Order extends api.Aggregate {
 *   static get schema() {
 *     return {
 *       customerId: { type: 'id', required: true },
 *       items: { type: 'array', default: [] },
 *       status: { type: 'string', default: 'pending' },
 *       total: { type: 'value', valueObject: Money }
 *     };
 *   }
 *   
 *   addItem(product, quantity) {
 *     this.enforceInvariant(
 *       this.status !== 'shipped',
 *       'Cannot modify shipped orders'
 *     );
 *     
 *     this.items.push({ product, quantity });
 *     this.recalculateTotal();
 *     
 *     this.recordEvent('ItemAdded', { product, quantity });
 *   }
 * }
 * 
 * // Define repositories
 * class OrderRepository extends api.Repository {
 *   constructor() {
 *     super('orders', Order);
 *   }
 *   
 *   async findByCustomer(customerId) {
 *     const data = await this.query({ customerId });
 *     return data.map(d => this.reconstruct(d));
 *   }
 * }
 * 
 * // Define domain services
 * class PricingService extends api.DomainService {
 *   calculateTotal(items, customer) {
 *     let total = new Money(0, 'USD');
 *     
 *     for (const item of items) {
 *       const price = this.getPrice(item.product, customer);
 *       total = total.add(price.multiply(item.quantity));
 *     }
 *     
 *     return total;
 *   }
 * }
 * 
 * // Use bounded contexts
 * api.boundedContext('sales', {
 *   aggregates: [Order, Customer],
 *   services: [PricingService],
 *   repositories: [OrderRepository]
 * });
 */

// Base class for Value Objects
export class ValueObject {
  constructor(props) {
    // Make immutable
    Object.freeze(Object.assign(this, props));
  }
  
  equals(other) {
    if (!other || other.constructor !== this.constructor) {
      return false;
    }
    
    return Object.keys(this).every(key => {
      const a = this[key];
      const b = other[key];
      
      // Handle nested value objects
      if (a && typeof a.equals === 'function') {
        return a.equals(b);
      }
      
      return a === b;
    });
  }
  
  with(changes) {
    // Create new instance with changes
    return new this.constructor({ ...this, ...changes });
  }
  
  toJSON() {
    return { ...this };
  }
  
  static fromJSON(data) {
    return new this(data);
  }
}

// Base class for Entities  
export class Entity {
  constructor(id, props = {}) {
    this.id = id;
    Object.assign(this, props);
    this._domainEvents = [];
  }
  
  equals(other) {
    if (!other || other.constructor !== this.constructor) {
      return false;
    }
    return this.id === other.id;
  }
  
  recordEvent(eventName, data = {}) {
    this._domainEvents.push({
      name: eventName,
      aggregateId: this.id,
      aggregate: this.constructor.name,
      data,
      timestamp: Date.now()
    });
  }
  
  getEvents() {
    return [...this._domainEvents];
  }
  
  clearEvents() {
    this._domainEvents = [];
  }
}

// Base class for Aggregates (with invariant enforcement)
export class Aggregate extends Entity {
  enforceInvariant(condition, message) {
    if (!condition) {
      throw new BadRequestError(message);
    }
  }
  
  validate() {
    // Override in subclasses
  }
  
  static get schema() {
    throw new Error('Aggregates must define a schema');
  }
}

// Base class for Repositories
export class Repository {
  constructor(resourceName, AggregateClass) {
    this.resourceName = resourceName;
    this.AggregateClass = AggregateClass;
    this.api = null; // Will be injected
  }
  
  setApi(api) {
    this.api = api;
  }
  
  async findById(id) {
    const result = await this.api.resources[this.resourceName].get(id);
    if (!result.data) return null;
    
    return this.reconstruct(result.data);
  }
  
  async save(aggregate) {
    aggregate.validate?.();
    
    const data = this.deconstruct(aggregate);
    let result;
    
    if (aggregate.id) {
      result = await this.api.resources[this.resourceName].update(aggregate.id, data);
    } else {
      result = await this.api.resources[this.resourceName].create(data);
      aggregate.id = result.data.id;
    }
    
    // Publish domain events
    const events = aggregate.getEvents();
    for (const event of events) {
      await this.api.emitDomainEvent(event);
    }
    aggregate.clearEvents();
    
    return aggregate;
  }
  
  async delete(id) {
    await this.api.resources[this.resourceName].delete(id);
  }
  
  async query(criteria = {}) {
    const results = await this.api.resources[this.resourceName].query({ filter: criteria });
    return results.data.map(d => this.reconstruct(d));
  }
  
  reconstruct(data) {
    const props = data.attributes || data;
    const id = data.id || props.id;
    
    // Handle value objects
    const schema = this.AggregateClass.schema || {};
    for (const [key, def] of Object.entries(schema)) {
      if (def.type === 'value' && def.valueObject && props[key]) {
        props[key] = def.valueObject.fromJSON(props[key]);
      }
    }
    
    return new this.AggregateClass(id, props);
  }
  
  deconstruct(aggregate) {
    const data = { ...aggregate };
    delete data.id;
    delete data._domainEvents;
    
    // Handle value objects
    const schema = this.AggregateClass.schema || {};
    for (const [key, def] of Object.entries(schema)) {
      if (def.type === 'value' && data[key]) {
        data[key] = data[key].toJSON();
      }
    }
    
    return data;
  }
}

// Base class for Domain Services
export class DomainService {
  constructor() {
    this.api = null; // Will be injected
  }
  
  setApi(api) {
    this.api = api;
  }
}

// Specification pattern for complex queries
export class Specification {
  and(other) {
    return new AndSpecification(this, other);
  }
  
  or(other) {
    return new OrSpecification(this, other);
  }
  
  not() {
    return new NotSpecification(this);
  }
  
  isSatisfiedBy(candidate) {
    throw new Error('Must implement isSatisfiedBy');
  }
  
  toQuery() {
    throw new Error('Must implement toQuery');
  }
}

class AndSpecification extends Specification {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  
  isSatisfiedBy(candidate) {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
  
  toQuery() {
    return { ...this.left.toQuery(), ...this.right.toQuery() };
  }
}

class OrSpecification extends Specification {
  constructor(left, right) {
    super();
    this.left = left;
    this.right = right;
  }
  
  isSatisfiedBy(candidate) {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
  
  toQuery() {
    // This is simplified - real implementation would need OR support
    return { $or: [this.left.toQuery(), this.right.toQuery()] };
  }
}

class NotSpecification extends Specification {
  constructor(spec) {
    super();
    this.spec = spec;
  }
  
  isSatisfiedBy(candidate) {
    return !this.spec.isSatisfiedBy(candidate);
  }
  
  toQuery() {
    const query = this.spec.toQuery();
    // Negate the query
    const negated = {};
    for (const [key, value] of Object.entries(query)) {
      negated[key] = { ne: value };
    }
    return negated;
  }
}

// Bounded Context support
class BoundedContext {
  constructor(name, config = {}) {
    this.name = name;
    this.aggregates = new Map();
    this.repositories = new Map();
    this.services = new Map();
    this.eventHandlers = new Map();
    
    // Register components
    if (config.aggregates) {
      config.aggregates.forEach(agg => this.registerAggregate(agg));
    }
    if (config.repositories) {
      config.repositories.forEach(repo => this.registerRepository(repo));
    }
    if (config.services) {
      config.services.forEach(svc => this.registerService(svc));
    }
  }
  
  registerAggregate(AggregateClass) {
    this.aggregates.set(AggregateClass.name, AggregateClass);
  }
  
  registerRepository(RepositoryClass) {
    const instance = new RepositoryClass();
    this.repositories.set(RepositoryClass.name, instance);
    return instance;
  }
  
  registerService(ServiceClass) {
    const instance = new ServiceClass();
    this.services.set(ServiceClass.name, instance);
    return instance;
  }
  
  onEvent(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    this.eventHandlers.get(eventName).push(handler);
  }
  
  async handleEvent(event) {
    const handlers = this.eventHandlers.get(event.name) || [];
    for (const handler of handlers) {
      await handler(event);
    }
  }
}

// Main plugin
export const DDDPlugin = {
  name: 'DDDPlugin',
  
  install(api, options = {}) {
    const contexts = new Map();
    const globalEventBus = new EventEmitter();
    
    // Expose DDD base classes
    api.ValueObject = ValueObject;
    api.Entity = Entity;
    api.Aggregate = Aggregate;
    api.Repository = Repository;
    api.DomainService = DomainService;
    api.Specification = Specification;
    
    /**
     * Define a bounded context
     */
    api.boundedContext = (name, config = {}) => {
      const context = new BoundedContext(name, config);
      contexts.set(name, context);
      
      // Inject API into repositories and services
      context.repositories.forEach(repo => repo.setApi(api));
      context.services.forEach(service => service.setApi(api));
      
      // Auto-create resources for aggregates
      if (config.aggregates) {
        config.aggregates.forEach(AggregateClass => {
          if (AggregateClass.schema) {
            const resourceName = AggregateClass.name.toLowerCase() + 's';
            if (!api.schemas?.has(resourceName)) {
              api.addResource(resourceName, convertAggregateSchema(AggregateClass.schema));
            }
          }
        });
      }
      
      return context;
    };
    
    /**
     * Get a bounded context
     */
    api.getContext = (name) => {
      return contexts.get(name);
    };
    
    /**
     * Get a repository from any context
     */
    api.getRepository = (repositoryName, contextName) => {
      if (contextName) {
        return contexts.get(contextName)?.repositories.get(repositoryName);
      }
      
      // Search all contexts
      for (const context of contexts.values()) {
        if (context.repositories.has(repositoryName)) {
          return context.repositories.get(repositoryName);
        }
      }
      
      return null;
    };
    
    /**
     * Get a domain service from any context
     */
    api.getService = (serviceName, contextName) => {
      if (contextName) {
        return contexts.get(contextName)?.services.get(serviceName);
      }
      
      // Search all contexts
      for (const context of contexts.values()) {
        if (context.services.has(serviceName)) {
          return context.services.get(serviceName);
        }
      }
      
      return null;
    };
    
    /**
     * Emit a domain event
     */
    api.emitDomainEvent = async (event) => {
      // Normalize event
      if (typeof event === 'string') {
        event = { name: event, data: {} };
      }
      
      if (!event.timestamp) {
        event.timestamp = Date.now();
      }
      
      if (!event.id) {
        event.id = Math.random().toString(36).substr(2, 9);
      }
      
      // Log domain event if configured
      if (options.logEvents) {
        console.log(`[DDD] Domain Event: ${event.name}`, event);
      }
      
      // Notify all contexts
      for (const context of contexts.values()) {
        await context.handleEvent(event);
      }
      
      // Global event bus
      globalEventBus.emit(event.name, event);
      globalEventBus.emit('*', event);
    };
    
    /**
     * Subscribe to domain events globally
     */
    api.onDomainEvent = (eventName, handler) => {
      globalEventBus.on(eventName, handler);
    };
    
    /**
     * Create a domain event class
     */
    api.domainEvent = (name, schema) => {
      return class extends DomainEvent {
        constructor(data) {
          super(name, data);
          // Validate against schema if provided
          if (schema) {
            validateEventData(data, schema);
          }
        }
      };
    };
    
    /**
     * Specification factory
     */
    api.specification = (name, satisfiedBy, toQuery) => {
      return class extends Specification {
        isSatisfiedBy(candidate) {
          return satisfiedBy(candidate);
        }
        
        toQuery() {
          return toQuery ? toQuery() : {};
        }
      };
    };
    
    // Hook to ensure aggregate consistency
    api.hook('beforeInsert', async (context) => {
      await ensureAggregateConsistency(context, contexts);
    });
    
    api.hook('beforeUpdate', async (context) => {
      await ensureAggregateConsistency(context, contexts);
    });
    
    // Hook to publish events after successful operations
    api.hook('afterInsert', async (context) => {
      if (context.domainEvents) {
        for (const event of context.domainEvents) {
          await api.emitDomainEvent(event);
        }
      }
    });
    
    api.hook('afterUpdate', async (context) => {
      if (context.domainEvents) {
        for (const event of context.domainEvents) {
          await api.emitDomainEvent(event);
        }
      }
    });
    
    // Add DDD-specific validations
    if (options.enforceAggregateRules !== false) {
      api.hook('validate', async (context) => {
        validateAggregateRules(context, contexts);
      });
    }
  }
};

// Base domain event class
class DomainEvent {
  constructor(name, data = {}) {
    this.name = name;
    this.data = data;
    this.timestamp = Date.now();
    this.id = Math.random().toString(36).substr(2, 9);
  }
}

// Helper to convert aggregate schema to API schema
function convertAggregateSchema(aggregateSchema) {
  const apiSchema = {};
  
  for (const [key, def] of Object.entries(aggregateSchema)) {
    if (def.type === 'value' && def.valueObject) {
      // Value objects stored as JSON
      apiSchema[key] = { type: 'object' };
    } else {
      apiSchema[key] = def;
    }
  }
  
  return apiSchema;
}

// Helper to ensure aggregate consistency
async function ensureAggregateConsistency(context, contexts) {
  // Find if this resource maps to an aggregate
  for (const boundedContext of contexts.values()) {
    for (const [name, AggregateClass] of boundedContext.aggregates) {
      if (context.options.type === name.toLowerCase() + 's') {
        try {
          // Validate aggregate invariants
          const aggregate = new AggregateClass(context.id, context.data);
          aggregate.validate?.();
        } catch (error) {
          throw new BadRequestError(`Aggregate validation failed: ${error.message}`);
        }
      }
    }
  }
}

// Helper to validate aggregate rules
function validateAggregateRules(context, contexts) {
  // Check for direct updates to aggregate internals
  if (context.data && typeof context.data === 'object') {
    for (const key of Object.keys(context.data)) {
      if (key.startsWith('_')) {
        throw new BadRequestError(`Cannot directly modify internal aggregate property: ${key}`);
      }
    }
  }
}

// Helper to validate event data
function validateEventData(data, schema) {
  for (const [key, required] of Object.entries(schema)) {
    if (required && !data.hasOwnProperty(key)) {
      throw new Error(`Domain event missing required field: ${key}`);
    }
  }
}