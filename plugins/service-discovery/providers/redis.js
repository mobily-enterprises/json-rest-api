export class RedisProvider {
  constructor(redis, options = {}) {
    if (!redis) {
      throw new Error('Redis client is required for RedisProvider');
    }
    
    this.redis = redis;
    this.keyPrefix = options.keyPrefix || 'service:';
    this.ttl = options.ttl || 60; // seconds
    this.refreshInterval = options.refreshInterval || 30; // seconds
    this.refreshTimers = new Map();
  }

  async register(service) {
    const key = this.getServiceKey(service.name, service.id);
    const value = JSON.stringify({
      ...service,
      registeredAt: new Date(),
      lastHeartbeat: new Date()
    });

    // Set with TTL
    await this.redis.setex(key, this.ttl, value);

    // Also add to service set
    await this.redis.sadd(this.getServiceSetKey(service.name), service.id);

    // Start heartbeat
    this.startHeartbeat(service);

    return service;
  }

  async deregister(serviceId) {
    // Find service name from all sets
    const pattern = `${this.keyPrefix}set:*`;
    const sets = await this.redis.keys(pattern);
    
    for (const setKey of sets) {
      const members = await this.redis.smembers(setKey);
      if (members.includes(serviceId)) {
        const serviceName = setKey.replace(`${this.keyPrefix}set:`, '');
        
        // Remove from set
        await this.redis.srem(setKey, serviceId);
        
        // Delete service key
        const key = this.getServiceKey(serviceName, serviceId);
        await this.redis.del(key);
        
        // Stop heartbeat
        this.stopHeartbeat(serviceId);
        
        break;
      }
    }
  }

  async discover(serviceName, options = {}) {
    const setKey = this.getServiceSetKey(serviceName);
    const serviceIds = await this.redis.smembers(setKey);
    
    if (serviceIds.length === 0) {
      return [];
    }

    // Get all service details
    const services = [];
    const pipeline = this.redis.pipeline();
    
    for (const id of serviceIds) {
      const key = this.getServiceKey(serviceName, id);
      pipeline.get(key);
    }
    
    const results = await pipeline.exec();
    
    for (let i = 0; i < results.length; i++) {
      const [err, data] = results[i];
      if (!err && data) {
        try {
          const service = JSON.parse(data);
          
          // Check if service is still alive
          const lastHeartbeat = new Date(service.lastHeartbeat);
          const now = new Date();
          const timeSinceHeartbeat = (now - lastHeartbeat) / 1000;
          
          if (timeSinceHeartbeat < this.ttl * 2) {
            services.push(service);
          } else {
            // Clean up stale service
            await this.redis.srem(setKey, serviceIds[i]);
            await this.redis.del(this.getServiceKey(serviceName, serviceIds[i]));
          }
        } catch (parseError) {
          // Invalid data, skip
        }
      }
    }
    
    return services;
  }

  async checkHealth(service) {
    const key = this.getServiceKey(service.name, service.id);
    const data = await this.redis.get(key);
    
    if (!data) {
      return { status: 'unhealthy', reason: 'Service not found' };
    }
    
    try {
      const serviceData = JSON.parse(data);
      const lastHeartbeat = new Date(serviceData.lastHeartbeat);
      const now = new Date();
      const timeSinceHeartbeat = (now - lastHeartbeat) / 1000;
      
      if (timeSinceHeartbeat < this.ttl) {
        return { status: 'healthy', lastHeartbeat };
      } else if (timeSinceHeartbeat < this.ttl * 2) {
        return { status: 'degraded', lastHeartbeat };
      } else {
        return { status: 'unhealthy', lastHeartbeat };
      }
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  async updateHealth(serviceId, health) {
    // Find service
    const pattern = `${this.keyPrefix}*:${serviceId}`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length === 0) {
      throw new Error(`Service not found: ${serviceId}`);
    }
    
    const key = keys[0];
    const data = await this.redis.get(key);
    
    if (data) {
      const service = JSON.parse(data);
      service.health = health;
      service.lastHeartbeat = new Date();
      
      await this.redis.setex(key, this.ttl, JSON.stringify(service));
    }
  }

  startHeartbeat(service) {
    const timer = setInterval(async () => {
      try {
        const key = this.getServiceKey(service.name, service.id);
        const data = await this.redis.get(key);
        
        if (data) {
          const serviceData = JSON.parse(data);
          serviceData.lastHeartbeat = new Date();
          await this.redis.setex(key, this.ttl, JSON.stringify(serviceData));
        }
      } catch (error) {
        console.error('Heartbeat failed:', error);
      }
    }, this.refreshInterval * 1000);
    
    this.refreshTimers.set(service.id, timer);
  }

  stopHeartbeat(serviceId) {
    const timer = this.refreshTimers.get(serviceId);
    if (timer) {
      clearInterval(timer);
      this.refreshTimers.delete(serviceId);
    }
  }

  getServiceKey(serviceName, serviceId) {
    return `${this.keyPrefix}${serviceName}:${serviceId}`;
  }

  getServiceSetKey(serviceName) {
    return `${this.keyPrefix}set:${serviceName}`;
  }

  async cleanup() {
    // Stop all heartbeats
    for (const timer of this.refreshTimers.values()) {
      clearInterval(timer);
    }
    this.refreshTimers.clear();
  }
}