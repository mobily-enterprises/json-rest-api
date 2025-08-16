# Multi-Tenancy with the MultiHome Plugin

The MultiHome plugin provides automatic data isolation for multi-tenant applications. It ensures that users can only access data belonging to their tenant, making it impossible to accidentally or maliciously access data from other tenants.

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
- [Security Features](#security-features)
- [Integration with Other Plugins](#integration-with-other-plugins)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Overview

Multi-tenancy is a critical requirement for SaaS applications where multiple customers (tenants) share the same application instance but must have completely isolated data. The MultiHome plugin makes this easy by:

- **Automatic Query Filtering**: Every database query automatically includes a WHERE clause for the tenant ID
- **Automatic Record Assignment**: New records are automatically assigned to the current tenant
- **Request-Based Tenant Detection**: Extracts tenant ID from subdomain, header, path, or custom logic
- **Zero Data Leakage**: Makes it impossible to access data from the wrong tenant
- **Flexible Configuration**: Supports various multi-tenancy strategies

## How It Works

The plugin operates at multiple levels to ensure complete data isolation:

### 1. Tenant Extraction (Transport Layer)

When a request arrives, the plugin extracts the tenant ID using a configurable extractor function:

```javascript
// Default: Extract from subdomain
// mobily.app.com → tenant_id = 'mobily'
// acme.app.com → tenant_id = 'acme'
```

### 2. Query Filtering (Database Layer)

Every database query is automatically modified to include the tenant filter:

```sql
-- Original query
SELECT * FROM posts WHERE status = 'published'

-- Modified query (automatic)
SELECT * FROM posts WHERE status = 'published' AND multihome_id = 'mobily'
```

### 3. Record Creation (API Layer)

When creating new records, the tenant ID is automatically set:

```javascript
// User sends:
POST /api/posts
{ "title": "My Post", "content": "..." }

// Plugin automatically adds:
{ "title": "My Post", "content": "...", "multihome_id": "mobily" }
```

## Installation

1. First, ensure you have the required dependencies:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { ExpressPlugin } from './plugins/core/connectors/express-plugin.js';
import { MultiHomePlugin } from './plugins/core/multihome-plugin.js';
```

2. Create your API and install the plugins:

```javascript
const api = new Api({ 
  name: 'my-multi-tenant-api',
});

// Install required plugins first
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: knexInstance });
await api.use(ExpressPlugin, { app: expressApp });

// Install MultiHome plugin
await api.use(MultiHomePlugin, {
  field: 'tenant_id',              // The database field name
  excludeResources: ['migrations'], // Resources to exclude
  requireAuth: true,               // Require tenant context
  allowMissing: false,             // Require field in schema
  extractor: (request) => {        // Custom extraction logic
    // Extract from subdomain
    const host = request.headers.host;
    const subdomain = host.split('.')[0];
    return subdomain;
  }
});
```

3. Add the tenant field to your resource schemas:

```javascript
api.addResource('posts', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string' },
    tenant_id: { type: 'string', required: true } // Required field
  }
});
```

## Configuration

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `field` | string | `'multihome_id'` | The database field name for tenant ID |
| `excludeResources` | array | `['system_migrations', 'system_logs']` | Resources that don't need tenant isolation |
| `requireAuth` | boolean | `true` | Whether to require tenant context for all operations |
| `allowMissing` | boolean | `false` | Whether to allow resources without the tenant field |
| `extractor` | function | Subdomain extractor | Function to extract tenant ID from request |

### Default Extractor

The default extractor tries multiple sources:

1. **Subdomain**: `tenant1.app.com` → `tenant1`
2. **Header**: `X-Multihome-ID: tenant1`
3. Returns `null` if no tenant found

Common subdomains like 'www', 'api', 'app' are ignored.

### Custom Extractors

You can provide your own extractor function:

```javascript
// Extract from JWT token
extractor: (request) => {
  const token = request.headers.authorization?.split(' ')[1];
  if (token) {
    const decoded = jwt.verify(token, secret);
    return decoded.tenant_id;
  }
  return null;
}

// Extract from URL path
extractor: (request) => {
  // /api/tenants/acme/posts → 'acme'
  const match = request.path.match(/\/tenants\/([^\/]+)/);
  return match ? match[1] : null;
}

// Extract from custom header
extractor: (request) => {
  return request.headers['x-tenant-id'];
}

// Complex logic with fallbacks
extractor: (request) => {
  // Try JWT first
  if (request.auth?.claims?.tenant_id) {
    return request.auth.claims.tenant_id;
  }
  
  // Then try subdomain
  const subdomain = request.headers.host?.split('.')[0];
  if (subdomain && !['www', 'api'].includes(subdomain)) {
    return subdomain;
  }
  
  // Finally try header
  return request.headers['x-customer-id'];
}
```

## Usage Examples

### Basic Setup with Subdomain-Based Tenancy

```javascript
// Configuration
await api.use(MultiHomePlugin, {
  field: 'tenant_id',
  extractor: (request) => {
    const host = request.headers.host;
    return host.split('.')[0]; // acme.myapp.com → 'acme'
  }
});

// Define resources with tenant field
api.addResource('projects', {
  schema: {
    name: { type: 'string', required: true },
    description: { type: 'string' },
    tenant_id: { type: 'string', required: true }
  }
});

api.addResource('users', {
  schema: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    tenant_id: { type: 'string', required: true }
  }
});
```

### Header-Based Tenancy for APIs

```javascript
// Configuration for API clients that send tenant ID in header
await api.use(MultiHomePlugin, {
  field: 'organization_id',
  extractor: (request) => {
    const tenantId = request.headers['x-organization-id'];
    if (!tenantId) {
      throw new Error('X-Organization-ID header is required');
    }
    return tenantId;
  }
});
```

### JWT-Based Tenancy

```javascript
// Works with the JWT Auth plugin
await api.use(JwtAuthPlugin, { secret: process.env.JWT_SECRET });
await api.use(MultiHomePlugin, {
  field: 'company_id',
  extractor: (request) => {
    // JWT plugin sets request.auth
    if (!request.auth?.claims?.company_id) {
      throw new Error('No company context in JWT token');
    }
    return request.auth.claims.company_id;
  }
});
```

### Mixed Mode with System Resources

```javascript
// Some resources are tenant-specific, others are global
await api.use(MultiHomePlugin, {
  field: 'tenant_id',
  excludeResources: [
    'system_settings',    // Global settings
    'countries',          // Shared reference data
    'currencies',         // Shared reference data
    'audit_logs'          // System-wide audit trail
  ],
  allowMissing: true      // Allow resources without tenant_id field
});

// Tenant-specific resource
api.addResource('invoices', {
  schema: {
    number: { type: 'string', required: true },
    amount: { type: 'number', required: true },
    tenant_id: { type: 'string', required: true }
  }
});

// Global resource (no tenant_id)
api.addResource('countries', {
  schema: {
    code: { type: 'string', required: true },
    name: { type: 'string', required: true }
    // No tenant_id field
  }
});
```

## Security Features

### 1. Automatic Query Filtering

Every query is automatically filtered at the database level:

```javascript
// User tries to access another tenant's data
GET /api/posts/123

// Even if post 123 belongs to another tenant, the query becomes:
SELECT * FROM posts WHERE id = 123 AND tenant_id = 'current-tenant'
// Result: 404 Not Found (not a security error message)
```

### 2. Validation on Write Operations

The plugin validates tenant context on all write operations:

```javascript
// User tries to create a record with wrong tenant_id
POST /api/posts
{
  "title": "Hacking attempt",
  "tenant_id": "other-tenant"  // This will be rejected
}

// Error: Cannot set tenant_id to 'other-tenant' - must match current context
```

### 3. Security Logging

Security violations are logged for monitoring:

```javascript
// When someone tries to access wrong tenant data
log.error('Multihome security violation attempt', {
  scopeName: 'posts',
  recordId: 123,
  recordMultihomeId: 'tenant-a',
  contextMultihomeId: 'tenant-b'
});
```

### 4. Fail-Safe Design

If tenant context is missing and `requireAuth: true`:

```javascript
// No tenant context available
GET /api/posts
// Error: No multihome context available - cannot execute query
```

## Integration with Other Plugins

### With JWT Auth Plugin

The MultiHome plugin works seamlessly with JWT authentication:

```javascript
// JWT token contains tenant information
{
  "sub": "user123",
  "email": "user@example.com",
  "tenant_id": "acme-corp",
  "exp": 1234567890
}

// MultiHome extractor uses the JWT claim
await api.use(MultiHomePlugin, {
  extractor: (request) => request.auth?.claims?.tenant_id
});
```

### With Express Plugin

The Express plugin provides the request object that MultiHome uses:

```javascript
// Express middleware sets up request
app.use('/api', (req, res) => {
  // MultiHome extractor receives the Express request object
  // with headers, path, auth, etc.
});
```

### With REST API Plugin

MultiHome integrates at multiple points in the REST API lifecycle:

1. **Before Schema Validation**: Sets tenant_id on new records
2. **Before Data Operations**: Validates tenant access
3. **During Query Building**: Adds WHERE clauses

## API Reference

### Configuration API

```javascript
// Access current configuration
const config = api.multihome.getConfig();
console.log(config);
// {
//   field: 'tenant_id',
//   excludeResources: ['migrations'],
//   requireAuth: true,
//   allowMissing: false,
//   hasCustomExtractor: true
// }
```

### Variables

The plugin sets these variables accessible via `api.vars.multihome`:

- `field`: The tenant ID field name
- `excludeResources`: Array of excluded resource names
- `requireAuth`: Whether tenant context is required
- `allowMissing`: Whether resources can omit the tenant field

### Helpers

- `helpers.extractMultihomeId(request)`: The configured extractor function

### Hooks

The plugin adds these hooks:

| Hook | When | Purpose |
|------|------|---------|
| `transport:request` | Every request | Extract tenant ID from request |
| `scope:added` | Resource creation | Validate tenant field exists |
| `knexQueryFiltering` | Database queries | Add WHERE clause for tenant |
| `beforeSchemaValidate` | Before validation | Set tenant_id on new records |
| `beforeDataGet/Put/Patch/Delete` | Before operations | Additional security validation |

## Troubleshooting

### Common Issues

#### 1. "No multihome context available"

**Cause**: The extractor couldn't find a tenant ID in the request.

**Solutions**:
- Check your extractor function is returning a value
- Verify the subdomain/header/token contains tenant information
- Set `requireAuth: false` if some operations don't need tenant context

#### 2. "Resource must have 'tenant_id' field in schema"

**Cause**: A resource is missing the tenant field in its schema.

**Solutions**:
- Add the field to the schema
- Add the resource to `excludeResources` if it's global
- Set `allowMissing: true` if you have mixed resources

#### 3. "Cannot set tenant_id to X - must match current context Y"

**Cause**: Trying to set a different tenant_id than the current context.

**Solution**: Don't include tenant_id in your requests - it's set automatically.

#### 4. Queries returning no results

**Cause**: Data exists but with different tenant_id.

**Debugging**:
```javascript
// Check current tenant context
api.on('transport:request', (context) => {
  console.log('Current tenant:', context.auth?.multihome_id);
});

// Check query modifications
api.on('knexQueryFiltering', (context) => {
  console.log('Query SQL:', context.knexQuery.query.toString());
});
```

### Debug Mode

Enable detailed logging to troubleshoot:

```javascript
const api = new Api({
  name: 'my-api',
  logging: { level: 'trace' }
});
```

## Best Practices

### 1. Schema Design

Always include the tenant field in your schemas:

```javascript
// Good
api.addResource('orders', {
  schema: {
    order_number: { type: 'string', required: true },
    total: { type: 'number', required: true },
    tenant_id: { type: 'string', required: true } // Always include
  }
});
```

### 2. Consistent Field Naming

Use the same tenant field name across all resources:

```javascript
// Configure once
await api.use(MultiHomePlugin, { field: 'tenant_id' });

// Use everywhere
// ✓ Good: All resources use 'tenant_id'
// ✗ Bad: Some use 'tenant_id', others use 'company_id'
```

### 3. Validation in Extractors

Add validation to your extractor functions:

```javascript
extractor: (request) => {
  const tenantId = request.headers['x-tenant-id'];
  
  if (!tenantId) {
    throw new Error('X-Tenant-ID header is required');
  }
  
  if (!/^[a-z0-9-]+$/.test(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }
  
  return tenantId;
}
```

### 4. Migration Strategy

When adding multi-tenancy to an existing application:

1. Add the tenant field to all tables
2. Populate existing data with a default tenant
3. Enable the plugin with `allowMissing: true` initially
4. Gradually update all resources
5. Switch to `allowMissing: false` when complete

### 5. Testing

Test with multiple tenants:

```javascript
describe('Multi-tenancy', () => {
  it('isolates data between tenants', async () => {
    // Create data for tenant A
    const resA = await fetch('https://tenant-a.app.com/api/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'Tenant A Post' })
    });
    
    // Try to access from tenant B
    const resB = await fetch('https://tenant-b.app.com/api/posts/' + resA.id);
    expect(resB.status).toBe(404); // Should not find
  });
});
```

### 6. Performance Considerations

The tenant field should be indexed for performance:

```sql
CREATE INDEX idx_posts_tenant_id ON posts(tenant_id);
CREATE INDEX idx_posts_tenant_status ON posts(tenant_id, status);
```

## Complete Example

Here's a complete multi-tenant API setup:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { ExpressPlugin } from './plugins/core/connectors/express-plugin.js';
import { JwtAuthPlugin } from './plugins/core/jwt-auth-plugin.js';
import { MultiHomePlugin } from './plugins/core/multihome-plugin.js';
import knex from 'knex';
import express from 'express';

// Initialize
const app = express();
const db = knex({
  client: 'postgresql',
  connection: process.env.DATABASE_URL
});

// Create API
const api = new Api({ 
  name: 'saas-api', 
  logging: { level: 'info' }
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });
await api.use(ExpressPlugin, { app });
await api.use(JwtAuthPlugin, { 
  secret: process.env.JWT_SECRET 
});

// Configure multi-tenancy
await api.use(MultiHomePlugin, {
  field: 'tenant_id',
  excludeResources: ['system_health', 'public_content'],
  requireAuth: true,
  allowMissing: false,
  extractor: (request) => {
    // Try multiple sources
    // 1. JWT token (preferred)
    if (request.auth?.claims?.tenant_id) {
      return request.auth.claims.tenant_id;
    }
    
    // 2. Subdomain (fallback)
    const host = request.headers.host || '';
    const subdomain = host.split('.')[0];
    if (subdomain && !['www', 'api', 'app'].includes(subdomain)) {
      return subdomain;
    }
    
    // 3. Header (API clients)
    if (request.headers['x-tenant-id']) {
      return request.headers['x-tenant-id'];
    }
    
    // No tenant found
    throw new Error('Unable to determine tenant context');
  }
});

// Define tenant-specific resources
api.addResource('projects', {
  schema: {
    name: { type: 'string', required: true },
    description: { type: 'string' },
    status: { type: 'string', defaultTo: 'active' },
    tenant_id: { type: 'string', required: true }
  }
});

api.addResource('team_members', {
  schema: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', defaultTo: 'member' },
    tenant_id: { type: 'string', required: true }
  }
});

// Start server
app.listen(3000, () => {
  console.log('Multi-tenant API running on port 3000');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

Now your API automatically:
- Extracts tenant ID from JWT tokens, subdomains, or headers
- Filters all queries by tenant
- Sets tenant_id on new records
- Prevents cross-tenant data access
- Logs security violations

The MultiHome plugin makes multi-tenancy transparent to your application logic while ensuring complete data isolation.