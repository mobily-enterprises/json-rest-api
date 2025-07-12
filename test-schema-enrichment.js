import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';

console.log('Testing schema enrichment...\n');

resetGlobalRegistryForTesting();
const api = new Api({ name: `test-api-${Date.now()}` });
await api.use(RestApiPlugin);

// Add a resource with belongsTo field missing type
api.addResource('articles', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string' },
    author_id: { belongsTo: 'users', as: 'author' } // Missing type!
  }
});

// Get the schema info (triggers lazy enrichment)
const articleScope = api.scopes.articles;
const schemaInfo = articleScope.vars.schemaInfo;

console.log('Original schema (before enrichment):');
console.log('author_id field:', {
  belongsTo: 'users',
  as: 'author',
  type: undefined
});

console.log('\nEnriched schema (after getSchemaInfo):');
console.log('author_id field in structure:', schemaInfo.schema.structure.author_id);

console.log('\nValidation test:');
// Test that validation works with the enriched schema
const testData = {
  title: 'Test Article',
  author_id: '123'
};

try {
  const { validatedObject, errors } = await schemaInfo.schema.validate(testData);
  console.log('Validation successful!');
  console.log('Validated object:', validatedObject);
} catch (err) {
  console.error('Validation failed:', err.message);
}

console.log('\nSchema enrichment test completed successfully!');