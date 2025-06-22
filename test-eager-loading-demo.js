import { Api, Schema, MemoryPlugin, SimplifiedRecordsPlugin } from './index.js';

async function demonstrateEagerLoading() {
  // Create API in JSON:API compliant mode (default)
  const api = new Api({ debug: false });
  api.use(MemoryPlugin);
  
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
          eager: true,  // This means: always load country data
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
  
  const uk = await api.insert({
    name: 'United Kingdom',
    code: 'UK'
  }, { type: 'countries' });
  
  const john = await api.insert({
    name: 'John Doe',
    email: 'john@example.com'
  }, { type: 'people' });
  
  const office1 = await api.insert({
    name: 'New York Office',
    address: '123 Broadway',
    personId: john.data.id,
    countryId: usa.data.id
  }, { type: 'offices' });
  
  const office2 = await api.insert({
    name: 'London Office',
    address: '456 Oxford St',
    personId: john.data.id,
    countryId: uk.data.id
  }, { type: 'offices' });
  
  console.log('=== JSON:API Compliant Mode (Default) ===\n');
  
  // Test 1: Get a single office
  console.log('1. Get a single office:');
  const singleOffice = await api.get(office1.data.id, { type: 'offices' });
  console.log('Office attributes:', singleOffice.data.attributes);
  console.log('Country in attributes?', typeof singleOffice.data.attributes.countryId === 'object' ? 'YES' : 'NO');
  console.log('Has relationships?', singleOffice.data.relationships ? 'YES' : 'NO');
  if (singleOffice.data.relationships) {
    console.log('Relationships:', Object.keys(singleOffice.data.relationships));
    console.log('Country relationship:', singleOffice.data.relationships.country);
  }
  console.log('Included resources:', singleOffice.included?.map(r => `${r.type}:${r.id}`));
  
  // Show the included country
  if (singleOffice.included && singleOffice.included.length > 0) {
    console.log('Included country data:', singleOffice.included[0].attributes);
  }
  
  // Test 2: Get person with offices
  console.log('\n2. Get person with offices included:');
  const personWithOffices = await api.get(john.data.id, {
    type: 'people',
    include: 'offices'
  });
  console.log('Person:', personWithOffices.data.attributes.name);
  console.log('Offices relationship:', personWithOffices.data.relationships?.offices);
  console.log('Included resources:', personWithOffices.included?.map(r => `${r.type}:${r.id}`));
  
  // Test 3: Query offices directly
  console.log('\n3. Query offices directly:');
  const offices = await api.query({}, { type: 'offices' });
  console.log('First office countryId type:', typeof offices.data[0].attributes.countryId);
  console.log('Included resources:', offices.included?.map(r => `${r.type}:${r.id}`));
  
  // Now test with SimplifiedRecordsPlugin
  console.log('\n\n=== With SimplifiedRecordsPlugin ===\n');
  
  const simplifiedApi = new Api({ debug: false });
  simplifiedApi.use(MemoryPlugin);
  simplifiedApi.use(SimplifiedRecordsPlugin, {
    flattenResponse: true,     // Remove data wrapper
    includeType: false,        // Don't include type field
    embedRelationships: true   // Embed related objects
  });
  
  // Copy schemas
  simplifiedApi.addResource('countries', api.schemas.get('countries'));
  simplifiedApi.addResource('offices', api.schemas.get('offices'));
  simplifiedApi.addResource('people', api.schemas.get('people'));
  
  await simplifiedApi.connect();
  
  // Copy data
  await simplifiedApi.insert(usa.data.attributes, { type: 'countries' });
  await simplifiedApi.insert(uk.data.attributes, { type: 'countries' });
  await simplifiedApi.insert(john.data.attributes, { type: 'people' });
  await simplifiedApi.insert(office1.data.attributes, { type: 'offices' });
  await simplifiedApi.insert(office2.data.attributes, { type: 'offices' });
  
  // Test with SimplifiedRecordsPlugin
  console.log('4. Get single office (with SimplifiedRecordsPlugin):');
  const simplifiedOffice = await simplifiedApi.get('1', { type: 'offices' });
  
  // Check if it's flattened (no data wrapper)
  if (simplifiedOffice.data) {
    console.log('NOT flattened - still has data wrapper');
  } else {
    console.log('Flattened response (no data wrapper)');
  }
  
  console.log('Office data:', JSON.stringify(simplifiedOffice, null, 2));
  
  // For flattened response, check direct properties
  const officeData = simplifiedOffice.data || simplifiedOffice;
  console.log('\nCountry embedded?', typeof officeData.country === 'object' ? 'YES (as country)' : 
    (typeof officeData.countryId === 'object' ? 'YES (as countryId)' : 'NO'));
  
  if (typeof officeData.country === 'object') {
    console.log('Country data (as country):', officeData.country);
  } else if (typeof officeData.countryId === 'object') {
    console.log('Country data (as countryId):', officeData.countryId);
  }
  
  console.log('\n5. Get person with offices (with SimplifiedRecordsPlugin):');
  const simplifiedPerson = await simplifiedApi.get('1', {
    type: 'people',
    include: 'offices'
  });
  
  const personData = simplifiedPerson.data || simplifiedPerson;
  console.log('Person name:', personData.name || personData.attributes?.name);
  
  // Check if offices are embedded
  if (personData.offices && Array.isArray(personData.offices)) {
    console.log('Offices embedded directly:', personData.offices.length);
    const firstOffice = personData.offices[0];
    console.log('\nFirst office:', {
      name: firstOffice.name,
      countryId: firstOffice.countryId
    });
    console.log('First office country embedded?', 
      typeof firstOffice.country === 'object' ? 'YES (as country)' : 
      (typeof firstOffice.countryId === 'object' ? 'YES (as countryId)' : 'NO'));
    
    if (typeof firstOffice.country === 'object') {
      console.log('Country data in office:', firstOffice.country);
    } else if (typeof firstOffice.countryId === 'object') {
      console.log('Country data in office:', firstOffice.countryId);
    }
  } else {
    console.log('Offices NOT embedded - check included section');
  }
}

demonstrateEagerLoading().catch(console.error);