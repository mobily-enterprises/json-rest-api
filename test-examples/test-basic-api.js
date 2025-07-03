import { Api } from 'hooked-api';

// Create a new API instance
const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

console.log('✓ Basic API creation works!');
console.log('  API name:', api.options.name);
console.log('  API version:', api.options.version);