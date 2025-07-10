import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from './index.js';
import Knex from 'knex';

// Create API instance
const api = new Api({
  name: 'book-catalog-api',
  version: '1.0.0'
});

// Database connection
const knex = Knex({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Define schemas for our book catalog system

// Countries table
api.addResource('countries', {
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
api.addResource('publishers', {
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
api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});

// Books table
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 300 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
  }
});

// Book-Authors pivot table (many-to-many relationship)
api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});


/////////////////////////////////////////////////////////////////////////////////////////////


// Now you can use the API directly in your code
// Create a country
const countryResult = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: {
        name: 'United States',
        code: 'US'
      }
    }
  }
});
console.log('Created country:', countryResult.data.id);

// Create a publisher
const publisherResult = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: {
        name: 'Penguin Random House',
      },
      relationships: {
        country: {
          data: { type: 'countries', id: countryResult.data.id }
        }
      }
    }
  }
});
console.log('Created publisher:', publisherResult.data.id);

// Query all publishers
const publishers = await api.resources.publishers.query({
  queryParams: {
    include: ['country'],
    sort: ['name']
  }
});
console.log('Found', publishers.data.length, 'publishers');
