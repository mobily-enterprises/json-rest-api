# Security Best Practices

This guide covers security features and best practices for the JSON REST API library.

## Table of Contents

1. [Field Security](#field-security)
2. [CORS Configuration](#cors-configuration)
3. [JWT Authentication](#jwt-authentication)
4. [Authorization](#authorization)
5. [Additional Security Features](#additional-security-features)
6. [Security Checklist](#security-checklist)

## Field Security

**Built into Core** - Field security is automatically enforced for all API operations to prevent unauthorized access and path traversal attacks.

### Protected Fields

The API automatically blocks access to:

1. **System fields** - Fields starting with `_` or `$`
2. **Silent fields** - Fields marked with `silent: true` in schema
3. **Permission-protected fields** - Fields with `permission` requirements
4. **Non-existent fields** - Fields not defined in schema

### Examples

```javascript
const schema = new Schema({
  // Public field
  title: { type: 'string' },
  
  // Silent field - never exposed in queries
  password: { type: 'string', silent: true },
  
  // Permission-protected field
  internalNotes: { 
    type: 'string',
    permission: 'posts.moderate'
  },
  
  // System fields (blocked automatically)
  _internal: { type: 'string' },
  $system: { type: 'string' }
});

// These will throw errors:
api.query({ filter: { password: 'secret' } });      // Silent field
api.query({ filter: { _internal: 'value' } });      // System field
api.query({ filter: { nonExistent: 'value' } });    // Undefined field
api.query({ filter: { '__proto__.isAdmin': true } }); // Prototype pollution attempt
```

### Virtual Search Fields

You can define virtual search fields that don't map to database columns:

```javascript
api.addResource('posts', schema, {
  searchableFields: {
    title: 'title',         // Normal field
    search: '*',            // Virtual field (marked with *)
    smart: '*'              // Another virtual field
  }
});

// Handle virtual fields in hooks
api.hook('beforeQuery', async (context) => {
  if (context.params.filter?.search) {
    // Transform to real database query
    const value = context.params.filter.search;
    delete context.params.filter.search;
    
    // Safe multi-field search
    context.query.where(
      '(title LIKE ? OR content LIKE ?)',
      `%${value}%`, `%${value}%`
    );
  }
});
```

## CORS Configuration

The **CorsPlugin** provides automatic CORS configuration with platform detection.

### Zero-Config Development

```javascript
import { CorsPlugin } from 'json-rest-api/plugins/cors.js';

// Just add the plugin - it works automatically!
api.use(CorsPlugin);
```

In development, automatically allows:
- `http://localhost:*` (any port)
- `http://127.0.0.1:*`
- `http://192.168.*.*:*` (local network)
- Mobile app origins (`capacitor://`, `ionic://`)
- Common tunnel services (ngrok, localtunnel)

### Production Configuration

```bash
# Set environment variable
CORS_ORIGINS=https://myapp.com,https://www.myapp.com
```

```javascript
// Same code as development!
api.use(CorsPlugin);
```

### Platform Auto-Detection

The plugin automatically detects and configures for:

- **Vercel** - Uses `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`
- **Netlify** - Uses `URL`, `DEPLOY_PRIME_URL`
- **Heroku** - Uses `HEROKU_APP_NAME`
- **AWS Amplify** - Uses `AWS_BRANCH_URL`, `AWS_APP_URL`
- **Railway** - Uses `RAILWAY_PUBLIC_DOMAIN`
- **Render** - Uses `RENDER_EXTERNAL_URL`
- **Google Cloud Run** - Uses `CLOUD_RUN_SERVICE_URL`
- **Azure** - Uses `WEBSITE_HOSTNAME`
- **DigitalOcean** - Uses `APP_URL`
- **Fly.io** - Uses `FLY_APP_NAME`
- **Cloudflare** - Uses `CF_PAGES_URL`
- **GitHub Codespaces** - Uses `CODESPACE_NAME`
- **Gitpod** - Uses `GITPOD_WORKSPACE_URL`
- And many more...

### Advanced Configuration

```javascript
// Explicit origins
api.use(CorsPlugin, {
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com']
  }
});

// Dynamic validation
api.use(CorsPlugin, {
  cors: (origin, callback) => {
    // Check against database, etc.
    const allowed = await checkOriginInDatabase(origin);
    callback(null, allowed);
  }
});

// Regex patterns
api.use(CorsPlugin, {
  cors: {
    origin: /^https:\/\/[a-z]+\.example\.com$/
  }
});

// Public API (no credentials)
api.use(CorsPlugin, {
  cors: {
    origin: '*',
    credentials: false  // Required for wildcard
  }
});
```

### Environment Variables

The plugin checks these environment variables (in order):
- `CORS_ORIGINS` / `CORS_ORIGIN`
- `ALLOWED_ORIGINS` / `ALLOWED_ORIGIN`
- `FRONTEND_URL` / `CLIENT_URL`
- `APP_URL` / `WEB_URL` / `PUBLIC_URL`

## JWT Authentication

The **JwtPlugin** provides secure token-based authentication using JSON Web Tokens.

### Basic Setup

```javascript
import { JwtPlugin } from 'json-rest-api/plugins/jwt.js';

api.use(JwtPlugin, {
  secret: process.env.JWT_SECRET  // Required
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

### Configuration Options

```javascript
api.use(JwtPlugin, {
  // Signing options
  secret: 'your-secret-key',           // For HS256
  // OR
  privateKey: rsaPrivateKey,           // For RS256
  publicKey: rsaPublicKey,
  
  // Token options
  algorithm: 'HS256',                  // or 'RS256', 'ES256', etc.
  expiresIn: '24h',                    // Token lifetime
  issuer: 'my-app',                    // Token issuer
  audience: 'my-app-users',            // Token audience
  
  // Refresh tokens
  refreshExpiresIn: '30d',             // Refresh token lifetime
  refreshTokenLength: 32,              // Bytes for refresh token
  
  // Migration support
  supportLegacyTokens: true,           // Support old Base64 tokens
  legacyTokenWarning: true,            // Warn about legacy tokens
  
  // Token extraction
  tokenHeader: 'X-Auth-Token',         // Custom header name
  tokenQueryParam: 'token',            // Query parameter
  tokenCookie: 'auth-token',           // Cookie name
  
  // Hooks
  beforeSign: async (payload, options) => {
    // Modify payload before signing
  },
  afterVerify: async (decoded) => {
    // Process verified token
  }
});
```

### Refresh Tokens

```javascript
// Generate refresh token
const refreshToken = await api.generateRefreshToken(userId, {
  deviceId: 'device-123',
  userAgent: req.headers['user-agent']
});

// Use refresh token
const { accessToken, refreshToken: newRefresh } = 
  await api.refreshAccessToken(refreshToken);

// Revoke refresh token
await api.revokeRefreshToken(refreshToken);
```

### Integration with HTTP

```javascript
// The plugin automatically extracts tokens from requests
api.use(HTTPPlugin, {
  getUserFromRequest: (req) => {
    // JwtPlugin already populated req.user
    return req.user;
  }
});

// In your routes
app.get('/api/profile', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({ user: req.user });
});
```

### Migration from Insecure Tokens

If migrating from Base64 JSON tokens:

```javascript
api.use(JwtPlugin, {
  secret: process.env.JWT_SECRET,
  supportLegacyTokens: true,  // Temporarily support both
  legacyTokenWarning: true    // Log warnings
});

// Both token types work during migration
const legacyToken = Buffer.from(JSON.stringify({...})).toString('base64');
const jwtToken = await api.generateToken({...});
```

## Authorization

The **AuthorizationPlugin** provides role-based access control (RBAC) with fine-grained permissions.

### Basic Setup

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

### Permission Hierarchy

Permissions follow a hierarchical pattern:
- `*` - All permissions
- `resource.*` - All actions on a resource
- `resource.action` - Specific action on a resource
- `resource.action.own` - Action only on owned items

### Ownership-Based Access

Define ownership rules per resource:

```javascript
resources: {
  posts: {
    ownerField: 'authorId',       // Which field defines ownership
    owner: ['update', 'delete']   // Owner-only actions
  },
  comments: {
    ownerField: 'userId',
    authenticated: ['create'],    // Any logged-in user
    owner: ['update', 'delete'],  // Only comment author
    permissions: {
      delete: 'comments.moderate' // Override with permission
    }
  }
}
```

### Checking Permissions

```javascript
// In hooks or custom code
if (!user.can('posts.update')) {
  throw new ForbiddenError('Insufficient permissions');
}

// Check ownership
if (!user.owns(post) && !user.can('posts.update.any')) {
  throw new ForbiddenError('You can only edit your own posts');
}
```

## Query Complexity Limits

The **QueryLimitsPlugin** prevents resource exhaustion attacks by limiting query complexity:

### Basic Setup

```javascript
import { QueryLimitsPlugin } from 'json-rest-api/plugins/query-limits.js';

api.use(QueryLimitsPlugin, {
  maxJoins: 5,           // Maximum total joins in a query
  maxJoinDepth: 3,       // Maximum nesting depth for joins
  maxPageSize: 100,      // Maximum records per page
  defaultPageSize: 20,   // Default page size
  maxFilterFields: 10,   // Maximum filter conditions
  maxSortFields: 3,      // Maximum sort fields
  maxQueryCost: 100      // Maximum total query cost
});
```

### Query Cost Calculation

The plugin calculates a "cost" for each query based on its complexity:

```javascript
// Cost weights (configurable)
costs: {
  join: 10,           // Each join costs 10 points
  nestedJoin: 15,     // Additional cost for nested joins
  filter: 2,          // Each filter condition
  sort: 3,            // Each sort field
  pageSize: 0.1       // Per record requested
}
```

### Resource-Specific Limits

Override limits for specific resources:

```javascript
api.use(QueryLimitsPlugin, {
  maxPageSize: 50,  // Global default
  
  resources: {
    // Allow larger page sizes for posts
    posts: {
      maxPageSize: 200,
      maxQueryCost: 150
    },
    // Restrict comments more strictly
    comments: {
      maxPageSize: 20,
      maxJoins: 2
    }
  }
});
```

### Admin/Premium User Bypass

Allow certain users to bypass limits:

```javascript
api.use(QueryLimitsPlugin, {
  // Bypass for specific roles
  bypassRoles: ['admin', 'superadmin'],
  
  // Custom bypass logic
  bypassCheck: (user) => {
    return user?.subscription === 'premium' || 
           user?.trustLevel > 100;
  }
});
```

### Example Error Messages

When limits are exceeded, clear error messages explain the issue:

```json
{
  "error": {
    "message": "Maximum number of joins (5) exceeded",
    "status": 400,
    "context": {
      "joinCount": 7,
      "maxJoins": 5,
      "joins": ["authorId", "categoryId", "tags", "comments", "comments.authorId", "relatedPosts", "relatedPosts.authorId"]
    }
  }
}
```

### Validating Query Complexity

Check if a query would exceed limits before executing:

```javascript
const validation = api.validateQueryComplexity({
  joins: ['authorId', 'categoryId'],
  filter: { status: 'published' },
  page: { size: 50 }
}, 'posts', req.user);

if (!validation.valid) {
  // Show warning or adjust query
  console.log(`Query cost: ${validation.cost}/${validation.maxCost}`);
}
```

### Best Practices

1. **Set reasonable defaults** - Balance security with usability
2. **Monitor query costs** - Track which queries are expensive
3. **Educate API users** - Document limits in your API docs
4. **Provide alternatives** - Offer paginated or simplified endpoints
5. **Use field selection** - Encourage clients to request only needed fields

## Additional Security Features

### SecurityPlugin Features

The SecurityPlugin provides additional security features:

```javascript
import { SecurityPlugin } from 'json-rest-api/plugins/security.js';

api.use(SecurityPlugin, {
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                   // 100 requests per window
    message: 'Too many requests'
  },
  
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  
  // Input sanitization
  sanitizeInput: true,
  
  // SQL injection protection
  allowUnknownFilters: false
});
```

Security headers automatically added:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security`
- `Content-Security-Policy`

### Built-in Protections

1. **SQL Injection Prevention**
   - All queries use parameterized statements
   - Field names are validated against schema
   - Identifiers are properly escaped

2. **Prototype Pollution Prevention**
   - Input sanitization removes dangerous keys
   - `__proto__`, `constructor`, `prototype` are blocked

3. **XSS Prevention**
   - Input sanitization escapes HTML entities
   - Content-Type headers prevent MIME sniffing

## Security Checklist

### Development

- [ ] Use HTTPS in development (with self-signed certificates)
- [ ] Test with authentication enabled
- [ ] Verify CORS configuration
- [ ] Check field permissions

### Production

- [ ] **JWT_SECRET** environment variable set (min 32 characters)
- [ ] **CORS_ORIGINS** environment variable configured
- [ ] HTTPS enforced (via load balancer or reverse proxy)
- [ ] Rate limiting configured
- [ ] Database credentials secured
- [ ] Error messages don't leak sensitive information
- [ ] Monitoring/alerting for security events

### Code Review

- [ ] No hardcoded secrets or credentials
- [ ] All user input validated
- [ ] Permissions checked before operations
- [ ] Sensitive fields marked as `silent`
- [ ] Proper error handling (no stack traces in production)

### Deployment

- [ ] Environment variables properly set
- [ ] Database access restricted
- [ ] Firewall rules configured
- [ ] Regular security updates
- [ ] Backup and recovery plan

## Common Security Mistakes to Avoid

1. **Using wildcard CORS with credentials**
   ```javascript
   // ❌ NEVER DO THIS
   cors: { origin: '*', credentials: true }
   
   // ✅ Specify allowed origins
   cors: { origin: ['https://myapp.com'] }
   ```

2. **Exposing sensitive fields**
   ```javascript
   // ❌ Password visible in queries
   password: { type: 'string' }
   
   // ✅ Mark as silent
   password: { type: 'string', silent: true }
   ```

3. **Missing field validation**
   ```javascript
   // ❌ Any field can be queried
   api.query({ filter: { anyField: 'value' } })
   
   // ✅ Only searchable fields allowed
   email: { type: 'string', searchable: true }
   ```

4. **Weak JWT secrets**
   ```javascript
   // ❌ Weak secret
   secret: 'secret123'
   
   // ✅ Strong secret
   secret: crypto.randomBytes(32).toString('hex')
   ```

5. **Not validating permissions**
   ```javascript
   // ❌ No permission check
   await api.update(id, data)
   
   // ✅ Check ownership/permissions
   if (!user.can('posts.update')) throw new ForbiddenError()
   ```

---

**← Previous**: [Examples](./GUIDE_6_Examples.md)