# JSON REST API - Developer Onboarding

Welcome to the JSON REST API library! This guide will help you get up to speed quickly with best practices and important features.

## Quick Links

- **[QUICKSTART](./QUICKSTART.md)** - Build your first API in 5 minutes
- **[Complete Guide](./GUIDE.md)** - Comprehensive documentation
- **[API Reference](./API.md)** - Detailed API documentation
- **[Examples](./examples/)** - Working code examples

## Essential Concepts

### 1. Plugin Architecture

The JSON REST API uses a plugin system. Always load plugins in this order:

```javascript
api
  .use(MySQLPlugin)        // Storage first
  .use(ValidationPlugin)   // Validation
  .use(AuthorizationPlugin) // Security
  .use(HTTPPlugin)         // HTTP last
```

### 2. Resource Proxy API

Always use the intuitive resource proxy API:

```javascript
// ✅ Preferred
const user = await api.resources.users.get(123);

// ❌ Avoid
const user = await api.get(123, { type: 'users' });
```

### 3. Schema-Driven Development

Define your data structure with schemas:

```javascript
const userSchema = new Schema({
  email: { type: 'string', required: true, searchable: true },
  password: { type: 'string', silent: true }, // Never exposed
  role: { type: 'string', default: 'user' }
});
```

## Security Setup

### Authentication with JWT

Replace insecure Base64 tokens with proper JWT authentication:

```javascript
import { JwtPlugin } from 'json-rest-api/plugins/jwt.js';

api.use(JwtPlugin, {
  secret: process.env.JWT_SECRET // Min 32 characters
});

// Generate tokens
const token = await api.generateToken({
  userId: user.id,
  email: user.email,
  roles: user.roles
});
```

### Authorization with RBAC

The built-in AuthorizationPlugin provides role-based access control:

```javascript
import { AuthorizationPlugin } from 'json-rest-api/plugins/authorization.js';

api.use(AuthorizationPlugin, {
  // Define roles and permissions
  roles: {
    admin: { 
      permissions: '*' // All permissions
    },
    editor: { 
      permissions: ['posts.*', 'media.*'] 
    },
    user: { 
      permissions: [
        'posts.create',
        'posts.read',
        'posts.update.own', // Only own posts
        'posts.delete.own'
      ]
    }
  },
  
  // Bridge to your auth system
  enhanceUser: async (user) => {
    // Load roles from your database/JWT/session
    const roles = await getUserRoles(user.id);
    return { ...user, roles };
  },
  
  // Resource-specific rules
  resources: {
    posts: {
      ownerField: 'authorId',
      public: ['read'],
      authenticated: ['create'],
      owner: ['update', 'delete']
    }
  }
});
```

### CORS Configuration

Zero-config CORS with automatic platform detection:

```javascript
import { CorsPlugin } from 'json-rest-api/plugins/cors.js';

// Just add it - works automatically!
api.use(CorsPlugin);

// In production, set CORS_ORIGINS environment variable:
// CORS_ORIGINS=https://myapp.com,https://www.myapp.com
```

### Field Security

Field security is built into the core - no plugin needed:

```javascript
const schema = new Schema({
  // Public fields
  title: { type: 'string', searchable: true },
  
  // Protected fields
  password: { type: 'string', silent: true },
  apiKey: { type: 'string', silent: true },
  
  // Permission-based fields
  internalNotes: { 
    type: 'string',
    permission: 'posts.moderate'
  }
});
```

## Best Practices

### 1. Always Mark Searchable Fields

Only fields marked as `searchable: true` can be filtered:

```javascript
email: { type: 'string', searchable: true }
```

### 2. Use Virtual Search Fields

For complex searches that don't map to database columns:

```javascript
api.addResource('posts', schema, {
  searchableFields: {
    title: 'title',     // Normal field
    search: '*'         // Virtual field
  }
});

// Handle in hook
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search) {
    // Transform to database query
  }
});
```

### 3. Secure by Default

- Never expose sensitive fields (use `silent: true`)
- Always validate input (automatic with schemas)
- Use proper authentication (JWT, not Base64)
- Configure CORS properly (never use `*` with credentials)
- Check permissions before operations

### 4. Performance Tips

- Use field selection to reduce data transfer
- Enable eager joins for commonly accessed relationships
- Index searchable fields in your database
- Use pagination for large datasets

## Testing Your API

### Unit Tests

```javascript
import { test } from 'node:test';
import { createApi } from 'json-rest-api';

test('my feature', async () => {
  const api = createApi({ storage: 'memory' });
  // Test your feature
});
```

### Integration Tests

```javascript
// Use MySQL for integration tests
const api = createApi({ 
  storage: 'mysql',
  mysql: { connection: testDbConfig }
});

// Always clean up
afterEach(async () => {
  await robustTeardown({ api, connection });
});
```

## Common Patterns

### Multi-Tenant APIs

```javascript
// Add tenant isolation
api.hook('beforeQuery', async (context) => {
  const tenantId = context.options.user?.tenantId;
  if (tenantId) {
    context.params.filter.tenantId = tenantId;
  }
});
```

### Audit Logging

```javascript
api.hook('afterInsert', async (context) => {
  await auditLog.create({
    action: 'create',
    resource: context.options.type,
    userId: context.options.user?.id,
    data: context.result
  });
});
```

### Soft Deletes

Use the soft delete pattern instead of hard deletes:

```javascript
// Add deletedAt field
deletedAt: { type: 'timestamp', silent: true }

// Override delete behavior
api.hook('beforeDelete', async (context) => {
  // Convert to soft delete
  context.method = 'update';
  context.data = { deletedAt: Date.now() };
});
```

## Deployment Checklist

- [ ] Environment variables set (JWT_SECRET, CORS_ORIGINS, etc.)
- [ ] Database migrations run
- [ ] HTTPS configured
- [ ] Rate limiting enabled
- [ ] Error logging configured
- [ ] Monitoring set up
- [ ] Backup strategy in place

## Getting Help

- **Documentation**: [Complete Guide](./GUIDE.md)
- **API Reference**: [API.md](./API.md)
- **Security**: [Security Best Practices](./GUIDE_7_Security.md)
- **Examples**: Check the [examples](./examples/) directory
- **Issues**: Report on GitHub

## Next Steps

1. Read the [QUICKSTART](./QUICKSTART.md) to build your first API
2. Explore the [examples](./examples/) directory
3. Review [Security Best Practices](./GUIDE_7_Security.md)
4. Check the [Complete Guide](./GUIDE.md) for advanced features

Welcome aboard! 🚀