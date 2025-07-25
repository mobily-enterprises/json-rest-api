import knexLib from 'knex';
import { createBasicApi } from './tests/fixtures/api-configs.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

async function testRelationships() {
  try {
    const api = await createBasicApi(knex);
    
    // Create test data
    const countryResult = await api.resources.countries.post({
      inputRecord: {
        data: {
          type: 'countries',
          attributes: {
            name: 'United States',
            code: 'US'
          }
        }
      },
      simplified: false
    });
    
    const publisherResult = await api.resources.publishers.post({
      inputRecord: {
        data: {
          type: 'publishers',
          attributes: {
            name: 'Penguin Books'
          },
          relationships: {
            country: {
              data: { type: 'countries', id: countryResult.data.id }
            }
          }
        }
      },
      simplified: false
    });
    
    // Create authors
    const author1 = await api.resources.authors.post({
      inputRecord: {
        data: {
          type: 'authors',
          attributes: { name: 'John Doe' }
        }
      },
      simplified: false
    });
    
    const author2 = await api.resources.authors.post({
      inputRecord: {
        data: {
          type: 'authors',
          attributes: { name: 'Jane Smith' }
        }
      },
      simplified: false
    });
    
    // Create book with relationships
    const bookResult = await api.resources.books.post({
      inputRecord: {
        data: {
          type: 'books',
          attributes: {
            title: 'Test Book'
          },
          relationships: {
            publisher: {
              data: { type: 'publishers', id: publisherResult.data.id }
            },
            authors: {
              data: [
                { type: 'authors', id: author1.data.id },
                { type: 'authors', id: author2.data.id }
              ]
            }
          }
        }
      },
      simplified: false
    });
    
    console.log('Book created:', JSON.stringify(bookResult, null, 2));
    
    // Now get the book WITHOUT includes
    const getBookNoIncludes = await api.resources.books.get({
      id: bookResult.data.id,
      queryParams: {},
      simplified: false
    });
    
    console.log('\n\nBook GET without includes:');
    console.log(JSON.stringify(getBookNoIncludes, null, 2));
    
    // Get the publisher without includes
    const getPublisherNoIncludes = await api.resources.publishers.get({
      id: publisherResult.data.id,
      queryParams: {},
      simplified: false
    });
    
    console.log('\n\nPublisher GET without includes:');
    console.log(JSON.stringify(getPublisherNoIncludes, null, 2));
    
    await knex.destroy();
  } catch (error) {
    console.error('Error:', error);
    await knex.destroy();
  }
}

testRelationships();