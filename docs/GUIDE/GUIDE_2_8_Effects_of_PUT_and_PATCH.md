# Effects of PUT and PATCH on Related Data

## Understanding Update Operations

When updating resources through the REST API, it's crucial to understand how PUT and PATCH operations affect related data. This chapter explores the differences between these operations and their impact on all types of relationships.

First, let's define and create some resources:

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255 },
    country: { type: 'string', required: true, max: 100 }
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    surname: { type: 'string', required: true, max: 100 },
    birth_year: { type: 'number', required: true }
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'author_id' }
  }
});
await api.resources.authors.createKnexTable();

// Define genres resource
await api.addResource('genres', {
  schema: {
    name: { type: 'string', required: true, max: 100, unique: true }
  }
});
await api.resources.genres.createKnexTable();

// Define books resource with belongsTo and many-to-many relationships
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true, max: 255 },
    isbn: { type: 'string', required: true, max: 13, unique: true },
    published_year: { type: 'number', required: true },
    page_count: { type: 'number', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author', required: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  relationships: {
    // Many-to-many relationship with genres
    genres: { 
      hasMany: 'genres',
      through: 'book_genres',
      foreignKey: 'book_id',
      otherKey: 'genre_id'
    }
  }
});
await api.resources.books.createKnexTable();

// Define the pivot table for book-genre relationships
await api.addResource('book_genres', {
  schema: {
    book_id: { type: 'id', required: true },
    genre_id: { type: 'id', required: true },
    created_at: { type: 'datetime', default: 'now' },
    primary_genre: { type: 'boolean', default: false }
  }
});
await api.resources.book_genres.createKnexTable();
```

Let's create a comprehensive dataset that includes all relationship types. We'll use this same dataset throughout the chapter to demonstrate how each operation affects the data.

Please note that each one of the following sections in this guide will expect this whole dataset to be freshly added:

```javascript
// Create publishers
const penguinPublisher = await api.resources.publishers.post({
  name: 'Penguin Random House',
  country: 'USA'
});
// Returns: { id: 1, name: 'Penguin Random House', country: 'USA' }

const harperPublisher = await api.resources.publishers.post({
  name: 'HarperCollins',
  country: 'USA'
});
// Returns: { id: 2, name: 'HarperCollins', country: 'USA' }

// Create authors
const tolkien = await api.resources.authors.post({
  name: 'J.R.R.',
  surname: 'Tolkien',
  birth_year: 1892
});
// Returns: { id: 1, name: 'J.R.R.', surname: 'Tolkien', birth_year: 1892 }

const orwell = await api.resources.authors.post({
  name: 'George',
  surname: 'Orwell',
  birth_year: 1903
});
// Returns: { id: 2, name: 'George', surname: 'Orwell', birth_year: 1903 }

// Create genres
const fantasyGenre = await api.resources.genres.post({
  name: 'Fantasy'
});
// Returns: { id: 1, name: 'Fantasy' }

const adventureGenre = await api.resources.genres.post({
  name: 'Adventure'
});
// Returns: { id: 2, name: 'Adventure' }

const classicGenre = await api.resources.genres.post({
  name: 'Classic'
});
// Returns: { id: 3, name: 'Classic' }

const dystopianGenre = await api.resources.genres.post({
  name: 'Dystopian'
});
// Returns: { id: 4, name: 'Dystopian' }

// Create a book with all relationships
const hobbitBook = await api.resources.books.post({
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  author_id: tolkien.id,
  publisher_id: penguinPublisher.id,
  genres: [ fantasyGenre.id, adventureGenre.id, classicGenre.id ] 
});

// console.log('hobbitBook:', inspect(hobbitBook));

// Create more books by the same author (to demonstrate hasMany relationship)
const lotrBook = await api.resources.books.post({
  title: 'The Lord of the Rings',
  isbn: '9780544003415',
  published_year: 1954,
  page_count: 1216,
  author_id: tolkien.id,
  publisher_id: penguinPublisher.id,
  genres: [ fantasyGenre.id, adventureGenre.id ] 

});

const silmarillionBook = await api.resources.books.post({
  title: 'The Silmarillion',
  isbn: '9780544338012',
  published_year: 1977,
  page_count: 365,
  author_id: tolkien.id,
  publisher_id: penguinPublisher.id,
  genres: [ fantasyGenre.id ] 

});
```

### Our Complete Dataset

After running the setup code above, we have:

| Table | Records | Relationships |
|-------|---------|---------------|
| **publishers** | 2 records | Each has books (hasMany) |
| **authors** | 2 records | Each has books (hasMany) |
| **genres** | 4 records | - |
| **books** | 3 records | • The Hobbit: belongsTo Tolkien & Penguin, has 3 genres<br>• LOTR: belongsTo Tolkien & Penguin, has 2 genres<br>• Silmarillion: belongsTo Tolkien & Penguin, has 1 genre |
| **book_genres** | 6 records | Pivot table linking books to genres |

### Viewing the Current State

```javascript
// Fetch The Hobbit with all relationships
const currentBook = await api.resources.books.get({
  id: hobbitBook.id,
  queryParams: { 
    include: ['author', 'publisher', 'genres'] 
  }
});

console.log('Current book state:', currentBook);
```

## PUT Operations: Complete Replacement

**Important**: Each example in this section starts with the full dataset created above. The effects shown are what happens when you run that specific PUT operation on the original data.

### Example 1: PUT with All Relationships Specified

```javascript
// Starting with our full dataset from above
await api.resources.books.put({
  id: hobbitBook.id,
  title: 'The Hobbit: An Unexpected Journey',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 320,
  author_id: tolkien.id,              // Same author
  publisher_id: harperPublisher.id,    // Changed publisher
  genres: [
    fantasyGenre.id,    // Kept Fantasy
    adventureGenre.id,  // Kept Adventure  
    dystopianGenre.id   // Added Dystopian
    // Classic genre removed!
  ]
});
```

From now on, I will assume that we do this after every call:

```javascript
const currentBookAfter = await api.resources.books.get({
  id: hobbitBook.id,
  queryParams: { 
    include: ['author', 'publisher', 'genres'] 
  }
});

console.log('Book state AFTER the change:', currentBookAfter);
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• page_count: Changed from 310 to 320<br>• author_id: Unchanged (still Tolkien)<br>• publisher_id: Changed from 1 (Penguin) to 2 (Harper) |
| **book_genres** | • Fantasy record: **PRESERVED** (with original created_at)<br>• Adventure record: **PRESERVED** (with original created_at)<br>• Classic record: **DELETED**<br>• Dystopian record: **CREATED** |
| **Other author's books** | **NO CHANGES** - LOTR and Silmarillion still exist |
| **publishers** | **NO CHANGES** - Both publishers still exist |
| **authors** | **NO CHANGES** - Both authors still exist |
| **genres** | **NO CHANGES** - All 4 genres still exist |

The PUT operation follows the philosophy of **complete resource replacement**. When you PUT a resource, you're saying "replace the entire current state with exactly what I'm sending." This means:
- All fields you send are updated to the new values
- All fields you DON'T send are cleared (set to NULL or their defaults)
- For many-to-many relationships, the system intelligently syncs: it keeps matching records (preserving their metadata), removes missing ones, and adds new ones

**Expected result**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit: An Unexpected Journey',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 320,
  genres_ids: [ '1', '2', '4' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '4', name: 'Dystopian' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '2',
  publisher: { id: '2', name: 'HarperCollins', country: 'USA', books_ids: [] }
}
```
### Example 2: PUT with Missing Relationships

```javascript
// Starting with our full dataset from above
await api.resources.books.put({
  id: hobbitBook.id,
  title: 'The Hobbit - Revised',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  author_id: tolkien.id
  // publisher_id and genres NOT included!
});
```
**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• author_id: Remains 1 (Tolkien)<br>• publisher_id: **SET TO NULL** |
| **book_genres** | **ALL 3 RECORDS DELETED** - Book no longer has any genres |
| **Other books** | **NO CHANGES** - LOTR and Silmarillion unchanged |

Again, PUT is a **complete replacement** operation. Since we didn't include `publisher_id` or `genres` in our request, the API treats this as "I want a book with no publisher and no genres." The result:
- `publisher_id` becomes NULL (it's nullable, so this is allowed)  
- All genre relationships are removed from the pivot table
- Missing fields are NOT preserved from the current state - they're cleared

**Expected output**

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit - Revised',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  }
}
```

### Example 3: PUT with Explicit Nulls

```javascript
// Starting with our full dataset from above
await api.resources.books.put({
  id: hobbitBook.id,
  title: 'The Hobbit - Standalone',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  author_id: tolkien.id,      // Required field, cannot be null
  publisher_id: null,         // Explicitly clearing publisher
  genres: []                  // Explicitly clearing all genres
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• author_id: Remains 1 (required field)<br>• publisher_id: **SET TO NULL** |
| **book_genres** | **ALL 3 RECORDS DELETED** |
| **Other books** | **NO CHANGES** |

This example shows PUT with **explicit nulls and empty arrays**. There's no difference between omitting a field and explicitly setting it to null/[] in a PUT operation - both result in clearing the data. This reinforces that PUT is about **complete state replacement**:
- You must include ALL data you want to keep
- Anything missing or null is cleared
- Required fields (like `author_id`) must always be provided and cannot be null


**Expected output**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit - Standalone',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  }
}
```

## PATCH Operations: Partial Updates

**Important**: Each example in this section starts with the full dataset created above. The effects shown are what happens when you run that specific PATCH operation on the original data.

### Example 1: PATCH Updating Only Some Fields

```javascript
// Starting with our full dataset from above
await api.resources.books.patch({
  id: hobbitBook.id,
  title: 'The Hobbit: There and Back Again',
  publisher_id: harperPublisher.id
  // isbn, published_year, page_count, author_id, and genres NOT mentioned
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• isbn: **UNCHANGED**<br>• published_year: **UNCHANGED**<br>• page_count: **UNCHANGED**<br>• author_id: **UNCHANGED** (still Tolkien)<br>• publisher_id: Changed from 1 to 2 |
| **book_genres** | **NO CHANGES** - All 3 genre relationships preserved |
| **Other books** | **NO CHANGES** |

PATCH follows the philosophy of **partial updates** - it only modifies what you explicitly send. This is fundamentally different from PUT:
- Fields you send are updated
- Fields you DON'T send remain untouched
- Only the `title` and `publisher_id` were mentioned, so only these changed
- The `genres` relationship wasn't mentioned, so all 3 genre associations remain intact


**Expected output**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit: There and Back Again',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '2',
  publisher: { id: '2', name: 'HarperCollins', country: 'USA', books_ids: [] }
}
```

### Example 2: PATCH Modifying Many-to-Many

```javascript
await api.resources.books.patch({
  id: hobbitBook.id,
  genres: [
    fantasyGenre.id,     // Keep Fantasy
    dystopianGenre.id    // Add Dystopian
    // Adventure and Classic will be removed
  ]
  // All other fields NOT mentioned - unchanged
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • All fields: **UNCHANGED** |
| **book_genres** | • Fantasy: **PRESERVED** (with original created_at and primary_genre values)<br>• Adventure: **DELETED**<br>• Classic: **DELETED**<br>• Dystopian: **CREATED** |
| **Other tables** | **NO CHANGES** |

With PATCH, when you DO mention a relationship, it gets completely replaced for that relationship only. Here we mentioned `genres`, so:
- The genres relationship is updated to exactly what we specified
- Other fields (title, author_id, etc.) remain unchanged because they weren't mentioned
- The intelligent sync still applies to the genres: Fantasy is preserved with its metadata, others are added/removed as needed

**Expected output**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '4' ],
  genres: [ { id: '1', name: 'Fantasy' }, { id: '4', name: 'Dystopian' } ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
```

### Example 3: PATCH Clearing Specific Relationships

```javascript
// Starting with our full dataset from above
await api.resources.books.patch({
  id: hobbitBook.id,
  publisher_id: null,
  genres: []
  // author_id and other fields NOT mentioned - unchanged
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • All attributes: **UNCHANGED**<br>• author_id: **UNCHANGED** (still Tolkien)<br>• publisher_id: **SET TO NULL** |
| **book_genres** | **ALL 3 RECORDS DELETED** |
| **Other tables** | **NO CHANGES** |

This shows PATCH's **selective update** nature. We explicitly set `publisher_id` to null and `genres` to an empty array:
- These specific relationships are cleared as requested
- Everything else (title, author_id, etc.) remains unchanged
- This is surgical precision - update only what you explicitly mention
- To clear something with PATCH, you must explicitly set it to null or []

**Expected output**:

```html
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  }
}
```

## Key Differences Summary

Starting with our complete dataset, here's how each operation type affects the data:

| Operation | What You Send | Effect on Unmentioned Data |
|-----------|---------------|---------------------------|
| **PUT** | Complete resource replacement | • Attributes: Set to defaults/null<br>• BelongsTo: Set to null (unless required)<br>• Many-to-Many: All relationships removed |
| **PATCH** | Only fields to update | • Attributes: Unchanged<br>• BelongsTo: Unchanged<br>• Many-to-Many: Unchanged |

### Effects by Relationship Type

| Relationship | PUT (not mentioned) | PUT (null/[]) | PATCH (not mentioned) | PATCH (null/[]) |
|--------------|-------------------|---------------|---------------------|----------------|
| **BelongsTo (nullable)** | Set to NULL | Set to NULL | Unchanged | Set to NULL |
| **BelongsTo (required)** | Must be provided | Cannot be NULL | Unchanged | Cannot be NULL |
| **Many-to-Many** | All removed | All removed | Unchanged | All removed |
| **HasMany** | No effect* | N/A | No effect* | N/A |

*HasMany relationships (like author's other books) are never affected by updates to a single book.

## Why HasMany Relationships Are Never Affected

It's crucial to understand why hasMany relationships (and polymorphic hasMany) are never affected by PUT or PATCH operations on the parent record. The reason is fundamental:

**HasMany relationships point to actual records, not just links.**

When a book "belongs to" an author:
- The book has an `author_id` field (a simple foreign key)
- This is just a reference that can be changed

But when an author "has many" books:
- Each book is a complete, independent record in the books table
- These aren't just "links" that can be deleted - they're real data with their own lifecycle
- To modify these relationships, you must update each book individually

For example:
```javascript
// This will NOT delete Tolkien's other books:
await api.resources.authors.put({
  id: tolkien.id,
  name: 'J.R.R.',
  surname: 'Tolkien',
  birth_year: 1892
  // No mention of books - but they still exist!
});

// To actually remove a book from an author, you must update the book:
await api.resources.books.patch({
  id: lotrBook.id,
  author_id: null  // or another author's ID
});
```

This design prevents accidental data loss and maintains data integrity. Child records are independent entities that must be managed through their own endpoints.

## Understanding Pivot Table Preservation

The intelligent synchronization for many-to-many relationships is important to understand:

```javascript
// Looking at our book_genres table structure:
// - book_id
// - genre_id  
// - created_at
// - primary_genre

// When updating genres from [Fantasy, Adventure, Classic] to [Fantasy, Dystopian]:
// - Fantasy record: KEPT with original created_at and primary_genre values
// - Adventure record: DELETED
// - Classic record: DELETED  
// - Dystopian record: CREATED with new created_at and default primary_genre (false)
```

This preservation is crucial for:
- Maintaining audit trails (when was this genre assigned?)
- Preserving custom pivot data (is this the primary genre?)
- Minimizing database operations (only change what needs changing)

## Best Practices

1. **Use PATCH for targeted updates** - When you only want to change specific fields
2. **Use PUT when replacing everything** - When you have the complete new state
3. **Always include relationships you want to keep with PUT** - They will be cleared otherwise
4. **Remember required fields** - PUT must include all required fields like author_id
5. **Child records are independent** - Other books by the same author are never affected

## Next Steps

Now that you understand how updates affect relationships:
- Practice with PATCH for surgical updates
- Use PUT for complete replacements
- Plan your API calls to avoid unintended data loss
- Remember that the intelligent sync preserves pivot table metadata