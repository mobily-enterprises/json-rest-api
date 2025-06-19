# JSON REST API Test Suite

## Running Tests

### Basic Tests (Memory Storage)

These tests don't require any external dependencies:

```bash
npm test
```

### MySQL Tests

MySQL tests require a running MySQL server and credentials must be provided via environment variables.

#### Required Environment Variables

- `MYSQL_USER` - MySQL username (required)
- `MYSQL_PASSWORD` - MySQL password (required)
- `MYSQL_HOST` - MySQL host (optional, defaults to 'localhost')
- `MYSQL_DATABASE` - Test database name (optional, defaults to 'jsonrestapi_test')

#### Running MySQL Tests

```bash
# Basic MySQL tests with joins
MYSQL_USER=root MYSQL_PASSWORD=yourpass npm run test:mysql

# Comprehensive MySQL tests
MYSQL_USER=root MYSQL_PASSWORD=yourpass npm run test:mysql:comprehensive

# Run all tests
MYSQL_USER=root MYSQL_PASSWORD=yourpass npm run test:all
```

## Test Features

### Schema Synchronization

All MySQL tests use `api.syncDatabase()` to automatically create tables based on Schema definitions. This ensures:

1. Tables are created with correct structure
2. Foreign key constraints are properly set up
3. Indexes are created as defined in the schema
4. The database schema always matches the code

### Automatic Cleanup

Tests perform proper cleanup:

- Each test suite creates a fresh test database
- Tables are dropped and recreated between test groups
- Data is cleaned between individual tests
- The test database is dropped after all tests complete

### Test Coverage

The test suite covers:

- Basic CRUD operations
- Advanced queries with operators
- Relationships and joins (including nested joins)
- Schema validation
- Hooks and middleware
- Error handling
- HTTP integration
- Performance optimization

## Troubleshooting

### MySQL Connection Failed

If you see "MySQL connection failed", check:

1. MySQL server is running
2. Credentials are correct
3. User has permission to create/drop databases

### Foreign Key Constraint Errors

These are usually due to:

1. Tables being created in wrong order (handled by syncDatabase)
2. Referenced data not existing
3. Type mismatches between columns

The test suite handles these automatically with proper cleanup and ordering.