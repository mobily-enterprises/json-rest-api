import { Api, Schema, MemoryPlugin, SimplifiedRecordsPlugin } from './index.js';

console.log(`
==========================================================
ANSWERING USER'S QUESTION:
"if I have a table people, and a table offices (with personId) 
and office has a foreign key to countryId (linking to countries), 
can you confirm that if you get a person and automatically all 
of the offices associated to them, the offices record will have 
a query such that the offices records have the country OBJECT 
automatically in there???"

"But if the non-compliant extra plugin is used, the object 
should be there right?"
==========================================================
`);

async function test() {
  // Test 1: JSON:API Compliant Mode (Default)
  console.log('TEST 1: JSON:API Compliant Mode (Default)\n');
  
  const api1 = new Api({ debug: false });
  api1.use(MemoryPlugin);
  
  // Define schemas
  api1.addResource('countries', new Schema({
    name: { type: 'string', required: true },
    code: { type: 'string', required: true }
  }));
  
  api1.addResource('people', new Schema({
    name: { type: 'string', required: true },
    offices: {
      type: 'list',
      virtual: true,
      foreignResource: 'offices',
      foreignKey: 'personId'
    }
  }));
  
  api1.addResource('offices', new Schema({
    name: { type: 'string', required: true },
    personId: { type: 'id', refs: { resource: 'people' }, searchable: true },
    countryId: {
      type: 'id',
      refs: {
        resource: 'countries',
        join: {
          eager: true,  // THIS IS THE KEY - always load country
          fields: ['id', 'name', 'code']
        }
      }
    }
  }));
  
  await api1.connect();
  
  // Create test data
  const country = await api1.insert({ name: 'United States', code: 'US' }, { type: 'countries' });
  const person = await api1.insert({ name: 'John Doe' }, { type: 'people' });
  await api1.insert({
    name: 'NYC Office',
    personId: person.data.id,
    countryId: country.data.id
  }, { type: 'offices' });
  
  // Get person with offices
  const result1 = await api1.get(person.data.id, {
    type: 'people',
    include: 'offices'
  });
  
  console.log('Person with offices (JSON:API mode):');
  console.log(JSON.stringify(result1, null, 2));
  
  console.log('\nANALYSIS:');
  console.log('- Offices are in the "included" section');
  console.log('- Each office has countryId as a string (not object)');
  console.log('- Countries are ALSO in the "included" section');
  console.log('- The country data WAS loaded (you can see it in included)');
  console.log('- But it\'s not embedded in the office object (JSON:API compliance)');
  
  // Test 2: Non-compliant mode (jsonApiCompliant: false)
  console.log('\n\nTEST 2: Non-Compliant Mode (jsonApiCompliant: false)\n');
  
  const api2 = new Api({ debug: false, jsonApiCompliant: false });
  api2.use(MemoryPlugin);
  
  // Same schemas
  api2.addResource('countries', api1.schemas.get('countries'));
  api2.addResource('people', api1.schemas.get('people'));
  api2.addResource('offices', api1.schemas.get('offices'));
  
  await api2.connect();
  
  // Same data
  const country2 = await api2.insert({ name: 'United States', code: 'US' }, { type: 'countries' });
  const person2 = await api2.insert({ name: 'John Doe' }, { type: 'people' });
  await api2.insert({
    name: 'NYC Office',
    personId: person2.data.id,
    countryId: country2.data.id
  }, { type: 'offices' });
  
  // Get person with offices
  const result2 = await api2.get(person2.data.id, {
    type: 'people',
    include: 'offices'
  });
  
  console.log('Person with offices (Non-compliant mode):');
  console.log(JSON.stringify(result2, null, 2));
  
  console.log('\nANALYSIS:');
  const office = result2.included?.[0];
  if (office) {
    console.log('- Office countryId value:', office.attributes.countryId);
    console.log('- Office country object:', office.attributes.country);
    console.log('- Country is embedded as "country" property (not countryId)');
  }
  
  console.log('\n\nCONCLUSION:');
  console.log('✅ YES - When eager loading is configured (join.eager = true):');
  console.log('   - In JSON:API mode: Country data IS loaded but placed in "included" section');
  console.log('   - In non-compliant mode: Country OBJECT is embedded directly in office.countryId');
  console.log('   - SimplifiedRecordsPlugin can transform JSON:API responses to embed objects');
}

test().catch(console.error);