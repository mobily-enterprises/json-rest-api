import { createApi, Schema } from '../index.js';

// Create API with memory storage
const api = createApi({ 
  storage: 'memory',
  debug: false 
});

// Define a product schema with virtual fields
api.addResource('products', new Schema({
  name: { type: 'string', required: true },
  cost: { type: 'number', required: true },
  price: { type: 'number', required: true },
  
  // Virtual fields are computed, not stored
  profit: { 
    type: 'number', 
    virtual: true 
  },
  margin: { 
    type: 'string', 
    virtual: true 
  },
  profitLevel: {
    type: 'string',
    virtual: true,
    permissions: { read: 'manager' } // Only managers can see profit levels
  }
}));

// Add hook to compute virtual fields
api.hook('afterGet', async (context) => {
  if (context.options.type === 'products') {
    const product = context.result;
    
    // Calculate virtual fields
    product.profit = product.price - product.cost;
    product.margin = `${Math.round((product.profit / product.price) * 100)}%`;
    
    // Profit level (only for managers)
    const marginPercent = (product.profit / product.price) * 100;
    if (marginPercent > 50) {
      product.profitLevel = 'High';
    } else if (marginPercent > 30) {
      product.profitLevel = 'Medium';
    } else {
      product.profitLevel = 'Low';
    }
  }
});

await api.connect();

console.log('=== Virtual Fields Example ===\n');

// Create products
console.log('Creating products...');
const widget = await api.insert({
  name: 'Widget',
  cost: 30,
  price: 50,
  profit: 999,  // This will be ignored - virtual fields can't be stored
  margin: 'fake' // This will also be ignored
}, { type: 'products' });

const gadget = await api.insert({
  name: 'Premium Gadget',
  cost: 100,
  price: 250
}, { type: 'products' });

console.log('\n1. Virtual fields are NOT stored:');
console.log('   Widget insert result:', widget.data.attributes);
console.log('   Notice: profit and margin were ignored during insert\n');

// Get products - virtual fields will be computed
console.log('2. Virtual fields are computed on GET:');
const product1 = await api.get(widget.data.id, { type: 'products' });
console.log('   Widget:', product1.data.attributes);
console.log('   - Computed profit:', product1.data.attributes.profit);
console.log('   - Computed margin:', product1.data.attributes.margin);

// Get as manager - can see profit level
console.log('\n3. Virtual fields with permissions:');
const managerView = await api.get(gadget.data.id, { 
  type: 'products',
  user: { roles: ['manager'] }
});
console.log('   Manager view:', managerView.data.attributes);
console.log('   - Can see profitLevel:', managerView.data.attributes.profitLevel);

// Get as regular user - can't see profit level
const userView = await api.get(gadget.data.id, { 
  type: 'products',
  user: { roles: ['user'] }
});
console.log('\n   Regular user view:', userView.data.attributes);
console.log('   - Cannot see profitLevel:', userView.data.attributes.profitLevel);

// Virtual fields in queries
console.log('\n4. Virtual fields work in query results too:');
const allProducts = await api.query({}, { type: 'products' });
console.log('   All products with computed fields:');
for (const product of allProducts.data) {
  console.log(`   - ${product.attributes.name}: profit=${product.attributes.profit}, margin=${product.attributes.margin}`);
}

// Virtual fields cannot be used in filters
console.log('\n5. Virtual fields CANNOT be used in filters:');
try {
  await api.query({
    filter: { profit: 20 }  // This will fail
  }, { type: 'products' });
} catch (err) {
  console.log('   Error (expected):', err.message);
}

console.log('\n✅ Virtual fields example complete!');
console.log('\nKey takeaways:');
console.log('- Virtual fields are computed, not stored in the database');
console.log('- They are populated by afterGet hooks');
console.log('- They respect field-level permissions');
console.log('- They cannot be used in queries/filters');
console.log('- Perfect for derived data like calculations, formatted values, etc.');