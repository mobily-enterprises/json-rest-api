# JSON REST API Testing Guide

This document explains the testing infrastructure for the JSON REST API library, including test organization, plugin usage, and how to run various test suites.

## Test Suite Overview

The JSON REST API library has a comprehensive test suite organized into multiple files, each focusing on different aspects of the system:

### 1. Main Test Suite (`tests/test-suite.js`)
- **Plugin Used**: MemoryPlugin
- **Coverage**: Core API functionality, basic CRUD operations, validation, timestamps, hooks, error handling
- **Tests**: 71 tests
- **Command**: `npm test`

### 2. MySQL Test Suite (`tests/test-suite-mysql.js`)
- **Plugin Used**: MySQLPlugin
- **Coverage**: MySQL-specific features like schema synchronization, foreign keys, indexes
- **Tests**: 6 tests
- **Command**: `npm run test:mysql`
- **Requirements**: MySQL credentials via environment variables

### 3. MySQL Comprehensive Tests (`tests/test-mysql-comprehensive.js`)
- **Plugin Used**: MySQLPlugin
- **Coverage**: Complete MySQL integration including refs, joins, JSON fields, timestamps
- **Tests**: 34 tests
- **Command**: `npm run test:mysql:comprehensive`
- **Requirements**: MySQL credentials via environment variables

### 4. Edge Cases Tests (`tests/test-edge-cases.js`)
- **Plugins Used**: 
  - MemoryPlugin (for general edge cases)
  - MySQLPlugin (for MySQL-specific edge cases when credentials provided)
- **Coverage**: Null handling, special characters, concurrent operations, large datasets
- **Tests**: 17 tests (13 MemoryPlugin + 4 MySQLPlugin)
- **Command**: `node tests/test-edge-cases.js`

### 5. Plugin Tests (`tests/test-plugins.js`)
- **Plugins Used**: 
  - MemoryPlugin (as base storage)
  - PositioningPlugin, VersioningPlugin (feature plugins being tested)
  - MySQLPlugin (for MySQL-specific plugin tests when credentials provided)
- **Coverage**: Plugin-specific functionality, plugin interactions
- **Tests**: 19 tests
- **Command**: `node tests/test-plugins.js`

### 6. Advanced Query Tests (`tests/test-advanced-queries.js`)
- **Plugins Used**:
  - MemoryPlugin (for basic operator tests)
  - MySQLPlugin (for MySQL-specific features when credentials provided)
- **Coverage**: Advanced query operators (LIKE, BETWEEN, IN, EXISTS), aggregations, performance
- **Tests**: 22 tests (many fail due to unimplemented features)
- **Command**: `node tests/test-advanced-queries.js`

## Plugin Usage by Test Type

| Test Suite | Primary Plugin | Additional Plugins | Notes |
|------------|----------------|-------------------|-------|
| test-suite.js | MemoryPlugin | ValidationPlugin, TimestampsPlugin | Core functionality testing |
| test-suite-mysql.js | MySQLPlugin | ValidationPlugin | MySQL-specific features |
| test-mysql-comprehensive.js | MySQLPlugin | ValidationPlugin, TimestampsPlugin | Full MySQL integration |
| test-edge-cases.js | MemoryPlugin | MySQLPlugin (conditional) | Mixed based on test type |
| test-plugins.js | MemoryPlugin | Various feature plugins | Plugin functionality testing |
| test-advanced-queries.js | MemoryPlugin | MySQLPlugin (conditional) | Advanced query features |

## Running Tests

### Quick Start: Run Core Tests
```bash
npm test
```
This runs only `test-suite.js` with MemoryPlugin - the fastest way to verify core functionality.

### Run All MySQL Tests
```bash
# Set MySQL credentials
export MYSQL_USER=root
export MYSQL_PASSWORD=your_password

# Run MySQL-specific tests
npm run test:mysql
npm run test:mysql:comprehensive
```

### Run ALL Tests
To run the complete test suite including all edge cases, plugins, and advanced queries:

```bash
# Without MySQL (MemoryPlugin tests only)
npm run test:all

# With MySQL (includes all MySQL tests)
MYSQL_USER=root MYSQL_PASSWORD=your_password npm run test:all
```

The `test:all` script runs:
1. Main test suite (test-suite.js)
2. MySQL test suite (test-suite-mysql.js) - if credentials provided
3. MySQL comprehensive tests - if credentials provided
4. Edge cases tests
5. Plugin tests
6. Advanced query tests

### Run Individual Test Files
```bash
# Run specific test file
node tests/test-edge-cases.js

# Run with MySQL support
MYSQL_USER=root MYSQL_PASSWORD=your_password node tests/test-plugins.js
```

## Test Execution Flow

When you run `npm test`:

1. **Script Execution**: npm runs the script defined in package.json: `"test": "node tests/test-suite.js"`

2. **Test Initialization**: 
   - The test file imports required modules
   - Creates an Api instance
   - Registers MemoryPlugin as the storage backend

3. **Test Execution**:
   - Each `describe` block groups related tests
   - `before/after` hooks set up and tear down test data
   - Individual tests (`it` blocks) verify specific functionality

4. **Results**: 
   - TAP (Test Anything Protocol) format output
   - Summary shows total tests, passed, failed, and duration

## Understanding Test Results

### Successful Test Output
```
✨ All tests completed!
# tests 71
# pass 71
# fail 0
```

### Failed Test Output
```
not ok 1 - should support LIKE operator
  ---
  error: 'Expected values to be strictly equal'
  expected: 1
  actual: 0
  ...
```

## Test Categories

### 1. **Implemented Features** (100% pass rate)
- Basic CRUD operations
- Schema validation
- Relationships and joins
- Hooks and middleware
- Error handling
- MySQL schema synchronization

### 2. **Unimplemented Features** (expected failures)
- Advanced query operators in MemoryPlugin (LIKE, BETWEEN, IN)
- Some MySQL-specific features (JSON operations, subqueries)
- Complex aggregations

### 3. **Plugin-Specific Tests**
- PositioningPlugin: Record ordering, beforeId functionality
- VersioningPlugin: Version tracking, history
- TimestampsPlugin: Automatic timestamp management

## MySQL Test Database Management

MySQL tests automatically:
1. Create test databases if they don't exist
2. Synchronize schemas before running tests
3. Clean up connections using `robustTeardown`

Test databases used:
- `jsonrestapi_test` - Main MySQL tests
- `jsonrestapi_test_comprehensive` - Comprehensive tests
- `jsonrestapi_test_edge_cases` - Edge case tests
- `jsonrestapi_test_plugins` - Plugin tests
- `jsonrestapi_test_advanced` - Advanced query tests

## Debugging Tests

### Run Tests with Verbose Output
```bash
DEBUG=* npm test
```

### Run Specific Test Groups
Use test runners that support filtering:
```bash
# Install a test runner with filtering
npm install -g mocha

# Run only tests matching a pattern
mocha tests/test-suite.js --grep "validation"
```

### Common Issues

1. **MySQL Connection Errors**
   - Ensure MySQL is running
   - Check credentials in environment variables
   - Verify user has CREATE DATABASE permissions

2. **Timeout Errors**
   - Tests use `robustTeardown` to clean up connections
   - Increase timeout if needed for slow systems

3. **Memory Plugin Limitations**
   - No support for advanced operators
   - No persistence between test runs
   - Array/object fields stored by reference

## Contributing Tests

When adding new features:
1. Add tests to the appropriate test file
2. Use MemoryPlugin for basic functionality tests
3. Add MySQL tests if the feature has database-specific behavior
4. Follow existing test patterns and naming conventions
5. Ensure all tests pass before submitting

## Test Performance

Typical execution times:
- Main test suite: ~150ms
- MySQL comprehensive: ~2-3s
- All tests (without MySQL): ~2s
- All tests (with MySQL): ~10-15s

The MemoryPlugin tests are fastest as they run entirely in memory, while MySQL tests require database operations.