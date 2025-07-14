# Chapter 8: Polymorphic Relationships

In real-world applications, you often need to create relationships where a single entity can belong to multiple different types of parents. For example, a comment might belong to either a blog post or a video, or a review might be for a book, an author, or a publisher. This is where **polymorphic relationships** come in.

## What Are Polymorphic Relationships?

A polymorphic relationship allows a model to belong to more than one other model using a single association. Instead of creating separate tables for each type of relationship (like `book_reviews`, `author_reviews`, `publisher_reviews`), you can have a single `reviews` table that can reference any of these parent types.

## Understanding the Setup from Chapter 1

In Chapter 1's initial setup, we already included a `reviews` table that demonstrates polymorphic relationships. Let's examine how it was configured to understand the key concepts.

### Step 1: The Polymorphic Resource Definition

Here's how the `reviews` resource was defined in our initial setup:

```javascript
// Reviews table (polymorphic - can review books, authors, or publishers)
await api.addResource('reviews', {
  schema: {
    id: { type: 'id' },
    review_author: { type: 'string', required: true, max: 100 },
    review_text: { type: 'string', required: true, max: 5000 },
    review_rating: { type: 'number', required: true, min: 1, max: 5 },
    reviewable_type: { type: 'string', required: true },
    reviewable_id: { type: 'number', required: true },
    // Define the polymorphic field
    reviewable: {
      belongsToPolymorphic: {
        types: ['books', 'authors', 'publishers'],
        typeField: 'reviewable_type',
        idField: 'reviewable_id'
      },
      as: 'reviewable'
    }
  }
});
await api.resources.reviews.createKnexTable()
```

*(This was already set up in Chapter 1 - we're examining it here to understand how it works)*

Key points about this polymorphic definition:
- `reviewable_type` and `reviewable_id` are the actual database fields that store the parent type and ID
- The `reviewable` field is a special schema field that defines the polymorphic relationship
- `belongsToPolymorphic` specifies:
  - `types`: Array of resource types that can be reviewed
  - `typeField`: The field that stores the parent type (e.g., 'books', 'authors')
  - `idField`: The field that stores the parent's ID
- `as: 'reviewable'` creates the relationship name for API access

### Step 2: The Reverse Relationships

In Chapter 1, we also added reverse relationships to each parent resource so they know they can have reviews:

```javascript
// In the books resource definition from Chapter 1:
relationships: {
  authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' },
  reviews: { hasMany: 'reviews', via: 'reviewable' }
}

// In the authors resource definition from Chapter 1:
relationships: {
  books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' },
  reviews: { hasMany: 'reviews', via: 'reviewable' }
}

// In the publishers resource definition from Chapter 1:
relationships: {
  books: { hasMany: 'books', foreignKey: 'publisher_id' },
  reviews: { hasMany: 'reviews', via: 'reviewable' }
}
```

The `via: 'reviewable'` tells the system to use the polymorphic relationship defined in the reviews table.

### Step 3: Understanding Relationship Includes

In the Chapter 1 setup, reviews are not automatically included when fetching books, authors, or publishers. To include related data, you must use the `?include=` parameter:

```javascript
// To enable automatic inclusion of reviews:
relationships: {
  // ... existing relationships ...
  reviews: { 
    hasMany: 'reviews', 
    via: 'reviewable',
    // Use ?include=reviews to include reviews in responses
  }
}
```

To include reviews when fetching a book, you need to explicitly request them with `?include=reviews`. This approach gives you control over which related data to load, helping optimize performance.

## Using Polymorphic Relationships

### Creating Reviews

You can create reviews for different resource types using relationships:

```javascript
// Create a book review
const bookReview = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        review_author: 'John Doe',
        review_text: 'This is an excellent book about JavaScript!',
        review_rating: 5
      },
      relationships: {
        reviewable: {
          data: { type: 'books', id: '1' }
        }
      }
    }
  }
});

// Create an author review
const authorReview = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        review_author: 'Jane Smith',
        review_text: 'Great writing style, love all their books!',
        review_rating: 4
      },
      relationships: {
        reviewable: {
          data: { type: 'authors', id: '2' }
        }
      }
    }
  }
});
```

**CURL Examples:**

```bash
# Create a book review
curl -X POST -H "Content-Type: application/vnd.api+json" \
-d '{
  "data": {
    "type": "reviews",
    "attributes": {
      "review_author": "John Doe",
      "review_text": "This is an excellent book about JavaScript!",
      "review_rating": 5
    },
    "relationships": {
      "reviewable": {
        "data": { "type": "books", "id": "1" }
      }
    }
  }
}' http://localhost:3000/api/reviews

# Create a publisher review
curl -X POST -H "Content-Type: application/vnd.api+json" \
-d '{
  "data": {
    "type": "reviews",
    "attributes": {
      "review_author": "Industry Expert",
      "review_text": "They publish high quality technical books.",
      "review_rating": 4
    },
    "relationships": {
      "reviewable": {
        "data": { "type": "publishers", "id": "3" }
      }
    }
  }
}' http://localhost:3000/api/reviews
```

### Querying Reviews with Includes

You can query reviews and include the polymorphic parent:

```javascript
// Get all reviews with their reviewable resources
const reviewsWithParents = await api.resources.reviews.query({
  queryParams: {
    include: ['reviewable']
  }
});
```

**CURL Example:**

```bash
curl -X GET "http://localhost:3000/api/reviews?include=reviewable"
```

This will return reviews with their parent resources (books, authors, or publishers) included in the response.

### Querying Parents with Their Reviews

You can also query from the parent side:

**Note**: To include related data, you need to explicitly request it with the `include` parameter:

```javascript
// Get a book with all its reviews
const bookWithReviews = await api.resources.books.get({
  id: '1',
  queryParams: {
    include: ['reviews']
  }
});

// Get all authors with their reviews
const authorsWithReviews = await api.resources.authors.query({
  queryParams: {
    include: ['reviews']
  }
});
```

**CURL Examples:**

```bash
# Get a specific book with its reviews
curl -X GET "http://localhost:3000/api/books/1?include=reviews"

# Get all publishers with their reviews
curl -X GET "http://localhost:3000/api/publishers?include=reviews"
```

## Advanced Polymorphic Features

### Filtering by Parent Type

You can filter reviews by their parent type:

```javascript
// Get only book reviews
const bookReviews = await api.resources.reviews.query({
  queryParams: {
    filter: {
      reviewable_type: 'books'
    }
  }
});
```

**CURL Example:**

```bash
curl -X GET "http://localhost:3000/api/reviews?filter[reviewable_type]=books"
```

### Polymorphic Search Schemas

You can create search schemas that work across polymorphic relationships:

```javascript
await api.addResource('reviews', {
  schema: {
    // ... schema definition ...
  },
  searchSchema: {
    // Search by the title of the reviewed item
    reviewableTitle: {
      type: 'string',
      filterUsing: 'like',
      polymorphicField: 'reviewable',
      targetFields: {
        books: 'title',
        authors: 'name',
        publishers: 'name'
      }
    }
  }
});
```

This allows you to search reviews by the title/name of what was reviewed:

```javascript
// Find all reviews for items with "JavaScript" in their title/name
const results = await api.resources.reviews.query({
  queryParams: {
    filter: {
      reviewableTitle: 'JavaScript'
    }
  }
});
```

## Best Practices

1. **Consistent Naming**: Use clear, consistent names for polymorphic fields (e.g., `commentable`, `taggable`, `reviewable`)

2. **Type Validation**: The system automatically validates that the parent type is one of the allowed types

3. **Database Indexes**: Consider adding indexes on the type and ID fields for better query performance:
   ```javascript
   // In your database migration
   table.index(['reviewable_type', 'reviewable_id']);
   ```

4. **Simplified Mode**: Polymorphic relationships work seamlessly in simplified mode:
   ```javascript
   // Creating a review in simplified mode
   const review = await api.resources.reviews.post({
     review_author: 'John Doe',
     review_text: 'Great book!',
     review_rating: 5,
     reviewable_type: 'books',
     reviewable_id: 1
   });
   ```

5. **Side-loading Configuration**: 
   - All relationships must be explicitly requested via the `?include=` parameter
   - Both polymorphic and regular relationships work the same way
   - Example with side-loading:
     ```javascript
     // To include reviews when fetching a book:
     const book = await api.resources.books.get({ 
       id: '1',
       queryParams: { include: ['reviews'] }
     });
     // Without ?include=reviews, only the book data is returned
     ```

## Common Use Cases

Polymorphic relationships are perfect for:
- **Comments**: Comments on posts, videos, photos
- **Tags**: Tagging multiple resource types
- **Attachments**: Files attached to various entities
- **Likes/Reactions**: Users liking different types of content
- **Audit Logs**: Tracking changes across multiple models
- **Notifications**: Notifications about different resource types

## Controlling Query and Include Limits

When working with relationships (especially polymorphic ones that can have many related items), it's important to control how much data is returned. The REST API plugin provides several configuration options for this.

### Query Default and Maximum Limits

You can configure default and maximum limits for queries at the plugin level:

```javascript
await api.use(RestApiPlugin, {
  queryDefaultLimit: 20,      // Default number of records per query
  queryMaxLimit: 100,         // Maximum allowed limit
  // ... other options
});
```

These settings affect:
- **Main queries**: When fetching collections without specifying a page size
- **Relationship includes**: When including related resources without specifying limits

### Limiting Relationship Includes

When including related resources, you often want to limit how many are returned per parent. For example, when fetching books with reviews, you might only want the latest 5 reviews per book:

```javascript
// Configure at resource definition
await api.addResource('books', {
  schema: {
    // ... schema fields ...
  },
  relationships: {
    reviews: { 
      hasMany: 'reviews', 
      via: 'reviewable',
      include: {
        limit: 5,              // Only include 5 reviews per book
        orderBy: ['-id'],      // Order by newest first
        strategy: 'window'     // Use window functions for per-parent limits
      }
    }
  }
});
```

### Include Configuration Options

The `include` configuration supports:

- **`limit`**: Maximum number of related records to include per parent
- **`orderBy`**: Array of fields to sort by (prefix with `-` for descending)
- **`strategy`**: Either `'window'` (per-parent limits) or `'standard'` (global limit)

#### Window Strategy (Per-Parent Limits)

With `strategy: 'window'`, each parent gets its own limit:

```javascript
// Fetch authors with their latest 3 books each
await api.resources.authors.query({
  queryParams: {
    include: ['books']
  }
});
// Result: Each author has up to 3 books included
```

#### Standard Strategy (Global Limit)

With `strategy: 'standard'` or no strategy specified, the limit applies globally:

```javascript
// Without window strategy, limit applies to all included records
relationships: {
  reviews: { 
    hasMany: 'reviews', 
    via: 'reviewable',
    include: {
      limit: 10  // Total of 10 reviews across all parents
    }
  }
}
```

### Database Support for Window Functions

The window strategy requires database support for window functions:
- **PostgreSQL**: 8.4+
- **MySQL**: 8.0+
- **MariaDB**: 10.2+
- **SQLite**: 3.25+
- **SQL Server**: 2005+

If your database doesn't support window functions, the system will automatically fall back to the standard strategy.

### Dynamic Include Limits

You can also control limits when making queries:

```javascript
// Override the default include configuration
const booksWithManyReviews = await api.resources.books.query({
  queryParams: {
    include: ['reviews'],
    // Note: Dynamic include limits in query params are not yet supported
    // Use the relationship definition to set limits
  }
});
```

### Best Practices for Limits

1. **Set Reasonable Defaults**: Configure `queryDefaultLimit` to balance performance and usability
   ```javascript
   queryDefaultLimit: 20,   // Good for most APIs
   queryMaxLimit: 100      // Prevent excessive data fetching
   ```

2. **Use Window Strategy for One-to-Many**: When each parent needs its own set of related records
   ```javascript
   include: {
     limit: 10,
     strategy: 'window',
     orderBy: ['-created_at']  // Most recent first
   }
   ```

3. **Consider Performance**: Smaller limits = faster queries and less memory usage

4. **Document Your Limits**: Let API consumers know about default and maximum limits

### Example: Reviews with Controlled Limits

Here's a complete example showing how to set up reviews with proper limits:

```javascript
// Configure the API with sensible defaults
await api.use(RestApiPlugin, {
  queryDefaultLimit: 20,
  queryMaxLimit: 100
});

// Define books with limited review includes
await api.addResource('books', {
  schema: {
    // ... book fields ...
  },
  relationships: {
    reviews: { 
      hasMany: 'reviews', 
      via: 'reviewable',
      // Use include parameter to control what's loaded
      include: {
        limit: 5,           // Show 5 reviews per book
        orderBy: ['-review_rating', '-id'],  // Best rated first
        strategy: 'window'  // Each book gets 5 reviews
      }
    }
  }
});

// Query books with their top reviews
const booksWithTopReviews = await api.resources.books.query({
  queryParams: {
    include: ['reviews']  // Each book includes up to 5 best reviews
  }
});
```

## Summary

Polymorphic relationships provide a powerful way to create flexible, reusable associations in your API. By understanding how to define and use them, you can build more maintainable and scalable applications without duplicating tables and logic for similar relationships.

Remember:
- Define the polymorphic field in the schema with `belongsToPolymorphic`
- Add reverse relationships with `via` pointing to the polymorphic field
- Use standard JSON:API relationship syntax for creating and querying
- Take advantage of includes to fetch related data efficiently
- Configure appropriate query and include limits for performance
- Use window strategies for per-parent relationship limits when needed