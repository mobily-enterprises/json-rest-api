# 2.7 Pagination and ordering

Pagination and ordering are essential features for working with large datasets. The json-rest-api library provides powerful pagination that applies not just to main resources, but also to included relationships. This means you can limit and order both parent records AND their children independently.

Let's create a comprehensive example with posts, comments, and tags to demonstrate all pagination and ordering features:

```javascript
await api.addResource('posts', {
  schema: {
    title: { type: 'string', required: true, max: 255, search: true, filterOperator: 'like', indexed: true },
    content: { type: 'string', required: true },
    view_count: { type: 'number', default: 0, indexed: true },
    published_at: { type: 'dateTime', indexed: true },
    created_at: { type: 'dateTime', defaultTo: Date.now, indexed: true }
  },
  relationships: {
    comments: { 
      hasMany: 'comments', 
      foreignKey: 'post_id',
      include: {
        limit: 5,  // Default limit for included comments
        orderBy: ['-created_at']  // Newest comments first
      }
    },
    tags: {
      hasMany: 'tags',
      through: 'post_tags',
      foreignKey: 'post_id',
      otherKey: 'tag_id',
      include: {
        limit: 10,
        orderBy: ['name']  // Alphabetical order
      }
    }
  },
  // Define which fields can be sorted in queries
  sortableFields: ['title', 'view_count', 'published_at', 'created_at'],
  // Default sort uses the same format as query sort parameters:
  // - String format: '-created_at' (- prefix for DESC)
  // - Array format: ['-created_at', 'title'] for multiple sorts
  defaultSort: '-created_at',  // Newest first by default
  
  // Set pagination limits for this resource
  queryDefaultLimit: 10,  // Default page size
  queryMaxLimit: 50      // Maximum allowed page size
});
await api.resources.posts.createKnexTable();

// Define comments resource
await api.addResource('comments', {
  schema: {
    content: { type: 'string', required: true },
    author_name: { type: 'string', required: true, max: 100 },
    created_at: { type: 'dateTime', defaultTo: Date.now, indexed: true },
    likes: { type: 'number', default: 0, indexed: true },
    post_id: { type: 'id', belongsTo: 'posts', as: 'post', required: true }
  },
  sortableFields: ['created_at', 'likes'],
  queryDefaultLimit: 20,
  queryMaxLimit: 100
});
await api.resources.comments.createKnexTable();

// Define tags resource
await api.addResource('tags', {
  schema: {
    name: { type: 'string', required: true, max: 50, unique: true, indexed: true },
    usage_count: { type: 'number', default: 0, indexed: true }
  },
  relationships: {
    posts: {
      hasMany: 'posts',
      through: 'post_tags',
      foreignKey: 'tag_id',
      otherKey: 'post_id'
    }
  },
  sortableFields: ['name', 'usage_count'],
  queryDefaultLimit: 30
});
await api.resources.tags.createKnexTable();

// Define pivot table
await api.addResource('post_tags', {
  schema: {
    post_id: { type: 'id', belongsTo: 'posts', as: 'post', required: true },
    tag_id: { type: 'id', belongsTo: 'tags', as: 'tag', required: true }
  }
});
await api.resources.post_tags.createKnexTable();

```

**Basic Pagination**

The API supports two types of pagination:

1. **Offset-based pagination** using `page[number]` and `page[size]` parameters
2. **Cursor-based pagination** using `page[after]` and `page[before]` parameters

**How the API chooses pagination mode:**

The API automatically selects the pagination mode based on your query parameters:
- When you specify a page number (`page[number]=2`), you get traditional offset pagination with page counts and totals
- When you only specify a page size (`page[size]=10`) without a page number, the API switches to cursor pagination for better performance
- When you use cursor parameters (`page[after]` or `page[before]`), you explicitly request cursor pagination

This design encourages the use of cursor pagination (which is more efficient for large datasets) while still supporting traditional page numbers when needed.

**Offset-based Pagination:**

```javascript
// Get first page with default size (10 posts)
const page1 = await api.resources.posts.query({
  queryParams: { 
    page: { number: 1, size: 5 }
  }
});
// HTTP: GET /api/posts?page[number]=1
// Returns: {
//   data: [ /* 10 posts */ ],
//   meta: {
//     pagination: {
//       page: 1,
//       pageSize: 5,
//       pageCount: 3,
//       total: 25
//     }
//   }
// }

// Get second page with custom size
const page2 = await api.resources.posts.query({
  queryParams: { 
    page: { number: 2, size: 5 }
  }
});
// HTTP: GET /api/posts?page[number]=2&page[size]=5
// Returns: {
//   data: [ /* 5 posts (posts 6-10) */ ],
//   meta: {
//     pagination: {
//       page: 2,
//       pageSize: 5,
//       pageCount: 5,
//       total: 25
//     }
//   }
// }

// Get a large page (but limited by queryMaxLimit)
const largePage = await api.resources.posts.query({
  queryParams: { 
    page: { number: 1, size: 100 }  // Will be capped at 50 (queryMaxLimit)
  }
});
// HTTP: GET /api/posts?page[number]=1&page[size]=100
// Returns: {
//   data: [ /* All 25 posts */ ],
//   meta: {
//     pagination: {
//       page: 1,
//       pageSize: 50,  // Capped at queryMaxLimit
//       pageCount: 1,
//       total: 25
//     }
//   }
// }

console.log('Page 1 posts:', page1.data.length);
console.log('Page 1 post data:', page1.data);
console.log('Page 2 posts:', page2.data.length);
console.log('Page 2 post data:', page2.data);
console.log('Large page posts:', largePage.data.length);
console.log('Page 1 metadata:', page1.meta);
```

**Expected Output**

```text
Page 1 posts: 5
Page 1 post data: [
  {
    id: '25',
    title: 'Post 25: Odd Number Post',
    content: "This is the content of post number 25. It's a odd numbered post.",
    view_count: 823,
    published_at: 2025-07-28T03:57:39.711Z,
    created_at: 2025-07-28T03:57:39.712Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  },
  {
    id: '24',
    title: 'Post 24: Even Number Post',
    content: "This is the content of post number 24. It's a even numbered post.",
    view_count: 765,
    published_at: 2025-07-27T03:57:39.707Z,
    created_at: 2025-07-28T03:57:39.708Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  },
  {
    id: '23',
    title: 'Post 23: Odd Number Post',
    content: "This is the content of post number 23. It's a odd numbered post.",
    view_count: 196,
    published_at: 2025-07-26T03:57:39.705Z,
    created_at: 2025-07-28T03:57:39.706Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '22',
    title: 'Post 22: Even Number Post',
    content: "This is the content of post number 22. It's a even numbered post.",
    view_count: 987,
    published_at: 2025-07-25T03:57:39.703Z,
    created_at: 2025-07-28T03:57:39.703Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '21',
    title: 'Post 21: Odd Number Post',
    content: "This is the content of post number 21. It's a odd numbered post.",
    view_count: 28,
    published_at: 2025-07-24T03:57:39.701Z,
    created_at: 2025-07-28T03:57:39.701Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  }
]
Page 2 posts: 5
Page 2 post data: [
  {
    id: '20',
    title: 'Post 20: Even Number Post',
    content: "This is the content of post number 20. It's a even numbered post.",
    view_count: 626,
    published_at: 2025-07-23T03:57:39.699Z,
    created_at: 2025-07-28T03:57:39.699Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '19',
    title: 'Post 19: Odd Number Post',
    content: "This is the content of post number 19. It's a odd numbered post.",
    view_count: 487,
    published_at: 2025-07-22T03:57:39.696Z,
    created_at: 2025-07-28T03:57:39.697Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4' ]
  },
  {
    id: '18',
    title: 'Post 18: Even Number Post',
    content: "This is the content of post number 18. It's a even numbered post.",
    view_count: 685,
    published_at: 2025-07-21T03:57:39.694Z,
    created_at: 2025-07-28T03:57:39.695Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '17',
    title: 'Post 17: Odd Number Post',
    content: "This is the content of post number 17. It's a odd numbered post.",
    view_count: 402,
    published_at: 2025-07-20T03:57:39.690Z,
    created_at: 2025-07-28T03:57:39.691Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  },
  {
    id: '16',
    title: 'Post 16: Even Number Post',
    content: "This is the content of post number 16. It's a even numbered post.",
    view_count: 705,
    published_at: 2025-07-19T03:57:39.685Z,
    created_at: 2025-07-28T03:57:39.686Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  }
]
Large page posts: 25
Page 1 metadata: {
  pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25, hasMore: true }
}
```

**Cursor-based Pagination:**

Cursor-based pagination is ideal for real-time data or when users are scrolling through results. It provides stable pagination even when new records are added:

```javascript
// Get first page of posts (newest first)
const firstPage = await api.resources.posts.query({
  queryParams: {
    page: { size: 5 },  // Using size without number triggers cursor pagination
    sort: ['-created_at']
  }
});
// Returns: {
//   data: [ /* 5 posts */ ],
//   meta: {
//     pagination: {
//       pageSize: 5,
//       hasMore: true,
//       cursor: { next: 'created_at:2024-07-25T10%3A30%3A00.000Z' }
//     }
//   }
// }

// Get next page using the cursor from meta
const nextPage = await api.resources.posts.query({
  queryParams: {
    page: { 
      size: 5,
      after: firstPage.meta.pagination.cursor.next 
    },
    sort: ['-created_at']
  }
});

// Get second page using the cursor from first page
const secondPage = await api.resources.posts.query({
  queryParams: {
    page: { 
      size: 5,
      after: firstPage.meta.pagination.cursor?.next 
    },
    sort: ['-created_at']
  }
});

// For backward pagination (less common), use the 'prev' cursor
// Note: This requires the implementation to provide prev cursors
if (secondPage.meta.pagination.cursor?.prev) {
  const backToFirstPage = await api.resources.posts.query({
    queryParams: {
      page: { 
        size: 5,
        before: secondPage.meta.pagination.cursor.prev 
      },
      sort: ['-created_at']
    }
  });
}

console.log('First page:', inspect(firstPage));
console.log('\nSecond page:', inspect(secondPage));
```

**Expected output**

```
First page: {
  data: [
    {
      id: '25',
      title: 'Post 25: Odd Number Post',
      content: "This is the content of post number 25. It's a odd numbered post.",
      view_count: 142,
      published_at: 2025-07-28T04:06:39.821Z,
      created_at: 2025-07-28T04:06:39.821Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 497,
      published_at: 2025-07-27T04:06:39.818Z,
      created_at: 2025-07-28T04:06:39.818Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '23',
      title: 'Post 23: Odd Number Post',
      content: "This is the content of post number 23. It's a odd numbered post.",
      view_count: 167,
      published_at: 2025-07-26T04:06:39.815Z,
      created_at: 2025-07-28T04:06:39.816Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '22',
      title: 'Post 22: Even Number Post',
      content: "This is the content of post number 22. It's a even numbered post.",
      view_count: 738,
      published_at: 2025-07-25T04:06:39.813Z,
      created_at: 2025-07-28T04:06:39.813Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '21',
      title: 'Post 21: Odd Number Post',
      content: "This is the content of post number 21. It's a odd numbered post.",
      view_count: 41,
      published_at: 2025-07-24T04:06:39.810Z,
      created_at: 2025-07-28T04:06:39.811Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'created_at:1753675599811' }
    }
  },
  links: {
    self: '/api/1.0/posts?sort=-created_at&&&page[size]=5',
    first: '/api/1.0/posts?sort=-created_at&&&page[size]=5',
    next: '/api/1.0/posts?sort=-created_at&&&page[size]=5&page[after]=created_at:1753675599811'
  }
}

Second page: {
  data: [
    {
      id: '20',
      title: 'Post 20: Even Number Post',
      content: "This is the content of post number 20. It's a even numbered post.",
      view_count: 149,
      published_at: 2025-07-23T04:06:39.808Z,
      created_at: 2025-07-28T04:06:39.809Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '19',
      title: 'Post 19: Odd Number Post',
      content: "This is the content of post number 19. It's a odd numbered post.",
      view_count: 562,
      published_at: 2025-07-22T04:06:39.805Z,
      created_at: 2025-07-28T04:06:39.806Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '18',
      title: 'Post 18: Even Number Post',
      content: "This is the content of post number 18. It's a even numbered post.",
      view_count: 146,
      published_at: 2025-07-21T04:06:39.803Z,
      created_at: 2025-07-28T04:06:39.803Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '17',
      title: 'Post 17: Odd Number Post',
      content: "This is the content of post number 17. It's a odd numbered post.",
      view_count: 689,
      published_at: 2025-07-20T04:06:39.798Z,
      created_at: 2025-07-28T04:06:39.799Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '16',
      title: 'Post 16: Even Number Post',
      content: "This is the content of post number 16. It's a even numbered post.",
      view_count: 215,
      published_at: 2025-07-19T04:06:39.796Z,
      created_at: 2025-07-28T04:06:39.797Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'created_at:1753675599797' }
    }
  },
  links: {
    self: '/api/1.0/posts?sort=-created_at&&&page[size]=5&page[after]=created_at:1753675599811',
    first: '/api/1.0/posts?sort=-created_at&&&page[size]=5',
    next: '/api/1.0/posts?sort=-created_at&&&page[size]=5&page[after]=created_at:1753675599797'
  }
}
```

When sorting happens 

```javascript
// Multi-field cursor pagination example
const multiFieldPage = await api.resources.posts.query({
  queryParams: {
    page: { size: 5 },
    sort: ['view_count', '-created_at']  // Sort by view_count first, then by created_at DESC
  }
});

// The cursor will contain both fields: "view_count:142,created_at:2024-07-25T10%3A30%3A00.000Z"
// This ensures no records are skipped even if many posts have the same view_count
const nextMultiFieldPage = await api.resources.posts.query({
  queryParams: {
    page: { 
      size: 5,
      after: multiFieldPage.meta.pagination.cursor.next 
    },
    sort: ['view_count', '-created_at']
  }
});

console.log('First multiField page:', inspect(multiFieldPage));
console.log('Next multiField page:', inspect(nextMultiFieldPage));
```

**Expected output**:

```text
First multiField page: {
  data: [
    {
      id: '4',
      title: 'Post 4: Even Number Post',
      content: "This is the content of post number 4. It's a even numbered post.",
      view_count: 19,
      published_at: 2025-07-07T04:16:32.004Z,
      created_at: 2025-07-28T04:16:32.005Z,
      comments_ids: [
        '30', '31', '32',
        '33', '34', '35',
        '36', '37', '38',
        '39'
      ],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '13',
      title: 'Post 13: Odd Number Post',
      content: "This is the content of post number 13. It's a odd numbered post.",
      view_count: 25,
      published_at: 2025-07-16T04:16:32.041Z,
      created_at: 2025-07-28T04:16:32.042Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '19',
      title: 'Post 19: Odd Number Post',
      content: "This is the content of post number 19. It's a odd numbered post.",
      view_count: 28,
      published_at: 2025-07-22T04:16:32.066Z,
      created_at: 2025-07-28T04:16:32.066Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '7',
      title: 'Post 7: Odd Number Post',
      content: "This is the content of post number 7. It's a odd numbered post.",
      view_count: 41,
      published_at: 2025-07-10T04:16:32.018Z,
      created_at: 2025-07-28T04:16:32.019Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '20',
      title: 'Post 20: Even Number Post',
      content: "This is the content of post number 20. It's a even numbered post.",
      view_count: 74,
      published_at: 2025-07-23T04:16:32.069Z,
      created_at: 2025-07-28T04:16:32.069Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'view_count:74,created_at:1753676192069' }
    }
  },
  links: {
    self: '/api/1.0/posts?sort=view_count&sort=-created_at&&&page[size]=5',
    first: '/api/1.0/posts?sort=view_count&sort=-created_at&&&page[size]=5',
    next: '/api/1.0/posts?sort=view_count&sort=-created_at&&&page[size]=5&page[after]=view_count:74,created_at:1753676192069'
  }
}
Next multiField page: {
  data: [
    {
      id: '6',
      title: 'Post 6: Even Number Post',
      content: "This is the content of post number 6. It's a even numbered post.",
      view_count: 148,
      published_at: 2025-07-09T04:16:32.011Z,
      created_at: 2025-07-28T04:16:32.012Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '22',
      title: 'Post 22: Even Number Post',
      content: "This is the content of post number 22. It's a even numbered post.",
      view_count: 161,
      published_at: 2025-07-25T04:16:32.073Z,
      created_at: 2025-07-28T04:16:32.074Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '5',
      title: 'Post 5: Odd Number Post',
      content: "This is the content of post number 5. It's a odd numbered post.",
      view_count: 235,
      published_at: 2025-07-08T04:16:32.007Z,
      created_at: 2025-07-28T04:16:32.008Z,
      comments_ids: [
        '40', '41', '42',
        '43', '44', '45',
        '46', '47', '48',
        '49', '50', '51'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '9',
      title: 'Post 9: Odd Number Post',
      content: "This is the content of post number 9. It's a odd numbered post.",
      view_count: 249,
      published_at: 2025-07-12T04:16:32.024Z,
      created_at: 2025-07-28T04:16:32.026Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '17',
      title: 'Post 17: Odd Number Post',
      content: "This is the content of post number 17. It's a odd numbered post.",
      view_count: 290,
      published_at: 2025-07-20T04:16:32.055Z,
      created_at: 2025-07-28T04:16:32.056Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'view_count:290,created_at:1753676192056' }
    }
  },
  links: {
    self: '/api/1.0/posts?sort=view_count&sort=-created_at&&&page[size]=5&page[after]=view_count:74,created_at:1753676192069',
    first: '/api/1.0/posts?sort=view_count&sort=-created_at&&&page[size]=5',
    next: '/api/1.0/posts?sort=view_count&sort=-created_at&&&page[size]=5&page[after]=view_count:290,created_at:1753676192056'
  }
}
```


**Cursor Pagination Notes:**
- Cursors are simple strings containing the sort field values (format: `field:value,field2:value2`)
- The API automatically generates appropriate WHERE clauses based on sort direction
- Cursor pagination is more efficient for large datasets as it doesn't need to count all records
- Works seamlessly with any sort field, not just timestamps
- **Multi-field sorting is fully supported** - When sorting by multiple fields (e.g., `sort: ['category', 'name']`), the cursor includes all sort fields and correctly handles records with duplicate values in the first sort field

**Pagination with Sorting**

You can combine pagination with sorting. The sort order is maintained across pages:

```javascript
// Get posts sorted by view count (highest first)
const popularPosts = await api.resources.posts.query({
  queryParams: {
    sort: ['-view_count'],  // Minus prefix means descending
    page: { number: 1, size: 5 }
  }
});
// HTTP: GET /api/posts?sort=-view_count&page[number]=1&page[size]=5
// Returns: {
//   data: [
//     { id: '5', title: 'Post 5', view_count: 950, ... },
//     { id: '15', title: 'Post 15', view_count: 850, ... },
//     { id: '20', title: 'Post 20', view_count: 750, ... },
//     { id: '10', title: 'Post 10', view_count: 650, ... },
//     { id: '25', title: 'Post 25', view_count: 550, ... }
//   ],
//   meta: { pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25 } }
// }

// Get posts sorted by multiple fields
const multiSort = await api.resources.posts.query({
  queryParams: {
    sort: ['published_at', '-view_count'],  // Oldest first, then by views
    page: { number: 1, size: 5 }
  }
});
// HTTP: GET /api/posts?sort=published_at,-view_count&page[number]=1&page[size]=5
// Returns: {
//   data: [
//     { id: '1', title: 'Post 1', published_at: '2024-01-01T00:00:00Z', view_count: 100, ... },
//     { id: '2', title: 'Post 2', published_at: '2024-01-02T00:00:00Z', view_count: 200, ... },
//     // ... posts sorted first by date, then by views within same date
//   ],
//   meta: { pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25 } }
// }

console.log('Popular sort:', inspect(popularPosts));
console.log('Multisort:', inspect(multiSort));
```

**Expected output**:

```text
Popular sort: {
  data: [
    {
      id: '6',
      title: 'Post 6: Even Number Post',
      content: "This is the content of post number 6. It's a even numbered post.",
      view_count: 910,
      published_at: 2025-07-09T04:21:13.403Z,
      created_at: 2025-07-28T04:21:13.404Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 871,
      published_at: 2025-07-27T04:21:13.454Z,
      created_at: 2025-07-28T04:21:13.454Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '18',
      title: 'Post 18: Even Number Post',
      content: "This is the content of post number 18. It's a even numbered post.",
      view_count: 870,
      published_at: 2025-07-21T04:21:13.437Z,
      created_at: 2025-07-28T04:21:13.438Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '8',
      title: 'Post 8: Even Number Post',
      content: "This is the content of post number 8. It's a even numbered post.",
      view_count: 848,
      published_at: 2025-07-11T04:21:13.410Z,
      created_at: 2025-07-28T04:21:13.410Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '22',
      title: 'Post 22: Even Number Post',
      content: "This is the content of post number 22. It's a even numbered post.",
      view_count: 838,
      published_at: 2025-07-25T04:21:13.449Z,
      created_at: 2025-07-28T04:21:13.450Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25, hasMore: true }
  },
  links: {
    self: '/api/1.0/posts?sort=-view_count&&&page[number]=1&page[size]=5',
    first: '/api/1.0/posts?sort=-view_count&&&page[number]=1&page[size]=5',
    last: '/api/1.0/posts?sort=-view_count&&&page[number]=5&page[size]=5',
    next: '/api/1.0/posts?sort=-view_count&&&page[number]=2&page[size]=5'
  }
}
Multisort: {
  data: [
    {
      id: '1',
      title: 'Post 1: Odd Number Post',
      content: "This is the content of post number 1. It's a odd numbered post.",
      view_count: 468,
      published_at: 2025-07-04T04:21:13.385Z,
      created_at: 2025-07-28T04:21:13.386Z,
      comments_ids: [
        '1', '2',  '3',  '4',
        '5', '6',  '7',  '8',
        '9', '10', '11', '12'
      ],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '2',
      title: 'Post 2: Even Number Post',
      content: "This is the content of post number 2. It's a even numbered post.",
      view_count: 652,
      published_at: 2025-07-05T04:21:13.389Z,
      created_at: 2025-07-28T04:21:13.390Z,
      comments_ids: [
        '13', '14', '15',
        '16', '17', '18',
        '19', '20', '21',
        '22', '23', '24'
      ],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '3',
      title: 'Post 3: Odd Number Post',
      content: "This is the content of post number 3. It's a odd numbered post.",
      view_count: 198,
      published_at: 2025-07-06T04:21:13.393Z,
      created_at: 2025-07-28T04:21:13.394Z,
      comments_ids: [
        '25', '26', '27',
        '28', '29', '30',
        '31', '32', '33',
        '34', '35', '36'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '4',
      title: 'Post 4: Even Number Post',
      content: "This is the content of post number 4. It's a even numbered post.",
      view_count: 606,
      published_at: 2025-07-07T04:21:13.396Z,
      created_at: 2025-07-28T04:21:13.397Z,
      comments_ids: [
        '37', '38', '39',
        '40', '41', '42',
        '43', '44', '45',
        '46'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '5',
      title: 'Post 5: Odd Number Post',
      content: "This is the content of post number 5. It's a odd numbered post.",
      view_count: 142,
      published_at: 2025-07-08T04:21:13.400Z,
      created_at: 2025-07-28T04:21:13.401Z,
      comments_ids: [
        '47', '48', '49',
        '50', '51', '52',
        '53', '54', '55',
        '56'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25, hasMore: true }
  },
  links: {
    self: '/api/1.0/posts?sort=published_at&sort=-view_count&&&page[number]=1&page[size]=5',
    first: '/api/1.0/posts?sort=published_at&sort=-view_count&&&page[number]=1&page[size]=5',
    last: '/api/1.0/posts?sort=published_at&sort=-view_count&&&page[number]=5&page[size]=5',
    next: '/api/1.0/posts?sort=published_at&sort=-view_count&&&page[number]=2&page[size]=5'
  }
}
```

**Limits and Ordering for Included Relationships**

When you include relationships in your query, they use the default `limit` and `orderBy` values defined in the relationship schema. These defaults are applied automatically and cannot be overridden in the query:

```javascript
// The relationship was defined with default limits:
// relationships: {
//   comments: { 
//     hasMany: 'comments',
//     include: {
//       limit: 5,              // Always return max 5 comments
//       orderBy: ['-created_at'] // Always order by newest first
//     }
//   }
// }

// When you include comments, these defaults are automatically applied:
const postsWithComments = await api.resources.posts.query({
  queryParams: {
    include: ['comments'],     // Just specify which relationships to include
    page: { number: 1, size: 3 }  // This controls posts pagination only
  }
});
// HTTP: GET /api/posts?include=comments&page[number]=1&page[size]=3
// Returns: {
//   data: [
//     { id: '1', title: 'Post 1', ..., 
//       comments: [ /* Up to 5 comments, ordered by newest first */ ]
//     },
//     { id: '2', title: 'Post 2', ..., 
//       comments: [ /* Up to 5 comments, newest first */ ]
//     },
//     { id: '3', title: 'Post 3', ..., 
//       comments: [ /* Up to 5 comments, newest first */ ]
//     }
//   ],
//   meta: { pagination: { page: 1, pageSize: 3, pageCount: 9, total: 25 } }
// }

// Display the results
console.log('Posts with comments:', inspect(postsWithComments));

// Get posts with both comments and tags, using their configured limits
const postsWithAll = await api.resources.posts.query({
  queryParams: {
    include: ['comments', 'tags'],
    page: { number: 1, size: 2 }
  }
});

console.log('\nPosts with all relationships:', inspect(postsWithAll));
```

**Expected Output**

```text
Posts with comments: {
  data: [
    {
      id: '25',
      title: 'Post 25: Odd Number Post',
      content: "This is the content of post number 25. It's a odd numbered post.",
      view_count: 483,
      published_at: 2025-07-28T04:50:14.529Z,
      created_at: 2025-07-28T04:50:14.530Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 719,
      published_at: 2025-07-27T04:50:14.526Z,
      created_at: 2025-07-28T04:50:14.527Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '23',
      title: 'Post 23: Odd Number Post',
      content: "This is the content of post number 23. It's a odd numbered post.",
      view_count: 167,
      published_at: 2025-07-26T04:50:14.523Z,
      created_at: 2025-07-28T04:50:14.524Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 3, pageCount: 9, total: 25, hasMore: true }
  },
  links: {
    self: '/api/1.0/posts?include=comments&&sort=-created_at&page[number]=1&page[size]=3',
    first: '/api/1.0/posts?include=comments&&sort=-created_at&page[number]=1&page[size]=3',
    last: '/api/1.0/posts?include=comments&&sort=-created_at&page[number]=9&page[size]=3',
    next: '/api/1.0/posts?include=comments&&sort=-created_at&page[number]=2&page[size]=3'
  }
}

Posts with all relationships: {
  data: [
    {
      id: '25',
      title: 'Post 25: Odd Number Post',
      content: "This is the content of post number 25. It's a odd numbered post.",
      view_count: 483,
      published_at: 2025-07-28T04:50:14.529Z,
      created_at: 2025-07-28T04:50:14.530Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 74, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 36, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 59, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 63, posts_ids: [] }
      ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 719,
      published_at: 2025-07-27T04:50:14.526Z,
      created_at: 2025-07-28T04:50:14.527Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 74, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 36, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 59, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 63, posts_ids: [] }
      ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 2, pageCount: 13, total: 25, hasMore: true }
  },
  links: {
    self: '/api/1.0/posts?include=comments&include=tags&&sort=-created_at&page[number]=1&page[size]=2',
    first: '/api/1.0/posts?include=comments&include=tags&&sort=-created_at&page[number]=1&page[size]=2',
    last: '/api/1.0/posts?include=comments&include=tags&&sort=-created_at&page[number]=13&page[size]=2',
    next: '/api/1.0/posts?include=comments&include=tags&&sort=-created_at&page[number]=2&page[size]=2'
  }
}
```

**Pagination Links**

The API automatically generates pagination links following JSON:API specification:

```javascript
// Get a page with full pagination info
const pagedResult = await api.resources.posts.query({
  queryParams: {
    page: { number: 2, size: 5 },
    sort: ['-published_at']
  },
  simplified: false  // Use JSON:API format to see links
});
// HTTP: GET /api/posts?page[number]=2&page[size]=5&sort=-published_at
// Returns (JSON:API): {
//   data: [ /* 5 posts */ ],
//   links: {
//     first: '/api/posts?page[number]=1&page[size]=5&sort=-published_at',
//     prev: '/api/posts?page[number]=1&page[size]=5&sort=-published_at',
//     next: '/api/posts?page[number]=3&page[size]=5&sort=-published_at',
//     last: '/api/posts?page[number]=5&page[size]=5&sort=-published_at'
//   },
//   meta: {
//     pagination: {
//       page: 2,
//       pageSize: 5,
//       pageCount: 5,
//       total: 25
//     }
//   }
// }

console.log('Pagination links:', JSON.stringify(pagedResult.links, null, 2));
console.log('Pagination meta:', JSON.stringify(pagedResult.meta, null, 2));
```

**Expected Output**

```text
Pagination links: {
  "self": "/api/1.0/posts?sort=-published_at&&&page[number]=2&page[size]=5",
  "first": "/api/1.0/posts?sort=-published_at&&&page[number]=1&page[size]=5",
  "last": "/api/1.0/posts?sort=-published_at&&&page[number]=5&page[size]=5",
  "prev": "/api/1.0/posts?sort=-published_at&&&page[number]=1&page[size]=5",
  "next": "/api/1.0/posts?sort=-published_at&&&page[number]=3&page[size]=5"
}
Pagination meta: {
  "pagination": {
    "page": 2,
    "pageSize": 5,
    "pageCount": 5,
    "total": 25,
    "hasMore": true
  }
}
```

**Combining Everything: Filters, Sorting, Pagination, and Includes**

```javascript
// Complex query combining all features
const complexQuery = await api.resources.posts.query({
  queryParams: {
    filters: {
      title: 'Even'  // Only posts with "Even" in title
    },
    sort: ['-view_count', 'published_at'],  // Most viewed first, then oldest
    page: { number: 1, size: 3 },
    include: ['comments', 'tags']
  }
});
// HTTP: GET /api/posts?filter[title]=Even&sort=-view_count,published_at&page[number]=1&page[size]=3&include=comments,tags
// Returns: {
//   data: [
//     { id: '20', title: 'Even Post 20', view_count: 750, 
//       comments: [ /* Up to 5 newest */ ],
//       tags: [ /* Up to 10, alphabetical */ ]
//     },
//     { id: '10', title: 'Even Post 10', view_count: 650,
//       comments: [ /* Up to 5 newest */ ],
//       tags: [ /* Up to 10, alphabetical */ ]
//     },
//     { id: '2', title: 'Even Post 2', view_count: 200,
//       comments: [ /* Up to 5 newest */ ],
//       tags: [ /* Up to 10, alphabetical */ ]
//     }
//   ],
//   meta: { 
//     pagination: { 
//       page: 1, 
//       pageSize: 3, 
//       pageCount: 4,  // 12 "Even" posts total
//       total: 12 
//     } 
//   }
// });

console.log('\nComplex query results:', inspect(complexQuery));
```

**Expected results:**

```text
Complex query results: {
  data: [
    {
      id: '14',
      title: 'Post 14: Even Number Post',
      content: "This is the content of post number 14. It's a even numbered post.",
      view_count: 968,
      published_at: 2025-07-17T05:03:41.480Z,
      created_at: 2025-07-28T05:03:41.480Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 43, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 80, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 6, posts_ids: [] }
      ]
    },
    {
      id: '2',
      title: 'Post 2: Even Number Post',
      content: "This is the content of post number 2. It's a even numbered post.",
      view_count: 844,
      published_at: 2025-07-05T05:03:41.439Z,
      created_at: 2025-07-28T05:03:41.440Z,
      comments_ids: [ '19', '18', '17', '16', '15' ],
      comments: [
        {
          id: '19',
          content: 'Comment 10 on post 2',
          author_name: 'User 3',
          created_at: 2025-07-28T05:03:41.542Z,
          likes: 27
        },
        {
          id: '18',
          content: 'Comment 9 on post 2',
          author_name: 'User 2',
          created_at: 2025-07-28T04:03:41.541Z,
          likes: 27
        },
        {
          id: '17',
          content: 'Comment 8 on post 2',
          author_name: 'User 7',
          created_at: 2025-07-28T03:03:41.539Z,
          likes: 31
        },
        {
          id: '16',
          content: 'Comment 7 on post 2',
          author_name: 'User 10',
          created_at: 2025-07-28T02:03:41.538Z,
          likes: 27
        },
        {
          id: '15',
          content: 'Comment 6 on post 2',
          author_name: 'User 9',
          created_at: 2025-07-28T01:03:41.535Z,
          likes: 46
        }
      ],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 43, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 80, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 6, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 92, posts_ids: [] }
      ]
    },
    {
      id: '18',
      title: 'Post 18: Even Number Post',
      content: "This is the content of post number 18. It's a even numbered post.",
      view_count: 623,
      published_at: 2025-07-21T05:03:41.492Z,
      created_at: 2025-07-28T05:03:41.492Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 43, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 80, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 6, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 92, posts_ids: [] }
      ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 3, pageCount: 4, total: 12, hasMore: true }
  },
  links: {
    self: '/api/1.0/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=1&page[size]=3',
    first: '/api/1.0/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=1&page[size]=3',
    last: '/api/1.0/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=4&page[size]=3',
    next: '/api/1.0/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=2&page[size]=3'
  }
}
```

The pagination and ordering system is designed to be efficient and predictable:
- Parent records are paginated and sorted according to the main query
- Child records are independently paginated and sorted according to their relationship configuration
- All limits respect the configured maximums to prevent performance issues
- The system automatically uses SQL window functions for efficient pagination of included records when supported by the database

---

[Previous: 2.6 Many to many (hasMany with through records)](./GUIDE_2_6_Many_To_Many.md) | [Back to Guide](./README.md)