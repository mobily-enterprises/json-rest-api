import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from './index.js';
import { setupDatabase } from './setup-database.js';

// Create API instance
const api = new Api({
  name: 'book-catalog-api',
  version: '1.0.0'
});

// Set up the database with tables
const knex = await setupDatabase();

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Define schemas for our book catalog system

// Countries table
await api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', required: true, max: 2, unique: true }, // ISO country code
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  }
});

// Publishers table
await api.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});

// Authors table
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});

// Books table
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 300 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
    publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher' },
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
  }
});

// Book-Authors pivot table (many-to-many relationship)
await api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});


/////////////////////////////////////////////////////////////////////////////////////////////


// Now you can use the API directly in your code
try {



  // Create a country
  const countryResult = await api.resources.countries.post({
          name: 'United States',
          code: 'US'
  });
  console.log('Created country:', countryResult);

  // Create another country
  const ukResult = await api.resources.countries.post({
    name: 'United Kingdom',
    code: 'UK'
  });
  console.log('Created country:', ukResult);

  // Clean up database connection
  await knex.destroy();
  console.log('\nExample completed successfully!');

  /*



  // Create a publisher
  const publisherResult = await api.resources.publishers.post({
    inputRecord: {
      data: {
        type: 'publishers',
        attributes: {
          name: 'Penguin Random House'
        },
        relationships: {
          country: {
            data: { type: 'countries', id: countryResult.data.id }
          }
        }
      }
    }
  });
  console.log('Created publisher:', publisherResult.data);

  // Create authors
  const author1Result = await api.resources.authors.post({
    inputRecord: {
      data: {
        type: 'authors',
        attributes: {
          name: 'George Orwell'
        }
      }
    }
  });
  console.log('Created author:', author1Result.data);

  const author2Result = await api.resources.authors.post({
    inputRecord: {
      data: {
        type: 'authors',
        attributes: {
          name: 'Aldous Huxley'
        }
      }
    }
  });
  console.log('Created author:', author2Result.data);

  // Create a book with relationships
  const bookResult = await api.resources.books.post({
    inputRecord: {
      data: {
        type: 'books',
        attributes: {
          title: '1984'
        },
        relationships: {
          country: {
            data: { type: 'countries', id: ukResult.data.id }
          },
          publisher: {
            data: { type: 'publishers', id: publisherResult.data.id }
          },
          authors: {
            data: [
              { type: 'authors', id: author1Result.data.id }
            ]
          }
        }
      }
    }
  });
  console.log('Created book:', bookResult.data);

  // Query books with included relationships
  const booksWithRelationships = await api.resources.books.query({
    include: 'authors,publisher,country'
  });
  console.log('\nBooks with relationships:');
  console.log(JSON.stringify(booksWithRelationships, null, 2));

  // Clean up
  await knex.destroy();
  console.log('\nExample completed successfully!');

*/

} catch (error) {
  console.error('Error:', error.message);
  await knex.destroy();
  process.exit(1);
}


