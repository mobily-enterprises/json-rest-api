# Production, Deployment & Testing

This section covers best practices for organizing resources, implementing authentication and security, production deployment considerations, testing strategies, contributing guidelines, and troubleshooting.

## Table of Contents

1. [Organizing Resources](#organizing-resources)
2. [Authentication & Security](#authentication--security)
3. [Best Practices](#best-practices)
4. [Deployment Checklist](#deployment-checklist)
5. [Testing](#testing)
6. [Contributing](#contributing)
7. [Troubleshooting](#troubleshooting)
8. [Get Help](#get-help)

## Organizing Resources

### Directory Structure

```
project/
├── server.js
├── api/
│   ├── 1.0.0/
│   │   ├── users.js      # Self-contained users resource
│   │   ├── products.js   # Self-contained products resource
│   │   └── orders.js     # Self-contained orders resource
│   └── 2.0.0/
│       ├── users.js      # Updated users resource
│       ├── products.js   # Updated products resource
│       └── orders.js     # Orders resource
└── config/
    └── database.js       # Database configuration
```

### Resource File Structure

Each resource file is self-contained and handles its own setup:

```javascript
// api/1.0.0/users.js
import { Api, Schema, MySQLPlugin, ValidationPlugin, HTTPPlugin } from 'json-rest-api';
import { dbConfig } from '../../config/database.js';

// Get or create the API instance for this version
const api = Api.get('myapp', '1.0.0') || new Api({ 
  name: 'myapp', 
  version: '1.0.0' 
});

// Ensure plugins are loaded (safe to call multiple times)
api
  .use(ValidationPlugin)
  .use(MySQLPlugin, {
    connections: [{
      name: 'main',
      config: dbConfig
    }]
  })
  .use(HTTPPlugin, {
    basePath: '/api/1.0.0'
  });

// Define schema
const userSchema = new Schema({
  id: { type: 'id' },
  username: { type: 'string', required: true, min: 3, max: 50 },
  email: { type: 'string', required: true, lowercase: true },
  password: { type: 'string', required: true, min: 8 },
  role: { type: 'string', default: 'user' },
  active: { type: 'boolean', default: true }
});

// Define hooks for this resource
const userHooks = {
  async afterValidate(context) {
    const { data, method, errors } = context;
    
    if (method === 'insert' || method === 'update') {
      // Check for duplicate email
      const existing = await context.api.resources.users.query({
        filter: { email: data.email }
      });
      
      if (existing.meta.total > 0 && existing.results[0].id !== data.id) {
        errors.push({
          field: 'email',
          message: 'Email already in use',
          code: 'DUPLICATE_EMAIL'
        });
      }
    }
  },
  
  async transformResult(context) {
    const { result } = context;
    
    // Never return password field
    if (result && result.attributes) {
      delete result.attributes.password;
    }
  }
};

// Add the resource with schema and hooks
api.addResource('users', userSchema, userHooks);

// Export for server to mount
export default api;
```

### Minimal Server Setup

```javascript
// server.js
import express from 'express';

const app = express();

// Middleware
app.use(express.json());

// Load all resources - ONE LINE PER RESOURCE!
const apis = [
  await import('./api/1.0.0/users.js'),
  await import('./api/1.0.0/products.js'),
  await import('./api/1.0.0/orders.js'),
  await import('./api/2.0.0/users.js'),
  await import('./api/2.0.0/products.js'),
  await import('./api/2.0.0/orders.js'),
];

// Mount all APIs - that's it!
apis.forEach(module => module.default.mount(app));

// Start server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

### Programmatic Access Between Resources

Resources that share an API instance can interact with each other:

```javascript
// api/1.0.0/orders.js
const orderHooks = {
  async afterInsert(context) {
    const { result } = context;
    const order = result.data;
    
    // Access other resources using the intuitive API
    const user = await api.resources.users.get(order.attributes.userId);
    const product = await api.resources.products.get(order.attributes.productId);
    
    // Send email notification
    await sendOrderConfirmation(user.data.attributes.email, {
      order,
      product: product.data.attributes
    });
  }
};
```

## Authentication & Security

> **Note**: For comprehensive security documentation including CORS configuration, JWT authentication, and field security, see the [Security Best Practices Guide](./GUIDE_7_Security.md).

### Using the AuthorizationPlugin

The AuthorizationPlugin provides role-based access control (RBAC) with ownership permissions.

```javascript
import { Api, Schema } from 'json-rest-api';
import { MySQLPlugin, AuthorizationPlugin, HTTPPlugin } from 'json-rest-api/plugins';

const api = new Api({ name: 'myapp', version: '1.0.0' });

// Storage first
api.use(MySQLPlugin, { connection });

// Authorization with roles and permissions
api.use(AuthorizationPlugin, {
  roles: {
    admin: {
      permissions: '*',
      description: 'Full system access'
    },
    editor: {
      permissions: ['posts.*', 'media.*', 'users.read'],
      description: 'Can manage content'
    },
    user: {
      permissions: [
        'posts.create',
        'posts.read',
        'posts.update.own',  // Can only update own posts
        'posts.delete.own'   // Can only delete own posts
      ]
    }
  },
  
  // Bridge to your auth system
  enhanceUser: async (user) => {
    // Load roles from your database/session/JWT
    const roles = await getUserRoles(user.id);
    return { ...user, roles };
  },
  
  // Resource-specific rules
  resources: {
    posts: {
      ownerField: 'authorId',
      public: ['read'],           // Anyone can read
      authenticated: ['create'],  // Logged-in users can create
      owner: ['update', 'delete'] // Only owner can update/delete
    }
  }
});

// HTTP with user extraction
api.use(HTTPPlugin, {
  app,
  getUserFromRequest: (req) => req.user // From your auth middleware
});
```

### Simple Authentication Example

```javascript
// Your authentication middleware
app.use(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      // This user object will be enhanced by AuthorizationPlugin
      req.user = {
        id: payload.sub,
        email: payload.email
        // roles can be in JWT or loaded by enhanceUser
      };
    } catch (err) {
      // Invalid token
    }
  }
  
  next();
});
```

### Resource Definition with Permissions

```javascript
const postSchema = new Schema({
  title: { type: 'string', required: true },
  content: { type: 'string' },
  authorId: { type: 'integer' },
  status: { type: 'string', enum: ['draft', 'published'] },
  
  // Field-level permissions
  internalNotes: { 
    type: 'string',
    permission: 'posts.sensitive' // Only users with this permission see it
  }
});

api.addResource('posts', postSchema);
```

### Authorization in Action

```javascript
// User with 'user' role tries to update someone else's post
// This will throw ForbiddenError
await api.resources.posts.update(123, 
  { title: 'Hacked!' },
  { user: { id: 2, roles: ['user'] } }
);

// But they can update their own post
await api.resources.posts.update(456,
  { title: 'My Updated Post' },
  { user: { id: 2, roles: ['user'] } }
);

// Admin can update any post
await api.resources.posts.update(123,
  { title: 'Admin Edit' },
  { user: { id: 1, roles: ['admin'] } }
);
```

### Custom Permission Checks in Hooks

```javascript
api.hook('beforeUpdate', async (context) => {
  if (context.options.type !== 'posts') return;
  
  const user = context.options.user;
  const { status } = context.data;
  
  // Only editors can publish posts
  if (status === 'published' && !user.can('posts.publish')) {
    throw new ForbiddenError('You cannot publish posts');
  }
  
  // Add reviewer info
  if (user.hasRole('editor') && status === 'published') {
    context.data.reviewedBy = user.id;
    context.data.reviewedAt = new Date();
  }
});
```

### Built-in Security Features

The JSON REST API automatically protects against common vulnerabilities:

#### 🛡️ SQL Injection Protection
- **All queries use parameterized statements** - Values are never concatenated into SQL
- **Identifiers are properly escaped** - Table and column names are escaped using database-specific methods
- **Sort fields are validated** - ORDER BY fields are checked against schema before use

#### 🛡️ Prototype Pollution Protection
- **Input sanitization** - All data in `insert()` and `update()` is automatically sanitized
- **Dangerous keys removed** - `__proto__`, `constructor`, and `prototype` are stripped recursively
- **No manual sanitization needed** - The API handles this for you

#### 🛡️ Field-Level Access Control
- **Searchable field enforcement** - Only fields marked as `searchable: true` can be filtered
- **Silent field protection** - Fields marked as `silent: true` are never returned in queries
- **Schema validation** - All input is validated against your schemas automatically

### Security Best Practices

1. **Never expose sensitive fields**
   ```javascript
   password: { type: 'string', silent: true }
   ```

2. **Validate all input** (automatic with schemas)
   ```javascript
   email: { type: 'string', match: /^[^@]+@[^@]+$/ }
   ```

3. **Mark searchable fields explicitly**
   ```javascript
   new Schema({
     email: { type: 'string', searchable: true },
     internalNotes: { type: 'string' } // Not searchable by default
   })
   ```

4. **Add authentication/authorization**
   ```javascript
   api.hook('beforeOperation', async (context) => {
     if (!context.request?.user) {
       throw new UnauthorizedError();
     }
   });
   ```

5. **Enable CORS properly**
   ```javascript
   api.use(HTTPPlugin, {
     cors: {
       origin: 'https://yourdomain.com', // Never use '*' with credentials
       credentials: true
     }
   });
   ```

6. **⚠️ NEVER bypass the API's protections**
   - Don't build raw SQL queries in hooks
   - Don't manually parse user input without validation
   - Don't expose internal error details to users

## Best Practices

1. **Always define schemas** - They're your contract and documentation
2. **Use the proxy API** - It's cleaner than passing type everywhere
3. **Order plugins correctly** - Storage → Validation → Features → HTTP
4. **Validate early** - Let schemas catch errors before they hit the database
5. **Use refs for relationships** - It enables automatic joins and consistency
6. **Hook into the right lifecycle** - beforeInsert vs afterInsert matters
7. **Keep hooks focused** - One hook should do one thing
8. **Use transactions for complex operations** - Especially with MySQL
9. **Test with different storage plugins** - Memory for tests, MySQL for production
10. **Version your APIs** - It's built-in, use it!
11. **Always paginate** - Never return unbounded results
12. **Select only needed fields** - Reduces bandwidth and processing
13. **Use appropriate operators** - `$in` for multiple values, not multiple ORs
14. **Index filtered fields** - Critical for performance
15. **Monitor slow queries** - Log queries over threshold
16. **Consider denormalization** - For complex read-heavy queries
17. **Cache frequently used queries** - Especially for public data
18. **Document complex queries** - Help future maintainers
19. **Mark fields as searchable** - Only searchable fields can be filtered
20. **Use searchableFields mappings** - For filtering by joined data

## Deployment Checklist

Before deploying to production, ensure you've addressed all these items:

### Environment & Configuration
- [ ] **JWT_SECRET** environment variable set (minimum 32 characters)
- [ ] **CORS_ORIGINS** environment variable configured with production domains
- [ ] **Database credentials** secured and not hardcoded
- [ ] **Node environment** set to production (`NODE_ENV=production`)
- [ ] **API versioning** strategy defined

### Security
- [ ] **HTTPS enforced** via load balancer or reverse proxy
- [ ] **Rate limiting** configured (using SecurityPlugin or external service)
- [ ] **Authentication middleware** properly configured
- [ ] **Authorization rules** defined for all resources
- [ ] **Sensitive fields** marked with `silent: true` in schemas
- [ ] **Error messages** don't leak sensitive information or stack traces

### Database
- [ ] **Database migrations** run and schema synchronized
- [ ] **Indexes created** on all searchable and frequently queried fields
- [ ] **Connection pooling** configured for MySQL
- [ ] **Backup strategy** in place with regular automated backups
- [ ] **Recovery plan** tested and documented

### Infrastructure
- [ ] **Load balancer** configured (if using multiple instances)
- [ ] **Health check endpoint** implemented
- [ ] **Monitoring/alerting** set up for errors and performance
- [ ] **Logging** configured with appropriate log levels
- [ ] **Process manager** (PM2, systemd, etc.) configured for auto-restart

### Performance
- [ ] **Caching strategy** implemented for frequently accessed data
- [ ] **CDN configured** for static assets (if applicable)
- [ ] **Query performance** tested under load
- [ ] **Connection limits** appropriate for expected traffic

### Operations
- [ ] **Deployment process** documented and automated
- [ ] **Rollback procedure** tested and documented
- [ ] **Environment variables** documented and managed securely
- [ ] **API documentation** up to date and accessible
- [ ] **Support procedures** defined for handling issues

### Testing
- [ ] **All tests passing** in production environment
- [ ] **Load testing** completed and acceptable
- [ ] **Security audit** performed
- [ ] **API endpoints** manually verified in production
- [ ] **Error handling** tested for edge cases

## Testing

The JSON REST API library has a comprehensive test suite organized into multiple files, each focusing on different aspects of the system.

### Test Suite Overview

#### 1. Main Test Suite (`tests/test-suite.js`)
- **Plugin Used**: MemoryPlugin
- **Coverage**: Core API functionality, basic CRUD operations, validation, timestamps, hooks, error handling
- **Tests**: 71 tests
- **Command**: `npm test`

#### 2. MySQL Test Suite (`tests/test-suite-mysql.js`)
- **Plugin Used**: MySQLPlugin
- **Coverage**: MySQL-specific features like schema synchronization, foreign keys, indexes
- **Tests**: 6 tests
- **Command**: `npm run test:mysql`
- **Requirements**: MySQL credentials via environment variables

#### 3. MySQL Comprehensive Tests (`tests/test-mysql-comprehensive.js`)
- **Plugin Used**: MySQLPlugin
- **Coverage**: Complete MySQL integration including refs, joins, JSON fields, timestamps
- **Tests**: 34 tests
- **Command**: `npm run test:mysql:comprehensive`
- **Requirements**: MySQL credentials via environment variables

#### 4. Edge Cases Tests (`tests/test-edge-cases.js`)
- **Plugins Used**: 
  - MemoryPlugin (for general edge cases)
  - MySQLPlugin (for MySQL-specific edge cases when credentials provided)
- **Coverage**: Null handling, special characters, concurrent operations, large datasets
- **Tests**: 17 tests (13 MemoryPlugin + 4 MySQLPlugin)
- **Command**: `node tests/test-edge-cases.js`

#### 5. Plugin Tests (`tests/test-plugins.js`)
- **Plugins Used**: 
  - MemoryPlugin (as base storage)
  - PositioningPlugin, VersioningPlugin (feature plugins being tested)
  - MySQLPlugin (for MySQL-specific plugin tests when credentials provided)
- **Coverage**: Plugin-specific functionality, plugin interactions
- **Tests**: 19 tests
- **Command**: `node tests/test-plugins.js`

#### 6. Advanced Query Tests (`tests/test-advanced-queries.js`)
- **Plugins Used**:
  - MemoryPlugin (for basic operator tests)
  - MySQLPlugin (for MySQL-specific features when credentials provided)
- **Coverage**: Advanced query operators (LIKE, BETWEEN, IN, EXISTS), aggregations, performance
- **Tests**: 22 tests (many fail due to unimplemented features)
- **Command**: `node tests/test-advanced-queries.js`

### Plugin Usage by Test Type

| Test Suite | Primary Plugin | Additional Plugins | Notes |
|------------|----------------|-------------------|-------|
| test-suite.js | MemoryPlugin | ValidationPlugin, TimestampsPlugin | Core functionality testing |
| test-suite-mysql.js | MySQLPlugin | ValidationPlugin | MySQL-specific features |
| test-mysql-comprehensive.js | MySQLPlugin | ValidationPlugin, TimestampsPlugin | Full MySQL integration |
| test-edge-cases.js | MemoryPlugin | MySQLPlugin (conditional) | Mixed based on test type |
| test-plugins.js | MemoryPlugin | Various feature plugins | Plugin functionality testing |
| test-advanced-queries.js | MemoryPlugin | MySQLPlugin (conditional) | Advanced query features |

### Running Tests

#### Quick Start: Run Core Tests
```bash
npm test
```
This runs only `test-suite.js` with MemoryPlugin - the fastest way to verify core functionality.

#### Run All MySQL Tests
```bash
# Set MySQL credentials
export MYSQL_USER=root
export MYSQL_PASSWORD=your_password

# Run MySQL-specific tests
npm run test:mysql
npm run test:mysql:comprehensive
```

#### Run ALL Tests
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

#### Run Individual Test Files
```bash
# Run specific test file
node tests/test-edge-cases.js

# Run with MySQL support
MYSQL_USER=root MYSQL_PASSWORD=your_password node tests/test-plugins.js
```

### Test Execution Flow

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

### Understanding Test Results

#### Successful Test Output
```
✨ All tests completed!
# tests 71
# pass 71
# fail 0
```

#### Failed Test Output
```
not ok 1 - should support LIKE operator
  ---
  error: 'Expected values to be strictly equal'
  expected: 1
  actual: 0
  ...
```

### Test Categories

#### 1. **Implemented Features** (100% pass rate)
- Basic CRUD operations
- Schema validation
- Relationships and joins
- Hooks and middleware
- Error handling
- MySQL schema synchronization

#### 2. **Unimplemented Features** (expected failures)
- Advanced query operators in MemoryPlugin (LIKE, BETWEEN, IN)
- Some MySQL-specific features (JSON operations, subqueries)
- Complex aggregations

#### 3. **Plugin-Specific Tests**
- PositioningPlugin: Record ordering, beforeId functionality
- VersioningPlugin: Version tracking, history
- TimestampsPlugin: Automatic timestamp management

### MySQL Test Database Management

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

### Debugging Tests

#### Run Tests with Verbose Output
```bash
DEBUG=* npm test
```

#### Run Specific Test Groups
Use test runners that support filtering:
```bash
# Install a test runner with filtering
npm install -g mocha

# Run only tests matching a pattern
mocha tests/test-suite.js --grep "validation"
```

#### Common Issues

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

### Contributing Tests

When adding new features:
1. Add tests to the appropriate test file
2. Use MemoryPlugin for basic functionality tests
3. Add MySQL tests if the feature has database-specific behavior
4. Follow existing test patterns and naming conventions
5. Ensure all tests pass before submitting

### Test Performance

Typical execution times:
- Main test suite: ~150ms
- MySQL comprehensive: ~2-3s
- All tests (without MySQL): ~2s
- All tests (with MySQL): ~10-15s

The MemoryPlugin tests are fastest as they run entirely in memory, while MySQL tests require database operations.

## Contributing

Thank you for your interest in contributing! Here's how to get started:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/mobily-enterprises/json-rest-api.git
cd json-rest-api

# Install dependencies
npm install

# Run tests
npm test

# Run MySQL tests (requires MySQL)
npm run test:mysql
```

### Code Style

1. **No comments** unless specifically requested
2. **Consistency** is paramount
3. **Clarity** over cleverness
4. **Async/await** over callbacks
5. **Early returns** over nested ifs

### Creating Plugins

Basic plugin structure:

```javascript
export const MyPlugin = {
  name: 'MyPlugin',
  version: '1.0.0',
  requires: ['OtherPlugin'],
  
  install(api, options = {}) {
    // Add hooks
    api.hook('beforeInsert', this.beforeInsert.bind(this));
    
    // Add methods
    api.myMethod = this.myMethod.bind(this);
    
    // Implement storage methods
    api.implement('get', this.get.bind(this));
  },
  
  async beforeInsert(context) {
    // Your logic
  }
};
```

### Testing

Write tests using Node.js test runner:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';

test('My Feature', async (t) => {
  await t.test('should do something', async () => {
    const api = createApi({ storage: 'memory' });
    // Test your feature
    assert.strictEqual(result, expected);
  });
});
```

### Submission Process

1. Fork and create a feature branch
2. Make your changes with tests
3. Update documentation if needed
4. Submit a pull request

## Troubleshooting

### "No storage plugin installed"
You forgot to add a storage plugin. Add MemoryPlugin or MySQLPlugin.

### "Resource 'users' not found"
You're trying to use a resource before calling `addResource()`.

### Validation errors
Check your schema definition. The error will tell you which field failed.

### Relationships not joining
Make sure you have `refs` defined and include the field in your query.

### Query returns no results
- Check filter syntax
- Verify data exists matching criteria
- Test with fewer filters
- Ensure fields are marked as `searchable: true`

### Query is slow
- Add indexes on filtered/sorted fields
- Reduce number of joins
- Limit selected fields
- Consider caching

### Process hangs after tests
Use `robustTeardown` from test-teardown.js to properly close connections.

## Get Help

- 📖 Check this guide
- 🏗️ Browse [examples](./examples/)

---

**← Previous**: [Advanced Topics](./GUIDE_4_Advanced_Topics.md) | **Next**: [Examples →](./GUIDE_6_Examples.md)  
**See Also**: [Security Best Practices](./GUIDE_7_Security.md)
