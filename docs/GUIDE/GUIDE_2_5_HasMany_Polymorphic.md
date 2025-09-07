# 2.5 hasMany records (polymorphic)

Polymorphic relationships are a special type of one-to-many association where a single resource can belong to *one of several different* resource types. For example, a `review` might be associated with an `author` *or* a `publisher*. This differs from a standard `belongsTo` where a resource belongs to only one specific type.

To implement this, the "belonging" resource (e.g., `review`) needs two foreign key fields:
1.  An **`idField`** (e.g., `reviewable_id`) to store the ID of the related resource.
2.  A **`typeField`** (e.g., `reviewable_type`) to store the *type* of the related resource (e.g., 'authors' or 'publishers').

`json-rest-api` supports polymorphic relationships via the **`belongsToPolymorphic`** definition on the *child* resource. To establish the reverse `hasMany` link from the parent, you simply use the **`via`** keyword, pointing to the name of the `belongsToPolymorphic` field on the child.

For this section, we'll use our existing `publishers` and `authors` tables, and introduce a new `reviews` table that can give reviews to both authors and publishers.

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true},
  },
  relationships: {
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
});
await api.resources.publishers.createKnexTable();

// Define authors resource
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  relationships: {
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
});
await api.resources.authors.createKnexTable();

// Define reviews resource with a polymorphic relationship
await api.addResource('reviews', {
  schema: {
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', max: 500, nullable: true },
    // These two fields store the polymorphic relationship data in the database
    reviewable_type: { type: 'string', max: 50, required: true }, 
    reviewable_id: { type: 'id', required: true }, 
  },
  relationships: {
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'], // The possible resource types this review can belong to
        typeField: 'reviewable_type', // The field in 'reviews' schema storing the parent's type
        idField: 'reviewable_id'      // The field in 'reviews' schema storing the parent's ID
      }
    }
  },
});
await api.resources.reviews.createKnexTable();
```

Defining a polymorphic relationship is more verbose because there are two fields to take care of insteaf of one. So, the parent record can't just say "all records in the child relationship where the field `foreign_id` matches my id" -- it would need to specify two fields, not one: the foreign ID and the table the ID refers to.

This is why the child table defines a `reviewable` object in `relationships` where it states which fields are used for the relationship:

```javascript
  // Child table, e.g. 'reviews' (applicable to publishers and authors)
  relationships: {
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'],
        typeField: 'reviewable_type',
        idField: 'reviewable_id'
      }
    }
  },
```
So when the parent defines the relationship, they just have to mention `reviewable`:

```javascript
  relationships: {
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
```

## Field Visibility and Polymorphic Relationships

Polymorphic relationships are a prime example of json-rest-api's database-first philosophy and field abstraction:

**Database Reality (What Backend Developers Define):**
- Schema includes `reviewable_type` and `reviewable_id` fields
- These are actual database columns that store the polymorphic relationship
- Hooks receive these field names in `context.belongsToUpdates`

**API Abstraction (What Consumers See):**
- Input: Use `reviewable` relationship object instead of type/id fields
- Output: Returns `reviewable: { id: '123', _type: 'authors' }` 
- The `reviewable_type` and `reviewable_id` fields are hidden from API responses

This ensures API consumers work with clean relationship objects while backend developers maintain full control over the database implementation.

`json-rest-api` provides flexibility in how you provide data for polymorphic relationships when creating new records, depending on whether you're using the simplified API mode (default for programmatic calls) or the strict JSON:API format.

Here is how to add reviews, both in simplified and non-simplified mode:

```javascript
const frenchPublisher_ns = await api.resources.publishers.post({ name: 'French Books Inc. (NS)' });
const germanPublisher_ns = await api.resources.publishers.post({ name: 'German Press GmbH (NS)' });

const frenchAuthor1_ns = await api.resources.authors.post({ name: 'Victor (NS)', surname: 'Hugo (NS)', publisher: frenchPublisher_ns.id });
const germanAuthor_ns = await api.resources.authors.post({ name: 'Johann (NS)', surname: 'Goethe (NS)', publisher: germanPublisher_ns.id });

const review1_simplified = await api.resources.reviews.post({
  rating: 4,
  comment: 'Great German author! (Simplified)',
  reviewable: { id: germanAuthor_ns.id, _type: 'authors' }
});

const review2_simplified = await api.resources.reviews.post({
  rating: 1,
  comment: 'I do not enjoy their books',
  reviewable: { id: frenchPublisher_ns.id, _type: 'publishers' }
});


// Add reviews using non-simplified (JSON:API standard) input with relationships object
const review3_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 3,
        comment: 'Decent publisher, some good titles (NS).'
      },
      relationships: { // Explicitly define the polymorphic relationship here
        reviewable: {
          data: { type: 'publishers', id: frenchPublisher_ns.id } // Resource identifier object
        }
      }
    }
  },
  simplified: false // Ensure non-simplified mode for this call
});

const review4_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 5,
        comment: 'Hugo is a master storyteller! (NS)'
      },
      relationships: {
        reviewable: {
          data: { type: 'authors', id: frenchAuthor1_ns.id }
        }
      }
    }
  },
  simplified: false
});

const frenchAuthor1_with_reviews_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id });
const frenchAuthor1_with_reviews_non_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id, simplified: false });

const french_authors_simplified = await api.resources.authors.query({});
// HTTP: GET /api/authors
// Returns (simplified): [
//   { id: '1', name: 'Victor Hugo', surname: 'Hugo', publisher: { id: '1' } },
//   { id: '2', name: 'Alexandre Dumas', surname: 'Dumas', publisher: { id: '1' } }
// ]

const french_authors_non_simplified = await api.resources.authors.query({simplified: false });
// HTTP: GET /api/authors
// Returns (JSON:API): {
//   data: [
//     { type: 'authors', id: '1', attributes: { name: 'Victor Hugo' } },
//     { type: 'authors', id: '2', attributes: { name: 'Alexandre Dumas' } }
//   ]
// }

console.log('Added Publisher Review (simplified):', inspect(review1_simplified));
console.log('Added Author Review (simplified):', inspect(review2_simplified));
console.log('Added Publisher Review (non-Simplified):', inspect(review3_non_simplified));
console.log('Added Author Review (non-Simplified):', inspect(review4_non_simplified));

// Single records
console.log('French author with the newly added reviews (simplified):')
console.log(inspect(frenchAuthor1_with_reviews_simplified));
console.log('French author with the newly added reviews (non-simplified):')
console.log(inspect(frenchAuthor1_with_reviews_non_simplified))

// Lists
console.log('French authors with the newly added reviews (simplified):')
console.log(inspect(french_authors_simplified));
console.log('French authors with the newly added reviews (non-simplified):')
console.log(inspect(french_authors_non_simplified))


```

As you can see, you can add reviews both in simplified and non-simplified mode. Here is the difference:

* **Simplified Mode:** `json-rest-api` automatically recognizes `reviewable_type` and `reviewable_id` attributes as foreign keys for polymorphic relationships defined with `belongsToPolymorphic`. This provides a flattened, convenient syntax for programmatic use.
* **Non-Simplified Mode (JSON:API Standard):** This adheres to the JSON:API specification, where relationships are explicitly defined in the `relationships` object with a resource identifier object (`{ type: 'resourceType', id: 'resourceId' }`). This is typically used when interacting with the API via HTTP or when strict JSON:API compliance is required.

**Expected Output**

```text
Added Publisher Review (simplified): { id: '1', rating: 4, comment: 'Great German author! (Simplified)' }
Added Author Review (simplified): { id: '2', rating: 1, comment: 'I do not enjoy their books' }
Added Publisher Review (non-Simplified): {
  data: {
    type: 'reviews',
    id: '3',
    attributes: { rating: 3, comment: 'Decent publisher, some good titles (NS).' },
    links: { self: '/api/reviews/3' }
  },
  links: { self: '/api/reviews/3' }
}
Added Author Review (non-Simplified): {
  data: {
    type: 'reviews',
    id: '4',
    attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
    links: { self: '/api/reviews/4' }
  },
  links: { self: '/api/reviews/4' }
}
French author with the newly added reviews (simplified):
{
  id: '1',
  name: 'Victor (NS)',
  surname: 'Hugo (NS)',
  reviews: [ { id: '4' } ],
  publisher: { id: '1' }
}
French author with the newly added reviews (non-simplified):
{
  data: {
    type: 'authors',
    id: '1',
    attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
    relationships: {
      reviews: { data: [ { type: 'reviews', id: '4' } ] },
      publisher: {
        data: { type: 'publishers', id: '1' },
        links: {
          self: '/api/authors/1/relationships/publisher',
          related: '/api/authors/1/publisher'
        }
      }
    },
    links: { self: '/api/authors/1' }
  },
  links: { self: '/api/authors/1' }
}
French authors with the newly added reviews (simplified):
[
  {
    id: '1',
    name: 'Victor (NS)',
    surname: 'Hugo (NS)',
    reviews: [ { id: '4' } ],
    publisher: { id: '1' }
  },
  {
    id: '2',
    name: 'Johann (NS)',
    surname: 'Goethe (NS)',
    reviews: [ { id: '1' } ],
    publisher: { id: '2' }
  }
]
French authors with the newly added reviews (non-simplified):
{
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
      relationships: {
        reviews: { data: [ { type: 'reviews', id: '4' } ] },
        publisher: {
          data: { type: 'publishers', id: '1' },
          links: {
            self: '/api/authors/1/relationships/publisher',
            related: '/api/authors/1/publisher'
          }
        }
      },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Johann (NS)', surname: 'Goethe (NS)' },
      relationships: {
        reviews: { data: [ { type: 'reviews', id: '1' } ] },
        publisher: {
          data: { type: 'publishers', id: '2' },
          links: {
            self: '/api/authors/2/relationships/publisher',
            related: '/api/authors/2/publisher'
          }
        }
      },
      links: { self: '/api/authors/2' }
    }
  ],
  links: { self: '/api/authors' }
}
```

When you fetch the french author after adding the reviews, you only get the review _ids_ and not the full review data. This is expected. To fetch the actual reviews, you will need to `include` them.

## Including Polymorphic Records (`include`)

To retrieve related polymorphic resources (e.g., getting a publisher and including all its reviews, or getting an author and including all their reviews), you'll use the **`include` query parameter** from the "one" side of the polymorphic relationship.

The output format (simplified vs. non-simplified) will depend on the `simplified` parameter of your `get` or `query` call, or the default `simplifiedApi` setting.

Leaving the exact same schema definition and the exact same data as above, by making these calls:

```javascript
const frenchAuthor1_with_reviews_and_includes_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id, queryParams: { include: ['reviews'] } });
const frenchAuthor1_with_reviews_and_includes_non_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id, queryParams: { include: ['reviews'] }, simplified: false });

const french_authors_with_includes_simplified = await api.resources.authors.query({queryParams: { include: ['reviews'] } });
// HTTP: GET /api/authors?include=reviews
// Returns (simplified): [
//   { id: '1', name: 'Victor Hugo', surname: 'Hugo', publisher: { id: '1' }, 
//     reviews: [{ id: '2', comment: 'A master storyteller', rating: 5, reviewable: { id: '1', _type: 'authors' } }]
//   },
//   { id: '2', name: 'Alexandre Dumas', surname: 'Dumas', publisher: { id: '1' }, reviews: [] }
// ]

const french_authors_with_includes_non_simplified = await api.resources.authors.query({queryParams: { include: ['reviews'] }, simplified: false });
// HTTP: GET /api/authors?include=reviews
// Returns (JSON:API): {
//   data: [
//     { type: 'authors', id: '1', attributes: { name: 'Victor Hugo' },
//       relationships: { reviews: { data: [{ type: 'reviews', id: '2' }] } }
//     },
//     { type: 'authors', id: '2', attributes: { name: 'Alexandre Dumas' },
//       relationships: { reviews: { data: [] } }
//     }
//   ],
//   included: [
//     { type: 'reviews', id: '2', 
//       attributes: { comment: 'A master storyteller', rating: 5, reviewable_type: 'authors', reviewable_id: '1' }
//     }
//   ]
// }

console.log('French author with the newly added reviews (simplified):')
console.log(inspect(frenchAuthor1_with_reviews_and_includes_simplified));
console.log('French author with the newly added reviews (non-simplified):')
console.log(inspect(frenchAuthor1_with_reviews_and_includes_non_simplified))

console.log('French authors with the newly added reviews (simplified):')
console.log(inspect(french_authors_with_includes_simplified));
console.log('French authors with the newly added reviews (non-simplified):')
console.log(inspect(french_authors_with_includes_non_simplified))
```

**Expected Output**

```text
French author with the newly added reviews (simplified):
{
  id: '1',
  name: 'Victor (NS)',
  surname: 'Hugo (NS)',
  reviews_ids: [ '4' ],
  reviews: [
    {
      id: '4',
      rating: 5,
      comment: 'Hugo is a master storyteller! (NS)',
      reviewable: { id: '1', _type: 'authors' }
    }
  ],
  publisher: { id: '1' }
}
French author with the newly added reviews (non-simplified):
{
  data: {
    type: 'authors',
    id: '1',
    attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
    relationships: {
      reviews: {
        data: [ { type: 'reviews', id: '4' } ],
        links: {
          self: '/api/authors/1/relationships/reviews',
          related: '/api/authors/1/reviews'
        }
      },
      publisher: {
        data: { type: 'publishers', id: '1' },
        links: {
          self: '/api/authors/1/relationships/publisher',
          related: '/api/authors/1/publisher'
        }
      }
    },
    links: { self: '/api/authors/1' }
  },
  included: [
    {
      type: 'reviews',
      id: '4',
      attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
      relationships: { reviewable: { data: { type: 'authors', id: '1' } } },
      links: { self: '/api/reviews/4' }
    }
  ],
  links: { self: '/api/authors/1' }
}
French authors with the newly added reviews (simplified):
[
  {
    id: '1',
    name: 'Victor (NS)',
    surname: 'Hugo (NS)',
    reviews_ids: [ '4' ],
    reviews: [
      {
        id: '4',
        rating: 5,
        comment: 'Hugo is a master storyteller! (NS)',
        reviewable: { id: '1', _type: 'authors' }
      }
    ],
    publisher: { id: '1' }
  },
  {
    id: '2',
    name: 'Johann (NS)',
    surname: 'Goethe (NS)',
    reviews: [
      {
        id: '1',
        rating: 4,
        comment: 'Great German author! (Simplified)',
        reviewable: { id: '2', _type: 'authors' }
      }
    ],
    publisher: { id: '2' }
  }
]
French authors with the newly added reviews (non-simplified):
{
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
      relationships: {
        reviews: {
          data: [ { type: 'reviews', id: '4' } ],
          links: {
            self: '/api/authors/1/relationships/reviews',
            related: '/api/authors/1/reviews'
          }
        },
        publisher: {
          data: { type: 'publishers', id: '1' },
          links: {
            self: '/api/authors/1/relationships/publisher',
            related: '/api/authors/1/publisher'
          }
        }
      },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Johann (NS)', surname: 'Goethe (NS)' },
      relationships: {
        reviews: {
          data: [ { type: 'reviews', id: '1' } ],
          links: {
            self: '/api/authors/2/relationships/reviews',
            related: '/api/authors/2/reviews'
          }
        },
        publisher: {
          data: { type: 'publishers', id: '2' },
          links: {
            self: '/api/authors/2/relationships/publisher',
            related: '/api/authors/2/publisher'
          }
        }
      },
      links: { self: '/api/authors/2' }
    }
  ],
  included: [
    {
      type: 'reviews',
      id: '4',
      attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
      relationships: { reviewable: { data: { type: 'authors', id: '1' } } },
      links: { self: '/api/reviews/4' }
    },
    {
      type: 'reviews',
      id: '1',
      attributes: { rating: 4, comment: 'Great German author! (Simplified)' },
      relationships: { reviewable: { data: { type: 'authors', id: '2' } } },
      links: { self: '/api/reviews/1' }
    }
  ],
  links: { self: '/api/authors?include=reviews' }
}
```

When fetching data programmatically in **simplified mode** (which is the default), polymorphic `hasMany` relationships will appear as **arrays of child objects** embedded directly within the parent resource, just like regular `hasMany` relationships.

When you explicitly request **non-simplified output**, the polymorphic `hasMany` relationships will appear in the **`included` array** at the top level of the JSON:API document. The parent resource's `relationships` object will contain links to the related endpoint but not the full related data itself.

## Filtering by Polymorphic Relationships

Filtering by polymorphic relatiohships has two sides:

* **Filtering the polymorphic resource itself (e.g., `reviews`):**

This happens when you want to search reviews, and you want to also search in the reviewed item's information. For example searching for 'Apress' would return all reviews where the publisher name includes `Apress`. this is a very common scenario.  This is achieved via cross-table filtering.

* **Filtering the parent resource (e.g., `publishers` or `authors`) by its polymorphic `hasMany` children (`reviews`)**

This happens when you want to search in `publishers`, and you want to also search in the publisher's reviews. For exaple searching for "terrible" would return all publishers containing a review with the word `awesome`. This is also a very common scenario.

### Search (polymorphic)

Keeping the data already entered, change the resource definitions to match this:

```javascript
// Define publishers resource
// Publishers can have many authors (regular relationship) and many reviews (polymorphic)
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true},
  },
  relationships: {
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' }, // Regular one-to-many
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic one-to-many
  },
  searchSchema: {
    // Search publishers by their review fields (reverse polymorphic search)
    reviewComment: { 
      type: 'string', 
      actualField: 'reviews.comment', 
      filterOperator: 'like' 
    },
    reviewRating: { 
      type: 'number', 
      actualField: 'reviews.rating', 
      filterOperator: '=' 
    }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource  
// Authors belong to a publisher (regular relationship) and can have many reviews (polymorphic)
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  relationships: {
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic one-to-many
  },
  searchSchema: {
    // Regular search fields
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    
    // Cross-table search into regular relationship
    publisherName: { 
      type: 'string', 
      actualField: 'publishers.name', 
      filterOperator: 'like' 
    },
    
    // Cross-table search into polymorphic relationship (reverse polymorphic search)
    // This will find authors by searching their reviews' comments
    reviewComment: { 
      type: 'string', 
      actualField: 'reviews.comment', 
      filterOperator: 'like' 
    }
  }
});
await api.resources.authors.createKnexTable();


// Define reviews resource with a polymorphic relationship
// A review can belong to either a publisher OR an author (but not both)
// This is achieved using a type field and an ID field
await api.addResource('reviews', {
  schema: {
    rating: { type: 'number', required: true, min: 1, max: 5, indexed: true },
    comment: { type: 'string', max: 500, nullable: true, indexed: true },
    
    // Polymorphic relationship fields:
    reviewable_type: { type: 'string', max: 50, required: true }, // Stores 'publishers' or 'authors'
    reviewable_id: { type: 'id', required: true }, // Stores the ID of the publisher or author
  },
  relationships: {
    // Polymorphic belongsTo relationship
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'], // The possible resource types this review can belong to
        typeField: 'reviewable_type', // The field in 'reviews' schema storing the parent's type
        idField: 'reviewable_id'      // The field in 'reviews' schema storing the parent's ID
      },
    }
  },
  searchSchema: {
    rating: { type: 'number', filterOperator: '=' },
    comment: { type: 'string', filterOperator: 'like' },
    
    // Polymorphic search field (forward polymorphic search)
    // This searches for reviews by their parent's name field, regardless of parent type
    reviewableName: {
      type: 'string',
      polymorphicField: 'reviewable',  // Reference the polymorphic relationship
      targetFields: {
        publishers: 'name',    // When reviewable_type='publishers', search publishers.name
        authors: 'name'        // When reviewable_type='authors', search authors.name
      },
      filterOperator: 'like'
    }
  }
});
await api.resources.reviews.createKnexTable();
```

The schema definitions above demonstrate two powerful polymorphic search patterns:

**1. Forward Polymorphic Search** (in reviews.searchSchema)

The `reviewableName` search field allows searching reviews by their parent's name, regardless of whether the parent is a publisher or author:

```javascript
reviewableName: {
  type: 'string',
  polymorphicField: 'reviewable',  // Points to the polymorphic relationship
  targetFields: {
    publishers: 'name',    // When parent is a publisher, search its 'name' field
    authors: 'name'        // When parent is an author, search its 'name' field
  },
  filterOperator: 'like'
}
```

This generates SQL that dynamically JOINs to different tables based on the `reviewable_type`:
- When `reviewable_type = 'publishers'`, it JOINs to the publishers table
- When `reviewable_type = 'authors'`, it JOINs to the authors table

**2. Reverse Polymorphic Search** (in authors.searchSchema and publishers.searchSchema)

The `reviewComment` search field allows finding parents (authors/publishers) by searching their polymorphic children (reviews):

```javascript
// In authors.searchSchema:
reviewComment: { 
  type: 'string', 
  actualField: 'reviews.comment',  // Search in the reviews table
  filterOperator: 'like' 
}

// In relationships:
reviews: { hasMany: 'reviews', via: 'reviewable' }  // Polymorphic relationship
```

This uses the `via` property to indicate a polymorphic hasMany relationship. The system automatically adds the polymorphic constraints:
- For authors: `reviews.reviewable_type = 'authors' AND reviews.reviewable_id = authors.id`
- For publishers: `reviews.reviewable_type = 'publishers' AND reviews.reviewable_id = publishers.id`

This enables powerful queries like "find all authors who have reviews mentioning 'storyteller'" without manually writing complex JOINs.

With the same data, run these queries:

```javascript
// 1. Forward polymorphic search: Find reviews by their parent's name
// This searches across BOTH publishers and authors tables based on reviewable_type
const reviews_filtered_simplified = await api.resources.reviews.query({ queryParams: { filters: {reviewableName: 'Victor'} }})
// HTTP: GET /api/reviews?filter[reviewableName]=Victor
// Returns: [{ id: '2', comment: 'A master storyteller', rating: 5, reviewable: { id: '1', _type: 'authors' } }]

const reviews_filtered_non_simplified = await api.resources.reviews.query({queryParams: { filters: {reviewableName: 'Victor'} }, simplified: false })
// HTTP: GET /api/reviews?filter[reviewableName]=Victor
// Returns (JSON:API): {
//   data: [{ 
//     type: 'reviews', 
//     id: '2', 
//     attributes: { comment: 'A master storyteller', rating: 5 },
//     relationships: {
//       reviewable: { data: { type: 'authors', id: '1' } }
//     }
//   }]
// }

// 2. Reverse polymorphic search: Find parents (authors) by their children's (reviews) fields
// This uses a polymorphic JOIN: reviews.reviewable_type = 'authors' AND reviews.reviewable_id = authors.id
const authors_filtered_simplified = await api.resources.authors.query({queryParams: { filters: {reviewComment: 'storyteller'} }})
// HTTP: GET /api/authors?filter[reviewComment]=storyteller
// Returns: [{ id: '1', name: 'Victor Hugo', surname: 'Hugo', publisher: { id: '1' } }]

const authors_filtered_non_simplified = await api.resources.authors.query({queryParams: { filters: {reviewComment: 'storyteller'} }, simplified: false })
// HTTP: GET /api/authors?filter[reviewComment]=storyteller
// Returns (JSON:API): {
//   data: [{ type: 'authors', id: '1', attributes: { name: 'Victor Hugo' } }]
// }

// 3. Reverse polymorphic search: Find parents (publishers) by their children's (reviews) fields
// This uses a polymorphic JOIN: reviews.reviewable_type = 'publishers' AND reviews.reviewable_id = publishers.id
const publishers_filtered_simplified = await api.resources.publishers.query({queryParams: { filters: {reviewComment: 'enjoy'} }})
// HTTP: GET /api/publishers?filter[reviewComment]=enjoy
// Returns: [{ id: '1', name: 'French Books Inc.' }]

const publishers_filtered_non_simplified = await api.resources.publishers.query({queryParams: { filters: {reviewComment: 'enjoy'} }, simplified: false })
// HTTP: GET /api/publishers?filter[reviewComment]=enjoy
// Returns (JSON:API): {
//   data: [{ type: 'publishers', id: '1', attributes: { name: 'French Books Inc.' } }]
// }


console.log('Reviews FILTERED (simplified):')
console.log(inspect(reviews_filtered_simplified));
console.log('Reviews FILTERED (non-simplified):')
console.log(inspect(reviews_filtered_non_simplified))

console.log('Authors FILTERED (simplified):')
console.log(inspect(authors_filtered_simplified));
console.log('Authors FILTERED (non-simplified):')
console.log(inspect(authors_filtered_non_simplified))

console.log('Publishers FILTERED (simplified):')
console.log(inspect(publishers_filtered_simplified));
console.log('Publishers FILTERED (non-simplified):')
console.log(inspect(publishers_filtered_non_simplified))

```

**Expected results**
```
Reviews FILTERED (simplified):
{
  data: [
    {
      id: '4',
      rating: 5,
      comment: 'Hugo is a master storyteller! (NS)',
      reviewable: { id: '1', _type: 'authors' }
    }
  ],
  meta: {...},
  links: {...}
}
Reviews FILTERED (non-simplified):
{
  data: [
    {
      type: 'reviews',
      id: '4',
      attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
      relationships: {
        reviewable: {
          data: { type: 'authors', id: '1' },
          links: {
            self: '/api/reviews/4/relationships/reviewable',
            related: '/api/reviews/4/reviewable'
          }
        }
      },
      links: { self: '/api/reviews/4' }
    }
  ],
  links: { self: '/api/reviews?filters[reviewableName]=Victor' }
}
Authors FILTERED (simplified):
{
  data: [
    {
      id: '1',
      name: 'Victor (NS)',
      surname: 'Hugo (NS)',
      reviews: [ { id: '4' } ],
      publisher: { id: '1' }
    }
  ],
  meta: {...},
  links: {...}
}
Authors FILTERED (non-simplified):
{
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
      relationships: {
        reviews: { data: [ { type: 'reviews', id: '4' } ] },
        publisher: {
          data: { type: 'publishers', id: '1' },
          links: {
            self: '/api/authors/1/relationships/publisher',
            related: '/api/authors/1/publisher'
          }
        }
      },
      links: { self: '/api/authors/1' }
    }
  ],
  links: { self: '/api/authors?filters[reviewComment]=storyteller' }
}
Publishers FILTERED (simplified):
{
  data: [
    {
      id: '1',
      name: 'French Books Inc. (NS)',
      authors_ids: [ '1' ],
      reviews_ids: [ '2', '3' ]
    }
  ],
  meta: {...},
  links: {...}
}
Publishers FILTERED (non-simplified):
{
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc. (NS)' },
      relationships: {
        authors: { data: [ { type: 'authors', id: '1' } ] },
        reviews: {
          data: [
            { type: 'reviews', id: '2' },
            { type: 'reviews', id: '3' }
          ]
        }
      },
      links: { self: '/api/publishers/1' }
    }
  ],
  links: { self: '/api/publishers?filters[reviewComment]=enjoy' }
}
```

The output demonstrates how polymorphic search works across both simplified and JSON:API formats:

**Forward Polymorphic Search Results (reviews filtered by parent name "Victor")**

The query `filters: {reviewableName: 'Victor'}` found review ID 4, which belongs to author "Victor Hugo". The search worked by:
1. Checking each review's `reviewable_type` field
2. When it found `reviewable_type = 'authors'`, it JOINed to the authors table using `reviewable_id = authors.id`
3. It then searched for `authors.name LIKE '%Victor%'`

In the simplified format, notice how the polymorphic fields are included:
```javascript
{
  id: '4',
  rating: 4,
  comment: "Great storyteller (NS)",
  reviewable_type: 'authors',    // These polymorphic fields are restored
  reviewable_id: '1'              // in simplified mode after our fix!
}
```

**Reverse Polymorphic Search Results**

1. **Authors filtered by review comment "storyteller"**: Found author ID 1 (Victor Hugo) because he has review ID 4 containing "storyteller"
2. **Publishers filtered by review comment "enjoy"**: Found publisher ID 1 because it has reviews IDs 2 and 3 containing "enjoy"

The reverse search worked by:
- JOINing from authors/publishers to reviews with polymorphic constraints
- For authors: `JOIN reviews ON reviews.reviewable_type = 'authors' AND reviews.reviewable_id = authors.id`
- Then filtering: `WHERE reviews.comment LIKE '%storyteller%'`

In simplified format, the relationships are represented as arrays of IDs:
- `reviews_ids: [ '4' ]` - Author 1 has one review
- `reviews_ids: [ '2', '3' ]` - Publisher 1 has two reviews

The polymorphic search seamlessly handles the fact that reviews can belong to different parent types, making it easy to search across these complex relationships without writing custom SQL.

---

[Previous: 2.4 hasMany records](./GUIDE_2_4_HasMany_Records.md) | [Back to Guide](./README.md) | [Next: 2.6 Many to many (hasMany with through records)](./GUIDE_2_6_Many_To_Many.md)