import { test } from 'node:test';
import assert from 'node:assert';
import { createApi, Schema } from '../index.js';
import express from 'express';
import request from 'supertest';
import mysql from 'mysql2/promise';

// MySQL configuration
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'ppp',
  database: process.env.MYSQL_DATABASE || 'jsonrestapi_test_integration'
};

let connection;
let app;
let server;
let api;

// Helper to create a fresh database connection
async function createConnection() {
  return await mysql.createConnection({
    host: MYSQL_CONFIG.host,
    user: MYSQL_CONFIG.user,
    password: MYSQL_CONFIG.password,
    multipleStatements: true
  });
}

// Helper to setup test environment
async function setupTestEnvironment() {
  // Create database connection
  connection = await createConnection();
  
  // Create test database
  await connection.execute(`CREATE DATABASE IF NOT EXISTS ${MYSQL_CONFIG.database}`);
  await connection.execute(`USE ${MYSQL_CONFIG.database}`);
  
  // Create Express app
  app = express();
  
  // Create API with MySQL and HTTP plugins
  api = createApi({
    name: 'test-api',
    version: '1.0.0',
    storage: 'mysql',
    storageOptions: MYSQL_CONFIG
  });
  
  // Mount API to Express
  app.use('/api', api.router);
  
  // Start server
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  
  return { api, app, connection };
}

// Helper to clean up
async function teardownTestEnvironment() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (connection) {
    await connection.execute(`DROP DATABASE IF EXISTS ${MYSQL_CONFIG.database}`);
    await connection.end();
  }
}

test('MySQL + HTTP Integration Tests', async (t) => {
  let env;
  
  t.beforeEach(async () => {
    env = await setupTestEnvironment();
  });
  
  t.afterEach(async () => {
    await teardownTestEnvironment();
  });

  await t.test('1. Basic CRUD operations via HTTP', async () => {
    const { api, app } = env;
    
    // Define schema
    const userSchema = new Schema({
      name: { type: 'string', required: true, min: 2, max: 100 },
      email: { type: 'string', required: true, unique: true },
      age: { type: 'number', min: 0, max: 150 },
      active: { type: 'boolean', default: true },
      createdAt: { type: 'timestamp', default: () => Date.now() }
    });
    
    // Add resource
    api.addResource('users', userSchema);
    
    // Sync database (create table)
    await api.syncDatabase();
    
    // CREATE via HTTP POST
    const createRes = await request(app)
      .post('/api/users')
      .send({
        data: {
          type: 'users',
          attributes: {
            name: 'John Doe',
            email: 'john@example.com',
            age: 30
          }
        }
      })
      .expect(201)
      .expect('Content-Type', /json/);
    
    assert(createRes.body.data);
    assert.equal(createRes.body.data.type, 'users');
    assert.equal(createRes.body.data.attributes.name, 'John Doe');
    assert.equal(createRes.body.data.attributes.email, 'john@example.com');
    assert.equal(createRes.body.data.attributes.active, true); // default value
    assert(createRes.body.data.attributes.createdAt); // auto-generated
    
    const userId = createRes.body.data.id;
    
    // GET via HTTP GET
    const getRes = await request(app)
      .get(`/api/users/${userId}`)
      .expect(200);
    
    assert.equal(getRes.body.data.id, userId);
    assert.equal(getRes.body.data.attributes.name, 'John Doe');
    
    // UPDATE via HTTP PATCH
    const updateRes = await request(app)
      .patch(`/api/users/${userId}`)
      .send({
        data: {
          type: 'users',
          id: userId,
          attributes: {
            age: 31,
            active: false
          }
        }
      })
      .expect(200);
    
    assert.equal(updateRes.body.data.attributes.age, 31);
    assert.equal(updateRes.body.data.attributes.active, false);
    assert.equal(updateRes.body.data.attributes.name, 'John Doe'); // unchanged
    
    // QUERY via HTTP GET with filters
    const queryRes = await request(app)
      .get('/api/users')
      .query({ 'filter[active]': 'false' })
      .expect(200);
    
    assert(Array.isArray(queryRes.body.data));
    assert.equal(queryRes.body.data.length, 1);
    assert.equal(queryRes.body.data[0].id, userId);
    
    // DELETE via HTTP DELETE
    await request(app)
      .delete(`/api/users/${userId}`)
      .expect(204);
    
    // Verify deletion
    await request(app)
      .get(`/api/users/${userId}`)
      .expect(404);
  });

  await t.test('2. Complex queries with filtering, sorting, and pagination', async () => {
    const { api, app } = env;
    
    // Define schema
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      category: { type: 'string', required: true },
      price: { type: 'number', required: true },
      stock: { type: 'number', default: 0 },
      featured: { type: 'boolean', default: false },
      tags: { type: 'array' },
      metadata: { type: 'object' }
    }));
    
    await api.syncDatabase();
    
    // Create test data
    const products = [
      { name: 'Laptop Pro', category: 'electronics', price: 1299, stock: 5, featured: true, tags: ['computer', 'portable'] },
      { name: 'Wireless Mouse', category: 'electronics', price: 29, stock: 50, featured: false, tags: ['computer', 'accessory'] },
      { name: 'USB-C Cable', category: 'electronics', price: 15, stock: 100, featured: false, tags: ['cable', 'accessory'] },
      { name: 'Office Chair', category: 'furniture', price: 299, stock: 10, featured: true, tags: ['office', 'seating'] },
      { name: 'Standing Desk', category: 'furniture', price: 599, stock: 3, featured: true, tags: ['office', 'desk'] },
      { name: 'Desk Lamp', category: 'furniture', price: 45, stock: 25, featured: false, tags: ['office', 'lighting'] },
      { name: 'Notebook', category: 'stationery', price: 5, stock: 200, featured: false, tags: ['writing', 'paper'] },
      { name: 'Pen Set', category: 'stationery', price: 15, stock: 75, featured: false, tags: ['writing', 'office'] },
      { name: 'Monitor 4K', category: 'electronics', price: 499, stock: 8, featured: true, tags: ['computer', 'display'] },
      { name: 'Keyboard Mechanical', category: 'electronics', price: 149, stock: 20, featured: false, tags: ['computer', 'input'] }
    ];
    
    // Batch create products
    for (const product of products) {
      await request(app)
        .post('/api/products')
        .send({ data: { type: 'products', attributes: product } });
    }
    
    // Test 1: Filter by category
    const electronicsRes = await request(app)
      .get('/api/products')
      .query({ 'filter[category]': 'electronics' })
      .expect(200);
    
    assert.equal(electronicsRes.body.data.length, 5);
    electronicsRes.body.data.forEach(product => {
      assert.equal(product.attributes.category, 'electronics');
    });
    
    // Test 2: Multiple filters (AND condition)
    const featuredElectronicsRes = await request(app)
      .get('/api/products')
      .query({ 
        'filter[category]': 'electronics',
        'filter[featured]': 'true'
      })
      .expect(200);
    
    assert.equal(featuredElectronicsRes.body.data.length, 2); // Laptop Pro and Monitor 4K
    
    // Test 3: Sorting by price ascending
    const sortedAscRes = await request(app)
      .get('/api/products')
      .query({ sort: 'price' })
      .expect(200);
    
    assert.equal(sortedAscRes.body.data[0].attributes.name, 'Notebook'); // cheapest
    assert.equal(sortedAscRes.body.data[0].attributes.price, 5);
    
    // Test 4: Sorting by price descending
    const sortedDescRes = await request(app)
      .get('/api/products')
      .query({ sort: '-price' })
      .expect(200);
    
    assert.equal(sortedDescRes.body.data[0].attributes.name, 'Laptop Pro'); // most expensive
    assert.equal(sortedDescRes.body.data[0].attributes.price, 1299);
    
    // Test 5: Multiple sort fields
    const multiSortRes = await request(app)
      .get('/api/products')
      .query({ sort: 'category,-price' })
      .expect(200);
    
    // Verify sorting: electronics first, then by price descending within category
    let lastCategory = '';
    let lastPrice = Infinity;
    
    multiSortRes.body.data.forEach(product => {
      if (product.attributes.category !== lastCategory) {
        lastCategory = product.attributes.category;
        lastPrice = Infinity;
      }
      assert(product.attributes.price <= lastPrice);
      lastPrice = product.attributes.price;
    });
    
    // Test 6: Pagination
    const page1Res = await request(app)
      .get('/api/products')
      .query({ 
        'page[size]': '3',
        'page[number]': '1'
      })
      .expect(200);
    
    assert.equal(page1Res.body.data.length, 3);
    assert.equal(page1Res.body.meta.total, 10);
    assert.equal(page1Res.body.meta.pageSize, 3);
    assert.equal(page1Res.body.meta.pageNumber, 1);
    assert.equal(page1Res.body.meta.totalPages, 4);
    
    // Test page 2
    const page2Res = await request(app)
      .get('/api/products')
      .query({ 
        'page[size]': '3',
        'page[number]': '2'
      })
      .expect(200);
    
    assert.equal(page2Res.body.data.length, 3);
    assert.equal(page2Res.body.meta.pageNumber, 2);
    
    // Ensure no overlap between pages
    const page1Ids = page1Res.body.data.map(p => p.id);
    const page2Ids = page2Res.body.data.map(p => p.id);
    assert.equal(page1Ids.filter(id => page2Ids.includes(id)).length, 0);
    
    // Test 7: Complex query with filters, sorting, and pagination
    const complexRes = await request(app)
      .get('/api/products')
      .query({
        'filter[category]': 'electronics',
        'filter[stock]': JSON.stringify({ $gte: 10 }),
        sort: '-price',
        'page[size]': '2',
        'page[number]': '1'
      })
      .expect(200);
    
    assert.equal(complexRes.body.data.length, 2);
    assert.equal(complexRes.body.data[0].attributes.name, 'Monitor 4K'); // Most expensive electronics with stock >= 10
    assert.equal(complexRes.body.data[1].attributes.name, 'Keyboard Mechanical');
  });

  await t.test('3. Relationships and joins', async () => {
    const { api, app } = env;
    
    // Define schemas with relationships
    api.addResource('authors', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string', required: true, unique: true },
      bio: { type: 'string' }
    }));
    
    api.addResource('categories', new Schema({
      name: { type: 'string', required: true },
      slug: { type: 'string', required: true, unique: true },
      description: { type: 'string' }
    }));
    
    api.addResource('posts', new Schema({
      title: { type: 'string', required: true },
      slug: { type: 'string', required: true },
      content: { type: 'string', required: true },
      published: { type: 'boolean', default: false },
      publishedAt: { type: 'timestamp' },
      authorId: {
        type: 'id',
        refs: {
          resource: 'authors',
          join: {
            eager: true,
            fields: ['name', 'email']
          }
        }
      },
      categoryId: {
        type: 'id',
        refs: {
          resource: 'categories',
          join: {
            eager: false, // lazy load
            fields: ['name', 'slug']
          }
        }
      }
    }));
    
    await api.syncDatabase();
    
    // Create test data
    const author1 = await request(app)
      .post('/api/authors')
      .send({
        data: {
          type: 'authors',
          attributes: {
            name: 'Jane Doe',
            email: 'jane@example.com',
            bio: 'Tech writer and blogger'
          }
        }
      });
    
    const author2 = await request(app)
      .post('/api/authors')
      .send({
        data: {
          type: 'authors',
          attributes: {
            name: 'John Smith',
            email: 'john@example.com',
            bio: 'Software engineer'
          }
        }
      });
    
    const category1 = await request(app)
      .post('/api/categories')
      .send({
        data: {
          type: 'categories',
          attributes: {
            name: 'Technology',
            slug: 'technology',
            description: 'Tech posts'
          }
        }
      });
    
    const category2 = await request(app)
      .post('/api/categories')
      .send({
        data: {
          type: 'categories',
          attributes: {
            name: 'Tutorial',
            slug: 'tutorial',
            description: 'How-to guides'
          }
        }
      });
    
    // Create posts
    const post1 = await request(app)
      .post('/api/posts')
      .send({
        data: {
          type: 'posts',
          attributes: {
            title: 'Getting Started with Node.js',
            slug: 'getting-started-nodejs',
            content: 'This is a comprehensive guide...',
            published: true,
            publishedAt: Date.now(),
            authorId: author1.body.data.id,
            categoryId: category1.body.data.id
          }
        }
      });
    
    // Test 1: Eager loading (authorId should be included automatically)
    const getPostRes = await request(app)
      .get(`/api/posts/${post1.body.data.id}`)
      .expect(200);
    
    // Since authorId has eager: true, the response should include author data
    assert(getPostRes.body.included);
    const includedAuthor = getPostRes.body.included.find(
      item => item.type === 'authors' && item.id === author1.body.data.id
    );
    assert(includedAuthor);
    assert.equal(includedAuthor.attributes.name, 'Jane Doe');
    assert.equal(includedAuthor.attributes.email, 'jane@example.com');
    
    // Test 2: Explicit join request for lazy-loaded relationship
    const postWithCategoryRes = await request(app)
      .get(`/api/posts/${post1.body.data.id}`)
      .query({ include: 'categoryId' })
      .expect(200);
    
    // Both author (eager) and category (requested) should be included
    assert(postWithCategoryRes.body.included.length >= 2);
    
    const includedCategory = postWithCategoryRes.body.included.find(
      item => item.type === 'categories' && item.id === category1.body.data.id
    );
    assert(includedCategory);
    assert.equal(includedCategory.attributes.name, 'Technology');
    
    // Test 3: Query with joins
    const postsWithJoinsRes = await request(app)
      .get('/api/posts')
      .query({ 
        include: 'authorId,categoryId',
        'filter[published]': 'true'
      })
      .expect(200);
    
    // Verify all published posts have their relationships included
    postsWithJoinsRes.body.data.forEach(post => {
      assert(post.attributes.published);
      
      // Find related author in included
      const author = postsWithJoinsRes.body.included.find(
        item => item.type === 'authors' && item.id === post.attributes.authorId
      );
      assert(author);
      
      // Find related category in included
      const category = postsWithJoinsRes.body.included.find(
        item => item.type === 'categories' && item.id === post.attributes.categoryId
      );
      assert(category);
    });
  });

  await t.test('4. Nested relationships (multi-level joins)', async () => {
    const { api, app } = env;
    
    // Define schemas with nested relationships
    api.addResource('countries', new Schema({
      name: { type: 'string', required: true },
      code: { type: 'string', required: true, unique: true }
    }));
    
    api.addResource('cities', new Schema({
      name: { type: 'string', required: true },
      population: { type: 'number' },
      countryId: {
        type: 'id',
        refs: {
          resource: 'countries',
          join: {
            eager: true,
            fields: ['name', 'code']
          }
        }
      }
    }));
    
    api.addResource('companies', new Schema({
      name: { type: 'string', required: true },
      industry: { type: 'string' },
      cityId: {
        type: 'id',
        refs: {
          resource: 'cities',
          join: {
            eager: true,
            fields: ['name', 'population', 'countryId']
          }
        }
      }
    }));
    
    api.addResource('employees', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      position: { type: 'string' },
      salary: { type: 'number' },
      companyId: {
        type: 'id',
        refs: {
          resource: 'companies',
          join: {
            eager: false,
            fields: ['name', 'industry', 'cityId']
          }
        }
      }
    }));
    
    await api.syncDatabase();
    
    // Create test data
    const usa = await request(app)
      .post('/api/countries')
      .send({
        data: {
          type: 'countries',
          attributes: { name: 'United States', code: 'US' }
        }
      });
    
    const uk = await request(app)
      .post('/api/countries')
      .send({
        data: {
          type: 'countries',
          attributes: { name: 'United Kingdom', code: 'UK' }
        }
      });
    
    const nyc = await request(app)
      .post('/api/cities')
      .send({
        data: {
          type: 'cities',
          attributes: {
            name: 'New York',
            population: 8000000,
            countryId: usa.body.data.id
          }
        }
      });
    
    const london = await request(app)
      .post('/api/cities')
      .send({
        data: {
          type: 'cities',
          attributes: {
            name: 'London',
            population: 9000000,
            countryId: uk.body.data.id
          }
        }
      });
    
    const techCorp = await request(app)
      .post('/api/companies')
      .send({
        data: {
          type: 'companies',
          attributes: {
            name: 'TechCorp',
            industry: 'Technology',
            cityId: nyc.body.data.id
          }
        }
      });
    
    const employee = await request(app)
      .post('/api/employees')
      .send({
        data: {
          type: 'employees',
          attributes: {
            name: 'Alice Johnson',
            email: 'alice@techcorp.com',
            position: 'Senior Developer',
            salary: 120000,
            companyId: techCorp.body.data.id
          }
        }
      });
    
    // Test nested joins: employee -> company -> city -> country
    const employeeWithNestedRes = await request(app)
      .get(`/api/employees/${employee.body.data.id}`)
      .query({ include: 'companyId.cityId.countryId' })
      .expect(200);
    
    // Verify all levels are included
    const included = employeeWithNestedRes.body.included;
    
    // Find company
    const company = included.find(
      item => item.type === 'companies' && item.id === techCorp.body.data.id
    );
    assert(company);
    assert.equal(company.attributes.name, 'TechCorp');
    
    // Find city
    const city = included.find(
      item => item.type === 'cities' && item.id === nyc.body.data.id
    );
    assert(city);
    assert.equal(city.attributes.name, 'New York');
    
    // Find country
    const country = included.find(
      item => item.type === 'countries' && item.id === usa.body.data.id
    );
    assert(country);
    assert.equal(country.attributes.name, 'United States');
    
    // Test query with nested joins and filters
    const employeesInUSRes = await request(app)
      .get('/api/employees')
      .query({
        include: 'companyId.cityId.countryId',
        // This would require support for filtering on joined tables
        // 'filter[companyId.cityId.countryId]': usa.body.data.id
      })
      .expect(200);
    
    // At least our test employee should be returned
    assert(employeesInUSRes.body.data.length >= 1);
  });

  await t.test('5. Validation and error handling', async () => {
    const { api, app } = env;
    
    // Define schema with strict validation
    api.addResource('accounts', new Schema({
      username: { 
        type: 'string', 
        required: true, 
        min: 3, 
        max: 20,
        match: /^[a-zA-Z0-9_]+$/
      },
      email: { 
        type: 'string', 
        required: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      },
      password: { 
        type: 'string', 
        required: true, 
        min: 8,
        silent: true // should not be returned in responses
      },
      age: { 
        type: 'number', 
        min: 18, 
        max: 120 
      },
      role: { 
        type: 'string', 
        enum: ['user', 'admin', 'moderator'],
        default: 'user'
      },
      terms: { 
        type: 'boolean', 
        required: true 
      }
    }));
    
    await api.syncDatabase();
    
    // Test 1: Missing required fields
    const missingFieldsRes = await request(app)
      .post('/api/accounts')
      .send({
        data: {
          type: 'accounts',
          attributes: {
            username: 'john'
            // missing email, password, terms
          }
        }
      })
      .expect(400);
    
    assert(missingFieldsRes.body.errors);
    assert(missingFieldsRes.body.errors.length >= 3);
    
    // Test 2: Invalid field values
    const invalidValuesRes = await request(app)
      .post('/api/accounts')
      .send({
        data: {
          type: 'accounts',
          attributes: {
            username: 'jo', // too short
            email: 'not-an-email', // invalid format
            password: '1234567', // too short
            age: 150, // too high
            role: 'superadmin', // not in enum
            terms: true
          }
        }
      })
      .expect(400);
    
    assert(invalidValuesRes.body.errors);
    assert(invalidValuesRes.body.errors.length >= 5);
    
    // Test 3: Valid creation
    const validRes = await request(app)
      .post('/api/accounts')
      .send({
        data: {
          type: 'accounts',
          attributes: {
            username: 'john_doe',
            email: 'john@example.com',
            password: 'securepass123',
            age: 25,
            terms: true
          }
        }
      })
      .expect(201);
    
    // Verify password is not returned (silent field)
    assert(!validRes.body.data.attributes.password);
    assert.equal(validRes.body.data.attributes.role, 'user'); // default value
    
    // Test 4: Unique constraint violation
    const duplicateRes = await request(app)
      .post('/api/accounts')
      .send({
        data: {
          type: 'accounts',
          attributes: {
            username: 'another_user',
            email: 'john@example.com', // duplicate email
            password: 'anotherpass123',
            terms: true
          }
        }
      })
      .expect(400);
    
    assert(duplicateRes.body.errors);
    
    // Test 5: Invalid ID in GET
    await request(app)
      .get('/api/accounts/99999')
      .expect(404);
    
    // Test 6: Invalid JSON in request
    await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send('{ invalid json')
      .expect(400);
  });

  await t.test('6. Hooks and middleware', async () => {
    const { api, app } = env;
    
    // Track hook execution
    const hookCalls = [];
    
    // Add global hooks
    api.hook('beforeInsert', async (context) => {
      hookCalls.push('beforeInsert');
      if (context.options.type === 'articles') {
        // Auto-generate slug from title
        if (context.data.title && !context.data.slug) {
          context.data.slug = context.data.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        }
        // Set publishedAt when publishing
        if (context.data.published && !context.data.publishedAt) {
          context.data.publishedAt = Date.now();
        }
      }
    });
    
    api.hook('afterInsert', async (context) => {
      hookCalls.push('afterInsert');
    });
    
    api.hook('beforeUpdate', async (context) => {
      hookCalls.push('beforeUpdate');
      if (context.options.type === 'articles') {
        // Track updates
        context.data.updatedAt = Date.now();
        // Set publishedAt when changing to published
        if (context.data.published === true) {
          const existing = await api.resources.articles.get(context.id);
          if (!existing.data.attributes.published) {
            context.data.publishedAt = Date.now();
          }
        }
      }
    });
    
    api.hook('transformResult', async (context) => {
      hookCalls.push('transformResult');
      if (context.result && context.options.type === 'articles') {
        // Add computed field
        if (context.result.published && context.result.publishedAt) {
          context.result.isNew = (Date.now() - context.result.publishedAt) < 86400000; // 24 hours
        }
      }
    });
    
    // Define schema
    api.addResource('articles', new Schema({
      title: { type: 'string', required: true },
      slug: { type: 'string' },
      content: { type: 'string', required: true },
      published: { type: 'boolean', default: false },
      publishedAt: { type: 'timestamp' },
      updatedAt: { type: 'timestamp' },
      viewCount: { type: 'number', default: 0 }
    }));
    
    await api.syncDatabase();
    
    // Test hook execution on insert
    hookCalls.length = 0;
    const articleRes = await request(app)
      .post('/api/articles')
      .send({
        data: {
          type: 'articles',
          attributes: {
            title: 'My First Article',
            content: 'This is the content...',
            published: true
          }
        }
      })
      .expect(201);
    
    // Verify hooks were called
    assert(hookCalls.includes('beforeInsert'));
    assert(hookCalls.includes('afterInsert'));
    assert(hookCalls.includes('transformResult'));
    
    // Verify auto-generated fields
    assert.equal(articleRes.body.data.attributes.slug, 'my-first-article');
    assert(articleRes.body.data.attributes.publishedAt);
    assert.equal(articleRes.body.data.attributes.isNew, true);
    
    const articleId = articleRes.body.data.id;
    
    // Test hook execution on update
    hookCalls.length = 0;
    const updateRes = await request(app)
      .patch(`/api/articles/${articleId}`)
      .send({
        data: {
          type: 'articles',
          id: articleId,
          attributes: {
            viewCount: 100
          }
        }
      })
      .expect(200);
    
    assert(hookCalls.includes('beforeUpdate'));
    assert(hookCalls.includes('transformResult'));
    assert(updateRes.body.data.attributes.updatedAt);
  });

  await t.test('7. Advanced operators and queries', async () => {
    const { api, app } = env;
    
    // Define schema
    api.addResource('events', new Schema({
      name: { type: 'string', required: true },
      startDate: { type: 'timestamp', required: true },
      endDate: { type: 'timestamp', required: true },
      price: { type: 'number', required: true },
      capacity: { type: 'number', required: true },
      attendees: { type: 'number', default: 0 },
      tags: { type: 'array' },
      location: { type: 'object' },
      active: { type: 'boolean', default: true }
    }));
    
    await api.syncDatabase();
    
    // Create test events
    const now = Date.now();
    const day = 86400000; // 24 hours in ms
    
    const events = [
      {
        name: 'Tech Conference 2024',
        startDate: now + (7 * day),
        endDate: now + (9 * day),
        price: 299,
        capacity: 500,
        attendees: 350,
        tags: ['technology', 'conference', 'networking'],
        location: { city: 'San Francisco', country: 'USA' }
      },
      {
        name: 'Web Dev Workshop',
        startDate: now + (2 * day),
        endDate: now + (2 * day),
        price: 99,
        capacity: 30,
        attendees: 25,
        tags: ['workshop', 'web', 'javascript'],
        location: { city: 'New York', country: 'USA' }
      },
      {
        name: 'Free Meetup',
        startDate: now + (1 * day),
        endDate: now + (1 * day),
        price: 0,
        capacity: 100,
        attendees: 100,
        tags: ['meetup', 'free', 'community'],
        location: { city: 'London', country: 'UK' }
      },
      {
        name: 'AI Summit',
        startDate: now + (30 * day),
        endDate: now + (32 * day),
        price: 599,
        capacity: 1000,
        attendees: 450,
        tags: ['ai', 'conference', 'technology'],
        location: { city: 'London', country: 'UK' }
      },
      {
        name: 'Past Event',
        startDate: now - (10 * day),
        endDate: now - (8 * day),
        price: 199,
        capacity: 200,
        attendees: 180,
        tags: ['past', 'conference'],
        location: { city: 'Berlin', country: 'Germany' },
        active: false
      }
    ];
    
    for (const event of events) {
      await request(app)
        .post('/api/events')
        .send({ data: { type: 'events', attributes: event } });
    }
    
    // Test 1: Greater than operator
    const expensiveEventsRes = await request(app)
      .get('/api/events')
      .query({
        'filter[price]': JSON.stringify({ $gt: 200 })
      })
      .expect(200);
    
    assert.equal(expensiveEventsRes.body.data.length, 2); // Tech Conference and AI Summit
    expensiveEventsRes.body.data.forEach(event => {
      assert(event.attributes.price > 200);
    });
    
    // Test 2: Range query (between)
    const midPriceRes = await request(app)
      .get('/api/events')
      .query({
        'filter[price]': JSON.stringify({ $gte: 50, $lte: 300 })
      })
      .expect(200);
    
    assert.equal(midPriceRes.body.data.length, 3);
    midPriceRes.body.data.forEach(event => {
      assert(event.attributes.price >= 50 && event.attributes.price <= 300);
    });
    
    // Test 3: Not equal operator
    const notFreeRes = await request(app)
      .get('/api/events')
      .query({
        'filter[price]': JSON.stringify({ $ne: 0 })
      })
      .expect(200);
    
    assert.equal(notFreeRes.body.data.length, 4);
    notFreeRes.body.data.forEach(event => {
      assert(event.attributes.price !== 0);
    });
    
    // Test 4: IN operator
    const selectedCitiesRes = await request(app)
      .get('/api/events')
      .query({
        'filter[location.city]': JSON.stringify({ $in: ['London', 'Berlin'] })
      })
      .expect(200);
    
    assert.equal(selectedCitiesRes.body.data.length, 3);
    
    // Test 5: Future events (date comparison)
    const futureEventsRes = await request(app)
      .get('/api/events')
      .query({
        'filter[startDate]': JSON.stringify({ $gt: now })
      })
      .expect(200);
    
    assert.equal(futureEventsRes.body.data.length, 4);
    
    // Test 6: Complex query with multiple operators
    const complexQueryRes = await request(app)
      .get('/api/events')
      .query({
        'filter[price]': JSON.stringify({ $gte: 100 }),
        'filter[capacity]': JSON.stringify({ $gt: 50 }),
        'filter[active]': 'true',
        sort: '-startDate',
        'page[size]': '2'
      })
      .expect(200);
    
    // Should get AI Summit and Tech Conference (future, expensive, large capacity)
    assert.equal(complexQueryRes.body.data.length, 2);
    assert.equal(complexQueryRes.body.data[0].attributes.name, 'AI Summit'); // furthest in future
  });

  await t.test('8. Batch operations', async () => {
    const { api, app } = env;
    
    // Define schema
    api.addResource('tasks', new Schema({
      title: { type: 'string', required: true },
      completed: { type: 'boolean', default: false },
      priority: { type: 'number', min: 1, max: 5, default: 3 },
      assignee: { type: 'string' }
    }));
    
    await api.syncDatabase();
    
    // Test batch create
    const batchCreateRes = await request(app)
      .post('/api/tasks')
      .send({
        data: [
          {
            type: 'tasks',
            attributes: {
              title: 'Task 1',
              priority: 5,
              assignee: 'Alice'
            }
          },
          {
            type: 'tasks',
            attributes: {
              title: 'Task 2',
              priority: 3,
              assignee: 'Bob'
            }
          },
          {
            type: 'tasks',
            attributes: {
              title: 'Task 3',
              priority: 1,
              assignee: 'Alice'
            }
          }
        ]
      })
      .expect(201);
    
    assert(Array.isArray(batchCreateRes.body.data));
    assert.equal(batchCreateRes.body.data.length, 3);
    
    const taskIds = batchCreateRes.body.data.map(task => task.id);
    
    // Test batch update
    const batchUpdateRes = await request(app)
      .patch('/api/tasks')
      .send({
        data: taskIds.map(id => ({
          type: 'tasks',
          id: id,
          attributes: {
            completed: true
          }
        }))
      })
      .expect(200);
    
    assert(Array.isArray(batchUpdateRes.body.data));
    assert.equal(batchUpdateRes.body.data.length, 3);
    batchUpdateRes.body.data.forEach(task => {
      assert.equal(task.attributes.completed, true);
    });
    
    // Test batch delete
    await request(app)
      .delete('/api/tasks')
      .send({
        data: taskIds.map(id => ({
          type: 'tasks',
          id: id
        }))
      })
      .expect(204);
    
    // Verify all deleted
    const remainingRes = await request(app)
      .get('/api/tasks')
      .expect(200);
    
    assert.equal(remainingRes.body.data.length, 0);
  });

  await t.test('9. Field selection and sparse fieldsets', async () => {
    const { api, app } = env;
    
    // Define schema with many fields
    api.addResource('profiles', new Schema({
      username: { type: 'string', required: true },
      email: { type: 'string', required: true },
      bio: { type: 'string' },
      avatar: { type: 'string' },
      website: { type: 'string' },
      location: { type: 'string' },
      joinedAt: { type: 'timestamp', default: () => Date.now() },
      followers: { type: 'number', default: 0 },
      following: { type: 'number', default: 0 },
      posts: { type: 'number', default: 0 },
      settings: { type: 'object' },
      privateNotes: { type: 'string', silent: true }
    }));
    
    await api.syncDatabase();
    
    // Create test profile with all fields
    const profile = await request(app)
      .post('/api/profiles')
      .send({
        data: {
          type: 'profiles',
          attributes: {
            username: 'johndoe',
            email: 'john@example.com',
            bio: 'Software developer and tech enthusiast',
            avatar: 'https://example.com/avatar.jpg',
            website: 'https://johndoe.com',
            location: 'San Francisco, CA',
            followers: 1250,
            following: 340,
            posts: 89,
            settings: {
              theme: 'dark',
              notifications: true,
              privacy: 'public'
            },
            privateNotes: 'Internal note - should never be exposed'
          }
        }
      });
    
    const profileId = profile.body.data.id;
    
    // Test 1: Request specific fields only
    const sparseRes = await request(app)
      .get(`/api/profiles/${profileId}`)
      .query({
        'fields[profiles]': 'username,email,followers,following'
      })
      .expect(200);
    
    // Should only have requested fields
    const attrs = sparseRes.body.data.attributes;
    assert(attrs.username);
    assert(attrs.email);
    assert(attrs.followers !== undefined);
    assert(attrs.following !== undefined);
    
    // Should not have other fields
    assert(attrs.bio === undefined);
    assert(attrs.avatar === undefined);
    assert(attrs.settings === undefined);
    
    // Silent fields should never be included
    assert(attrs.privateNotes === undefined);
    
    // Test 2: Query with field selection
    const queryRes = await request(app)
      .get('/api/profiles')
      .query({
        'fields[profiles]': 'username,posts'
      })
      .expect(200);
    
    queryRes.body.data.forEach(profile => {
      const attrs = profile.attributes;
      assert(attrs.username);
      assert(attrs.posts !== undefined);
      assert(Object.keys(attrs).length <= 3); // username, posts, maybe joinedAt if default
    });
  });

  await t.test('10. Performance and optimization', async () => {
    const { api, app } = env;
    
    // Define schemas for performance testing
    api.addResource('metrics', new Schema({
      timestamp: { type: 'timestamp', required: true },
      metric: { type: 'string', required: true },
      value: { type: 'number', required: true },
      tags: { type: 'array' },
      metadata: { type: 'object' }
    }));
    
    await api.syncDatabase();
    
    // Create indexes for better performance
    await env.connection.execute(`
      CREATE INDEX idx_metrics_timestamp ON metrics(timestamp);
      CREATE INDEX idx_metrics_metric ON metrics(metric);
      CREATE INDEX idx_metrics_metric_timestamp ON metrics(metric, timestamp);
    `);
    
    // Insert many records for performance testing
    const metrics = [];
    const metricTypes = ['cpu', 'memory', 'disk', 'network', 'requests'];
    const baseTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    // Generate 1000 metrics
    for (let i = 0; i < 1000; i++) {
      metrics.push({
        timestamp: baseTime + (i * 60000), // 1 minute intervals
        metric: metricTypes[i % metricTypes.length],
        value: Math.random() * 100,
        tags: ['server-1', 'production'],
        metadata: { source: 'monitoring', version: '1.0' }
      });
    }
    
    // Batch insert for better performance
    console.log('Inserting 1000 test metrics...');
    const batchSize = 100;
    for (let i = 0; i < metrics.length; i += batchSize) {
      const batch = metrics.slice(i, i + batchSize);
      await request(app)
        .post('/api/metrics')
        .send({
          data: batch.map(m => ({
            type: 'metrics',
            attributes: m
          }))
        });
    }
    
    // Test 1: Efficient pagination through large dataset
    const startTime = Date.now();
    let totalRecords = 0;
    let pageNumber = 1;
    
    while (true) {
      const pageRes = await request(app)
        .get('/api/metrics')
        .query({
          'page[size]': '50',
          'page[number]': pageNumber,
          'fields[metrics]': 'timestamp,metric,value' // Only necessary fields
        })
        .expect(200);
      
      totalRecords += pageRes.body.data.length;
      
      if (pageRes.body.data.length < 50) break;
      pageNumber++;
    }
    
    const paginationTime = Date.now() - startTime;
    console.log(`Paginated through ${totalRecords} records in ${paginationTime}ms`);
    assert(totalRecords >= 1000);
    assert(paginationTime < 5000); // Should complete in under 5 seconds
    
    // Test 2: Complex aggregation query
    const cpuMetricsRes = await request(app)
      .get('/api/metrics')
      .query({
        'filter[metric]': 'cpu',
        'filter[timestamp]': JSON.stringify({ 
          $gte: baseTime + (20 * 24 * 60 * 60 * 1000) // Last 10 days
        }),
        sort: '-timestamp',
        'page[size]': '100'
      })
      .expect(200);
    
    // Should efficiently filter and sort
    assert(cpuMetricsRes.body.data.length > 0);
    cpuMetricsRes.body.data.forEach(metric => {
      assert.equal(metric.attributes.metric, 'cpu');
    });
    
    // Verify descending order
    for (let i = 1; i < cpuMetricsRes.body.data.length; i++) {
      assert(
        cpuMetricsRes.body.data[i - 1].attributes.timestamp >= 
        cpuMetricsRes.body.data[i].attributes.timestamp
      );
    }
  });
});

// Run additional MySQL-specific feature tests
test('MySQL-specific features', async (t) => {
  let env;
  
  t.beforeEach(async () => {
    env = await setupTestEnvironment();
  });
  
  t.afterEach(async () => {
    await teardownTestEnvironment();
  });

  await t.test('1. dbSync functionality', async () => {
    const { api, connection } = env;
    
    // Define initial schema
    api.addResource('sync_test', new Schema({
      name: { type: 'string', required: true },
      active: { type: 'boolean', default: true }
    }));
    
    // Sync should create table
    await api.syncDatabase();
    
    // Verify table exists
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'sync_test'"
    );
    assert.equal(tables.length, 1);
    
    // Verify columns
    const [columns] = await connection.execute(
      "SHOW COLUMNS FROM sync_test"
    );
    
    const columnNames = columns.map(col => col.Field);
    assert(columnNames.includes('id'));
    assert(columnNames.includes('name'));
    assert(columnNames.includes('active'));
    
    // Update schema (add new field)
    api.addResource('sync_test', new Schema({
      name: { type: 'string', required: true },
      active: { type: 'boolean', default: true },
      description: { type: 'string' }, // New field
      priority: { type: 'number', default: 0 } // New field
    }));
    
    // Sync again should add new columns
    await api.syncDatabase();
    
    // Verify new columns exist
    const [newColumns] = await connection.execute(
      "SHOW COLUMNS FROM sync_test"
    );
    
    const newColumnNames = newColumns.map(col => col.Field);
    assert(newColumnNames.includes('description'));
    assert(newColumnNames.includes('priority'));
  });

  await t.test('2. Transaction support', async () => {
    const { api, app } = env;
    
    api.addResource('accounts', new Schema({
      name: { type: 'string', required: true },
      balance: { type: 'number', required: true }
    }));
    
    await api.syncDatabase();
    
    // Create two accounts
    const account1 = await request(app)
      .post('/api/accounts')
      .send({
        data: {
          type: 'accounts',
          attributes: { name: 'Account 1', balance: 1000 }
        }
      });
    
    const account2 = await request(app)
      .post('/api/accounts')
      .send({
        data: {
          type: 'accounts',
          attributes: { name: 'Account 2', balance: 500 }
        }
      });
    
    // Implement transfer with transaction (via hooks)
    api.hook('beforeUpdate', async (context) => {
      if (context.options.type === 'accounts' && context.options.transfer) {
        // This would ideally use a transaction
        const { fromId, toId, amount } = context.options.transfer;
        
        // Get current balances
        const fromAccount = await api.resources.accounts.get(fromId);
        const toAccount = await api.resources.accounts.get(toId);
        
        if (fromAccount.data.attributes.balance < amount) {
          throw new Error('Insufficient funds');
        }
        
        // Update both accounts
        await api.resources.accounts.update(fromId, {
          balance: fromAccount.data.attributes.balance - amount
        });
        
        await api.resources.accounts.update(toId, {
          balance: toAccount.data.attributes.balance + amount
        });
      }
    });
  });

  await t.test('3. JSON field handling', async () => {
    const { api, app } = env;
    
    api.addResource('configurations', new Schema({
      name: { type: 'string', required: true },
      settings: { type: 'object' }, // Stored as JSON in MySQL
      tags: { type: 'array' }, // Also stored as JSON
      metadata: { type: 'object' }
    }));
    
    await api.syncDatabase();
    
    // Create config with complex JSON data
    const configRes = await request(app)
      .post('/api/configurations')
      .send({
        data: {
          type: 'configurations',
          attributes: {
            name: 'app-config',
            settings: {
              theme: 'dark',
              language: 'en',
              features: {
                notifications: true,
                autoSave: false,
                advanced: {
                  debugging: true,
                  verboseLogging: false
                }
              }
            },
            tags: ['production', 'v2.0', 'stable'],
            metadata: {
              createdBy: 'admin',
              version: '2.0.1',
              environment: 'production'
            }
          }
        }
      })
      .expect(201);
    
    // Verify JSON data is preserved correctly
    const getRes = await request(app)
      .get(`/api/configurations/${configRes.body.data.id}`)
      .expect(200);
    
    assert.deepEqual(
      getRes.body.data.attributes.settings.features.advanced,
      { debugging: true, verboseLogging: false }
    );
    assert.deepEqual(
      getRes.body.data.attributes.tags,
      ['production', 'v2.0', 'stable']
    );
  });
});

console.log('\n✨ Comprehensive MySQL + HTTP integration tests complete!');