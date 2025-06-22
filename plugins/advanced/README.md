# Advanced Plugins

This directory contains advanced plugins that extend the JSON REST API with enterprise-grade features inspired by frameworks like NestJS. These plugins provide sophisticated capabilities beyond basic CRUD operations.

## Available Plugins

### 1. CachePlugin (`cache/`)
Permission-aware caching system with multi-tier support.

**Features:**
- Permission-aware cache keys (respects user roles and permissions)
- Multi-tier caching (memory → Redis)
- Automatic cache invalidation on mutations
- Query result caching with signatures
- Smart eviction strategies
- Cache warming support
- Compression for large values

**Usage:**
```javascript
api.use(CachePlugin, {
  store: 'memory', // or 'redis'
  ttl: 300, // 5 minutes
  maxItems: 1000,
  redis: redisClient, // if using Redis
  permissionAware: true,
  enableQueryCache: true,
  enableGetCache: true
});

// Manual cache operations
await api.cache.invalidate('users', userId);
const stats = api.cache.stats(); // Hit rates, misses, etc.
```

### 2. ConfigPlugin (`config/`)
Configuration management with validation, hot-reload, and multi-source support.

**Features:**
- Multiple configuration sources (env, files, args)
- Schema validation
- Hot-reload in development
- Secrets management integration
- Type-safe configuration access
- Change event notifications

**Usage:**
```javascript
api.use(ConfigPlugin, {
  sources: ['env', 'file', 'args'],
  envPrefix: 'API_',
  configFile: 'config.json',
  watch: true, // Hot-reload
  schemas: {
    port: { type: 'number', min: 1, max: 65535, required: true },
    host: { type: 'string', pattern: '^[a-zA-Z0-9.-]+$' }
  },
  required: ['port', 'host']
});

// Access configuration
const port = api.config.get('port');
api.config.watch('debug', (newVal, oldVal) => {
  console.log('Debug mode changed:', newVal);
});
```

### 3. VersioningPlugin (`versioning/`)
API versioning with multiple strategies and migration support.

**Features:**
- Multiple versioning strategies (header, path, query, accept)
- Version-specific schemas and resources
- Deprecation warnings
- Version migration and transformation
- Version discovery endpoints

**Usage:**
```javascript
api.use(VersioningPlugin, {
  type: 'header', // 'path', 'query', 'accept'
  header: 'x-api-version',
  defaultVersion: '1',
  deprecationWarnings: true
});

// Add versioned resources
api.addVersionedResource('users', {
  '1': { schema: userSchemaV1 },
  '2': { 
    schema: userSchemaV2,
    migrateFrom: '1',
    migration: (data) => ({ ...data, newField: 'default' })
  }
});

// Deprecate versions
api.deprecateVersion('1', {
  sunset: '2024-12-31',
  successor: '2'
});
```

### 4. ContextPlugin (`context/`)
AsyncLocalStorage-based context propagation for request tracking and debugging.

**Features:**
- Automatic request ID generation and propagation
- User context tracking
- Async-safe context storage
- Performance metrics collection
- Background task context
- Distributed tracing support

**Usage:**
```javascript
api.use(ContextPlugin, {
  enableRequestId: true,
  enableTracing: true,
  enableUserContext: true,
  requestIdHeader: 'x-request-id'
});

// Access context anywhere
const requestId = api.context.get('requestId');
api.context.set('customValue', 'data');

// Context-aware logging
api.log.info('Operation completed', { extra: 'data' });
// Automatically includes requestId, userId, duration

// Run with custom context
await api.runWithContext({ user: { id: '123' } }, async () => {
  // Code here has access to the context
});
```

### 5. InterceptorsPlugin (`interceptors/`)
Request/response transformation pipeline with middleware-like capabilities.

**Features:**
- Request interceptors (modify before processing)
- Response interceptors (transform after processing)
- Error interceptors (handle/transform errors)
- Timing interceptors (performance monitoring)
- Priority-based execution
- Common patterns (auth, rate limit, caching, validation)

**Usage:**
```javascript
api.use(InterceptorsPlugin);

// Add custom interceptor
api.interceptors.request.use({
  name: 'auth-check',
  priority: 10,
  async process(context) {
    if (!context.headers?.authorization) {
      throw new Error('Unauthorized');
    }
    return context;
  }
});

// Use common patterns
api.interceptors.request.use(
  api.interceptors.common.rateLimit({ max: 100, window: 60000 })
);

api.interceptors.response.use(
  api.interceptors.common.transform({
    response: (data) => ({ ...data, timestamp: Date.now() })
  })
);
```

### 6. TracingPlugin (`tracing/`)
Distributed tracing with OpenTelemetry compatibility (mock implementation).

**Features:**
- Automatic span creation for all operations
- HTTP request/response tracing
- Database operation tracing
- Custom span creation
- Trace context propagation
- Sampling and baggage support
- Metrics integration

**Usage:**
```javascript
api.use(TracingPlugin, {
  serviceName: 'my-api',
  samplingRate: 0.1, // Sample 10% of requests
  enableAutoInstrumentation: true,
  enableHttpTracing: true,
  enableDatabaseTracing: true
});

// Custom spans
await api.span('custom.operation', async (span) => {
  span.setAttribute('user.id', userId);
  span.addEvent('processing-started');
  
  const result = await doWork();
  
  span.addEvent('processing-completed', { items: result.length });
  return result;
});

// Manual span management
const span = api.startSpan('manual.operation');
try {
  // Do work
  span.setStatus({ code: 'OK' });
} catch (error) {
  span.recordException(error);
  span.setStatus({ code: 'ERROR' });
} finally {
  span.end();
}

// Access trace data
GET /api/tracing/export
GET /api/tracing/stats
```

## Installation

All advanced plugins are included in the JSON REST API package. Simply import and use them:

```javascript
import { Api } from '@json-rest-api/core';
import { 
  CachePlugin,
  ConfigPlugin,
  VersioningPlugin,
  ContextPlugin,
  InterceptorsPlugin,
  TracingPlugin
} from '@json-rest-api/core/plugins/advanced';

const api = new Api();

// Use plugins in recommended order
api.use(ConfigPlugin, configOptions);
api.use(ContextPlugin, contextOptions);
api.use(InterceptorsPlugin, interceptorOptions);
api.use(CachePlugin, cacheOptions);
api.use(VersioningPlugin, versioningOptions);
api.use(TracingPlugin, tracingOptions);
```

## Best Practices

1. **Plugin Order**: Load plugins in the recommended order to ensure proper interaction
2. **Configuration**: Use ConfigPlugin early to configure other plugins
3. **Context**: Enable ContextPlugin for better debugging and tracking
4. **Caching**: Be careful with permission-aware caching - test thoroughly
5. **Versioning**: Plan your API evolution strategy before implementing
6. **Tracing**: Use sampling in production to control overhead

## Performance Considerations

- **CachePlugin**: Redis backend recommended for production
- **ConfigPlugin**: File watching has overhead - disable in production
- **ContextPlugin**: AsyncLocalStorage has ~10% overhead
- **InterceptorsPlugin**: Keep interceptor logic lightweight
- **TracingPlugin**: Use sampling to reduce overhead (e.g., 0.1 for 10%)

## Security Notes

- **CachePlugin**: Automatically handles permission-based cache keys
- **ConfigPlugin**: Supports secrets management, masks sensitive values
- **VersioningPlugin**: Helps maintain backward compatibility
- **ContextPlugin**: Sanitizes user data in logs
- **InterceptorsPlugin**: Ideal for implementing auth/security checks
- **TracingPlugin**: Be careful not to log sensitive data in spans