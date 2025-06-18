# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Key implementation details:
- Joins are processed in `initializeQuery` hook (MySQL plugin)
- Join data uses `__fieldName__` prefix for field grouping
- `_processJoinedData` in api.js handles result transformation
- Hooks can detect join context via `context.options.isJoinResult`
- HTTP plugin converts to JSON:API relationships/included

### Query Builder Architecture
The QueryBuilder (`query-builder.js`) provides:
- Fluent API for SQL construction
- Smart joins using schema refs
- `includeRelated()` for easy field selection
- Support for complex queries with proper escaping
- Schema-aware field selection (respects `silent` fields)

### Testing Approach
- Use `test-basic.js` for basic functionality
- Use `test-advanced-refs.js` for join testing  
- Tests use the in-memory plugin for isolation
- No specific test framework - uses Node.js assert
- Focus on testing plugin interactions and hook ordering