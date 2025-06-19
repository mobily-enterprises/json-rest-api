# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Tests
npm test                    # Main test suite
npm run test:mysql          # MySQL tests (needs MYSQL_USER and MYSQL_PASSWORD env vars)
npm run test:all           # All tests

# Examples
node examples/example.js
node examples/example-versioning.js
```

## Architecture

### Plugin-Based Design
```javascript
const api = new Api()
api.use(MySQLPlugin, options)      // Storage plugin first
api.use(ValidationPlugin)          // Auto-validates
api.use(HTTPPlugin, { app })       // HTTP last

api.addResource('users', schema)
await api.resources.users.get(123) // New proxy API
```

### Key Concepts

**Hooks**: Lifecycle events for CRUD operations
- `before*` / `after*` for Insert, Update, Delete, Get, Query
- Context object passes through all hooks
- Priority ordering (lower number = runs first)

**Schema**: Runtime type validation
```javascript
new Schema({
  name: { type: 'string', required: true, min: 2 },
  password: { type: 'string', silent: true }, // Excluded from SELECT
  tags: { type: 'array' },
  metadata: { type: 'object' }
})
```

**Refs & Joins**: Automatic relationship handling
```javascript
authorId: {
  type: 'id',
  refs: {
    resource: 'authors',
    join: {
      eager: true,              // Auto-join
      fields: ['id', 'name'],   // Select specific fields
      preserveId: true          // Keep both ID and object
    }
  }
}
```

**Nested Joins**: `joins: ['authorId.countryId']`

### Implementation Notes

- JSON:API compliant responses
- Automatic MySQL schema sync
- Query builder with smart joins
- Error classes with context
- Resource proxy API for intuitive access
- Version negotiation support

### Plugin Development
```javascript
export const MyPlugin = {
  install(api, options) {
    api.hook('beforeInsert', async (context) => {
      // Modify context.data
    })
    
    api.implement('get', async (context) => {
      // Custom storage implementation
    })
  }
}
```

## Project Structure

```
lib/         # Core files (api.js, schema.js, errors.js, query-builder.js)
plugins/     # Storage & feature plugins
tests/       # Test suites
docs/        # Documentation
examples/    # Example code
```

## Testing

Always run `robustTeardown({ api, connection })` to avoid zombie sockets.

## Code Style

- NO comments unless requested
- Consistency over cleverness
- Intuitive APIs (e.g., `api.resources.users.get()`)
- Fix root causes, not symptoms