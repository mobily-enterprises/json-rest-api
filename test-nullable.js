import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from './index.js';
import knexLib from 'knex';

// Create Knex instance
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

async function testNullable() {
  console.log('Testing nullable property for belongsTo fields...\n');

  // Create API
  const api = new Api({
    name: 'nullable-test-api',
    version: '1.0.0'
  });

  await api.use(RestApiPlugin, {
    simplified: false
  });
  
  await api.use(RestApiKnexPlugin, { knex });

  // Test 1: Without nullable
  console.log('TEST 1: Without nullable property');
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true }
    },
    tableName: 'test_countries'
  });
  await api.resources.countries.createKnexTable();

  await api.addResource('publishers_without_nullable', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
    },
    tableName: 'test_publishers_1'
  });
  await api.resources.publishers_without_nullable.createKnexTable();

  // Test 2: With nullable
  console.log('\nTEST 2: With nullable property');
  await api.addResource('publishers_with_nullable', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      country_id: { type: 'number', belongsTo: 'countries', as: 'country', nullable: true }
    },
    tableName: 'test_publishers_2'
  });
  await api.resources.publishers_with_nullable.createKnexTable();

  // Create test data
  const countryResult = await api.resources.countries.post({
    inputRecord: {
      data: {
        type: 'countries',
        attributes: { name: 'Test Country' }
      }
    },
    simplified: false
  });

  // Test clearing relationship WITHOUT nullable
  try {
    const pub1 = await api.resources.publishers_without_nullable.post({
      inputRecord: {
        data: {
          type: 'publishers_without_nullable',
          attributes: { name: 'Test Publisher 1' },
          relationships: {
            country: {
              data: { type: 'countries', id: countryResult.data.id }
            }
          }
        }
      },
      simplified: false
    });

    console.log('Created publisher without nullable: SUCCESS');

    // Try to clear the relationship
    await api.resources.publishers_without_nullable.patch({
      inputRecord: {
        data: {
          type: 'publishers_without_nullable',
          id: pub1.data.id,
          relationships: {
            country: { data: null }
          }
        }
      },
      simplified: false
    });
    console.log('Cleared country relationship without nullable: SUCCESS');
  } catch (error) {
    console.log('Clearing country relationship without nullable: FAILED');
    console.log('Error:', error.message);
  }

  // Test clearing relationship WITH nullable
  try {
    const pub2 = await api.resources.publishers_with_nullable.post({
      inputRecord: {
        data: {
          type: 'publishers_with_nullable',
          attributes: { name: 'Test Publisher 2' },
          relationships: {
            country: {
              data: { type: 'countries', id: countryResult.data.id }
            }
          }
        }
      },
      simplified: false
    });

    console.log('\nCreated publisher with nullable: SUCCESS');

    // Try to clear the relationship
    await api.resources.publishers_with_nullable.patch({
      inputRecord: {
        data: {
          type: 'publishers_with_nullable',
          id: pub2.data.id,
          relationships: {
            country: { data: null }
          }
        }
      },
      simplified: false
    });
    console.log('Cleared country relationship with nullable: SUCCESS');
  } catch (error) {
    console.log('Clearing country relationship with nullable: FAILED');
    console.log('Error:', error.message);
  }

  await knex.destroy();
}

testNullable().catch(console.error);