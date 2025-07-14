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
// MINIMAL N:N SETUP - Only Books, Authors, and Pivot Table
// ==============================================================

// 1. Authors table
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    bio: { type: 'string' }
  },
  relationships: {
    books: { 
      hasMany: 'books', 
      through: 'book_authors',  // Many-to-many via pivot table
      foreignKey: 'author_id', 
      otherKey: 'book_id'
    }
  }
});
await api.resources.authors.createKnexTable();

// 2. Books table
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    isbn: { type: 'string' },
    year: { type: 'number' }
  },
  relationships: {
    authors: { 
      hasMany: 'authors', 
      through: 'book_authors',  // Many-to-many via pivot table
      foreignKey: 'book_id', 
      otherKey: 'author_id'
    }
  }
});
await api.resources.books.createKnexTable();

// 3. Pivot table (book_authors) - The bridge between books and authors
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
    // Optional: Additional metadata about the relationship
    role: { type: 'string', default: 'author' }, // e.g., 'author', 'co-author', 'editor'
    order: { type: 'number', default: 0 } // Order of authors on the book
  }
});
await api.resources.book_authors.createKnexTable();

// ==============================================================
// CREATE DATA USING PARENT TABLES ONLY
// ==============================================================

console.log('\n=== Creating Authors and Books ===\n');

// Create authors
const neil = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: { 
        name: 'Neil Gaiman',
        bio: 'English author of fiction, horror, fantasy, and graphic novels'
      }
    }
  }
});

const terry = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: { 
        name: 'Terry Pratchett',
        bio: 'English humorist, satirist, and author of fantasy novels'
      }
    }
  }
});

const stephen = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: { 
        name: 'Stephen King',
        bio: 'American author of horror, supernatural fiction, and fantasy'
      }
    }
  }
});

console.log('✓ Created 3 authors');

// Create books WITH author relationships (this automatically creates pivot table entries)
console.log('\nCreating books with author relationships...\n');

// Book 1: Good Omens - Co-authored by Neil Gaiman and Terry Pratchett
const goodOmens = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: { 
        title: 'Good Omens',
        isbn: '978-0060853983',
        year: 1990
      },
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
console.log('✓ Created "Good Omens" with 2 co-authors');

// Book 2: American Gods - By Neil Gaiman alone
const americanGods = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: { 
        title: 'American Gods',
        isbn: '978-0380789030',
        year: 2001
      },
      relationships: {
        authors: { 
          data: [
            { type: 'authors', id: neil.id }
          ]
        }
      }
    }
  }
});
console.log('✓ Created "American Gods" by Neil Gaiman');

// Book 3: The Stand - By Stephen King
const theStand = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: { 
        title: 'The Stand',
        isbn: '978-0307743688',
        year: 1978
      },
      relationships: {
        authors: { 
          data: [
            { type: 'authors', id: stephen.id }
          ]
        }
      }
    }
  }
});
console.log('✓ Created "The Stand" by Stephen King');

// ==============================================================
// QUERY N:N RELATIONSHIPS - NO PIVOT TABLE QUERIES
// ==============================================================

console.log('\n\n=== Querying Many-to-Many Relationships ===\n');

// 1. Get all books with their authors
console.log('1. GET /books?include=authors\n');
const allBooks = await api.resources.books.query({
  queryParams: { 
    include: ['authors'] 
  },
  simplified: false
});

console.log('Books and their authors:');
allBooks.data.forEach(book => {
  const authorNames = book.relationships.authors.data
    .map(authorRef => {
      const author = allBooks.included.find(inc => 
        inc.type === 'authors' && inc.id === authorRef.id
      );
      return author.attributes.name;
    })
    .join(' & ');
  
  console.log(`  • "${book.attributes.title}" (${book.attributes.year}) by ${authorNames}`);
});

// 2. Get all authors with their books
console.log('\n\n2. GET /authors?include=books\n');
const allAuthors = await api.resources.authors.query({
  queryParams: { 
    include: ['books'] 
  },
  simplified: false
});

console.log('Authors and their books:');
allAuthors.data.forEach(author => {
  console.log(`  • ${author.attributes.name}:`);
  
  author.relationships.books.data.forEach(bookRef => {
    const book = allAuthors.included.find(inc => 
      inc.type === 'books' && inc.id === bookRef.id
    );
    console.log(`    - ${book.attributes.title} (${book.attributes.year})`);
  });
});

// 3. Get a specific author with nested includes
console.log('\n\n3. GET /authors/' + neil.id + '?include=books.authors\n');
const neilDetails = await api.resources.authors.get({
  id: neil.id,
  queryParams: { 
    include: ['books.authors'] 
  },
  simplified: false
});

console.log(`Author: ${neilDetails.data.attributes.name}`);
console.log(`Bio: ${neilDetails.data.attributes.bio}`);
console.log('\nBooks with co-authors:');

neilDetails.data.relationships.books.data.forEach(bookRef => {
  const book = neilDetails.included.find(inc => 
    inc.type === 'books' && inc.id === bookRef.id
  );
  
  const allAuthors = book.relationships.authors.data
    .map(authorRef => {
      const author = neilDetails.included.find(inc => 
        inc.type === 'authors' && inc.id === authorRef.id
      );
      return author.attributes.name;
    });
  
  console.log(`  - ${book.attributes.title}: ${allAuthors.join(' & ')}`);
});

// 4. Show JSON response structure
console.log('\n\n4. JSON Response Example\n');
console.log('GET /books/' + goodOmens.id + '?include=authors');
const jsonExample = await api.resources.books.get({
  id: goodOmens.id,
  queryParams: { 
    include: ['authors'] 
  },
  simplified: false
});
console.log('\n' + JSON.stringify(jsonExample, null, 2));

console.log('\n\n=== Key Takeaways ===\n');
console.log('1. Only 3 tables needed: books, authors, and book_authors (pivot)');
console.log('2. Relationships defined with "through" parameter pointing to pivot table');
console.log('3. Creating a book with authors automatically populates the pivot table');
console.log('4. All queries use parent tables (books/authors) with ?include=');
console.log('5. The pivot table is transparent - never queried directly');
console.log('6. Full many-to-many support with JSON:API compliant responses');

await knex.destroy();