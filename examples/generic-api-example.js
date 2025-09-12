/**
 * Generic API Plugin - Complete Example
 * 
 * This example demonstrates how to use the Generic API Plugin to create
 * a fully functional blog API without writing resource-specific code.
 * The plugin uses json-rest-api's infrastructure to manage everything.
 */

import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from '../index.js';
import { GenericApiPlugin } from '../plugins/core/generic-api-plugin.js';
import { GenericApiHelpers } from '../plugins/core/lib/generic-api/generic-api-helpers.js';
import { ExpressPlugin } from '../plugins/core/connectors/express-plugin.js';
import knex from 'knex';

// Initialize database connection
const db = knex({
  client: 'sqlite3',
  connection: {
    filename: './generic-api-demo.db'
  },
  useNullAsDefault: true
});

async function setupGenericApi() {
  // Create API instance
  const api = new Api({
    name: 'generic-api-demo',
    log: { level: 'info' }
  });
  
  // Install plugins - order matters!
  await api.use(RestApiPlugin, {
    simplifiedApi: false,
    simplifiedTransport: false,
    queryDefaultLimit: 100,
    queryMaxLimit: 1000
  });
  
  await api.use(RestApiKnexPlugin, { knex: db });
  
  // Generic API Plugin uses json-rest-api to manage its metadata
  await api.use(GenericApiPlugin, {
    tablePrefix: 'gen_api',
    storageMode: 'hybrid', // Use intelligent storage optimization
    enableCaching: true,
    enableAudit: true,
    enableMetrics: true,
    enableHooks: true,
    cacheTimeout: 300000, // 5 minutes
    autoReload: true,
    reloadInterval: 60000 // Reload resources every minute
  });
  
  // Add Express connector for HTTP
  await api.use(ExpressPlugin, {
    mountPath: '/api/v1'
  });
  
  // Initialize API
  await api.init();
  
  // Create helper instance for easier management
  api.genericHelpers = new GenericApiHelpers(api);
  
  return api;
}

async function createBlogSystem(api) {
  console.log('Creating blog system using Generic API...');
  
  // Create users table
  const users = await api.genericHelpers.createTable({
    name: 'blog_users',
    apiName: 'users',
    description: 'Blog system users',
    storageMode: 'hybrid',
    fields: [
      {
        name: 'username',
        type: 'string',
        required: true,
        unique: true,
        searchable: true,
        indexed: true, // Will use indexed column for performance
        maxLength: 50
      },
      {
        name: 'email',
        type: 'string',
        required: true,
        unique: true,
        indexed: true,
        validation: { 
          email: true,
          maxLength: 100
        }
      },
      {
        name: 'full_name',
        type: 'string',
        searchable: true,
        maxLength: 100
      },
      {
        name: 'bio',
        type: 'text',
        maxLength: 500
      },
      {
        name: 'avatar_url',
        type: 'string',
        validation: { url: true }
      },
      {
        name: 'is_active',
        type: 'boolean',
        default: true,
        indexed: true
      },
      {
        name: 'role',
        type: 'string',
        enum: ['admin', 'editor', 'author', 'subscriber'],
        default: 'subscriber'
      },
      {
        name: 'preferences',
        type: 'json',
        default: {}
      },
      {
        name: 'last_login',
        type: 'datetime'
      },
      {
        name: 'post_count',
        type: 'number',
        default: 0,
        computed: true,
        computedExpression: 'return record.posts ? record.posts.length : 0;'
      }
    ]
  });
  
  // Create categories table
  const categories = await api.genericHelpers.createTable({
    name: 'blog_categories',
    apiName: 'categories',
    description: 'Blog post categories',
    fields: [
      {
        name: 'name',
        type: 'string',
        required: true,
        unique: true,
        searchable: true,
        indexed: true,
        maxLength: 50
      },
      {
        name: 'slug',
        type: 'string',
        required: true,
        unique: true,
        indexed: true,
        validation: {
          pattern: '^[a-z0-9-]+$',
          patternMessage: 'Slug must contain only lowercase letters, numbers, and hyphens'
        }
      },
      {
        name: 'description',
        type: 'text',
        maxLength: 200
      },
      {
        name: 'parent_id',
        type: 'number'
      },
      {
        name: 'color',
        type: 'string',
        validation: {
          pattern: '^#[0-9A-Fa-f]{6}$',
          patternMessage: 'Color must be a valid hex color'
        }
      },
      {
        name: 'icon',
        type: 'string'
      },
      {
        name: 'is_featured',
        type: 'boolean',
        default: false
      },
      {
        name: 'sort_order',
        type: 'number',
        default: 0
      }
    ]
  });
  
  // Create posts table
  const posts = await api.genericHelpers.createTable({
    name: 'blog_posts',
    apiName: 'posts',
    description: 'Blog posts',
    storageMode: 'hybrid',
    fields: [
      {
        name: 'title',
        type: 'string',
        required: true,
        searchable: true,
        indexed: true,
        maxLength: 200
      },
      {
        name: 'slug',
        type: 'string',
        required: true,
        unique: true,
        indexed: true
      },
      {
        name: 'content',
        type: 'text',
        required: true,
        searchable: true
      },
      {
        name: 'excerpt',
        type: 'text',
        maxLength: 500
      },
      {
        name: 'author_id',
        type: 'number',
        required: true,
        indexed: true
      },
      {
        name: 'category_id',
        type: 'number',
        indexed: true
      },
      {
        name: 'status',
        type: 'string',
        enum: ['draft', 'published', 'scheduled', 'archived'],
        default: 'draft',
        indexed: true
      },
      {
        name: 'published_at',
        type: 'datetime',
        indexed: true
      },
      {
        name: 'scheduled_at',
        type: 'datetime'
      },
      {
        name: 'view_count',
        type: 'number',
        default: 0
      },
      {
        name: 'like_count',
        type: 'number',
        default: 0
      },
      {
        name: 'comment_count',
        type: 'number',
        default: 0
      },
      {
        name: 'is_featured',
        type: 'boolean',
        default: false,
        indexed: true
      },
      {
        name: 'is_sticky',
        type: 'boolean',
        default: false
      },
      {
        name: 'tags',
        type: 'array',
        default: []
      },
      {
        name: 'meta',
        type: 'json',
        default: {}
      },
      {
        name: 'seo_title',
        type: 'string',
        maxLength: 60
      },
      {
        name: 'seo_description',
        type: 'string',
        maxLength: 160
      },
      {
        name: 'seo_keywords',
        type: 'array'
      },
      {
        name: 'reading_time',
        type: 'number',
        computed: true,
        computedExpression: 'const words = (record.content || "").split(" ").length; return Math.ceil(words / 200);'
      }
    ],
    relationships: [
      {
        name: 'author',
        type: 'belongsTo',
        targetTableId: users.tableId,
        foreignKey: 'author_id'
      },
      {
        name: 'category',
        type: 'belongsTo',
        targetTableId: categories.tableId,
        foreignKey: 'category_id'
      }
    ]
  });
  
  // Create comments table
  const comments = await api.genericHelpers.createTable({
    name: 'blog_comments',
    apiName: 'comments',
    description: 'Blog post comments',
    fields: [
      {
        name: 'post_id',
        type: 'number',
        required: true,
        indexed: true
      },
      {
        name: 'author_id',
        type: 'number',
        indexed: true
      },
      {
        name: 'author_name',
        type: 'string',
        required: true,
        maxLength: 100
      },
      {
        name: 'author_email',
        type: 'string',
        required: true,
        validation: { email: true }
      },
      {
        name: 'content',
        type: 'text',
        required: true,
        maxLength: 1000
      },
      {
        name: 'status',
        type: 'string',
        enum: ['pending', 'approved', 'spam', 'trash'],
        default: 'pending',
        indexed: true
      },
      {
        name: 'parent_id',
        type: 'number',
        indexed: true
      },
      {
        name: 'ip_address',
        type: 'string'
      },
      {
        name: 'user_agent',
        type: 'string'
      },
      {
        name: 'like_count',
        type: 'number',
        default: 0
      },
      {
        name: 'is_pinned',
        type: 'boolean',
        default: false
      }
    ],
    relationships: [
      {
        name: 'post',
        type: 'belongsTo',
        targetTableId: posts.tableId,
        foreignKey: 'post_id'
      },
      {
        name: 'author',
        type: 'belongsTo',
        targetTableId: users.tableId,
        foreignKey: 'author_id'
      },
      {
        name: 'parent',
        type: 'belongsTo',
        targetTableId: comments.tableId,
        foreignKey: 'parent_id'
      }
    ]
  });
  
  // Add reverse relationships
  await api.genericHelpers.createRelationship(users.tableId, {
    name: 'posts',
    type: 'hasMany',
    targetTableId: posts.tableId,
    foreignKey: 'author_id'
  });
  
  await api.genericHelpers.createRelationship(users.tableId, {
    name: 'comments',
    type: 'hasMany',
    targetTableId: comments.tableId,
    foreignKey: 'author_id'
  });
  
  await api.genericHelpers.createRelationship(categories.tableId, {
    name: 'posts',
    type: 'hasMany',
    targetTableId: posts.tableId,
    foreignKey: 'category_id'
  });
  
  await api.genericHelpers.createRelationship(categories.tableId, {
    name: 'subcategories',
    type: 'hasMany',
    targetTableId: categories.tableId,
    foreignKey: 'parent_id'
  });
  
  await api.genericHelpers.createRelationship(categories.tableId, {
    name: 'parent',
    type: 'belongsTo',
    targetTableId: categories.tableId,
    foreignKey: 'parent_id'
  });
  
  await api.genericHelpers.createRelationship(posts.tableId, {
    name: 'comments',
    type: 'hasMany',
    targetTableId: comments.tableId,
    foreignKey: 'post_id'
  });
  
  await api.genericHelpers.createRelationship(comments.tableId, {
    name: 'replies',
    type: 'hasMany',
    targetTableId: comments.tableId,
    foreignKey: 'parent_id'
  });
  
  console.log('Blog system created successfully!');
  
  return { users, categories, posts, comments };
}

async function seedData(api) {
  console.log('Seeding sample data...');
  
  // Create users
  const adminUser = await api.genericHelpers.create('users', {
    username: 'admin',
    email: 'admin@example.com',
    full_name: 'Admin User',
    role: 'admin',
    is_active: true,
    bio: 'System administrator',
    preferences: { theme: 'dark', notifications: true }
  });
  
  const authorUser = await api.genericHelpers.create('users', {
    username: 'johndoe',
    email: 'john@example.com',
    full_name: 'John Doe',
    role: 'author',
    is_active: true,
    bio: 'Regular blog author and tech enthusiast',
    preferences: { theme: 'light', notifications: true }
  });
  
  // Create categories
  const techCategory = await api.genericHelpers.create('categories', {
    name: 'Technology',
    slug: 'technology',
    description: 'All things tech',
    color: '#0066cc',
    icon: 'laptop',
    is_featured: true,
    sort_order: 1
  });
  
  const tutorialCategory = await api.genericHelpers.create('categories', {
    name: 'Tutorials',
    slug: 'tutorials',
    description: 'Step-by-step guides',
    parent_id: Number(techCategory.data.id),
    color: '#00cc66',
    icon: 'book',
    sort_order: 2
  });
  
  // Create posts
  const post1 = await api.genericHelpers.create('posts', {
    title: 'Getting Started with Generic API',
    slug: 'getting-started-generic-api',
    content: `
# Getting Started with Generic API

The Generic API plugin is a powerful tool that allows you to create fully functional APIs without writing resource-specific code.

## Key Features

- **Dynamic Resource Creation**: Define your API structure through database records
- **Hybrid Storage**: Intelligent storage optimization (EAV + JSONB + indexed columns)
- **Full JSON:API Compliance**: Built on top of json-rest-api
- **Comprehensive Hook System**: 50+ injection points for customization
- **Performance Optimization**: Automatic indexing and caching

## How It Works

The plugin uses json-rest-api's own infrastructure to manage its metadata tables. This means the plugin "eats its own dog food" - it uses the same system it provides to manage itself!

### Storage Strategy

The hybrid storage approach provides the best of all worlds:
- **Indexed Columns**: For frequently queried fields
- **JSONB**: For flexible, semi-structured data
- **EAV**: For highly dynamic attributes

This approach ensures optimal performance while maintaining flexibility.
    `.trim(),
    excerpt: 'Learn how to use the Generic API plugin to create dynamic APIs',
    author_id: Number(authorUser.data.id),
    category_id: Number(techCategory.data.id),
    status: 'published',
    published_at: new Date().toISOString(),
    is_featured: true,
    tags: ['tutorial', 'generic-api', 'json-api', 'development'],
    meta: { 
      keywords: ['api', 'development', 'json-api'],
      canonical_url: 'https://example.com/posts/getting-started-generic-api'
    },
    seo_title: 'Getting Started with Generic API - Complete Guide',
    seo_description: 'Learn how to create dynamic APIs using the Generic API plugin',
    seo_keywords: ['generic api', 'json api', 'rest api']
  });
  
  const post2 = await api.genericHelpers.create('posts', {
    title: 'Advanced Generic API Features',
    slug: 'advanced-generic-api-features',
    content: `
# Advanced Generic API Features

Once you've mastered the basics, it's time to explore the advanced features.

## Performance Optimization

The optimizer analyzes usage patterns and automatically:
- Creates indexes for frequently queried fields
- Migrates data to optimal storage locations
- Suggests performance improvements

## Hook System

With over 50 hook points, you can customize virtually every aspect:
- Data validation
- Query modification
- Result transformation
- Caching strategies

## Real-time Updates

Combine with WebSocket support for real-time data synchronization.
    `.trim(),
    excerpt: 'Deep dive into advanced features and optimization techniques',
    author_id: Number(authorUser.data.id),
    category_id: Number(tutorialCategory.data.id),
    status: 'published',
    published_at: new Date().toISOString(),
    tags: ['advanced', 'performance', 'optimization'],
    meta: { 
      difficulty: 'advanced',
      estimated_time: '15 minutes'
    }
  });
  
  // Create comments
  await api.genericHelpers.create('comments', {
    post_id: Number(post1.data.id),
    author_id: Number(adminUser.data.id),
    author_name: 'Admin User',
    author_email: 'admin@example.com',
    content: 'Great introduction to the Generic API! This will help many developers.',
    status: 'approved',
    is_pinned: true
  });
  
  await api.genericHelpers.create('comments', {
    post_id: Number(post1.data.id),
    author_name: 'Guest User',
    author_email: 'guest@example.com',
    content: 'This is exactly what I was looking for. Thanks for the detailed explanation!',
    status: 'approved'
  });
  
  console.log('Sample data seeded successfully!');
  
  return { adminUser, authorUser, techCategory, tutorialCategory, post1, post2 };
}

async function demonstrateUsage(api) {
  console.log('\n=== Demonstrating Generic API Usage ===\n');
  
  // 1. Query posts with includes
  console.log('1. Querying posts with author and comments:');
  const postsWithIncludes = await api.genericHelpers.query('posts', {
    filters: { status: 'published' },
    include: 'author,category,comments',
    sort: '-published_at',
    limit: 10
  });
  console.log(`Found ${postsWithIncludes.data.length} published posts`);
  if (postsWithIncludes.included) {
    console.log(`Included ${postsWithIncludes.included.length} related resources`);
  }
  
  // 2. Search functionality
  console.log('\n2. Searching posts:');
  const searchResults = await api.genericHelpers.query('posts', {
    filters: { 
      title: { $contains: 'Generic' },
      status: 'published'
    }
  });
  console.log(`Found ${searchResults.data.length} posts matching search`);
  
  // 3. Complex filtering
  console.log('\n3. Complex filtering:');
  const featuredPosts = await api.genericHelpers.query('posts', {
    filters: {
      is_featured: true,
      status: 'published',
      published_at: { $lte: new Date().toISOString() }
    },
    sort: 'published_at'
  });
  console.log(`Found ${featuredPosts.data.length} featured posts`);
  
  // 4. Update post metrics
  console.log('\n4. Updating post metrics:');
  if (postsWithIncludes.data.length > 0) {
    const postId = postsWithIncludes.data[0].id;
    const currentViews = postsWithIncludes.data[0].attributes.view_count || 0;
    
    await api.genericHelpers.update('posts', postId, {
      view_count: currentViews + 1
    });
    console.log(`Incremented view count for post ${postId}`);
  }
  
  // 5. Data validation
  console.log('\n5. Testing data validation:');
  const validationResult = await api.genericHelpers.validateData('posts', {
    title: 'Test Post',
    slug: 'test-post',
    content: 'Test content',
    author_id: 1,
    status: 'invalid-status' // This should fail
  });
  
  if (!validationResult.valid) {
    console.log('Validation errors:', validationResult.errors);
  }
  
  // 6. Export data
  console.log('\n6. Exporting data:');
  const allUsers = await api.genericHelpers.export('users');
  console.log(`Exported ${allUsers.length} users`);
  
  // 7. Table optimization
  console.log('\n7. Optimizing tables:');
  const optimizations = await api.genericHelpers.optimizeTable('posts');
  if (optimizations.length > 0) {
    console.log(`Created ${optimizations.length} indexes:`, optimizations);
  } else {
    console.log('No optimizations needed');
  }
  
  // 8. Performance metrics
  console.log('\n8. Performance metrics:');
  const metrics = await api.genericHelpers.getTableMetrics('posts');
  if (metrics) {
    console.log(`Posts table metrics:
  - Total operations: ${metrics.totalOperations}
  - Avg response time: ${metrics.avgResponseTime.toFixed(2)}ms
  - Cache hit rate: ${metrics.cacheHitRate.toFixed(2)}%`);
  }
}

async function demonstrateHooks(api) {
  console.log('\n=== Demonstrating Hook System ===\n');
  
  // Register a hook to auto-generate slugs
  api.genericApi.hooks.register('posts', 'beforeCreate', async (context) => {
    if (!context.inputData?.slug && context.inputData?.title) {
      context.inputData.slug = context.inputData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      console.log(`Auto-generated slug: ${context.inputData.slug}`);
    }
    return true;
  });
  
  // Register a hook to track view counts
  api.genericApi.hooks.register('posts', 'afterGet', async (context) => {
    // In a real app, check if user has already viewed
    console.log(`Post ${context.id} viewed`);
    return true;
  });
  
  // Register validation hook for comments
  api.genericApi.hooks.register('comments', 'beforeCreate', async (context) => {
    const content = context.inputData?.content || '';
    
    // Simple spam detection
    const spamWords = ['viagra', 'casino', 'lottery', 'prize'];
    const isSpam = spamWords.some(word => 
      content.toLowerCase().includes(word)
    );
    
    if (isSpam) {
      context.inputData.status = 'spam';
      console.log('Comment marked as spam');
    }
    
    return true;
  });
  
  // Register a hook for automatic timestamps
  api.genericApi.hooks.register('*', 'beforeUpdate', async (context) => {
    context.inputData.updated_at = new Date().toISOString();
    return true;
  });
  
  console.log('Hooks registered successfully!');
  
  // Show registered hooks
  const allHooks = api.genericApi.hooks.getAllHooks();
  console.log('\nRegistered hooks:', JSON.stringify(allHooks, null, 2));
}

async function demonstrateAdvancedFeatures(api) {
  console.log('\n=== Advanced Features ===\n');
  
  // 1. Clone table structure
  console.log('1. Cloning table structure:');
  const clonedTable = await api.genericHelpers.cloneTableStructure(
    'posts',
    'archived_posts'
  );
  console.log(`Created clone: ${clonedTable.resourceName}`);
  
  // 2. Bulk import
  console.log('\n2. Bulk import:');
  const importData = [
    {
      name: 'News',
      slug: 'news',
      description: 'Latest news and updates'
    },
    {
      name: 'Reviews',
      slug: 'reviews',
      description: 'Product and service reviews'
    }
  ];
  
  const importResult = await api.genericHelpers.bulkImport('categories', importData);
  console.log(`Imported ${importResult.successful} categories, ${importResult.failed} failed`);
  
  // 3. Dynamic computed fields
  console.log('\n3. Computed fields:');
  const postsWithComputed = await api.genericHelpers.query('posts', {
    fields: ['title', 'content', 'reading_time'],
    limit: 1
  });
  
  if (postsWithComputed.data.length > 0) {
    const post = postsWithComputed.data[0];
    console.log(`Post "${post.attributes.title}" has estimated reading time: ${post.attributes.reading_time} minutes`);
  }
  
  // 4. Storage metrics
  console.log('\n4. Storage metrics:');
  if (api.genericApi?.storage) {
    const storageMetrics = api.genericApi.storage.getMetrics();
    console.log('Storage metrics:', storageMetrics);
  }
  
  // 5. Hook metrics
  console.log('\n5. Hook execution metrics:');
  if (api.genericApi?.hooks) {
    const hookMetrics = api.genericApi.hooks.getMetrics();
    console.log('Hook metrics:', hookMetrics);
  }
}

// Main execution
async function main() {
  let api;
  
  try {
    // Setup API
    api = await setupGenericApi();
    console.log('✓ API setup complete\n');
    
    // Run migrations
    await db.migrate.latest();
    console.log('✓ Database migrations complete\n');
    
    // Create blog system
    await createBlogSystem(api);
    console.log('✓ Blog system created\n');
    
    // Seed sample data
    await seedData(api);
    console.log('✓ Sample data seeded\n');
    
    // Register hooks
    await demonstrateHooks(api);
    console.log('✓ Hooks registered\n');
    
    // Demonstrate usage
    await demonstrateUsage(api);
    
    // Demonstrate advanced features
    await demonstrateAdvancedFeatures(api);
    
    // Start Express server
    const app = api.plugins.express.app;
    const server = app.listen(3000, () => {
      console.log('\n✓ Server running at http://localhost:3000');
      console.log('\n=== Available Endpoints ===');
      console.log('\nDynamic Resources:');
      console.log('  - GET/POST       /api/v1/users');
      console.log('  - GET/PATCH/DEL  /api/v1/users/{id}');
      console.log('  - GET/POST       /api/v1/categories');
      console.log('  - GET/PATCH/DEL  /api/v1/categories/{id}');
      console.log('  - GET/POST       /api/v1/posts');
      console.log('  - GET/PATCH/DEL  /api/v1/posts/{id}');
      console.log('  - GET/POST       /api/v1/comments');
      console.log('  - GET/PATCH/DEL  /api/v1/comments/{id}');
      console.log('\nMetadata Management:');
      console.log('  - GET/POST       /api/v1/genApiTables');
      console.log('  - GET/PATCH/DEL  /api/v1/genApiTables/{id}');
      console.log('  - GET/POST       /api/v1/genApiFields');
      console.log('  - GET/PATCH/DEL  /api/v1/genApiFields/{id}');
      console.log('  - GET/POST       /api/v1/genApiRelationships');
      console.log('  - GET/PATCH/DEL  /api/v1/genApiRelationships/{id}');
      console.log('\nQuery Parameters:');
      console.log('  - ?include=author,category,comments');
      console.log('  - ?filter[status]=published');
      console.log('  - ?sort=-published_at');
      console.log('  - ?page[size]=10&page[number]=1');
      console.log('  - ?fields[posts]=title,content,author');
      console.log('\nPress Ctrl+C to stop the server');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down gracefully...');
      server.close();
      await db.destroy();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Error:', error);
    if (api && api.knex) {
      await api.knex.destroy();
    }
    process.exit(1);
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { setupGenericApi, createBlogSystem, seedData };