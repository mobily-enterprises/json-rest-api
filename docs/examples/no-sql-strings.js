/**
 * No More SQL Strings!
 * 
 * Examples showing the cleaner, JavaScript-friendly syntax
 */

import { createApi, Schema } from '../../index.js';

// Note: This example requires MySQL configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'myapp'
};

// Setup (same as before)
const api = createApi({
  storage: 'mysql',
  mysql: { connection: dbConfig }
});

const reviewSchema = new Schema({
  id: { type: 'id' },
  rating: { type: 'number' },
  comment: { type: 'string' },
  userId: { type: 'id', refs: { resource: 'users' } },
  productId: { type: 'id', refs: { resource: 'products' } }
});

api.addResource('reviews', reviewSchema);

// ============================================================
// OLD WAY: SQL Strings Everywhere 😢
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    context.query
      .leftJoin('users', 'users.id = reviews.userId')
      .leftJoin('products', 'products.id = reviews.productId')
      .select('users.name as userName')
      .select('users.email as userEmail')
      .select('users.avatar as userAvatar')
      .select('products.name as productName')
      .select('products.price as productPrice');
  }
});

// ============================================================
// NEW WAY 1: Auto-Prefixing Arrays 😊
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    context.query
      .includeRelated('userId', ['name', 'email', 'avatar'])
      .includeRelated('productId', ['name', 'price']);
      
    // That's it! No SQL strings!
    // Fields are automatically aliased as:
    // - userId_name, userId_email, userId_avatar
    // - productId_name, productId_price
  }
});

// ============================================================
// NEW WAY 2: Custom Aliases with Objects 🎯
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    context.query
      .includeRelated('userId', {
        name: 'userName',      // Custom alias
        email: 'userEmail',    // Custom alias
        avatar: true           // Auto-prefix: userId_avatar
      })
      .includeRelated('productId', {
        name: 'productName',   // Custom alias
        price: true,           // Auto-prefix: productId_price
        sku: false            // No alias: just 'sku' (careful!)
      });
  }
});

// ============================================================
// NEW WAY 3: SelectFrom for Manual Joins 🔧
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    // Maybe you need a custom join
    context.query
      .leftJoin('users as u', 'u.id = reviews.userId')
      .selectFrom('u', ['name', 'email'])  // Auto-aliases: userId_name, userId_email
      
      // Or with custom aliases
      .selectFrom('u', {
        name: 'reviewerName',
        email: 'reviewerEmail'
      });
  }
});

// ============================================================
// REAL WORLD EXAMPLE: E-commerce Order Details
// ============================================================

const orderItemSchema = new Schema({
  id: { type: 'id' },
  orderId: { type: 'id', refs: { resource: 'orders' } },
  productId: { type: 'id', refs: { resource: 'products' } },
  variantId: { type: 'id', refs: { resource: 'productVariants' } },
  quantity: { type: 'number' },
  price: { type: 'number' }
});

api.addResource('orderItems', orderItemSchema);

// Clean, readable query modification
api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'orderItems') {
    context.query
      // Include order info with custom names
      .includeRelated('orderId', {
        orderNumber: 'orderNum',
        status: 'orderStatus',
        createdAt: 'orderDate'
      })
      
      // Include product basics
      .includeRelated('productId', ['name', 'sku'])
      
      // Include variant details
      .includeRelated('variantId', {
        size: true,           // Auto: variantId_size
        color: true,          // Auto: variantId_color
        sku: 'variantSku'     // Custom: variantSku
      });
  }
});

/* 
The result includes all these fields WITHOUT writing SQL:
{
  id: 1,
  orderId: 123,
  productId: 456,
  variantId: 789,
  quantity: 2,
  price: 29.99,
  orderNum: "ORD-2024-001",        // From orders table
  orderStatus: "shipped",          // From orders table
  orderDate: "2024-01-15",         // From orders table
  productId_name: "Cool T-Shirt",  // From products table
  productId_sku: "TSHIRT-001",     // From products table
  variantId_size: "XL",            // From productVariants table
  variantId_color: "Blue",         // From productVariants table
  variantSku: "TSHIRT-001-XL-BLU"  // From productVariants table
}
*/

// ============================================================
// DYNAMIC FIELD SELECTION BASED ON CLIENT REQUEST
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    // Parse what the client wants
    const fields = context.params.fields || {};
    
    // Client can request: ?fields[user]=name,email&fields[product]=name,price
    if (fields.user) {
      context.query.includeRelated('userId', fields.user.split(','));
    }
    
    if (fields.product) {
      context.query.includeRelated('productId', fields.product.split(','));
    }
  }
});

// ============================================================
// COMPARISON: Before and After
// ============================================================

// ❌ OLD: SQL strings, error-prone, hard to maintain
query
  .leftJoin('users', 'users.id = reviews.userId')
  .leftJoin('products', 'products.id = reviews.productId')
  .select('users.name as userName', 'users.email as userEmail')
  .select('products.name as productName', 'products.price as productPrice');

// ✅ NEW: JavaScript objects, type-safe potential, self-documenting
query
  .includeRelated('userId', {
    name: 'userName',
    email: 'userEmail'
  })
  .includeRelated('productId', {
    name: 'productName',
    price: 'productPrice'
  });

// Or even simpler with auto-prefixing:
query
  .includeRelated('userId', ['name', 'email'])
  .includeRelated('productId', ['name', 'price']);

/*
Benefits:
1. No SQL syntax to remember
2. Works with TypeScript for autocomplete
3. Less error-prone (no typos in table names)
4. Relationships defined once in schema
5. Still compiles to efficient SQL
6. You can always fall back to SQL strings when needed
*/