# WebSocket Implementation Status and Next Steps

## Current Status (As of Session End)

### What Has Been Completed

1. **REST API Plugin Refactoring**
   - ✅ The `checkPermissions` method has been refactored to use explicit parameters instead of `parentContext`
   - ✅ All 6 REST API method calls to `checkPermissions` have been updated:
     - QUERY: Passes `method: 'query'`, `auth`, `transaction`
     - GET: Passes `method: 'get'`, `auth`, `id`, `transaction`
     - POST: Passes `method: 'post'`, `auth`, `transaction`
     - PUT: Passes `method: 'put'`, `auth`, `id`, `attributes`, `isUpdate`, `transaction`
     - PATCH: Passes `method: 'patch'`, `auth`, `id`, `attributes`, `transaction`
     - DELETE: Passes `method: 'delete'`, `auth`, `id`, `transaction`

2. **Understanding Gained**
   - The Socket.io plugin currently listens to `afterDataWrite` hook which **DOES NOT EXIST**
   - The correct hook to use is `finish` which fires after `context.returnRecord` is set
   - When `returnFullRecord` is true, the REST API already fetches the full record via `get`
   - Socket.io stores subscription data in `socket.data.subscriptions` (in-memory per connection)

### What Needs to Be Done

## CRITICAL ISSUES TO FIX

### 1. **Fix the Broken Hook (URGENT)**
The Socket.io plugin is currently broken because it listens to a non-existent hook:
```javascript
// LINE 208 - THIS IS BROKEN:
addHook('afterDataWrite', 'socketio-broadcast', {}, async (result) => {
```

This needs to be changed to:
```javascript
addHook('finish', 'socketio-broadcast', {}, async (result) => {
```

### 2. **Update Permission Checking**
The plugin currently uses the old auth helper pattern (lines 118-122, 259-263):
```javascript
// OLD WAY (lines 259-263) - NEEDS TO BE REPLACED:
const hasPermission = await helpers.auth.checkPermission(
  { auth: socket.data.auth },
  readRules,
  { existingRecord: record, scopeVars: scope.vars }
);
```

This should be replaced with the new scope method:
```javascript
// NEW WAY:
const hasPermission = await scope.checkPermissions({
  method: 'get',
  auth: socket.data.auth,
  id: record.id,
  attributes: record
});
```

### 3. **Add Include/Fields Support**
Currently, the subscription storage (line 142-147) doesn't store `include` and `fields`:
```javascript
// CURRENT (missing include/fields):
socket.data.subscriptions.set(subId, {
  resource,
  filters,
  roomName,
  createdAt: new Date()
});
```

Need to update to:
```javascript
// NEEDED:
socket.data.subscriptions.set(subId, {
  resource,
  filters,
  include: data.include,  // ADD THIS
  fields: data.fields,    // ADD THIS
  roomName,
  createdAt: new Date()
});
```

## DETAILED IMPLEMENTATION PLAN

### Step 1: Fix the Hook and Basic Structure

Replace the entire `afterDataWrite` hook (starting at line 208) with:

```javascript
// Hook into REST API finish hook for broadcasting
addHook('finish', 'socketio-broadcast', {}, async (result) => {
  const { scopeName, context } = result;
  
  // Skip if this is not a write operation
  if (!['post', 'put', 'patch', 'delete'].includes(context.method)) {
    return result;
  }
  
  // Skip if no context.id (might happen in error cases)
  if (!context.id && context.method !== 'delete') {
    return result;
  }
  
  // ... rest of implementation
});
```

### Step 2: Implement Smart Record Fetching

Inside the hook, implement logic that:
1. Checks if we already have the full record from `context.returnRecord`
2. Only calls `get` if we need different includes/fields than what's already available
3. Uses the record for filtering before sending

```javascript
// Determine if we already have a full record from returnFullRecord
const hasFullRecord = context.returnRecord && 
                     context.returnRecord.data && 
                     context.returnRecord.data.attributes;

// For filtering, we need the record attributes
let recordForFiltering;
if (context.method === 'delete') {
  // For delete, we might need to fetch the record that was deleted
  recordForFiltering = context.existingRecord || {};
} else if (hasFullRecord) {
  recordForFiltering = { 
    ...context.returnRecord.data.attributes,
    id: context.returnRecord.data.id 
  };
} else {
  // We only have the ID, fetch minimal record for filtering
  recordForFiltering = await helpers.dataGetMinimal({
    scopeName,
    context: { id: context.id },
    transaction: context.transaction
  });
}
```

### Step 3: Process Each Subscription

For each socket subscription:
1. Check if record matches filters
2. Determine if we can reuse `context.returnRecord` or need to fetch with specific includes/fields
3. Use the new `checkPermissions` API

```javascript
// Check if we can use the existing returnRecord
const canUseExistingRecord = hasFullRecord && 
  !subscription.include && // No special includes requested
  !subscription.fields;    // No special fields requested

if (canUseExistingRecord) {
  // Check permissions using the new API
  const hasPermission = await scope.checkPermissions({
    method: 'get',
    auth: socket.data.auth,
    id: context.id,
    attributes: recordForFiltering
  });
  
  if (!hasPermission) continue;
  
  responseToSend = context.returnRecord;
} else {
  // Need to fetch with subscription-specific parameters
  try {
    const getContext = {
      auth: socket.data.auth,
      queryParams: {}
    };
    
    // Add include parameter if specified
    if (subscription.include && subscription.include.length > 0) {
      getContext.queryParams.include = subscription.include.join(',');
    }
    
    // Add fields parameter if specified  
    if (subscription.fields) {
      getContext.queryParams.fields = subscription.fields;
    }
    
    // Call get (which handles permissions internally)
    responseToSend = await scope.get(context.id, getContext);
    
    if (!responseToSend) continue;
    
  } catch (error) {
    // Permission denied or other error
    log.debug(`Skipping broadcast to socket ${socket.id}: ${error.message}`);
    continue;
  }
}
```

### Step 4: Update Subscribe Handler

In the `subscribe` handler (starting at line 101), add validation and storage for include/fields:

```javascript
socket.on('subscribe', async (data, callback) => {
  try {
    const { resource, filters = {}, include, fields, subscriptionId } = data;
    
    // ... existing validation ...
    
    // ADD: Validate includes
    if (include && Array.isArray(include)) {
      const validRelationships = Object.keys(scope.relationships || {});
      
      for (const inc of include) {
        const baseName = inc.split('.')[0];
        if (!validRelationships.includes(baseName)) {
          const error = { 
            code: 'INVALID_INCLUDE', 
            message: `Invalid include '${baseName}' for resource '${resource}'` 
          };
          if (callback) callback({ error });
          else socket.emit('subscription.error', { subscriptionId, error });
          return;
        }
      }
    }
    
    // ADD: Validate fields
    if (fields && typeof fields === 'object') {
      for (const [resourceType, fieldList] of Object.entries(fields)) {
        if (!Array.isArray(fieldList)) {
          const error = { 
            code: 'INVALID_FIELDS', 
            message: `Fields for '${resourceType}' must be an array` 
          };
          if (callback) callback({ error });
          else socket.emit('subscription.error', { subscriptionId, error });
          return;
        }
      }
    }
    
    // ... existing permission check (UPDATE TO USE scope.checkPermissions) ...
    
    // Store subscription WITH include and fields
    socket.data.subscriptions.set(subId, {
      resource,
      filters,
      include,    // ADD THIS
      fields,     // ADD THIS
      roomName,
      createdAt: new Date()
    });
```

### Step 5: Update Permission Check in Subscribe

Replace the permission check in the subscribe handler (lines 117-130) with:

```javascript
// Check if user has permission to query this resource
const hasPermission = await scope.checkPermissions({
  method: 'query',
  auth: socket.data.auth
});

if (!hasPermission) {
  const error = { code: 'PERMISSION_DENIED', message: 'You do not have permission to subscribe to this resource' };
  if (callback) callback({ error });
  else socket.emit('subscription.error', { subscriptionId, error });
  return;
}
```

## TESTING CHECKLIST

After implementation, test:

1. **Basic Subscription**
   - Subscribe without include/fields
   - Create/update/delete a record
   - Verify update is received

2. **Include/Fields Subscription**
   - Subscribe with include=['author'] and fields={posts: ['title', 'summary']}
   - Create/update a record
   - Verify only requested fields and relationships are sent

3. **Permission Testing**
   - Subscribe as unauthorized user
   - Create record they shouldn't see
   - Verify no update is sent

4. **Performance Testing**
   - Enable `returnFullRecord: true`
   - Subscribe without special include/fields
   - Verify it reuses the existing record (no extra get call)

## KEY INSIGHTS FOR IMPLEMENTATION

1. **The hook name is critical** - `afterDataWrite` doesn't exist, use `finish`
2. **Leverage existing data** - When `returnFullRecord` is true, reuse that data
3. **Use scope methods** - Call `scope.checkPermissions()` not `helpers.auth.checkPermission()`
4. **Store subscription preferences** - Include and fields must be stored with each subscription
5. **Security first** - Always check permissions before sending updates

## FILES TO UPDATE

1. `/home/merc/Development/hooked-api_and_jsonrestapi/json-rest-api/plugins/core/socketio-plugin.js` - Main implementation
2. `/home/merc/Development/hooked-api_and_jsonrestapi/json-rest-api/README_X_SocketIO.md` - Update docs with include/fields examples

## REFERENCES

- Original WebSocket plan: `/home/merc/Development/hooked-api_and_jsonrestapi/json-rest-api/PLAN_FOR_WEBSOCKETS.md`
- REST API plugin (for reference): `/home/merc/Development/hooked-api_and_jsonrestapi/json-rest-api/plugins/core/rest-api-plugin.js`
- The checkPermissions parameters are documented in the REST API plugin refactor we just completed