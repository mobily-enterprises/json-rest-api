# Investigation: belongsTo Without sideLoad

## Summary

**The code REQUIRES both `belongsTo` AND `sideLoad: true` for includes to work.**

Without `sideLoad: true`, the `include` parameter will NOT load the related records into the response's `included` array, even if the relationship is properly defined with `belongsTo`.

## Evidence

### 1. Code Analysis

In `/plugins/core/lib/relationship-includes.js`, the code explicitly checks for BOTH conditions:

```javascript
// Line 783: Checking for belongsTo relationships
if (fieldDef.as === includeName && fieldDef.belongsTo && fieldDef.sideLoad) {
  // Only processes the include if BOTH belongsTo AND sideLoad are true
  await loadBelongsTo(...);
  processed = true;
  break;
}

// Line 845: If not processed (no sideLoad), shows warning
if (!processed) {
  log.warn('[INCLUDE] Relationship not found or not configured for sideLoad:', { scopeName, includeName });
}
```

### 2. Test Results

Created a test (`test-belongsto-without-sideload.js`) that proves:

**Without sideLoad:**
```javascript
department_id: { 
  type: 'number',
  belongsTo: 'departments',
  as: 'department'
  // NO sideLoad: true
}
```
Result:
- Query executes successfully
- Employees found: 3
- Included resources: 0 ❌
- Warning logged: "[INCLUDE] Relationship not found or not configured for sideLoad"

**With sideLoad:**
```javascript
department_id: { 
  type: 'number',
  belongsTo: 'departments',
  as: 'department',
  sideLoad: true  // ADDED
}
```
Result:
- Query executes successfully
- Employees found: 3
- Included resources: 2 ✅
- Departments were included!

### 3. Pattern Analysis

Looking at the codebase:
- **ALL** working examples in tests have `sideLoad: true` on their belongsTo relationships
- The README examples show `sideLoad: true` on belongsTo relationships
- No examples found where belongsTo works for includes without sideLoad

### 4. Other Relationship Types

The same requirement applies to all relationship types:
- `belongsTo` requires `sideLoad: true`
- `hasMany` requires `sideLoad: true`
- `belongsToPolymorphic` requires `sideLoad: true`
- Reverse polymorphic (`hasMany` with `via`) requires `sideLoad: true`

## Implications

1. **Documentation Accuracy**: If the documentation suggests that `belongsTo` alone is sufficient for includes, it's misleading. Users must also add `sideLoad: true`.

2. **Design Decision**: This appears to be intentional - `sideLoad` acts as an explicit opt-in for relationship loading, preventing accidental N+1 queries or loading of unnecessary data.

3. **Relationship Data vs. Included Resources**: Without `sideLoad`, the response will still contain relationship references (e.g., `relationships: { department: { data: { type: 'departments', id: '1' } } }`), but the actual department record won't be in the `included` array.

## Recommendation

The documentation should clearly state that for includes to work, relationships must have BOTH:
1. The relationship definition (`belongsTo`, `hasMany`, etc.)
2. `sideLoad: true` explicitly set

Example:
```javascript
// This will NOT work for includes:
author_id: {
  belongsTo: 'people',
  as: 'author'
}

// This WILL work for includes:
author_id: {
  belongsTo: 'people',
  as: 'author',
  sideLoad: true  // Required for include parameter to work!
}
```