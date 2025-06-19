# Contributing to JSON REST API

Thank you for your interest in contributing! This guide will help you understand the codebase and contribute effectively.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Development Setup](#development-setup)
3. [Code Structure](#code-structure)
4. [Creating Plugins](#creating-plugins)
5. [Adding Features](#adding-features)
6. [Testing](#testing)
7. [Code Style](#code-style)
8. [Submission Process](#submission-process)

## Architecture Overview

JSON REST API follows a plugin-based architecture:

```
┌─────────────────┐
│   Express App   │
└────────┬────────┘
         │ mount()
┌────────▼────────┐
│   HTTP Plugin   │ 
├─────────────────┤
│    API Core     │ ◄── Hooks, Resources, Registry
├─────────────────┤
│ Storage Plugin  │ ◄── MySQL, Memory, Custom
├─────────────────┤  
│ Feature Plugins │ ◄── Timestamps, Versioning, etc.
└─────────────────┘
```

### Core Components

1. **Api Class** (`lib/api.js`)
   - Central orchestrator
   - Plugin management
   - Hook system
   - Resource registry

2. **Schema** (`lib/schema.js`)
   - Field definitions
   - Validation rules
   - Type system

3. **QueryBuilder** (`lib/query-builder.js`)
   - SQL generation
   - Safe parameterization
   - Join management

4. **Plugins** (`plugins/`)
   - Extend functionality
   - Implement storage
   - Add features

## Development Setup

### Prerequisites

- Node.js 18+
- MySQL 8+ (for MySQL tests)
- Git

### Setup Steps

```bash
# Clone the repository
git clone https://github.com/your-username/json-rest-api.git
cd json-rest-api

# Install dependencies
npm install

# Run tests
npm test

# Run MySQL tests (requires MySQL)
npm run test:mysql
```

### Development Workflow

```bash
# Watch mode for development
npm run dev

# Run specific test
node tests/test-suite.js --grep "schema validation"

# Check code style
npm run lint
```

## Code Structure

```
json-rest-api/
├── lib/                    # Core library files
│   ├── api.js             # Main API class
│   ├── errors.js          # Error classes
│   ├── schema.js          # Schema validation
│   ├── query-builder.js   # SQL query builder
│   └── resource-helper.js # Resource utilities
├── plugins/               # Plugin implementations
│   ├── http.js           # REST endpoints
│   ├── memory.js         # In-memory storage
│   ├── mysql.js          # MySQL storage
│   ├── validation.js     # Data validation
│   └── ...               # Other plugins
├── tests/                # Test suites
│   ├── test-suite.js     # Main tests
│   └── test-suite-mysql.js # MySQL tests
├── examples/             # Usage examples
├── docs/                 # Documentation
└── index.js             # Main export
```

### Key Design Patterns

1. **Plugin Pattern**
   ```javascript
   const MyPlugin = {
     install(api, options) {
       // Extend API
     }
   };
   ```

2. **Hook System**
   ```javascript
   api.hook('beforeInsert', async (context) => {
     // Modify operation
   });
   ```

3. **Context Object**
   ```javascript
   {
     api,        // API instance
     method,     // Operation name
     options,    // Configuration
     data,       // Operation data
     result      // Operation result
   }
   ```

## Creating Plugins

### Basic Plugin Structure

```javascript
export const MyPlugin = {
  // Required
  name: 'MyPlugin',
  
  // Optional
  version: '1.0.0',
  requires: ['OtherPlugin'],
  
  // Required: Installation method
  install(api, options = {}) {
    // Add hooks
    api.hook('beforeInsert', this.beforeInsert.bind(this));
    
    // Add methods
    api.myMethod = this.myMethod.bind(this);
    
    // Implement storage methods
    api.implement('get', this.get.bind(this));
  },
  
  // Plugin methods
  async beforeInsert(context) {
    // Your logic
  },
  
  async myMethod() {
    // Your logic
  }
};
```

### Storage Plugin Requirements

Storage plugins must implement these methods:

```javascript
const StoragePlugin = {
  install(api, options) {
    api.implement('get', async (context) => {
      const { id, options } = context;
      // Return record or null
    });
    
    api.implement('query', async (context) => {
      const { params, options } = context;
      // Return { results: [], meta: {} }
    });
    
    api.implement('insert', async (context) => {
      const { data, options } = context;
      // Return created record
    });
    
    api.implement('update', async (context) => {
      const { id, data, options } = context;
      // Return updated record
    });
    
    api.implement('delete', async (context) => {
      const { id, options } = context;
      // Return nothing
    });
  }
};
```

### Hook Plugin Example

```javascript
const AuditPlugin = {
  name: 'AuditPlugin',
  
  install(api, options) {
    // Track all changes
    ['insert', 'update', 'delete'].forEach(method => {
      api.hook(`after${method.charAt(0).toUpperCase() + method.slice(1)}`, 
        async (context) => {
          await this.logAudit(method, context);
        },
        90 // Late priority
      );
    });
  },
  
  async logAudit(action, context) {
    const log = {
      action,
      resourceType: context.options.type,
      resourceId: context.id || context.result?.id,
      userId: context.options.userId,
      timestamp: new Date(),
      data: action === 'delete' ? context.previousData : context.data
    };
    
    // Store audit log
    if (context.api.resources.auditLogs) {
      await context.api.resources.auditLogs.create(log);
    }
  }
};
```

## Adding Features

### 1. Adding a New Field Type

```javascript
// In schema.js or a plugin
Schema.registerType('phone', {
  validate: (value) => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length !== 10) {
      throw new Error('Phone must be 10 digits');
    }
    return cleaned;
  },
  
  // MySQL column definition
  toSQL: () => 'VARCHAR(10)'
});

// Usage
const schema = new Schema({
  phone: { type: 'phone', required: true }
});
```

### 2. Adding a Query Operator

```javascript
// In mysql.js
function applyOperator(query, table, field, operator, value) {
  switch (operator) {
    case '$regex':
      query.where(`${table}.${field} REGEXP ?`, value);
      break;
    // ... other operators
  }
}

// Usage
filter: {
  email: { $regex: '@company\\.com$' }
}
```

### 3. Adding API Methods

```javascript
// In a plugin
install(api, options) {
  // Add instance method
  api.bulkUpdate = async (updates) => {
    const results = [];
    for (const { type, id, data } of updates) {
      const result = await api.update(id, data, { type });
      results.push(result);
    }
    return results;
  };
  
  // Add to resource proxy
  const originalProxy = api._createResourceProxy;
  api._createResourceProxy = function(type) {
    const proxy = originalProxy.call(this, type);
    
    proxy.archive = async (id) => {
      return api.update(id, { archived: true }, { type });
    };
    
    return proxy;
  };
}
```

## Testing

### Writing Tests

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { createApi, Schema } from '../index.js';

test('My Feature', async (t) => {
  await t.test('should do something', async () => {
    // Arrange
    const api = createApi({ storage: 'memory' });
    const schema = new Schema({
      name: { type: 'string', required: true }
    });
    api.addResource('items', schema);
    
    // Act
    const result = await api.resources.items.create({
      name: 'Test'
    });
    
    // Assert
    assert.strictEqual(result.data.name, 'Test');
  });
});
```

### Test Organization

- Place in appropriate section of `test-suite.js`
- Use descriptive test names
- Test both success and error cases
- Clean up after tests

### MySQL Tests

For MySQL-specific features:

```javascript
// In test-suite-mysql.js
test('MySQL Feature', async (t) => {
  const api = createApi({
    storage: 'mysql',
    mysql: { connection: testConnection }
  });
  
  // Test MySQL-specific functionality
});
```

## Code Style

### General Guidelines

1. **No comments** unless specifically requested
2. **Consistency** is paramount
3. **Clarity** over cleverness
4. **Async/await** over callbacks
5. **Early returns** over nested ifs

### Naming Conventions

- **Files**: `kebab-case.js`
- **Classes**: `PascalCase`
- **Functions**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Private**: `_prefixUnderscore`

### Code Examples

```javascript
// ✅ Good
async function processUser(userId) {
  if (!userId) return null;
  
  const user = await getUser(userId);
  if (!user) return null;
  
  return transformUser(user);
}

// ❌ Bad
function processUser(userId, callback) {
  if (userId) {
    getUser(userId, (err, user) => {
      if (!err && user) {
        callback(null, transformUser(user));
      } else {
        callback(err);
      }
    });
  } else {
    callback(new Error('No userId'));
  }
}
```

### Error Handling

```javascript
// Use error classes
import { ValidationError, NotFoundError } from './lib/errors.js';

// Throw with context
throw new NotFoundError('users', userId)
  .withContext({ searchParams });

// Handle in plugins
try {
  await riskyOperation();
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation error
  } else {
    // Re-throw unknown errors
    throw error;
  }
}
```

## Submission Process

### 1. Fork and Branch

```bash
# Fork on GitHub, then:
git clone https://github.com/your-username/json-rest-api.git
cd json-rest-api
git checkout -b feature/your-feature-name
```

### 2. Make Changes

- Write code following style guide
- Add tests for new functionality
- Update documentation if needed
- Ensure all tests pass

### 3. Commit

```bash
# Use clear commit messages
git add .
git commit -m "Add: Feature description

- Detail 1
- Detail 2"
```

### 4. Submit PR

1. Push to your fork
2. Open PR against main
3. Fill out PR template
4. Wait for review

### PR Guidelines

- **One feature per PR**
- **Include tests**
- **Update docs**
- **Pass all checks**
- **Clear description**

## Architecture Decisions

### Why Plugins?

- **Modularity**: Features can be added/removed independently
- **Testability**: Each plugin can be tested in isolation
- **Flexibility**: Users choose what they need
- **Extensibility**: Easy to add custom functionality

### Why Hooks?

- **Decoupling**: Features don't need to modify core
- **Composition**: Multiple features can enhance same operation
- **Order control**: Priority system for deterministic execution
- **Debugging**: Clear extension points

### Why Context Object?

- **Consistency**: Same pattern everywhere
- **Extensibility**: Plugins can add properties
- **Debugging**: Full operation context available
- **Flexibility**: Pass data between hooks

## Common Pitfalls

1. **Forgetting async/await**
   ```javascript
   // Bad
   api.hook('beforeInsert', (context) => {
     doAsyncThing(); // Not awaited!
   });
   
   // Good
   api.hook('beforeInsert', async (context) => {
     await doAsyncThing();
   });
   ```

2. **Modifying frozen objects**
   ```javascript
   // Bad
   context.options.custom = true; // May be frozen
   
   // Good
   context.customValue = true; // Add to context
   ```

3. **Not checking for resources**
   ```javascript
   // Bad
   await api.resources.users.get(1); // Might not exist
   
   // Good
   if (api.resources.users) {
     await api.resources.users.get(1);
   }
   ```

## Getting Help

- Check existing issues
- Read the documentation
- Look at test examples
- Ask in discussions

Thank you for contributing! 🎉