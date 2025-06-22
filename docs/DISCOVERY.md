# Discovery Plugin

The Discovery Plugin provides OpenAPI and JSON Schema documentation for your json-rest-api, with full support for permission-based schema filtering.

## Features

- **OpenAPI 3.0** specification generation (JSON and YAML)
- **JSON Schema** export for validation and code generation
- **Permission-aware** - Users only see fields they have access to
- **Automatic endpoint documentation** including relationships and bulk operations
- **Swagger UI** integration for interactive API exploration

## Installation

```javascript
import { Api, Schema, MemoryPlugin, HTTPPlugin } from 'json-rest-api';
import { DiscoveryPlugin } from 'json-rest-api/plugins/discovery';

const api = new Api();
api.use(MemoryPlugin);

// IMPORTANT: Load DiscoveryPlugin before HTTPPlugin
api.use(DiscoveryPlugin, {
  basePath: '/api',
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'API Description'
  }
});

api.use(HTTPPlugin, { app });

// If HTTPPlugin was loaded first, manually install discovery routes
if (api._installDiscoveryRoutes) {
  api._installDiscoveryRoutes();
}
```

## Configuration Options

```javascript
api.use(DiscoveryPlugin, {
  // Base path for API endpoints (default: '/api')
  basePath: '/api',
  
  // Formats to enable (default: ['openapi', 'jsonschema'])
  formats: ['openapi', 'jsonschema'],
  
  // OpenAPI info section
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'API Description',
    contact: { email: 'api@example.com' },
    license: { name: 'MIT' }
  },
  
  // OpenAPI servers
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'https://staging-api.example.com', description: 'Staging' }
  ],
  
  // Security configuration
  security: [{ bearerAuth: [] }],
  
  // Enable Swagger UI
  swaggerUI: {
    tryItOut: true  // Enable "Try it out" button
  },
  
  // Function to extract user from request
  getUserFromRequest: (req) => req.user
});
```

## HTTP Endpoints

When used with HTTPPlugin, the Discovery Plugin adds these endpoints:

### Discovery Index
```
GET /api/discovery
```
Returns available discovery formats and their endpoints.

### OpenAPI Specification
```
GET /api/discovery/openapi      # JSON format
GET /api/discovery/openapi.yaml # YAML format
```
Returns complete OpenAPI 3.0 specification.

### JSON Schema
```
GET /api/discovery/jsonschema          # All schemas
GET /api/discovery/jsonschema/{resource} # Individual resource schema
```
Returns JSON Schema definitions.

### Swagger UI
```
GET /api/docs  # Interactive API documentation (if swaggerUI enabled)
```

## Programmatic API

You can also generate documentation programmatically:

```javascript
// Generate OpenAPI spec
const openApiSpec = await api.discovery.openapi(user, options);

// Generate JSON Schema
const jsonSchema = await api.discovery.jsonschema(user, options);

// Generate schema for specific resource
const userSchema = await api.discovery.resourceSchema('users', user, options);
```

## Permission-Based Filtering

The Discovery Plugin respects field-level permissions defined in your schemas:

```javascript
const userSchema = new Schema({
  email: { type: 'string' },
  
  // Only admins can see this field
  internalNotes: {
    type: 'string',
    permissions: { read: 'admin' }
  },
  
  // Never exposed in discovery
  password: {
    type: 'string',
    silent: true
  }
});
```

When generating documentation:
- Anonymous users see only public fields
- Authenticated users see fields based on their roles
- Silent fields are never exposed

## Example: Complete Setup

```javascript
import express from 'express';
import { Api, Schema, MemoryPlugin, HTTPPlugin } from 'json-rest-api';
import { DiscoveryPlugin } from 'json-rest-api/plugins/discovery';

const app = express();
const api = new Api({
  name: 'Blog API',
  version: '2.0.0'
});

// Add plugins
api.use(MemoryPlugin);
api.use(HTTPPlugin, { app });
api.use(DiscoveryPlugin, {
  info: {
    title: 'Blog API',
    description: 'A simple blog API with posts and comments'
  },
  swaggerUI: { tryItOut: true }
});

// Define schemas
const postSchema = new Schema({
  title: { 
    type: 'string', 
    required: true, 
    searchable: true,
    description: 'Post title'
  },
  content: { 
    type: 'string', 
    required: true,
    description: 'Post content in markdown'
  },
  authorId: {
    type: 'id',
    refs: { 
      resource: 'users',
      provideUrl: true  // Enable relationship endpoints
    }
  },
  isDraft: {
    type: 'boolean',
    default: true,
    permissions: { read: 'admin' }  // Only admins see draft status
  }
});

// Add resources
api.addResource('posts', postSchema);

// Start server
app.listen(3000, () => {
  console.log('API running on http://localhost:3000');
  console.log('OpenAPI spec: http://localhost:3000/api/discovery/openapi');
  console.log('Swagger UI: http://localhost:3000/api/docs');
});
```

## Using Generated Documentation

### With Swagger Codegen
```bash
# Generate client SDK
swagger-codegen generate -i http://localhost:3000/api/discovery/openapi -l javascript -o ./client
```

### With Postman
1. Import → Import From Link
2. Enter: `http://localhost:3000/api/discovery/openapi`

### With JSON Schema Validators
```javascript
import Ajv from 'ajv';

const response = await fetch('http://localhost:3000/api/discovery/jsonschema/users');
const schema = await response.json();

const ajv = new Ajv();
const validate = ajv.compile(schema);

const valid = validate(userData);
if (!valid) console.log(validate.errors);
```

## Advanced Features

### Custom Examples
Field definitions can include examples used in OpenAPI:

```javascript
email: {
  type: 'string',
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  description: 'User email address',
  example: 'user@example.com'  // Will appear in OpenAPI
}
```

### Searchable Fields
Fields marked as `searchable` automatically get filter parameters in OpenAPI:

```javascript
title: {
  type: 'string',
  searchable: true  // Creates filter[title] parameter
}
```

### Relationship Documentation
Relationships with `provideUrl: true` get documented endpoints:

```javascript
authorId: {
  type: 'id',
  refs: { 
    resource: 'users',
    provideUrl: true
  }
}

// Generates:
// GET /api/posts/{id}/relationships/authorId
// GET /api/posts/{id}/authorId
```

## Security Considerations

1. **Permission Filtering**: Always pass the current user to discovery methods
2. **Production Mode**: Consider disabling discovery in production or requiring authentication
3. **Rate Limiting**: Discovery endpoints can be expensive; consider rate limiting
4. **Caching**: For large APIs, consider caching discovery responses

## Troubleshooting

### Missing Fields
If fields are missing from documentation:
- Check field permissions
- Ensure user has required roles
- Verify field isn't marked as `silent`

### Invalid OpenAPI Spec
If generated spec is invalid:
- Check regex patterns (must be strings, not RegExp objects)
- Ensure enum values are consistent types
- Validate circular references in schemas

### Performance Issues
For large APIs:
- Limit discovery access to authenticated users
- Implement response caching
- Use sparse fieldsets to reduce schema size