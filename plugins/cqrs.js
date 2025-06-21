import { EventEmitter } from 'events';
import { BadRequestError, InternalError } from '../lib/errors.js';

/**
 * CQRSPlugin - Implements Command Query Responsibility Segregation
 * 
 * Separates reads and writes into different models, databases, or even services.
 * This is typically overkill for most applications, but can be useful for:
 * - Systems with very different read/write patterns
 * - Applications needing different scaling for reads vs writes
 * - Complex event sourcing requirements
 * 
 * @example
 * // Basic CQRS with separate handlers
 * api.use(CQRSPlugin);
 * 
 * // Define commands (writes)
 * api.command('CreateUser', async (command) => {
 *   const user = await api.resources.users.create(command.data);
 *   return { userId: user.data.id };
 * });
 * 
 * // Define queries (reads)
 * api.query('GetUserById', async (query) => {
 *   const user = await api.resources.users.get(query.userId);
 *   return user;
 * });
 * 
 * // Use command/query bus
 * const result = await api.execute(new CreateUserCommand({ name: 'John' }));
 * const user = await api.execute(new GetUserByIdQuery(123));
 * 
 * @example
 * // Advanced: Separate read/write databases
 * api.use(CQRSPlugin, {
 *   eventStore: true,
 *   projections: true,
 *   readDatabase: {
 *     plugin: 'memory',  // Or 'mysql'
 *     options: { ... }
 *   },
 *   writeDatabase: {
 *     plugin: 'mysql',
 *     options: { ... }
 *   }
 * });
 */

// Base classes for commands and queries
export class Command {
  constructor(data = {}) {
    this.data = data;
    this.timestamp = Date.now();
    this.id = Math.random().toString(36).substr(2, 9);
  }
}

export class Query {
  constructor(criteria = {}) {
    this.criteria = criteria;
    this.timestamp = Date.now();
  }
}

export class Event {
  constructor(type, data, aggregateId) {
    this.type = type;
    this.data = data;
    this.aggregateId = aggregateId;
    this.timestamp = Date.now();
    this.id = Math.random().toString(36).substr(2, 9);
  }
}

// Command and Query handlers
class CommandBus {
  constructor() {
    this.handlers = new Map();
  }
  
  register(commandType, handler) {
    if (this.handlers.has(commandType)) {
      throw new Error(`Command handler already registered for ${commandType}`);
    }
    this.handlers.set(commandType, handler);
  }
  
  async execute(command) {
    const handler = this.handlers.get(command.constructor.name);
    if (!handler) {
      throw new BadRequestError(`No handler registered for command: ${command.constructor.name}`);
    }
    
    try {
      const result = await handler(command);
      return result;
    } catch (error) {
      throw new InternalError(`Command execution failed: ${error.message}`)
        .withContext({ command: command.constructor.name, error });
    }
  }
}

class QueryBus {
  constructor() {
    this.handlers = new Map();
  }
  
  register(queryType, handler) {
    if (this.handlers.has(queryType)) {
      throw new Error(`Query handler already registered for ${queryType}`);
    }
    this.handlers.set(queryType, handler);
  }
  
  async execute(query) {
    const handler = this.handlers.get(query.constructor.name);
    if (!handler) {
      throw new BadRequestError(`No handler registered for query: ${query.constructor.name}`);
    }
    
    try {
      const result = await handler(query);
      return result;
    } catch (error) {
      throw new InternalError(`Query execution failed: ${error.message}`)
        .withContext({ query: query.constructor.name, error });
    }
  }
}

// Event Store for event sourcing
class EventStore {
  constructor() {
    this.events = [];
    this.snapshots = new Map();
  }
  
  async append(event) {
    this.events.push(event);
    return event;
  }
  
  async getEvents(aggregateId, fromVersion = 0) {
    return this.events
      .filter(e => e.aggregateId === aggregateId)
      .slice(fromVersion);
  }
  
  async saveSnapshot(aggregateId, state, version) {
    this.snapshots.set(aggregateId, { state, version, timestamp: Date.now() });
  }
  
  async getSnapshot(aggregateId) {
    return this.snapshots.get(aggregateId);
  }
  
  async getAllEvents(fromTimestamp = 0) {
    return this.events.filter(e => e.timestamp >= fromTimestamp);
  }
}

// Projection for building read models
class ProjectionManager {
  constructor() {
    this.projections = new Map();
    this.positions = new Map();
  }
  
  register(name, projection) {
    this.projections.set(name, projection);
    this.positions.set(name, 0);
  }
  
  async processEvent(event) {
    for (const [name, projection] of this.projections) {
      if (projection.handles && projection.handles.includes(event.type)) {
        try {
          await projection.handle(event);
          this.positions.set(name, event.timestamp);
        } catch (error) {
          console.error(`Projection ${name} failed to handle event:`, error);
        }
      }
    }
  }
  
  async rebuild(name, eventStore) {
    const projection = this.projections.get(name);
    if (!projection) {
      throw new Error(`Projection ${name} not found`);
    }
    
    // Reset projection
    if (projection.reset) {
      await projection.reset();
    }
    
    // Replay all events
    const events = await eventStore.getAllEvents();
    for (const event of events) {
      if (projection.handles.includes(event.type)) {
        await projection.handle(event);
      }
    }
    
    this.positions.set(name, Date.now());
  }
}

// Saga for orchestrating complex workflows
class SagaManager {
  constructor() {
    this.sagas = new Map();
    this.activeSagas = new Map();
  }
  
  register(sagaType, saga) {
    this.sagas.set(sagaType, saga);
  }
  
  async handle(event) {
    // Check if any saga should start with this event
    for (const [type, SagaClass] of this.sagas) {
      const saga = new SagaClass();
      if (saga.startsWith && saga.startsWith.includes(event.type)) {
        const id = Math.random().toString(36).substr(2, 9);
        this.activeSagas.set(id, saga);
        await saga.handle(event);
      }
    }
    
    // Handle event in active sagas
    for (const [id, saga] of this.activeSagas) {
      if (saga.handles && saga.handles.includes(event.type)) {
        await saga.handle(event);
        
        // Check if saga is complete
        if (saga.isComplete && saga.isComplete()) {
          this.activeSagas.delete(id);
        }
      }
    }
  }
}

export const CQRSPlugin = {
  name: 'CQRSPlugin',
  
  install(api, options = {}) {
    const {
      eventStore: enableEventStore = false,
      projections: enableProjections = false,
      sagas: enableSagas = false,
      readDatabase,
      writeDatabase,
      separateDatabases = false
    } = options;
    
    // Initialize components
    const commandBus = new CommandBus();
    const queryBus = new QueryBus();
    const eventStore = enableEventStore ? new EventStore() : null;
    const projectionManager = enableProjections ? new ProjectionManager() : null;
    const sagaManager = enableSagas ? new SagaManager() : null;
    const domainEvents = new EventEmitter();
    
    // Store references
    api._cqrs = {
      commandBus,
      queryBus,
      eventStore,
      projectionManager,
      sagaManager,
      domainEvents
    };
    
    // Separate read/write APIs if configured
    if (separateDatabases && readDatabase && writeDatabase) {
      // Create separate API instances for read and write
      const { createApi } = require('../index.js');
      
      // Write API
      api._writeApi = createApi();
      const WritePlugin = require(`../plugins/${writeDatabase.plugin}.js`);
      api._writeApi.use(WritePlugin, writeDatabase.options);
      
      // Read API  
      api._readApi = createApi();
      const ReadPlugin = require(`../plugins/${readDatabase.plugin}.js`);
      api._readApi.use(ReadPlugin, readDatabase.options);
      
      // Copy schemas to both
      api.hook('afterAddResource', async (context) => {
        const { type, schema } = context;
        api._writeApi.addResource(type, schema);
        api._readApi.addResource(type, schema);
      });
    }
    
    /**
     * Register a command handler
     */
    api.command = (commandType, handler) => {
      if (typeof commandType === 'string') {
        // Simple string-based registration
        commandBus.register(commandType, handler);
      } else if (typeof commandType === 'function') {
        // Class-based registration
        commandBus.register(commandType.name, handler);
      }
      return api;
    };
    
    /**
     * Register a query handler
     */
    api.query = (queryType, handler) => {
      if (typeof queryType === 'string') {
        queryBus.register(queryType, handler);
      } else if (typeof queryType === 'function') {
        queryBus.register(queryType.name, handler);
      }
      return api;
    };
    
    /**
     * Execute a command or query
     */
    api.execute = async (commandOrQuery) => {
      if (commandOrQuery instanceof Command) {
        return await commandBus.execute(commandOrQuery);
      } else if (commandOrQuery instanceof Query) {
        return await queryBus.execute(commandOrQuery);
      } else {
        throw new BadRequestError('Invalid command or query type');
      }
    };
    
    /**
     * Emit a domain event
     */
    api.emitDomainEvent = async (event) => {
      // Store in event store if enabled
      if (eventStore) {
        await eventStore.append(event);
      }
      
      // Process projections
      if (projectionManager) {
        await projectionManager.processEvent(event);
      }
      
      // Handle sagas
      if (sagaManager) {
        await sagaManager.handle(event);
      }
      
      // Emit for local handlers
      domainEvents.emit(event.type, event);
      domainEvents.emit('*', event);
    };
    
    /**
     * Subscribe to domain events
     */
    api.onDomainEvent = (eventType, handler) => {
      domainEvents.on(eventType, handler);
      return api;
    };
    
    /**
     * Register a projection
     */
    api.projection = (name, projection) => {
      if (!projectionManager) {
        throw new Error('Projections not enabled. Set projections: true in plugin options');
      }
      projectionManager.register(name, projection);
      return api;
    };
    
    /**
     * Register a saga
     */
    api.saga = (sagaType, SagaClass) => {
      if (!sagaManager) {
        throw new Error('Sagas not enabled. Set sagas: true in plugin options');
      }
      sagaManager.register(sagaType, SagaClass);
      return api;
    };
    
    /**
     * Get event store (for advanced usage)
     */
    api.getEventStore = () => {
      if (!eventStore) {
        throw new Error('Event store not enabled. Set eventStore: true in plugin options');
      }
      return eventStore;
    };
    
    // Auto-generate commands and queries for resources
    if (api.schemas) {
      api.hook('afterAddResource', (context) => {
        const { type } = context;
        
        // Commands (writes)
        api.command(`Create${capitalize(type)}`, async (command) => {
          const writeApi = api._writeApi || api;
          const result = await writeApi.resources[type].create(command.data);
          
          // Emit event
          const event = new Event(`${type}Created`, result.data, result.data.id);
          await api.emitDomainEvent(event);
          
          return result;
        });
        
        api.command(`Update${capitalize(type)}`, async (command) => {
          const { id, data } = command.data;
          const writeApi = api._writeApi || api;
          const result = await writeApi.resources[type].update(id, data);
          
          // Emit event
          const event = new Event(`${type}Updated`, { id, changes: data }, id);
          await api.emitDomainEvent(event);
          
          return result;
        });
        
        api.command(`Delete${capitalize(type)}`, async (command) => {
          const { id } = command.data;
          const writeApi = api._writeApi || api;
          await writeApi.resources[type].delete(id);
          
          // Emit event
          const event = new Event(`${type}Deleted`, { id }, id);
          await api.emitDomainEvent(event);
          
          return { success: true };
        });
        
        // Queries (reads)
        api.query(`Get${capitalize(type)}ById`, async (query) => {
          const readApi = api._readApi || api;
          return await readApi.resources[type].get(query.criteria.id);
        });
        
        api.query(`List${capitalize(type)}`, async (query) => {
          const readApi = api._readApi || api;
          return await readApi.resources[type].query(query.criteria);
        });
      });
    }
    
    // Example: Auto-sync projections between write and read databases
    if (separateDatabases && projectionManager) {
      api.onDomainEvent('*', async (event) => {
        // Simple sync: copy from write to read
        const match = event.type.match(/^(\w+)(Created|Updated|Deleted)$/);
        if (match) {
          const [, resourceType, action] = match;
          const type = resourceType.toLowerCase();
          
          switch (action) {
            case 'Created':
            case 'Updated':
              // Fetch from write DB and update read DB
              const record = await api._writeApi.resources[type].get(event.aggregateId);
              if (record.data) {
                // Update or create in read DB
                try {
                  await api._readApi.resources[type].update(
                    event.aggregateId, 
                    record.data.attributes
                  );
                } catch (e) {
                  // If doesn't exist, create it
                  await api._readApi.resources[type].create({
                    ...record.data.attributes,
                    id: event.aggregateId
                  });
                }
              }
              break;
              
            case 'Deleted':
              // Delete from read DB
              await api._readApi.resources[type].delete(event.aggregateId);
              break;
          }
        }
      });
    }
  }
};

// Helper function
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}