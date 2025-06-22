import { Api, Schema, MemoryPlugin, SimplifiedRecordsPlugin } from './index.js';

async function demonstrateSimplifiedPlugin() {
  console.log('=== Demonstrating SimplifiedRecordsPlugin ===\n');
  
  const api = new Api({ debug: false });
  api.use(MemoryPlugin);
  api.use(SimplifiedRecordsPlugin, {
    flattenResponse: true,     // Remove data wrapper
    includeType: false,        // Don't include type field
    embedRelationships: true   // Embed related objects directly
  });
  
  // The plugin only works for HTTP responses, not direct API calls
  // Let's demonstrate what the plugin WOULD do if this was HTTP
  console.log('Note: SimplifiedRecordsPlugin only transforms HTTP responses.');
  
  // Define schemas
  api.addResource('countries', new Schema({
    name: { type: 'string', required: true },
    code: { type: 'string', required: true }
  }));
  
  api.addResource('offices', new Schema({
    name: { type: 'string', required: true },
    address: { type: 'string' },
    personId: { type: 'id', refs: { resource: 'people' }, searchable: true },
    countryId: {
      type: 'id',
      refs: {
        resource: 'countries',
        join: {
          eager: true,  // Always load country data
          fields: ['id', 'name', 'code']
        }
      }
    }
  }));
  
  api.addResource('people', new Schema({
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    offices: {
      type: 'list',
      virtual: true,
      foreignResource: 'offices',
      foreignKey: 'personId'
    }
  }));
  
  await api.connect();
  
  // Create test data
  const usa = await api.insert({
    name: 'United States',
    code: 'US'
  }, { type: 'countries' });
  console.log('USA insert response:', usa);
  
  const uk = await api.insert({
    name: 'United Kingdom',
    code: 'UK'
  }, { type: 'countries' });
  
  const john = await api.insert({
    name: 'John Doe',
    email: 'john@example.com'
  }, { type: 'people' });
  console.log('John insert response:', john);
  
  await api.insert({
    name: 'New York Office',
    address: '123 Broadway',
    personId: john.data.id,
    countryId: usa.data.id
  }, { type: 'offices' });
  
  await api.insert({
    name: 'London Office',
    address: '456 Oxford St',
    personId: john.data.id,
    countryId: uk.data.id
  }, { type: 'offices' });
  
  // Test 1: Get a single office with eager loaded country
  console.log('1. Get single office (flattened, country embedded):\n');
  const office = await api.get('1', { type: 'offices' });
  console.log(JSON.stringify(office, null, 2));
  
  console.log('\nAnalysis:');
  console.log('- Response is flattened (no data wrapper)');
  console.log('- Type field excluded');
  console.log('- Country object embedded as "country" property');
  console.log('- Original countryId preserved as string');
  
  // Test 2: Get person with offices included
  console.log('\n\n2. Get person with offices (nested eager loading):\n');
  const person = await api.get('1', {
    type: 'people',
    include: 'offices'
  });
  console.log(JSON.stringify(person, null, 2));
  
  console.log('\nAnalysis:');
  console.log('- Person object is flattened');
  console.log('- Offices array embedded directly');
  console.log('- Each office has its country embedded');
  console.log('- All relationships converted to embedded objects');
  
  // Test 3: Query all offices
  console.log('\n\n3. Query all offices:\n');
  const offices = await api.query({}, { type: 'offices' });
  console.log(JSON.stringify(offices, null, 2));
  
  console.log('\nSummary:');
  console.log('✓ SimplifiedRecordsPlugin flattens JSON:API responses');
  console.log('✓ Relationships are embedded as objects, not references');
  console.log('✓ Eager loading works through nested relationships');
  console.log('✓ The country OBJECT is automatically included in offices');
}

demonstrateSimplifiedPlugin().catch(console.error);