import { test } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';

// Reset the global registry
resetGlobalRegistryForTesting();

// Create in-memory SQLite database
const knex = knexConfig({
  client: 'sqlite3',
  connection: ':memory:',
  useNullAsDefault: true
});

await knex.schema.createTable('articles', table => {
  table.increments('id');
  table.string('title');
});

const api = new Api({
  name: 'test-api',
  version: '1.0.0'
});

await api.use(RestApiPlugin, {
  returnFullRecord: {
    post: false
  }
});
await api.use(RestApiKnexPlugin, { knex });

api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true }
  }
});

console.log('\n=== TEST: Validate required fields ===\n');

try {
  await api.resources.articles.post({
    // Missing required title
  });
  console.log('ERROR: Should have thrown validation error');
} catch (error) {
  console.log('SUCCESS: Got expected error:', error.message);
  console.log('Error code:', error.code);
}

await knex.destroy();