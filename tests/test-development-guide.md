# Test Development Guide for JSON-REST-API

## Missing tests:

  ⎿  ☒ Plan test structure and API configurations                     
     X Create test file with basic setup and utilities
     X Implement basic CRUD tests (POST, GET, PUT, PATCH, DELETE)
     ? Implement relationship tests (belongsTo, hasMany, many-to-many)
     ? Implement query tests (filtering, sorting, pagination)
     ? Implement include/sideloading tests
     ? Implement sparse fieldsets tests
     ? Implement transaction and error handling tests

This guide provides comprehensive instructions for continuing test development following established patterns.

## Critical Requirements

### 1. Strict Mode is MANDATORY

**NEVER** use `simplified: true` in tests (except internally for pivot operations):

```javascript
// ✅ CORRECT - Always use simplified: false
const result = await api.resources.books.post({
  inputRecord: bookDoc,
  simplified: false  // REQUIRED
});

// ❌ WRONG - Never use simplified: true in tests
const result = await api.resources.books.post({
  inputRecord: bookDoc,
  simplified: true  // FORBIDDEN in tests
});
```

### 2. Foreign Keys via Relationships ONLY

In strict mode, foreign keys MUST be set through relationships:

```javascript
// ❌ WRONG - Foreign key in attributes
const bookDoc = createJsonApiDocument('books', {
  title: 'My Book',
  country_id: 123,        // WILL FAIL!
  publisher_id: 456       // WILL FAIL!
});

// ✅ CORRECT - Foreign keys via relationships
const bookDoc = createJsonApiDocument('books',
  {
    title: 'My Book'  // Only non-foreign-key attributes
  },
  {
    country: createRelationship(resourceIdentifier('countries', countryId)),
    publisher: createRelationship(resourceIdentifier('publishers', publisherId))
  }
);
```

### 3. returnFullRecord Configuration

Control what methods return:

```javascript
// In API configuration
returnFullRecord: {
  post: true,   // Return created record (needed to get ID)
  put: false,   // Don't return after replacement
  patch: false  // Don't return after update
}

// Override per call if needed
const result = await api.resources.books.put({
  id: bookId,
  inputRecord: putDoc,
  simplified: false,
  returnFullRecord: false  // Override to not return
});
```

### 4. Database Operations Rules

**ONLY** these Knex operations are allowed directly:

```javascript
// ✅ ALLOWED - Counting records
const count = await countRecords(knex, 'basic_books');

// ✅ ALLOWED - Cleaning tables between tests
await cleanTables(knex, ['basic_books', 'basic_authors']);

// ❌ FORBIDDEN - Direct queries
const books = await knex('basic_books').select('*');  // NO!

// ❌ FORBIDDEN - Direct inserts
await knex('basic_books').insert({...});  // NO!
```

All data operations MUST go through the API.

## Test Structure Patterns

### Basic Test Setup

```javascript
describe('Feature Name', () => {
  let basicApi;
  let extendedApi;

  before(async () => {
    // Initialize APIs once
    basicApi = await createBasicApi(knex);
    extendedApi = await createExtendedApi(knex);
  });

  after(async () => {
    // CRITICAL: Close database connection
    await knex.destroy();
  });

  describe('Sub-feature', () => {
    beforeEach(async () => {
      // Clean tables before EACH test
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 
        'basic_authors', 'basic_books', 'basic_book_authors'
      ]);
    });

    it('should do something', async () => {
      // Test implementation
    });
  });
});
```

### Creating Test Data

```javascript
// Step 1: Create parent resources first
const countryDoc = createJsonApiDocument('countries', {
  name: 'Test Country',
  code: 'TC'
});
const countryResult = await basicApi.resources.countries.post({
  inputRecord: countryDoc,
  simplified: false
});
const countryId = countryResult.data.id;

// Step 2: Create child resources with relationships
const publisherDoc = createJsonApiDocument('publishers',
  { name: 'Test Publisher' },
  {
    country: createRelationship(resourceIdentifier('countries', countryId))
  }
);
const publisherResult = await basicApi.resources.publishers.post({
  inputRecord: publisherDoc,
  simplified: false
});

// Step 3: Create many-to-many relationships
const bookDoc = createJsonApiDocument('books',
  { title: 'Test Book' },
  {
    country: createRelationship(resourceIdentifier('countries', countryId)),
    publisher: createRelationship(resourceIdentifier('publishers', publisherId)),
    authors: createToManyRelationship([
      resourceIdentifier('authors', author1Id),
      resourceIdentifier('authors', author2Id)
    ])
  }
);
```

### Validation Patterns

```javascript
// 1. Always validate JSON:API structure first
validateJsonApiStructure(result, false);  // false = single resource
validateJsonApiStructure(result, true);   // true = collection

// 2. Validate attributes
assertResourceAttributes(result.data, {
  title: 'Expected Title',
  price: '29.99'
});

// 3. Validate relationships
assertResourceRelationship(result.data, 'publisher',
  resourceIdentifier('publishers', publisherId));

// 4. Validate included resources
assert(result.included, 'Should have included data');
const publisher = result.included.find(r => r.type === 'publishers');
assert(publisher, 'Should include publisher');

// 5. Count database records for verification
const count = await countRecords(knex, 'basic_books');
assert.equal(count, 1, 'Should have created one book');
```

## Common Test Scenarios

### 1. Testing Relationships

```javascript
describe('Relationship Operations', () => {
  it('should update many-to-many relationships', async () => {
    // Create initial relationships
    const bookDoc = createJsonApiDocument('books',
      { title: 'Book with Authors' },
      {
        authors: createToManyRelationship([
          resourceIdentifier('authors', author1Id),
          resourceIdentifier('authors', author2Id)
        ])
      }
    );

    // Update relationships via PATCH
    const patchDoc = {
      data: {
        type: 'books',
        id: String(bookId),
        relationships: {
          authors: createToManyRelationship([
            resourceIdentifier('authors', author2Id),  // Keep this
            resourceIdentifier('authors', author3Id)   // Add this
            // author1 will be removed
          ])
        }
      }
    };

    await basicApi.resources.books.patch({
      id: bookId,
      inputRecord: patchDoc,
      simplified: false
    });

    // Verify pivot table changes
    const pivotCount = await countRecords(knex, 'basic_book_authors');
    assert.equal(pivotCount, 2);
  });
});
```

### 2. Testing Query Operations

```javascript
describe('Query Operations', () => {
  it('should filter and sort with pagination', async () => {
    const result = await api.resources.books.query({
      queryParams: {
        filters: { language: 'en', price: '19.99' },
        sort: ['title', '-published_date'],
        page: { number: 1, size: 10 },
        include: ['publisher', 'authors']
      },
      simplified: false
    });

    validateJsonApiStructure(result, true);
    assert(result.data.length <= 10, 'Should respect page size');
  });
});
```

### 3. Testing Error Conditions

```javascript
describe('Error Handling', () => {
  it('should reject invalid relationships', async () => {
    const bookDoc = createJsonApiDocument('books',
      { title: 'Invalid Book' },
      {
        publisher: createRelationship(resourceIdentifier('publishers', 99999))
      }
    );

    await assert.rejects(
      async () => {
        await api.resources.books.post({
          inputRecord: bookDoc,
          simplified: false
        });
      },
      (err) => {
        return err.code === 'REST_API_RESOURCE' && 
               err.subtype === 'not_found';
      },
      'Should throw not found error for invalid publisher'
    );
  });
});
```

## Schema Configuration for Tests

### Enable Filtering

Add `search: true` to fields that need filtering:

```javascript
schema: {
  title: { type: 'string', required: true, search: true },
  price: { type: 'decimal', precision: 10, scale: 2, search: true },
  country_id: { 
    type: 'number', 
    belongsTo: 'countries', 
    as: 'country', 
    search: true  // Enable filtering on foreign key
  }
}
```

### Enable Sorting

Configure sortable fields in plugin options:

```javascript
await api.use(RestApiPlugin, {
  simplified: false,
  sortableFields: ['id', 'title', 'price', 'published_date'],
  // ... other options
});
```

## Test Data Best Practices

1. **Use descriptive names**: 'Test Book A' instead of 'Book 1'
2. **Create minimal data**: Only what's needed for the test
3. **Clean between tests**: Always use `beforeEach` with `cleanTables`
4. **Store IDs for reuse**: Extract IDs immediately after creation
5. **Use unique prefixes**: 'basic_' vs 'ext_' for table names

## Debugging Tests

```bash
# Run with debug output
DEBUG=* npm test

# Run single test file
npm test -- tests/relationships.test.js

# Check for hanging tests
# Ensure after() hook closes database: await knex.destroy()
```

## Common Pitfalls to Avoid

1. **Forgetting simplified: false** - Will cause validation to fail
2. **Setting foreign keys in attributes** - Use relationships instead
3. **Not cleaning between tests** - Causes data conflicts
4. **Direct database access** - Always use API methods
5. **Not closing database** - Tests will hang
6. **Assuming sort order** - Always specify sort explicitly
7. **Hardcoding IDs** - Always extract from creation responses

## Next Test Suites to Implement

1. **sparse-fieldsets.test.js** - Field selection tests
2. **errors.test.js** - Comprehensive error handling
3. **transactions.test.js** - Transaction rollback tests
4. **validation.test.js** - Schema validation edge cases
5. **polymorphic.test.js** - Polymorphic relationship tests

Each should follow the patterns established in existing tests.