# Bulk Shift Feature Documentation

## Overview

The JSON REST API now includes a `shiftPositions` method in the implementation layer that allows efficient bulk updating of position fields. This feature is specifically designed for plugins like PositioningPlugin that need to shift multiple records without triggering individual UPDATE queries for each record.

## API Method

### `api.shiftPositions(type, options)`

Performs a bulk shift operation on position fields.

**Parameters:**
- `type` (string): The resource type to operate on
- `options` (object):
  - `field` (string, required): The position field to update
  - `from` (number, required): Shift positions >= this value
  - `delta` (number, required): Amount to shift by (positive or negative)
  - `filter` (object, optional): Additional filter conditions
  - `excludeIds` (array, optional): Array of IDs to exclude from shifting

**Returns:**
- Object with `shiftedCount` property indicating number of records affected

**Example:**
```javascript
const result = await api.shiftPositions('tasks', {
  field: 'position',
  from: 10,
  delta: 1,
  filter: { categoryId: 'A' },
  excludeIds: ['123']
});
console.log(`Shifted ${result.shiftedCount} records`);
```

## Implementation Details

### MySQL Implementation

The MySQL plugin uses a single SQL UPDATE query to shift all matching records:

```sql
UPDATE `tasks` 
SET `position` = `position` + ? 
WHERE `position` >= ? 
  AND `categoryId` = ? 
  AND id NOT IN (?)
```

This is extremely efficient for large datasets as it's a single database operation.

### Memory Implementation

The Memory plugin iterates through all records in memory and updates matching ones. While this requires iteration, it's still more efficient than triggering individual update hooks for each record.

## Integration with PositioningPlugin

The PositioningPlugin automatically uses `shiftPositions` when available, with a fallback to individual updates for backward compatibility:

```javascript
try {
  // Try bulk shift first
  const result = await api.shiftPositions(type, {
    field: positionField,
    from: fromPosition,
    delta: 1,
    filter: filter,
    excludeIds: excludeId ? [excludeId] : []
  });
} catch (error) {
  // Fall back to individual updates
  // ... existing code ...
}
```

## Performance Benefits

Testing with 100 records showed:
- MySQL bulk shift: ~2ms for 41 records
- Memory bulk shift: ~1ms for 41 records
- Individual updates would require 41 separate UPDATE queries

For larger datasets (1000+ records), the performance difference becomes even more significant.

## Important Notes

1. **Not a Public API**: This method is intended for internal use by plugins. It does not expose mass-update capabilities to end users.

2. **No Hooks**: The `shiftPositions` method bypasses hooks to avoid recursion and performance issues. This is intentional as it's meant for internal position maintenance.

3. **Atomic Operation**: In MySQL, the shift is atomic - either all records are updated or none are.

4. **Filter Support**: The filter parameter allows scoped positioning (e.g., positions within categories).

5. **Exclusion Support**: The excludeIds parameter is crucial for update operations where the record being repositioned should not be shifted.

## Future Enhancements

Potential improvements could include:
- Transaction support for ensuring atomicity across multiple operations
- Batch operations for other bulk updates (with appropriate access controls)
- Support for more complex shift patterns (e.g., shift only even positions)