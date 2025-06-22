import { Api } from './lib/api.js';
import { Schema } from './lib/schema.js';
import { MemoryPlugin } from './plugins/memory.js';
import { CachePlugin } from './plugins/advanced/cache/index.js';

const api = new Api();

api.use(MemoryPlugin);
api.use(CachePlugin, {
  store: 'memory',
  ttl: 5,
  debugMode: true
});

api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
}));

// Insert test data
await api.resources.users.insert([
  { name: 'User 1', email: 'user1@example.com' },
  { name: 'User 2', email: 'user2@example.com' }
]);

// Add debug hooks
api.hook('beforeQuery', (context) => {
  console.log('beforeQuery context:', {
    resource: context.resource,
    options: context.options,
    query: context.query
  });
});

api.hook('afterQuery', (context) => {
  console.log('afterQuery context:', {
    resource: context.resource,
    options: context.options,
    result: context.result,
    cached: context.cached,
    error: context.error
  });
});

// Try query
console.log('\n=== First query ===');
const stats1 = api.cache.stats();
console.log('Stats before:', stats1);

const result1 = await api.resources.users.query({ sort: 'name' });
console.log('Query result:', result1);

const stats2 = api.cache.stats();
console.log('Stats after:', stats2);
console.log('Cache sets difference:', stats2.sets - stats1.sets);