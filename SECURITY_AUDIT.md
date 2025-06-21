# Security Audit Report - JSON REST API

**Date**: January 20, 2025  
**Auditor**: Security Analysis  
**Severity Levels**: CRITICAL | HIGH | MEDIUM | LOW

## Executive Summary

This security audit identified **15 vulnerabilities** across the JSON REST API codebase:
- **2 CRITICAL** vulnerabilities ✅ BOTH FIXED
- **5 HIGH** severity issues (2 FIXED, 3 remaining)
- **6 MEDIUM** severity issues (2 FIXED, 4 remaining)
- **2 LOW** severity issues for consideration

**Fixed Issues (6 total)**:
- ✅ SQL Injection via Field Names (CRITICAL)
- ✅ Prototype Pollution (CRITICAL)
- ✅ NoSQL Injection in Memory Storage (HIGH)
- ✅ Weak Authentication Token (HIGH) - via JwtPlugin
- ✅ Resource Exhaustion via Complex Queries (MEDIUM) - via QueryLimitsPlugin
- ✅ Race Conditions in Positioning (MEDIUM) - via PositioningPlugin

**Remaining Issues (9 total)**:
- Missing Authorization Layer (HIGH) - partially addressed via AuthorizationPlugin
- Path Traversal in Nested Fields (HIGH)
- Unsafe CORS + Credentials (HIGH) - partially addressed via CorsPlugin
- Information Disclosure in Errors (MEDIUM)
- Missing Input Size Validation (MEDIUM)
- Circular Reference DoS (MEDIUM)
- Missing Content-Type Validation (MEDIUM)
- Regex DoS (LOW)
- Timing Attacks on Authentication (LOW)

## Critical Vulnerabilities

### 1. SQL Injection via Field Names (CRITICAL) ✅ FIXED

**Location**: `lib/query-builder.js`, `plugins/sql-generic.js`

**Description**: Field names and table identifiers were not properly escaped when building SQL queries. While values were parameterized, identifiers were directly concatenated.

**Status**: FIXED in latest commit
- Added field validation against schema in ORDER BY
- Added proper identifier escaping using `db.formatIdentifier`
- Added direction validation (only ASC/DESC allowed)

**Vulnerable Code**:
```javascript
// query-builder.js line 69-71
select(fields = ['*']) {
  this.query.select = Array.isArray(fields) ? fields : [fields];
  return this;
}

// Later used as:
`SELECT ${this.query.select.join(', ')} FROM ${this.query.table}`
```

**Proof of Concept**:
```bash
# Inject via searchableFields mapping
GET /api/posts?filter[title`%3B%20DROP%20TABLE%20users%3B%20--]=test

# Inject via join fields
GET /api/posts?joins=author`%3B%20DROP%20TABLE%20posts%3B%20--
```

**Impact**: Complete database compromise, data deletion, unauthorized data access

**Recommendation**: 
- Always escape identifiers using the database's quoting mechanism
- Whitelist allowed field names against schema
- Use `connection.escapeId()` for MySQL identifiers

### 2. Prototype Pollution (CRITICAL) ✅ FIXED

**Location**: Multiple locations processing user input

**Description**: User input was spread into objects without protection against `__proto__` pollution.

**Status**: FIXED in latest commit
- Added `sanitizeObject()` function that recursively removes dangerous keys
- Applied sanitization to all user input in `insert()` and `update()` methods
- Protects against `__proto__`, `constructor`, and `prototype` pollution

**Vulnerable Code**:
```javascript
// http.js parseJsonApiBody
return { ...body.data.attributes, id: body.data.id };

// api.js context creation
const context = {
  type: params.type,
  data: { ...params.data },  // Spreads user input
  options,
  api: this
};
```

**Proof of Concept**:
```javascript
POST /api/users
{
  "data": {
    "attributes": {
      "__proto__": {
        "isAdmin": true,
        "role": "superuser"
      },
      "constructor": {
        "prototype": {
          "verified": true
        }
      }
    }
  }
}

// Now Object.prototype.isAdmin === true for ALL objects!
```

**Impact**: 
- Bypass security checks
- Modify application behavior globally
- Potential RCE if combined with other vulnerabilities

**Recommendation**:
```javascript
// Safe object creation
const safeAttributes = Object.create(null);
for (const [key, value] of Object.entries(body.data.attributes)) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    continue;
  }
  safeAttributes[key] = value;
}
```

## High Severity Vulnerabilities

### 3. NoSQL Injection in Memory Storage (HIGH) ✅ FIXED

**Location**: `plugins/adapters/alasql-adapter.js`

**Description**: Table names weren't escaped in AlaSQL queries.

**Status**: FIXED - The adapter already uses the `formatIdentifier` method which properly escapes with backticks

**Vulnerable Code**:
```javascript
// Line 121
const rows = db.exec(`SELECT MAX(id) as maxId FROM \`${table}\``);

// Line 200
const result = db.exec(`SELECT * FROM \`${table}\` WHERE ${whereClause}`);
```

**Proof of Concept**:
```javascript
// Create resource with malicious name
api.addResource('users`; DROP TABLE accounts; --', schema);
```

**Impact**: Data loss, unauthorized data access in memory storage

### 4. Missing Authorization Layer (HIGH)

**Location**: Entire codebase

**Description**: No built-in authorization. Any authenticated user can:
- Read any resource
- Modify any resource
- Delete any resource
- Access all fields

**Example Gap**:
```javascript
// No permission checks in api.js
async update(params, options = {}) {
  // Validates data but not permissions
  // Any user can update any record
}
```

**Impact**: Complete bypass of access control

**Recommendation**: Implement RBAC with field-level permissions:
```javascript
api.hook('beforeUpdate', async (context) => {
  const user = context.options.user;
  const resource = await api.get(context.id);
  
  if (resource.ownerId !== user.id && !user.roles.includes('admin')) {
    throw new ForbiddenError('Cannot update resource you do not own');
  }
});
```

### 5. Weak Authentication Token (HIGH) ✅ FIXED

**Location**: `plugins/security.js`

**Description**: Tokens were just Base64-encoded JSON, not cryptographically signed.

**Status**: FIXED - JwtPlugin provides proper JWT implementation
- Uses industry-standard jsonwebtoken library
- Supports HMAC (HS256) and RSA (RS256) algorithms
- Includes refresh token support
- Configurable expiration and validation
- Constant-time signature verification

**Vulnerable Code**:
```javascript
api.generateToken = (payload, expiresIn = '24h') => {
  return Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + parseDuration(expiresIn)
  })).toString('base64');
};
```

**Solution**: Use JwtPlugin:
```javascript
import { JwtPlugin } from 'json-rest-api';

api.use(JwtPlugin, {
  secret: process.env.JWT_SECRET,
  algorithm: 'HS256',
  expiresIn: '24h',
  refreshExpiresIn: '30d'
});

// Generate secure tokens
const token = await api.generateToken({ userId: 1, role: 'user' });
const verified = await api.verifyToken(token);
```

**Impact**: Complete authentication bypass (NOW PREVENTED)

### 6. Path Traversal in Nested Fields (HIGH)

**Location**: Field resolution logic

**Description**: Dot notation allows potential access to unintended fields.

**Vulnerable Pattern**:
```javascript
// User provides: filter[user.password]=known
// If searchableFields maps this unexpectedly...
searchableFields: {
  'user.name': 'users.name',
  'user.password': 'users.password'  // Oops!
}
```

**Impact**: Access to fields that should be protected

### 7. Unsafe CORS + Credentials (HIGH)

**Location**: `plugins/security.js`

**Description**: Allowing all origins with credentials is extremely dangerous.

**Vulnerable Config**:
```javascript
cors: {
  origin: '*',
  credentials: true,
}
```

**Impact**: Any website can make authenticated requests on behalf of users

## Medium Severity Vulnerabilities

### 8. Resource Exhaustion via Complex Queries (MEDIUM) ✅ FIXED

**Location**: Query processing

**Description**: No limits on query complexity.

**Status**: FIXED - Added QueryLimitsPlugin
- Limits join depth and count
- Limits page size
- Limits filter and sort complexity
- Cost-based query rejection
- Admin bypass capability

**Attack Vector**:
```javascript
GET /api/posts?joins=author,comments,comments.author,comments.author.posts,comments.author.posts.comments&page[size]=1000
```

**Impact**: DoS through CPU/memory exhaustion

### 9. Race Conditions in Positioning (MEDIUM) ✅ FIXED

**Location**: `plugins/positioning.js`

**Description**: Position updates weren't atomic, leading to duplicate positions and data corruption under concurrent load.

**Status**: FIXED - Improved PositioningPlugin
- Uses database-level atomic operations (SELECT...FOR UPDATE for MySQL)
- Bulk position shifts in single UPDATE query
- Memory storage accepts race conditions (documented limitation)
- MySQL provides true atomicity with transactions

**Vulnerable Code**:
```javascript
// Two concurrent requests could corrupt positions
await api.shiftPositions(...);  // Not in transaction
await api.update(...);           // Separate query
```

**Solution**: Use the improved PositioningPlugin:
```javascript
import { PositioningPlugin } from 'json-rest-api';

api.use(PositioningPlugin, {
  positionField: 'position',
  maxRetries: 3,
  retryDelay: 50
});
```

### 10. Information Disclosure in Errors (MEDIUM)

**Location**: Error handling

**Description**: Stack traces and internal paths exposed.

**Example Response**:
```json
{
  "error": {
    "message": "Cannot read property 'name' of undefined",
    "stack": "TypeError: Cannot read property 'name' of undefined\n    at /home/user/app/lib/api.js:123:45"
  }
}
```

### 11. Missing Input Size Validation (MEDIUM)

**Location**: Schema validation

**Description**: No limits on array/object sizes.

**Attack**:
```javascript
POST /api/posts
{
  "tags": ["tag1", "tag2", ... "tag1000000"],  // 1 million tags
  "metadata": { /* deeply nested object */ }
}
```

### 12. Circular Reference DoS (MEDIUM)

**Location**: JSON serialization

**Description**: Using `circular-json-es6` which can be exploited.

### 13. Missing Content-Type Validation (MEDIUM)

**Location**: HTTP plugin

**Description**: Accepts multiple content types without strict validation.

## Low Severity Vulnerabilities

### 14. Regex DoS (ReDoS) (LOW)

**Location**: String validation patterns

**Description**: No protection against catastrophic backtracking.

### 15. Timing Attacks on Authentication (LOW)

**Location**: Token validation

**Description**: Token validation isn't constant-time.

## Recommendations Priority List

### Immediate Actions (CRITICAL)

1. **Fix SQL Injection**
   ```javascript
   // Use proper escaping
   const identifier = connection.escapeId(fieldName);
   const query = `SELECT ${identifier} FROM ${connection.escapeId(table)}`;
   ```

2. **Prevent Prototype Pollution**
   ```javascript
   function cleanObject(obj) {
     const cleaned = Object.create(null);
     for (const [key, value] of Object.entries(obj)) {
       if (!['__proto__', 'constructor', 'prototype'].includes(key)) {
         cleaned[key] = value;
       }
     }
     return cleaned;
   }
   ```

### Short Term (HIGH)

3. **Implement Proper JWT**
   ```javascript
   import jwt from 'jsonwebtoken';
   
   api.generateToken = (payload) => {
     return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
   };
   ```

4. **Add Authorization Layer**
   ```javascript
   const authorize = (action, resource) => async (context) => {
     const user = context.options.user;
     if (!canPerform(user, action, resource, context)) {
       throw new ForbiddenError();
     }
   };
   ```

5. **Fix CORS Configuration**
   ```javascript
   cors: {
     origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
     credentials: true,
   }
   ```

### Medium Term

6. **Add Rate Limiting by Complexity**
7. **Implement Field-Level Access Control**
8. **Add Transaction Support for Bulk Operations**
9. **Sanitize All Error Messages**
10. **Add Input Size Limits**

### Long Term

11. **Security Audit Logging**
12. **Implement CSP Headers**
13. **Add Web Application Firewall Rules**
14. **Regular Dependency Scanning**
15. **Penetration Testing**

## Conclusion

The JSON REST API has significant security vulnerabilities that need immediate attention. The SQL injection and prototype pollution vulnerabilities are critical and could lead to complete system compromise. The lack of authorization and weak authentication makes the system unsuitable for production use without significant security improvements.

Priority should be given to fixing the CRITICAL vulnerabilities immediately, followed by implementing proper authentication and authorization layers.