import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('Nested Includes with To-Many Relationships', () => {
  let api;
  
  beforeEach(() => {
    api = new Api({ debug: true });
    api.use(MemoryPlugin);
  });
  
  test('should load nested includes through to-many relationships', async () => {
    // Define countries
    api.addResource('countries', new Schema({
      name: { type: 'string', required: true },
      code: { type: 'string', required: true }
    }));
    
    // Define people
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
    
    // Define offices with country reference
    api.addResource('offices', new Schema({
      name: { type: 'string', required: true },
      address: { type: 'string' },
      personId: { 
        type: 'id', 
        refs: { resource: 'people' },
        searchable: true
      },
      countryId: {
        type: 'id',
        refs: {
          resource: 'countries',
          join: {
            eager: true,  // Always include country
            fields: ['id', 'name', 'code']
          }
        }
      }
    }));
    
    await api.connect();
    
    // Check schema definition
    const officeSchema = api.schemas.get('offices');
    console.log('\nOffice schema countryId definition:', officeSchema.structure.countryId);
    
    // Create test data
    const usa = await api.insert({
      name: 'United States',
      code: 'US'
    }, { type: 'countries' });
    
    const uk = await api.insert({
      name: 'United Kingdom',
      code: 'UK'
    }, { type: 'countries' });
    
    const japan = await api.insert({
      name: 'Japan',
      code: 'JP'
    }, { type: 'countries' });
    
    const john = await api.insert({
      name: 'John Doe',
      email: 'john@example.com'
    }, { type: 'people' });
    
    // Create offices for John
    const office1 = await api.insert({
      name: 'New York Office',
      address: '123 Broadway, NY',
      personId: john.data.id,
      countryId: usa.data.id
    }, { type: 'offices' });
    
    const office2 = await api.insert({
      name: 'London Office',
      address: '456 Oxford St, London',
      personId: john.data.id,
      countryId: uk.data.id
    }, { type: 'offices' });
    
    const office3 = await api.insert({
      name: 'Tokyo Office',
      address: '789 Shibuya, Tokyo',
      personId: john.data.id,
      countryId: japan.data.id
    }, { type: 'offices' });
    
    // Verify offices were created and test eager loading
    console.log('\nCreated offices:');
    console.log('Office 1:', office1.data);
    console.log('Office 2:', office2.data);
    console.log('Office 3:', office3.data);
    
    // Test eager loading with a simple get
    console.log('\n=== Testing eager loading with simple get ===');
    const singleOffice = await api.get(office1.data.id, { type: 'offices' });
    console.log('Single office countryId type:', typeof singleOffice.data.attributes.countryId);
    console.log('Single office countryId value:', singleOffice.data.attributes.countryId);
    console.log('Single office full data:', JSON.stringify(singleOffice.data.attributes, null, 2));
    
    // Test with a query that has no params
    console.log('\n=== Testing eager loading with query (no params) ===');
    const queryWithoutParams = await api.query({}, { type: 'offices' });
    if (queryWithoutParams.data.length > 0) {
      const firstOffice = queryWithoutParams.data[0];
      console.log('Query office countryId type:', typeof firstOffice.attributes.countryId);
      console.log('Query office countryId value:', firstOffice.attributes.countryId);
    }
    
    // Do a direct query to verify
    const directQuery = await api.query({
      filter: { personId: john.data.id }
    }, { type: 'offices' });
    console.log('\nDirect query for offices with personId:', john.data.id);
    console.log('Found offices:', directQuery.data.length);
    
    // Test 1: Get person with offices included
    console.log('\n=== Test 1: Get person with offices ===');
    const personWithOffices = await api.get(john.data.id, {
      type: 'people',
      include: 'offices'
    });
    
    // Don't log full response for now
    
    console.log('Person:', personWithOffices.data.attributes.name);
    console.log('Number of offices:', personWithOffices.included?.length || 0);
    
    // Check that offices are included
    assert(personWithOffices.included);
    assert.equal(personWithOffices.included.length, 3);
    
    // Check that each office has the country object due to eager loading
    console.log('\nOffices with countries:');
    personWithOffices.included.forEach(office => {
      console.log(`- ${office.attributes.name}`);
      console.log(`  Country ID field: ${office.attributes.countryId}`);
      console.log(`  Has country object: ${typeof office.attributes.countryId === 'object' ? 'YES' : 'NO'}`);
      
      if (typeof office.attributes.countryId === 'object') {
        console.log(`  Country: ${office.attributes.countryId.name} (${office.attributes.countryId.code})`);
        assert(office.attributes.countryId.name);
        assert(office.attributes.countryId.code);
      }
    });
    
    // Test 2: Try with explicit nested include
    console.log('\n=== Test 2: Explicit nested include (offices.countryId) ===');
    const personWithNestedInclude = await api.get(john.data.id, {
      type: 'people',
      include: 'offices.countryId'
    });
    
    console.log('Person:', personWithNestedInclude.data.attributes.name);
    console.log('Number of included resources:', personWithNestedInclude.included?.length || 0);
    
    // Test 3: Direct query of offices to verify eager loading
    console.log('\n=== Test 3: Direct query of offices ===');
    const officesQuery = await api.query({
      filter: { personId: john.data.id }
    }, { type: 'offices' });
    
    console.log('Number of offices:', officesQuery.data.length);
    officesQuery.data.forEach(office => {
      console.log(`- ${office.attributes.name}`);
      console.log(`  countryId type: ${typeof office.attributes.countryId}`);
      console.log(`  countryId value:`, office.attributes.countryId);
      if (typeof office.attributes.countryId === 'object') {
        console.log(`  Country: ${office.attributes.countryId.name} (${office.attributes.countryId.code})`);
        assert(office.attributes.countryId.name);
        assert(office.attributes.countryId.code);
      } else {
        console.log('  ERROR: Country not loaded as object!');
      }
    });
    
    // Test 4: Verify with preserveId option
    console.log('\n=== Test 4: With preserveId option ===');
    
    // Update schema to use preserveId
    api.addResource('offices2', new Schema({
      name: { type: 'string', required: true },
      personId: { 
        type: 'id', 
        refs: { resource: 'people' },
        searchable: true
      },
      countryId: {
        type: 'id',
        refs: {
          resource: 'countries',
          join: {
            eager: true,
            fields: ['id', 'name', 'code'],
            preserveId: true  // Keep both ID and object
          }
        }
      }
    }));
    
    const office4 = await api.insert({
      name: 'Paris Office',
      personId: john.data.id,
      countryId: uk.data.id
    }, { type: 'offices2' });
    
    const office4Data = await api.get(office4.data.id, { type: 'offices2' });
    console.log('Office with preserveId:');
    console.log(`- countryId field type: ${typeof office4Data.data.attributes.countryId}`);
    console.log(`- countryId value:`, office4Data.data.attributes.countryId);
    
    // Should be an object with the joined data AND the original ID
    assert(typeof office4Data.data.attributes.countryId === 'object');
    assert.equal(office4Data.data.attributes.countryId.id, uk.data.id);
    assert.equal(office4Data.data.attributes.countryId.name, 'United Kingdom');
  });
});