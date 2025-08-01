# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Development Commands

### Running Tests
```bash
# Run all tests
npm test

# Run a specific test file
node --test tests/relationships.test.js

# Run tests with verbose logging
LOG_LEVEL=debug npm test
```

### Building and Running
This is a library package with no build step required. For development:
```bash
# Install dependencies
npm install

# Run the documentation site locally
npm run docs:dev

## High-Level Architecture

### Project Overview
JSON REST API is a powerful REST API plugin for hooked-api that provides JSON:API-compliant endpoints. It follows a plugin-based architecture where functionality is composed through plugins that extend the core API capabilities.

### Core Architecture Components

1. **Plugin System (hooked-api based)**
   - `RestApiPlugin` - Core REST API functionality, request/response handling
   - `RestApiKnexPlugin` - Database integration using Knex.js
   - `ExpressPlugin` - Express.js HTTP connector
   - Additional plugins for auth, CORS, relationships, positioning, etc.

2. **Resource Definition Pattern**
   Resources are defined with schemas that include:
   - Attributes with validation rules
   - Relationships (belongsTo, hasMany, many-to-many, polymorphic)
   - Computed fields and hidden fields
   - Custom getters/setters

3. **Request Flow**
   - HTTP request → Connector (Express) → REST API Plugin → Database Plugin → Response
   - Each plugin can hook into the request lifecycle for customization

4. **Key Libraries in `plugins/core/lib/`**
   - `knex-json-api-helpers.js` - Core JSON:API transformations
   - `relationship-processor.js` - Handles relationship updates
   - `payload-validators.js` - Request validation
   - `knex-query-helpers.js` - Database query building
   - `simplified-helpers.js` - Simplified API mode transformations

## Testing Guidelines

### CRITICAL: Test Template Usage
When writing tests, ALWAYS use `TEST_TEMPLATE.test.js` as your starting point. Key rules:

1. **API Creation**: Create API instances ONLY in `before()` hook, NOT in `beforeEach()`
2. **Resource Definition**: NEVER use `api.addResource()` in test files. All resources MUST be defined in `tests/fixtures/api-configs.js`
3. **Data Creation**: ALWAYS create test data using API methods (`api.resources.[resource].post()`), NEVER query the database directly
4. **Context Parameter**: Pass context as the SECOND parameter to resource methods: `api.resources.books.post({ inputRecord: doc }, context)`
5. **Cleanup**: Use `cleanTables()` in `beforeEach()` to reset data between tests

### Test Structure Example
```javascript
import { createBasicApi } from './fixtures/api-configs.js';

let api;

describe('Feature Name', () => {
  before(async () => {
    api = await createBasicApi(knex);
  });
  
  beforeEach(async () => {
    await cleanTables(knex, ['basic_countries', 'basic_publishers']);
  });
  
  it('should test something', async () => {
    // Create data using API
    const result = await api.resources.countries.post({
      inputRecord: createJsonApiDocument('countries', { name: 'Test' })
    });
  });
});
```

### Available Test APIs
- `createBasicApi()` - Countries, Publishers, Authors, Books
- `createExtendedApi()` - Additional resources with complex relationships
- `createAuthApi()` - Users, roles, permissions for auth testing

## Important Patterns

### JSON:API Document Creation
```javascript
// Use helper for proper JSON:API structure
const doc = createJsonApiDocument('books', {
  title: 'My Book'
}, {
  relationships: {
    country: createRelationship('countries', '1')
  }
});
```

### Simplified API Mode
The library supports a simplified mode that uses plain objects instead of JSON:API structure:
```javascript
// Simplified mode (when enabled)
const book = await api.resources.books.post({
  inputRecord: { title: 'My Book', country_id: 1 },
  simplified: true
});
```

### Relationship Handling
- BelongsTo: Use `createRelationship()` helper
- HasMany: Use `createToManyRelationship()` helper
- Many-to-Many: Handled automatically through junction tables
- Polymorphic: Requires typeField and idField configuration

## Common Pitfalls to Avoid

1. **Direct Database Access**: Never use `knex('table').select()` in tests
2. **Resource Creation in Tests**: Always define resources in api-configs.js
3. **ID Type Confusion**: SQLite returns numeric IDs, but JSON:API expects strings
4. **Context Placement**: Context is a separate parameter, not inside the first parameter
5. **Cleanup**: Always destroy knex connection in `after()` hook

