import express from 'express';
import { Api, Schema, createApi } from './index.js';

// Example: Automatic API Versioning
// The library handles all version negotiation automatically!

// Version 1.0.0 - Original User API
const userApiV1 = createApi({
  name: 'users',
  version: '1.0.0',
  storage: 'memory'
});

const userSchemaV1 = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
});

userApiV1.addResource('users', userSchemaV1);

// Version 2.0.0 - Added phone number
const userApiV2 = createApi({
  name: 'users',
  version: '2.0.0',
  storage: 'memory'
});

const userSchemaV2 = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  phone: { type: 'string' },  // New field!
  active: { type: 'boolean', default: true }  // New field!
});

userApiV2.addResource('users', userSchemaV2);

// Version 2.1.0 - Added address
const userApiV2_1 = createApi({
  name: 'users',
  version: '2.1.0',
  storage: 'memory'
});

const userSchemaV2_1 = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  phone: { type: 'string' },
  active: { type: 'boolean', default: true },
  address: { type: 'object' }  // New field!
});

userApiV2_1.addResource('users', userSchemaV2_1);

// USAGE - The library handles version selection automatically!

// 1. Get specific version
const api1 = Api.get('users', '1.0.0');
console.log('Got v1.0.0:', api1.options.version);

// 2. Get latest version
const apiLatest = Api.get('users', 'latest');
console.log('Got latest:', apiLatest.options.version); // 2.1.0

// 3. Get minimum version (2.0.0 or higher)
const api2Plus = Api.get('users', '2.0.0');
console.log('Got 2.0.0+:', api2Plus.options.version); // 2.1.0 (highest compatible)

// 4. From within an API, access other APIs automatically
const ordersApi = createApi({
  name: 'orders',
  version: '1.0.0',
  storage: 'memory'
});

// The orders API can access the users API automatically
ordersApi.hook('afterInsert', async (context) => {
  if (context.options.type === 'orders') {
    // This automatically gets a compatible users API!
    const usersApi = ordersApi.apis.users;
    
    if (usersApi) {
      const user = await usersApi.get(context.data.userId, { type: 'users' });
      console.log('Order created for user:', user);
    }
  }
});

// 5. Express setup with automatic version routing
const app = express();

// Mount all versions - the library handles routing!
userApiV1.mount(app, '/api');    // Available at /api/1.0.0/users
userApiV2.mount(app, '/api');    // Available at /api/2.0.0/users
userApiV2_1.mount(app, '/api');  // Available at /api/2.1.0/users

// Version negotiation middleware
app.use('/api/users/*', (req, res, next) => {
  // Get requested version from header or query
  const requestedVersion = 
    req.headers['api-version'] || 
    req.query.v || 
    'latest';
  
  // Library finds the right version automatically
  const api = Api.get('users', requestedVersion);
  
  if (!api) {
    return res.status(404).json({
      errors: [{
        status: '404',
        title: 'Version Not Found',
        detail: `No compatible version for users API ${requestedVersion}`
      }]
    });
  }
  
  // Forward to the correct API version
  api.router(req, res, next);
});

// 6. Programmatic usage with automatic version selection
async function createUser(data, minVersion = '1.0.0') {
  // Get a compatible API automatically
  const api = Api.get('users', minVersion);
  
  if (!api) {
    throw new Error(`No users API version >= ${minVersion}`);
  }
  
  return api.insert(data, { type: 'users' });
}

// This works with v1.0.0 data
await createUser({
  name: 'John Doe',
  email: 'john@example.com'
}, '1.0.0');

// This requires v2.0.0+ for phone field
await createUser({
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+1234567890'
}, '2.0.0');

// Client examples:

// Via header
fetch('/api/users', {
  headers: {
    'API-Version': '2.0.0'  // Get v2.0.0 or higher
  }
});

// Via query parameter
fetch('/api/users?v=1.0.0');  // Get exactly v1.0.0

// Via path (automatic routing)
fetch('/api/2.1.0/users');  // Get exactly v2.1.0

// Show all registered APIs
console.log('Registered APIs:', Api.getRegistry());
// Output: { users: ['2.1.0', '2.0.0', '1.0.0'] }

export { userApiV1, userApiV2, userApiV2_1 };