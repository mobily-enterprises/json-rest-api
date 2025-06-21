/**
 * Example: Using Query Operators
 * 
 * This example demonstrates all available query operators in the JSON REST API.
 * 
 * Supported operators:
 * - eq: Equal (default)
 * - ne: Not equal
 * - gt: Greater than
 * - gte: Greater than or equal
 * - lt: Less than
 * - lte: Less than or equal
 * - in: In array
 * - nin: Not in array
 * - like: SQL LIKE pattern
 * - ilike: Case-insensitive LIKE (database dependent)
 * - contains: Contains substring
 * - startsWith: Starts with string
 * - endsWith: Ends with string
 */

import { Api, Schema, MemoryPlugin, HTTPPlugin } from '../index.js';
import express from 'express';

const api = new Api();
api.use(MemoryPlugin);

// Define a product schema with searchable fields
const productSchema = new Schema({
  name: { 
    type: 'string', 
    required: true, 
    searchable: true 
  },
  description: { 
    type: 'string', 
    searchable: true 
  },
  price: { 
    type: 'number', 
    required: true, 
    searchable: true 
  },
  stock: { 
    type: 'number', 
    default: 0, 
    searchable: true 
  },
  category: { 
    type: 'string', 
    searchable: true 
  },
  tags: { 
    type: 'array', 
    searchable: true 
  },
  active: { 
    type: 'boolean', 
    default: true, 
    searchable: true 
  },
  createdAt: { 
    type: 'timestamp', 
    default: Date.now, 
    searchable: true 
  }
});

api.addResource('products', productSchema);

// Seed some sample data
async function seedData() {
  const products = [
    {
      name: 'Apple iPhone 15',
      description: 'Latest Apple smartphone with advanced features',
      price: 999,
      stock: 50,
      category: 'Electronics',
      tags: ['smartphone', 'apple', 'mobile'],
      active: true
    },
    {
      name: 'Samsung Galaxy S24',
      description: 'Samsung flagship phone with AI capabilities',
      price: 899,
      stock: 30,
      category: 'Electronics',
      tags: ['smartphone', 'samsung', 'android'],
      active: true
    },
    {
      name: 'Apple MacBook Pro',
      description: 'Professional laptop for developers and creators',
      price: 2499,
      stock: 15,
      category: 'Computers',
      tags: ['laptop', 'apple', 'professional'],
      active: true
    },
    {
      name: 'Dell XPS 15',
      description: 'High-performance Windows laptop',
      price: 1799,
      stock: 20,
      category: 'Computers',
      tags: ['laptop', 'dell', 'windows'],
      active: true
    },
    {
      name: 'Apple AirPods Pro',
      description: 'Wireless earbuds with noise cancellation',
      price: 249,
      stock: 100,
      category: 'Accessories',
      tags: ['audio', 'apple', 'wireless'],
      active: true
    },
    {
      name: 'Discontinued Product',
      description: 'This product is no longer available',
      price: 99,
      stock: 0,
      category: 'Electronics',
      tags: ['discontinued'],
      active: false
    }
  ];

  for (const product of products) {
    await api.resources.products.insert(product);
  }
  
  console.log('✅ Sample data seeded');
}

// Demonstrate all operators
async function demonstrateOperators() {
  console.log('\n📋 OPERATOR EXAMPLES\n');
  
  // 1. Comparison operators
  console.log('1️⃣ COMPARISON OPERATORS');
  
  // Greater than
  const expensive = await api.resources.products.query({
    filter: { price: { gt: 1000 } }
  });
  console.log(`\nProducts > $1000: ${expensive.data.length} items`);
  expensive.data.forEach(p => console.log(`  - ${p.attributes.name}: $${p.attributes.price}`));
  
  // Less than or equal
  const affordable = await api.resources.products.query({
    filter: { price: { lte: 500 } }
  });
  console.log(`\nProducts <= $500: ${affordable.data.length} items`);
  affordable.data.forEach(p => console.log(`  - ${p.attributes.name}: $${p.attributes.price}`));
  
  // Multiple conditions
  const midRange = await api.resources.products.query({
    filter: { 
      price: { gte: 200, lt: 1000 },
      stock: { gt: 0 }
    }
  });
  console.log(`\nMid-range products ($200-$999) in stock: ${midRange.data.length} items`);
  midRange.data.forEach(p => console.log(`  - ${p.attributes.name}: $${p.attributes.price}`));
  
  // 2. Set operators
  console.log('\n\n2️⃣ SET OPERATORS');
  
  // IN operator
  const appleOrSamsung = await api.resources.products.query({
    filter: { tags: { in: ['apple', 'samsung'] } }
  });
  console.log(`\nApple or Samsung products: ${appleOrSamsung.data.length} items`);
  appleOrSamsung.data.forEach(p => console.log(`  - ${p.attributes.name}`));
  
  // NOT IN operator
  const notElectronics = await api.resources.products.query({
    filter: { category: { nin: ['Electronics'] } }
  });
  console.log(`\nNon-electronics: ${notElectronics.data.length} items`);
  notElectronics.data.forEach(p => console.log(`  - ${p.attributes.name} (${p.attributes.category})`));
  
  // 3. String operators
  console.log('\n\n3️⃣ STRING OPERATORS');
  
  // Starts with
  const appleProducts = await api.resources.products.query({
    filter: { name: { startsWith: 'Apple' } }
  });
  console.log(`\nProducts starting with 'Apple': ${appleProducts.data.length} items`);
  appleProducts.data.forEach(p => console.log(`  - ${p.attributes.name}`));
  
  // Ends with
  const proProducts = await api.resources.products.query({
    filter: { name: { endsWith: 'Pro' } }
  });
  console.log(`\nProducts ending with 'Pro': ${proProducts.data.length} items`);
  proProducts.data.forEach(p => console.log(`  - ${p.attributes.name}`));
  
  // Contains
  const withAI = await api.resources.products.query({
    filter: { description: { contains: 'AI' } }
  });
  console.log(`\nProducts with 'AI' in description: ${withAI.data.length} items`);
  withAI.data.forEach(p => console.log(`  - ${p.attributes.name}`));
  
  // LIKE pattern
  const laptops = await api.resources.products.query({
    filter: { description: { like: '%laptop%' } }
  });
  console.log(`\nProducts matching '%laptop%': ${laptops.data.length} items`);
  laptops.data.forEach(p => console.log(`  - ${p.attributes.name}`));
  
  // 4. Boolean and NOT EQUAL
  console.log('\n\n4️⃣ BOOLEAN & NOT EQUAL');
  
  // Active products
  const active = await api.resources.products.query({
    filter: { active: true }
  });
  console.log(`\nActive products: ${active.data.length} items`);
  
  // Not equal
  const notAccessories = await api.resources.products.query({
    filter: { category: { ne: 'Accessories' } }
  });
  console.log(`\nNot accessories: ${notAccessories.data.length} items`);
  notAccessories.data.forEach(p => console.log(`  - ${p.attributes.name} (${p.attributes.category})`));
}

// Demonstrate HTTP API usage
async function demonstrateHttpApi() {
  const app = express();
  api.use(HTTPPlugin, { app });
  
  const port = 3000;
  const server = app.listen(port, () => {
    console.log(`\n\n🌐 HTTP API running on http://localhost:${port}`);
    console.log('\n📌 Example HTTP queries with operators:\n');
    
    console.log('# Basic equality');
    console.log(`curl "http://localhost:${port}/api/products?filter[active]=true"`);
    
    console.log('\n# Greater than');
    console.log(`curl "http://localhost:${port}/api/products?filter[price][gt]=1000"`);
    
    console.log('\n# Multiple conditions');
    console.log(`curl "http://localhost:${port}/api/products?filter[price][gte]=200&filter[price][lt]=1000"`);
    
    console.log('\n# IN operator (URL encoded)');
    console.log(`curl "http://localhost:${port}/api/products?filter[tags][in]=apple,samsung"`);
    
    console.log('\n# String operators');
    console.log(`curl "http://localhost:${port}/api/products?filter[name][startsWith]=Apple"`);
    console.log(`curl "http://localhost:${port}/api/products?filter[description][contains]=laptop"`);
    
    console.log('\n# Combined with pagination and sorting');
    console.log(`curl "http://localhost:${port}/api/products?filter[price][lte]=1000&sort=-price&page[size]=2"`);
    
    console.log('\n\nPress Ctrl+C to stop the server');
  });
}

// Run the examples
async function main() {
  try {
    await seedData();
    await demonstrateOperators();
    await demonstrateHttpApi();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();