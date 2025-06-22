# Security Guide

This guide covers the comprehensive security features implemented in the JSON REST API library.

## Table of Contents

1. [Overview](#overview)
2. [XSS Protection](#xss-protection)
3. [SQL Injection Prevention](#sql-injection-prevention)
4. [Prototype Pollution Protection](#prototype-pollution-protection)
5. [Rate Limiting](#rate-limiting)
6. [Authentication & Authorization](#authentication--authorization)
7. [CSRF Protection](#csrf-protection)
8. [Security Headers](#security-headers)
9. [Audit Logging](#audit-logging)
10. [Best Practices](#best-practices)

## Overview

The JSON REST API library implements defense-in-depth security with multiple layers of protection:

- **Input Validation**: Comprehensive validation and sanitization
- **Output Encoding**: Automatic XSS protection  
- **Access Control**: Role-based permissions and field-level security
- **Rate Limiting**: Distributed rate limiting with Redis support
- **Audit Logging**: Security event tracking and monitoring
- **Secure Defaults**: Security-first configuration

## XSS Protection

### Automatic Sanitization

All string inputs are automatically sanitized using DOMPurify:

```javascript
api.use(SecurityPlugin); // Enables XSS protection

// Dangerous inputs are automatically cleaned
const result = await api.insert({
  title: '<script>alert("XSS")</script>My Post',
  content: 'Click here: javascript:alert("XSS")'
}, { type: 'posts' });

// Result:
// title: "My Post"
// content: "Click here: "
```

### Protection Features

- Strips all HTML tags and attributes
- Removes dangerous URL schemes (javascript:, data:, vbscript:)
- Sanitizes nested objects and arrays
- Protects against stored XSS

## SQL Injection Prevention

### Parameterized Queries

All database queries use parameterized statements:

```javascript
// Safe - uses parameterized queries
const results = await api.query({
  filter: { name: "'; DROP TABLE users; --" }
}, { type: 'users' });
```

### Input Validation

Filter values are validated based on field types:

```javascript
api.addResource('accounts', {
  balance: { type: 'number', searchable: true },
  status: { type: 'string', searchable: true, pattern: '^[a-zA-Z]+$' }
});

// This will be rejected - invalid number
await api.query({
  filter: { balance: "'; DELETE FROM accounts; --" }
}, { type: 'accounts' });
```

### Advanced Operator Validation

```javascript
// Safe operator usage
const results = await api.query({
  filter: {
    price: { gte: 100, lte: 1000 },
    name: { like: '%product%' },
    tags: { in: ['electronics', 'gadgets'] }
  }
}, { type: 'products' });
```

## Prototype Pollution Protection

### Deep Object Validation

```javascript
// These attacks are blocked
const maliciousPayloads = [
  { __proto__: { isAdmin: true } },
  { constructor: { prototype: { isAdmin: true } } },
  { data: { __proto__: { __proto__: { isAdmin: true } } } }
];

for (const payload of maliciousPayloads) {
  // Throws: "Potential prototype pollution detected"
  await api.insert(payload, { type: 'items' });
}
```

### Protection Features

- Blocks dangerous property chains
- Validates nested objects recursively
- Prevents object descriptor manipulation
- Maximum nesting depth limits

## Rate Limiting

### Basic Configuration

```javascript
api.use(SecurityPlugin, {
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many requests'
  }
});
```

### Distributed Rate Limiting

```javascript
api.use(SecurityPlugin, {
  rateLimit: {
    redis: {
      host: 'localhost',
      port: 6379,
      password: 'your-redis-password'
    }
  }
});
```

### Custom Key Generation

```javascript
api.use(SecurityPlugin, {
  rateLimit: {
    keyGenerator: (req) => {
      // Rate limit by API key instead of IP
      return req.headers['x-api-key'] || req.ip;
    }
  }
});
```

### Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-20T15:30:00.000Z
Retry-After: 60 (when rate limited)
```

## Authentication & Authorization

### JWT with Refresh Token Rotation

```javascript
api.use(JwtPlugin, {
  secret: process.env.JWT_SECRET,
  refreshExpiresIn: '30d',
  rotateRefreshTokens: true // Enable rotation
});

// Generate tokens
const accessToken = await api.generateToken({ userId: 123 });
const refreshToken = await api.generateRefreshToken(123);

// Refresh with rotation
const { accessToken: newAccess, refreshToken: newRefresh } = 
  await api.refreshAccessToken(refreshToken);
```

### Secure _skipAuth Flag

The `_skipAuth` flag now requires `_internal` to prevent bypass:

```javascript
// This is blocked (no _internal flag)
await api.get(id, { 
  type: 'secrets',
  _skipAuth: true  
});

// This works (internal system call)
await api.get(id, {
  type: 'secrets',
  _skipAuth: true,
  _internal: true
});
```

### Role-Based Access Control

```javascript
api.use(AuthorizationPlugin, {
  roles: {
    admin: ['*'],
    editor: ['posts.*', 'comments.*'],
    viewer: ['*.read']
  },
  resources: {
    secrets: {
      permissions: {
        read: 'admin',
        create: 'admin',
        update: 'admin',
        delete: 'admin'
      }
    }
  }
});
```

## CSRF Protection

### Double-Submit Cookie

```javascript
api.use(CsrfPlugin, {
  mode: 'double-submit',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: true
  }
});

// Client-side usage
const tokenResponse = await fetch('/api/csrf-token');
const { token } = await tokenResponse.json();

await fetch('/api/items', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'New item' })
});
```

### Synchronizer Token Pattern

```javascript
api.use(CsrfPlugin, {
  mode: 'synchronizer',
  sessionStore: redisStore
});
```

### Bypass for API Tokens

CSRF is automatically bypassed for Bearer token authentication:

```javascript
// No CSRF required with API token
await fetch('/api/items', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-api-token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'New item' })
});
```

## Security Headers

The following headers are automatically set:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
X-Permitted-Cross-Domain-Policies: none
X-Download-Options: noopen
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; ...
```

## Audit Logging

### Configuration

```javascript
api.use(AuditLogPlugin, {
  logAuthFailures: true,
  logDataModification: true,
  logSecurityViolations: true,
  onSecurityEvent: async (event) => {
    // Send to SIEM or monitoring service
    await sendToSiem(event);
  }
});
```

### Event Types

- `AUTH_FAILURE` - Failed authentication attempts
- `AUTH_SUCCESS` - Successful authentications
- `AUTHZ_FAILURE` - Authorization denials
- `RATE_LIMIT_EXCEEDED` - Rate limit violations
- `DATA_ACCESS` - Data read operations
- `DATA_CREATE/UPDATE/DELETE` - Data modifications
- `AUTH_BYPASS_ATTEMPT` - Suspicious auth bypass attempts
- `CSRF_TOKEN_INVALID` - CSRF violations
- `SECURITY_VIOLATION` - Other security events

### Querying Audit Logs

```javascript
// Get recent security events
const events = await api.queryAuditLogs({
  type: 'AUTH_FAILURE',
  severity: 'WARNING',
  start: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
});

// Get statistics
const stats = await api.getAuditStats();
console.log(stats);
// {
//   total: 1543,
//   byType: { AUTH_FAILURE: 23, DATA_ACCESS: 1420, ... },
//   bySeverity: { WARNING: 45, INFO: 1498 },
//   byUser: { '123': 234, '456': 189, ... }
// }
```

## Best Practices

### 1. Environment Configuration

```bash
# Production settings
NODE_ENV=production
JWT_SECRET=long-random-secret-key
REDIS_URL=redis://localhost:6379
```

### 2. Strict Schema Validation

```javascript
const schema = new Schema({
  email: { 
    type: 'string', 
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    strictString: true // No type coercion
  },
  age: {
    type: 'number',
    min: 0,
    max: 150,
    strictNumber: true // Must be actual number
  }
}, {
  strictMode: true // Global strict mode
});
```

### 3. Field-Level Security

```javascript
api.addResource('users', {
  email: { 
    type: 'string',
    permission: 'users.read.email' // Role-based visibility
  },
  ssn: {
    type: 'string',
    silent: true, // Never included in responses
    permission: 'admin'
  }
});
```

### 4. Monitoring and Alerting

```javascript
api.use(AuditLogPlugin, {
  onSecurityEvent: async (event) => {
    // Critical events
    if (event.severity === 'CRITICAL') {
      await sendAlert({
        to: 'security-team@example.com',
        subject: `Critical Security Event: ${event.type}`,
        body: JSON.stringify(event, null, 2)
      });
    }
    
    // Suspicious patterns
    if (event.type === 'AUTH_FAILURE') {
      const recentFailures = await api.queryAuditLogs({
        type: 'AUTH_FAILURE',
        userId: event.userId,
        start: new Date(Date.now() - 5 * 60 * 1000) // 5 minutes
      });
      
      if (recentFailures.length > 5) {
        // Possible brute force attack
        await blockUser(event.userId);
      }
    }
  }
});
```

### 5. Regular Security Testing

Run the comprehensive security test suite:

```bash
# Run all security tests
./tests/security/run-all-security-tests.js

# Run with MySQL backend
MYSQL_USER=root MYSQL_PASSWORD=pass RUN_MYSQL_TESTS=true \
  ./tests/security/run-all-security-tests.js
```

### 6. Dependency Scanning

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Use Snyk for continuous monitoring
npm install -g snyk
snyk test
```

## Security Checklist

- [ ] Enable all security plugins (Security, JWT, Authorization, CSRF, AuditLog)
- [ ] Configure rate limiting with Redis for production
- [ ] Use HTTPS in production (required for security headers)
- [ ] Set strong JWT secrets and rotate them periodically
- [ ] Enable strict schema validation
- [ ] Configure field-level permissions for sensitive data
- [ ] Set up audit log monitoring and alerting
- [ ] Regular security testing and dependency updates
- [ ] Review and update CORS configuration
- [ ] Implement proper error handling (no stack traces in production)
- [ ] Use environment variables for sensitive configuration
- [ ] Enable CSRF protection for state-changing operations
- [ ] Monitor rate limit violations for potential attacks
- [ ] Review audit logs regularly for suspicious patterns
- [ ] Keep the library and all dependencies up to date

## Incident Response

If you detect a security incident:

1. **Immediate Actions**
   - Review audit logs for the time period
   - Check rate limiting logs for anomalies
   - Identify affected users/resources

2. **Containment**
   - Block suspicious IPs/users
   - Revoke compromised tokens
   - Increase rate limits temporarily

3. **Investigation**
   ```javascript
   // Query audit logs for investigation
   const suspiciousEvents = await api.queryAuditLogs({
     severity: ['WARNING', 'CRITICAL'],
     start: incidentStartTime,
     end: incidentEndTime
   });
   ```

4. **Recovery**
   - Reset affected user credentials
   - Review and patch any vulnerabilities
   - Update security configurations

5. **Post-Incident**
   - Document the incident
   - Update security procedures
   - Implement additional monitoring

## Compliance

The security features help meet various compliance requirements:

- **GDPR**: Audit logging, data access controls, encryption support
- **PCI DSS**: Input validation, secure storage, access controls
- **HIPAA**: Audit trails, encryption, access controls
- **SOC 2**: Security monitoring, access controls, audit logging

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Security Headers](https://securityheaders.com/)

---

For security vulnerabilities, please report to: security@example.com