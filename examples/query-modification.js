/**
 * Examples of Query Modification Patterns
 * 
 * These examples show how to modify queries at different levels
 * of complexity, from simple joins to complex aggregations.
 */

import { Api, Schema, MySQLPlugin } from '../index.js';

// Setup
const api = new Api();
api.use(MySQLPlugin, { connection: dbConfig });

// Define schemas with relationships
const reviewSchema = new Schema({
  id: { type: 'id' },
  rating: { type: 'number', required: true },
  comment: { type: 'string' },
  userId: { type: 'id', refs: { resource: 'users' } },
  productId: { type: 'id', refs: { resource: 'products' } },
  createdAt: { type: 'timestamp' }
});

api.addResource('reviews', reviewSchema);

// ============================================================
// EXAMPLE 1: Simple Join
// Add user name to all review queries
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    context.query
      .select('users.name as userName')
      .leftJoin('users', 'users.id = reviews.userId');
  }
});

// Result: Every review query now includes the user's name
// SELECT reviews.*, users.name as userName 
// FROM reviews 
// LEFT JOIN users ON users.id = reviews.userId

// ============================================================
// EXAMPLE 2: Conditional Joins Based on Parameters
// Only join when client requests it
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    const { include } = context.params;
    
    // Client can request: ?include=user,product
    if (include?.includes('user')) {
      context.query
        .select('users.name as userName', 'users.avatar as userAvatar')
        .leftJoin('users', 'users.id = reviews.userId');
    }
    
    if (include?.includes('product')) {
      context.query
        .select('products.name as productName', 'products.price as productPrice')
        .leftJoin('products', 'products.id = reviews.productId');
    }
  }
});

// ============================================================
// EXAMPLE 3: Complex Aggregations
// Add statistics to product queries
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'products') {
    // Add review statistics to each product
    context.query
      .select(
        'COALESCE(AVG(reviews.rating), 0) as avgRating',
        'COUNT(DISTINCT reviews.id) as reviewCount',
        'COUNT(DISTINCT reviews.userId) as reviewerCount'
      )
      .leftJoin('reviews', 'reviews.productId = products.id')
      .groupBy('products.id');
  }
});

// ============================================================
// EXAMPLE 4: Search Across Multiple Tables
// Implement full-text search
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'products' && context.params.search) {
    const searchTerm = `%${context.params.search}%`;
    
    // Join categories and search across multiple fields
    context.query
      .leftJoin('categories', 'categories.id = products.categoryId')
      .where(
        '(products.name LIKE ? OR products.description LIKE ? OR categories.name LIKE ?)',
        searchTerm, searchTerm, searchTerm
      );
  }
});

// ============================================================
// EXAMPLE 5: Role-Based Filtering
// Apply different filters based on user permissions
// ============================================================

api.hook('modifyQuery', async (context) => {
  const user = context.options.user; // Passed from HTTP layer
  
  if (context.options.type === 'orders') {
    if (user.role === 'customer') {
      // Customers only see their own orders
      context.query.where('orders.userId = ?', user.id);
    } else if (user.role === 'vendor') {
      // Vendors see orders containing their products
      context.query
        .select('DISTINCT orders.*')
        .innerJoin('orderItems', 'orderItems.orderId = orders.id')
        .innerJoin('products', 'products.id = orderItems.productId')
        .where('products.vendorId = ?', user.id);
    }
    // Admins see everything (no additional filtering)
  }
});

// ============================================================
// EXAMPLE 6: Soft Delete Pattern
// Never show deleted records unless explicitly requested
// ============================================================

api.hook('finalizeQuery', async (context) => {
  // Run this late to ensure it applies after other modifications
  
  const schema = context.api.schemas.get(context.options.type);
  const includeDeleted = context.params.includeDeleted === 'true';
  
  // If schema has deletedAt field and we're not including deleted
  if (schema?.structure.deletedAt && !includeDeleted) {
    context.query.where(`${context.options.type}.deletedAt IS NULL`);
  }
}, 80); // High priority to run late

// ============================================================
// EXAMPLE 7: Dynamic Sorting with Relationships
// Sort by related data
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'products') {
    // Check if sorting by related field
    const sortField = context.params.sort?.[0]?.field;
    
    if (sortField === 'avgRating') {
      // Need to join reviews to sort by average rating
      context.query
        .select('AVG(reviews.rating) as avgRating')
        .leftJoin('reviews', 'reviews.productId = products.id')
        .groupBy('products.id');
      // The orderBy is already added by initializeQuery
    }
  }
});

// ============================================================
// EXAMPLE 8: Nested Resource Pattern
// Get all reviews for a specific user's products
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews' && context.params.filter?.userProducts) {
    const userId = context.params.filter.userProducts;
    
    context.query
      .innerJoin('products', 'products.id = reviews.productId')
      .where('products.userId = ?', userId);
    
    // Remove the userProducts from filter to avoid SQL errors
    delete context.params.filter.userProducts;
  }
});

// ============================================================
// EXAMPLE 9: Performance Optimization
// Only join when fields are requested
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'orders') {
    const requestedFields = context.params.fields?.orders;
    
    // Only join customer table if customer fields are requested
    if (requestedFields?.some(f => f.startsWith('customer'))) {
      context.query
        .select('users.name as customerName', 'users.email as customerEmail')
        .leftJoin('users', 'users.id = orders.userId');
    }
    
    // Only calculate totals if requested
    if (requestedFields?.includes('total')) {
      context.query
        .select('SUM(orderItems.quantity * orderItems.price) as total')
        .leftJoin('orderItems', 'orderItems.orderId = orders.id')
        .groupBy('orders.id');
    }
  }
});

// ============================================================
// EXAMPLE 10: Debugging Queries
// Log queries in development
// ============================================================

if (process.env.NODE_ENV === 'development') {
  api.hook('finalizeQuery', async (context) => {
    console.log('=== Query Debug ===');
    console.log('Resource:', context.options.type);
    console.log('SQL:', context.query.toSQL());
    console.log('Args:', context.query.getArgs());
    console.log('==================');
  }, 99); // Run very late
}