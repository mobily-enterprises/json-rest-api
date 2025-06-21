import 'reflect-metadata';

const RESOURCE_METADATA = Symbol('resource');
const HOOKS_METADATA = Symbol('hooks');
const VALIDATE_METADATA = Symbol('validate');
const TRANSFORM_METADATA = Symbol('transform');
const PERMISSION_METADATA = Symbol('permission');

export function Resource(name, schema) {
  return function (target) {
    Reflect.defineMetadata(RESOURCE_METADATA, { name, schema }, target);
    return target;
  };
}

export function Hook(hookName, priority = 100) {
  return function (target, propertyKey, descriptor) {
    const hooks = Reflect.getMetadata(HOOKS_METADATA, target) || {};
    if (!hooks[hookName]) hooks[hookName] = [];
    
    hooks[hookName].push({
      method: propertyKey,
      priority,
      handler: descriptor.value
    });
    
    Reflect.defineMetadata(HOOKS_METADATA, hooks, target);
    return descriptor;
  };
}

export function BeforeInsert(priority) {
  return Hook('beforeInsert', priority);
}

export function AfterInsert(priority) {
  return Hook('afterInsert', priority);
}

export function BeforeUpdate(priority) {
  return Hook('beforeUpdate', priority);
}

export function AfterUpdate(priority) {
  return Hook('afterUpdate', priority);
}

export function BeforeDelete(priority) {
  return Hook('beforeDelete', priority);
}

export function AfterDelete(priority) {
  return Hook('afterDelete', priority);
}

export function BeforeQuery(priority) {
  return Hook('beforeQuery', priority);
}

export function AfterQuery(priority) {
  return Hook('afterQuery', priority);
}

export function Validate(field, validator) {
  return function (target, propertyKey, descriptor) {
    const validators = Reflect.getMetadata(VALIDATE_METADATA, target) || {};
    if (!validators[field]) validators[field] = [];
    
    validators[field].push({
      method: propertyKey,
      validator: descriptor.value || validator
    });
    
    Reflect.defineMetadata(VALIDATE_METADATA, validators, target);
    return descriptor;
  };
}

export function Transform(field, phase = 'input') {
  return function (target, propertyKey, descriptor) {
    const transforms = Reflect.getMetadata(TRANSFORM_METADATA, target) || {};
    if (!transforms[field]) transforms[field] = {};
    
    transforms[field][phase] = {
      method: propertyKey,
      handler: descriptor.value
    };
    
    Reflect.defineMetadata(TRANSFORM_METADATA, transforms, target);
    return descriptor;
  };
}

export function Permission(operation, roles) {
  return function (target, propertyKey, descriptor) {
    const permissions = Reflect.getMetadata(PERMISSION_METADATA, target) || {};
    
    permissions[operation] = {
      method: propertyKey,
      roles: Array.isArray(roles) ? roles : [roles],
      handler: descriptor.value
    };
    
    Reflect.defineMetadata(PERMISSION_METADATA, permissions, target);
    return descriptor;
  };
}

export function Queue(queueName, jobName) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args) {
      const api = this.api || this._api;
      if (!api || !api.queue) {
        throw new Error('Queue plugin not installed');
      }
      
      const queue = api.queue.get(queueName) || api.queue.create(queueName);
      const job = await queue.add(jobName || propertyKey, { 
        method: propertyKey,
        args 
      });
      
      return job;
    };
    
    return descriptor;
  };
}

export function Scheduled(cron, options = {}) {
  return function (target, propertyKey, descriptor) {
    const scheduled = Reflect.getMetadata('scheduled', target) || [];
    
    scheduled.push({
      method: propertyKey,
      cron,
      options,
      handler: descriptor.value
    });
    
    Reflect.defineMetadata('scheduled', scheduled, target);
    return descriptor;
  };
}

export function Transaction() {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args) {
      const api = this.api || this._api;
      if (!api) {
        throw new Error('API instance not available');
      }
      
      return api.transaction(() => originalMethod.apply(this, args));
    };
    
    return descriptor;
  };
}

export function Cache(ttl = 300000) {
  return function (target, propertyKey, descriptor) {
    const cache = new Map();
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args) {
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      
      if (cached && Date.now() - cached.time < ttl) {
        return cached.value;
      }
      
      const result = await originalMethod.apply(this, args);
      cache.set(key, { value: result, time: Date.now() });
      
      return result;
    };
    
    return descriptor;
  };
}

export function Retry(attempts = 3, delay = 1000) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args) {
      let lastError;
      
      for (let i = 0; i < attempts; i++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error;
          if (i < attempts - 1) {
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
          }
        }
      }
      
      throw lastError;
    };
    
    return descriptor;
  };
}

export function RateLimit(maxCalls = 10, windowMs = 60000) {
  return function (target, propertyKey, descriptor) {
    const calls = new Map();
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args) {
      const now = Date.now();
      const userId = this.user?.id || 'anonymous';
      const userCalls = calls.get(userId) || [];
      
      const recentCalls = userCalls.filter(time => now - time < windowMs);
      
      if (recentCalls.length >= maxCalls) {
        throw new Error('Rate limit exceeded');
      }
      
      recentCalls.push(now);
      calls.set(userId, recentCalls);
      
      return originalMethod.apply(this, args);
    };
    
    return descriptor;
  };
}

export class ResourceController {
  constructor(api) {
    this.api = api;
    this._registerResource();
    this._registerHooks();
    this._registerValidators();
    this._registerTransforms();
    this._registerScheduledJobs();
  }

  _registerResource() {
    const metadata = Reflect.getMetadata(RESOURCE_METADATA, this.constructor);
    if (!metadata) return;
    
    const { name, schema } = metadata;
    this.resourceName = name;
    this.resource = this.api.addResource(name, schema);
  }

  _registerHooks() {
    const hooks = Reflect.getMetadata(HOOKS_METADATA, this.constructor.prototype) || {};
    
    for (const [hookName, handlers] of Object.entries(hooks)) {
      handlers.sort((a, b) => a.priority - b.priority);
      
      for (const { handler } of handlers) {
        this.api.hook(hookName, handler.bind(this));
      }
    }
  }

  _registerValidators() {
    const validators = Reflect.getMetadata(VALIDATE_METADATA, this.constructor.prototype) || {};
    
    for (const [field, handlers] of Object.entries(validators)) {
      for (const { validator } of handlers) {
        this.api.hook('beforeInsert', async (context) => {
          if (context.resource === this.resourceName && context.data[field] !== undefined) {
            await validator.call(this, context.data[field], context);
          }
        });
        
        this.api.hook('beforeUpdate', async (context) => {
          if (context.resource === this.resourceName && context.data[field] !== undefined) {
            await validator.call(this, context.data[field], context);
          }
        });
      }
    }
  }

  _registerTransforms() {
    const transforms = Reflect.getMetadata(TRANSFORM_METADATA, this.constructor.prototype) || {};
    
    for (const [field, phases] of Object.entries(transforms)) {
      if (phases.input) {
        this.api.hook('beforeInsert', async (context) => {
          if (context.resource === this.resourceName && context.data[field] !== undefined) {
            context.data[field] = await phases.input.handler.call(this, context.data[field], context);
          }
        });
        
        this.api.hook('beforeUpdate', async (context) => {
          if (context.resource === this.resourceName && context.data[field] !== undefined) {
            context.data[field] = await phases.input.handler.call(this, context.data[field], context);
          }
        });
      }
      
      if (phases.output) {
        this.api.hook('afterGet', async (context) => {
          if (context.resource === this.resourceName && context.result && context.result[field] !== undefined) {
            context.result[field] = await phases.output.handler.call(this, context.result[field], context);
          }
        });
        
        this.api.hook('afterQuery', async (context) => {
          if (context.resource === this.resourceName && context.result?.data) {
            for (const item of context.result.data) {
              if (item[field] !== undefined) {
                item[field] = await phases.output.handler.call(this, item[field], context);
              }
            }
          }
        });
      }
    }
  }

  _registerScheduledJobs() {
    if (!this.api.scheduler) return;
    
    const scheduled = Reflect.getMetadata('scheduled', this.constructor.prototype) || [];
    
    for (const { method, cron, options, handler } of scheduled) {
      this.api.scheduler.schedule(
        `${this.resourceName}.${method}`,
        cron,
        handler.bind(this),
        options
      );
    }
  }
}

export function createResourceFromClass(ResourceClass, api) {
  return new ResourceClass(api);
}