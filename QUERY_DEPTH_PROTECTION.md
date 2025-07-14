# Query Depth Protection Implementation

## Summary

Implemented query depth protection to prevent malicious deep includes in JSON:API requests. This prevents potential DoS attacks through deeply nested queries like `?include=author.articles.author.articles.author...`.

## Features

- **Configurable depth limit**: Set via `includeDepthLimit` option (default: 3)
- **Request-time validation**: Validates include paths before query execution
- **Clear error messages**: Provides detailed error about which path exceeds the limit
- **Per-path validation**: Each include path is validated independently

## Implementation Details

### Files Modified

1. **`plugins/core/utils/knex-constants.js`**
   - Added `DEFAULT_INCLUDE_DEPTH_LIMIT = 3`

2. **`plugins/core/lib/payload-validators.js`**
   - Added `validateIncludeDepth()` helper function
   - Updated `validateGetPayload()` to accept `maxIncludeDepth` parameter
   - Updated `validateQueryPayload()` to accept `maxIncludeDepth` parameter
   - Validates depth by counting dots in include paths

3. **`plugins/core/rest-api-plugin.js`**
   - Added `includeDepthLimit` configuration option
   - Passes depth limit to validation functions
   - Default value from `DEFAULT_INCLUDE_DEPTH_LIMIT` constant

### Configuration

Set custom depth limit when initializing the REST API plugin:

```javascript
await api.use(RestApiPlugin, {
  includeDepthLimit: 2  // Custom limit (default is 3)
});
```

### Error Format

When a path exceeds the depth limit:

```json
{
  "errors": [{
    "status": "400",
    "title": "Validation Error",
    "detail": "Include path 'author.articles.author.articles' exceeds maximum depth of 3",
    "source": {
      "parameter": "include"
    },
    "meta": {
      "violations": [{
        "field": "include",
        "rule": "max_depth",
        "message": "Path 'author.articles.author.articles' has depth 4, maximum allowed is 3"
      }]
    }
  }]
}
```

### Testing

Created comprehensive test suite in `tests/include-depth-validation.test.js`:
- Tests default depth limit of 3
- Tests custom depth limits
- Tests both query and get endpoints
- Tests edge cases (empty arrays, single-level paths)
- Uses table prefix pattern for different API instances

## Security Benefits

1. **DoS Prevention**: Limits computational complexity of nested queries
2. **Database Protection**: Prevents excessive JOIN operations
3. **Memory Protection**: Limits response payload size
4. **Predictable Performance**: Ensures query complexity stays within bounds

## Usage Examples

### Valid requests (depth ≤ 3):
- `?include=author`
- `?include=author.publisher`
- `?include=author.publisher.country`

### Invalid requests (depth > 3):
- `?include=author.publisher.country.authors` (depth 4)
- `?include=book.author.publisher.country.books` (depth 5)