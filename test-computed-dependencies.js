import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from './index.js';
import knexLib from 'knex';

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({
  name: 'test-computed-api',
  version: '1.0.0'
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Define a resource with computed fields that have dependencies
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    cost: { type: 'number', required: true, normallyHidden: true }, // Hidden by default
    tax_rate: { type: 'number', required: true, normallyHidden: true }, // Hidden by default
    secret_code: { type: 'string', hidden: true }, // NEVER visible
  },
  computed: {
    profit_margin: {
      type: 'number',
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        if (attributes.price && attributes.cost) {
          return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
        }
        return null;
      }
    },
    price_with_tax: {
      type: 'number',
      dependencies: ['price', 'tax_rate'],
      compute: ({ attributes }) => {
        if (attributes.price && attributes.tax_rate) {
          return (attributes.price * (1 + attributes.tax_rate / 100)).toFixed(2);
        }
        return null;
      }
    },
    display_name: {
      type: 'string',
      dependencies: ['name', 'price'],
      compute: ({ attributes }) => {
        return `${attributes.name} ($${attributes.price})`;
      }
    }
  }
});

await api.resources.products.createKnexTable();

// Insert test data
try {
  const product1 = await api.resources.products.post({
    name: 'Widget A',
    price: 100,
    cost: 60,
    tax_rate: 8.5,
    secret_code: 'SECRET123'
  });
  console.log('Created product:', product1);

  const product2 = await api.resources.products.post({
    name: 'Widget B',
    price: 200,
    cost: 120,
    tax_rate: 10,
    secret_code: 'SECRET456'
  });
  console.log('Created product:', product2);

  console.log('\n=== TEST 1: Request only computed field (profit_margin) ===');
  const result1 = await api.resources.products.get({
    id: product1.id,
    queryParams: { fields: { products: 'profit_margin' } }
  });
  console.log('Result:', JSON.stringify(result1, null, 2));
  console.log('Should have: id, profit_margin');
  console.log('Should NOT have: price, cost, name, tax_rate, secret_code');

  console.log('\n=== TEST 2: Request computed field and one of its dependencies ===');
  const result2 = await api.resources.products.get({
    id: product1.id,
    queryParams: { fields: { products: 'profit_margin,price' } }
  });
  console.log('Result:', JSON.stringify(result2, null, 2));
  console.log('Should have: id, profit_margin, price');
  console.log('Should NOT have: cost (dependency but not requested), name, tax_rate, secret_code');

  console.log('\n=== TEST 3: Request multiple computed fields ===');
  const result3 = await api.resources.products.get({
    id: product1.id,
    queryParams: { fields: { products: 'profit_margin,price_with_tax' } }
  });
  console.log('Result:', JSON.stringify(result3, null, 2));
  console.log('Should have: id, profit_margin, price_with_tax');
  console.log('Should NOT have: price, cost, tax_rate (all dependencies but not requested)');

  console.log('\n=== TEST 4: Request normallyHidden field explicitly ===');
  const result4 = await api.resources.products.get({
    id: product1.id,
    queryParams: { fields: { products: 'name,cost,tax_rate' } }
  });
  console.log('Result:', JSON.stringify(result4, null, 2));
  console.log('Should have: id, name, cost, tax_rate');
  console.log('Should NOT have: secret_code (hidden field)');

  console.log('\n=== TEST 5: Try to request hidden field ===');
  const result5 = await api.resources.products.get({
    id: product1.id,
    queryParams: { fields: { products: 'name,secret_code' } }
  });
  console.log('Result:', JSON.stringify(result5, null, 2));
  console.log('Should have: id, name');
  console.log('Should NOT have: secret_code (hidden field cannot be requested)');

  console.log('\n=== TEST 6: No sparse fieldsets (all visible fields) ===');
  const result6 = await api.resources.products.get({
    id: product1.id
  });
  console.log('Result:', JSON.stringify(result6, null, 2));
  console.log('Should have: id, name, price, all computed fields');
  console.log('Should NOT have: cost, tax_rate (normallyHidden), secret_code (hidden)');

  console.log('\n=== TEST 7: Query with computed fields ===');
  const result7 = await api.resources.products.query({
    queryParams: { fields: { products: 'name,display_name' } }
  });
  console.log('Result:', JSON.stringify(result7, null, 2));
  console.log('Each product should have: id, name, display_name');
  console.log('Should NOT have: price (dependency of display_name but not requested)');

  // Test SQL queries being generated
  console.log('\n=== SQL QUERY ANALYSIS ===');
  
  // Enable query logging
  const queries = [];
  knex.on('query', (queryData) => {
    queries.push(queryData.sql);
  });

  console.log('\nFetching product with only computed field:');
  await api.resources.products.get({
    id: product1.id,
    queryParams: { fields: { products: 'profit_margin' } }
  });
  console.log('SQL:', queries[queries.length - 1]);
  console.log('Should include: id, price, cost (dependencies)');

  await knex.destroy();
  console.log('\n✅ All tests completed successfully!');

} catch (error) {
  console.error('❌ Error:', error.message, error.details);
  console.error('Stack trace:', error.stack);
  await knex.destroy();
  process.exit(1);
}