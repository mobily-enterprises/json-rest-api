import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';

console.log('Testing error behavior...\n');

// Reset registry
resetGlobalRegistryForTesting();

// Test 1: See what happens without any error handling
console.log('Test 1: No error handling');
try {
  const badApi1 = new Api({ name: 'bad-api-1' });
  await badApi1.use(RestApiPlugin);
  
  badApi1.addResource('bad_articles', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string' },
      author_id: { belongsTo: 'users', as: 'author' } // Missing type!
    }
  });
  
  console.log('- No immediate error thrown');
} catch (err) {
  console.log('- Caught synchronous error:', err.message);
}

// Give time for async errors
await new Promise(resolve => setTimeout(resolve, 200));

console.log('\nTest 2: With uncaughtException handler');
resetGlobalRegistryForTesting();

let errorCaught = false;
const errorHandler = (error) => {
  console.log('- Uncaught exception:', error.message);
  errorCaught = true;
};

process.on('uncaughtException', errorHandler);

try {
  const badApi2 = new Api({ name: 'bad-api-2' });
  await badApi2.use(RestApiPlugin);
  
  badApi2.addResource('bad_articles', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string' },
      author_id: { belongsTo: 'users', as: 'author' } // Missing type!
    }
  });
  
  console.log('- addResource completed');
} catch (err) {
  console.log('- Caught error:', err.message);
}

// Wait a bit
await new Promise(resolve => setTimeout(resolve, 200));

process.removeListener('uncaughtException', errorHandler);

console.log('- Error caught by handler:', errorCaught);

console.log('\nTest 3: Check if error is thrown after a delay');
resetGlobalRegistryForTesting();

// Set up promise before creating the bad resource
const errorPromise = new Promise((resolve, reject) => {
  const handler = (error) => {
    console.log('- Promise resolved with error:', error.message);
    resolve(error);
  };
  
  process.once('uncaughtException', handler);
  
  // Timeout
  setTimeout(() => {
    process.removeListener('uncaughtException', handler);
    reject(new Error('Timeout - no error thrown'));
  }, 500);
});

const badApi3 = new Api({ name: 'bad-api-3' });
await badApi3.use(RestApiPlugin);

console.log('- About to call addResource...');

badApi3.addResource('bad_articles', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string' },
    author_id: { belongsTo: 'users', as: 'author' } // Missing type!
  }
});

console.log('- addResource returned');

try {
  const error = await errorPromise;
  console.log('- Error successfully caught:', error.message);
} catch (timeout) {
  console.log('- Timeout:', timeout.message);
}

process.exit(0);