import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from '../../index.js';

/**
 * Creates a basic API configuration with Countries, Publishers, Authors, Books
 */
export async function createBasicApi(knex) {
  const api = new Api({
    name: 'basic-test-api',
    version: '1.0.0'
  });

  await api.use(RestApiPlugin, {
    simplified: false,
    returnFullRecord: {
      post: true,  // Need to return record to get ID for tests
      put: false,
      patch: false,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'name', 'code']
  });
  
  await api.use(RestApiKnexPlugin, { knex });

  // Countries table
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 },
      code: { type: 'string', max: 2, unique: true }
    },
    relationships: {
      publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
      books: { hasMany: 'books', foreignKey: 'country_id' }
    },
    tableName: 'basic_countries'
  });
  await api.resources.countries.createKnexTable();

  // Publishers table
  await api.addResource('publishers', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
    },
    relationships: {
      books: { hasMany: 'books', foreignKey: 'publisher_id' }
    },
    tableName: 'basic_publishers'
  });
  await api.resources.publishers.createKnexTable();

  // Authors table
  await api.addResource('authors', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 }
    },
    relationships: {
      books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
    },
    tableName: 'basic_authors'
  });
  await api.resources.authors.createKnexTable();

  // Books table
  await api.addResource('books', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 300, search: true },
      country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
      publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
    },
    relationships: {
      authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
    },
    tableName: 'basic_books'
  });
  await api.resources.books.createKnexTable();

  // Book-Authors pivot table
  await api.addResource('book_authors', {
    schema: {
      id: { type: 'id' },
      book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
      author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' }
    },
    tableName: 'basic_book_authors'
  });
  await api.resources.book_authors.createKnexTable();

  return api;
}

/**
 * Creates an extended API with additional fields for more complex testing
 */
export async function createExtendedApi(knex) {
  const api = new Api({
    name: 'extended-test-api',
    version: '1.0.0'
  });

  await api.use(RestApiPlugin, {
    simplified: false,
    returnFullRecord: {
      post: true,  // Need to return record to get ID for tests
      put: false,
      patch: false,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'price', 'language', 'population', 'name', 'code']
  });
  
  await api.use(RestApiKnexPlugin, { knex });

  // Countries with extended fields
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 },
      code: { type: 'string', max: 2, unique: true },
      capital: { type: 'string', max: 100 },
      population: { type: 'number' },
      currency: { type: 'string', max: 3 }
    },
    relationships: {
      publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
      books: { hasMany: 'books', foreignKey: 'country_id' },
      authors: { hasMany: 'authors', foreignKey: 'nationality_id' }
    },
    tableName: 'ext_countries'
  });
  await api.resources.countries.createKnexTable();

  // Publishers with extended fields
  await api.addResource('publishers', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      country_id: { type: 'number', belongsTo: 'countries', as: 'country' },
      founded_year: { type: 'number' },
      website: { type: 'string', max: 255 },
      active: { type: 'boolean', default: true }
    },
    relationships: {
      books: { hasMany: 'books', foreignKey: 'publisher_id' }
    },
    tableName: 'ext_publishers'
  });
  await api.resources.publishers.createKnexTable();

  // Authors with extended fields
  await api.addResource('authors', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      birth_date: { type: 'date' },
      biography: { type: 'text' },
      nationality_id: { type: 'number', belongsTo: 'countries', as: 'nationality' }
    },
    relationships: {
      books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
    },
    tableName: 'ext_authors'
  });
  await api.resources.authors.createKnexTable();

  // Books with extended fields
  await api.addResource('books', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 300, search: true },
      isbn: { type: 'string', max: 13 },
      pages: { type: 'number' },
      price: { type: 'decimal', precision: 10, scale: 2, search: true },
      published_date: { type: 'date' },
      language: { type: 'string', max: 2, default: 'en', search: true },
      country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
      publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
    },
    relationships: {
      authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
    },
    tableName: 'ext_books'
  });
  await api.resources.books.createKnexTable();

  // Book-Authors pivot with extended fields
  await api.addResource('book_authors', {
    schema: {
      id: { type: 'id' },
      book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
      author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
      contribution_type: { type: 'string', max: 50 },
      order: { type: 'number' }
    },
    tableName: 'ext_book_authors'
  });
  await api.resources.book_authors.createKnexTable();

  return api;
}

// Additional API configurations would go here (reviews, inventory, series, minimal)