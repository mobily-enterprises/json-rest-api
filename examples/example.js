import express from 'express';
import { 
  createApi, 
  Api, 
  Schema,
  MySQLPlugin,
  HTTPPlugin,
  ValidationPlugin,
  PositioningPlugin,
  VersioningPlugin
} from '../index.js';

// Example 1: Simple API with memory storage
const simpleApi = createApi({
  storage: 'memory',
  http: {
    basePath: '/api/v1',
    typeOptions: {
      users: { 
        searchFields: ['name', 'email'] 
      }
    }
  }
});

// Define a schema
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true, min: 2, max: 100 },
  email: { type: 'string', required: true, lowercase: true },
  age: { type: 'number', min: 0, max: 150 },
  active: { type: 'boolean', default: true },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

// Register the schema
simpleApi.addResource('users', userSchema);

// Example 2: Advanced API with MySQL and all features
const advancedApi = new Api({ idProperty: 'id' });

// Configure plugins
advancedApi
  .use(ValidationPlugin)
  .use(MySQLPlugin, {
    connections: [{
      name: 'main',
      config: {
        host: 'localhost',
        user: 'root',
        password: 'password',
        database: 'myapp'
      }
    }]
  })
  .use(PositioningPlugin, {
    positionField: 'position',
    beforeIdField: 'beforeId'
  })
  .use(VersioningPlugin, {
    apiVersion: '2.0.0',
    trackHistory: true,
    optimisticLocking: true
  })
  .use(HTTPPlugin, {
    basePath: '/api/v2'
  });

// Define schemas
const productSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  price: { type: 'number', required: true, min: 0, currency: true },
  stock: { type: 'number', default: 0, min: 0 },
  category: { type: 'string', required: true },
  tags: { type: 'array', default: [] },
  metadata: { type: 'object' },
  active: { type: 'boolean', default: true },
  position: { type: 'number', default: 0 },
  version: { type: 'number', default: 1 },
  createdAt: { type: 'timestamp', default: () => Date.now() },
  updatedAt: { type: 'timestamp' }
});

// Create search schema from main schema
const productSearchSchema = advancedApi.createSearchSchema(productSchema, [
  'name', 'category', 'active'
]);

// Register schemas
advancedApi.addResource('products', productSchema);

// Custom validation hook
advancedApi.hook('afterValidate', async (context) => {
  if (context.method === 'insert' || context.method === 'update') {
    const { data } = context;
    
    // Custom business rule: expensive products must have description
    if (data.price > 1000 && !data.description) {
      context.errors.push({
        field: 'description',
        message: 'Products over $1000 must have a description',
        code: 'EXPENSIVE_PRODUCT_NEEDS_DESCRIPTION'
      });
    }
  }
});

// Transform hook to add computed fields
advancedApi.hook('transformResult', async (context) => {
  if (context.result && context.options.type === 'products') {
    const product = context.result;
    
    // Add computed field
    product.displayPrice = `$${(product.price || 0).toFixed(2)}`;
    product.inStock = product.stock > 0;
  }
});

// Example: Using batch operations
async function batchExample() {
  // Create multiple products at once
  const products = await advancedApi.resources.products.batch.create([
    { name: 'Widget A', price: 10.00, category: 'widgets' },
    { name: 'Widget B', price: 20.00, category: 'widgets' },
    { name: 'Widget C', price: 30.00, category: 'widgets' }
  ]);
  
  console.log('Created products:', products);
}

// Example 3: Using the API programmatically with the new resource proxy
async function exampleUsage() {
  // Insert a product using the resource proxy
  const newProduct = await advancedApi.resources.products.create({
    name: 'Premium Widget',
    description: 'A high-quality widget for professionals',
    price: 1299.99,
    stock: 50,
    category: 'widgets',
    tags: ['premium', 'professional'],
    beforeId: null // Will be placed at the end
  }, {
    table: 'products',
    positioning: { enabled: true }
  });

  console.log('Created product:', newProduct);

  // Query products
  const products = await advancedApi.resources.products.query({
    filter: { category: 'widgets', active: true },
    sort: '-price,name',
    page: { size: 10, number: 1 }
  }, {
    table: 'products'
  });

  console.log('Found products:', products);

  // Update with optimistic locking
  const updated = await advancedApi.resources.products.update(newProduct.data.id, {
    stock: 45,
    version: newProduct.data.attributes.version // For optimistic locking
  }, {
    table: 'products'
  });

  console.log('Updated product:', updated);

  // Get version history
  const history = await advancedApi.getVersionHistory('products', newProduct.data.id);
  console.log('Version history:', history);
  
  // Delete example
  // await advancedApi.resources.products.delete(newProduct.data.id);
}

// Example 4: Express app setup
const app = express();

// Mount the APIs
simpleApi.mount(app);
advancedApi.mount(app);

// Add custom middleware
advancedApi.useMiddleware((req, res, next) => {
  // Add user ID from session for versioning
  req.options = { userId: req.session?.userId };
  next();
});

// Sync database schema
async function syncDatabase() {
  await advancedApi.syncSchema(productSchema, 'products', {
    connection: 'main'
  });
}

// Start server
app.listen(3000, () => {
  console.log('API server running on http://localhost:3000');
});

// Export for use in other modules
export { simpleApi, advancedApi, userSchema, productSchema };