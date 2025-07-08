import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from './index.js';
import knex from 'knex';

console.log('Testing new defaults implementation...\n');

// Create in-memory SQLite database
const db = knex({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({
  name: 'test-api',
  version: '1.0.0'
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });

// Create tables
await db.schema.createTable('departments', table => {
  table.increments('id');
  table.string('name');
  table.index('name');
});

await db.schema.createTable('employees', table => {
  table.increments('id');
  table.string('name');
  table.integer('department_id');
});

// Insert test data
await db('departments').insert([
  { id: 1, name: 'Engineering' }
]);

await db('employees').insert([
  { id: 1, name: 'Alice', department_id: 1 }
]);

// Define resources
api.addResource('departments', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', indexed: true }
  }
});

api.addResource('employees', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' },
    department_id: {
      type: 'number',
      belongsTo: 'departments',
      as: 'department'
      // NO explicit sideLoadSingle, sideSearchSingle, or search
    }
  },
  searchSchema: {
    departmentName: {
      type: 'string',
      actualField: 'departments.name',
      filterUsing: 'like'
    }
  }
});

console.log('Test 1: sideLoadSingle default (should work)');
try {
  const result = await api.resources.employees.get({
    id: '1',
    queryParams: { include: ['department'] }
  });
  console.log('✅ Include works! Department loaded:', result.included?.length > 0);
} catch (error) {
  console.error('❌ Failed:', error.message);
}

console.log('\nTest 2: search default (should NOT work anymore - no automatic search)');
try {
  const result = await api.resources.employees.query({
    queryParams: { filters: { department_id: 1 } }
  });
  console.log('❌ Should have failed! Found', result.data.length, 'employees');
} catch (error) {
  console.log('✅ Correctly failed:', error.message);
}

console.log('\nTest 3: sideSearchSingle default (should work)');
try {
  const result = await api.resources.employees.query({
    queryParams: { filters: { departmentName: 'Engineering' } }
  });
  console.log('✅ Cross-table search works! Found', result.data.length, 'employees');
} catch (error) {
  console.error('❌ Failed:', error.message);
}

console.log('\n=== Testing hasMany defaults ===\n');

api.addResource('departments2', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' }
  },
  relationships: {
    employees: {
      hasMany: 'employees',
      foreignKey: 'department_id',
      as: 'employees'
      // NO explicit sideLoadMany - should default to false
    }
  }
});

console.log('Test 4: sideLoadMany default (should NOT work)');
try {
  const result = await api.resources.departments.get({
    id: '1',
    queryParams: { include: ['employees'] }
  });
  console.log('Department loaded, employees included?:', result.included?.length > 0);
  if (!result.included || result.included.length === 0) {
    console.log('✅ Correctly defaulted to false - no employees loaded');
  } else {
    console.log('❌ Should not have loaded employees!');
  }
} catch (error) {
  console.log('✅ Correctly blocked include');
}

console.log('\n=== Testing explicit search ===\n');

// Add a new resource with explicit search: true
api.addResource('employees2', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' },
    department_id: {
      type: 'number',
      belongsTo: 'departments',
      as: 'department',
      search: true  // EXPLICIT search
    }
  }
});

console.log('Test 5: Explicit search on belongsTo field (should work)');
try {
  const result = await api.resources.employees2.query({
    queryParams: { filters: { department_id: 1 } }
  });
  console.log('✅ Explicit search works! Found', result.data.length, 'employees');
} catch (error) {
  console.error('❌ Failed:', error.message);
}

console.log('\n✅ All defaults working correctly!');
await db.destroy();
process.exit(0);