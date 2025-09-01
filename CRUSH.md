# CRUSH.md - JSON REST API Development Guide

## Development Commands
```bash
# Run all tests
npm test

# Run specific test file
node --test tests/relationships.test.js

# Run tests with debug logging
LOG_LEVEL=debug npm test

# Run documentation site
npm run docs
```

## Code Style Guidelines
- **ES Modules**: Use `import/export` syntax (package.json has `"type": "module"`)
- **File Naming**: kebab-case for files, camelCase for functions/variables
- **Error Handling**: Use custom error classes from `lib/rest-api-errors.js`
- **JSON:API Compliance**: All responses must follow JSON:API specification
- **Async/Await**: Prefer async/await over callbacks/promises
- **JSDoc Comments**: Document complex functions with @param and @returns

## Testing Rules (CRITICAL)
- **API Creation**: Only in `before()` hook, never in `beforeEach()`
- **Resource Definition**: NEVER use `api.addResource()` in test files - define in `tests/fixtures/api-configs.js`
- **Data Access**: Use API methods (`api.resources.[resource].get/post/query`), never direct DB queries
- **Context Parameter**: Pass context as SECOND parameter: `api.resources.books.post({inputRecord}, context)`
- **Cleanup**: Use `cleanTables()` in `beforeEach()` to reset data

## Import Patterns
```javascript
// Core imports first
import { validateRelationships } from './lib/querying-writing/scope-validations.js';

// Hook imports
import compileResourceSchemas from './rest-api-plugin-hooks/compile-resource-schemas.js';

// Method imports
import queryMethod from './rest-api-plugin-methods/query.js';
```

## Error Handling
- Use `RestApiValidationError` for validation failures
- Use `RestApiResourceError` for resource-related errors
- Use `RestApiPayloadError` for malformed payloads
- Always include descriptive error messages

## JSON:API Helpers
- Use `createJsonApiDocument()` for creating request payloads
- Use `createRelationship()` for belongsTo relationships
- Use `createToManyRelationship()` for hasMany relationships
- Use `validateJsonApiStructure()` to validate responses