# Organizing Resources in Express with json-rest-api

This guide shows you how to organize your API resources in a scalable, maintainable way with minimal server setup.

## Directory Structure

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

## Resource File Structure

Each resource file is self-contained and handles its own setup.

### Example: api/1.0.0/users.js

```javascript
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
  firstName: { type: 'string', max: 100 },
  lastName: { type: 'string', max: 100 },
  role: { type: 'string', default: 'user' },
  active: { type: 'boolean', default: true },
  createdAt: { type: 'timestamp', default: () => Date.now() },
  updatedAt: { type: 'timestamp' }
});

// Define hooks for this resource
const userHooks = {
  async afterValidate(context) {
    const { data, method, errors } = context;
    
    if (method === 'insert' || method === 'update') {
      // Check for duplicate email
      const existing = await context.api.query({
        filter: { email: data.email }
      }, { type: 'users' });
      
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
    
    // Add computed fields
    if (result && result.attributes) {
      result.attributes.fullName = 
        `${result.attributes.firstName || ''} ${result.attributes.lastName || ''}`.trim();
    }
  },
  
  async beforeInsert(context) {
    const { data } = context;
    
    // Hash password before storing
    if (data.password) {
      const bcrypt = await import('bcrypt');
      data.password = await bcrypt.hash(data.password, 10);
    }
    
    // Set timestamps
    data.createdAt = Date.now();
    data.updatedAt = Date.now();
  }
};

// Add the resource with schema and hooks
api.addResource('users', userSchema, userHooks);

// Export for server to mount
export default api;
```

### Even Cleaner Approach with Shared Configuration

The library includes a helper that manages shared API instances per version:

```javascript
// api/config.js - Shared configuration
import { dbConfig } from '../config/database.js';

export const apiConfig = {
  name: 'myapp',
  mysql: {
    connections: [{
      name: 'main',
      config: dbConfig
    }]
  },
  http: {
    // Additional HTTP options
  }
};
```

Then use the helper in your resources:

```javascript
// api/1.0.0/users.js
import { Schema, defineResource } from 'json-rest-api/resource-helper.js';
import { apiConfig } from '../config.js';

export default defineResource('1.0.0', 'users', {
  api: apiConfig, // Shared configuration
  schema: new Schema({
    id: { type: 'id' },
    username: { type: 'string', required: true, min: 3, max: 50 },
    email: { type: 'string', required: true, lowercase: true },
    password: { type: 'string', required: true, min: 8 },
    firstName: { type: 'string', max: 100 },
    lastName: { type: 'string', max: 100 },
    role: { type: 'string', default: 'user' },
    active: { type: 'boolean', default: true },
    createdAt: { type: 'timestamp', default: () => Date.now() },
    updatedAt: { type: 'timestamp' }
  }),
  
  storage: {
    table: 'users',
    searchFields: ['username', 'email', 'firstName', 'lastName']
  },
  
  hooks: {
    async afterValidate(context) {
      const { data, method, errors } = context;
      
      if (method === 'insert' || method === 'update') {
        const existing = await context.api.query({
          filter: { email: data.email }
        }, { type: 'users' });
        
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
      
      if (result?.attributes) {
        delete result.attributes.password;
        result.attributes.fullName = 
          `${result.attributes.firstName || ''} ${result.attributes.lastName || ''}`.trim();
      }
    },
    
    async beforeInsert(context) {
      const bcrypt = await import('bcrypt');
      context.data.password = await bcrypt.hash(context.data.password, 10);
      context.data.createdAt = Date.now();
      context.data.updatedAt = Date.now();
    }
  }
});
```

## Minimal Server Setup

### Option 1: Manual Loading (Most Control)

```javascript
// server.js
import express from 'express';
import session from 'express-session';

const app = express();

// Middleware
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

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

### Option 2: Auto-Loading (Like the Old Library)

Create a helper function:

```javascript
// load-resources.js
import { readdir } from 'fs/promises';
import { join } from 'path';

export async function loadResourcesFromPath(apiPath, app) {
  const versions = await readdir(apiPath);
  
  for (const version of versions) {
    const versionPath = join(apiPath, version);
    const files = await readdir(versionPath);
    
    for (const file of files) {
      if (file.endsWith('.js')) {
        const module = await import(join(versionPath, file));
        if (module.default?.mount) {
          module.default.mount(app);
        }
      }
    }
  }
}
```

Then in your server:

```javascript
// server.js
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadResourcesFromPath } from './load-resources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// ONE LINE to load everything!
await loadResourcesFromPath(join(__dirname, 'api'), app);

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

## Programmatic Access Between Resources

Resources that share an API instance can interact with each other using the new intuitive API:

```javascript
// api/1.0.0/orders.js
import { Api, Schema } from 'json-rest-api';

const api = Api.get('myapp', '1.0.0');

// Define orders schema
const orderSchema = new Schema({
  id: { type: 'id' },
  userId: { type: 'id', required: true },
  productId: { type: 'id', required: true },
  quantity: { type: 'number', min: 1 },
  status: { type: 'string', default: 'pending' }
});

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
  },
  
  async transformResult(context) {
    const { result } = context;
    
    if (result?.data) {
      // Enrich order with user and product data
      const [user, product] = await Promise.all([
        api.resources.users.get(result.data.attributes.userId),
        api.resources.products.get(result.data.attributes.productId)
      ]);
      
      result.data.relationships = {
        user: { data: { type: 'users', id: user.data.id } },
        product: { data: { type: 'products', id: product.data.id } }
      };
      
      result.included = [
        user.data,
        product.data
      ];
    }
  }
};

api.addResource('orders', orderSchema, orderHooks);

export default api;
```

## Adding Authentication/Permissions

You can add middleware to your resources:

```javascript
// api/1.0.0/secure-resource.js
import { Schema } from 'json-rest-api';
import { createResource } from '../resource-helper.js';

const api = createResource('1.0.0', 'secrets', {
  schema: new Schema({
    id: { type: 'id' },
    content: { type: 'string', required: true },
    level: { type: 'number', default: 1 }
  })
});

// Add authentication middleware
api.useMiddleware((req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ 
      error: 'Authentication required' 
    });
  }
  next();
});

// Or use hooks for fine-grained control
api.hook('beforeOperation', async (context) => {
  if (context.options.type !== 'secrets') return;
  
  const { method, request } = context;
  
  if (!request.session?.userId) {
    throw Object.assign(new Error('Authentication required'), { 
      status: 401 
    });
  }
  
  if (method === 'delete' && request.session.role !== 'admin') {
    throw Object.assign(new Error('Admin access required'), { 
      status: 403 
    });
  }
});

export default api;
```

## Why Not Use createApi()?

You might wonder why we don't use `createApi()` in each resource file. Here's why:

1. **Shared Instance**: All resources in a version should share the same API instance, not create separate ones
2. **Single Configuration**: Database connections, plugins, etc. should be configured once per version
3. **Resource Interaction**: Resources can query each other when they share an API instance
4. **Memory Efficiency**: One connection pool, one router, one set of hooks per version

The `defineResource()` helper gives us the best of both worlds:
- Simple like `createApi()`
- But properly manages shared instances
- Allows resource-specific configuration

## Benefits

1. **Minimal Server Code**: Server setup is just a few lines
2. **Self-Contained Resources**: Each resource file has everything it needs
3. **No Repetition**: The helper function eliminates boilerplate
4. **Easy to Add Resources**: Just create a file and it works
5. **Version Isolation**: Each version's resources are independent
6. **Familiar Pattern**: Similar to the old library's approach but cleaner

## Quick Start

1. Create your resource file:
```javascript
// api/1.0.0/my-resource.js
import { Schema } from 'json-rest-api';
import { createResource } from '../resource-helper.js';

export default createResource('1.0.0', 'my-resource', {
  schema: new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true }
  })
});
```

2. That's it! The resource is automatically available at:
   - GET /api/1.0.0/my-resource
   - GET /api/1.0.0/my-resource/:id
   - POST /api/1.0.0/my-resource
   - PATCH /api/1.0.0/my-resource/:id
   - DELETE /api/1.0.0/my-resource/:id