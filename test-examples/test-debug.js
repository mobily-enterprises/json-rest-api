import { Api } from 'hooked-api';
import { RestApiPlugin } from 'json-rest-api';

// Create a minimal test plugin to check what parameters are available
const TestPlugin = {
  name: 'test-plugin',
  install(context) {
    console.log('Plugin install context keys:', Object.keys(context));
    console.log('api type:', typeof context.api);
    console.log('api value:', context.api);
    
    if (context.api) {
      console.log('api properties:', Object.keys(context.api));
    }
  }
};

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// First test with our debug plugin
console.log('Testing with debug plugin...');
api.use(TestPlugin);

console.log('\nNow testing REST API plugin...');
api.use(RestApiPlugin);