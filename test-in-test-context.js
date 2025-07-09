import { test } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';

test('Schema validation error handling', async (t) => {
  await t.test('Method 1: Try-catch around addResource', async () => {
    resetGlobalRegistryForTesting();
    const badApi = new Api({ name: `bad-api-${Date.now()}` });
    await badApi.use(RestApiPlugin);
    
    // The error happens async, so try-catch won't work
    try {
      badApi.addResource('bad_articles', {
        schema: {
          id: { type: 'id' },
          title: { type: 'string' },
          author_id: { belongsTo: 'users', as: 'author' } // Missing type!
        }
      });
      console.log('addResource completed without throwing');
    } catch (err) {
      console.log('Caught error:', err.message);
    }
  });

  await t.test('Method 2: Use process.on before creating resource', async () => {
    resetGlobalRegistryForTesting();
    
    let errorCaught = null;
    const errorHandler = (err) => {
      console.log('Handler caught:', err.message);
      errorCaught = err;
      // Prevent the process from exiting
      return true;
    };
    
    process.on('uncaughtException', errorHandler);
    
    const badApi = new Api({ name: `bad-api-${Date.now()}` });
    await badApi.use(RestApiPlugin);
    
    badApi.addResource('bad_articles', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string' },
        author_id: { belongsTo: 'users', as: 'author' } // Missing type!
      }
    });
    
    // Wait for async error
    await new Promise(resolve => setTimeout(resolve, 100));
    
    process.removeListener('uncaughtException', errorHandler);
    
    if (errorCaught) {
      assert.ok(errorCaught.message.includes('belongsTo but no type'));
      console.log('Test passed!');
    } else {
      assert.fail('No error was caught');
    }
  });

  await t.test('Method 3: Skip this test for now', async () => {
    // The node test runner might have special handling for uncaught exceptions
    // that interferes with our error handling approach
    t.skip('Async error handling is complex in test context');
  });
});