import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from '../../index.js';
import { ExpressPlugin } from '../../plugins/core/connectors/express-plugin.js';
import express from 'express';
import { createServer } from 'http';

/**
 * Creates a basic API configuration with Countries, Publishers, Authors, Books
 */
export async function createBasicApi(knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || `basic-test-api`;
  const tablePrefix = pluginOptions.tablePrefix || 'basic';
  const api = new Api({
    name: apiName,
    version: '1.0.0'
  });

  const restApiOptions = {
    simplifiedApi: false,
    simplifiedTransport: false,
    returnFullRecord: {
      post: true,  // Need to return record to get ID for tests
      put: false,
      patch: false,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'name', 'code'],
    ...pluginOptions['rest-api']  // Merge any custom options for rest-api plugin
  };

  await api.use(RestApiPlugin, restApiOptions);
  
  await api.use(RestApiKnexPlugin, { knex });
  
  // Add Express plugin if requested
  if (pluginOptions.includeExpress) {
    await api.use(ExpressPlugin, {
      mountPath: '/api',  // Default mount path for tests
      ...(pluginOptions.express || {})
    });
  }

  // Countries table
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100, search: true },
      code: { type: 'string', max: 2, unique: true }
    },
    relationships: {
      publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
      books: { hasMany: 'books', foreignKey: 'country_id' }
    },
    tableName: `${tablePrefix}_countries`
  });
  await api.resources.countries.createKnexTable();

  // Publishers table
  await api.addResource('publishers', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
    },
    relationships: {
      books: { hasMany: 'books', foreignKey: 'publisher_id' }
    },
    tableName: `${tablePrefix}_publishers`
  });
  await api.resources.publishers.createKnexTable();

  // Authors table
  await api.addResource('authors', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 }
    },
    relationships: {
      books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
    },
    tableName: `${tablePrefix}_authors`
  });
  await api.resources.authors.createKnexTable();

  // Books table
  await api.addResource('books', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 300, search: true },
      country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
      publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
    },
    relationships: {
      authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
    },
    tableName: `${tablePrefix}_books`
  });
  await api.resources.books.createKnexTable();

  // Book-Authors pivot table
  await api.addResource('book_authors', {
    schema: {
      id: { type: 'id' },
      book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
      author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' }
    },
    tableName: `${tablePrefix}_book_authors`
  });
  await api.resources.book_authors.createKnexTable();

  return api;
}

/**
 * Creates a basic API with bulk operations enabled
 */
export async function createBulkOperationsApi(knex, pluginOptions = {}) {
  const { BulkOperationsPlugin } = await import('../../plugins/core/bulk-operations-plugin.js');
  
  const api = await createBasicApi(knex, pluginOptions);
  
  // Add bulk operations plugin
  await api.use(BulkOperationsPlugin, {
    'bulk-operations': {
      maxBulkOperations: 100,
      defaultAtomic: true,
      batchSize: 10,
      enableOptimizations: true,
      ...pluginOptions['bulk-operations']
    }
  });
  
  return api;
}

/**
 * Creates an extended API with additional fields for more complex testing
 */
export async function createExtendedApi(knex) {
  const api = new Api({
    name: 'extended-test-api',
    version: '1.0.0'
  });

  await api.use(RestApiPlugin, {
    simplifiedApi: false,
    simplifiedTransport: false,
    returnFullRecord: {
      post: true,  // Need to return record to get ID for tests
      put: false,
      patch: false,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'price', 'language', 'population', 'name', 'code']
  });
  
  await api.use(RestApiKnexPlugin, { knex });

  // Countries with extended fields
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 },
      code: { type: 'string', max: 2, unique: true },
      capital: { type: 'string', max: 100 },
      population: { type: 'number' },
      currency: { type: 'string', max: 3 }
    },
    relationships: {
      publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
      books: { hasMany: 'books', foreignKey: 'country_id' },
      authors: { hasMany: 'authors', foreignKey: 'nationality_id' }
    },
    tableName: 'ext_countries'
  });
  await api.resources.countries.createKnexTable();

  // Publishers with extended fields
  await api.addResource('publishers', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' },
      founded_year: { type: 'number' },
      website: { type: 'string', max: 255 },
      active: { type: 'boolean', default: true }
    },
    relationships: {
      books: { hasMany: 'books', foreignKey: 'publisher_id' },
      reviews: { 
        hasMany: 'reviews', 
        via: 'reviewable'
      }
    },
    tableName: 'ext_publishers'
  });
  await api.resources.publishers.createKnexTable();

  // Authors with extended fields
  await api.addResource('authors', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      birth_date: { type: 'date' },
      biography: { type: 'string', max: 5000 },
      nationality_id: { type: 'number', belongsTo: 'countries', as: 'nationality' }
    },
    relationships: {
      books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' },
      reviews: { 
        hasMany: 'reviews', 
        via: 'reviewable'
      }
    },
    tableName: 'ext_authors'
  });
  await api.resources.authors.createKnexTable();

  // Books with extended fields
  await api.addResource('books', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 300, search: true },
      isbn: { type: 'string', max: 13 },
      pages: { type: 'number' },
      price: { type: 'number', search: true }, // Store price as string for decimal precision
      published_date: { type: 'date' },
      language: { type: 'string', max: 2, default: 'en', search: true },
      country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
      publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
    },
    relationships: {
      authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' },
      reviews: { 
        hasMany: 'reviews', 
        via: 'reviewable'
      }
    },
    tableName: 'ext_books'
  });
  await api.resources.books.createKnexTable();

  // Book-Authors pivot with extended fields
  await api.addResource('book_authors', {
    schema: {
      id: { type: 'id' },
      book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
      author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
      contribution_type: { type: 'string', max: 50 },
      order: { type: 'number' }
    },
    tableName: 'ext_book_authors'
  });
  await api.resources.book_authors.createKnexTable();

  // Polymorphic reviews (can go on authors, books and publishers)
  await api.addResource('reviews', {
    schema: {
      id: { type: 'id' },
      rating: { type: 'number', required: true, min: 1, max: 5 },
      title: { type: 'string', max: 200 },
      content: { type: 'string', required: true, max: 5000 },
      reviewer_name: { type: 'string', required: true, max: 100 },
      review_date: { type: 'dateTime', default: 'now()' },
      helpful_count: { type: 'number', default: 0 },
      reviewable_type: { type: 'string', required: true },
      reviewable_id: { type: 'number', required: true },
      // Define the polymorphic field in schema
      reviewable: {
        belongsToPolymorphic: {
          types: ['books', 'authors', 'publishers'],
          typeField: 'reviewable_type',
          idField: 'reviewable_id'
        },
        as: 'reviewable'
      }
    },
    relationships: {},
    tableName: 'ext_reviews'
  });
  await api.resources.reviews.createKnexTable();


  return api;
}

/**
 * Creates an API with limited include depth for testing depth validation
 * Uses 'limited_' prefix for all tables to avoid conflicts
 */
export async function createLimitedDepthApi(knex) {
  const api = new Api({
    name: 'limited-depth-api',
    version: '1.0.0'
  });

  await api.use(RestApiPlugin, {
    simplifiedApi: false,
    simplifiedTransport: false,
    returnFullRecord: {
      post: true,
      put: false,
      patch: false,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'name', 'code'],
    includeDepthLimit: 2  // Key difference: limit is 2 instead of default 3
  });
  
  await api.use(RestApiKnexPlugin, { knex });

  // Use different table names with 'limited_' prefix to avoid conflicts
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 },
      code: { type: 'string', max: 2, unique: true }
    },
    relationships: {
      publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
      books: { hasMany: 'books', foreignKey: 'country_id' }
    },
    tableName: 'limited_countries'
  });
  await api.resources.countries.createKnexTable();

  await api.addResource('publishers', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
    },
    relationships: {
      books: { hasMany: 'books', foreignKey: 'publisher_id' },
      authors: { hasMany: 'authors', foreignKey: 'publisher_id' }
    },
    tableName: 'limited_publishers'
  });
  await api.resources.publishers.createKnexTable();

  await api.addResource('authors', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      publisher_id: { type: 'number', nullable: true, belongsTo: 'publishers', as: 'publisher' }
    },
    relationships: {
      books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
    },
    tableName: 'limited_authors'
  });
  await api.resources.authors.createKnexTable();

  await api.addResource('books', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 300, search: true },
      country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
      publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
    },
    relationships: {
      authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
    },
    tableName: 'limited_books'
  });
  await api.resources.books.createKnexTable();

  await api.addResource('book_authors', {
    schema: {
      id: { type: 'id' },
      book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
      author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' }
    },
    tableName: 'limited_book_authors'
  });
  await api.resources.book_authors.createKnexTable();

  return api;
}

/**
 * Creates an API configuration for pagination testing
 */
export async function createPaginationApi(knex, options = {}) {
  const api = new Api({
    name: 'pagination-test-api',
    version: '1.0.0'
  });

  const restApiOptions = {
    simplifiedApi: false,
    simplifiedTransport: false,
    returnFullRecord: {
      post: true,
      put: false,
      patch: false,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'name', 'code'],
    ...options  // Allow overriding options like publicBaseUrl, enablePaginationCounts
  };

  await api.use(RestApiPlugin, restApiOptions);
  
  await api.use(RestApiKnexPlugin, { knex });

  // Countries table
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 },
      code: { type: 'string', max: 2, unique: true }
    },
    relationships: {
      publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
      books: { hasMany: 'books', foreignKey: 'country_id' }
    },
    tableName: 'pagination_countries'
  });
  await api.resources.countries.createKnexTable();

  // Publishers table
  await api.addResource('publishers', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
    },
    relationships: {
      books: { hasMany: 'books', foreignKey: 'publisher_id' }
    },
    tableName: 'pagination_publishers'
  });
  await api.resources.publishers.createKnexTable();

  // Books table
  await api.addResource('books', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 300, search: true },
      country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
      publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
    },
    tableName: 'pagination_books'
  });
  await api.resources.books.createKnexTable();

  return api;
}

/**
 * Creates an API with WebSocket/Socket.IO support for testing
 */
export async function createWebSocketApi(knex, pluginOptions = {}) {
  const { SocketIOPlugin } = await import('../../plugins/core/socketio-plugin.js');
  const { JwtAuthPlugin } = await import('../../plugins/core/jwt-auth-plugin.js');
  
  const api = await createBasicApi(knex, {
    ...pluginOptions,
    includeExpress: true,
    express: {
      port: 0 // Let OS assign a port
    }
  });
  
  // Add JWT auth plugin (required by SocketIO plugin)
  await api.use(JwtAuthPlugin, {
    secret: 'test-secret-key',
    expiresIn: '1h'
  });
  
  // Add SocketIO plugin
  await api.use(SocketIOPlugin, pluginOptions['socketio'] || {});
  
  // Create and start Express server
  const app = express();
  api.http.express.app = app;
  
  // Mount the API routes
  app.use('/api', api.http.express.router);
  
  // Create HTTP server
  const server = createServer(app);
  
  // Start Socket.IO server
  await api.startSocketServer(server);
  
  // Start listening
  await new Promise((resolve) => {
    server.listen(0, () => {
      resolve();
    });
  });
  
  return { api, server };
}

/**
 * Creates an API with MultiHome (multi-tenancy) support for testing
 */
export async function createMultiHomeApi(knex, pluginOptions = {}) {
  const { MultiHomePlugin } = await import('../../plugins/core/rest-api-multihome-plugin.js');
  
  const api = new Api({
    name: 'multihome-test-api',
    version: '1.0.0'
  });

  await api.use(RestApiPlugin, {
    simplifiedApi: false,
    simplifiedTransport: false,
    returnFullRecord: {
      post: true,
      put: false,
      patch: false,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'name', 'tenant_id']
  });
  
  await api.use(RestApiKnexPlugin, { knex });
  
  // Add Express plugin if requested for transport testing
  if (pluginOptions.includeExpress) {
    await api.use(ExpressPlugin, pluginOptions.express || {});
  }
  
  // Add MultiHome plugin with configuration
  await api.use(MultiHomePlugin, {
    field: pluginOptions.field || 'tenant_id',
    excludeResources: pluginOptions.excludeResources || ['system_settings'],
    requireAuth: pluginOptions.requireAuth !== undefined ? pluginOptions.requireAuth : true,
    allowMissing: pluginOptions.allowMissing || false,
    extractor: pluginOptions.extractor || ((request) => {
      // Default to header extraction for tests
      return request.headers?.['x-tenant-id'] || null;
    })
  });

  // Tenant-specific resources
  await api.addResource('projects', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      description: { type: 'string', max: 1000 },
      status: { type: 'string', defaultTo: 'active' },
      tenant_id: { type: 'string', required: true }
    },
    relationships: {
      tasks: { hasMany: 'tasks', foreignKey: 'project_id' }
    },
    tableName: 'multihome_projects'
  });
  await api.resources.projects.createKnexTable();

  await api.addResource('tasks', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200 },
      completed: { type: 'boolean', defaultTo: false },
      project_id: { type: 'number', belongsTo: 'projects', as: 'project' },
      tenant_id: { type: 'string', required: true }
    },
    tableName: 'multihome_tasks'
  });
  await api.resources.tasks.createKnexTable();

  await api.addResource('users', {
    schema: {
      id: { type: 'id' },
      email: { type: 'string', required: true, unique: true },
      name: { type: 'string', required: true },
      role: { type: 'string', defaultTo: 'member', search: true },
      tenant_id: { type: 'string', required: true }
    },
    tableName: 'multihome_users'
  });
  await api.resources.users.createKnexTable();

  // Global resource (excluded from multihome)
  await api.addResource('system_settings', {
    schema: {
      id: { type: 'id' },
      key: { type: 'string', required: true, unique: true },
      value: { type: 'string', required: true }
    },
    tableName: 'multihome_system_settings'
  });
  await api.resources.system_settings.createKnexTable();

  return api;
}

/**
 * Creates an API with positioning support for testing
 */
export async function createPositioningApi(knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'positioning-test-api';
  const tablePrefix = pluginOptions.tablePrefix || 'positioning';
  const api = new Api({
    name: apiName,
    version: '1.0.0'
  });

  const restApiOptions = {
    simplifiedApi: true,  // Changed to true to allow simplified API calls in tests
    simplifiedTransport: false,
    returnFullRecord: {
      post: true,
      put: true,
      patch: true,
      allowRemoteOverride: false
    },
    sortableFields: ['id', 'title', 'name', 'position', 'sort_order', 'category_id', 'project_id', 'status'],
    ...pluginOptions['rest-api']
  };

  await api.use(RestApiPlugin, restApiOptions);
  await api.use(RestApiKnexPlugin, { knex });

  // Categories (for grouping tasks)
  await api.addResource('categories', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 }
    },
    tableName: `${tablePrefix}_categories`
  });
  await api.resources.categories.createKnexTable();

  // Tasks (main positioning test resource)
  await api.addResource('tasks', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200 },
      category_id: { type: 'number', nullable: true, belongsTo: 'categories', as: 'category', search: true },
      position: { type: 'string', max: 255, nullable: true },
      beforeId: { type: 'string', virtual: true }, // Virtual field for positioning
      deleted_at: { type: 'dateTime', nullable: true, search: true }, // For soft delete tests
      version: { type: 'number', defaultTo: 1, search: true } // For versioning tests
    },
    relationships: {
      category: { belongsTo: 'categories' }
    },
    tableName: `${tablePrefix}_tasks`
  });
  await api.resources.tasks.createKnexTable();

  // Projects (for multi-filter testing)
  await api.addResource('projects', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 }
    },
    tableName: `${tablePrefix}_projects`
  });
  await api.resources.projects.createKnexTable();

  // Items (flexible resource for various positioning tests)
  await api.addResource('items', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      project_id: { type: 'number', nullable: true, belongsTo: 'projects', as: 'project', search: true },
      status: { type: 'string', defaultTo: 'active', nullable: true, search: true },
      position: { type: 'string', max: 255, nullable: true },
      sort_order: { type: 'string', max: 255, nullable: true }, // Alternative position field
      beforeId: { type: 'string', virtual: true },
      priority: { type: 'string', defaultTo: 'medium', search: true } // For multi-filter tests
    },
    relationships: {
      project: { belongsTo: 'projects' }
    },
    tableName: `${tablePrefix}_items`
  });
  await api.resources.items.createKnexTable();

  return api;
}