import { Api } from 'hooked-api';
import { RestApiPlugin } from '../index.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

// Example showing the filtering system with searchSchema

// Create a Knex instance (in-memory SQLite for demo)
const db = knex({
  client: 'sqlite3',
  connection: ':memory:',
  useNullAsDefault: true
});

// Create the API
const api = new Api({ name: 'blog-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });

// Define schema with search properties
const articlesSchema = {
  id: { type: 'id' },
  
  title: { 
    type: 'string', 
    required: true,
    search: {
      filterUsing: 'like'  // Will use LIKE for contains search
    }
  },
  
  body: {
    type: 'string',
    required: true,
    search: {
      filterUsing: 'like'
    }
  },
  
  status: {
    type: 'string',
    enum: ['draft', 'published', 'archived'],
    search: true  // Simple equality filter
  },
  
  author_id: {
    type: 'number',
    search: true  // Simple equality filter
  },
  
  published_at: {
    type: 'datetime',
    search: {
      // Generate multiple filters from one field
      published_after: {
        filterUsing: '>='
      },
      published_before: {
        filterUsing: '<='
      }
    }
  },
  
  view_count: {
    type: 'number'
    // No search property = not filterable
  },
  
  tags: {
    type: 'string',
    search: {
      filterUsing: 'like'
    }
  },
  
  // Virtual field for multi-field search
  _virtual: {
    search: {
      fulltext: {
        type: 'string',
        likeOneOf: ['title', 'body', 'tags']
      }
    }
  }
};

// Add resource with schema containing search properties
api.addResource('articles', {
  schema: articlesSchema,
  sortableFields: ['title', 'published_at', 'status', 'view_count']
});

// Setup database
await db.schema.createTable('articles', (table) => {
  table.increments('id');
  table.string('title');
  table.text('body');
  table.string('status');
  table.integer('author_id');
  table.datetime('published_at');
  table.integer('view_count').defaultTo(0);
  table.string('tags');
});

// Insert sample data
await db('articles').insert([
  {
    title: 'Understanding JavaScript',
    body: 'JavaScript is a versatile programming language...',
    status: 'published',
    author_id: 1,
    published_at: '2024-01-15 10:00:00',
    view_count: 1250,
    tags: 'javascript,programming,tutorial'
  },
  {
    title: 'REST API Best Practices',
    body: 'When designing REST APIs, consider these practices...',
    status: 'published',
    author_id: 2,
    published_at: '2024-02-20 14:30:00',
    view_count: 890,
    tags: 'api,rest,backend'
  },
  {
    title: 'Database Design Patterns',
    body: 'Proper database design is crucial for applications...',
    status: 'draft',
    author_id: 1,
    published_at: '2024-03-25 09:15:00',
    view_count: 0,
    tags: 'database,sql,patterns'
  }
]);

console.log('=== Filtering Examples ===\n');

// Example 1: Simple equality filter (auto-generated searchSchema)
console.log('1. Filter by status:');
const publishedArticles = await api.resources.articles.query({
  queryParams: {
    filter: { status: 'published' }
  }
});
console.log(`Found ${publishedArticles.data.length} published articles\n`);

// Example 2: Like/contains filter
console.log('2. Search in title:');
const jsArticles = await api.resources.articles.query({
  queryParams: {
    filter: { title: 'JavaScript' }
  }
});
console.log(`Found ${jsArticles.data.length} articles with "JavaScript" in title\n`);

// Example 3: Multi-field search
console.log('3. Full-text search across multiple fields:');
const fulltextResults = await api.resources.articles.query({
  queryParams: {
    filter: { fulltext: 'API' }
  }
});
console.log(`Found ${fulltextResults.data.length} articles mentioning "API"\n`);

// Example 4: Date range filter
console.log('4. Filter by date range:');
const recentArticles = await api.resources.articles.query({
  queryParams: {
    filter: {
      published_after: '2024-02-01',
      published_before: '2024-04-01'
    }
  }
});
console.log(`Found ${recentArticles.data.length} articles published between Feb and Apr 2024\n`);

// Example 5: Combined filters with sorting
console.log('5. Combined filters with sorting:');
const filteredAndSorted = await api.resources.articles.query({
  queryParams: {
    filter: {
      status: 'published',
      author_id: 1
    },
    sort: ['-view_count', 'title']  // Sort by view_count DESC, then title ASC
  }
});
console.log(`Found ${filteredAndSorted.data.length} published articles by author 1`);
filteredAndSorted.data.forEach(article => {
  console.log(`  - ${article.attributes.title} (${article.attributes.view_count} views)`);
});

// Example 6: Pagination
console.log('\n6. Paginated results:');
const paginatedResults = await api.resources.articles.query({
  queryParams: {
    filter: { status: 'published' },
    page: { size: 1, number: 1 }
  }
});
console.log(`Page 1 with 1 item: ${paginatedResults.data[0].attributes.title}\n`);

// Example 7: Using explicit searchSchema
api.addResource('products', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' },
    price: { type: 'decimal' },
    category: { type: 'string' },
    in_stock: { type: 'boolean' }
  },
  // Explicit searchSchema instead of using schema.search
  searchSchema: {
    name: {
      type: 'string',
      likeOneOf: ['name', 'description']  // Search in multiple fields
    },
    category: {
      type: 'string'  // Exact match
    },
    price_min: {
      type: 'number',
      actualField: 'price',
      filterUsing: '>='
    },
    price_max: {
      type: 'number',
      actualField: 'price',
      filterUsing: '<='
    },
    available: {
      type: 'boolean',
      applyFilter: (query, value) => {
        if (value) {
          query.where('in_stock', true).where('price', '>', 0);
        } else {
          query.where(function() {
            this.where('in_stock', false).orWhere('price', 0);
          });
        }
      }
    }
  }
});

// Example 8: Custom filtering via hook
api.use({
  name: 'soft-delete-filter',
  install({ addHook }) {
    // Add soft delete filtering to all queries
    addHook('knexQueryFiltering', 'excludeDeleted', {}, 
      async ({ query, scopeName }) => {
        // Only apply to scopes that have deleted_at column
        if (['articles', 'products'].includes(scopeName)) {
          query.whereNull('deleted_at');
        }
      }
    );
  }
});

console.log('=== Direct Knex Access ===\n');

// Example 9: Direct Knex access for complex queries
const complexResults = await api.knex('articles')
  .select('articles.*')
  .count('* as total_by_status')
  .where('status', 'published')
  .groupBy('status')
  .first();

console.log('Complex query result:', complexResults);

// Cleanup
await db.destroy();