# 2.6 Many to many (hasMany with through records)

Many-to-many relationships connect two resources through a pivot/junction table. For example, books can have multiple authors, and authors can write multiple books. This relationship is managed through a `book_authors` table that stores the connections.

Note that `book_authors` is not just a table, but a first class resource that you can manipulate like any other. 

Let's create a complete example with books, authors, and their many-to-many relationship:

```javascript
// Define books resource
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true, max: 255, search: true, indexed: true },
    isbn: { type: 'string', max: 20, unique: true },
    published_year: { type: 'number', min: 1900, max: 2100 }
  },
  relationships: {
    authors: { 
      hasMany: 'authors',
      through: 'book_authors',  // The pivot table
      foreignKey: 'book_id',    // Column in pivot table pointing to books
      otherKey: 'author_id'     // Column in pivot table pointing to authors
    }
  },
  searchSchema: {
    title: { type: 'string', filterOperator: 'like' },
    
    // Cross-table search through many-to-many relationship
    authorName: { 
      type: 'string', 
      actualField: 'authors.name',  // Search author names through the pivot
      filterOperator: 'like' 
    }
  }
});
await api.resources.books.createKnexTable();

// Define authors resource (already defined above, but showing the many-to-many side)
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true, indexed: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    bio: { type: 'string', max: 1000, nullable: true }
  },
  relationships: {
    books: { 
      hasMany: 'books',
      through: 'book_authors',  // Same pivot table
      foreignKey: 'author_id',  // Column in pivot table pointing to authors
      otherKey: 'book_id'      // Column in pivot table pointing to books
    }
  },
  searchSchema: {
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    
    // Cross-table search through many-to-many relationship
    bookTitle: { 
      type: 'string', 
      actualField: 'books.title',  // Search book titles through the pivot
      filterOperator: 'like' 
    }
  }
});
await api.resources.authors.createKnexTable();

// Define the pivot table resource
// This is optional but useful if you need to store additional data on the relationship
await api.addResource('book_authors', {
  schema: {
    book_id: { type: 'id', belongsTo: 'books', as: 'book', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author', required: true },
    contribution_type: { type: 'string', max: 50, nullable: true }, // e.g., 'primary', 'co-author', 'editor'
    royalty_percentage: { type: 'number', min: 0, max: 100, nullable: true }
  }
  // Note: Composite primary keys are not yet supported, but will be added in a future version
  // For now, the table will use the default 'id' primary key
});
await api.resources.book_authors.createKnexTable();
```

The key difference from regular hasMany relationships is the `through` property, which specifies the pivot table. Both `foreignKey` and `otherKey` are mandatory for many-to-many relationships.

Now let's create some data and explore how to work with many-to-many relationships:

```javascript
// Create some authors
const author1 = await api.resources.authors.post({ 
  name: 'Neil', 
  surname: 'Gaiman', 
  bio: 'British author of fiction, horror, and fantasy'
});

const author2 = await api.resources.authors.post({ 
  name: 'Terry', 
  surname: 'Pratchett', 
  bio: 'English humorist and fantasy author'
});

const author3 = await api.resources.authors.post({ 
  name: 'Stephen', 
  surname: 'King', 
  bio: 'American author of horror and supernatural fiction'
});

// Create books with authors - simplified mode
const goodOmens = await api.resources.books.post({
  title: 'Good Omens',
  isbn: '978-0060853983',
  published_year: 1990,
  authors: [author1.id, author2.id]  // Co-authored by Gaiman and Pratchett
});

const americanGods = await api.resources.books.post({
  title: 'American Gods',
  isbn: '978-0380789030',
  published_year: 2001,
  authors: [author1.id]  // Written by Gaiman alone
});

// Create a book using non-simplified mode
const theShining = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: 'The Shining',
        isbn: '978-0307743657',
        published_year: 1977
      },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: author3.id }
          ]
        }
      }
    }
  },
  simplified: false
});
```

## Working with Pivot Tables Directly

Sometimes you need more control over the pivot table data, such as storing additional information about the relationship itself. There are two approaches:

### 1. Creating relationships via the pivot table

Instead of using the `authors` field when creating a book, you can create the relationships directly through the pivot table. This is useful when you need to add extra data:

```javascript
// Create a book without authors
const newBook = await api.resources.books.post({
  title: 'The Color of Magic',
  isbn: '978-0062225672',
  published_year: 1983
});

// Then create the relationship with extra pivot data
await api.resources.book_authors.post({
  book_id: newBook.id,
  author_id: author2.id,  // Terry Pratchett
  contribution_type: 'primary',
  royalty_percentage: 100
});
```

### 2. Updating existing pivot records

If you've already created relationships (e.g., using `authors: [author1.id, author2.id]` during book creation), you can update the pivot records to add extra data:

```javascript
// First, find the pivot records for Good Omens
const pivotRecords = await api.resources.book_authors.query({
  queryParams: {
    filters: {
      book_id: goodOmens.id
    }
  }
});

// Update each pivot record with extra data
for (const record of pivotRecords.data) {
  await api.resources.book_authors.patch({
    id: record.id,
    contribution_type: 'co-author',
    royalty_percentage: 50
  });
}
```

**Note:** Be careful not to create duplicate pivot records. If you use `authors: [...]` when creating a book, the pivot records are created automatically. Only manually create pivot records if you haven't used the relationship field during resource creation.

## Including Many-to-Many Records (`include`)

When you fetch resources with many-to-many relationships, by default you only get the IDs:

```javascript
const book_simplified = await api.resources.books.get({ id: goodOmens.id });
const book_non_simplified = await api.resources.books.get({ id: goodOmens.id, simplified: false });

console.log('Book without includes (simplified):', inspect(book_simplified));
console.log('Book without includes (non-simplified):', inspect(book_non_simplified));
```

**Expected Output**

```text
Book without includes (simplified):
{
  id: '1',
  title: 'Good Omens',
  isbn: '978-0060853983',
  published_year: 1990,
  authors_ids: ['1', '2']  // Just the IDs
}

Book without includes (non-simplified):
{
  data: {
    type: 'books',
    id: '1',
    attributes: {
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990
    },
    relationships: {
      authors: {
        data: [
          { type: 'authors', id: '1' },
          { type: 'authors', id: '2' }
        ]
      }
    },
    links: { self: '/api/1.0/books/1' }
  },
  links: { self: '/api/1.0/books/1' }
}
```

## Including Many to many Records (`include`)

To retrieve the full related resources through a many-to-many relationship, use the `include` query parameter:

```javascript
// Get a book with its authors included
const book_with_authors_simplified = await api.resources.books.get({ 
  id: goodOmens.id, 
  queryParams: { include: ['authors'] } 
});

const book_with_authors_non_simplified = await api.resources.books.get({ 
  id: goodOmens.id, 
  queryParams: { include: ['authors'] }, 
  simplified: false 
});

// Get all books with their authors
const books_with_authors_simplified = await api.resources.books.query({ 
  queryParams: { include: ['authors'] } 
});

const books_with_authors_non_simplified = await api.resources.books.query({ 
  queryParams: { include: ['authors'] }, 
  simplified: false 
});

console.log('Book with authors (simplified):', inspect(book_with_authors_simplified));
console.log('Book with authors (non-simplified):', inspect(book_with_authors_non_simplified));
console.log('Books with authors (simplified):', inspect(books_with_authors_simplified));
console.log('Books with authors (non-simplified):', inspect(books_with_authors_non_simplified));
```

**Expected Output**

```text
Book with authors (simplified): {
  id: '1',
  title: 'Good Omens',
  isbn: '978-0060853983',
  published_year: 1990,
  authors_ids: [ '1', '2' ],
  authors: [
    {
      id: '1',
      name: 'Neil',
      surname: 'Gaiman',
      bio: 'British author of fiction, horror, and fantasy',
      books_ids: []
    },
    {
      id: '2',
      name: 'Terry',
      surname: 'Pratchett',
      bio: 'English humorist and fantasy author',
      books_ids: []
    }
  ]
}
Book with authors (non-simplified): {
  data: {
    type: 'books',
    id: '1',
    attributes: {
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990
    },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ],
        links: {
          self: '/api/1.0/books/1/relationships/authors',
          related: '/api/1.0/books/1/authors'
        }
      }
    },
    links: { self: '/api/1.0/books/1' }
  },
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: {
        name: 'Neil',
        surname: 'Gaiman',
        bio: 'British author of fiction, horror, and fantasy'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/1.0/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: {
        name: 'Terry',
        surname: 'Pratchett',
        bio: 'English humorist and fantasy author'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/1.0/authors/2' }
    }
  ],
  links: { self: '/api/1.0/books/1' }
}
Books with authors (simplified): {
  data: [
    {
      id: '1',
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990,
      authors_ids: [ '1', '2' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        },
        {
          id: '2',
          name: 'Terry',
          surname: 'Pratchett',
          bio: 'English humorist and fantasy author',
          books_ids: []
        }
      ]
    },
    {
      id: '2',
      title: 'American Gods',
      isbn: '978-0380789030',
      published_year: 2001,
      authors_ids: [ '1' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        }
      ]
    },
    {
      id: '3',
      title: 'The Shining',
      isbn: '978-0307743657',
      published_year: 1977,
      authors_ids: [ '3' ],
      authors: [
        {
          id: '3',
          name: 'Stephen',
          surname: 'King',
          bio: 'American author of horror and supernatural fiction',
          books_ids: []
        }
      ]
    }
  ],
  links: { self: '/api/1.0/books?include=authors' }
}
Books with authors (non-simplified): {
  data: [
    {
      type: 'books',
      id: '1',
      attributes: {
        title: 'Good Omens',
        isbn: '978-0060853983',
        published_year: 1990
      },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: '1' },
            { type: 'authors', id: '2' }
          ],
          links: {
            self: '/api/1.0/books/1/relationships/authors',
            related: '/api/1.0/books/1/authors'
          }
        }
      },
      links: { self: '/api/1.0/books/1' }
    },
    {
      type: 'books',
      id: '2',
      attributes: {
        title: 'American Gods',
        isbn: '978-0380789030',
        published_year: 2001
      },
      relationships: {
        authors: {
          data: [ { type: 'authors', id: '1' } ],
          links: {
            self: '/api/1.0/books/2/relationships/authors',
            related: '/api/1.0/books/2/authors'
          }
        }
      },
      links: { self: '/api/1.0/books/2' }
    },
    {
      type: 'books',
      id: '3',
      attributes: {
        title: 'The Shining',
        isbn: '978-0307743657',
        published_year: 1977
      },
      relationships: {
        authors: {
          data: [ { type: 'authors', id: '3' } ],
          links: {
            self: '/api/1.0/books/3/relationships/authors',
            related: '/api/1.0/books/3/authors'
          }
        }
      },
      links: { self: '/api/1.0/books/3' }
    }
  ],
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: {
        name: 'Neil',
        surname: 'Gaiman',
        bio: 'British author of fiction, horror, and fantasy'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/1.0/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: {
        name: 'Terry',
        surname: 'Pratchett',
        bio: 'English humorist and fantasy author'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/1.0/authors/2' }
    },
    {
      type: 'authors',
      id: '3',
      attributes: {
        name: 'Stephen',
        surname: 'King',
        bio: 'American author of horror and supernatural fiction'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/1.0/authors/3' }
    }
  ],
  links: { self: '/api/1.0/books?include=authors' }
}

```

The include system automatically handles the JOIN through the pivot table. In simplified mode, the related resources are embedded directly. In JSON:API mode, they appear in the `included` array.

## Search (many to many)

The search functionality for many-to-many relationships allows you to filter parent resources based on attributes of their related resources through the pivot table. This is particularly powerful for queries like "find all books written by authors named Neil" or "find all authors who wrote books with 'Gods' in the title".

Using the schema definitions from above, which include cross-table search fields:

```javascript
// 1. Find books by author name (searches through the many-to-many relationship)
const books_by_neil_simplified = await api.resources.books.query({ 
  queryParams: { filters: { authorName: 'Neil' } } 
});

const books_by_neil_non_simplified = await api.resources.books.query({ 
  queryParams: { filters: { authorName: 'Neil' } }, 
  simplified: false 
});

// 2. Find authors by book title (reverse search through many-to-many)
const authors_of_gods_books_simplified = await api.resources.authors.query({ 
  queryParams: { filters: { bookTitle: 'Gods' } } 
});

const authors_of_gods_books_non_simplified = await api.resources.authors.query({ 
  queryParams: { filters: { bookTitle: 'Gods' } }, 
  simplified: false 
});

// 3. Combine searches: Find books by Neil that include full author data
const neil_books_with_authors = await api.resources.books.query({ 
  queryParams: { 
    filters: { authorName: 'Neil' },
    include: ['authors'] 
  } 
});

console.log('Books by Neil (simplified):', inspect(books_by_neil_simplified));
console.log('Books by Neil (non-simplified):', inspect(books_by_neil_non_simplified));
console.log('Authors who wrote books with "Gods" (simplified):', inspect(authors_of_gods_books_simplified));
console.log('Authors who wrote books with "Gods" (non-simplified):', inspect(authors_of_gods_books_non_simplified));
console.log('Neil books with full author data:', inspect(neil_books_with_authors));
```

**Expected Output**

```text
Books by Neil (simplified): {
  data: [
    {
      id: '1',
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990,
      authors_ids: [ '1', '2' ]
    },
    {
      id: '2',
      title: 'American Gods',
      isbn: '978-0380789030',
      published_year: 2001,
      authors_ids: [ '1' ]
    }
  ],
  links: { self: '/api/1.0/books?filters[authorName]=Neil' }
}
Books by Neil (non-simplified): {
  data: [
    {
      type: 'books',
      id: '1',
      attributes: {
        title: 'Good Omens',
        isbn: '978-0060853983',
        published_year: 1990
      },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: '1' },
            { type: 'authors', id: '2' }
          ]
        }
      },
      links: { self: '/api/1.0/books/1' }
    },
    {
      type: 'books',
      id: '2',
      attributes: {
        title: 'American Gods',
        isbn: '978-0380789030',
        published_year: 2001
      },
      relationships: {
        authors: { data: [ { type: 'authors', id: '1' } ] }
      },
      links: { self: '/api/1.0/books/2' }
    }
  ],
  links: { self: '/api/1.0/books?filters[authorName]=Neil' }
}
Authors who wrote books with "Gods" (simplified): {
  data: [
    {
      id: '1',
      name: 'Neil',
      surname: 'Gaiman',
      bio: 'British author of fiction, horror, and fantasy',
      books_ids: [ '1', '2' ]
    }
  ],
  links: { self: '/api/1.0/authors?filters[bookTitle]=Gods' }
}
Authors who wrote books with "Gods" (non-simplified): {
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: {
        name: 'Neil',
        surname: 'Gaiman',
        bio: 'British author of fiction, horror, and fantasy'
      },
      relationships: {
        books: {
          data: [ { type: 'books', id: '1' }, { type: 'books', id: '2' } ]
        }
      },
      links: { self: '/api/1.0/authors/1' }
    }
  ],
  links: { self: '/api/1.0/authors?filters[bookTitle]=Gods' }
}
Neil books with full author data: {
  data: [
    {
      id: '1',
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990,
      authors_ids: [ '1', '2' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        },
        {
          id: '2',
          name: 'Terry',
          surname: 'Pratchett',
          bio: 'English humorist and fantasy author',
          books_ids: []
        }
      ]
    },
    {
      id: '2',
      title: 'American Gods',
      isbn: '978-0380789030',
      published_year: 2001,
      authors_ids: [ '1' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        }
      ]
    }
  ],
  links: { self: '/api/1.0/books?filters[authorName]=Neil&include=authors' }
}
```

The cross-table search through many-to-many relationships works by:
1. Starting from the main table (e.g., books)
2. JOINing through the pivot table (book_authors)
3. JOINing to the related table (authors)
4. Applying the filter on the related table's field

This generates SQL similar to:
```sql
SELECT books.* FROM books
JOIN book_authors ON books.id = book_authors.book_id
JOIN authors ON book_authors.author_id = authors.id
WHERE authors.name LIKE '%Neil%'
```

The system handles all the complexity of the double JOIN transparently, making it easy to search across many-to-many relationships without writing custom queries.

---

[Previous: 2.5 hasMany records (polymorphic)](./GUIDE_2_5_HasMany_Polymorphic.md) | [Back to Guide](./README.md) | [Next: 2.7 Pagination and ordering](./GUIDE_2_7_Pagination_And_Ordering.md)