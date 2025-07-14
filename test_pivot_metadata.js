import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import knexLib from 'knex';

const knex = knexLib({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

const api = new Api({ name: 'test' });
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Setup tables
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true }
  },
  relationships: {
    books: { 
      hasMany: 'books', 
      through: 'book_authors',
      foreignKey: 'author_id', 
      otherKey: 'book_id'
    }
  }
});

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true }
  },
  relationships: {
    authors: { 
      hasMany: 'authors', 
      through: 'book_authors',
      foreignKey: 'book_id', 
      otherKey: 'author_id'
    }
  }
});

await api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', belongsTo: 'books', as: 'book', required: true },
    author_id: { type: 'number', belongsTo: 'authors', as: 'author', required: true },
    role: { type: 'string', default: 'author' },
    order: { type: 'number', default: 0 }
  }
});

await api.resources.authors.createKnexTable();
await api.resources.books.createKnexTable();
await api.resources.book_authors.createKnexTable();

// Create data
const author1 = await api.resources.authors.post({
  inputRecord: { data: { type: 'authors', attributes: { name: 'Primary Author' } } }
});

const author2 = await api.resources.authors.post({
  inputRecord: { data: { type: 'authors', attributes: { name: 'Editor' } } }
});

const book = await api.resources.books.post({
  inputRecord: { 
    data: { 
      type: 'books', 
      attributes: { title: 'Test Book' },
      relationships: {
        authors: { 
          data: [
            { type: 'authors', id: author1.id },
            { type: 'authors', id: author2.id }
          ]
        }
      }
    } 
  }
});

// Update pivot table entries with role/order metadata
const pivotEntries = await api.resources.book_authors.query({ simplified: false });
await api.resources.book_authors.patch({
  id: pivotEntries.data[0].id,
  inputRecord: {
    data: {
      type: 'book_authors',
      id: pivotEntries.data[0].id,
      attributes: { role: 'primary-author', order: 1 }
    }
  }
});

await api.resources.book_authors.patch({
  id: pivotEntries.data[1].id,
  inputRecord: {
    data: {
      type: 'book_authors',
      id: pivotEntries.data[1].id,
      attributes: { role: 'editor', order: 2 }
    }
  }
});

console.log('\n=== Testing Pivot Table Metadata ===\n');

// 1. Query through parent table - metadata NOT included
console.log('1. Query book with authors (GET /books/1?include=authors):');
const bookWithAuthors = await api.resources.books.get({
  id: book.id,
  queryParams: { include: ['authors'] },
  simplified: false
});

console.log('\nBook relationships:');
console.log(JSON.stringify(bookWithAuthors.data.relationships, null, 2));
console.log('\nNotice: No role or order information is included!');

// 2. Query pivot table directly - metadata IS included
console.log('\n\n2. Query pivot table directly (GET /book_authors?include=book,author):');
const pivotData = await api.resources.book_authors.query({
  queryParams: { include: ['book', 'author'] },
  simplified: false
});

pivotData.data.forEach(entry => {
  const author = pivotData.included.find(i => i.type === 'authors' && i.id === entry.relationships.author.data.id);
  const book = pivotData.included.find(i => i.type === 'books' && i.id === entry.relationships.book.data.id);
  console.log(`\n${book.attributes.title} <-> ${author.attributes.name}`);
  console.log(`  Role: ${entry.attributes.role}`);
  console.log(`  Order: ${entry.attributes.order}`);
});

console.log('\n\n=== Conclusion ===');
console.log('• The library does NOT use pivot table metadata (role, order)');
console.log('• When querying through parent tables, only the relationship exists');
console.log('• To access pivot metadata, you must query the pivot table directly');
console.log('• The metadata is just stored data - not used by the n:n mechanism');

await knex.destroy();