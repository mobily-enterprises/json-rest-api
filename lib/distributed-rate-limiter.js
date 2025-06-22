import Redis from 'ioredis';

export class DistributedRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
    this.max = options.max || 100; // 100 requests per window default
    this.keyPrefix = options.keyPrefix || 'ratelimit:';
    this.redis = null;
    this.fallbackStore = new Map(); // In-memory fallback
    this.redisAvailable = false;
    
    // Try to connect to Redis if config provided
    if (options.redis) {
      this.initRedis(options.redis);
    }
  }
  
  async initRedis(redisConfig) {
    try {
      if (typeof redisConfig === 'object' && redisConfig.client) {
        // Use existing Redis client
        this.redis = redisConfig.client;
      } else {
        // Create new Redis client
        const config = typeof redisConfig === 'string' 
          ? { host: redisConfig } 
          : redisConfig;
          
        this.redis = new Redis({
          host: config.host || 'localhost',
          port: config.port || 6379,
          password: config.password,
          db: config.db || 0,
          retryStrategy: (times) => {
            if (times > 3) {
              // Stop retrying after 3 attempts
              this.redisAvailable = false;
              console.warn('Redis connection failed, falling back to in-memory rate limiting');
              return null;
            }
            return Math.min(times * 100, 3000);
          },
          enableOfflineQueue: false,
          lazyConnect: true
        });
        
        await this.redis.connect();
      }
      
      this.redisAvailable = true;
      
      // Handle Redis errors gracefully
      this.redis.on('error', (err) => {
        console.error('Redis error:', err.message);
        this.redisAvailable = false;
      });
      
      this.redis.on('connect', () => {
        this.redisAvailable = true;
      });
      
      this.redis.on('close', () => {
        this.redisAvailable = false;
      });
    } catch (error) {
      console.warn('Failed to initialize Redis for rate limiting:', error.message);
      this.redisAvailable = false;
    }
  }
  
  async checkLimit(key) {
    const fullKey = this.keyPrefix + key;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (this.redisAvailable && this.redis) {
      try {
        // Use Redis sorted sets for sliding window
        const multi = this.redis.multi();
        
        // Remove old entries
        multi.zremrangebyscore(fullKey, 0, windowStart);
        
        // Add current request
        multi.zadd(fullKey, now, `${now}-${Math.random()}`);
        
        // Count requests in window
        multi.zcount(fullKey, windowStart, now);
        
        // Set expiry
        multi.expire(fullKey, Math.ceil(this.windowMs / 1000));
        
        const results = await multi.exec();
        
        if (results && results[2]) {
          const count = results[2][1];
          
          return {
            allowed: count <= this.max,
            count: count,
            remaining: Math.max(0, this.max - count),
            resetAt: new Date(now + this.windowMs),
            retryAfter: count > this.max ? Math.ceil(this.windowMs / 1000) : null
          };
        }
      } catch (error) {
        console.error('Redis rate limit error:', error);
        // Fall through to in-memory implementation
      }
    }
    
    // Fallback to in-memory rate limiting
    return this.checkLimitInMemory(key);
  }
  
  checkLimitInMemory(key) {
    const fullKey = this.keyPrefix + key;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Clean old entries periodically
    if (Math.random() < 0.01) { // 1% chance to clean
      this.cleanupMemoryStore();
    }
    
    // Get or create request array
    const requests = this.fallbackStore.get(fullKey) || [];
    
    // Filter out old requests
    const recentRequests = requests.filter(time => time > windowStart);
    
    // Add current request
    recentRequests.push(now);
    
    // Update store
    this.fallbackStore.set(fullKey, recentRequests);
    
    const count = recentRequests.length;
    
    return {
      allowed: count <= this.max,
      count: count,
      remaining: Math.max(0, this.max - count),
      resetAt: new Date(now + this.windowMs),
      retryAfter: count > this.max ? Math.ceil(this.windowMs / 1000) : null
    };
  }
  
  cleanupMemoryStore() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    for (const [key, requests] of this.fallbackStore.entries()) {
      const recentRequests = requests.filter(time => time > windowStart);
      
      if (recentRequests.length === 0) {
        this.fallbackStore.delete(key);
      } else if (recentRequests.length < requests.length) {
        this.fallbackStore.set(key, recentRequests);
      }
    }
  }
  
  async reset(key) {
    const fullKey = this.keyPrefix + key;
    
    if (this.redisAvailable && this.redis) {
      try {
        await this.redis.del(fullKey);
      } catch (error) {
        console.error('Redis reset error:', error);
      }
    }
    
    // Also clear from memory store
    this.fallbackStore.delete(fullKey);
  }
  
  async close() {
    if (this.redis && this.redis.status === 'ready') {
      await this.redis.quit();
    }
  }
}

// Export a factory function for convenience
export function createRateLimiter(options) {
  return new DistributedRateLimiter(options);
}