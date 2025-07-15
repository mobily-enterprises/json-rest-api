import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from '../index.js';
import { BulkOperationsPlugin } from '../plugins/core/bulk-operations-plugin.js';
import { ExpressPlugin } from '../plugins/core/connectors/express-plugin.js';
import knexLib from 'knex';

// Create API with bulk operations
const api = new Api();

const knex = knexLib({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(BulkOperationsPlugin, {
  'bulk-operations': {
    maxBulkOperations: 1000,
    defaultAtomic: true,
    enableOptimizations: true
  }
});
await api.use(ExpressPlugin);

// Add a resource
await api.addResource('users', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true, unique: true },
    role: { type: 'string', default: 'user' }
  }
});

// Create tables
await api.resources.users.createKnexTable();

// Example: Bulk create users
const bulkCreateResult = await api.scopes.users.bulkPost({
  inputRecords: [
    { type: 'users', attributes: { name: 'Alice', email: 'alice@example.com' } },
    { type: 'users', attributes: { name: 'Bob', email: 'bob@example.com' } },
    { type: 'users', attributes: { name: 'Charlie', email: 'charlie@example.com' } }
  ],
  atomic: true
});

console.log('Bulk created:', bulkCreateResult.meta);

// Example: Bulk update users
const bulkUpdateResult = await api.scopes.users.bulkPatch({
  operations: [
    { id: '1', data: { type: 'users', id: '1', attributes: { role: 'admin' } } },
    { id: '2', data: { type: 'users', id: '2', attributes: { role: 'moderator' } } }
  ],
  atomic: false // Allow partial success
});

console.log('Bulk updated:', bulkUpdateResult.meta);

// Example: Bulk delete users
const bulkDeleteResult = await api.scopes.users.bulkDelete({
  ids: ['3', '4', '5'],
  atomic: true
});

console.log('Bulk deleted:', bulkDeleteResult.meta);

// Mount Express app
import express from 'express';
const app = express();
api.http.express.mount(app);

app.listen(3000, () => {
  console.log('Server with bulk operations running on http://localhost:3000');
});

/*
HTTP Examples:

# Bulk create
POST /api/users/bulk
{
  "data": [
    { "type": "users", "attributes": { "name": "User 1", "email": "user1@example.com" } },
    { "type": "users", "attributes": { "name": "User 2", "email": "user2@example.com" } }
  ]
}

# Bulk update
PATCH /api/users/bulk
{
  "operations": [
    { "id": "1", "data": { "type": "users", "id": "1", "attributes": { "role": "admin" } } },
    { "id": "2", "data": { "type": "users", "id": "2", "attributes": { "role": "user" } } }
  ]
}

# Bulk delete
DELETE /api/users/bulk
{
  "data": ["1", "2", "3"]
}

# Non-atomic mode (allow partial failures)
POST /api/users/bulk?atomic=false
*/