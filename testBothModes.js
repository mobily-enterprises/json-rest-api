import { RestApiPlugin, RestApiKnexPlugin } from './index.js';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';

const inspect = (obj) => util.inspect(obj, { depth: 5 });

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

const api = new Api({ name: 'test-api', logLevel: 'error' });
await api.use(RestApiPlugin, {});
await api.use(RestApiKnexPlugin, { knex });

// Create a simple many-to-many setup
await api.addResource('authors', {
  schema: { name: { type: 'string' } },
  relationships: { 
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});

await api.addResource('books', {
  schema: { 
    title: { type: 'string' }
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
  }
});

await api.addResource('book_authors', {
  schema: {
    book_id: { type: 'id', belongsTo: 'books', as: 'book' },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author' }
  }
});

// Create tables
await api.resources.authors.createKnexTable();
await api.resources.books.createKnexTable();
await api.resources['book_authors'].createKnexTable();

// Create test data
const author1 = await api.resources.authors.post({ name: 'Author 1' });
const author2 = await api.resources.authors.post({ name: 'Author 2' });
const book1 = await api.resources.books.post({ title: 'Book 1' });
const book2 = await api.resources.books.post({ title: 'Book 2' });
const book3 = await api.resources.books.post({ title: 'Book 3' });

// Create relationships
await api.resources['book_authors'].post({ book: book1.id, author: author1.id });
await api.resources['book_authors'].post({ book: book1.id, author: author2.id });
await api.resources['book_authors'].post({ book: book2.id, author: author1.id });

console.log('=== SINGLE RECORD GET - Both Modes ===\n');

// Test GET single record - JSON:API mode
const authorJsonApi = await api.resources.authors.get({ 
  id: author1.id, 
  simplified: false 
});
console.log('GET Author 1 - JSON:API mode:');
console.log('Relationships:', inspect(authorJsonApi.data.relationships));

// Test GET single record - Simplified mode  
const authorSimplified = await api.resources.authors.get({ 
  id: author1.id, 
  simplified: true 
});
console.log('\nGET Author 1 - Simplified mode:');
console.log(inspect(authorSimplified));

console.log('\n=== QUERY MULTIPLE RECORDS - Both Modes ===\n');

// Test QUERY - JSON:API mode
const authorsJsonApi = await api.resources.authors.query({ 
  simplified: false 
});
console.log('QUERY All Authors - JSON:API mode:');
authorsJsonApi.data.forEach(author => {
  console.log(`- ${author.attributes.name}: books = ${author.relationships?.books?.data?.map(b => b.id).join(', ') || 'none'}`);
});

// Test QUERY - Simplified mode
const authorsSimplified = await api.resources.authors.query({ 
  simplified: true 
});
console.log('\nQUERY All Authors - Simplified mode:');
authorsSimplified.forEach(author => {
  console.log(`- ${author.name}: books_ids = [${author.books_ids?.join(', ') || ''}]`);
});

console.log('\n=== WITH INCLUDES - Both Modes ===\n');

// Test with includes - JSON:API mode
const authorWithIncludeJsonApi = await api.resources.authors.get({ 
  id: author1.id, 
  queryParams: { include: ['books'] },
  simplified: false 
});
console.log('GET Author 1 with include - JSON:API mode:');
console.log('Relationships:', inspect(authorWithIncludeJsonApi.data.relationships));
console.log('Included count:', authorWithIncludeJsonApi.included?.length || 0);

// Test with includes - Simplified mode
const authorWithIncludeSimplified = await api.resources.authors.get({ 
  id: author1.id, 
  queryParams: { include: ['books'] },
  simplified: true 
});
console.log('\nGET Author 1 with include - Simplified mode:');
console.log('books_ids:', authorWithIncludeSimplified.books_ids);
console.log('books:', inspect(authorWithIncludeSimplified.books));

await knex.destroy();