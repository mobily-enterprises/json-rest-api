import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import knexLib from 'knex';

const knex = knexLib({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Enable query logging to see what SQL is generated
knex.on('query', (queryData) => {
  console.log('\n📊 SQL:', queryData.sql);
  if (queryData.bindings?.length > 0) {
    console.log('   Bindings:', queryData.bindings);
  }
});

const api = new Api({ name: 'demo' });
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

console.log('=== UNDERSTANDING HOW "through" WORKS ===\n');

// Setup tables
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true }
  },
  relationships: {
    books: { 
      hasMany: 'books', 
      through: 'book_authors',    // <-- This tells the system to use book_authors as a junction table
      foreignKey: 'author_id',    // <-- Column in book_authors that points to authors.id
      otherKey: 'book_id'        // <-- Column in book_authors that points to books.id
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
      through: 'book_authors',    // <-- Same junction table
      foreignKey: 'book_id',      // <-- Column in book_authors that points to books.id
      otherKey: 'author_id'      // <-- Column in book_authors that points to authors.id
    }
  }
});

await api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true },
    author_id: { type: 'number', required: true }
  }
});

console.log('\n1️⃣ Creating tables...');
await api.resources.authors.createKnexTable();
await api.resources.books.createKnexTable();
await api.resources.book_authors.createKnexTable();

// Create test data
console.log('\n2️⃣ Creating authors...');
const neil = await api.resources.authors.post({
  inputRecord: { data: { type: 'authors', attributes: { name: 'Neil Gaiman' } } }
});

const terry = await api.resources.authors.post({
  inputRecord: { data: { type: 'authors', attributes: { name: 'Terry Pratchett' } } }
});

console.log('\n3️⃣ Creating a book with multiple authors...');
console.log('   When we create a book with relationships.authors...');
const goodOmens = await api.resources.books.post({
  inputRecord: { 
    data: { 
      type: 'books', 
      attributes: { title: 'Good Omens' },
      relationships: {
        authors: { 
          data: [
            { type: 'authors', id: neil.id },
            { type: 'authors', id: terry.id }
          ]
        }
      }
    } 
  }
});

console.log('\n   ✅ The system automatically created entries in book_authors!');

// Show what's in the pivot table
console.log('\n4️⃣ Checking the pivot table...');
const pivotData = await knex('book_authors').select('*');
console.log('\nContents of book_authors table:');
console.table(pivotData);

console.log('\n5️⃣ Now let\'s query a book with its authors...');
console.log('   GET /books/1?include=authors\n');

const bookWithAuthors = await api.resources.books.get({
  id: goodOmens.id,
  queryParams: { include: ['authors'] },
  simplified: false
});

console.log('\n🔍 What happened behind the scenes:');
console.log('\n1. First, it fetched the book');
console.log('2. Then it saw we want to include "authors"');
console.log('3. It found the relationship definition with through: "book_authors"');
console.log('4. It executed a JOIN query through the pivot table:');
console.log('   - FROM book_authors WHERE book_id = ?');
console.log('   - JOIN authors ON authors.id = book_authors.author_id');
console.log('5. It returned the related authors');

console.log('\n📦 Result:');
console.log('Book:', bookWithAuthors.data.attributes.title);
console.log('Authors:', bookWithAuthors.included.map(a => a.attributes.name).join(', '));

console.log('\n\n6️⃣ The inverse also works - get an author with their books...');
const authorWithBooks = await api.resources.authors.get({
  id: neil.id,
  queryParams: { include: ['books'] },
  simplified: false
});

console.log('\n📦 Result:');
console.log('Author:', authorWithBooks.data.attributes.name);
console.log('Books:', authorWithBooks.included.map(b => b.attributes.title).join(', '));

console.log('\n\n=== HOW "through" WORKS - SUMMARY ===\n');
console.log('1. "through" identifies the pivot/junction table to use');
console.log('2. "foreignKey" is the column in the pivot table pointing to THIS resource');
console.log('3. "otherKey" is the column in the pivot table pointing to the OTHER resource');
console.log('4. When creating relationships, it auto-populates the pivot table');
console.log('5. When querying with ?include=, it JOINs through the pivot table');
console.log('6. The pivot table is transparent - you work with the parent resources');

await knex.destroy();