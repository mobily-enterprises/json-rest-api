import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';

console.log('Testing schema enrichment hooks...\n');

resetGlobalRegistryForTesting();
const api = new Api({ name: `test-api-${Date.now()}` });
await api.use(RestApiPlugin);

// Add a resource first
api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', search: true },
    content: { type: 'text' }
  }
});

// Add hooks through the scope
const postScope = api.scopes.posts;

// Add a hook to enrich schemas
postScope.addHook('schema:enrich', 'add-timestamps', {}, ({ schema, scopeName }) => {
  console.log(`[Hook] Enriching schema for scope: ${scopeName}`);
  
  // Add timestamps to all scopes
  if (!schema.created_at) {
    schema.created_at = {
      type: 'datetime',
      name: 'created_at'
    };
    console.log('  - Added created_at field');
  }
  
  if (!schema.updated_at) {
    schema.updated_at = {
      type: 'datetime', 
      name: 'updated_at'
    };
    console.log('  - Added updated_at field');
  }
});

// Add a hook for searchSchema enrichment
postScope.addHook('searchSchema:enrich', 'add-search-fields', {}, ({ searchSchema, scopeName }) => {
  console.log(`[Hook] Enriching searchSchema for scope: ${scopeName}`);
  
  // Make timestamps searchable
  if (searchSchema) {
    searchSchema.created_after = {
      type: 'datetime',
      actualField: 'created_at',
      filterUsing: '>='
    };
    searchSchema.created_before = {
      type: 'datetime',
      actualField: 'created_at',
      filterUsing: '<='
    };
    console.log('  - Added created_after and created_before search fields');
  }
});

// Get the schema info (triggers hooks)
const schemaInfo = await postScope.getSchemaInfo();

console.log('\nEnriched schema fields:');
console.log('- id:', schemaInfo.schema.structure.id);
console.log('- title:', schemaInfo.schema.structure.title);
console.log('- content:', schemaInfo.schema.structure.content);
console.log('- created_at:', schemaInfo.schema.structure.created_at);
console.log('- updated_at:', schemaInfo.schema.structure.updated_at);

console.log('\nSearchSchema fields:');
if (schemaInfo.searchSchema) {
  console.log('- title:', schemaInfo.searchSchema.structure.title);
  console.log('- created_after:', schemaInfo.searchSchema.structure.created_after);
  console.log('- created_before:', schemaInfo.searchSchema.structure.created_before);
}

console.log('\nHooks test completed successfully!');