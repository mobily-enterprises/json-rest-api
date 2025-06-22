import { Api } from './lib/api.js';
import { Schema } from './lib/schema.js';
import { MemoryPlugin } from './plugins/memory.js';

const api = new Api();
api.use(MemoryPlugin);

api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
}));

// Insert a user
const result = await api.resources.users.insert({
  name: 'Test User',
  email: 'test@example.com'
});

console.log('Insert result:', JSON.stringify(result, null, 2));
console.log('Result data id:', result.data.id);
console.log('Result data attributes:', result.data.attributes);