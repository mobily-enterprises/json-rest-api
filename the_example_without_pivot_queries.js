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
    bio: { type: 'string' },
    country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
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

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    isbn: { type: 'string' },
    year: { type: 'number' },
    publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher' }
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

// Pivot table - NOT directly queried in this example
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
// CREATE ALL DATA VIA PARENT TABLES ONLY
// ==============================================================

console.log('\n=== Creating Data Using Parent Tables Only ===\n');

// 1. Create countries
console.log('1. Creating countries...');
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
console.log('   ✓ Created 2 countries');

// 2. Create publishers
console.log('\n2. Creating publishers...');
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

const oxford = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: { name: 'Oxford University Press' },
      relationships: {
        country: { data: { type: 'countries', id: uk.id } }
      }
    }
  }
});
console.log('   ✓ Created 2 publishers');

// 3. Create authors
console.log('\n3. Creating authors...');
const neil = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: { 
        name: 'Neil Gaiman',
        bio: 'English author of fiction, horror, fantasy, and graphic novels'
      },
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
      attributes: { 
        name: 'Terry Pratchett',
        bio: 'English humorist, satirist, and author of fantasy novels'
      },
      relationships: {
        country: { data: { type: 'countries', id: uk.id } }
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
      },
      relationships: {
        country: { data: { type: 'countries', id: usa.id } }
      }
    }
  }
});
console.log('   ✓ Created 3 authors');

// 4. Create books WITH author relationships
console.log('\n4. Creating books with author relationships...');

// Good Omens - Co-authored by Neil Gaiman and Terry Pratchett
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
        publisher: { data: { type: 'publishers', id: penguin.id } },
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
console.log('   ✓ Created "Good Omens" with 2 co-authors');

// American Gods - By Neil Gaiman
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
        publisher: { data: { type: 'publishers', id: penguin.id } },
        authors: { 
          data: [
            { type: 'authors', id: neil.id }
          ]
        }
      }
    }
  }
});
console.log('   ✓ Created "American Gods" with 1 author');

// The Stand - By Stephen King
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
        publisher: { data: { type: 'publishers', id: penguin.id } },
        authors: { 
          data: [
            { type: 'authors', id: stephen.id }
          ]
        }
      }
    }
  }
});
console.log('   ✓ Created "The Stand" with 1 author');

// The Long Earth - Co-authored by Terry Pratchett and Stephen Baxter (we'll use Stephen King for demo)
const longEarth = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: { 
        title: 'The Long Earth',
        isbn: '978-0062067777',
        year: 2012
      },
      relationships: {
        publisher: { data: { type: 'publishers', id: oxford.id } },
        authors: { 
          data: [
            { type: 'authors', id: terry.id },
            { type: 'authors', id: stephen.id }
          ]
        }
      }
    }
  }
});
console.log('   ✓ Created "The Long Earth" with 2 co-authors');

// ==============================================================
// QUERY DATA USING PARENT TABLES ONLY
// ==============================================================

console.log('\n\n=== Querying Data Using Parent Tables Only ===\n');

// 1. Get all books with their authors
console.log('1. Query all books with authors (GET /books?include=authors):\n');
const allBooks = await api.resources.books.query({
  queryParams: { 
    include: ['authors'] 
  },
  simplified: false
});

allBooks.data.forEach(book => {
  const authorNames = book.relationships.authors.data
    .map(authorRef => {
      const author = allBooks.included.find(inc => 
        inc.type === 'authors' && inc.id === authorRef.id
      );
      return author.attributes.name;
    })
    .join(' & ');
  
  console.log(`   • "${book.attributes.title}" (${book.attributes.year}) by ${authorNames}`);
});

// 2. Get all authors with their books
console.log('\n\n2. Query all authors with their books (GET /authors?include=books):\n');
const allAuthors = await api.resources.authors.query({
  queryParams: { 
    include: ['books'] 
  },
  simplified: false
});

allAuthors.data.forEach(author => {
  console.log(`   • ${author.attributes.name}:`);
  
  if (author.relationships.books && author.relationships.books.data.length > 0) {
    author.relationships.books.data.forEach(bookRef => {
      const book = allAuthors.included.find(inc => 
        inc.type === 'books' && inc.id === bookRef.id
      );
      console.log(`     - ${book.attributes.title} (${book.attributes.year})`);
    });
  } else {
    console.log('     - No books');
  }
});

// 3. Get a specific author with all their books and co-authors
console.log('\n\n3. Get Neil Gaiman with books and co-authors (GET /authors/' + neil.id + '?include=books.authors):\n');
const neilDetails = await api.resources.authors.get({
  id: neil.id,
  queryParams: { 
    include: ['books.authors'] 
  },
  simplified: false
});

console.log(`   Author: ${neilDetails.data.attributes.name}`);
console.log(`   Bio: ${neilDetails.data.attributes.bio}`);
console.log('\n   Books:');

neilDetails.data.relationships.books.data.forEach(bookRef => {
  const book = neilDetails.included.find(inc => 
    inc.type === 'books' && inc.id === bookRef.id
  );
  
  const coAuthors = book.relationships.authors.data
    .map(authorRef => {
      const author = neilDetails.included.find(inc => 
        inc.type === 'authors' && inc.id === authorRef.id
      );
      return author.attributes.name;
    })
    .filter(name => name !== neilDetails.data.attributes.name);
  
  if (coAuthors.length > 0) {
    console.log(`   - ${book.attributes.title} (co-authored with ${coAuthors.join(', ')})`);
  } else {
    console.log(`   - ${book.attributes.title} (solo work)`);
  }
});

// 4. Complex query with nested includes
console.log('\n\n4. Books with full details (GET /books?include=authors.country,publisher.country):\n');
const detailedBooks = await api.resources.books.query({
  queryParams: { 
    include: ['authors.country', 'publisher.country'] 
  },
  simplified: false
});

detailedBooks.data.forEach(book => {
  // Get publisher info
  const publisher = detailedBooks.included.find(inc => 
    inc.type === 'publishers' && inc.id === book.relationships.publisher.data.id
  );
  const publisherCountry = detailedBooks.included.find(inc => 
    inc.type === 'countries' && inc.id === publisher.relationships.country.data.id
  );
  
  console.log(`\n   📚 "${book.attributes.title}" (${book.attributes.year})`);
  console.log(`      Publisher: ${publisher.attributes.name} (${publisherCountry.attributes.name})`);
  console.log(`      Authors:`);
  
  book.relationships.authors.data.forEach(authorRef => {
    const author = detailedBooks.included.find(inc => 
      inc.type === 'authors' && inc.id === authorRef.id
    );
    const country = detailedBooks.included.find(inc => 
      inc.type === 'countries' && inc.id === author.relationships.country.data.id
    );
    console.log(`      - ${author.attributes.name} (${country.attributes.name})`);
  });
});

// 5. Show the actual JSON response for one query
console.log('\n\n5. JSON Response Example - Book with authors:\n');
const jsonExample = await api.resources.books.get({
  id: goodOmens.id,
  queryParams: { 
    include: ['authors'] 
  },
  simplified: false
});
console.log(JSON.stringify(jsonExample, null, 2));

console.log('\n\n=== Summary ===');
console.log('\nKey points demonstrated:');
console.log('• Created books WITH author relationships in a single POST request');
console.log('• Never directly queried the book_authors pivot table');
console.log('• All queries used the parent tables (books/authors) with ?include=');
console.log('• The many-to-many relationships work transparently through the pivot table');
console.log('• Nested includes allow complex data fetching in one request');

await knex.destroy();