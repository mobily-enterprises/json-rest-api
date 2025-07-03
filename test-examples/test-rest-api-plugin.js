import { Api } from 'hooked-api';
import { RestApiPlugin } from 'json-rest-api';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Use the REST API plugin
api.use(RestApiPlugin);

console.log('✓ REST API Plugin loaded successfully!');
console.log('  Plugin registered:', api.plugins.has(RestApiPlugin));