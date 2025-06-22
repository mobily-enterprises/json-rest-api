import test from 'ava';
import { Api } from '../../lib/api.js';
import { MemoryPlugin } from '../../plugins/memory.js';
import { MySQLPlugin } from '../../plugins/mysql.js';

// Test with both memory and MySQL backends
const testBackends = [
  { name: 'Memory', plugin: MemoryPlugin, options: {} },
  { 
    name: 'MySQL', 
    plugin: MySQLPlugin, 
    options: {
      connection: {
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'test_json_api'
      }
    },
    skip: !process.env.MYSQL_USER
  }
];

for (const backend of testBackends) {
  if (backend.skip) continue;
  
  test.serial(`${backend.name}: SQL injection in filter values`, async t => {
    const api = new Api();
    api.use(backend.plugin, backend.options);
    
    api.addResource('users', {
      name: { type: 'string', searchable: true },
      email: { type: 'string', searchable: true },
      role: { type: 'string', searchable: true }
    });
    
    await api.connect();
    
    try {
      // Create test data
      await api.insert({ name: 'Alice', email: 'alice@example.com', role: 'admin' }, { type: 'users' });
      await api.insert({ name: 'Bob', email: 'bob@example.com', role: 'user' }, { type: 'users' });
      
      // Attempt SQL injection in filter
      const maliciousFilters = [
        { name: "'; DROP TABLE users; --" },
        { name: "' OR '1'='1" },
        { email: "test@test.com' OR 1=1 --" },
        { role: "admin' UNION SELECT * FROM users --" },
        { name: "'; DELETE FROM users WHERE '1'='1" }
      ];
      
      for (const filter of maliciousFilters) {
        // Should either safely handle or reject the malicious input
        const result = await api.query({ filter }, { type: 'users' });
        
        // Verify no damage was done
        const allUsers = await api.query({}, { type: 'users' });
        t.is(allUsers.results.length, 2); // Both users still exist
      }
    } finally {
      await api.disconnect();
    }
  });
  
  test.serial(`${backend.name}: SQL injection in advanced operators`, async t => {
    const api = new Api();
    api.use(backend.plugin, backend.options);
    
    api.addResource('products', {
      name: { type: 'string', searchable: true },
      price: { type: 'number', searchable: true }
    });
    
    await api.connect();
    
    try {
      // Create test data
      await api.insert({ name: 'Product 1', price: 100 }, { type: 'products' });
      await api.insert({ name: 'Product 2', price: 200 }, { type: 'products' });
      
      // Test SQL injection in operator values
      const injectionAttempts = [
        { price: { gte: "100; DROP TABLE products; --" } },
        { price: { in: ["100' OR '1'='1", "200"] } },
        { name: { like: "%'; DELETE FROM products; --%" } },
        { price: { between: ["0", "1000'; DROP TABLE products; --"] } }
      ];
      
      for (const filter of injectionAttempts) {
        try {
          await api.query({ filter }, { type: 'products' });
        } catch (error) {
          // Expected - invalid values should be rejected
        }
        
        // Verify table still exists and data intact
        const products = await api.query({}, { type: 'products' });
        t.is(products.results.length, 2);
      }
    } finally {
      await api.disconnect();
    }
  });
  
  test.serial(`${backend.name}: SQL injection in sort parameters`, async t => {
    const api = new Api();
    api.use(backend.plugin, backend.options);
    
    api.addResource('items', {
      name: { type: 'string' },
      value: { type: 'number' }
    });
    
    await api.connect();
    
    try {
      await api.insert({ name: 'Item 1', value: 10 }, { type: 'items' });
      await api.insert({ name: 'Item 2', value: 20 }, { type: 'items' });
      
      // Attempt SQL injection in sort
      const maliciousSorts = [
        "name; DROP TABLE items; --",
        "value ASC, (SELECT * FROM items)",
        "name'; DELETE FROM items; --"
      ];
      
      for (const sort of maliciousSorts) {
        await t.throwsAsync(
          api.query({ sort }, { type: 'items' }),
          { message: /Invalid sort field/ }
        );
      }
      
      // Verify data intact
      const items = await api.query({}, { type: 'items' });
      t.is(items.results.length, 2);
    } finally {
      await api.disconnect();
    }
  });
  
  test.serial(`${backend.name}: SQL injection in ID parameters`, async t => {
    const api = new Api();
    api.use(backend.plugin, backend.options);
    
    api.addResource('records', {
      data: { type: 'string' }
    });
    
    await api.connect();
    
    try {
      const record = await api.insert({ data: 'test' }, { type: 'records' });
      
      // Attempt SQL injection in ID
      const maliciousIds = [
        "1' OR '1'='1",
        "1; DROP TABLE records; --",
        "1 UNION SELECT * FROM records",
        `${record.id}' OR '1'='1`
      ];
      
      for (const id of maliciousIds) {
        try {
          await api.get(id, { type: 'records' });
        } catch (error) {
          // Expected - should fail safely
        }
      }
      
      // Verify table intact
      const allRecords = await api.query({}, { type: 'records' });
      t.is(allRecords.results.length, 1);
    } finally {
      await api.disconnect();
    }
  });
  
  test.serial(`${backend.name}: SQL injection in data values`, async t => {
    const api = new Api();
    api.use(backend.plugin, backend.options);
    
    api.addResource('entries', {
      title: { type: 'string' },
      description: { type: 'string' }
    });
    
    await api.connect();
    
    try {
      // Attempt SQL injection in insert data
      const maliciousData = {
        title: "Normal'; DROP TABLE entries; --",
        description: "Test' OR '1'='1"
      };
      
      // Should safely insert the data as strings
      const entry = await api.insert(maliciousData, { type: 'entries' });
      
      // Verify data was inserted safely
      const retrieved = await api.get(entry.id, { type: 'entries' });
      t.is(retrieved.title, maliciousData.title);
      t.is(retrieved.description, maliciousData.description);
      
      // Table should still exist
      const allEntries = await api.query({}, { type: 'entries' });
      t.is(allEntries.results.length, 1);
    } finally {
      await api.disconnect();
    }
  });
  
  test.serial(`${backend.name}: Filter value validation prevents injection`, async t => {
    const api = new Api();
    api.use(backend.plugin, backend.options);
    
    api.addResource('accounts', {
      balance: { type: 'number', searchable: true },
      status: { type: 'string', searchable: true, pattern: '^[a-zA-Z]+$' }
    });
    
    await api.connect();
    
    try {
      await api.insert({ balance: 1000, status: 'active' }, { type: 'accounts' });
      
      // Test dangerous patterns in filter values
      const dangerousFilters = [
        { balance: "; DROP TABLE accounts; --" },
        { status: "active'; DELETE FROM accounts; --" },
        { balance: { gte: "0 UNION SELECT * FROM accounts" } }
      ];
      
      for (const filter of dangerousFilters) {
        await t.throwsAsync(
          api.query({ filter }, { type: 'accounts' }),
          { message: /Invalid|filter/ }
        );
      }
      
      // Pattern validation should reject SQL
      await t.throwsAsync(
        api.query({ filter: { status: "active' OR '1'='1" } }, { type: 'accounts' }),
        { message: /does not match required pattern/ }
      );
    } finally {
      await api.disconnect();
    }
  });
  
  test.serial(`${backend.name}: Nested field injection attempts`, async t => {
    const api = new Api();
    api.use(backend.plugin, backend.options);
    
    api.addResource('posts', {
      title: { type: 'string' },
      authorId: { type: 'id', refs: 'authors', searchable: true }
    });
    
    api.addResource('authors', {
      name: { type: 'string', searchable: true }
    });
    
    await api.connect();
    
    try {
      const author = await api.insert({ name: 'John' }, { type: 'authors' });
      await api.insert({ title: 'Post 1', authorId: author.id }, { type: 'posts' });
      
      // Configure searchable fields for joins
      api.resourceOptions = new Map();
      api.resourceOptions.set('posts', {
        searchableFields: {
          'author': 'authorId.name'
        }
      });
      
      // Attempt injection in nested field filter
      await t.throwsAsync(
        api.query({ 
          filter: { author: "John'; DROP TABLE posts; --" } 
        }, { type: 'posts' }),
        { message: /Invalid|not searchable/ }
      );
    } finally {
      await api.disconnect();
    }
  });
}