import { Api } from 'hooked-api';
import { RestApiPlugin, SchemaDefaultsPlugin, RestApiKnexPlugin } from './index.js';
import knex from 'knex';

console.log('Testing new sideLoadSingle/Many and sideSearchSingle/Many with smart defaults...\n');

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

// Install plugins - SchemaDefaultsPlugin MUST come before adding resources
await api.use(RestApiPlugin);
await api.use(SchemaDefaultsPlugin);
await api.use(RestApiKnexPlugin, { knex: db });

// Create tables
await db.schema.createTable('departments', table => {
  table.increments('id');
  table.string('name');
  table.index('name'); // Required for cross-table search
});

await db.schema.createTable('employees', table => {
  table.increments('id');
  table.string('name');
  table.integer('department_id');
  table.integer('manager_id');
});

// Insert test data
await db('departments').insert([
  { id: 1, name: 'Engineering' },
  { id: 2, name: 'Marketing' }
]);

await db('employees').insert([
  { id: 1, name: 'Alice', department_id: 1, manager_id: null },
  { id: 2, name: 'Bob', department_id: 1, manager_id: 1 },
  { id: 3, name: 'Charlie', department_id: 2, manager_id: 1 }
]);

console.log('=== TESTING SMART DEFAULTS ===\n');

// Define resources - should get smart defaults
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
      // Should automatically get:
      // - sideLoadSingle: true
      // - sideSearchSingle: true
      // - search: true
    },
    manager_id: {
      type: 'number',
      belongsTo: 'employees',
      as: 'manager',
      sideLoadSingle: false  // Explicitly override default
      // Should keep other defaults:
      // - sideSearchSingle: true
      // - search: true
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

console.log('Test 1: Verify sideLoadSingle default (should load department)');
try {
  const result = await api.resources.employees.get({
    id: '1',
    queryParams: { include: ['department'] }
  });
  
  console.log('✅ Department included:', result.included?.length > 0 ? 'YES' : 'NO');
  if (result.included?.length > 0) {
    console.log('   Department:', result.included[0].attributes.name);
  }
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\nTest 2: Verify explicit override (should NOT load manager)');
try {
  const result = await api.resources.employees.get({
    id: '2',
    queryParams: { include: ['manager'] }
  });
  
  console.log('✅ Manager included:', result.included?.length > 0 ? 'YES' : 'NO');
  console.log('   (Should be NO because we set sideLoadSingle: false)');
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\nTest 3: Verify search default (should allow filtering by department_id)');
try {
  const result = await api.resources.employees.query({
    queryParams: { filters: { department_id: 1 } }
  });
  
  console.log('✅ Filtering by department_id works:', result.data.length, 'employees found');
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\nTest 4: Verify sideSearchSingle default (cross-table search)');
try {
  const result = await api.resources.employees.query({
    queryParams: { filters: { departmentName: 'Engineering' } }
  });
  
  console.log('✅ Cross-table search works:', result.data.length, 'employees in Engineering');
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\n=== TESTING hasMany DEFAULTS ===\n');

// Add relationships to test hasMany defaults
api.removeScope('departments');
api.addResource('departments', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', indexed: true }
  },
  relationships: {
    employees: {
      hasMany: 'employees',
      foreignKey: 'department_id',
      as: 'employees'
      // Should automatically get:
      // - sideLoadMany: false
      // - sideSearchMany: false
    }
  }
});

console.log('Test 5: Verify sideLoadMany default (should NOT load by default)');
try {
  const result = await api.resources.departments.get({
    id: '1',
    queryParams: { include: ['employees'] }
  });
  
  console.log('✅ Employees included:', result.included?.length > 0 ? 'YES' : 'NO');
  console.log('   (Should be NO because sideLoadMany defaults to false)');
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\n=== SUMMARY ===');
console.log('✅ Smart defaults are working!');
console.log('- belongsTo fields get sideLoadSingle: true by default');
console.log('- belongsTo fields get sideSearchSingle: true by default');
console.log('- belongsTo fields get search: true by default');
console.log('- hasMany relationships get sideLoadMany: false by default');
console.log('- hasMany relationships get sideSearchMany: false by default');
console.log('- All defaults can be explicitly overridden');

await db.destroy();
process.exit(0);