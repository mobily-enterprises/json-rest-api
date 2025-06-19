● Programmatic API Usage Guide

  Here's how to use the JSON REST API methods programmatically:

  Basic Setup

  import { createApi, Schema } from './json-rest-api/index.js';

  // Create API instance
  const api = createApi({
    storage: 'memory', // or 'mysql'
    http: false        // Disable HTTP if using programmatically only
  });

  // Define a schema
  const userSchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true, lowercase: true },
    age: { type: 'number', min: 0 },
    active: { type: 'boolean', default: true }
  });

  // Register schema
  api.addResource('users', userSchema);

  CRUD Operations

  1. Create (Insert)

  // Simple insert
  const newUser = await api.insert({
    name: 'John Doe',
    email: 'john@example.com',
    age: 30
  }, {
    type: 'users'
  });

  console.log(newUser);
  // Output: { data: { id: '1', type: 'users', attributes: { name: 'John 
  Doe', ... } } }

  // Insert with positioning (if PositioningPlugin is used)
  const secondUser = await api.insert({
    name: 'Jane Smith',
    email: 'jane@example.com',
    beforeId: null  // Place at end
  }, {
    type: 'users',
    positioning: { enabled: true }
  });

  2. Read (Get)

  // Get by ID
  const user = await api.get('1', {
    type: 'users'
  });

  console.log(user);
  // Output: { data: { id: '1', type: 'users', attributes: { ... } } }

  // Handle not found
  try {
    const notFound = await api.get('999', { type: 'users' });
  } catch (error) {
    console.log('User not found');
  }

  3. Update

  // Partial update
  const updated = await api.update('1', {
    age: 31,
    active: false
  }, {
    type: 'users'
  });

  // Update with validation context
  const updateWithContext = await api.update('1', {
    email: 'newemail@example.com'
  }, {
    type: 'users',
    userId: 'admin-123',  // For audit logging
    ipAddress: '192.168.1.1'
  });

  4. Delete

  // Delete by ID
  await api.delete('1', {
    type: 'users'
  });

  // Delete returns { data: null } on success

  5. Query (List)

  // Simple query
  const allUsers = await api.query({}, {
    type: 'users'
  });

  // Advanced query with filters
  const activeAdults = await api.query({
    filter: {
      active: true,
      age: { $gte: 18 }  // If your storage plugin supports operators
    },
    sort: '-age,name',    // Sort by age DESC, then name ASC
    page: {
      size: 20,
      number: 1
    }
  }, {
    type: 'users'
  });

  console.log(activeAdults);
  // Output: {
  //   data: [ { id: '1', type: 'users', attributes: {...} }, ... ],
  //   meta: { total: 45, pageSize: 20, pageNumber: 1, totalPages: 3 },
  //   links: { self: '...', next: '...', last: '...' }
  // }

  // Search (if configured)
  const searchResults = await api.query({
    search: 'john',
    filter: { active: true }
  }, {
    type: 'users',
    searchFields: ['name', 'email']
  });

  Advanced Usage

  With MySQL Storage

  import { Api, MySQLPlugin, ValidationPlugin } from
  './json-rest-api/index.js';

  const api = new Api()
    .use(ValidationPlugin)
    .use(MySQLPlugin, {
      connection: {
        host: 'localhost',
        user: 'root',
        password: 'password',
        database: 'myapp'
      }
    });

  // Sync schema with database
  await api.syncSchema(userSchema, 'users');

  // Use with table specification
  const user = await api.insert({
    name: 'Database User',
    email: 'db@example.com'
  }, {
    type: 'users',
    table: 'users',  // MySQL table name
    connection: 'default'
  });

  With Authentication Context

  // Add security plugin
  api.use(SecurityPlugin);

  // All operations can include auth context
  const result = await api.insert({
    title: 'Secure Post',
    content: 'This is secure'
  }, {
    type: 'posts',
    userId: 'user-123',      // From decoded JWT
    authenticated: true,
    permissions: ['create', 'read']
  });

  Batch Operations

  // Insert multiple records
  const users = [
    { name: 'User 1', email: 'user1@example.com' },
    { name: 'User 2', email: 'user2@example.com' },
    { name: 'User 3', email: 'user3@example.com' }
  ];

  const created = await Promise.all(
    users.map(user => api.insert(user, { type: 'users' }))
  );

  // Update multiple records
  const updates = [
    { id: '1', data: { active: false } },
    { id: '2', data: { active: false } },
    { id: '3', data: { active: false } }
  ];

  await Promise.all(
    updates.map(({ id, data }) =>
      api.update(id, data, { type: 'users' })
    )
  );

  With Transactions (MySQL)

  // Get connection pool
  const { pool } = api.getConnection();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Create user
    const user = await api.insert({
      name: 'Transaction User',
      email: 'tx@example.com'
    }, {
      type: 'users',
      connection  // Pass connection for transaction
    });

    // Create related profile
    await api.insert({
      userId: user.data.id,
      bio: 'Created in transaction'
    }, {
      type: 'profiles',
      connection
    });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  With Custom Validation

  // Add custom validation hook
  api.hook('afterValidate', async (context) => {
    if (context.options.type === 'users') {
      const { data, method } = context;

      // Check email uniqueness
      if ((method === 'insert' || method === 'update') && data.email) {
        const existing = await api.query({
          filter: { email: data.email }
        }, { type: 'users' });

        if (existing.data.length > 0) {
          context.errors.push({
            field: 'email',
            message: 'Email already exists',
            code: 'DUPLICATE_EMAIL'
          });
        }
      }
    }
  });

  Error Handling

  try {
    const user = await api.insert({
      name: 'J',  // Too short!
      email: 'invalid-email'
    }, { type: 'users' });
  } catch (error) {
    if (error.errors) {
      // Validation errors
      error.errors.forEach(err => {
        console.log(`${err.field}: ${err.message}`);
      });
    } else {
      // Other errors
      console.error('Unexpected error:', error);
    }
  }

  Direct Storage Access

  // If you need direct access to storage
  if (api.memoryData) {
    // Direct memory access
    console.log('All data:', api.memoryData);
  }

  if (api.mysqlPools) {
    // Direct MySQL access
    const { pool } = api.getConnection();
    const [rows] = await pool.query('SELECT * FROM users WHERE active = ?',
   [true]);
  }

  Complete Example: Task Manager

  import { createApi, Schema, PositioningPlugin } from
  './json-rest-api/index.js';

  // Create API
  const api = createApi({ storage: 'memory' })
    .use(PositioningPlugin);

  // Define schema
  const taskSchema = new Schema({
    id: { type: 'id' },
    title: { type: 'string', required: true, min: 1, max: 200 },
    description: { type: 'string', max: 1000 },
    completed: { type: 'boolean', default: false },
    priority: { type: 'string', enum: ['low', 'medium', 'high'], default:
  'medium' },
    dueDate: { type: 'date' },
    position: { type: 'number' },
    createdAt: { type: 'timestamp', default: () => Date.now() }
  });

  api.addResource('tasks', taskSchema);

  // Usage
  async function taskManager() {
    // Create tasks
    const task1 = await api.insert({
      title: 'Write documentation',
      priority: 'high',
      dueDate: '2024-12-31'
    }, { type: 'tasks' });

    const task2 = await api.insert({
      title: 'Review PR',
      priority: 'medium',
      beforeId: task1.data.id  // Position before first task
    }, {
      type: 'tasks',
      positioning: { enabled: true }
    });

    // List high priority incomplete tasks
    const urgent = await api.query({
      filter: {
        completed: false,
        priority: 'high'
      },
      sort: 'position,dueDate'
    }, { type: 'tasks' });

    console.log(`Found ${urgent.meta.total} urgent tasks`);

    // Complete a task
    await api.update(task1.data.id, {
      completed: true
    }, { type: 'tasks' });

    // Reorder tasks
    await api.reposition('tasks', task2.data.id, null); // Move to end
  }

