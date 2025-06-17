# JSON REST API - Complete API Reference

This document provides a complete reference for every class, method, and option in the JSON REST API library.

## Key Concepts: API Instance Management

### When to Create New vs Share Instances

**Create NEW instance (with `createApi()` or `new Api()`):**
- Simple APIs where everything is in one file
- Standalone services that don't interact
- Different API versions (each version gets its own instance)

**Share EXISTING instance (with `Api.get()` or `defineResource()`):**
- Resources split across multiple files
- Resources that need to interact (e.g., users querying products)
- Resources sharing the same database connection
- Resources in the same API version

### Example Patterns

```javascript
// Simple API (one file) - CREATE new instance
const api = createApi({ storage: 'memory' });
api.addResource('users', userSchema);
api.addResource('products', productSchema);

// Modular API (multiple files) - SHARE instance
// api/1.0.0/users.js
const api = Api.find('myapp', '1.0.0') || new Api({ name: 'myapp', version: '1.0.0' });
api.addResource('users', userSchema);
export default api;

// api/1.0.0/products.js  
const api = Api.find('myapp', '1.0.0');  // Gets SAME instance!
api.addResource('products', productSchema);
export default api;
```

## Table of Contents

1. [Core Classes](#core-classes)
   - [Api Class](#api-class)
   - [Schema Class](#schema-class)
2. [Plugin Reference](#plugin-reference)
   - [ValidationPlugin](#validationplugin)
   - [MemoryPlugin](#memoryplugin)
   - [MySQLPlugin](#mysqlplugin)
   - [HTTPPlugin](#httpplugin)
   - [PositioningPlugin](#positioningplugin)
   - [VersioningPlugin](#versioningplugin)
   - [SecurityPlugin](#securityplugin)
   - [LoggingPlugin](#loggingplugin)
   - [OpenAPIPlugin](#openapiplugin)
3. [Helper Functions](#helper-functions)
4. [Type Definitions](#type-definitions)

---

# Core Classes

## Api Class

The main class for creating and managing JSON REST APIs.

### Constructor

```javascript
new Api(options)
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idProperty` | string | `'id'` | The field name used as the primary identifier |
| `name` | string | `null` | API name for versioning registry |
| `version` | string | `null` | API version (e.g., '1.0.0') |
| `artificialDelay` | number | `0` | Milliseconds to delay operations (for testing) |

**Example:**
```javascript
const api = new Api({
  idProperty: 'id',
  name: 'myapp',
  version: '1.0.0'
});
```

### Methods

#### `use(plugin, options)`
Add a plugin to the API.

**Parameters:**
- `plugin` (Object): Plugin object with `install` method
- `options` (Object): Plugin-specific options

**Returns:** `this` (for chaining)

**Example:**
```javascript
api.use(MySQLPlugin, { connection: dbConfig })
   .use(HTTPPlugin, { basePath: '/api' });
```

#### `hook(name, handler, priority)`
Register a hook handler.

**Parameters:**
- `name` (string): Hook name
- `handler` (async function): Hook handler function
- `priority` (number): Execution priority (lower = earlier, default: 50)

**Available Hooks:**
- `beforeValidate`: Before data validation
- `afterValidate`: After validation, before operation
- `beforeGet`: Before fetching single resource
- `afterGet`: After fetching single resource
- `beforeQuery`: Before querying resources
- `afterQuery`: After querying resources
- `beforeInsert`: Before inserting resource
- `afterInsert`: After inserting resource
- `beforeUpdate`: Before updating resource
- `afterUpdate`: After updating resource
- `beforeDelete`: Before deleting resource
- `afterDelete`: After deleting resource
- `beforeSend`: Before sending response (HTTP)
- `transformResult`: Transform results before returning

**Hook Context Object:**
```javascript
{
  method: 'insert',     // Current operation
  id: '123',           // Resource ID (for get/update/delete)
  data: {...},         // Request data
  params: {...},       // Query parameters
  options: {...},      // Operation options
  result: {...},       // Operation result
  results: [...],      // Query results
  errors: [...],       // Validation errors
  meta: {...}          // Metadata
}
```

**Example:**
```javascript
api.hook('beforeInsert', async (context) => {
  context.data.createdAt = Date.now();
});
```

#### `get(id, options)`
Fetch a single resource by ID.

**Parameters:**
- `id` (string|number): Resource identifier
- `options` (Object): Operation options

**Options:**
| Option | Type | Description |
|--------|------|-------------|
| `type` | string | Resource type (required) |
| `table` | string | Database table (MySQL) |
| `connection` | string | Database connection name |
| `fields` | string[] | Fields to return |
| `userId` | any | User ID for audit |
| `request` | Object | HTTP request object |

**Returns:** Promise<{ data: Resource }>

**Note:** Direct use of this method is discouraged. Use `api.resources.{type}.get()` instead.

**Example:**
```javascript
// Not recommended
const result = await api.get('123', { type: 'users' });

// Recommended
const result = await api.resources.users.get('123');
// { data: { id: '123', type: 'users', attributes: {...} } }
```

#### `query(params, options)`
Query multiple resources.

**Parameters:**
- `params` (Object): Query parameters
- `options` (Object): Operation options

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `filter` | Object | Field filters |
| `sort` | string | Sort order (e.g., '-createdAt,name') |
| `page.size` | number | Page size |
| `page.number` | number | Page number |
| `search` | string | Search term |
| `include` | string | Related resources to include |

**Returns:** Promise<{ data: Resource[], meta: Object, links: Object }>

**Note:** Direct use of this method is discouraged. Use `api.resources.{type}.query()` instead.

**Example:**
```javascript
// Not recommended
const result = await api.query({
  filter: { active: true }
}, { type: 'users' });

// Recommended
const result = await api.resources.users.query({
  filter: { active: true },
  sort: '-createdAt',
  page: { size: 10, number: 1 }
});
```

#### `insert(data, options)`
Create a new resource.

**Parameters:**
- `data` (Object): Resource data
- `options` (Object): Operation options

**Additional Options:**
| Option | Type | Description |
|--------|------|-------------|
| `positioning` | Object | Positioning options |
| `skipValidation` | boolean | Skip validation |
| `fullRecord` | boolean | Validate as complete record (require all required fields) |
| `validateFullRecord` | boolean | Fetch and merge with existing record before validation |

**Returns:** Promise<{ data: Resource }>

**Note:** Direct use of this method is discouraged. Use `api.resources.{type}.create()` instead.

**Example:**
```javascript
// Not recommended
const result = await api.insert({
  name: 'John Doe'
}, { type: 'users' });

// Recommended
const result = await api.resources.users.create({
  name: 'John Doe',
  email: 'john@example.com'
});
```

#### `update(id, data, options)`
Update an existing resource.

**Parameters:**
- `id` (string|number): Resource identifier
- `data` (Object): Update data
- `options` (Object): Operation options

**Update-specific Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fullRecord` | boolean | false | Validate as complete record (PUT behavior) |
| `validateFullRecord` | boolean | false | Merge with existing data before validation |

**Returns:** Promise<{ data: Resource }>

**Validation Behavior:**
- Default (PATCH): Only validates provided fields
- `fullRecord: true` (PUT): Validates as complete record, requires all required fields
- `validateFullRecord: true`: Fetches existing record and merges before validation

**Note:** Direct use of this method is discouraged. Use `api.resources.{type}.update()` instead.

**Example:**
```javascript
// Not recommended
const result = await api.update('123', {
  name: 'Jane Doe'
}, { type: 'users' });

// Recommended  
const result = await api.resources.users.update('123', {
  name: 'Jane Doe'
});
```

#### `delete(id, options)`
Delete a resource.

**Parameters:**
- `id` (string|number): Resource identifier
- `options` (Object): Operation options

**Returns:** Promise<{ data: null }>

**Note:** Direct use of this method is discouraged. Use `api.resources.{type}.delete()` instead.

**Example:**
```javascript
// Not recommended
await api.delete('123', { type: 'users' });

// Recommended
await api.resources.users.delete('123');
```

#### `addResource(type, schema, hooks?)`
Register a resource type with its schema and optional hooks.

**Parameters:**
- `type` (string): Resource type name
- `schema` (Schema): Schema instance
- `hooks` (object, optional): Hook functions for this resource

**Example:**
```javascript
const userHooks = {
  async afterValidate(context) {
    // Custom validation
  },
  async transformResult(context) {
    // Transform output
  }
};

api.addResource('users', userSchema, userHooks);
```

**Available hooks:**
- `beforeValidate` - Before schema validation
- `afterValidate` - After schema validation
- `beforeGet` - Before fetching single record
- `afterGet` - After fetching single record
- `beforeQuery` - Before querying records
- `afterQuery` - After querying records
- `beforeInsert` - Before inserting
- `afterInsert` - After inserting
- `beforeUpdate` - Before updating
- `afterUpdate` - After updating
- `beforeDelete` - Before deleting
- `afterDelete` - After deleting
- `transformResult` - Transform results before sending

#### `resource(type)`
Alternative method to access a resource.

**Parameters:**
- `type` (string): Resource type name

**Returns:** Resource proxy object

**Example:**
```javascript
// Useful when resource name is dynamic
const resourceName = getUserResourceName();
const data = await api.resource(resourceName).get(123);
```

### Resource Proxy Methods

Each resource accessible via `api.resources.{name}` has the following methods:

#### Resource CRUD Methods

##### `get(id, options)`
Fetch a single resource.

```javascript
const user = await api.resources.users.get(123);
```

##### `query(params, options)`
Query multiple resources.

```javascript
const users = await api.resources.users.query({
  filter: { active: true },
  sort: '-createdAt'
});
```

##### `create(data, options)` / `post(data, options)`
Create a new resource.

```javascript
const user = await api.resources.users.create({
  name: 'John Doe',
  email: 'john@example.com'
});
```

##### `update(id, data, options)` / `put(id, data, options)`
Update an existing resource.

```javascript
const updated = await api.resources.users.update(123, {
  email: 'newemail@example.com'
});
```

##### `delete(id, options)` / `remove(id, options)`
Delete a resource.

```javascript
await api.resources.users.delete(123);
```

#### Resource Versioning

##### `version(versionSpec)`
Access a specific version of the resource.

```javascript
// Access version 1.0.0 of users
const userV1 = await api.resources.users.version('1.0.0').get(123);

// Access latest 2.x version
const userV2 = await api.resources.users.version('^2.0.0').get(123);
```

#### Batch Operations

##### `batch.create(items, options)`
Create multiple resources.

```javascript
const users = await api.resources.users.batch.create([
  { name: 'User 1' },
  { name: 'User 2' }
]);
```

##### `batch.update(updates, options)`
Update multiple resources.

```javascript
await api.resources.users.batch.update([
  { id: 1, data: { active: false } },
  { id: 2, data: { active: false } }
]);
```

##### `batch.delete(ids, options)`
Delete multiple resources.

```javascript
await api.resources.users.batch.delete([1, 2, 3]);
```

#### Resource Properties

##### `schema`
Access the resource's schema.

```javascript
const userSchema = api.resources.users.schema;
```

##### `hooks`
Access the resource's hooks.

```javascript
const userHooks = api.resources.users.hooks;
```

#### `getSchema(type)`
Get the schema for a resource type.

**Parameters:**
- `type` (string): Resource type name

**Returns:** Schema instance or undefined

#### `mount(app, basePath)`
Mount HTTP routes on Express app (requires HTTPPlugin).

**Parameters:**
- `app` (Express app): Express application
- `basePath` (string): Base path for routes (default: '/api')

**Example:**
```javascript
api.mount(app, '/api/v1');
```

### Static Methods

#### `Api.get(name, version)` / `Api.find(name, version)`
Get a registered API by name and version. Both methods are identical.

**Parameters:**
- `name` (string): API name
- `version` (string): Version specifier ('latest', '1.0.0', '>=1.0.0', etc.)

**Returns:** Api instance or null

**Example:**
```javascript
// Using Api.get
const api = Api.get('myapp', 'latest');
const apiV1 = Api.get('myapp', '1.0.0');

// Using Api.find (preferred for clarity)
const api = Api.find('myapp', 'latest');
const apiV2Plus = Api.find('myapp', '>=2.0.0');
```

#### `Api.getRegistry()`
Get all registered APIs.

**Returns:** Object with API names and versions

**Example:**
```javascript
const registry = Api.getRegistry();
// { myapp: ['2.1.0', '2.0.0', '1.0.0'], otherapp: ['1.0.0'] }
```

### Static Properties

#### `Api.registry`
Enhanced registry access with helper methods.

**Methods:**
- `Api.registry.get(name, version)` - Same as Api.get()
- `Api.registry.find(name, version)` - Same as Api.find()
- `Api.registry.list()` - Get all registered APIs
- `Api.registry.has(name, version?)` - Check if API exists
- `Api.registry.versions(name)` - Get all versions of an API

**Example:**
```javascript
// Check if API exists
if (Api.registry.has('users', '2.0.0')) {
  const api = Api.registry.get('users', '2.0.0');
}

// Get all versions
const versions = Api.registry.versions('users');
// ['2.1.0', '2.0.0', '1.0.0']

// List all APIs
const allApis = Api.registry.list();
// { users: ['2.0.0', '1.0.0'], products: ['1.0.0'] }
```

---

## Schema Class

Defines data structure and validation rules.

### Constructor

```javascript
new Schema(structure, options)
```

**Parameters:**
- `structure` (Object): Field definitions
- `options` (Object): Schema options

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `emptyAsNull` | boolean | false | Convert empty strings to null |
| `canBeNull` | boolean | false | Allow null values by default |

### Field Definition

```javascript
{
  type: 'string',      // Required: field type
  required: false,     // Field is required
  default: null,       // Default value or function
  canBeNull: false,    // Can be null
  emptyAsNull: false,  // Empty string becomes null
  
  // Type-specific options
  min: 0,             // Minimum value/length
  max: 100,           // Maximum value/length
  pattern: /regex/,   // Regex pattern (strings)
  enum: ['a', 'b'],   // Allowed values
  
  // String options
  lowercase: false,   // Convert to lowercase
  uppercase: false,   // Convert to uppercase
  trim: 50,          // Trim to length
  noTrim: false,     // Don't trim whitespace
  
  // Validation
  validator: fn,      // Custom validator function
  notEmpty: false,    // Can't be empty string
  
  // Documentation
  description: '',    // Field description
  example: '',        // Example value
  
  // Special
  silent: false,      // Hide from responses
  searchable: false,  // Include in search
  unique: false       // Must be unique (custom)
}
```

### Methods

#### `use(plugin, options)`
Add a plugin to the schema.

**Parameters:**
- `plugin` (Object): Plugin with `install` method
- `options` (Object): Plugin options

**Returns:** `this`

#### `registerType(name, handler)`
Register a custom type handler.

**Parameters:**
- `name` (string): Type name
- `handler` (Function): Type handler function

**Handler Parameters:**
```javascript
{
  definition: {},      // Field definition
  value: any,         // Current value
  fieldName: string,  // Field name
  object: {},         // Full object
  options: {},        // Validation options
  computedOptions: {} // Computed options
}
```

**Example:**
```javascript
schema.registerType('phone', ({ value }) => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length !== 10) throw new Error('Invalid phone');
  return cleaned;
});
```

#### `registerParam(name, handler)`
Register a custom parameter handler.

**Parameters:**
- `name` (string): Parameter name
- `handler` (Function): Parameter handler function

**Example:**
```javascript
schema.registerParam('unique', async ({ value, fieldName }) => {
  const exists = await checkUnique(fieldName, value);
  if (exists) throw new Error(`${fieldName} must be unique`);
});
```

#### `validate(object, options)`
Validate an object against the schema.

**Parameters:**
- `object` (Object): Object to validate
- `options` (Object): Validation options

**Validation Options:**
| Option | Type | Description |
|--------|------|-------------|
| `onlyObjectValues` | boolean | Only validate provided fields |
| `skipFields` | string[] | Fields to skip |
| `skipParams` | Object | Parameters to skip by field |
| `emptyAsNull` | boolean | Convert empty to null |
| `canBeNull` | boolean | Allow null values |

**Returns:** Promise<{ validatedObject: Object, errors: Array }>

**Example:**
```javascript
const { validatedObject, errors } = await schema.validate({
  name: 'John',
  email: 'john@example.com'
});
```

#### `cleanup(object, parameterName)`
Get object with only fields having specific parameter.

**Parameters:**
- `object` (Object): Source object
- `parameterName` (string): Parameter to filter by

**Returns:** Filtered object

### Built-in Types

| Type | Description | Casts From | Default |
|------|-------------|------------|---------|
| `none` | No casting | - | - |
| `string` | String value | Any with toString() | `''` |
| `number` | Numeric value | Numeric strings | `0` |
| `boolean` | Boolean value | Strings, numbers | `false` |
| `id` | Integer ID | Numeric strings | - |
| `timestamp` | Unix timestamp | Date strings, numbers | - |
| `date` | Date (YYYY-MM-DD) | Date objects, strings | - |
| `dateTime` | DateTime | Date objects, strings | - |
| `array` | Array | Single values | `[]` |
| `object` | Object | Objects | `{}` |
| `serialize` | Circular JSON | Any | - |
| `blob` | Binary data | - | - |

---

# Plugin Reference

## ValidationPlugin

Automatically included. Provides schema validation for all operations.

### Installation
```javascript
api.use(ValidationPlugin);  // Usually automatic
```

### Features
- Validates data against registered schemas
- Supports custom validation hooks
- Provides detailed error messages
- Handles cross-field validation

### Hooks Added
- `beforeValidate`: Prepare data for validation
- `afterValidate`: Additional validation logic

### Methods Added
- `api.addResource(type, schema, hooks?)`: Register resource with schema and hooks
- `api.getSchema(type)`: Get schema
- `api.createSearchSchema(schema, fields)`: Create search schema

---

## MemoryPlugin

In-memory storage backend.

### Installation
```javascript
api.use(MemoryPlugin, {
  initialData: [],      // Initial data array
  initialIdCounter: 1   // Starting ID value
});
```

### Features
- Fast in-memory storage
- Full CRUD operations
- Filtering and sorting
- Pagination support
- Search functionality

### Storage Access
```javascript
api.memoryData  // Direct access to data array
api.memoryIdCounter  // Current ID counter
```

---

## MySQLPlugin

MySQL database storage backend.

### Installation
```javascript
api.use(MySQLPlugin, {
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'myapp',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  }
});

// Or multiple connections
api.use(MySQLPlugin, {
  connections: [
    {
      name: 'primary',
      config: { host: 'primary.db', ... }
    },
    {
      name: 'replica',
      config: { host: 'replica.db', ... }
    }
  ]
});
```

### Methods Added

#### `api.syncSchema(schema, table, options)`
Synchronize database table with schema.

**Parameters:**
- `schema` (Schema): Schema to sync
- `table` (string): Table name
- `options` (Object): Sync options

**Options:**
| Option | Type | Description |
|--------|------|-------------|
| `connection` | string | Connection name |
| `idProperty` | string | ID field name |

**Example:**
```javascript
await api.syncSchema(userSchema, 'users');
```

#### `api.getConnection(name)`
Get connection pool by name.

**Parameters:**
- `name` (string): Connection name (default: 'default')

**Returns:** { pool: MySQLPool, options: Object }

### Schema Sync Features
- Creates tables if not exists
- Adds new columns
- Updates column types
- Creates indexes for searchable fields
- Handles foreign key constraints

### Field Type Mapping

| Schema Type | MySQL Type | Notes |
|-------------|------------|-------|
| `id` | `INT AUTO_INCREMENT` | Primary key |
| `number` | `INT` | Or FLOAT, DECIMAL |
| `string` | `VARCHAR(n)` | Or TEXT |
| `boolean` | `BOOLEAN` | |
| `timestamp` | `BIGINT` | Unix timestamp |
| `date` | `DATE` | |
| `dateTime` | `DATETIME` | |
| `array` | `JSON` | |
| `object` | `JSON` | |
| `serialize` | `JSON` | |
| `blob` | `BLOB` | |

---

## HTTPPlugin

Provides RESTful HTTP endpoints.

### Installation
```javascript
api.use(HTTPPlugin, {
  basePath: '/api',     // Base URL path
  app: expressApp,      // Express app (optional)
  typeOptions: {        // Per-type options
    users: {
      searchFields: ['name', 'email']
    }
  }
});
```

### Routes Created

| Method | Path | Description |
|--------|------|-------------|
| GET | `/{type}` | List resources |
| GET | `/{type}/{id}` | Get single resource |
| POST | `/{type}` | Create resource |
| PUT | `/{type}/{id}` | Replace entire resource (full update) |
| PATCH | `/{type}/{id}` | Update specific fields (partial update) |
| DELETE | `/{type}/{id}` | Delete resource |
| OPTIONS | `*` | CORS preflight |

### PUT vs PATCH Behavior

- **PUT**: Full replacement - requires all required fields, validates as complete record
- **PATCH**: Partial update - only updates provided fields, validates only provided fields

```javascript
// PUT - Full replacement (all required fields must be present)
PUT /api/users/123
{
  "data": {
    "type": "users",
    "attributes": {
      "name": "John Doe",      // Required
      "email": "john@new.com", // Required
      "role": "admin"          // Optional
    }
  }
}

// PATCH - Partial update (only update what's provided)
PATCH /api/users/123
{
  "data": {
    "type": "users",
    "attributes": {
      "email": "john@new.com"  // Only updating email
    }
  }
}
```

### Query Parameters

| Parameter | Example | Description |
|-----------|---------|-------------|
| `filter[field]` | `filter[active]=true` | Filter by field |
| `sort` | `sort=-createdAt,name` | Sort order |
| `page[size]` | `page[size]=20` | Page size |
| `page[number]` | `page[number]=2` | Page number |
| `fields[type]` | `fields[users]=id,name` | Sparse fields |
| `include` | `include=posts,comments` | Include relations |

### Request/Response Format

**Request Body (POST/PATCH):**
```json
{
  "data": {
    "type": "users",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

**Response Format:**
```json
{
  "data": {
    "id": "123",
    "type": "users",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  },
  "meta": {
    "total": 100
  },
  "links": {
    "self": "/api/users/123"
  }
}
```

### Methods Added

#### `api.mount(app, basePath)`
Mount routes on Express app.

#### `api.useMiddleware(middleware)`
Add middleware to all routes.

#### `api.useRouteMiddleware(method, path, middleware)`
Add middleware to specific route.

---

## PositioningPlugin

Manage record ordering for drag-and-drop interfaces.

### Installation
```javascript
api.use(PositioningPlugin, {
  positionField: 'position',      // Position field name
  beforeIdField: 'beforeId',      // Virtual field for positioning
  positionFilters: ['projectId']  // Group by these fields
});
```

### Features
- Automatic position management
- Drag-and-drop support
- Position groups/scopes
- Gap-free positioning

### Usage

**Insert with position:**
```javascript
await api.resources.tasks.create({
  title: 'Task',
  beforeId: '123'  // Insert before this ID
}, {
  positioning: { enabled: true }
});

// beforeId values:
// - null: Insert at end
// - undefined: Keep current position (update) or end (insert)
// - ID: Insert before specified record
```

### Methods Added

#### `api.reposition(type, recordId, beforeId, options)`
Reposition existing record.

**Parameters:**
- `type` (string): Resource type
- `recordId` (string): Record to move
- `beforeId` (string|null): Position before this ID
- `options` (Object): Positioning options

#### `api.getNextPosition(type, filters, options)`
Get next available position.

**Returns:** Promise<number>

#### `api.normalizePositions(type, filters, options)`
Remove gaps in position numbers.

---

## VersioningPlugin

API versioning and resource version tracking.

### Installation
```javascript
api.use(VersioningPlugin, {
  // API versioning
  apiVersion: '2.0.0',
  versionHeader: 'api-version',
  versionParam: 'v',
  
  // Resource versioning
  versionField: 'version',
  lastModifiedField: 'lastModified',
  modifiedByField: 'modifiedBy',
  trackHistory: true,
  historyTable: 'posts_history',
  optimisticLocking: true
});
```

### Features
- Automatic API version negotiation
- Resource version tracking
- Version history
- Optimistic locking
- Version comparison

### Methods Added

#### `api.getVersionHistory(type, id, options)`
Get version history for a resource.

**Returns:** Promise<{ data: VersionHistory[] }>

#### `api.restoreVersion(type, id, version, options)`
Restore a specific version.

**Returns:** Promise<{ data: Resource }>

#### `api.diffVersions(type, id, version1, version2, options)`
Compare two versions.

**Returns:** Promise<VersionDiff>

```javascript
{
  version1: 1,
  version2: 2,
  changes: [
    { field: 'title', oldValue: 'Old', newValue: 'New' }
  ]
}
```

### Version Headers
- Request: `API-Version: 2.0.0`
- Response: `API-Version: 2.0.0`

---

## SecurityPlugin

Comprehensive security features.

### Installation
```javascript
api.use(SecurityPlugin, {
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                   // Max requests
    message: 'Too many requests'
  },
  
  // CORS
  cors: {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count']
  },
  
  // Authentication
  authentication: {
    type: 'bearer',        // 'bearer', 'basic', 'apikey'
    header: 'Authorization',
    queryParam: 'api_key',
    required: true
  },
  
  // Token verification
  verifyToken: async (token, context) => {
    // Return user object or throw
    return { id: '123', roles: ['admin'] };
  },
  
  // Options
  publicRead: false,       // Allow GET without auth
  allowUnknownFilters: false
});
```

### Security Headers Added
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security`
- `Content-Security-Policy`
- `X-Request-ID`

### Rate Limit Headers
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

### Methods Added

#### `api.generateToken(payload, expiresIn)`
Generate authentication token.

#### `api.verifyToken(token)`
Verify authentication token.

---

## LoggingPlugin

Structured logging with sensitive data protection.

### Installation
```javascript
api.use(LoggingPlugin, {
  level: 'info',              // error, warn, info, debug
  format: 'json',             // json or pretty
  includeRequest: true,
  includeResponse: true,
  includeTiming: true,
  sensitiveFields: ['password', 'token'],
  logger: console,            // Or Winston, Bunyan, etc.
  auditLog: false            // Enable audit logging
});
```

### Log Levels
- `error`: Errors only
- `warn`: Warnings and above
- `info`: Info and above
- `debug`: Everything

### Methods Added

#### `api.log`
Structured logger with methods:
- `api.log.error(message, meta)`
- `api.log.warn(message, meta)`
- `api.log.info(message, meta)`
- `api.log.debug(message, meta)`

**Example:**
```javascript
api.log.info('User created', {
  userId: '123',
  email: 'user@example.com',
  ip: req.ip
});
```

### Automatic Logging
- All API operations
- HTTP requests/responses
- SQL queries (with MySQL)
- Validation errors
- Performance metrics

---

## OpenAPIPlugin

Auto-generate OpenAPI documentation.

### Installation
```javascript
api.use(OpenAPIPlugin, {
  title: 'My API',
  version: '1.0.0',
  description: 'API description',
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Development' }
  ],
  contact: {
    name: 'API Support',
    email: 'support@example.com',
    url: 'https://example.com/support'
  },
  license: {
    name: 'MIT',
    url: 'https://opensource.org/licenses/MIT'
  }
});
```

### Endpoints Added
- `GET /openapi.json` - OpenAPI specification
- `GET /docs` - Swagger UI

### Methods Added

#### `api.generateOpenAPISpec()`
Generate OpenAPI 3.0 specification.

**Returns:** OpenAPI specification object

### Schema Documentation
```javascript
const schema = new Schema({
  email: {
    type: 'string',
    required: true,
    description: 'User email address',
    example: 'user@example.com',
    pattern: '^[^@]+@[^@]+$'
  }
});
```

---

## TimestampsPlugin

Automatically manages createdAt and updatedAt timestamp fields.

### Installation
```javascript
api.use(TimestampsPlugin, {
  createdAtField: 'createdAt',    // Field name for creation time
  updatedAtField: 'updatedAt',    // Field name for update time
  touchOnGet: false,              // Update timestamp on read
  format: 'timestamp'             // 'timestamp', 'date', 'dateTime'
});

// Or with createApi
const api = createApi({
  storage: 'memory',
  timestamps: true  // Uses defaults
});

// With options
const api = createApi({
  storage: 'memory',
  timestamps: {
    format: 'dateTime',
    touchOnGet: true
  }
});
```

### Features
- Automatically sets `createdAt` on insert
- Automatically updates `updatedAt` on update
- Prevents accidental updates to `createdAt`
- Optional touch-on-read functionality
- Configurable field names and formats

### Format Options
- `'timestamp'` (default): Unix timestamp in milliseconds
- `'date'`: ISO date string (YYYY-MM-DD)
- `'dateTime'`: ISO datetime string

### Methods Added

#### `api.touchRecord(type, id, options)`
Update only the timestamp of a record.

```javascript
await api.touchRecord('users', 123);
```

#### `api.getTimestampFields()`
Get the configured timestamp field names.

```javascript
const fields = api.getTimestampFields();
// { createdAt: 'createdAt', updatedAt: 'updatedAt' }
```

### Usage Example
```javascript
// Schema includes timestamp fields
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  createdAt: { type: 'timestamp' },  // Will be auto-set
  updatedAt: { type: 'timestamp' }   // Will be auto-updated
});

// Create a user - timestamps are set automatically
const user = await api.resources.users.create({
  name: 'John Doe',
  email: 'john@example.com'
});
// user.data.attributes.createdAt = 1638360000000
// user.data.attributes.updatedAt = 1638360000000

// Update the user - updatedAt is updated automatically
const updated = await api.resources.users.update(user.data.id, {
  email: 'newemail@example.com'
});
// user.data.attributes.updatedAt = 1638361000000 (newer)
// user.data.attributes.createdAt = 1638360000000 (unchanged)
```

---

# Helper Functions

## `createApi(options)`

Convenience function to create a fully configured API.

**Parameters:**
- `options` (Object): Combined options for Api and plugins

**Options:**
```javascript
{
  // Api options
  name: 'myapp',
  version: '1.0.0',
  idProperty: 'id',
  
  // Storage
  storage: 'memory' | 'mysql',
  
  // Plugin options
  memory: { /* MemoryPlugin options */ },
  mysql: { /* MySQLPlugin options */ },
  http: { /* HTTPPlugin options */ },
  validation: { /* ValidationPlugin options */ },
  positioning: { /* PositioningPlugin options */ },
  versioning: { /* VersioningPlugin options */ },
  security: { /* SecurityPlugin options */ },
  logging: { /* LoggingPlugin options */ }
}
```

**Example:**
```javascript
const api = createApi({
  name: 'myapp',
  version: '1.0.0',
  storage: 'mysql',
  mysql: {
    connection: dbConfig
  },
  http: {
    basePath: '/api'
  },
  security: {
    authentication: { type: 'bearer' }
  }
});
```

---

# Type Definitions

## Resource Format

JSON:API resource format:

```typescript
interface Resource {
  id: string;
  type: string;
  attributes: {
    [key: string]: any;
  };
  relationships?: {
    [key: string]: {
      data: ResourceIdentifier | ResourceIdentifier[];
    };
  };
}

interface ResourceIdentifier {
  id: string;
  type: string;
}
```

## Error Format

JSON:API error format:

```typescript
interface Error {
  status: string;       // HTTP status code
  code?: string;        // Application error code
  title: string;        // Error title
  detail?: string;      // Error details
  source?: {
    pointer?: string;   // JSON pointer to error field
    parameter?: string; // Query parameter that caused error
  };
  meta?: any;          // Additional metadata
}
```

## Query Response Format

```typescript
interface QueryResponse {
  data: Resource[];
  meta?: {
    total: number;
    pageSize: number;
    pageNumber: number;
    totalPages: number;
    [key: string]: any;
  };
  links?: {
    self: string;
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
  included?: Resource[];
}
```

---

# Constants

## VERSION
Current library version.
```javascript
import { VERSION } from 'json-rest-api';
console.log(VERSION); // '1.0.0'
```

## Default Values

| Constant | Default | Description |
|----------|---------|-------------|
| ID Property | `'id'` | Default ID field name |
| Page Size | `10` | Default query page size |
| Max Page Size | `1000` | Maximum allowed page size |
| Position Field | `'position'` | Default position field |
| Version Field | `'version'` | Default version field |
| Rate Limit Window | `900000` | 15 minutes in ms |
| Rate Limit Max | `100` | Max requests per window |

---

This completes the comprehensive API reference for the JSON REST API library. Every public method, option, and feature is documented with examples and type information.