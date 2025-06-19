# Design Decisions

This document explains the key architectural and design decisions in JSON REST API, including the rationale behind them and their implications.

## Table of Contents

1. [Plugin Architecture](#plugin-architecture)
2. [Hook System](#hook-system)
3. [Schema Design](#schema-design)
4. [Resource Proxy API](#resource-proxy-api)
5. [Error Handling](#error-handling)
6. [Query Building](#query-building)
7. [JSON:API Compliance](#jsonapi-compliance)
8. [Performance Decisions](#performance-decisions)

## Plugin Architecture

### Decision
Use a plugin-based architecture where all functionality is added through plugins.

### Rationale
- **Modularity**: Users only include what they need
- **Extensibility**: Easy to add new features without modifying core
- **Testability**: Plugins can be tested in isolation
- **Maintainability**: Clear separation of concerns

### Implementation
```javascript
const api = new Api();
api.use(Plugin, options);
```

### Trade-offs
- **Pros**: Flexible, clean, extensible
- **Cons**: Plugin order matters, potential conflicts
- **Mitigation**: Clear documentation on plugin ordering

### Alternatives Considered
1. **Monolithic class**: Too rigid, hard to extend
2. **Inheritance**: Deep hierarchies, fragile base class problem
3. **Mixins**: Complex, hard to debug

## Hook System

### Decision
Use an event-based hook system for extensibility.

### Rationale
- **Decoupling**: Features don't directly modify core logic
- **Composition**: Multiple features can enhance same operation
- **Debugging**: Clear interception points
- **Priority control**: Deterministic execution order

### Implementation
```javascript
api.hook('beforeInsert', handler, priority);
```

### Design Choices

#### Async-First
All hooks are async to avoid sync/async confusion:
```javascript
// Always async, even if synchronous
api.hook('beforeInsert', async (context) => {
  context.data.timestamp = Date.now();
});
```

#### Context Mutation
Hooks modify a context object rather than returning values:
```javascript
// Modifies context
api.hook('beforeInsert', async (context) => {
  context.data.slug = slugify(context.data.title);
});

// Not functional style
api.hook('beforeInsert', async (data) => {
  return { ...data, slug: slugify(data.title) };
});
```

**Why**: Allows multiple hooks to collaborate on same data.

#### Priority System
Numeric priorities (0-100) for execution order:
```javascript
api.hook('beforeInsert', validateHook, 10);   // Early
api.hook('beforeInsert', enrichHook, 50);     // Default
api.hook('beforeInsert', logHook, 90);        // Late
```

### Trade-offs
- **Pros**: Powerful, flexible, composable
- **Cons**: Can be hard to debug, execution order complexity
- **Mitigation**: Good logging, clear priority guidelines

## Schema Design

### Decision
TypeScript-like schema syntax with runtime validation.

### Rationale
- **Familiarity**: Developers know the syntax
- **Expressiveness**: Rich constraint system
- **Runtime safety**: Validates at runtime, not just compile time
- **Documentation**: Schema serves as API documentation

### Implementation
```javascript
const schema = new Schema({
  name: { type: 'string', required: true, min: 2, max: 100 },
  age: { type: 'number', min: 0, max: 150 }
});
```

### Design Choices

#### Declarative Over Imperative
```javascript
// Declarative (chosen)
{ type: 'string', min: 5, max: 100 }

// Imperative (rejected)
string().min(5).max(100)
```

**Why**: Easier to serialize, analyze, and extend.

#### Extensible Type System
```javascript
Schema.registerType('phone', {
  validate: (value) => { /* ... */ }
});
```

**Why**: Users can add domain-specific types.

#### Silent Fields
```javascript
password: { type: 'string', silent: true }
```

**Why**: Security by default - sensitive fields excluded from queries.

### Trade-offs
- **Pros**: Intuitive, powerful, safe
- **Cons**: Not actual TypeScript types
- **Mitigation**: Could generate TS types from schemas

## Resource Proxy API

### Decision
Provide intuitive proxy-based API for resource access.

### Rationale
- **Developer experience**: Natural, intuitive syntax
- **Type inference**: Better IDE support
- **Consistency**: Same pattern for all operations
- **Discoverability**: Resources visible in autocomplete

### Implementation
```javascript
// Instead of
api.get('123', { type: 'users' });

// We have
api.resources.users.get('123');
```

### Design Choices

#### Dynamic Proxy
Uses JavaScript Proxy for dynamic property access:
```javascript
get resources() {
  return new Proxy({}, {
    get: (target, prop) => this._resourceProxies.get(prop)
  });
}
```

**Why**: Resources are dynamic, registered at runtime.

#### Method Aliases
```javascript
proxy.create() // Alias for insert
proxy.post()   // Also alias for insert
```

**Why**: Support different naming preferences.

### Trade-offs
- **Pros**: Intuitive, discoverable, type-friendly
- **Cons**: Proxy overhead, not serializable
- **Mitigation**: Negligible performance impact

## Error Handling

### Decision
Structured error classes with rich context.

### Rationale
- **Debugging**: Errors carry context about what went wrong
- **Type safety**: Can use instanceof checks
- **Standards**: JSON:API compliant error format
- **i18n ready**: Error codes enable translation

### Implementation
```javascript
class ValidationError extends ApiError {
  constructor() {
    super(422, 'Validation Error', ErrorCodes.VALIDATION_FAILED);
    this.errors = [];
  }
  
  addFieldError(field, message, code) {
    this.errors.push({ field, message, code });
  }
}
```

### Design Choices

#### Error Codes
```javascript
const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  // ...
};
```

**Why**: Machine-readable, i18n-friendly.

#### Context Chain
```javascript
throw new NotFoundError('users', '123')
  .withContext({ 
    searchParams: params,
    timestamp: Date.now()
  });
```

**Why**: Preserves debugging information.

### Trade-offs
- **Pros**: Rich errors, good DX, standards compliant
- **Cons**: More complex than string errors
- **Mitigation**: Clear error creation patterns

## Query Building

### Decision
SQL query builder with schema awareness.

### Rationale
- **Safety**: Parameterized queries prevent injection
- **Flexibility**: Compose complex queries programmatically
- **Schema integration**: Automatic joins from refs
- **Readability**: Cleaner than string concatenation

### Implementation
```javascript
const query = new QueryBuilder('users')
  .where('active = ?', true)
  .leftJoin('posts', 'posts.userId = users.id')
  .orderBy('createdAt', 'DESC')
  .limit(10);
```

### Design Choices

#### Fluent Interface
```javascript
query.where().orderBy().limit()
```

**Why**: Readable, chainable, familiar pattern.

#### Schema-Aware Joins
```javascript
query.leftJoin('authorId'); // Uses schema refs
```

**Why**: Less repetition, single source of truth.

#### Safe by Default
```javascript
.where('name = ?', userInput) // Parameterized
```

**Why**: Security first, prevent SQL injection.

### Trade-offs
- **Pros**: Safe, flexible, readable
- **Cons**: Another abstraction layer
- **Mitigation**: Can access raw SQL when needed

## JSON:API Compliance

### Decision
Follow JSON:API specification for HTTP responses.

### Rationale
- **Standards**: Well-established REST API standard
- **Tooling**: Existing client libraries
- **Features**: Relationships, includes, meta, errors
- **Consistency**: Predictable response format

### Implementation
```javascript
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": { /* ... */ },
    "relationships": { /* ... */ }
  },
  "included": [ /* ... */ ],
  "meta": { /* ... */ }
}
```

### Design Choices

#### Automatic Transformation
HTTP plugin handles JSON:API transformation:
```javascript
// Internal format
{ id: 1, title: 'Hello' }

// JSON:API format
{ 
  data: { 
    id: '1', 
    type: 'posts',
    attributes: { title: 'Hello' }
  }
}
```

**Why**: Storage plugins don't need to know about JSON:API.

#### Compound Documents
```javascript
GET /posts?include=author,comments
```

**Why**: Reduce round trips, better performance.

### Trade-offs
- **Pros**: Standard, powerful, good tooling
- **Cons**: Verbose, learning curve
- **Mitigation**: Internal API uses simple format

## Performance Decisions

### Decision
Optimize for common cases while allowing advanced usage.

### Rationale
- **80/20 rule**: Optimize the common path
- **Lazy loading**: Don't compute until needed
- **Batching**: Reduce database round trips
- **Caching hooks**: Plugin-based caching

### Implementation Examples

#### Selective Loading
```javascript
// Only load needed fields
fields: ['id', 'name', 'email']

// Only join when requested
joins: ['authorId']
```

#### Query Optimization
```javascript
// Single query with joins vs N+1
query.leftJoin('users', 'users.id = posts.authorId');
```

#### Connection Pooling
```javascript
mysql.createPool({
  connectionLimit: 10,
  waitForConnections: true
});
```

### Trade-offs
- **Pros**: Good default performance
- **Cons**: Not optimized for every use case
- **Mitigation**: Hooks allow custom optimization

## Future Considerations

### GraphQL Support
Could add GraphQL plugin that reuses schema definitions.

### TypeScript Generation
Generate TypeScript types from runtime schemas.

### Real-time Subscriptions
WebSocket plugin for real-time updates.

### Multi-tenancy
Built-in tenant isolation support.

## Conclusion

These design decisions prioritize:
1. **Developer experience** - Intuitive, discoverable APIs
2. **Flexibility** - Extensible without modifying core
3. **Safety** - Validation, SQL injection prevention
4. **Standards** - JSON:API, REST best practices
5. **Performance** - Good defaults, optimization possible

The plugin architecture and hook system enable users to extend and customize behavior while keeping the core simple and focused.