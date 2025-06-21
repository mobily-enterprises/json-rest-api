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