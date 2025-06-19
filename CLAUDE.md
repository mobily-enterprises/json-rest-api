# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT NOTE**: This CLAUDE.md file is intentionally longer than typical context files. The project owner specifically wants comprehensive context preserved here to maintain development continuity across sessions. This extended context is by design and should not be shortened.

## Development Commands

### Running Tests
```bash
# Run the basic test suite
node test-basic.js
```

### Running Examples
```bash
# Basic example with in-memory storage
node docs/example.js

# API versioning example
node docs/example-versioning.js
```

## High-Level Architecture

### Core Architecture Pattern
This library follows a **plugin-based architecture** where functionality is added through plugins that hook into the core API lifecycle. The key architectural pattern is:

```javascript
// 1. Create API instance
const api = createApi()

// 2. Add plugins (order matters!)
api.use(PluginName, options)

// 3. Add resources with schemas
api.addResource('resourceName', schema, hooks)

// 4. Access via new proxy API
api.resources.resourceName.get(id)
```

### Plugin System Architecture
Plugins extend the API through a consistent interface:
- **`install(api, options)`**: Called during plugin registration
- **Hooks**: Plugins register lifecycle hooks (beforeInsert, afterGet, etc.)
- **Implementations**: Plugins can implement storage methods (get, insert, update, delete, query)
- **Dependencies**: Plugins can depend on other plugins

Critical plugin ordering:
1. Storage plugin (Memory or MySQL) must be first
2. Validation is always automatically included
3. HTTP plugin should be last if using Express

### Hook System and Lifecycle
The API provides hooks at every stage of CRUD operations:
- `beforeValidate` → `afterValidate` → `beforeInsert/Update/Delete` → `afterInsert/Update/Delete`
- `beforeGet/Query` → `afterGet/Query` → `transformResult`
- Hooks can modify context, cancel operations, or add computed fields

### Schema System
Schemas use a TypeScript-like syntax but are runtime objects:
```javascript
new Schema({
  fieldName: { type: 'string', required: true, min: 2, max: 100 }
})
```

Types: `string`, `number`, `boolean`, `object`, `array`, `id`, `timestamp`, `json`

Field options:
- `required`: Field must be present
- `min`/`max`: Length/value constraints
- `silent`: Exclude from default SELECT queries (useful for passwords, large fields, internal data)

### Resource Proxy API (NEW)
The library now provides an intuitive proxy API:
- Old: `api.get(123, { type: 'users' })`
- New: `api.resources.users.get(123)`

This proxy is created dynamically when resources are added.

### API Versioning Architecture
The library supports automatic API versioning:
- APIs register with name and version
- Version negotiation happens automatically
- Resources can be defined per version
- Use `Api.get('name', 'version-spec')` to retrieve compatible versions

### Plugin Communication
Plugins communicate through:
1. **Context object**: Passed through all hooks containing request data
2. **API methods**: Plugins can call other API methods
3. **Plugin options**: Configuration passed during `.use()`

### Critical Implementation Details

1. **JSON:API Compliance**: All HTTP responses follow JSON:API specification
2. **Error Handling**: Errors have `status`, `title`, `detail` properties
3. **Query Parameters**: Support for `filter`, `sort`, `page`, `include`
4. **Schema Validation**: Runs automatically unless explicitly skipped
5. **MySQL Schema Sync**: Tables are created/updated automatically based on schemas

### Plugin Development Pattern
When developing new plugins:
```javascript
export default {
  name: 'PluginName',
  install(api, options) {
    // Register hooks
    api.hook('beforeInsert', async (context) => {
      // Modify context
    })
    
    // Implement storage methods if needed
    api.implement('get', async (context) => {
      // Custom get implementation
    })
  }
}
```

### Advanced Refs (Automatic Joins)
The library supports automatic joins through the `refs.join` configuration in schemas:

```javascript
fieldName: {
  type: 'id',
  refs: {
    resource: 'relatedResource',
    join: {
      eager: true,              // Auto-join on all operations
      fields: ['id', 'name'],   // Fields to select
      resourceField: 'author',  // Optional: separate field for data
      preserveId: true,         // Keep both ID and object
      runHooks: true            // Run afterGet hooks on joined data
    }
  }
}
```

#### Nested Joins
Multi-level joins are supported using dot notation:
- `joins: ['authorId.countryId']` - Join author and author's country
- Parent joins are automatically included
- Each level must have `refs.join` configuration
- Validation happens in `parseNestedJoinPaths()` function

Key implementation details:
- Joins are processed in `initializeQuery` hook (MySQL plugin)
- Single-level: `__fieldName__field` prefix
- Nested: `__parentField__nestedField__field` prefix
- `_processJoinedData` processes from innermost level outward
- Hooks execute in correct order (innermost first)
- HTTP plugin converts to JSON:API relationships/included

### Query Builder Architecture
The QueryBuilder (`query-builder.js`) provides:
- Fluent API for SQL construction
- Smart joins using schema refs
- `includeRelated()` for easy field selection
- Support for complex queries with proper escaping
- Schema-aware field selection (respects `silent` fields)

### Testing Approach
- Main test suite: `npm test` (runs tests/test-suite.js)
- MySQL tests: `npm run test:mysql` (requires MySQL server)
- Tests use Node.js built-in test runner (node:test)
- Focus on testing plugin interactions and hook ordering
- All tests use the in-memory plugin for isolation (except MySQL-specific tests)

## Project Organization

- Core files are in `lib/` directory (api.js, errors.js, schema.js, query-builder.js, resource-helper.js)
- Test files are in `tests/` directory
- Documentation files are in `docs/` directory (API.md, GUIDE.md)
- Plugins are in `plugins/` directory

## Key Features

1. **Structured Error Handling System** (`lib/errors.js`)
   - Comprehensive error class hierarchy with ApiError base class
   - Specific error types for different scenarios
   - JSON:API compliant error formatting

2. **Automatic Timestamps Plugin** (`plugins/timestamps.js`)
   - Manages `createdAt` and `updatedAt` fields automatically
   - Configurable field names and formats

3. **Relationship System with `refs`**
   - Define foreign key relationships in schemas
   - Supports automatic joins with advanced configuration

4. **Affected Records System**
   - Three ways to specify affected records in hooks
   - HTTP plugin automatically fetches and includes affected records

5. **Advanced Refs (Automatic Joins)**
   - Configure automatic joins through `refs.join`
   - Support for nested joins using dot notation
   - Eager/lazy loading, field selection, and hook execution

## Code Style Guidelines

- NO comments in code unless specifically requested
- Consistency is paramount
- Prefer intuitive APIs (e.g., `api.resources.users`)
- Practical features over theoretical purity