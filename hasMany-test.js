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
    
    // Create publisher
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
    
    // Create authors
    const author1 = await api.resources.authors.post({
      inputRecord: { data: { type: 'authors', attributes: { name: 'John Doe' } } },
      simplified: false
    });
    
    const author2 = await api.resources.authors.post({
      inputRecord: { data: { type: 'authors', attributes: { name: 'Jane Smith' } } },
      simplified: false
    });
    
    // Create book with authors (many-to-many)
    const book = await api.resources.books.post({
      inputRecord: {
        data: {
          type: 'books',
          attributes: { title: 'Test Book' },
          relationships: {
            country: { data: { type: 'countries', id: country.data.id } },
            publisher: { data: { type: 'publishers', id: publisher.data.id } },
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
    
    // Get book WITHOUT includes
    console.log('Book GET without includes:');
    const bookResult = await api.resources.books.get({
      id: book.data.id,
      queryParams: {},
      simplified: false
    });
    console.log(JSON.stringify(bookResult, null, 2));
    
    // Get publisher WITHOUT includes (to see if it shows books relationship)
    console.log('\n\nPublisher GET without includes (checking for books relationship):');
    const publisherResult = await api.resources.publishers.get({
      id: publisher.data.id,
      queryParams: {},
      simplified: false
    });
    console.log(JSON.stringify(publisherResult, null, 2));
    
    await knex.destroy();
  } catch (error) {
    console.error('Error:', error.message);
    await knex.destroy();
  }
}

test();