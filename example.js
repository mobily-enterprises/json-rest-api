import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from './index.js';
import knexLib from 'knex';
import util from 'util';


// import { setupDatabase } from './setup-database.js';

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({
  name: 'book-catalog-api',
  version: '1.0.0'
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Define schemas for our book catalog system

// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true }, // ISO country code
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  },
  returnFullRecord: {
    post: false,
    patch: false,
    put: false
  },
  // tableName: 'stocazzo',
  // idProperty: 'anotherId'
});
await api.resources.countries.createKnexTable()

// Publishers table
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 200 },
    country_id: { type: 'number',  belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});
await api.resources.publishers.createKnexTable()

// Authors table
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 200 },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});
await api.resources.authors.createKnexTable()

// Books table
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true, max: 300 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
    publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher' },
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' },
  }
});
await api.resources.books.createKnexTable()

// Book-Authors pivot table (many-to-many relationship)
await api.addResource('book_authors', {
  schema: {
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});
await api.resources.book_authors.createKnexTable()



/////////////////////////////////////////////////////////////////////////////////////////////


// Now you can use the API directly in your code
try {

  // Create a country
  const countryResult1 = await api.resources.countries.post({
    name: 'United States',
    code: 'US'
  });
  console.log('Created country:', countryResult1);

  // Create another country
  const countryResult2 = await api.resources.countries.post({
    name: 'United Kingdom',
  });
  console.log('Created country:', countryResult2);

  // Create publisher using the OLD way (foreign key field name)
  const publisher1Result = await api.resources.publishers.post({
    name: 'Penguin Random House',
    country_id: countryResult1.id
  });
  console.log('Created publisher1 (using country_id):', publisher1Result);

  // Create publisher using the NEW way (relationship alias)
  const publisher1bResult = await api.resources.publishers.post({
    name: 'HarperCollins',
    country: countryResult2.id  // Using 'country' instead of 'country_id'
  });
  console.log('Created publisher1b (using country alias):', publisher1bResult);

  debugger
  // Test error case: providing both country_id and country
  try {
    await api.resources.publishers.post({
      name: 'Invalid Publisher',
      country_id: countryResult1.id,
      country: countryResult2.id  // ERROR: both specified!
    });
  } catch (error) {
    console.log('Expected error when both country_id and country are provided:', error.message);
  }

    // Create another publisher. NOT the simplified version
  const publisher2Result = await api.resources.publishers.post({
    inputRecord: {
      data: {
        type: 'publishers',
        attributes: {
          name: 'Apress'
        },
        relationships: {
          country: {
            data: { type: 'countries', id: countryResult1.id }
          }
        }
      }
    },
    simplified: false
  });
  console.log('Created publisher:', publisher2Result);


  const fetchedPublisher = await api.resources.publishers.get({ 
    id: publisher2Result.data.id,
    queryParams: { include: ['country']},
    simplified: false
  }) 
  console.log('Refetched publisher:', util.inspect(fetchedPublisher, { depth: 5 }));

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
            data: { type: 'countries', id: countryResult1.id }
          }
        }
      }
    }
  });


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
  console.log('Created author:');

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
  console.log('Created another author:');

  // Create a book with relationships
  const bookResult = await api.resources.books.post({
    simplified: false,
    queryParams: { include: ['authors'] },       
     inputRecord: {
      data: {
        type: 'books',
        attributes: {
          title: '1984'
        },
        relationships: {
          country: {
            data: { type: 'countries', id: countryResult1.id }
          },
          publisher: {
            data: { type: 'publishers', id: publisherResult.id }
          },
          authors: {
            data: [
              { type: 'authors', id: author1Result.id },
              { type: 'authors', id: author2Result.id }

            ]
          }
        }
      }
    }
  });
  console.log('Created book:', util.inspect(bookResult, { depth: 5 }))

  const pivotRecords = await knex('book_authors').where('book_id', bookResult.data.id);
console.log('Pivot records:', pivotRecords);  
                                               


  // Clean up database connection
  await knex.destroy();
  console.log('\nExample completed successfully!');



  /*

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
  console.error('Error:', error.message, error.details);
  console.error('Stack trace:', error.stack);
  await knex.destroy();
  process.exit(1);
}


