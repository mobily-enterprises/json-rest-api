# 2.4 hasMany records

`hasMany` relationships represent a one-to-many association, where one resource can have multiple associated resources. For example, a `publisher` can have many `authors` (if we consider authors working for specific publishers). Unlike `belongsTo` relationships, the foreign key for a `hasMany` relationship resides on the *related* resource's table, not the primary resource.

This is why when defining a schema the `belongsTo` keys are in the main schema, whereas `hasMany` belongs to the `relationships` paramter. This is a design decision that marks the distinction between the two types of relationships. 

To demonstrate `hasMany` relationships with just two tables, we'll use `publishers` as our "one" side and `authors` as our "many" side, assuming authors are directly associated with a single publisher.

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true },
  },
  relationships: {
    // A publisher has many authors
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
  },
  searchSchema: { // Adding search schema for publishers
    name: { type: 'string', filterOperator: 'like' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource, which belongs to a publisher
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: { // Adding search schema for authors
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
  }
});
await api.resources.authors.createKnexTable();
```

Note that the `authors` resource has the `publisher_id` key set as a `belongsTo` field. This is not necessary for the `publishers` resource to work. However, it's good practice so that when loading an `authors` record `publisher_id` will _not_ appear in the list of attributes.

Now, let's add some data to reflect these `hasMany` connections. We'll create publishers and then associate authors with them using the `publisher_id` foreign key.

```javascript
// Re-add publishers for a fresh start
const frenchPublisher = await api.resources.publishers.post({ name: 'French Books Inc.' });
const germanPublisher = await api.resources.publishers.post({ name: 'German Press GmbH' });
const internationalPublisher = await api.resources.publishers.post({ name: 'Global Publishing' });

// Add authors, linking them to publishers
const frenchAuthor1 = await api.resources.authors.post({ name: 'Victor', surname: 'Hugo', publisher: frenchPublisher.id });
const frenchAuthor2 = await api.resources.authors.post({ name: 'Émile', surname: 'Zola', publisher: frenchPublisher.id });
const germanAuthor = await api.resources.authors.post({ name: 'Johann', surname: 'Goethe', publisher: germanPublisher.id });
const unassignedAuthor = await api.resources.authors.post({ name: 'Unknown', surname: 'Author', publisher: null });


console.log('Added French Publisher:', inspect(frenchPublisher));
console.log('Added Victor Hugo:', inspect(frenchAuthor1));
console.log('Added Émile Zola:', inspect(frenchAuthor2));
console.log('Added German Publisher:', inspect(germanPublisher));

// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorIdss = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  }
});
console.log('French publisher  Authors (ids only):', inspect(allPublishersWithAuthorIds));

const frenchPublisherWithAuthorIds = await api.resources.publishers.get({ id: frenchPublisher.id, });
console.log('French publisher  Authors (author ids only, simplified):', inspect(frenchPublisherWithAuthorIds));

const frenchPublisherWithAuthorIdsFull = await api.resources.publishers.get({ id: frenchPublisher.id, simplified: false });
console.log('French publisher  Authors (author ids only, NOT simplified):', inspect(frenchPublisherWithAuthorIdsFull));
```

The output:

```text
Added French Publisher: { id: '1', name: 'French Books Inc.', authors_ids: [] }
Added Victor Hugo: { id: '1', name: 'Victor', surname: 'Hugo', publisher_id: '1' }
Added Émile Zola: { id: '2', name: 'Émile', surname: 'Zola', publisher_id: '1' }
Added German Publisher: { id: '2', name: 'German Press GmbH', authors_ids: [] }
French publisher  Authors (ids only, simplified): { id: '1', name: 'French Books Inc.', authors_ids: [ '1', '2' ] }
French publisher  Authors (ids only, NOT simplified): {
  data: {
    type: 'publishers',
    id: '1',
    attributes: { name: 'French Books Inc.' },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ]
      }
    },
    links: { self: '/api/1.0/publishers/1' }
  },
  links: { self: '/api/1.0/publishers/1' }
}
```

Note that the fresh publisher has the IDs of the French authors, both in simplified and non-simplified mode. This is a very important feature. `json-rest-api` will minimise the number of queries needed to fetch the extra IDS, but having the relation will incur an extra computational cost; however, it will enable discoverability.


## Including `hasMany` Records (`include`)

To retrieve related `hasMany` resources, you'll use the `include` query parameter from the "one" side of the one-to-many relationship (e.g., fetching a publisher and including its authors).

When fetching data programmatically in **simplified mode** (which is the default), `hasMany` relationships will appear as **arrays of child objects** embedded directly within the parent resource. This denormalized structure is convenient for immediate use in your application code.

Using the exact same data as before, you can change the query to `include` countries:

```javascript
// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorInfo = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  }
});
console.log('French publisher Authors (with authors, only, simplified):', inspect(frenchPublisherWithAuthorInfo));

// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorInfoFull = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  },
  simplified: false
});
console.log('French publisher  Authors (with authors, NOT simplified):', inspect(frenchPublisherWithAuthorInfoFull));
```

This is the result:

```text
French publisher  Authors (with authors, NOT simplified): {
  data: {
    type: 'publishers',
    id: '1',
    attributes: { name: 'French Books Inc.' },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ],
        links: {
          self: '/api/1.0/publishers/1/relationships/authors',
          related: '/api/1.0/publishers/1/authors'
        }
      }
    },
    links: { self: '/api/1.0/publishers/1' }
  },
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor', surname: 'Hugo' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Émile', surname: 'Zola' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/2' }
    }
  ],
  links: { self: '/api/1.0/publishers/1' }
}
```

Include will also work with `query()`:

```javascript

// Query all publishers and include their authors (simplified mode output)
const allPublishersWithAuthors = await api.resources.publishers.query({
  queryParams: {
    include: ['authors']
  }
});
// HTTP: GET /api/publishers?include=authors
// Returns (simplified): [
//   { id: '1', name: 'French Books Inc.', country_id: '1', 
//     authors: [
//       { id: '1', name: 'Victor Hugo', publisher_id: '1' },
//       { id: '2', name: 'Alexandre Dumas', publisher_id: '1' }
//     ]
//   },
//   { id: '2', name: 'German Press GmbH', country_id: '2', 
//     authors: [
//       { id: '3', name: 'Johann Wolfgang von Goethe', publisher_id: '2' }
//     ]
//   },
//   { id: '3', name: 'UK Books Ltd.', country_id: '3', authors: [] },
//   { id: '4', name: 'Global Publishing', country_id: null, authors: [] }
// ]

console.log('All Publishers with Authors:', inspect(allPublishersWithAuthors));
// Note: allPublishersWithAuthors contains { data, meta, links }

// Query all publishers and include their authors (non-simplified, full JSON:API output)
const allPublishersWithAuthorsNotSimplified = await api.resources.publishers.query({
  queryParams: {
    include: ['authors']
  },
  simplified: false
});
// HTTP: GET /api/publishers?include=authors
// Returns (JSON:API): {
//   data: [
//     { type: 'publishers', id: '1', attributes: { name: 'French Books Inc.' },
//       relationships: { 
//         authors: { data: [
//           { type: 'authors', id: '1' },
//           { type: 'authors', id: '2' }
//         ]}
//       }
//     },
//     { type: 'publishers', id: '2', attributes: { name: 'German Press GmbH' },
//       relationships: { 
//         authors: { data: [{ type: 'authors', id: '3' }] }
//       }
//     },
//     { type: 'publishers', id: '3', attributes: { name: 'UK Books Ltd.' },
//       relationships: { authors: { data: [] } }
//     },
//     { type: 'publishers', id: '4', attributes: { name: 'Global Publishing' },
//       relationships: { authors: { data: [] } }
//     }
//   ],
//   included: [
//     { type: 'authors', id: '1', attributes: { name: 'Victor Hugo' } },
//     { type: 'authors', id: '2', attributes: { name: 'Alexandre Dumas' } },
//     { type: 'authors', id: '3', attributes: { name: 'Johann Wolfgang von Goethe' } }
//   ]
// }

console.log('All Publishers with Authors (not simplified):', inspect(allPublishersWithAuthorsNotSimplified));
```

**Expected Output:**

```text
All Publishers with Authors: [
  {
    id: '1',
    name: 'French Books Inc.',
    authors_ids: [ '1', '2' ],
    authors: [
      { id: '1', name: 'Victor', surname: 'Hugo' },
      { id: '2', name: 'Émile', surname: 'Zola' }
    ]
  },
  {
    id: '2',
    name: 'German Press GmbH',
    authors_ids: [ '3' ],
    authors: [ { id: '3', name: 'Johann', surname: 'Goethe' } ]
  },
    { id: '3', name: 'Global Publishing', authors_ids: [] }
  ],
  meta: {...},
  links: {...}
}
All Publishers with Authors (not simplified): {
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc.' },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: '1' },
            { type: 'authors', id: '2' }
          ],
          links: {
            self: '/api/1.0/publishers/1/relationships/authors',
            related: '/api/1.0/publishers/1/authors'
          }
        }
      },
      links: { self: '/api/1.0/publishers/1' }
    },
    {
      type: 'publishers',
      id: '2',
      attributes: { name: 'German Press GmbH' },
      relationships: {
        authors: {
          data: [ { type: 'authors', id: '3' } ],
          links: {
            self: '/api/1.0/publishers/2/relationships/authors',
            related: '/api/1.0/publishers/2/authors'
          }
        }
      },
      links: { self: '/api/1.0/publishers/2' }
    },
    {
      type: 'publishers',
      id: '3',
      attributes: { name: 'Global Publishing' },
      relationships: {
        authors: {
          data: [],
          links: {
            self: '/api/1.0/publishers/3/relationships/authors',
            related: '/api/1.0/publishers/3/authors'
          }
        }
      },
      links: { self: '/api/1.0/publishers/3' }
    }
  ],
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor', surname: 'Hugo' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Émile', surname: 'Zola' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/2' }
    },
    {
      type: 'authors',
      id: '3',
      attributes: { name: 'Johann', surname: 'Goethe' },
      relationships: { publisher: { data: { type: 'publishers', id: '2' } } },
      links: { self: '/api/1.0/authors/3' }
    }
  ],
  links: { self: '/api/1.0/publishers?include=authors' }
}
```

**Important Note on `hasMany` in Non-Simplified Mode:**

In non-simplified (full JSON:API) mode, `hasMany` relationships in the `data` section of the parent resource only contain an empty `data` array or `links` to the related endpoint (e.g., `authors: { links: { related: '/api/1.0/publishers/1/authors' } }`). The actual related `author` resources are placed in the top-level `included` array. This is standard JSON:API behavior to avoid duplicating large amounts of data. The `included` array ensures that each included resource appears only once, even if referenced by multiple parent resources.

## Filtering by `hasMany` Relationships

Filtering resources based on conditions applied to their `hasMany` relationships is a common requirement. For example, finding all publishers that have an author whose surname starts with 'Hu'. This is achieved by leveraging the `searchSchema` and defining fields that traverse the relationship to the child resource.

The `RestApiKnexPlugin` handles the necessary SQL `JOIN` operations automatically when you define `actualField` in your `searchSchema` to point to a field on a related `hasMany` table.

### Programmatic Usage:

```javascript

// Filter authors by publisher name (cross-table search defined in authors' searchSchema)
const authorsFromGermanPress = await api.resources.authors.query({
  queryParams: {
    filters: {
      publisherName: 'German' // Using the alias 'publisherName' from authors' searchSchema
    }
  }
});
// HTTP: GET /api/authors?filter[publisherName]=German
// Returns: {
//   data: [{ id: '3', name: 'Johann Wolfgang von Goethe', publisher_id: '2' }]
// }

console.log('Authors from German Press:', inspect(authorsFromGermanPress));
// Note: authorsFromGermanPress contains { data, meta, links }
```

The output will be:

```text
Authors from German Press: [ { id: '3', name: 'Johann', surname: 'Goethe', publisher_id: '2' } ]
```

Once again, the search logic is always define on the `schema` -- that is, it's handled by the server -- and not by the client.

This is the part of the searchSchema that does the trick:

```javascript
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
```

The query will automatically add all of the necessary joins to the query so that `publishers.name` will be searched.

The difference with a normal serach on a field of the main table is in the fact that we provided the full path (`publisher.name`). All of the other search options ( `oneOf`, `filterOperator`, `splitBy`) are available

---

[Previous: 2.3 `belongsTo` Relationships](./GUIDE_2_3_BelongsTo_Relationships.md) | [Back to Guide](./README.md) | [Next: 2.5 hasMany records (polymorphic)](./GUIDE_2_5_HasMany_Polymorphic.md)