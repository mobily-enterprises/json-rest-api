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
    category: 'categoryId.title' // Filter by category title
  },
  hooks: {
    afterInsert: async (context) => {
      // Resource-specific hook
    }
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
- `joins`: Array of field names to join (overrides eager joins)

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