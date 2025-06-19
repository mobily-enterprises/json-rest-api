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
api.use(MemoryPlugin)              // In-memory storage (AlaSQL) - default
// OR
api.use(MySQLPlugin, options)      // MySQL storage
api.use(ValidationPlugin)          // Auto-validates
api.use(HTTPPlugin, { app })       // HTTP last

api.addResource('users', schema)
await api.resources.users.get(123) // New proxy API
```

**Storage Plugins**:
- **MemoryPlugin**: In-memory SQL database using AlaSQL, perfect for development/testing
- **MySQLPlugin**: Production-ready MySQL/MariaDB storage with connection pooling

### Key Concepts

**Hooks**: Lifecycle events for CRUD operations
- `before*` / `after*` for Insert, Update, Delete, Get, Query
- Context object passes through all hooks
- Priority ordering (lower number = runs first)

**Schema**: Runtime type validation
```javascript
new Schema({
  name: { type: 'string', required: true, min: 2, searchable: true },
  password: { type: 'string', silent: true }, // Excluded from SELECT
  tags: { type: 'array' },
  metadata: { type: 'object' },
  status: { type: 'string', searchable: true } // Can filter by this field
})
```

**Searchable Fields**: Enable filtering via query parameters
- Mark fields with `searchable: true` in schema
- Query with `?filter[fieldName]=value`
- Can also define mapped searchable fields in resource options

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

- Always run `robustTeardown({ api, connection })` to avoid zombie sockets
- Tests support both Memory (AlaSQL) and MySQL backends
- Use `DB_TYPE=mysql MYSQL_USER=root MYSQL_PASSWORD=pass npm test` for MySQL
- Default tests use Memory plugin (no setup required)

## Code Style

- NO comments unless requested
- Consistency over cleverness
- Intuitive APIs (e.g., `api.resources.users.get()`)
- Fix root causes, not symptoms

## Important Guidelines

- **ALWAYS update documentation after adding features**: When implementing new functionality, update relevant .md files (README, API, GUIDE, etc.)
- **Document search/filter capabilities**: Any new searchable fields or filter options must be documented
- **Keep examples current**: Update example files when APIs change
- **Test with both backends**: Ensure features work with both Memory and MySQL plugins