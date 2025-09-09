import { createBasicApi } from './tests/fixtures/api-configs.js';
import { cleanTables, createJsonApiDocument, createRelationship } from './tests/helpers/test-utils.js';
import knex from 'knex';

const dbConfig = {
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
};

const db = knex(dbConfig);

async function test() {
  const api = await createBasicApi(db);
  
  // Create test data
  await cleanTables(db, ['basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors']);
  
  // Create a country first
  const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
  const country = await api.resources.countries.post({ inputRecord: countryDoc });
  
  // Create an author
  const authorDoc = createJsonApiDocument('authors', { name: 'Test Author' });
  const author = await api.resources.authors.post({ inputRecord: authorDoc });
  
  // Create a book with proper relationships
  const bookDoc = {
    data: {
      type: 'books',
      attributes: { title: 'Test Book' },
      relationships: {
        country: { data: { type: 'countries', id: String(country.data.id) } }
      }
    }
  };
  const book = await api.resources.books.post({ inputRecord: bookDoc });
  
  // Create the many-to-many relationship
  await db('basic_book_authors').insert({
    author_id: author.data.id,
    book_id: book.data.id
  });
  
  // Now try to query authors with books included
  console.log('Querying authors with books included...');
  try {
    const result = await api.resources.authors.query({
      queryParams: { include: ['books'] }
    });
    console.log('Success!', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  await db.destroy();
}

test().catch(console.error);