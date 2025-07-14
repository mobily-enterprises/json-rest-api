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
// RESOURCE DEFINITIONS - Following test pattern
// ==============================================================

// 1. Countries - Simple lookup table
await api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    code: { type: 'string', required: true }
  }
});
await api.resources.countries.createKnexTable();

// 2. Publishers
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

// 3. Authors
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
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

// 4. Books
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
      through: 'book_authors',  // Many-to-many via pivot table
      foreignKey: 'book_id', 
      otherKey: 'author_id'
    }
  }
});
await api.resources.books.createKnexTable();

// 5. Book Authors - PIVOT TABLE for many-to-many relationship
// This is the key to n:n relationships!
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
    // You can add extra fields to the pivot table
    role: { type: 'string', default: 'author' }, // e.g., 'author', 'co-author', 'editor'
    order: { type: 'number', default: 0 } // Order of authors on the book
  }
});
await api.resources.book_authors.createKnexTable();

// ==============================================================
// CREATE SAMPLE DATA
// ==============================================================

console.log('\n=== Creating Sample Data ===\n');

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

const stephen = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: { name: 'Stephen King' },
      relationships: {
        country: { data: { type: 'countries', id: usa.id } }
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

// ==============================================================
// CREATE MANY-TO-MANY RELATIONSHIPS VIA PIVOT TABLE
// ==============================================================

console.log('\n=== Creating Book-Author Relationships ===\n');

// Good Omens has TWO authors (Neil Gaiman and Terry Pratchett)
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

// American Gods has ONE author (Neil Gaiman)
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
// DEMONSTRATE N:N QUERIES
// ==============================================================

console.log('\n=== Demonstrating Many-to-Many Queries ===\n');

// 1. Get a book with its authors
console.log('1. Fetching "Good Omens" with authors:');
const bookWithAuthors = await api.resources.books.get({
  id: goodOmens.id,
  queryParams: { 
    include: ['authors'] 
  },
  simplified: false
});

console.log(`   Book: ${bookWithAuthors.data.attributes.title}`);
console.log(`   Authors included: ${bookWithAuthors.included.filter(r => r.type === 'authors').length}`);
bookWithAuthors.included
  .filter(r => r.type === 'authors')
  .forEach(author => {
    console.log(`   - ${author.attributes.name}`);
  });

// 2. Get an author with their books
console.log('\n2. Fetching Neil Gaiman with all his books:');
const authorWithBooks = await api.resources.authors.get({
  id: neil.id,
  queryParams: { 
    include: ['books'] 
  },
  simplified: false
});

console.log(`   Author: ${authorWithBooks.data.attributes.name}`);
console.log(`   Books included: ${authorWithBooks.included.filter(r => r.type === 'books').length}`);
authorWithBooks.included
  .filter(r => r.type === 'books')
  .forEach(book => {
    console.log(`   - ${book.attributes.title}`);
  });

// 3. Query the pivot table directly to see the relationships with metadata
console.log('\n3. Querying pivot table directly:');
const pivotRecords = await api.resources.book_authors.query({
  queryParams: {
    include: ['book', 'author']
  },
  simplified: false
});

console.log(`   Total relationships: ${pivotRecords.data.length}`);
pivotRecords.data.forEach(record => {
  const book = pivotRecords.included.find(r => 
    r.type === 'books' && r.id === record.relationships.book.data.id
  );
  const author = pivotRecords.included.find(r => 
    r.type === 'authors' && r.id === record.relationships.author.data.id
  );
  console.log(`   - ${book.attributes.title} <-> ${author.attributes.name} (${record.attributes.role})`);
});

// 4. Complex query: Books with authors and their countries
console.log('\n4. Complex nested include - Books with authors and their countries:');
const complexQuery = await api.resources.books.query({
  queryParams: {
    include: ['authors.country', 'publisher.country']
  },
  simplified: false
});

complexQuery.data.forEach(book => {
  console.log(`\n   Book: ${book.attributes.title}`);
  
  // Find publisher
  const publisher = complexQuery.included.find(r => 
    r.type === 'publishers' && r.id === book.relationships.publisher.data.id
  );
  const publisherCountry = complexQuery.included.find(r => 
    r.type === 'countries' && r.id === publisher.relationships.country.data.id
  );
  console.log(`   Publisher: ${publisher.attributes.name} (${publisherCountry.attributes.name})`);
  
  // Find authors
  console.log(`   Authors:`);
  if (book.relationships.authors && book.relationships.authors.data) {
    book.relationships.authors.data.forEach(authorRef => {
      const author = complexQuery.included.find(r => 
        r.type === 'authors' && r.id === authorRef.id
      );
      const country = complexQuery.included.find(r => 
        r.type === 'countries' && r.id === author.relationships.country.data.id
      );
      console.log(`   - ${author.attributes.name} (${country.attributes.name})`);
    });
  }
});

// ==============================================================
// DEMONSTRATE WORKING WITH THE PIVOT TABLE
// ==============================================================

console.log('\n\n=== Working with the Pivot Table ===\n');

// 5. Query all relationships for a specific book
console.log('5. Finding all authors of "Good Omens" via pivot table:');
const goodOmensAuthors = await api.resources.book_authors.query({
  queryParams: {
    include: ['author']
  },
  simplified: false
});

// Filter in memory for this example (normally you'd use search if enabled)
const goodOmensRelationships = goodOmensAuthors.data.filter(rel => 
  rel.relationships.book.data.id === String(goodOmens.id)
);

console.log(`   Found ${goodOmensRelationships.length} author(s):`);
goodOmensRelationships.forEach(rel => {
  const author = goodOmensAuthors.included.find(r => 
    r.type === 'authors' && r.id === rel.relationships.author.data.id
  );
  console.log(`   - ${author.attributes.name} (${rel.attributes.role}, order: ${rel.attributes.order})`);
});

// 6. Add a book with multiple authors in one operation
console.log('\n6. Creating a new book with multiple authors:');
const newBook = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: 'The Long Earth',
        isbn: '978-0062067777'
      },
      relationships: {
        publisher: { data: { type: 'publishers', id: oxford.id } }
      }
    }
  }
});

// Create relationships for both authors
await api.resources.book_authors.post({
  inputRecord: {
    data: {
      type: 'book_authors',
      attributes: { role: 'co-author', order: 1 },
      relationships: {
        book: { data: { type: 'books', id: newBook.id } },
        author: { data: { type: 'authors', id: terry.id } }
      }
    }
  }
});

await api.resources.book_authors.post({
  inputRecord: {
    data: {
      type: 'book_authors',
      attributes: { role: 'co-author', order: 2 },
      relationships: {
        book: { data: { type: 'books', id: newBook.id } },
        author: { data: { type: 'authors', id: stephen.id } }
      }
    }
  }
});

// Verify the new book has both authors
const newBookWithAuthors = await api.resources.books.get({
  id: newBook.id,
  queryParams: { include: ['authors', 'publisher'] },
  simplified: false
});

console.log(`   Created: ${newBookWithAuthors.data.attributes.title}`);
console.log(`   Publisher: ${newBookWithAuthors.included.find(r => r.type === 'publishers').attributes.name}`);
console.log(`   Authors: ${newBookWithAuthors.included.filter(r => r.type === 'authors').map(a => a.attributes.name).join(', ')}`);

// ==============================================================
// CLEANUP
// ==============================================================

console.log('\n\n=== Example Complete ===');
console.log('\nKey takeaways for n:n relationships:');
console.log('1. Create a pivot table resource (book_authors) with foreign keys to both sides');
console.log('2. Define hasMany relationships with "through" parameter on both sides');
console.log('3. The pivot table can have additional fields (role, order, etc.)');
console.log('4. Use ?include= to fetch related data through the many-to-many relationship');
console.log('5. You can query the pivot table directly for more control');

await knex.destroy();