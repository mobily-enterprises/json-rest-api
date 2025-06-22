import crypto from 'crypto';

export const CachePlugin = {
  install(api, options = {}) {
    const {
      store = 'memory',
      ttl = 300,
      maxItems = 1000,
      maxMemory = 100 * 1024 * 1024, // 100MB
      redis = null,
      keyPrefix = 'api:cache:',
      enableQueryCache = true,
      enableGetCache = true,
      enableRelationshipCache = true,
      invalidateOnMutation = true,
      permissionAware = true,
      debugMode = false,
      warmupQueries = [],
      compressionThreshold = 1024
    } = options;

    let cacheStore;
    const cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };

    // Initialize cache store
    if (store === 'redis' && redis) {
      cacheStore = createRedisStore(redis, keyPrefix, ttl);
    } else {
      cacheStore = createMemoryStore(maxItems, maxMemory, ttl);
    }

    // Permission-aware cache key generation
    function generateCacheKey(context, prefix = '') {
      const keyData = {
        resource: context.options.type,
        method: context.method || 'query',
        id: context.id,
        query: normalizeQuery(context.query),
        filters: context.filters,
        sort: context.sort,
        include: context.include,
        fields: context.fields,
        page: context.page,
        limit: context.limit
      };

      if (permissionAware && context.user) {
        keyData.userId = context.user.id;
        keyData.roles = context.user.roles?.sort();
        keyData.permissions = hashPermissions(context.user.permissions);
      }

      const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(keyData))
        .digest('hex')
        .substring(0, 16);

      return `${prefix}:${context.options.type}:${hash}`;
    }

    // Generate cache signature for result validation
    function generateResultSignature(result, schema) {
      const sig = {
        count: Array.isArray(result) ? result.length : 1,
        fields: schema ? Object.keys(schema.fields).sort() : [],
        timestamp: Math.floor(Date.now() / 60000) // 1 minute precision
      };

      return crypto
        .createHash('md5')
        .update(JSON.stringify(sig))
        .digest('hex')
        .substring(0, 8);
    }

    // Check if query is cacheable
    function isCacheable(context) {
      // Skip if explicitly disabled
      if (context.options.cache === false) return false;

      // Skip if user has dynamic permissions
      if (context.user?.permissions?.dynamic) return false;

      // Skip if query has time-based filters
      const timeFields = ['now', 'today', 'yesterday', 'current'];
      if (context.filters && Object.keys(context.filters).some(k => 
        timeFields.some(tf => k.includes(tf))
      )) return false;

      // Skip if resource has volatile virtual fields
      const schema = api.schemas[context.options.type];
      if (schema && schema.hasVolatileVirtuals) return false;

      return true;
    }

    // Compress large cache values
    function compress(data) {
      if (JSON.stringify(data).length < compressionThreshold) return data;
      // In real implementation, would use zlib
      return { compressed: true, data };
    }

    function decompress(data) {
      if (data?.compressed) return data.data;
      return data;
    }

    // Cache warming
    async function warmCache() {
      for (const query of warmupQueries) {
        try {
          const context = {
            options: { type: query.resource },
            query: query.query || {},
            filters: query.filters,
            include: query.include
          };
          
          // Trigger the query to warm cache
          await api.query(query.resource, context.query);
        } catch (err) {
          if (debugMode) {
            console.error(`Cache warmup failed for ${query.resource}:`, err);
          }
        }
      }
    }

    // GET caching
    if (enableGetCache) {
      api.hook('beforeGet', async (context) => {
        if (!isCacheable(context)) return;

        const key = generateCacheKey(context, 'get');
        try {
          const cached = await cacheStore.get(key);
          if (cached) {
            const data = decompress(cached.data);
            
            // Validate cache entry
            if (cached.signature === generateResultSignature(data, api.schemas[context.options.type])) {
              context.result = data;
              context.skip = true;
              context.cached = true;
              cacheStats.hits++;
              
              if (debugMode) {
                console.log(`Cache HIT: ${key}`);
              }
            } else {
              // Signature mismatch, invalidate
              await cacheStore.del(key);
              cacheStats.misses++;
            }
          } else {
            cacheStats.misses++;
          }
        } catch (err) {
          cacheStats.errors++;
          if (debugMode) {
            console.error('Cache error:', err);
          }
        }
      }, { priority: 5 }); // Early in the chain

      api.hook('afterGet', async (context) => {
        if (!isCacheable(context) || context.cached || context.error) return;

        const key = generateCacheKey(context, 'get');
        const schema = api.schemas[context.options.type];
        
        try {
          await cacheStore.set(key, {
            data: compress(context.result),
            signature: generateResultSignature(context.result, schema),
            permissions: context.user?.permissions,
            timestamp: Date.now()
          });
          cacheStats.sets++;
        } catch (err) {
          cacheStats.errors++;
        }
      }, { priority: 95 }); // Late in the chain
    }

    // Query caching
    if (enableQueryCache) {
      api.hook('beforeQuery', async (context) => {
        if (!isCacheable(context)) return;

        const key = generateCacheKey(context, 'query');
        try {
          const cached = await cacheStore.get(key);
          if (cached) {
            const data = decompress(cached.data);
            
            // For queries, also check result count hasn't changed drastically
            const currentSig = generateResultSignature(data, api.schemas[context.options.type]);
            if (cached.signature === currentSig) {
              context.result = data;
              context.skip = true;
              context.cached = true;
              cacheStats.hits++;
              
              // Copy over pagination metadata
              if (cached.meta) {
                context.meta = cached.meta;
              }
            } else {
              await cacheStore.del(key);
              cacheStats.misses++;
            }
          } else {
            cacheStats.misses++;
          }
        } catch (err) {
          cacheStats.errors++;
        }
      }, { priority: 5 });

      api.hook('afterQuery', async (context) => {
        if (!isCacheable(context) || context.cached || context.error) return;

        const key = generateCacheKey(context, 'query');
        const schema = api.schemas[context.options.type];
        
        try {
          await cacheStore.set(key, {
            data: compress(context.result),
            signature: generateResultSignature(context.result, schema),
            meta: context.meta, // Pagination info
            permissions: context.user?.permissions,
            timestamp: Date.now()
          });
          cacheStats.sets++;
        } catch (err) {
          cacheStats.errors++;
        }
      }, { priority: 95 });
    }

    // Relationship caching
    if (enableRelationshipCache) {
      api.hook('beforeLoadRelationships', async (context) => {
        if (!isCacheable(context)) return;

        const key = `rel:${context.options.type}:${context.id}:${context.relationships.join(',')}`;
        try {
          const cached = await cacheStore.get(key);
          if (cached) {
            context.relationshipData = decompress(cached.data);
            context.skip = true;
            cacheStats.hits++;
          } else {
            cacheStats.misses++;
          }
        } catch (err) {
          cacheStats.errors++;
        }
      });

      api.hook('afterLoadRelationships', async (context) => {
        if (!isCacheable(context) || context.error) return;

        const key = `rel:${context.options.type}:${context.id}:${context.relationships.join(',')}`;
        try {
          await cacheStore.set(key, {
            data: compress(context.relationshipData),
            timestamp: Date.now()
          });
          cacheStats.sets++;
        } catch (err) {
          cacheStats.errors++;
        }
      });
    }

    // Intelligent invalidation
    if (invalidateOnMutation) {
      const invalidationRules = new Map();

      // Register invalidation rules
      api.cache = {
        ...api.cache,
        addInvalidationRule(resource, rule) {
          if (!invalidationRules.has(resource)) {
            invalidationRules.set(resource, []);
          }
          invalidationRules.get(resource).push(rule);
        }
      };

      // Invalidate on mutations
      ['afterInsert', 'afterUpdate', 'afterDelete'].forEach(hook => {
        api.hook(hook, async (context) => {
          const { type } = context.options;
          
          // Basic invalidation - clear all caches for this resource
          await cacheStore.del(`get:${type}:*`);
          await cacheStore.del(`query:${type}:*`);
          await cacheStore.del(`rel:${type}:*`);
          
          // Apply custom invalidation rules
          const rules = invalidationRules.get(type) || [];
          for (const rule of rules) {
            if (typeof rule === 'function') {
              const patterns = await rule(context);
              for (const pattern of patterns) {
                await cacheStore.del(pattern);
              }
            }
          }

          // Invalidate related resources
          const schema = api.schemas[type];
          if (schema?.fields) {
            for (const [field, def] of Object.entries(schema.fields)) {
              if (def.refs?.resource) {
                // This resource references another, invalidate queries on that resource
                await cacheStore.del(`query:${def.refs.resource}:*`);
              }
            }
          }

          cacheStats.deletes++;
        }, { priority: 100 }); // Run last
      });

      // Invalidate on permission changes
      api.hook('afterPermissionChange', async (context) => {
        if (context.userId) {
          // User-specific permission change
          await cacheStore.del(`*:user:${context.userId}:*`);
        } else if (context.role) {
          // Role-based permission change - need to clear more
          await cacheStore.del(`*:role:${context.role}:*`);
        } else {
          // Global permission change - clear everything
          await cacheStore.flush();
        }
      });
    }

    // Public API
    api.cache = {
      get: (key) => cacheStore.get(key),
      set: (key, value, ttl) => cacheStore.set(key, value, ttl),
      del: (pattern) => cacheStore.del(pattern),
      flush: () => cacheStore.flush(),
      stats: () => ({ ...cacheStats }),
      warm: warmCache,
      
      // Manually invalidate specific queries
      invalidate: async (resource, id) => {
        if (id) {
          await cacheStore.del(`get:${resource}:*${id}*`);
          await cacheStore.del(`rel:${resource}:${id}:*`);
        } else {
          await cacheStore.del(`get:${resource}:*`);
          await cacheStore.del(`query:${resource}:*`);
          await cacheStore.del(`rel:${resource}:*`);
        }
        cacheStats.deletes++;
      },

      // Get cache info for debugging
      inspect: async (resource, id) => {
        const keys = await cacheStore.keys(`*:${resource}:*`);
        const entries = [];
        
        for (const key of keys) {
          const value = await cacheStore.get(key);
          if (value) {
            entries.push({
              key,
              size: JSON.stringify(value).length,
              timestamp: value.timestamp,
              signature: value.signature
            });
          }
        }
        
        return entries;
      }
    };

    // Warm cache on startup if configured
    if (warmupQueries.length > 0) {
      api.hook('afterStart', warmCache);
    }

    // Periodic stats logging
    if (debugMode) {
      setInterval(() => {
        const stats = api.cache.stats();
        const hitRate = stats.hits / (stats.hits + stats.misses) || 0;
        console.log(`Cache stats: ${stats.hits} hits, ${stats.misses} misses (${(hitRate * 100).toFixed(1)}% hit rate), ${stats.errors} errors`);
      }, 60000); // Every minute
    }
  }
};

// Memory store implementation
function createMemoryStore(maxItems, maxMemory, defaultTTL) {
  const cache = new Map();
  const timers = new Map();
  let currentMemory = 0;

  function estimateSize(obj) {
    return JSON.stringify(obj).length * 2; // Rough estimate (2 bytes per char)
  }

  function evictOldest() {
    if (cache.size === 0) return;
    
    const oldest = [...cache.entries()].sort((a, b) => 
      (a[1].lastAccessed || 0) - (b[1].lastAccessed || 0)
    )[0];
    
    if (oldest) {
      const [key, value] = oldest;
      currentMemory -= estimateSize(value);
      cache.delete(key);
      
      const timer = timers.get(key);
      if (timer) {
        clearTimeout(timer);
        timers.delete(key);
      }
    }
  }

  return {
    async get(key) {
      const value = cache.get(key);
      if (value) {
        value.lastAccessed = Date.now();
      }
      return value;
    },

    async set(key, value, ttl) {
      const size = estimateSize(value);
      
      // Evict items if necessary
      while (cache.size >= maxItems || currentMemory + size > maxMemory) {
        evictOldest();
      }

      // Clear existing timer
      const existingTimer = timers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new value
      cache.set(key, value);
      currentMemory += size;

      // Set expiration
      const timeout = (ttl || defaultTTL) * 1000;
      const timer = setTimeout(() => {
        currentMemory -= estimateSize(cache.get(key));
        cache.delete(key);
        timers.delete(key);
      }, timeout);
      timers.set(key, timer);
    },

    async del(pattern) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      const keysToDelete = [];
      
      for (const key of cache.keys()) {
        if (regex.test(key)) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        currentMemory -= estimateSize(cache.get(key));
        cache.delete(key);
        
        const timer = timers.get(key);
        if (timer) {
          clearTimeout(timer);
          timers.delete(key);
        }
      }
    },

    async flush() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      cache.clear();
      timers.clear();
      currentMemory = 0;
    },

    async keys(pattern) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return [...cache.keys()].filter(key => regex.test(key));
    }
  };
}

// Redis store implementation
function createRedisStore(redis, keyPrefix, defaultTTL) {
  return {
    async get(key) {
      const value = await redis.get(keyPrefix + key);
      return value ? JSON.parse(value) : null;
    },

    async set(key, value, ttl) {
      await redis.setex(
        keyPrefix + key,
        ttl || defaultTTL,
        JSON.stringify(value)
      );
    },

    async del(pattern) {
      const keys = await redis.keys(keyPrefix + pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    },

    async flush() {
      const keys = await redis.keys(keyPrefix + '*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    },

    async keys(pattern) {
      const keys = await redis.keys(keyPrefix + pattern);
      return keys.map(k => k.substring(keyPrefix.length));
    }
  };
}

// Helper functions
function normalizeQuery(query) {
  if (!query) return {};
  
  // Sort query keys for consistent hashing
  const normalized = {};
  Object.keys(query).sort().forEach(key => {
    normalized[key] = query[key];
  });
  return normalized;
}

function hashPermissions(permissions) {
  if (!permissions) return null;
  
  // Create a stable hash of permissions
  const sorted = JSON.stringify(permissions, Object.keys(permissions).sort());
  return crypto
    .createHash('md5')
    .update(sorted)
    .digest('hex')
    .substring(0, 8);
}