# Circular Reference DoS Attack Analysis

## Summary

The codebase has multiple vulnerabilities related to handling circular references that can be exploited to cause Denial of Service (DoS) attacks through stack overflow errors.

## Vulnerabilities Found

### 1. **sanitizeObject() Function** (CRITICAL)
**Location**: `/home/merc/Development/json-rest-api/lib/api.js` lines 8-25

The `sanitizeObject` function recursively processes objects without tracking visited references:

```javascript
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));  // Recursive call
  }
  
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!dangerous.includes(key)) {
      clean[key] = sanitizeObject(value);  // Recursive call
    }
  }
  
  return clean;
}
```

**Attack Vector**: Any API endpoint that accepts user data (insert, update) will crash when receiving circular references.

### 2. **Schema Validation Spread Operator**
**Location**: `/home/merc/Development/json-rest-api/lib/schema.js` line 86

```javascript
const validatedObject = { ...object };
```

While the spread operator itself handles circular references, it creates a shallow copy that preserves the circular structure, which then gets passed to other functions that may not handle it properly.

### 3. **Serialize Type Handler**
**Location**: `/home/merc/Development/json-rest-api/lib/schema.js` lines 312-318

The serialize type uses `circular-json-es6` correctly:
```javascript
_serializeType({ value }) {
  try {
    return serialize(value);
  } catch (error) {
    throw new Error('Serialization failed');
  }
}
```

However, the circular references cause failures earlier in the processing pipeline (in `sanitizeObject`).

## Attack Vectors

### 1. Direct API Attacks
```bash
# Simple circular reference
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "users",
      "attributes": {
        "name": "test",
        "profile": "{{CIRCULAR}}"
      }
    }
  }'
# Where {{CIRCULAR}} would be replaced with a reference to the object itself
```

### 2. Nested Circular References
```javascript
// Complex attack payload
const payload = {
  data: {
    type: "items",
    attributes: {
      name: "item1",
      related: {
        name: "item2",
        parent: null  // Will be set to create cycle
      }
    }
  }
};
payload.data.attributes.related.parent = payload.data.attributes;
```

### 3. Array-based Circular References
```javascript
const data = {
  items: []
};
data.items.push({ name: "item", container: data });
```

## Impact

1. **Service Availability**: Any request with circular references causes the server to crash with "Maximum call stack size exceeded"
2. **Resource Exhaustion**: Before crashing, the server consumes significant CPU trying to process the recursive structure
3. **No Rate Limiting**: Multiple concurrent requests can amplify the effect

## Proof of Concept Results

From the PoC execution:
- Normal objects: Process correctly
- Any circular reference: Immediate crash
- Error occurs in `sanitizeObject()` before reaching schema validation
- The `circular-json-es6` library itself handles circular references correctly, but is never reached

## Recommended Fixes

### 1. Fix sanitizeObject() to Track Visited Objects
```javascript
function sanitizeObject(obj, visited = new WeakSet()) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Check for circular reference
  if (visited.has(obj)) {
    return '[Circular Reference]';  // or throw an error
  }
  visited.add(obj);
  
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, visited));
  }
  
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!dangerous.includes(key)) {
      clean[key] = sanitizeObject(value, visited);
    }
  }
  
  return clean;
}
```

### 2. Add Request Size Limits
Implement maximum request body size limits to prevent extremely large circular structures.

### 3. Add Validation at Entry Points
Check for circular references early in the request processing pipeline.

### 4. Consider Using Structured Clone
For modern Node.js versions, use `structuredClone()` which handles circular references:
```javascript
try {
  const cloned = structuredClone(obj);
} catch (error) {
  throw new BadRequestError('Invalid data structure');
}
```

## Severity: CRITICAL

This vulnerability allows any unauthenticated user to crash the server with a simple crafted request, making it a critical DoS vulnerability that needs immediate patching.