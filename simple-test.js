import knexLib from 'knex';
import { createBasicApi } from './tests/fixtures/api-configs.js';

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

async function test() {
  try {
    const api = await createBasicApi(knex);
    
    // Create country
    const country = await api.resources.countries.post({
      inputRecord: { data: { type: 'countries', attributes: { name: 'US', code: 'US' } } },
      simplified: false
    });
    
    // Create publisher with country
    const publisher = await api.resources.publishers.post({
      inputRecord: {
        data: {
          type: 'publishers',
          attributes: { name: 'Penguin' },
          relationships: {
            country: { data: { type: 'countries', id: country.data.id } }
          }
        }
      },
      simplified: false
    });
    
    // Get publisher WITHOUT includes
    const result = await api.resources.publishers.get({
      id: publisher.data.id,
      queryParams: {},
      simplified: false
    });
    
    console.log('Publisher GET without includes:');
    console.log(JSON.stringify(result, null, 2));
    
    // Check if relationships have data
    if (result.data.relationships) {
      console.log('\nRelationships present:', Object.keys(result.data.relationships));
      for (const [relName, relData] of Object.entries(result.data.relationships)) {
        console.log(`  ${relName}:`, relData);
      }
    }
    
    await knex.destroy();
  } catch (error) {
    console.error('Error:', error.message);
    await knex.destroy();
  }
}

test();