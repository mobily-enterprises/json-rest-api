# JSON REST API - API Reference

Complete API reference for the JSON REST API library.

## Table of Contents

1. [Api Class](#api-class)
2. [Schema Class](#schema-class)
3. [QueryBuilder Class](#querybuilder-class)
4. [Resource Proxy API](#resource-proxy-api)
5. [Plugin Interface](#plugin-interface)
6. [Hook Reference](#hook-reference)
7. [Error Classes](#error-classes)
8. [Type Definitions](#type-definitions)

## Api Class

The main class for creating and managing REST APIs.

### Constructor

```javascript
new Api(options?: ApiOptions)
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idProperty` | string | `'id'` | Name of the ID field |
| `name` | string | `null` | API name for registry |
| `version` | string | `null` | API version (semver) |
| `artificialDelay` | number | `0` | Delay in ms for testing |

### Static Methods

#### `Api.get(name, version)`
Get an API instance from the global registry.

```javascript
const api = Api.get('myapp', '1.0.0');
const latest = Api.get('myapp'); // Gets latest version
```

#### `Api.registry`
Access the global API registry.

```javascript
// Check if API exists
if (Api.registry.has('myapp', '1.0.0')) { }

// Get all versions
const versions = Api.registry.versions('myapp'); // ['1.0.0', '1.1.0']

// List all APIs
const all = Api.registry.list(); // { myapp: ['1.0.0'], otherapp: ['2.0.0'] }
```

### Instance Methods

#### `use(plugin, options?)`
Add a plugin to the API.

```javascript
api.use(MySQLPlugin, { connection: dbConfig });
```

#### `addResource(type, schema, hooksOrOptions?)`
Register a resource type.

```javascript
// Basic usage
api.addResource('users', userSchema, {
  afterInsert: async (context) => {
    // Resource-specific hook
  }
});

// With searchable field mappings
api.addResource('posts', postSchema, {
  searchableFields: {
    author: 'authorId.name',     // Filter by author name via join
    category: 'categoryId.title', // Filter by category title
    search: '*'                  // Virtual field - requires custom handler
  },
  hooks: {
    afterInsert: async (context) => {
      // Resource-specific hook
    }
  }
});

// Virtual search fields (marked with '*') require a handler
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search && context.options.type === 'posts') {
    const value = context.params.filter.search;
    
    // Custom search logic
    context.query.where(
      '(posts.title LIKE ? OR posts.content LIKE ? OR posts.tags LIKE ?)',
      `%${value}%`, `%${value}%`, `%${value}%`
    );
    
    // Remove from filter to prevent column lookup
    delete context.params.filter.search;
  }
});
```

#### `hook(name, handler, priority?)`
Register a global hook.

```javascript
api.hook('beforeInsert', async (context) => {
  // Runs for all resources
}, 10); // Priority: lower = earlier
```

#### `mount(app, basePath?)`
Mount the API on an Express app (requires HTTPPlugin).

```javascript
api.mount(expressApp, '/api');
```

### CRUD Methods

These methods are typically called through the resource proxy API.

#### `get(id, options)`
```javascript
const user = await api.get(123, { type: 'users' });
```

#### `query(params, options)`
```javascript
const users = await api.query({
  filter: { active: true },
  sort: [{ field: 'name', direction: 'ASC' }],
  page: { size: 20, number: 1 }
}, { type: 'users' });
```

#### `insert(data, options)`
```javascript
const newUser = await api.insert({
  name: 'John',
  email: 'john@example.com'
}, { type: 'users' });
```

#### `update(id, data, options)`
```javascript
const updated = await api.update(123, {
  name: 'John Doe'
}, { type: 'users' });
```

#### `delete(id, options)`
```javascript
await api.delete(123, { type: 'users' });
```

## Schema Class

Defines the structure and validation rules for resources.

### Constructor

```javascript
new Schema(structure: SchemaStructure)
```

### Schema Structure

```javascript
{
  fieldName: {
    type: 'string',           // Required
    required: true,           // Optional
    default: 'value',         // Optional
    min: 1,                   // Optional (string length or number value)
    max: 100,                 // Optional
    unique: true,             // Optional
    silent: true,             // Optional - exclude from default SELECT
    searchable: true,         // Optional - allow filtering by this field
    format: 'email',          // Optional - format validation (see formats below)
    enum: ['a', 'b', 'c'],    // Optional - allowed values
    validator: (val) => {},   // Optional - custom validation function
    trim: true,               // Optional - trim whitespace (strings)
    uppercase: true,          // Optional - convert to uppercase
    lowercase: true,          // Optional - convert to lowercase
    notEmpty: true,           // Optional - disallow empty strings
    maxItems: 100,            // Optional - max array length
    maxKeys: 50,              // Optional - max object properties
    maxDepth: 5,              // Optional - max object nesting
    refs: {                   // Optional - foreign key reference
      resource: 'users',
      join: {                 // Optional - automatic join config
        eager: true,
        fields: ['id', 'name']
      }
    }
  }
}
```

### Field Parameters

| Parameter | Types | Description |
|-----------|-------|-------------|
| `type` | all | Field type (required) |
| `required` | all | Field must be present |
| `default` | all | Default value or function |
| `min` | string, number | Minimum length/value |
| `max` | string, number | Maximum length/value |
| `unique` | all | Enforce uniqueness |
| `silent` | all | Exclude from SELECT |
| `searchable` | all | Allow filtering |
| `format` | string | Format validation |
| `enum` | all | Allowed values |
| `validator` | all | Custom validation |
| `trim` | string | Trim whitespace |
| `uppercase` | string | Convert to uppercase |
| `lowercase` | string | Convert to lowercase |
| `notEmpty` | string | Disallow empty strings |
| `maxItems` | array | Maximum array length |
| `maxKeys` | object | Maximum object properties |
| `maxDepth` | object | Maximum nesting depth |

### Format Validation

The `format` parameter provides safe regex validation with ReDoS protection:

| Format | Description | Example |
|--------|-------------|---------|
| `email` | Email address | `user@example.com` |
| `url` | HTTP/HTTPS URL | `https://example.com` |
| `uuid` | UUID v4 | `123e4567-e89b-12d3-a456-426614174000` |
| `alphanumeric` | Letters and numbers | `abc123` |
| `slug` | URL-friendly string | `my-cool-page` |
| `date` | Date (YYYY-MM-DD) | `2024-01-15` |
| `time` | Time (HH:MM[:SS]) | `14:30` or `14:30:45` |
| `phone` | Phone number | `+1 (555) 123-4567` |
| `postalCode` | Postal/ZIP code | `12345` or `A1B 2C3` |

Example:
```javascript
const schema = new Schema({
  email: { 
    type: 'string', 
    required: true,
    format: 'email'  // Safe email validation
  },
  website: { 
    type: 'string', 
    format: 'url'    // ReDoS-protected URL validation
  },
  tags: {
    type: 'array',
    maxItems: 10     // Prevent DoS from huge arrays
  }
});
```

### Field Types

| Type | Description | MySQL Type |
|------|-------------|------------|
| `'id'` | Auto-incrementing ID | INT AUTO_INCREMENT |
| `'string'` | Text field | VARCHAR(255) |
| `'number'` | Numeric field | DOUBLE |
| `'boolean'` | True/false | BOOLEAN |
| `'timestamp'` | Unix timestamp | BIGINT |
| `'date'` | Date (YYYY-MM-DD) | DATE |
| `'json'` | JSON data | TEXT |
| `'array'` | Array (stored as JSON) | TEXT |
| `'object'` | Object (stored as JSON) | TEXT |

### Methods

#### `validate(data, options?)`
Validate data against the schema.

```javascript
const errors = schema.validate(userData);
if (errors.length > 0) {
  throw new ValidationError(errors);
}
```

Options:
- `partial`: boolean - Allow partial data (for updates)
- `skipRequired`: boolean - Skip required field validation

## QueryBuilder Class

Fluent interface for building SQL queries.

### Constructor

```javascript
new QueryBuilder(table: string, api?: Api)
```

### Methods

#### `select(...fields)`
Add fields to SELECT clause.
```javascript
query.select('id', 'name', 'email');
query.select('COUNT(*) as total');
```

#### `where(condition, ...args)`
Add WHERE condition.
```javascript
query.where('active = ?', true);
query.where('age BETWEEN ? AND ?', 18, 65);
```

#### `join(type, tableOrField, on?)`
Add JOIN clause. If `on` is omitted and the field has refs, uses automatic join.
```javascript
// Manual join
query.leftJoin('comments', 'comments.userId = users.id');

// Automatic join using refs
query.leftJoin('authorId'); // Uses schema refs
```

#### `includeRelated(fieldName, fields?)`
Include fields from a related resource.
```javascript
// Include all non-silent fields
query.includeRelated('authorId');

// Include specific fields with auto-prefix
query.includeRelated('authorId', ['name', 'email']);
// Selects: users.name as authorId_name, users.email as authorId_email

// Include with custom aliases
query.includeRelated('authorId', {
  name: 'authorName',      // Custom alias
  email: true,             // Auto-prefix: authorId_email
  avatar: 'userAvatar'     // Custom alias
});
```

#### `orderBy(field, direction?)`
Add ORDER BY clause.
```javascript
query.orderBy('createdAt', 'DESC');
query.orderBy('name'); // Default: ASC
```

#### `groupBy(...fields)`
Add GROUP BY clause.
```javascript
query.groupBy('userId', 'status');
```

#### `having(condition, ...args)`
Add HAVING clause.
```javascript
query.having('COUNT(*) > ?', 5);
```

#### `limit(limit, offset?)`
Add LIMIT clause.
```javascript
query.limit(20);       // LIMIT 20
query.limit(20, 40);   // LIMIT 40, 20 (MySQL syntax)
```

#### `toSQL()`
Generate the final SQL query.
```javascript
const sql = query.toSQL();
// SELECT * FROM users WHERE active = ? ORDER BY name LIMIT 20
```

#### `getArgs()`
Get query parameter arguments.
```javascript
const args = query.getArgs(); // [true]
```

## Resource Proxy API

The recommended way to interact with resources.

### Accessing Resources

```javascript
// Get resource proxy
const users = api.resources.users;

// Check if resource exists
if ('users' in api.resources) { }
```

### CRUD Methods

#### `get(id, options?)`
Get a single resource by ID.
```javascript
const user = await api.resources.users.get(123);
const userWithJoins = await api.resources.users.get(123, {
  joins: ['departmentId']
});
```

#### `query(params?, options?)`
Query multiple resources.
```javascript
const users = await api.resources.users.query({
  filter: { 
    active: true,
    role: 'admin',
    // Only searchable fields can be filtered
  },
  sort: [{ field: 'name', direction: 'ASC' }],
  page: { size: 20, number: 1 },
  joins: ['departmentId']
});
```

**Query Parameters:**
- `filter`: Object with field/value pairs (fields must be marked `searchable: true`)
- `sort`: Array of sort objects or string (e.g., '-createdAt,name')
- `page`: Object with `size` and `number` for pagination
- `view`: String name of a predefined view (requires ViewsPlugin)

#### `create(data, options?)` / `post(data, options?)`
Create a new resource.
```javascript
const newUser = await api.resources.users.create({
  name: 'John',
  email: 'john@example.com'
});
```

#### `update(id, data, options?)` / `put(id, data, options?)`
Update a resource.
```javascript
const updated = await api.resources.users.update(123, {
  name: 'John Doe'
});
```

#### `delete(id, options?)` / `remove(id, options?)`
Delete a resource.
```javascript
await api.resources.users.delete(123);
```

### Options

All methods accept an options object:

| Option | Type | Description |
|--------|------|-------------|
| `joins` | boolean \| string[] | Control which joins to perform (supports nested paths) |
| `excludeJoins` | string[] | Exclude specific eager joins |
| `artificialDelay` | number | Override delay for this operation |
| `allowNotFound` | boolean | Don't throw if resource not found (get only) |
| `skipValidation` | boolean | Skip schema validation |
| `partial` | boolean | Allow partial data (update only) |
| `fullRecord` | boolean | Require complete record (PUT semantics) |

### Nested Joins

The `joins` option supports dot notation for multi-level joins:

```javascript
// Single level
joins: ['authorId', 'categoryId']

// Nested (two levels)
joins: ['authorId.countryId']

// Multiple nested paths
joins: ['authorId.countryId', 'editorId.departmentId']

// Three levels deep
joins: ['authorId.departmentId.countryId']
```

Requirements:
- Each field in the path must have `refs.join` configuration
- Parent joins are automatically included
- Invalid paths throw `BadRequestError` with details
- Hooks execute from innermost to outermost level

## Transaction API

High-level transaction support for database operations.

### api.transaction(fn, options)

Execute operations within a database transaction.

```javascript
// Basic transaction
const result = await api.transaction(async (trx) => {
  const user = await trx.resources.users.create({ name: 'Alice' });
  const account = await trx.resources.accounts.create({ 
    userId: user.id, 
    balance: 1000 
  });
  return { user, account };
});

// With options
const result = await api.transaction(async (trx) => {
  // Operations here
}, {
  timeout: 5000,        // Transaction timeout in ms
  retries: 3,           // Number of retry attempts
  isolationLevel: 'READ COMMITTED'
});
```

### Transaction Methods

#### trx.savepoint(name, fn)

Create a savepoint within a transaction.

```javascript
await api.transaction(async (trx) => {
  const user = await trx.resources.users.create({ name: 'Bob' });
  
  try {
    await trx.savepoint('risky_operation', async () => {
      // If this fails, only rolls back to savepoint
      await trx.resources.accounts.create({ userId: user.id, balance: -100 });
    });
  } catch (error) {
    // User creation is preserved
  }
});
```

### Requirements

- Storage adapter must support transactions (MySQL, PostgreSQL)
- Memory storage gracefully degrades (no actual transactions)
- Nested transactions are supported via savepoints
- All operations within transaction share the same connection

## Batch Operations API

Execute multiple operations efficiently.

### api.batch(operations, options)

Execute multiple mixed operations.

```javascript
const results = await api.batch([
  { method: 'create', type: 'users', data: { name: 'Alice' } },
  { method: 'create', type: 'users', data: { name: 'Bob' } },
  { method: 'update', type: 'products', id: 123, data: { price: 99.99 } },
  { method: 'delete', type: 'orders', id: 456 }
], {
  stopOnError: false,  // Continue on failures
  parallel: true       // Execute independent operations in parallel
});

// Results structure
{
  results: [
    { success: true, data: { id: 1, name: 'Alice' }, operation: {...} },
    { success: true, data: { id: 2, name: 'Bob' }, operation: {...} },
    { success: true, data: { id: 123, price: 99.99 }, operation: {...} },
    { success: false, error: {...}, operation: {...} }
  ],
  successful: 3,
  failed: 1
}
```

### api.batch.transaction(fn, options)

Execute batch operations within a transaction.

```javascript
const results = await api.batch.transaction(async (batch) => {
  // All operations share the same transaction
  await batch.resources.accounts.create([
    { name: 'Checking', balance: 1000 },
    { name: 'Savings', balance: 5000 }
  ]);
  
  await batch.resources.users.update([
    { id: 1, data: { verified: true } },
    { id: 2, data: { verified: true } }
  ]);
});
```

## Bulk Operations API

Optimized operations for multiple records of the same type.

### resources.{type}.bulk.create(items, options)

Bulk create multiple records.

```javascript
const users = await api.resources.users.bulk.create([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' }
], {
  chunk: 1000,         // Process in chunks
  validate: true,      // Validate all before inserting
  returnIds: true      // Return generated IDs
});
```

### resources.{type}.bulk.update(updates, options)

Bulk update multiple records.

```javascript
// Update specific records
const results = await api.resources.products.bulk.update([
  { id: 1, data: { price: 19.99 } },
  { id: 2, data: { price: 29.99 } },
  { id: 3, data: { price: 39.99 } }
]);

// Update by filter
const result = await api.resources.products.bulk.update({
  filter: { category: 'electronics' },
  data: { discounted: true }
});
// Returns: { updated: 42 }
```

### resources.{type}.bulk.delete(idsOrFilter, options)

Bulk delete multiple records.

```javascript
// Delete by IDs
const results = await api.resources.users.bulk.delete([1, 2, 3]);

// Delete by filter
const result = await api.resources.users.bulk.delete({
  filter: { inactive: true, lastLogin: { lt: '2023-01-01' } }
});
// Returns: { deleted: 156 }
```

### Performance Notes

- Bulk operations use optimized SQL (single INSERT/UPDATE/DELETE)
- Memory storage falls back to individual operations
- Progress callbacks available for large datasets
- Chunking prevents memory issues

## Connection Pool Configuration

Configure database connection pooling for optimal performance.

### Pool Options (MySQL)

```javascript
const api = createApi({
  storage: 'mysql',
  mysql: {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'myapp',
    pool: {
      max: 20,                    // Maximum connections
      min: 5,                     // Minimum connections
      acquireTimeout: 30000,      // Max time to acquire connection (ms)
      idleTimeout: 60000,         // Time before idle connection is closed
      connectionLimit: 100,       // Hard limit on total connections
      queueLimit: 0,              // Max queued requests (0 = unlimited)
      enableKeepAlive: true,      // TCP keep-alive
      keepAliveInitialDelay: 0    // Keep-alive delay (ms)
    }
  }
});
```

### Pool Monitoring

```javascript
// Get pool statistics
const stats = await api.getPoolStats();
{
  total: 20,        // Total connections
  active: 5,        // Currently in use
  idle: 15,         // Available connections
  waiting: 0,       // Requests waiting for connection
  timeout: 30000,   // Acquire timeout
  created: 20,      // Total connections created
  destroyed: 0      // Total connections destroyed
}

// Monitor pool events
api.on('pool:acquire', (connection) => {
  console.log('Connection acquired:', connection.threadId);
});

api.on('pool:release', (connection) => {
  console.log('Connection released:', connection.threadId);
});

api.on('pool:timeout', (info) => {
  console.error('Pool timeout:', info);
});
```

### Best Practices

1. **Connection Limits**: Set `max` based on database server limits
2. **Timeouts**: Balance between responsiveness and connection reuse
3. **Monitoring**: Track pool stats in production
4. **Graceful Shutdown**: Always call `api.disconnect()` on shutdown

## Plugin Interface

Plugins extend API functionality.

### Plugin Structure

```javascript
const MyPlugin = {
  name: 'MyPlugin',     // Optional but recommended
  install(api, options) {
    // Register hooks
    api.hook('beforeInsert', handler);
    
    // Implement storage methods
    api.implement('get', getImplementation);
    
    // Add API methods
    api.myMethod = () => { };
    
    // Store plugin state
    api.myPluginData = { };
  }
};
```

### Storage Implementation

Plugins can implement these methods:
- `get(context)` - Get single resource
- `query(context)` - Query multiple resources
- `insert(context)` - Create resource
- `update(context)` - Update resource
- `delete(context)` - Delete resource

Context includes:
```javascript
{
  api,        // API instance
  method,     // Method name
  id,         // Resource ID (get/update/delete)
  data,       // Resource data (insert/update)
  params,     // Query parameters (query)
  options,    // Operation options
  result      // Result (in after* hooks)
}
```

## Built-in Plugins

### CorsPlugin

Automatic CORS configuration with platform detection.

#### Basic Usage

```javascript
import { CorsPlugin } from 'json-rest-api/plugins/cors.js';

// Zero configuration - works automatically
api.use(CorsPlugin);

// With options
api.use(CorsPlugin, {
  cors: {
    origin: ['https://myapp.com', 'https://www.myapp.com']
  }
});
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cors` | object \| function | auto-detect | CORS configuration or validation function |
| `debug` | boolean | `false` | Enable debug logging |

#### CORS Configuration Object

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `origin` | string \| string[] \| RegExp \| function \| boolean | auto | Allowed origins |
| `credentials` | boolean | `true` | Allow credentials |
| `methods` | string[] | `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']` | Allowed methods |
| `allowedHeaders` | string[] | `['Content-Type', 'Authorization', 'X-Requested-With']` | Allowed headers |
| `exposedHeaders` | string[] | `['X-Total-Count', 'Link', 'X-Request-ID']` | Exposed headers |
| `maxAge` | number | `86400` | Preflight cache time (seconds) |

#### Auto-Detection Features

1. **Development Mode** (NODE_ENV !== 'production'):
   - Allows all localhost variations
   - Allows local network IPs
   - Allows common development tools

2. **Platform Detection**:
   - Vercel, Netlify, Heroku, AWS Amplify
   - Railway, Render, Google Cloud Run
   - Azure, DigitalOcean, Fly.io
   - Cloudflare, GitHub Codespaces, Gitpod
   - And many more...

3. **Environment Variables** (checked in order):
   - `CORS_ORIGINS` / `CORS_ORIGIN`
   - `ALLOWED_ORIGINS` / `ALLOWED_ORIGIN`
   - `FRONTEND_URL` / `CLIENT_URL`
   - `APP_URL` / `WEB_URL` / `PUBLIC_URL`

#### Usage Examples

```javascript
// Dynamic validation
api.use(CorsPlugin, {
  cors: async (origin, callback) => {
    const allowed = await checkOriginInDatabase(origin);
    callback(null, allowed);
  }
});

// Regex pattern
api.use(CorsPlugin, {
  cors: {
    origin: /^https:\/\/[a-z]+\.example\.com$/
  }
});

// Public API (no credentials)
api.use(CorsPlugin, {
  cors: {
    origin: '*',
    credentials: false  // Required with wildcard
  }
});
```

### JwtPlugin

JSON Web Token authentication with refresh token support.

#### Basic Usage

```javascript
import { JwtPlugin } from 'json-rest-api/plugins/jwt.js';

api.use(JwtPlugin, {
  secret: process.env.JWT_SECRET
});

// Generate tokens
const token = await api.generateToken({
  userId: 123,
  email: 'user@example.com',
  roles: ['user']
});

// Verify tokens
const payload = await api.verifyToken(token);
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `secret` | string | - | Secret key for HMAC algorithms |
| `privateKey` | string | - | Private key for RSA/ECDSA algorithms |
| `publicKey` | string | - | Public key for RSA/ECDSA algorithms |
| `algorithm` | string | `'HS256'` | JWT algorithm |
| `expiresIn` | string | `'24h'` | Token expiration time |
| `refreshExpiresIn` | string | `'30d'` | Refresh token expiration |
| `issuer` | string | `'json-rest-api'` | Token issuer |
| `audience` | string | - | Token audience |
| `clockTolerance` | number | `30` | Clock skew tolerance (seconds) |
| `refreshTokenLength` | number | `32` | Refresh token bytes |
| `supportLegacyTokens` | boolean | `false` | Support Base64 JSON tokens |
| `tokenHeader` | string | - | Custom header for token |
| `tokenQueryParam` | string | - | Query parameter for token |
| `tokenCookie` | string | - | Cookie name for token |
| `tokenStore` | Map \| object | `new Map()` | Storage for refresh tokens |
| `beforeSign` | function | - | Hook before signing |
| `afterVerify` | function | - | Hook after verification |
| `onRefresh` | function | - | Hook on token refresh |

#### API Methods

##### `generateToken(payload, options?)`
Generate a JWT token.

```javascript
const token = await api.generateToken(
  { userId: 123, role: 'admin' },
  { expiresIn: '1h' }
);
```

##### `verifyToken(token, options?)`
Verify and decode a JWT token.

```javascript
try {
  const payload = await api.verifyToken(token);
} catch (error) {
  // Token expired, invalid, etc.
}
```

##### `generateRefreshToken(userId, metadata?)`
Generate a refresh token.

```javascript
const refreshToken = await api.generateRefreshToken(123, {
  deviceId: 'device-123',
  userAgent: req.headers['user-agent']
});
```

##### `refreshAccessToken(refreshToken)`
Exchange refresh token for new access token.

```javascript
const { accessToken, refreshToken, expiresIn } = 
  await api.refreshAccessToken(refreshToken);
```

##### `revokeRefreshToken(refreshToken)`
Revoke a refresh token.

```javascript
await api.revokeRefreshToken(refreshToken);
```

##### `decodeToken(token)`
Decode token without verification (for debugging).

```javascript
const decoded = api.decodeToken(token);
// { header: {...}, payload: {...}, signature: '...' }
```

#### Integration with HTTP

The plugin automatically extracts tokens from:
1. `Authorization: Bearer <token>` header
2. Custom header (if configured)
3. Query parameter (if configured)
4. Cookie (if configured)

```javascript
// Automatic user population
api.hook('beforeOperation', async (context) => {
  // context.options.user is populated from JWT
  if (context.options.user) {
    console.log('Authenticated user:', context.options.user.userId);
  }
});
```

#### RS256 Example

```javascript
import { readFileSync } from 'fs';

api.use(JwtPlugin, {
  privateKey: readFileSync('./private.key'),
  publicKey: readFileSync('./public.key'),
  algorithm: 'RS256'
});
```

### AuthorizationPlugin

Role-based access control (RBAC) with ownership permissions.

#### Basic Usage

```javascript
import { AuthorizationPlugin } from 'json-rest-api/plugins';

api.use(AuthorizationPlugin, {
  // Define roles and their permissions
  roles: {
    admin: {
      permissions: '*',  // All permissions
      description: 'Full system access'
    },
    editor: {
      permissions: ['posts.*', 'media.*', 'users.read'],
      description: 'Content management'
    },
    user: {
      permissions: [
        'posts.create',
        'posts.read', 
        'posts.update.own',
        'posts.delete.own'
      ]
    }
  },
  
  // How to enhance users with roles/permissions
  enhanceUser: async (user, context) => {
    // Load from database, JWT, session, etc.
    const roles = await loadUserRoles(user.id);
    return { ...user, roles };
  }
});
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enhanceUser` | function | - | Async function to load user roles/permissions |
| `roles` | object | `{}` | Role definitions with permissions |
| `resources` | object | `{}` | Resource-specific auth rules |
| `defaultRole` | string | `'user'` | Role for users with no roles |
| `superAdminRole` | string | `'admin'` | Role that bypasses all checks |
| `publicRole` | string | `'public'` | Role for unauthenticated access |
| `ownerField` | string | `'userId'` | Default field for ownership |
| `requireAuth` | boolean | `true` | Require authentication by default |

#### Permission Syntax

```javascript
// Exact permission
'posts.create'

// Wildcard - all actions on resource
'posts.*'

// Ownership suffix
'posts.update.own'  // Can only update own posts

// Super wildcard - all permissions
'*'
```

#### Resource Configuration

```javascript
api.use(AuthorizationPlugin, {
  resources: {
    posts: {
      ownerField: 'authorId',     // Which field identifies owner
      public: ['read'],            // No auth required
      authenticated: ['create'],   // Any logged-in user
      owner: ['update', 'delete'], // Only owner (checks .own permission)
      permissions: {               // Custom permissions
        publish: 'posts.publish',
        feature: 'posts.feature'
      }
    }
  }
});
```

#### Enhanced User Object

After enhancement, users have these methods:

```javascript
// Check single permission
if (user.can('posts.create')) { }

// Check role
if (user.hasRole('editor')) { }

// Check multiple roles
if (user.hasAnyRole('editor', 'admin')) { }
if (user.hasAllRoles('editor', 'reviewer')) { }
```

#### Integration Examples

##### With Express/HTTP

```javascript
// Your auth middleware
app.use(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    const payload = jwt.verify(token, SECRET);
    req.user = { id: payload.sub, email: payload.email };
  }
  next();
});

// Tell HTTPPlugin where to find user
api.use(HTTPPlugin, {
  getUserFromRequest: (req) => req.user
});
```

##### With Direct API Usage

```javascript
// Pass user in options
await api.resources.posts.update(123, 
  { title: 'New' },
  { user: { id: 1, email: 'user@example.com' } }
);
```

##### Database Integration

```javascript
api.use(AuthorizationPlugin, {
  enhanceUser: async (user) => {
    // Load from your database
    const result = await db.query(
      'SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?',
      [user.id]
    );
    return {
      ...user,
      roles: result.map(r => r.name)
    };
  }
});
```

##### JWT Integration

```javascript
api.use(AuthorizationPlugin, {
  enhanceUser: async (user) => {
    // Roles already in JWT payload
    return user; // { id: 1, roles: ['editor'], permissions: ['posts.feature'] }
  }
});
```

#### Field-Level Permissions

Control access to specific fields:

```javascript
const schema = new Schema({
  title: { type: 'string' },
  content: { type: 'string' },
  internalNotes: { 
    type: 'string',
    permission: 'posts.sensitive'  // Only users with this permission
  }
});
```

#### Authorization Hooks

The plugin adds these hooks (priority 10):
- `beforeInsert` - Checks create permission
- `beforeGet` - Checks read permission
- `beforeQuery` - Checks read permission
- `beforeUpdate` - Checks update permission
- `beforeDelete` - Checks delete permission
- `afterGet` - Ownership verification
- `transformResult` - Field-level permission filtering

#### Error Handling

```javascript
try {
  await api.resources.posts.delete(123, { user });
} catch (error) {
  if (error.code === 'UNAUTHORIZED') {
    // User not authenticated
  } else if (error.code === 'FORBIDDEN') {
    // User lacks permission
  }
}
```

## Hook Reference

### Lifecycle Hooks

| Hook | When | Context |
|------|------|---------|
| `beforeValidate` | Before schema validation | data, options |
| `afterValidate` | After schema validation | data, options, errors |
| `beforeGet` | Before fetching single resource | id, options |
| `afterGet` | After fetching single resource | id, options, result |
| `beforeQuery` | Before querying resources | params, options |
| `afterQuery` | After querying resources | params, options, results |
| `beforeInsert` | Before creating resource | data, options |
| `afterInsert` | After creating resource | data, options, result |
| `beforeUpdate` | Before updating resource | id, data, options |
| `afterUpdate` | After updating resource | id, data, options, result |
| `beforeDelete` | Before deleting resource | id, options |
| `afterDelete` | After deleting resource | id, options, result |
| `transformResult` | Before returning result | options, result |
| `beforeSend` | Before HTTP response (HTTP only) | options, result |

### Query Hooks

| Hook | When | Context |
|------|------|---------|
| `initializeQuery` | Query builder creation | query, params, options |
| `modifyQuery` | After initialization | query, params, options |
| `finalizeQuery` | Before execution | query, params, options |

### Hook Context Properties

```javascript
{
  api,          // API instance
  method,       // Operation method
  options: {
    type,       // Resource type
    isHttp,     // HTTP request flag
    isJoinResult, // Joined data flag
    joinContext,  // Join context ('join')
    parentType,   // Parent resource type
    parentId,     // Parent resource ID
    parentField   // Field name in parent
  },
  // Method-specific properties
  id,           // Resource ID
  data,         // Input data
  result,       // Operation result
  results,      // Query results array
  params,       // Query parameters
  errors,       // Validation errors
  query,        // QueryBuilder instance
  joinFields    // Join metadata
}
```

## Error Classes

All errors extend the base `ApiError` class.

### ApiError

Base error class.

```javascript
class ApiError extends Error {
  status: number;        // HTTP status code
  code: string;         // Error code
  title: string;        // Error title
  context: any;         // Additional context
  
  withContext(context): this;
}
```

### Specific Errors

#### ValidationError
```javascript
const error = new ValidationError();
error.addFieldError('email', 'Invalid format', 'INVALID_FORMAT');
throw error;
```

#### NotFoundError
```javascript
throw new NotFoundError('users', 123);
```

#### BadRequestError
```javascript
throw new BadRequestError('Invalid filter parameter')
  .withContext({ parameter: 'filter[status]' });
```

#### ConflictError
```javascript
throw new ConflictError('Email already exists')
  .withContext({ field: 'email' });
```

#### InternalError
```javascript
throw new InternalError('Database connection failed')
  .withContext({ originalError: dbError });
```

### Error Codes

Standard error codes:
- `VALIDATION_ERROR` - Schema validation failed
- `NOT_FOUND` - Resource not found
- `BAD_REQUEST` - Invalid request
- `CONFLICT` - Resource conflict
- `INTERNAL_ERROR` - Server error
- `DUPLICATE_RESOURCE` - Duplicate key
- `DATABASE_ERROR` - Database operation failed

## Plugins

### SimplifiedRecordsPlugin

Transforms JSON:API compliant responses into a simplified format that's more convenient for developers.

```javascript
import { SimplifiedRecordsPlugin } from 'json-rest-api';

api.use(SimplifiedRecordsPlugin, {
  flattenResponse: false,   // Keep data wrapper (default)
  includeType: true,        // Keep type field (default)
  embedRelationships: true  // Embed related objects (default)
});
```

**Features:**

1. **Flattened Attributes** - Moves attributes directly into the resource object
2. **Embedded Relationships** - Places related objects directly in the response
3. **Optional Response Flattening** - Removes the data wrapper for single resources
4. **Type Field Control** - Optionally exclude the type field
5. **Developer Convenience** - Provides a familiar, intuitive format

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `flattenResponse` | boolean | `false` | Remove data wrapper for single resources |
| `includeType` | boolean | `true` | Include the type field in responses |
| `embedRelationships` | boolean | `true` | Embed related objects instead of using relationships/included |

**Transformation Examples:**

#### Single Resource
```javascript
// Request
GET /api/posts/1

// Without plugin (JSON:API default):
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "My Post",
      "content": "Post content"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "42" }
      }
    }
  },
  "included": [{
    "id": "42",
    "type": "users",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }]
}

// With SimplifiedRecordsPlugin:
{
  "data": {
    "id": "1",
    "type": "posts",
    "title": "My Post",
    "content": "Post content",
    "authorId": "42",
    "author": {
      "id": "42",
      "type": "users",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}

// With flattenResponse: true
{
  "id": "1",
  "type": "posts",
  "title": "My Post",
  "content": "Post content",
  "authorId": "42",
  "author": {
    "id": "42",
    "type": "users",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

#### Collection with Pagination
```javascript
// With SimplifiedRecordsPlugin + flattenResponse: true
{
  "records": [
    {
      "id": "1",
      "type": "posts",
      "title": "First Post",
      "authorId": "42",
      "author": {
        "id": "42",
        "type": "users",
        "name": "John Doe"
      }
    },
    {
      "id": "2",
      "type": "posts",
      "title": "Second Post",
      "authorId": "43",
      "author": {
        "id": "43",
        "type": "users",
        "name": "Jane Smith"
      }
    }
  ],
  "meta": {
    "totalCount": 10,
    "pageNumber": 1,
    "pageSize": 2,
    "totalPages": 5
  },
  "links": {
    "first": "/api/posts?page[number]=1&page[size]=2",
    "last": "/api/posts?page[number]=5&page[size]=2",
    "next": "/api/posts?page[number]=2&page[size]=2"
  }
}
```


**Performance Considerations:**

- Transformation happens after response formatting
- Minimal overhead (~1ms per response)
- No additional database queries
- Works with both programmatic and HTTP APIs

**Compatibility:**

- Works with all storage plugins
- Compatible with all query features
- Maintains all functionality
- Requests remain JSON:API formatted

- Resource-specific rules

### ViewsPlugin

Provides view-based control over response shapes with smart defaults.

```javascript
import { ViewsPlugin } from 'json-rest-api/plugins/views.js';

api.use(ViewsPlugin, {
  // Global defaults override (optional)
  defaults: {
    query: { pageSize: 30 },
    get: { joins: true }
  }
});
```

**Features:**
- Smart defaults (no joins for lists, all joins for single records)
- Resource-level default overrides
- Named views for different use cases
- Field filtering
- View-based permissions

**Resource Configuration:**

```javascript
api.addResource('posts', postSchema, {
  // Optional: Override defaults for this resource
  defaults: {
    query: {
      joins: ['authorId'],    // Include author in lists
      pageSize: 10,
      sort: '-createdAt'
    },
    get: {
      joins: ['authorId', 'categoryId'],  // Limit joins for single records
      excludeFields: ['internalNotes']
    }
  },
  
  // Optional: Named views
  views: {
    minimal: {
      query: {
        joins: [],
        fields: ['id', 'title', 'createdAt']
      },
      get: {
        joins: ['authorId'],
        fields: ['id', 'title', 'content', 'authorId']
      }
    },
    admin: {
      query: { joins: true },
      get: { joins: true, includeFields: ['internalNotes'] }
    }
  },
  
  // Optional: View permissions
  viewPermissions: {
    admin: 'admin'  // Requires 'admin' role
  }
});
```

**Usage:**

```javascript
// Uses smart defaults or resource defaults
GET /api/posts
GET /api/posts/123

// Use named views
GET /api/posts?view=minimal
GET /api/posts/123?view=admin
```

**API Methods:**

```javascript
// Get available views for a resource
const views = api.getResourceViews('posts'); // ['minimal', 'admin']

// Get view configuration
const config = api.getViewConfig('posts', 'minimal', 'query');
```

### QueryLimitsPlugin

Prevents resource exhaustion by limiting query complexity.

```javascript
import { QueryLimitsPlugin } from 'json-rest-api/plugins/query-limits.js';

api.use(QueryLimitsPlugin, {
  maxJoins: 5,
  maxJoinDepth: 3,
  maxPageSize: 100,
  defaultPageSize: 20,
  maxFilterFields: 10,
  maxSortFields: 3,
  maxQueryCost: 100,
  
  // Optional: Resource-specific limits
  resources: {
    posts: {
      maxPageSize: 200,
      maxQueryCost: 150
    }
  },
  
  // Optional: Bypass for certain users
  bypassRoles: ['admin'],
  bypassCheck: (user) => user?.isPremium
});
```

**Features:**
- Limits join count and depth
- Limits page size
- Limits filter and sort complexity
- Cost-based query rejection
- Resource-specific overrides
- Admin/premium user bypass

**Error Example:**

```json
{
  "error": {
    "message": "Maximum number of joins (5) exceeded",
    "context": {
      "joinCount": 7,
      "maxJoins": 5,
      "joins": ["author", "category", "tags", "comments", "related"]
    }
  }
}
```

### HTTPPlugin

Adds RESTful JSON:API endpoints to your Express application.

```javascript
import { HTTPPlugin } from 'json-rest-api';

api.use(HTTPPlugin, {
  app: expressApp,              // Required: Express app instance
  basePath: '/api',             // API base path (default: '/api')
  strictJsonApi: false,         // Enable strict JSON:API compliance (default: false)
  
  // JSON:API Enhancements (new features)
  jsonApiVersion: '1.0',        // Add version to all responses
  jsonApiMetaFormat: true,      // Use meta.page format for pagination
  includeLinks: true,           // Add self/related links to resources
  
  // Per-resource options
  typeOptions: {
    users: {
      searchFields: ['name', 'email'],
      allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    }
  },
  
  // Content-Type validation
  validateContentType: true,    // Validate Content-Type header (default: true)
  allowedContentTypes: [        // Accepted content types (when not strict)
    'application/json',
    'application/vnd.api+json'
  ],
  
  // Middleware
  middleware: [],               // Global middleware
  getUserFromRequest: (req) => req.user,  // Extract user from request
  
  // CORS configuration (passed to cors package)
  cors: {
    origin: '*',
    credentials: true
  }
});
```

**Features:**

1. **Full JSON:API Compliance** - Implements JSON:API specification
2. **Strict Mode** - Optional strict compliance enforcement
3. **Query Parameters** - Support for filtering, sorting, pagination, sparse fieldsets
4. **Content Negotiation** - Validates Content-Type headers
5. **Error Handling** - JSON:API compliant error responses
6. **Middleware Support** - Integrate with Express middleware

**Endpoints Created:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/{type}` | List resources with filtering, sorting, pagination |
| GET | `/api/{type}/{id}` | Get single resource |
| POST | `/api/{type}` | Create new resource |
| PUT | `/api/{type}/{id}` | Replace resource |
| PATCH | `/api/{type}/{id}` | Update resource |
| DELETE | `/api/{type}/{id}` | Delete resource |

**Strict JSON:API Mode:**

When `strictJsonApi: true`:

1. **Content-Type**: Only accepts `application/vnd.api+json`
   ```
   POST /api/users
   Content-Type: application/vnd.api+json  ✅
   Content-Type: application/json         ❌ 415 Error
   ```

2. **Query Parameters**: Only standard JSON:API parameters allowed
   - ✅ `include`, `fields`, `sort`, `page`, `filter`, `view`
   - ❌ Legacy: `pageSize`, `joins`, direct filters

3. **Examples**:
   ```javascript
   // Valid in strict mode:
   GET /api/users?filter[name]=John&page[size]=10
   GET /api/posts?include=author&fields[posts]=title,content
   
   // Invalid in strict mode (400 error):
   GET /api/users?name=John        // Direct filter
   GET /api/users?pageSize=10      // Legacy pagination
   GET /api/users?unknownParam=x   // Unknown parameter
   ```

**Query Parameter Support:**

| Parameter | Format | Example |
|-----------|--------|---------|
| `include` | Comma-separated relationships | `?include=author,comments` |
| `fields` | Sparse fieldsets by type | `?fields[posts]=title,content` |
| `sort` | Comma-separated, `-` for DESC | `?sort=-createdAt,title` |
| `page` | Pagination with size/number | `?page[size]=10&page[number]=2` |
| `filter` | Field-based filtering | `?filter[status]=published` |

**Advanced JSON:API Features:**

1. **JSON:API Version Declaration**
   ```javascript
   api.use(HTTPPlugin, { jsonApiVersion: '1.0' });
   
   // All responses include:
   {
     "jsonapi": { "version": "1.0" },
     "data": { /* ... */ }
   }
   ```

2. **Meta Field Naming Format**
   ```javascript
   api.use(HTTPPlugin, { jsonApiMetaFormat: true });
   
   // Pagination meta follows JSON:API convention:
   {
     "data": [ /* ... */ ],
     "meta": {
       "page": {
         "total": 100,
         "size": 10,
         "number": 2,
         "totalPages": 10
       }
     }
   }
   ```

3. **Enhanced Error Format**
   - Errors include `source` field pointing to the problematic field
   - Support for `source.pointer` (JSON Pointer) and `source.parameter`
   ```json
   {
     "errors": [{
       "status": "422",
       "code": "VALIDATION_ERROR",
       "title": "Validation Error",
       "detail": "Name must be at least 3 characters",
       "source": {
         "pointer": "/data/attributes/name"
       }
     }]
   }
   ```

4. **Self and Related Links**
   ```javascript
   api.use(HTTPPlugin, { includeLinks: true });
   
   // Resources include links:
   {
     "data": {
       "type": "posts",
       "id": "1",
       "attributes": { /* ... */ },
       "relationships": {
         "author": {
           "data": { "type": "users", "id": "42" },
           "links": {
             "self": "http://api.example.com/api/posts/1/relationships/author",
             "related": "http://api.example.com/api/posts/1/author"
           }
         }
       },
       "links": {
         "self": "http://api.example.com/api/posts/1"
       }
     }
   }
   ```

5. **Sorting on Relationship Fields**
   ```javascript
   // Define searchable fields including relationships
   api.addResource('posts', postSchema, {
     searchableFields: {
       'author.name': 'authorId.name',    // Sort by author's name
       'category.title': 'categoryId.title' // Sort by category title
     }
   });
   
   // Now you can sort by relationship fields:
   GET /api/posts?sort=author.name,-category.title
   ```

**Advanced Filter Operators:**

The library now supports additional filter operators beyond basic equality:

| Operator | SQL Equivalent | Example | Description |
|----------|---------------|---------|-------------|
| `eq` | `=` | `?filter[age][eq]=25` | Equal to (default) |
| `ne` | `!=` | `?filter[status][ne]=draft` | Not equal to |
| `gt` | `>` | `?filter[price][gt]=100` | Greater than |
| `gte` | `>=` | `?filter[age][gte]=18` | Greater than or equal |
| `lt` | `<` | `?filter[stock][lt]=10` | Less than |
| `lte` | `<=` | `?filter[price][lte]=50` | Less than or equal |
| `in` | `IN` | `?filter[status][in]=active,pending` | In array |
| `nin` | `NOT IN` | `?filter[role][nin]=admin,root` | Not in array |
| `like` | `LIKE` | `?filter[name][like]=%john%` | Pattern match |
| `ilike` | `ILIKE` | `?filter[email][ilike]=%@EXAMPLE.COM` | Case-insensitive pattern |
| `notlike` | `NOT LIKE` | `?filter[path][notlike]=/admin/%` | Not matching pattern |
| `startsWith` | `LIKE x%` | `?filter[name][startsWith]=John` | Starts with |
| `endsWith` | `LIKE %x` | `?filter[email][endsWith]=.com` | Ends with |
| `contains` | `LIKE %x%` | `?filter[bio][contains]=developer` | Contains substring |
| `icontains` | `ILIKE %x%` | `?filter[title][icontains]=NEWS` | Case-insensitive contains |
| `between` | `BETWEEN` | `?filter[age][between]=18,65` | Between two values |
| `null` | `IS NULL` | `?filter[deletedAt][null]=true` | Is null |
| `notnull` | `IS NOT NULL` | `?filter[email][notnull]=true` | Is not null |

### LoggingPlugin

Implements structured logging with security best practices.

```javascript
import { LoggingPlugin } from 'json-rest-api/plugins/logging.js';

api.use(LoggingPlugin, {
  level: 'info', // 'error', 'warn', 'info', 'debug'
  format: 'json', // 'json' or 'pretty'
  includeRequest: true,
  includeResponse: true,
  includeTiming: true,
  sensitiveFields: ['password', 'token', 'secret', 'authorization'],
  logger: console, // Can be replaced with winston, bunyan, etc.
  auditLog: true // Enable audit logging for create/update/delete
});
```

**Features:**
- Structured JSON logging
- Request/response logging
- SQL query logging
- Performance timing
- Sensitive data redaction
- Audit logging for changes
- Custom logger support

**Log Methods:**
```javascript
api.log.error('Database error', { code: 'DB_001', details: error });
api.log.warn('Validation warning', { field: 'email' });
api.log.info('User login', { userId: user.id });
api.log.debug('Query executed', { sql, duration: 123 });
```

### OpenAPIPlugin

Generates OpenAPI 3.0 specification and serves Swagger UI.

```javascript
import { OpenAPIPlugin } from 'json-rest-api/plugins/openapi.js';

api.use(OpenAPIPlugin, {
  title: 'My API',
  version: '1.0.0',
  description: 'REST API with JSON:API specification',
  servers: [
    { url: 'http://localhost:3000/api' },
    { url: 'https://api.example.com' }
  ],
  contact: {
    name: 'API Support',
    email: 'support@example.com'
  },
  license: {
    name: 'MIT',
    url: 'https://opensource.org/licenses/MIT'
  }
});
```

**Endpoints:**
- `GET /openapi.json` - OpenAPI specification
- `GET /docs` - Swagger UI interface

**Features:**
- Auto-generates API documentation from schemas
- JSON:API compliant paths
- Security scheme definitions
- Request/response examples
- Interactive Swagger UI

### SecurityPlugin

Implements comprehensive security features.

```javascript
import { SecurityPlugin } from 'json-rest-api/plugins/security.js';

api.use(SecurityPlugin, {
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:']
    }
  },
  authentication: {
    type: 'bearer', // 'bearer', 'basic', 'apikey'
    header: 'Authorization',
    queryParam: 'api_key',
    required: true
  },
  publicRead: false,
  allowUnknownFilters: false,
  verifyToken: async (token, context) => {
    // Custom token verification
    return await verifyJWT(token);
  }
});
```

**Features:**
- Rate limiting per IP
- Security headers (CSP, X-Frame-Options, etc.)
- Authentication middleware
- Input sanitization
- SQL injection protection
- Request ID tracking
- XSS prevention

**Security Headers Added:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security`
- `Content-Security-Policy`
- `X-Request-ID`

### VersioningPlugin

Manages API versioning and resource version control.

```javascript
import { VersioningPlugin } from 'json-rest-api/plugins/versioning.js';

api.use(VersioningPlugin, {
  // API versioning
  apiVersion: '2.0.0',
  versionHeader: 'api-version',
  versionParam: 'v',
  strict: false, // Allow version mismatch
  
  // Resource versioning
  versionField: 'version',
  lastModifiedField: 'lastModified',
  modifiedByField: 'modifiedBy',
  optimisticLocking: true,
  trackHistory: true,
  historyTable: 'posts_history'
});
```

**Features:**
- API version negotiation
- Resource version tracking
- Optimistic locking
- Version history
- Version comparison/diffing
- Version restoration

**Methods:**
```javascript
// Compare versions
api.compareVersions('1.2.3', '1.2.4'); // returns -1

// Get version history
const history = await api.getVersionHistory('posts', postId);

// Restore specific version
await api.restoreVersion('posts', postId, 3);

// Diff between versions
const diff = await api.diffVersions('posts', postId, 3, 5);
```

**Optimistic Locking:**
```javascript
// Update with version check
await api.update('posts', postId, {
  title: 'New Title',
  version: 3 // Must match current version
});
// Throws 409 Conflict if version mismatch
```

### SQLPlugin

Generic SQL implementation that works with any database adapter.

```javascript
import { SQLPlugin } from 'json-rest-api/plugins/sql-generic.js';

// This plugin is automatically used when you install a database adapter
// No explicit configuration needed
api.use(SQLPlugin);
```

**Features:**
- Works with MySQLAdapter or AlaSQLAdapter
- Smart query building
- JSON field handling
- Array field searching
- Join support
- Automatic table creation
- Transaction support

**Database Adapters:**
- **MySQLAdapter**: Production MySQL/MariaDB support
- **AlaSQLAdapter**: In-memory SQL for development/testing

## Database Adapters

Database adapters provide the low-level implementation for storage plugins. They implement the `db.*` interface that plugins use.

### AlaSQLAdapter

Powers the MemoryPlugin with in-memory SQL database functionality.

```javascript
import { AlaSQLAdapter } from 'json-rest-api/plugins/adapters/alasql-adapter.js';

// Usually not used directly - MemoryPlugin handles this
const adapter = new AlaSQLAdapter();
api.use(adapter);
```

**Features:**
- Full SQL support via AlaSQL library
- In-memory storage (no persistence)
- Automatic table creation
- JSON field support
- Basic transaction simulation
- Perfect for testing and development

### MySQLAdapter

Powers the MySQLPlugin with production MySQL/MariaDB support.

```javascript
import { MySQLAdapter } from 'json-rest-api/plugins/adapters/mysql-adapter.js';

// Usually not used directly - MySQLPlugin handles this
const adapter = new MySQLAdapter({
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'myapp'
  }
});
api.use(adapter);
```

**Features:**
- Connection pooling
- Real transactions
- Prepared statements
- JSON column support
- Automatic schema sync
- Production-ready performance

**Adapter vs Plugin:**
- **Adapters** implement the database interface (`db.query`, `db.connect`, etc.)
- **Plugins** (MemoryPlugin, MySQLPlugin) use adapters and add convenience features
- **SQLPlugin** provides the common SQL logic that works with any adapter

### CQRSPlugin

Implements Command Query Responsibility Segregation (CQRS) pattern, separating reads and writes into different models, handlers, or even databases. Includes support for Event Sourcing, Projections, and Sagas.

```javascript
import { CQRSPlugin, Command, Query, Event } from 'json-rest-api';

api.use(CQRSPlugin, {
  eventStore: false,        // Enable event sourcing
  projections: false,       // Enable projections for read models
  sagas: false,            // Enable sagas for complex workflows
  separateDatabases: false, // Use different databases for read/write
  
  // Only if separateDatabases is true
  writeDatabase: {
    plugin: 'mysql',
    options: { /* connection options */ }
  },
  readDatabase: {
    plugin: 'memory',    // Can be different type
    options: { /* connection options */ }
  }
});
```

**Features:**

1. **Command/Query Separation** - Different handlers for reads and writes
2. **Event Sourcing** - Store all changes as events
3. **Projections** - Build optimized read models from events
4. **Sagas** - Orchestrate complex multi-step workflows
5. **Separate Databases** - Different datastores for read/write sides
6. **Auto-Generated Handlers** - CRUD operations as commands/queries

#### Command and Query Definition

##### Defining Commands (Writes)

```javascript
// Simple command handler
api.command('CreateOrder', async (command) => {
  const { customerId, items } = command.data;
  
  // Validation and business logic
  if (!items || items.length === 0) {
    throw new Error('Order must have items');
  }
  
  // Execute write operation
  const order = await api.resources.orders.create({
    customerId,
    items,
    total: calculateTotal(items),
    status: 'pending'
  });
  
  // Optionally emit domain events
  await api.emitDomainEvent(new Event('OrderPlaced', order, order.data.id));
  
  return order;
});

// Command handler with event sourcing
api.command('ShipOrder', async (command) => {
  const { orderId, carrier, trackingNumber } = command.data;
  
  // Load current state
  const order = await api.resources.orders.get(orderId);
  
  // Business rule validation
  if (order.data.attributes.status !== 'paid') {
    throw new Error('Can only ship paid orders');
  }
  
  // Update state
  const result = await api.resources.orders.update(orderId, {
    status: 'shipped',
    shippedAt: new Date(),
    carrier,
    trackingNumber
  });
  
  // Emit event for event store and projections
  await api.emitDomainEvent(new Event(
    'OrderShipped',
    { orderId, carrier, trackingNumber },
    orderId
  ));
  
  return result;
});
```

##### Defining Queries (Reads)

```javascript
// Simple query handler
api.query('GetOrdersByCustomer', async (query) => {
  const { customerId, status, limit = 10 } = query.criteria;
  
  const filter = { customerId };
  if (status) filter.status = status;
  
  return await api.resources.orders.query({
    filter,
    page: { size: limit },
    sort: [{ field: 'createdAt', direction: 'DESC' }]
  });
});

// Query with complex aggregation
api.query('GetCustomerStats', async (query) => {
  const { customerId, dateRange } = query.criteria;
  
  // Could query a read-optimized view or projection
  const orders = await api.resources.orders.query({
    filter: { 
      customerId,
      createdAt: { between: dateRange }
    }
  });
  
  // Calculate statistics
  const stats = {
    totalOrders: orders.data.length,
    totalSpent: orders.data.reduce((sum, order) => 
      sum + order.attributes.total, 0
    ),
    averageOrderValue: orders.data.length > 0 
      ? this.totalSpent / orders.data.length 
      : 0
  };
  
  return stats;
});
```

#### Executing Commands and Queries

```javascript
// Using Command class
const createCommand = new Command({
  customerId: '123',
  items: [
    { productId: 'abc', quantity: 2, price: 29.99 }
  ]
});
createCommand.constructor.name = 'CreateOrder';
const order = await api.execute(createCommand);

// Using Query class
const statsQuery = new Query({
  customerId: '123',
  dateRange: ['2024-01-01', '2024-12-31']
});
statsQuery.constructor.name = 'GetCustomerStats';
const stats = await api.execute(statsQuery);

// Alternative: Direct execution (when you have the handler name)
const result = await api._cqrs.commandBus.execute({
  constructor: { name: 'CreateOrder' },
  data: { customerId: '123', items: [...] }
});
```

#### Auto-Generated CRUD Commands and Queries

For each resource, the plugin automatically generates standard CRUD operations:

```javascript
// Commands (writes) - generated pattern: {Action}{Resource}
// These are automatically created when you use addResource()

// Create command
const createCmd = new Command({ name: 'John', email: 'john@example.com' });
createCmd.constructor.name = 'CreateUsers';
await api.execute(createCmd);

// Update command  
const updateCmd = new Command({ id: 123, data: { name: 'Jane' } });
updateCmd.constructor.name = 'UpdateUsers';
await api.execute(updateCmd);

// Delete command
const deleteCmd = new Command({ id: 123 });
deleteCmd.constructor.name = 'DeleteUsers';
await api.execute(deleteCmd);

// Queries (reads) - generated patterns
// Get by ID
const getQuery = new Query({ id: 123 });
getQuery.constructor.name = 'GetUsersById';
await api.execute(getQuery);

// List/search
const listQuery = new Query({ filter: { active: true }, page: { size: 20 } });
listQuery.constructor.name = 'ListUsers';
await api.execute(listQuery);
```

#### Event Sourcing

When `eventStore: true`, all domain events are stored and can be replayed:

```javascript
// Emit domain events
await api.emitDomainEvent(new Event(
  'ProductPriceChanged',      // Event type
  { oldPrice: 99, newPrice: 79, reason: 'Sale' },  // Event data
  productId                   // Aggregate ID
));

// Subscribe to domain events
api.onDomainEvent('ProductPriceChanged', async (event) => {
  console.log(`Price changed for product ${event.aggregateId}`);
  // Update search index, send notifications, etc.
});

// Subscribe to all events
api.onDomainEvent('*', async (event) => {
  console.log(`Event: ${event.type} on ${event.aggregateId}`);
});

// Access event store directly
const eventStore = api.getEventStore();

// Get all events for an aggregate
const events = await eventStore.getEvents(aggregateId, fromVersion);

// Get all events (for rebuilding projections)
const allEvents = await eventStore.getAllEvents(fromTimestamp);

// Save snapshot for performance
await eventStore.saveSnapshot(aggregateId, currentState, version);
const snapshot = await eventStore.getSnapshot(aggregateId);
```

#### Projections

Build read-optimized views from events:

```javascript
// Define a projection
const ordersByCustomerProjection = {
  // Which events this projection handles
  handles: ['OrderCreated', 'OrderCancelled'],
  
  // Internal state
  ordersByCustomer: new Map(),
  
  // Handle each event
  async handle(event) {
    switch (event.type) {
      case 'OrderCreated':
        const customerId = event.data.attributes.customerId;
        if (!this.ordersByCustomer.has(customerId)) {
          this.ordersByCustomer.set(customerId, []);
        }
        this.ordersByCustomer.get(customerId).push({
          orderId: event.aggregateId,
          total: event.data.attributes.total,
          createdAt: event.timestamp
        });
        break;
        
      case 'OrderCancelled':
        // Remove from projection
        for (const [customerId, orders] of this.ordersByCustomer) {
          const index = orders.findIndex(o => o.orderId === event.aggregateId);
          if (index >= 0) {
            orders.splice(index, 1);
            break;
          }
        }
        break;
    }
  },
  
  // Reset projection (for rebuilds)
  async reset() {
    this.ordersByCustomer.clear();
  },
  
  // Query methods
  getOrdersForCustomer(customerId) {
    return this.ordersByCustomer.get(customerId) || [];
  }
};

// Register projection
api.projection('ordersByCustomer', ordersByCustomerProjection);

// Rebuild projection from all events
await api._cqrs.projectionManager.rebuild('ordersByCustomer', eventStore);

// Use projection in queries
api.query('GetCustomerOrderHistory', async (query) => {
  const projection = api._cqrs.projectionManager.projections.get('ordersByCustomer');
  return projection.getOrdersForCustomer(query.criteria.customerId);
});
```

#### Sagas

Orchestrate complex business processes:

```javascript
// Define a saga
class OrderFulfillmentSaga {
  constructor() {
    this.state = {
      orderId: null,
      paymentId: null,
      shipmentId: null,
      status: 'started'
    };
  }
  
  // Events that start this saga
  get startsWith() {
    return ['OrderCreated'];
  }
  
  // All events this saga handles
  get handles() {
    return ['OrderCreated', 'PaymentProcessed', 'PaymentFailed', 
            'InventoryReserved', 'InventoryUnavailable', 'OrderShipped'];
  }
  
  // Handle events and orchestrate process
  async handle(event) {
    switch (event.type) {
      case 'OrderCreated':
        this.state.orderId = event.aggregateId;
        // Initiate payment
        const payment = await api.resources.payments.create({
          orderId: this.state.orderId,
          amount: event.data.attributes.total
        });
        this.state.paymentId = payment.data.id;
        break;
        
      case 'PaymentProcessed':
        // Reserve inventory
        await api.resources.inventory.reserve({
          orderId: this.state.orderId,
          items: this.state.items
        });
        break;
        
      case 'PaymentFailed':
        // Compensate - cancel order
        await api.resources.orders.update(this.state.orderId, {
          status: 'cancelled',
          reason: 'Payment failed'
        });
        this.state.status = 'failed';
        break;
        
      case 'InventoryReserved':
        // Create shipment
        const shipment = await api.resources.shipments.create({
          orderId: this.state.orderId
        });
        this.state.shipmentId = shipment.data.id;
        break;
        
      case 'OrderShipped':
        // Complete the saga
        await api.resources.orders.update(this.state.orderId, {
          status: 'completed'
        });
        this.state.status = 'completed';
        break;
    }
  }
  
  // Check if saga is complete
  isComplete() {
    return ['completed', 'failed'].includes(this.state.status);
  }
}

// Register saga
api.saga('OrderFulfillment', OrderFulfillmentSaga);
```

#### Separate Read/Write Databases

Use different databases optimized for their workload:

```javascript
api.use(CQRSPlugin, {
  separateDatabases: true,
  writeDatabase: {
    plugin: 'mysql',        // ACID compliant for writes
    options: {
      host: 'write-db.example.com',
      database: 'myapp_write'
    }
  },
  readDatabase: {
    plugin: 'memory',       // Fast in-memory for reads
    options: {}
  },
  eventStore: true         // Sync via events
});

// Commands automatically use write database
api.command('UpdateProduct', async (command) => {
  // This uses api._writeApi internally
  return await api._writeApi.resources.products.update(
    command.data.id,
    command.data.updates
  );
});

// Queries automatically use read database
api.query('SearchProducts', async (query) => {
  // This uses api._readApi internally
  return await api._readApi.resources.products.query({
    filter: query.criteria
  });
});

// Automatic synchronization via events
// When writeDatabase updates, events sync to readDatabase
```

#### Advanced Usage

##### Custom Event Store Implementation

```javascript
class MongoEventStore {
  constructor(mongoClient) {
    this.events = mongoClient.collection('events');
  }
  
  async append(event) {
    await this.events.insertOne(event);
    return event;
  }
  
  async getEvents(aggregateId, fromVersion = 0) {
    return await this.events
      .find({ aggregateId, version: { $gte: fromVersion } })
      .sort({ version: 1 })
      .toArray();
  }
}

// Replace default event store
api._cqrs.eventStore = new MongoEventStore(mongoClient);
```

##### Command Validation

```javascript
api.command('TransferMoney', async (command) => {
  const { fromAccount, toAccount, amount } = command.data;
  
  // Validate command
  if (amount <= 0) {
    throw new BadRequestError('Amount must be positive');
  }
  
  if (fromAccount === toAccount) {
    throw new BadRequestError('Cannot transfer to same account');
  }
  
  // Check business rules
  const source = await api.resources.accounts.get(fromAccount);
  if (source.data.attributes.balance < amount) {
    throw new BadRequestError('Insufficient funds');
  }
  
  // Execute in transaction if available
  await api.transaction(async (trx) => {
    await trx.resources.accounts.update(fromAccount, {
      balance: source.data.attributes.balance - amount
    });
    
    await trx.resources.accounts.update(toAccount, {
      balance: { increment: amount }  // If supported
    });
  });
  
  // Emit event
  await api.emitDomainEvent(new Event('MoneyTransferred', {
    fromAccount,
    toAccount,
    amount,
    timestamp: Date.now()
  }));
});
```

##### Testing CQRS Code

```javascript
// Test commands
describe('CreateOrder command', () => {
  it('should create order and emit event', async () => {
    const events = [];
    api.onDomainEvent('*', (event) => events.push(event));
    
    const command = new Command({
      customerId: '123',
      items: [{ productId: 'abc', quantity: 1 }]
    });
    command.constructor.name = 'CreateOrder';
    
    const result = await api.execute(command);
    
    expect(result.data.attributes.status).toBe('pending');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('OrderCreated');
  });
});

// Test projections
describe('OrderStats projection', () => {
  it('should calculate stats correctly', async () => {
    const projection = createOrderStatsProjection();
    
    await projection.handle(new Event('OrderCreated', {
      attributes: { total: 100, customerId: '123' }
    }));
    
    await projection.handle(new Event('OrderCreated', {
      attributes: { total: 200, customerId: '123' }
    }));
    
    const stats = projection.getCustomerStats('123');
    expect(stats.totalOrders).toBe(2);
    expect(stats.totalRevenue).toBe(300);
  });
});
```

#### CQRS Best Practices

1. **Keep Commands Task-Oriented**
   ```javascript
   // Good: Task-focused command
   api.command('ActivateUser', handler);
   
   // Bad: Generic CRUD command
   api.command('UpdateUser', handler);
   ```

2. **Make Commands Idempotent**
   ```javascript
   api.command('ProcessPayment', async (command) => {
     const { paymentId } = command.data;
     
     // Check if already processed
     const existing = await api.resources.payments.get(paymentId);
     if (existing.data.attributes.status === 'processed') {
       return existing;  // Idempotent
     }
     
     // Process payment...
   });
   ```

3. **Design Events for Replaying**
   ```javascript
   // Good: Complete event data
   new Event('OrderShipped', {
     orderId,
     shippedAt: Date.now(),
     carrier: 'FedEx',
     trackingNumber: '123456',
     items: [...],  // Include all relevant data
   });
   
   // Bad: Minimal event
   new Event('OrderShipped', { orderId });
   ```

4. **Use Projections for Complex Queries**
   ```javascript
   // Instead of complex joins, maintain a projection
   api.projection('productSalesRanking', {
     handles: ['OrderCreated'],
     rankings: new Map(),
     
     async handle(event) {
       // Update rankings based on order data
     },
     
     getTopProducts(limit = 10) {
       return Array.from(this.rankings.entries())
         .sort((a, b) => b[1] - a[1])
         .slice(0, limit);
     }
   });
   ```

5. **Handle Eventual Consistency**
   ```javascript
   api.query('GetOrder', async (query) => {
     const { orderId, consistency = 'eventual' } = query.criteria;
     
     if (consistency === 'strong') {
       // Query write database directly
       return await api._writeApi.resources.orders.get(orderId);
     } else {
       // Query read database (may be slightly out of date)
       return await api._readApi.resources.orders.get(orderId);
     }
   });
   ```

### ApiGatewayPlugin

```javascript
import { ApiGatewayPlugin } from 'json-rest-api/plugins/api-gateway';
```

Transforms JSON-REST-API into an API gateway/orchestrator. Instead of database-backed resources, create resources that call external APIs with built-in resilience, transformations, and saga orchestration.

#### Basic Usage

```javascript
// Enable API Gateway features
api.use(ApiGatewayPlugin, {
  enableSagas: true,      // Enable saga orchestration
  enableMetrics: true,    // Track API performance
  defaultTimeout: 30000,  // 30 second timeout
  defaultRetries: 3       // Retry failed requests
});

// Add an API-backed resource
api.addApiResource('users', {
  baseUrl: 'https://api.userservice.com',
  auth: { type: 'bearer', token: process.env.USER_API_TOKEN },
  endpoints: {
    get: { path: '/users/:id' },
    list: { path: '/users' },
    create: { path: '/users', method: 'POST' },
    update: { path: '/users/:id', method: 'PUT' },
    delete: { path: '/users/:id', method: 'DELETE' }
  }
});

// Use it like a normal resource
const user = await api.resources.users.get(123);
const users = await api.resources.users.query({ active: true });
```

#### Features

1. **External API Integration** - Call any REST API as a resource
2. **Request/Response Transformation** - Adapt any API format
3. **Circuit Breakers** - Protect against cascading failures
4. **Automatic Retries** - Handle transient failures
5. **Saga Orchestration** - Coordinate multi-service transactions
6. **Health Monitoring** - Track API status and performance

#### API Resource Configuration

##### Authentication Types

```javascript
// Bearer token
api.addApiResource('github', {
  baseUrl: 'https://api.github.com',
  auth: { type: 'bearer', token: process.env.GITHUB_TOKEN }
});

// API Key
api.addApiResource('weather', {
  baseUrl: 'https://api.weather.com',
  auth: { 
    type: 'apiKey',
    header: 'X-API-Key',
    key: process.env.WEATHER_KEY
  }
});

// Basic Auth
api.addApiResource('legacy', {
  baseUrl: 'https://old.system.com',
  auth: {
    type: 'basic',
    username: process.env.LEGACY_USER,
    password: process.env.LEGACY_PASS
  }
});
```

##### Request/Response Transformations

```javascript
api.addApiResource('payments', {
  baseUrl: 'https://api.stripe.com/v1',
  auth: { type: 'bearer', token: process.env.STRIPE_KEY },
  
  transformers: {
    charge: {
      // Transform outgoing request
      request: (data) => ({
        amount: Math.round(data.amount * 100), // Convert to cents
        currency: data.currency || 'usd',
        source: data.token,
        metadata: { orderId: data.orderId }
      }),
      
      // Transform incoming response
      response: (stripeData) => ({
        id: stripeData.id,
        amount: stripeData.amount / 100, // Convert back
        status: stripeData.status,
        created: new Date(stripeData.created * 1000)
      })
    }
  },
  
  endpoints: {
    charge: { path: '/charges', method: 'POST' },
    refund: { path: '/refunds', method: 'POST' }
  }
});

// Use transformed API
const payment = await api.resources.payments.charge({
  amount: 99.99,  // Dollars, will be converted to cents
  token: 'tok_visa',
  orderId: 'ORD-123'
});
```

##### Circuit Breaker Configuration

```javascript
api.addApiResource('flaky-service', {
  baseUrl: 'https://unreliable.api.com',
  
  // Circuit breaker settings
  circuitBreaker: {
    failureThreshold: 5,      // Open after 5 failures
    resetTimeout: 60000,      // Try again after 1 minute
    monitoringPeriod: 10000   // Within 10 second window
  },
  
  timeout: 5000,              // 5 second timeout
  retries: 2,                 // Retry twice on failure
  retryDelay: 1000           // 1 second between retries
});

// Circuit breaker states:
// CLOSED: Normal operation
// OPEN: Rejecting all requests (fail fast)
// HALF_OPEN: Testing if service recovered
```

#### Saga Orchestration

Sagas coordinate complex workflows across multiple services with automatic rollback on failure:

```javascript
api.saga('CheckoutSaga', {
  startsWith: 'CheckoutStarted',  // Triggering event
  
  async handle(event, { executeStep, compensate, emit }) {
    const { orderId, customerId, items, paymentToken } = event.data;
    
    try {
      // Step 1: Reserve inventory
      const reservation = await executeStep('reserveInventory', 
        // Action
        async () => {
          return await api.resources.inventory.reserve({
            items,
            orderId
          });
        },
        // Compensation (rollback)
        async () => {
          await api.resources.inventory.cancel(reservation.id);
        }
      );
      
      // Step 2: Process payment
      const payment = await executeStep('processPayment',
        async () => {
          return await api.resources.payments.charge({
            amount: calculateTotal(items),
            token: paymentToken,
            orderId
          });
        },
        async () => {
          await api.resources.payments.refund(payment.id);
        }
      );
      
      // Step 3: Create shipment
      const shipment = await executeStep('createShipment',
        async () => {
          return await api.resources.shipping.create({
            orderId,
            items
          });
        },
        async () => {
          await api.resources.shipping.cancel(shipment.id);
        }
      );
      
      // Success - confirm everything
      await api.resources.inventory.confirm(reservation.id);
      await emit('CheckoutCompleted', { orderId });
      
    } catch (error) {
      // Automatic rollback of completed steps
      await compensate();
      await emit('CheckoutFailed', { orderId, error: error.message });
    }
  }
});

// Trigger the saga
await api.emitEvent('CheckoutStarted', {
  orderId: 'ORD-123',
  customerId: 'CUST-456',
  items: [{ sku: 'WIDGET-1', quantity: 2 }],
  paymentToken: 'tok_visa'
});
```

#### Health Monitoring

```javascript
// Get API health status
const health = api.getApiHealth();

console.log(health);
// {
//   users: {
//     url: 'https://api.users.com',
//     circuit: { state: 'CLOSED', failures: 0 },
//     metrics: {
//       requests: 1543,
//       errors: 12,
//       avgResponseTime: 234
//     }
//   },
//   payments: {
//     url: 'https://api.stripe.com',
//     circuit: { state: 'OPEN', failures: 5 },
//     metrics: {
//       requests: 89,
//       errors: 5,
//       avgResponseTime: 567
//     }
//   },
//   sagas: {
//     active: [
//       { id: 'abc123', name: 'CheckoutSaga', state: 'RUNNING' }
//     ]
//   }
// }
```

#### Batch Operations

```javascript
// Execute multiple API calls
const results = await api.batchApiCalls([
  { resource: 'users', method: 'get', data: 1 },
  { resource: 'orders', method: 'query', data: { userId: 1 } },
  { resource: 'reviews', method: 'query', data: { userId: 1 } }
]);

// With transaction semantics (rollback on failure)
const results = await api.batchApiCalls([
  { resource: 'users', method: 'create', data: userData },
  { resource: 'accounts', method: 'create', data: accountData },
  { resource: 'profile', method: 'create', data: profileData }
], { transactional: true });
```

#### Custom Methods

```javascript
api.addApiResource('orders', {
  baseUrl: 'https://api.orders.com',
  endpoints: {
    // Standard CRUD
    get: { path: '/orders/:id' },
    create: { path: '/orders', method: 'POST' },
    
    // Custom methods
    ship: { path: '/orders/:id/ship', method: 'POST' },
    cancel: { path: '/orders/:id/cancel', method: 'POST' },
    getInvoice: { path: '/orders/:id/invoice' }
  },
  methods: {
    ship: { path: '/orders/:id/ship', method: 'POST' },
    cancel: { path: '/orders/:id/cancel', method: 'POST' },
    getInvoice: { path: '/orders/:id/invoice' }
  }
});

// Use custom methods
await api.resources.orders.ship({ id: orderId, carrier: 'ups' });
const invoice = await api.resources.orders.getInvoice({ id: orderId });
```

#### Advanced Configuration

```javascript
// Configure API after creation
api.configureApi('payments', {
  // Add or update transformers
  transformers: {
    list: {
      request: (params) => ({
        limit: params.pageSize || 10,
        starting_after: params.cursor
      }),
      response: (data) => ({
        items: data.data,
        hasMore: data.has_more,
        nextCursor: data.data[data.data.length - 1]?.id
      })
    }
  },
  
  // Add custom headers
  headers: {
    'X-Custom-Header': 'value'
  }
});
```

#### API Gateway Best Practices

1. **Use Environment Variables for Configuration**
   ```javascript
   api.addApiResource('service', {
     baseUrl: process.env.SERVICE_URL,
     auth: { type: 'bearer', token: process.env.SERVICE_TOKEN }
   });
   ```

2. **Implement Proper Error Handling**
   ```javascript
   try {
     const result = await api.resources.payments.charge(data);
   } catch (error) {
     if (error.status === 402) {
       // Payment failed
       await handlePaymentFailure(error);
     } else if (error.code === 'ETIMEDOUT') {
       // Timeout - maybe retry later
       await queueForRetry(data);
     } else {
       // Unknown error
       throw error;
     }
   }
   ```

3. **Monitor Circuit Breaker States**
   ```javascript
   setInterval(() => {
     const health = api.getApiHealth();
     
     for (const [service, status] of Object.entries(health)) {
       if (status.circuit.state === 'OPEN') {
         alertOps(`Circuit breaker OPEN for ${service}`);
       }
     }
   }, 30000); // Check every 30 seconds
   ```

4. **Use Sagas for Complex Workflows**
   ```javascript
   // Don't manually orchestrate
   // Use sagas for automatic rollback and state management
   api.saga('ComplexWorkflow', {
     async handle(event, { executeStep, compensate }) {
       // Saga handles failures and rollbacks automatically
     }
   });
   ```

5. **Transform APIs to Your Domain**
   ```javascript
   // Transform external API responses to match your domain model
   transformers: {
     get: {
       response: (externalUser) => ({
         id: externalUser.user_id,
         name: externalUser.full_name,
         email: externalUser.email_address,
         // Map to your expected format
       })
     }
   }
   ```

## Plugin Compatibility Matrix

### Storage Plugin Compatibility

| Plugin | MemoryPlugin | MySQLPlugin | Notes |
|--------|--------------|-------------|-------|
| **ValidationPlugin** | ✅ | ✅ | Always included automatically |
| **TimestampsPlugin** | ✅ | ✅ | Works with all storage backends |
| **HTTPPlugin** | ✅ | ✅ | Must be added last |
| **PositioningPlugin** | ✅ | ✅ | MySQL supports transactions for atomic operations |
| **CorsPlugin** | ✅ | ✅ | Works independently of storage |
| **JwtPlugin** | ✅ | ✅ | Works independently of storage |
| **AuthorizationPlugin** | ✅ | ✅ | Works with any storage backend |
| **ViewsPlugin** | ✅ | ✅ | Works with any storage backend |
| **QueryLimitsPlugin** | ✅ | ✅ | Works with any storage backend |
| **LoggingPlugin** | ✅ | ✅ | Logs SQL queries for both backends |
| **OpenAPIPlugin** | ✅ | ✅ | Generates docs for any backend |
| **SecurityPlugin** | ✅ | ✅ | Works independently of storage |
| **VersioningPlugin** | ✅ | ✅ | History tables work with both |
| **SQLPlugin** | ✅ | ✅ | Required for both SQL backends |
| **SimplifiedRecordsPlugin** | ✅ | ✅ | Works with any storage backend |
| **MicroservicesPlugin** | ✅ | ✅ | Works independently of storage |
| **CQRSPlugin** | ✅ | ✅ | Can use separate databases for read/write |
| **ApiGatewayPlugin** | ✅ | ✅ | Works independently of storage |

### Plugin Order Dependencies

| Plugin | Must Come After | Must Come Before | Notes |
|--------|-----------------|------------------|-------|
| **Storage Plugins** | - | All others | Foundation for everything |
| **ValidationPlugin** | Storage | - | Auto-included with storage |
| **TimestampsPlugin** | Storage | HTTPPlugin | Modifies data before HTTP |
| **PositioningPlugin** | Storage | HTTPPlugin | Modifies data before HTTP |
| **VersioningPlugin** | Storage, Timestamps | HTTPPlugin | Tracks after timestamps |
| **AuthorizationPlugin** | Storage, JWT | HTTPPlugin | Needs auth before HTTP |
| **ViewsPlugin** | Storage | HTTPPlugin | Filters data before response |
| **QueryLimitsPlugin** | Storage | HTTPPlugin | Validates before execution |
| **LoggingPlugin** | All data plugins | HTTPPlugin | Logs all operations |
| **HTTPPlugin** | All others | - | Must be last |
| **CorsPlugin** | - | HTTPPlugin | Can be anywhere before HTTP |
| **JwtPlugin** | - | Authorization, HTTP | Provides auth for other plugins |
| **SecurityPlugin** | - | HTTPPlugin | Can be anywhere before HTTP |
| **SimplifiedRecordsPlugin** | Storage | - | Transforms responses |
| **OpenAPIPlugin** | All others | - | Documents final API |
| **MicroservicesPlugin** | Storage | HTTPPlugin | Can be used anywhere |
| **CQRSPlugin** | Storage | HTTPPlugin | Should be early to intercept operations |
| **ApiGatewayPlugin** | - | HTTPPlugin | Independent of storage, before HTTP |

### Feature Compatibility

| Feature | Memory | MySQL | Notes |
|---------|---------|--------|-------|
| **Transactions** | ❌ | ✅ | MySQL supports ACID transactions |
| **Concurrent Writes** | ⚠️ | ✅ | Memory may have race conditions |
| **Large Datasets** | ❌ | ✅ | Memory limited by RAM |
| **Persistence** | ❌ | ✅ | Memory data lost on restart |
| **Complex Joins** | ✅ | ✅ | Both support SQL joins |
| **JSON Fields** | ✅ | ✅ | Both support JSON data types |
| **Full-text Search** | ❌ | ✅ | MySQL has FULLTEXT indexes |
| **Atomic Positioning** | ❌ | ✅ | MySQL uses transactions |
| **Prepared Statements** | ⚠️ | ✅ | Memory has basic support |
| **Connection Pooling** | N/A | ✅ | MySQL supports multiple connections |

### Recommended Plugin Combinations

**Development/Testing:**
```javascript
api
  .use(MemoryPlugin)         // Fast in-memory storage
  .use(TimestampsPlugin)     // Track creation/updates
  .use(LoggingPlugin)        // Debug queries
  .use(HTTPPlugin);          // REST endpoints
```

**Production API:**
```javascript
api
  .use(MySQLPlugin, { connection })  // Production database
  .use(TimestampsPlugin)             // Track changes
  .use(VersioningPlugin)             // Version control
  .use(JwtPlugin, { secret })        // Authentication
  .use(AuthorizationPlugin)          // Access control
  .use(QueryLimitsPlugin)            // Prevent abuse
  .use(SecurityPlugin)               // Security headers
  .use(LoggingPlugin)                // Audit trail
  .use(HTTPPlugin);                  // REST endpoints
```

**Public API:**
```javascript
api
  .use(MySQLPlugin, { connection })
  .use(CorsPlugin)                   // Cross-origin access
  .use(QueryLimitsPlugin)            // Rate limiting
  .use(ViewsPlugin)                  // Field filtering
  .use(OpenAPIPlugin)                // API documentation
  .use(HTTPPlugin);                  // REST endpoints
```

## Type Definitions

### Query Parameters

```typescript
interface QueryParams {
  filter?: Record<string, any>;
  sort?: Array<{ field: string; direction: 'ASC' | 'DESC' }>;
  page?: {
    size?: number;
    number?: number;
  };
  fields?: Record<string, string[]>;
  include?: string;
  joins?: boolean | string[];
  excludeJoins?: string[];
}
```

### Filter Operators

The `filter` parameter supports advanced operators for complex queries:

```typescript
// Basic equality
filter: { status: 'active' }

// Operator syntax
filter: {
  field: {
    operator: value
  }
}
```

#### Available Operators

| Operator | Description | Example | SQL Equivalent |
|----------|-------------|---------|----------------|
| (none) | Equals | `{ status: 'active' }` | `WHERE status = 'active'` |
| `eq` | Equals | `{ age: { eq: 25 } }` | `WHERE age = 25` |
| `ne` | Not equals | `{ status: { ne: 'deleted' } }` | `WHERE status != 'deleted'` |
| `gt` | Greater than | `{ price: { gt: 100 } }` | `WHERE price > 100` |
| `gte` | Greater than or equal | `{ age: { gte: 18 } }` | `WHERE age >= 18` |
| `lt` | Less than | `{ stock: { lt: 10 } }` | `WHERE stock < 10` |
| `lte` | Less than or equal | `{ price: { lte: 99.99 } }` | `WHERE price <= 99.99` |
| `in` | In array | `{ status: { in: ['active', 'pending'] } }` | `WHERE status IN ('active', 'pending')` |
| `nin` | Not in array | `{ role: { nin: ['admin', 'root'] } }` | `WHERE role NOT IN ('admin', 'root')` |
| `like` | SQL LIKE | `{ name: { like: '%john%' } }` | `WHERE name LIKE '%john%'` |
| `ilike` | Case-insensitive LIKE | `{ email: { ilike: '%@GMAIL.COM' } }` | `WHERE LOWER(email) LIKE LOWER('%@GMAIL.COM')` |
| `contains` | Contains substring | `{ bio: { contains: 'developer' } }` | `WHERE bio LIKE '%developer%'` |
| `icontains` | Case-insensitive contains | `{ bio: { icontains: 'DEVELOPER' } }` | `WHERE LOWER(bio) LIKE LOWER('%DEVELOPER%')` |
| `startsWith` | Starts with | `{ name: { startsWith: 'Dr.' } }` | `WHERE name LIKE 'Dr.%'` |
| `endsWith` | Ends with | `{ email: { endsWith: '@company.com' } }` | `WHERE email LIKE '%@company.com'` |
| `null` | Is null | `{ deletedAt: { null: true } }` | `WHERE deletedAt IS NULL` |
| `notnull` | Is not null | `{ category: { notnull: true } }` | `WHERE category IS NOT NULL` |
| `between` | Between two values | `{ age: { between: [18, 65] } }` | `WHERE age BETWEEN 18 AND 65` |

**Notes:**
- Multiple operators can be used on the same field: `{ age: { gte: 18, lt: 65 } }`
- The `ilike` and `icontains` operators use `LOWER()` for databases without native case-insensitive support
- For array fields, `in` and `nin` check if the array contains any of the specified values
- The `between` operator requires an array with exactly 2 values
- In memory storage (AlaSQL), undefined fields also match `{ null: true }` queries

### Schema Field Definition

```typescript
interface FieldDefinition {
  type: 'id' | 'string' | 'number' | 'boolean' | 'timestamp' | 'json' | 'array' | 'object';
  required?: boolean;
  default?: any;
  min?: number;
  max?: number;
  unique?: boolean;
  silent?: boolean;
  refs?: {
    resource: string;
    join?: {
      eager?: boolean;
      type?: 'left' | 'inner';
      fields?: string[];
      excludeFields?: string[];
      includeSilent?: boolean;
      resourceField?: string;
      preserveId?: boolean;
      runHooks?: boolean;
      hookContext?: string;
    };
  };
}
```

### API Response Format

```typescript
// Single resource
interface ResourceResponse {
  data: {
    type: string;
    id: string;
    attributes: Record<string, any>;
    relationships?: Record<string, {
      data: { type: string; id: string } | Array<{ type: string; id: string }>;
    }>;
  };
  included?: Array<{
    type: string;
    id: string;
    attributes: Record<string, any>;
  }>;
}

// Multiple resources
interface CollectionResponse {
  data: Array<ResourceResponse['data']>;
  included?: ResourceResponse['included'];
  meta?: {
    total: number;
    pageSize: number;
    pageNumber: number;
    totalPages: number;
  };
  links?: {
    self: string;
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
}
```

### Hook Priority

| Priority | Usage |
|----------|-------|
| 0-20 | Early hooks (setup, initialization) |
| 30-40 | Validation, permission checks |
| 50 | Default priority |
| 60-70 | Business logic |
| 80-90 | Late hooks (cleanup, logging) |
| 95-100 | Final processing |

Lower numbers execute first.