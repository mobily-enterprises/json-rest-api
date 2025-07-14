import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import knexLib from 'knex';

// Create Knex instance using SQLite for simplicity
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({
  name: 'bookstore-api'
});

// Add plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// ==============================================================
// RESOURCE DEFINITIONS
// ==============================================================

await api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    code: { type: 'string', required: true }
  }
});
await api.resources.countries.createKnexTable();

await api.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
  },
  relationships: {
    books: { 
      hasMany: 'books', 
      foreignKey: 'publisher_id',
      as: 'books'
    }
  }
});
await api.resources.publishers.createKnexTable();

await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
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
await api.resources.authors.createKnexTable();

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    isbn: { type: 'string' },
    publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher' }
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
await api.resources.books.createKnexTable();

await api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { 
      type: 'number', 
      belongsTo: 'books', 
      as: 'book',
      required: true 
    },
    author_id: { 
      type: 'number', 
      belongsTo: 'authors', 
      as: 'author',
      required: true 
    },
    role: { type: 'string', default: 'author' },
    order: { type: 'number', default: 0 }
  }
});
await api.resources.book_authors.createKnexTable();

// ==============================================================
// CREATE SAMPLE DATA
// ==============================================================

// Countries
const usa = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: { name: 'United States', code: 'US' }
    }
  }
});

const uk = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: { name: 'United Kingdom', code: 'UK' }
    }
  }
});

// Publishers
const penguin = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: { name: 'Penguin Random House' },
      relationships: {
        country: { data: { type: 'countries', id: usa.id } }
      }
    }
  }
});

// Authors
const neil = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: { name: 'Neil Gaiman' },
      relationships: {
        country: { data: { type: 'countries', id: uk.id } }
      }
    }
  }
});

const terry = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: { name: 'Terry Pratchett' },
      relationships: {
        country: { data: { type: 'countries', id: uk.id } }
      }
    }
  }
});

// Books
const goodOmens = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: { 
        title: 'Good Omens',
        isbn: '978-0060853983'
      },
      relationships: {
        publisher: { data: { type: 'publishers', id: penguin.id } }
      }
    }
  }
});

const americanGods = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: { 
        title: 'American Gods',
        isbn: '978-0380789030'
      },
      relationships: {
        publisher: { data: { type: 'publishers', id: penguin.id } }
      }
    }
  }
});

// Create many-to-many relationships
await api.resources.book_authors.post({
  inputRecord: {
    data: {
      type: 'book_authors',
      attributes: { 
        role: 'co-author',
        order: 1
      },
      relationships: {
        book: { data: { type: 'books', id: goodOmens.id } },
        author: { data: { type: 'authors', id: neil.id } }
      }
    }
  }
});

await api.resources.book_authors.post({
  inputRecord: {
    data: {
      type: 'book_authors',
      attributes: { 
        role: 'co-author',
        order: 2
      },
      relationships: {
        book: { data: { type: 'books', id: goodOmens.id } },
        author: { data: { type: 'authors', id: terry.id } }
      }
    }
  }
});

await api.resources.book_authors.post({
  inputRecord: {
    data: {
      type: 'book_authors',
      attributes: { 
        role: 'author',
        order: 1
      },
      relationships: {
        book: { data: { type: 'books', id: americanGods.id } },
        author: { data: { type: 'authors', id: neil.id } }
      }
    }
  }
});

// ==============================================================
// JSON OUTPUT EXAMPLES
// ==============================================================

console.log('\n=== JSON API RESPONSES ===\n');

// 1. Get a book with its authors
console.log('1. GET /books/' + goodOmens.id + '?include=authors\n');
const bookWithAuthors = await api.resources.books.get({
  id: goodOmens.id,
  queryParams: { 
    include: ['authors'] 
  },
  simplified: false
});
console.log(JSON.stringify(bookWithAuthors, null, 2));

// 2. Get an author with their books
console.log('\n\n2. GET /authors/' + neil.id + '?include=books\n');
const authorWithBooks = await api.resources.authors.get({
  id: neil.id,
  queryParams: { 
    include: ['books'] 
  },
  simplified: false
});
console.log(JSON.stringify(authorWithBooks, null, 2));

// 3. Query the pivot table directly
console.log('\n\n3. GET /book_authors?include=book,author\n');
const pivotRecords = await api.resources.book_authors.query({
  queryParams: {
    include: ['book', 'author']
  },
  simplified: false
});
console.log(JSON.stringify(pivotRecords, null, 2));

// 4. Complex nested include
console.log('\n\n4. GET /books?include=authors.country,publisher.country\n');
const complexQuery = await api.resources.books.query({
  queryParams: {
    include: ['authors.country', 'publisher.country']
  },
  simplified: false
});
console.log(JSON.stringify(complexQuery, null, 2));

await knex.destroy();