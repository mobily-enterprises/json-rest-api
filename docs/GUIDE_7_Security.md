# JSON REST API - Security Best Practices

This guide covers all security features available in the JSON REST API library, helping you build secure and robust APIs.

## Table of Contents

1. [XSS Protection](#xss-protection)
2. [SQL Injection Prevention](#sql-injection-prevention)
3. [Prototype Pollution Protection](#prototype-pollution-protection)
4. [Rate Limiting](#rate-limiting)
5. [Security Headers](#security-headers)
6. [Authentication & Authorization](#authentication--authorization)
7. [Error Sanitization](#error-sanitization)
8. [Type Validation](#type-validation)
9. [Audit Logging](#audit-logging)
10. [CSRF Protection](#csrf-protection)
11. [Field Security](#field-security)
12. [CORS Configuration](#cors-configuration)
13. [Query Complexity Limits](#query-complexity-limits)
14. [Security Checklist](#security-checklist)

## XSS Protection

The SecurityPlugin provides automatic XSS protection using DOMPurify for all string inputs.

```javascript
import { Api } from 'json-rest-api';
import { SecurityPlugin } from 'json-rest-api/plugins';

const api = new Api();
api.use(SecurityPlugin); // XSS protection enabled by default

// Malicious input is automatically sanitized
const result = await api.insert({
  comment: '<script>alert("XSS")</script>Hello' // Becomes: 'Hello'
}, { type: 'comments' });
```

### Configuration

```javascript
api.use(SecurityPlugin, {
  sanitizer: {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'],
    ALLOWED_ATTR: ['href'],
    ALLOW_DATA_ATTR: false
  }
});
```

## SQL Injection Prevention

Built-in protection against SQL injection attacks in filter parameters.

```javascript
// These dangerous patterns are automatically blocked:
try {
  await api.query({
    filter: {
      name: "'; DROP TABLE users; --" // Throws ValidationError
    }
  }, { type: 'items' });
} catch (error) {
  // "Filter value contains dangerous SQL patterns"
}

// Safe queries work normally
const results = await api.query({
  filter: {
    name: "O'Brien", // Properly escaped
    status: 'active'
  }
}, { type: 'items' });
```

### Filter Value Limits

- Maximum filter value length: 1000 characters
- Dangerous patterns detected: SQL commands, comments, null bytes
- Automatic parameterized queries for all database operations

## Prototype Pollution Protection

Deep validation prevents prototype pollution attacks in nested objects.

```javascript
// These attacks are automatically blocked:
try {
  await api.insert({
    "__proto__": { "isAdmin": true }, // Blocked
    "constructor": { "prototype": { "isAdmin": true } }, // Blocked
    nested: {
      "__proto__.isAdmin": true // Deep detection
    }
  }, { type: 'configs' });
} catch (error) {
  // "Potential prototype pollution detected"
}

// Safe nested objects work normally
const config = await api.insert({
  settings: {
    theme: 'dark',
    preferences: {
      notifications: true
    }
  }
}, { type: 'configs' });
```

## Rate Limiting

Distributed rate limiting with Redis support and in-memory fallback.

```javascript
import { DistributedRateLimiter } from 'json-rest-api/lib';
import Redis from 'ioredis';

// With Redis (recommended for production)
const redis = new Redis({
  host: 'localhost',
  port: 6379
});

api.use(SecurityPlugin, {
  rateLimit: {
    max: 100,        // 100 requests
    window: 900000,  // per 15 minutes
    keyGenerator: (options) => options.request?.ip || 'anonymous',
    storage: new DistributedRateLimiter({ redis })
  }
});

// Without Redis (in-memory fallback)
api.use(SecurityPlugin, {
  rateLimit: {
    max: 100,
    window: 900000
  }
});
```

### Advanced Rate Limiting

```javascript
// Different limits per operation
api.use(SecurityPlugin, {
  rateLimit: {
    insert: { max: 20, window: 3600000 },    // 20 creates per hour
    update: { max: 50, window: 3600000 },    // 50 updates per hour
    delete: { max: 10, window: 3600000 },    // 10 deletes per hour
    query: { max: 1000, window: 3600000 }    // 1000 queries per hour
  }
});

// Custom key generation (e.g., per user)
api.use(SecurityPlugin, {
  rateLimit: {
    keyGenerator: (options) => {
      return options.user?.id || options.request?.ip || 'anonymous';
    }
  }
});
```

## Security Headers

Comprehensive security headers for all HTTP responses.

```javascript
api.use(SecurityPlugin, {
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }
});
```

### Default Headers

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`
- `Strict-Transport-Security` (HTTPS only)

## Authentication & Authorization

### JWT with Refresh Token Rotation

```javascript
import { JWTPlugin } from 'json-rest-api/plugins';

api.use(JWTPlugin, {
  secret: process.env.JWT_SECRET,
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  rotateRefreshTokens: true, // Enable rotation
  reuseDetection: true      // Detect token reuse attacks
});

// Login endpoint with refresh token
api.post('/auth/login', async (req, res) => {
  const user = await validateCredentials(req.body);
  
  const { accessToken, refreshToken } = await api.generateTokenPair({
    userId: user.id,
    roles: user.roles
  });
  
  res.json({ accessToken, refreshToken });
});

// Refresh endpoint with rotation
api.post('/auth/refresh', async (req, res) => {
  try {
    const { accessToken, refreshToken } = await api.refreshAccessToken(
      req.body.refreshToken
    );
    res.json({ accessToken, refreshToken });
  } catch (error) {
    if (error.code === 'TOKEN_REUSE_DETECTED') {
      // Entire token family has been revoked
      res.status(401).json({ error: 'Session compromised, please login again' });
    }
  }
});
```

### Role-Based Access Control

```javascript
import { AuthorizationPlugin } from 'json-rest-api/plugins';

api.use(AuthorizationPlugin, {
  roles: {
    admin: ['*'],                          // All permissions
    editor: ['posts.*', 'comments.*'],     // All posts and comments operations
    author: ['posts.create', 'posts.update:own', 'posts.delete:own'],
    reader: ['posts.read', 'comments.read']
  },
  
  // Custom permission checks
  customChecks: {
    'posts.update:own': async (user, resource, recordId) => {
      const post = await api.get(recordId, { type: 'posts' });
      return post.authorId === user.id;
    }
  }
});

// Secure internal operations
api.hook('beforeInsert', async (context) => {
  // _skipAuth only works with _internal flag
  if (context._skipAuth && !context._internal) {
    throw new Error('Unauthorized: _skipAuth requires _internal flag');
  }
});
```

## Type Validation

Strict type validation prevents type coercion attacks.

```javascript
// Strict mode enabled by default
const api = new Api();
api.addResource('products', {
  price: { type: 'number' },    // "19.99" is rejected
  quantity: { type: 'number' },  // "10" is rejected
  active: { type: 'boolean' }    // "true" is rejected
});

// Disable strict mode if needed (not recommended)
api.addResource('legacy', new Schema({
  price: { type: 'number' }
}, {
  strictMode: false  // Allows "19.99" -> 19.99
}));

// Per-field control
api.addResource('mixed', {
  strictPrice: { type: 'number', strictNumber: true },
  loosePrice: { type: 'number', strictNumber: false }
});
```

## Audit Logging

Comprehensive security event logging for compliance and monitoring.

```javascript
import { AuditLogPlugin } from 'json-rest-api/plugins';

api.use(AuditLogPlugin, {
  storage: 'memory',              // or provide Redis/database
  format: 'json',                 // json, syslog, or cef
  logToConsole: true,
  maxLogSize: 10000,              // Rotate after 10k entries
  
  onSecurityEvent: async (event) => {
    // Send to SIEM or monitoring system
    await sendToSIEM(event);
  }
});

// Automatic logging of security events:
// - Authentication failures/successes
// - Authorization failures
// - Data modifications (create/update/delete)
// - Rate limit violations
// - CSRF attempts
// - Suspicious activities
```

### Querying Audit Logs

```javascript
// Find all authentication failures
const authFailures = await api.queryAuditLogs({
  type: 'AUTH_FAILURE',
  startTime: new Date(Date.now() - 86400000), // Last 24 hours
  severity: 'WARNING'
});

// Get statistics
const stats = await api.getAuditStats();
console.log(stats);
// {
//   total: 1523,
//   byType: { AUTH_FAILURE: 23, DATA_ACCESS: 1200, ... },
//   bySeverity: { INFO: 1400, WARNING: 120, ERROR: 3 },
//   byUser: { 123: 450, 456: 673, ... }
// }
```

## CSRF Protection

Double-submit cookie and synchronizer token patterns.

```javascript
import { CSRFPlugin } from 'json-rest-api/plugins';

api.use(CSRFPlugin, {
  cookie: {
    name: 'csrf-token',
    httpOnly: true,
    secure: true,    // HTTPS only
    sameSite: 'strict'
  },
  header: 'x-csrf-token',
  
  // Exempt certain paths
  exemptPaths: ['/api/auth/login', '/api/public/*'],
  
  // Custom validation
  validateFunction: async (token, request) => {
    // Additional validation logic
    return isValidToken(token);
  }
});

// Client-side usage
const response = await fetch('/api/items', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': getCsrfToken() // From cookie or meta tag
  },
  body: JSON.stringify(data)
});
```

### Framework Integration

```javascript
// Express middleware
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

// In your HTML template
<meta name="csrf-token" content="<%= csrfToken %>">
```

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

## Error Sanitization

**Built into Core** - The API automatically sanitizes error messages in production to prevent information disclosure.

### How It Works

- **Production** (`NODE_ENV=production`): Error messages are sanitized, stack traces removed
- **Development**: Full error details shown for debugging
- **Server errors** (5xx): Logged server-side with full details
- **Client errors** (4xx): Messages preserved as they're meant for users

### Automatic Sanitization

```javascript
// In production, internal errors are sanitized
throw new Error("Cannot read property 'name' of undefined");
// Response: "Invalid request data"

throw new Error("ECONNREFUSED 127.0.0.1:3306");
// Response: "Service temporarily unavailable"

// Client errors (4xx) are not sanitized
throw new NotFoundError('User', '123');
// Response: "User with id '123' not found"
```

### Configuration Options

```javascript
// Via HTTP plugin
api.use(HTTPPlugin, {
  // Control sanitization behavior
  errorSanitization: true,      // Always sanitize
  forceProductionErrors: true,  // Force production mode
  forceDevelopmentErrors: true  // Force development mode
});

// Via environment variable
process.env.NODE_ENV = 'production'; // Enable sanitization
```

### Error Response Format

**Development Mode**:
```json
{
  "errors": [{
    "status": "500",
    "code": "INTERNAL_ERROR",
    "title": "InternalError",
    "detail": "Cannot read property 'name' of undefined",
    "meta": {
      "timestamp": "2025-01-20T10:30:00.000Z",
      "stack": [
        "TypeError: Cannot read property 'name' of undefined",
        "    at processUser (/app/lib/users.js:45:20)"
      ],
      "context": { "userId": 123 }
    }
  }]
}
```

**Production Mode**:
```json
{
  "errors": [{
    "status": "500",
    "code": "INTERNAL_ERROR",
    "title": "InternalError",
    "detail": "Invalid request data",
    "meta": {
      "timestamp": "2025-01-20T10:30:00.000Z"
    }
  }]
}
```

### Safe Context Fields

In production, only these context fields are included:
- `resourceType` - Type of resource involved
- `field` - Field name for validation errors
- `value` - Field value (only for 4xx errors)
- `limit` - Limit that was exceeded

### Server-Side Logging

In production, 5xx errors are logged server-side with full details:

```javascript
// Automatically logged to console.error
[ERROR] {
  timestamp: '2025-01-20T10:30:00.000Z',
  code: 'INTERNAL_ERROR',
  message: 'Database connection failed: ECONNREFUSED',
  context: { query: 'SELECT * FROM users' },
  stack: 'Error: Database connection failed...'
}
```

## Input Size Validation

**Built into Schema** - Prevent DoS attacks by limiting the size of arrays and objects.

### Array Limits

```javascript
const schema = new Schema({
  tags: {
    type: 'array',
    maxItems: 100,  // Maximum 100 tags
    maxItemsErrorMessage: 'Too many tags (max 100)'
  },
  
  // Without limit - triggers warning
  unlimitedArray: { type: 'array' }
});
```

### Object Limits

```javascript
const schema = new Schema({
  metadata: {
    type: 'object',
    maxKeys: 50,     // Max 50 properties
    maxDepth: 5,     // Max 5 levels deep
    maxKeysErrorMessage: 'Metadata too complex',
    maxDepthErrorMessage: 'Metadata too deeply nested'
  },
  
  // Without limits - triggers warning
  config: { type: 'object' }
});
```

### Automatic Warnings

The schema automatically warns about unlimited fields:

```
⚠️  WARNING: Field 'config' is type 'object' without size limits.
   Consider adding maxKeys and/or maxDepth to prevent DoS attacks:
   config: { type: 'object', maxKeys: 100, maxDepth: 5 }

⚠️  WARNING: Field 'unlimitedArray' is type 'array' without maxItems limit.
   Consider adding maxItems to prevent DoS attacks:
   unlimitedArray: { type: 'array', maxItems: 1000 }
```

### Validation Examples

```javascript
// This will be rejected
const data = {
  tags: Array(200).fill('tag'),  // Exceeds maxItems: 100
  metadata: {
    // 60 properties - exceeds maxKeys: 50
    prop1: 'value1',
    prop2: 'value2',
    // ... prop60
  }
};

// Nested depth validation
const deepData = {
  metadata: {
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              level6: 'too deep!' // Exceeds maxDepth: 5
            }
          }
        }
      }
    }
  }
};
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

## Circular Reference and Prototype Pollution Protection

### Circular Reference Protection

The API automatically detects and prevents circular references that could cause DoS attacks:

```javascript
// This malicious payload would cause infinite recursion
const circular = { name: 'root' };
circular.self = circular;  // Creates a circular reference

// API automatically detects and rejects this
try {
  await api.create('posts', {
    title: 'Test',
    metadata: circular  // Will be rejected
  });
} catch (error) {
  // Error: Circular reference detected in field 'metadata'
}
```

**How it works:**
- Uses a Set to track visited objects during traversal
- Detects cycles before they cause stack overflow
- Provides clear error messages indicating the problematic field
- No performance impact on normal operations

### Prototype Pollution Protection

The API prevents prototype pollution attacks that could compromise application security:

```javascript
// These attack payloads are automatically sanitized
const attacks = [
  { "__proto__": { "isAdmin": true } },
  { "constructor": { "prototype": { "isAdmin": true } } },
  { "a": { "__proto__": { "isAdmin": true } } }  // Nested attempts
];

// All dangerous keys are removed during validation
for (const payload of attacks) {
  const cleaned = await api.create('posts', payload);
  // __proto__, constructor, and prototype keys are stripped
}
```

**Protected keys:**
- `__proto__`
- `constructor`
- `prototype`
- Any variations with different casing

**Deep protection:**
- Recursively checks all nested objects
- Removes dangerous keys at any depth
- Works with arrays of objects
- No false positives on legitimate data

### Safe Object Validation

The validation system ensures objects are safe before processing:

```javascript
const schema = new Schema({
  config: {
    type: 'object',
    maxKeys: 50,     // Prevent memory exhaustion
    maxDepth: 5,     // Prevent deep nesting attacks
    validate: (obj) => {
      // Custom validation runs after security checks
      return true;
    }
  }
});
```

**Protection layers:**
1. Circular reference check (first)
2. Prototype pollution sanitization
3. Size and depth limits
4. Custom validation (last)

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
   - Deep object validation prevents nested pollution attempts

3. **XSS Prevention**
   - Input sanitization escapes HTML entities
   - Content-Type headers prevent MIME sniffing

4. **Circular Reference Protection**
   - Automatic detection of circular references in JSON
   - Prevents DoS attacks from infinite recursion
   - Safe handling with clear error messages

5. **ReDoS Protection**
   - Built-in email validation with safe regex patterns
   - Timeout detection for potentially malicious patterns
   - Pre-compiled patterns for better performance

## JSON:API Compliance and Security

The HTTPPlugin provides security features through JSON:API compliance:

### Strict Mode Security

Enable strict JSON:API mode to enforce security best practices:

```javascript
api.use(HTTPPlugin, {
  strictJsonApi: true,  // Enable strict mode
  
  // Additional security options
  validateContentType: true,
  errorSanitization: true
});
```

**Security Benefits:**

1. **Content-Type Validation**
   - Prevents CSRF attacks by enforcing `application/vnd.api+json`
   - Rejects requests with incorrect Content-Type (415 error)
   
2. **Parameter Whitelisting**
   - Only allows known JSON:API parameters
   - Prevents parameter pollution attacks
   - Returns 400 error for unknown parameters
   
3. **Structured Error Responses**
   - Never exposes internal error details in production
   - Consistent error format prevents information leakage
   - Source pointers help debugging without exposing internals

### Enhanced Error Security

Errors are automatically sanitized in production:

```javascript
// Development shows full details:
{
  "errors": [{
    "status": "500",
    "code": "DATABASE_ERROR",
    "detail": "ER_NO_SUCH_TABLE: Table 'mydb.users' doesn't exist",
    "meta": {
      "stack": ["at Connection.query...", "..."],
      "sql": "SELECT * FROM users WHERE id = ?"
    }
  }]
}

// Production shows safe message:
{
  "errors": [{
    "status": "500",
    "code": "INTERNAL_ERROR",
    "detail": "An error occurred processing your request",
    "meta": {
      "timestamp": "2024-01-15T10:30:00Z"
    }
  }]
}
```

### Query Security with Advanced Operators

The new filter operators include built-in protections:

1. **SQL Injection Prevention**
   - All operators use parameterized queries
   - Values are never interpolated into SQL
   
2. **Type Validation**
   - Operators validate input types
   - Array operators check for valid arrays
   - Range operators verify two values
   
3. **Safe Pattern Matching**
   - LIKE patterns are escaped automatically
   - Prevents wildcard injection attacks

Example of safe filtering:
```javascript
// These are all safe - values are parameterized:
GET /api/users?filter[email][ilike]=%admin%
GET /api/posts?filter[tags][contains]=javascript
GET /api/orders?filter[total][between]=100,500
```

## Security Checklist

### Development

- [ ] Enable SecurityPlugin with default settings
- [ ] Use strict type validation (default)
- [ ] Implement authentication (JWT recommended)
- [ ] Set up authorization rules
- [ ] Enable audit logging
- [ ] Use HTTPS in development (self-signed cert)
- [ ] Test with authentication enabled
- [ ] Verify CORS configuration
- [ ] Check field permissions

### Pre-Production

- [ ] Configure rate limiting with Redis
- [ ] Set strong JWT secrets (min 32 chars)
- [ ] Review CSP directives
- [ ] Test error sanitization
- [ ] Configure audit log retention
- [ ] Implement CSRF protection
- [ ] Security scan dependencies
- [ ] Enable all security headers
- [ ] Test refresh token rotation
- [ ] Verify prototype pollution protection
- [ ] Check SQL injection prevention
- [ ] Test XSS sanitization

### Production

- [ ] **JWT_SECRET** environment variable set (min 32 characters)
- [ ] **CORS_ORIGINS** environment variable configured
- [ ] HTTPS enforced (via load balancer or reverse proxy)
- [ ] Rate limiting configured with Redis
- [ ] Database credentials secured
- [ ] Error messages don't leak sensitive information
- [ ] Monitoring/alerting for security events
- [ ] Use environment variables for secrets
- [ ] Enable HSTS with preload
- [ ] Configure proper CORS origins
- [ ] Set up monitoring for audit logs
- [ ] Implement log shipping to SIEM
- [ ] Regular security updates
- [ ] Incident response plan

### Code Review

- [ ] No hardcoded secrets or credentials
- [ ] All user input validated
- [ ] Permissions checked before operations
- [ ] Sensitive fields marked as `silent`
- [ ] Proper error handling (no stack traces in production)
- [ ] XSS protection enabled for all string inputs
- [ ] SQL injection prevention for all queries
- [ ] Prototype pollution checks in place
- [ ] Type coercion prevention (strict mode)
- [ ] CSRF tokens validated for state-changing operations
- [ ] Rate limiting configured appropriately
- [ ] Audit logging for security events

### Deployment

- [ ] Environment variables properly set
- [ ] Database access restricted
- [ ] Firewall rules configured
- [ ] Regular security updates
- [ ] Backup and recovery plan
- [ ] Security headers configured
- [ ] Distributed rate limiting with Redis
- [ ] Audit log retention policy
- [ ] SIEM integration for audit logs
- [ ] Refresh token rotation enabled
- [ ] CSRF protection enabled
- [ ] Monitor for suspicious activities

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

## Best Practices

### 1. Defense in Depth

```javascript
// Layer multiple security measures
api.use(SecurityPlugin);      // XSS, headers, rate limiting
api.use(JWTPlugin);           // Authentication
api.use(AuthorizationPlugin); // Authorization  
api.use(AuditLogPlugin);      // Monitoring
api.use(CSRFPlugin);          // CSRF protection
```

### 2. Principle of Least Privilege

```javascript
// Grant minimal necessary permissions
api.use(AuthorizationPlugin, {
  roles: {
    viewer: ['resource.read'],
    editor: ['resource.read', 'resource.update'],
    admin: ['resource.*']
  },
  defaultRole: 'viewer' // Start with minimal access
});
```

### 3. Input Validation

```javascript
// Validate all inputs strictly
api.addResource('users', {
  email: {
    type: 'string',
    required: true,
    pattern: /^[\w\-\.]+@([\w\-]+\.)+[\w\-]{2,}$/,
    maxLength: 255
  },
  age: {
    type: 'number',
    min: 0,
    max: 150
  }
});
```

### 4. Secure Defaults

```javascript
// The library provides secure defaults:
// - XSS protection: ON
// - Type coercion: OFF (strict mode)
// - Security headers: ON
// - Error details in production: OFF
```

### 5. Regular Updates

```bash
# Check for security updates
npm audit

# Update dependencies
npm update

# Fix vulnerabilities
npm audit fix
```

## Compliance

The security features help meet common compliance requirements:

- **OWASP Top 10**: Protection against common vulnerabilities
- **GDPR**: Audit logging and data protection
- **PCI DSS**: Secure data handling and access controls
- **SOC 2**: Comprehensive audit trails
- **HIPAA**: Encryption and access controls

## Summary

The JSON REST API library provides comprehensive security features that are easy to enable and configure. By following this guide and enabling the recommended security plugins, you can build APIs that are secure by default and meet enterprise security requirements.

Remember: Security is not a feature, it's a process. Regularly review and update your security measures, monitor your audit logs, and stay informed about new threats and best practices.

---

**← Previous**: [Examples](./GUIDE_6_Examples.md)
**→ Next**: [API Gateway](./GUIDE_8_API_Gateway.md)