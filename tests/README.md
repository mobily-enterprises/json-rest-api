# JSON-REST-API Test Suite

This directory contains comprehensive tests for the JSON-REST-API library. All tests follow strict patterns to ensure proper JSON:API compliance and database integrity.

## Test Files

- **rest-api.test.js** - Basic CRUD operations (POST, GET, PATCH, DELETE)
- **relationships.test.js** - One-to-one and many-to-many relationship operations
- **queries.test.js** - Filtering, sorting, and pagination tests
- **fixtures/api-configs.js** - API configuration factories
- **helpers/test-utils.js** - Utility functions for JSON:API validation

## Key Testing Principles

### 1. Strict Mode

All tests MUST use `simplified: false` to ensure JSON:API compliance:

```javascript
const result = await api.resources.resourceName.method({
  inputRecord: jsonApiDocument,
  simplified: false,
  returnFullRecord: true/false  // Based on needs
});
```

### 2. Relationship Handling

Foreign keys must be set via relationships, NOT attributes:

```javascript
// ❌ WRONG - Will fail in strict mode
const bookDoc = createJsonApiDocument('books', {
  title: 'My Book',
  country_id: countryId  // Foreign key in attributes
});

// ✅ CORRECT - Use relationships
const bookDoc = createJsonApiDocument('books',
  { title: 'My Book' },
  {
    country: createRelationship(resourceIdentifier('countries', countryId))
  }
);
```

### 3. Database Operations

Only these Knex operations are allowed directly:

```javascript
// Counting records
const count = await countRecords(knex, 'table_name');

// Cleaning tables between tests
await cleanTables(knex, ['table1', 'table2']);
```

All other operations MUST go through the API.

### 4. API Configuration

Always use the same schema pattern (Countries, Publishers, Authors, Books):

```javascript
// Each API config must use unique table prefixes
tableName: 'basic_countries'  // For basicApi
tableName: 'ext_countries'    // For extendedApi
```

### 5. Search & Sort Configuration

Enable search on fields that need filtering:

```javascript
schema: {
  title: { type: 'string', search: true },
  country_id: { type: 'number', belongsTo: 'countries', as: 'country', search: true }
}
```

Configure sortable fields in plugin options:

```javascript
await api.use(RestApiPlugin, {
  sortableFields: ['id', 'title', 'country_id', 'price']
});
```

## Common Test Patterns

### Creating Resources with Relationships

```javascript
// One-to-one (belongsTo)
const publisherDoc = createJsonApiDocument('publishers',
  { name: 'Publisher Name' },
  {
    country: createRelationship(resourceIdentifier('countries', countryId))
  }
);

// Many-to-many
const bookDoc = createJsonApiDocument('books',
  { title: 'Book Title' },
  {
    authors: createToManyRelationship([
      resourceIdentifier('authors', author1Id),
      resourceIdentifier('authors', author2Id)
    ])
  }
);
```

### Validating Responses

```javascript
// Validate JSON:API structure
validateJsonApiStructure(result, false);  // false = single resource

// Validate attributes
assertResourceAttributes(result.data, {
  name: 'Expected Name',
  code: 'EX'
});

// Validate relationships
assertResourceRelationship(result.data, 'country',
  resourceIdentifier('countries', countryId));
```

### Query Operations

```javascript
// Filtering
const result = await api.resources.books.query({
  queryParams: {
    filters: { language: 'en', price: '9.99' }
  },
  simplified: false
});

// Sorting
const result = await api.resources.books.query({
  queryParams: {
    sort: ['title', '-price']  // title ASC, price DESC
  },
  simplified: false
});

// Pagination
const result = await api.resources.books.query({
  queryParams: {
    page: { number: 2, size: 10 }
  },
  simplified: false
});
```

## Running Tests

```bash
# Run all tests
npm test

# Run all tests against the AnyAPI storage backend
npm run test:anyapi

# Windows PowerShell (AnyAPI run)
$Env:JSON_REST_API_STORAGE = 'anyapi'; npm test

# Run specific test file
npm test -- tests/relationships.test.js

# Run with verbose output
DEBUG=* npm test
```

## Adding New Tests

1. Create test file following naming convention: `feature-name.test.js`
2. Import necessary utilities from `helpers/test-utils.js`
3. Use API configurations from `fixtures/api-configs.js`
4. Follow the established patterns for:
   - Setting up test data
   - Making API calls with `simplified: false`
   - Validating JSON:API responses
   - Cleaning data between tests

## Important Notes

- Tests intentionally generate ERROR logs for validation testing
- All tests should pass with exit code 0
- Database connections are properly closed in `after` hooks
- Pivot table operations use `simplified: true` internally for foreign keys
