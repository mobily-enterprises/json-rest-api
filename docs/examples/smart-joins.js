/**
 * Smart Joins with Schema Refs
 * 
 * The query builder can automatically build joins from your schema definitions!
 */

import { Api, Schema, MySQLPlugin } from '../../index.js';

// Note: This example requires MySQL configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'myapp'
};

const api = new Api();
api.use(MySQLPlugin, { connection: dbConfig });

// Define schemas with relationships
const reviewSchema = new Schema({
  id: { type: 'id' },
  rating: { type: 'number', required: true },
  comment: { type: 'string' },
  userId: { 
    type: 'id', 
    refs: { resource: 'users' }  // This field references users table
  },
  productId: { 
    type: 'id', 
    refs: { resource: 'products' }  // This field references products table
  }
});

const orderItemSchema = new Schema({
  id: { type: 'id' },
  orderId: { type: 'id', refs: { resource: 'orders' } },
  productId: { type: 'id', refs: { resource: 'products' } },
  quantity: { type: 'number' },
  price: { type: 'number' }
});

api.addResource('reviews', reviewSchema);
api.addResource('orderItems', orderItemSchema);

// ============================================================
// BEFORE: Manual Joins (The Old Way)
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews' && context.params.old) {
    // You had to manually specify the join table and condition
    context.query
      .select('users.name as userName', 'users.email as userEmail')
      .leftJoin('users', 'users.id = reviews.userId')
      .select('products.name as productName')
      .leftJoin('products', 'products.id = reviews.productId');
  }
});

// ============================================================
// AFTER: Smart Joins (The New Way!)
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews') {
    // Just pass the field name - it knows the rest from refs!
    context.query
      .leftJoin('userId')     // Automatically: LEFT JOIN users ON users.id = reviews.userId
      .leftJoin('productId')  // Automatically: LEFT JOIN products ON products.id = reviews.productId
      .select('users.name as userName', 'products.name as productName');
  }
});

// ============================================================
// EVEN BETTER: Include Related Fields
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'reviews' && context.params.include) {
    const includes = context.params.include.split(',');
    
    for (const field of includes) {
      // This single line:
      // 1. Adds the JOIN based on refs
      // 2. Selects all non-silent fields from the related table
      // 3. Prefixes them to avoid conflicts
      context.query.includeRelated(field);
    }
  }
});

// Usage: GET /api/reviews?include=userId,productId
// Returns reviews with all user and product fields!

// ============================================================
// SELECTIVE FIELD INCLUSION
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'orderItems') {
    // Include only specific fields from related resources
    context.query
      .includeRelated('orderId', ['orderNumber', 'status', 'createdAt'])
      .includeRelated('productId', ['name', 'sku', 'price']);
  }
});

// Results in:
// SELECT 
//   orderItems.*,
//   orders.orderNumber as orderId_orderNumber,
//   orders.status as orderId_status,
//   orders.createdAt as orderId_createdAt,
//   products.name as productId_name,
//   products.sku as productId_sku,
//   products.price as productId_price
// FROM orderItems
// LEFT JOIN orders ON orders.id = orderItems.orderId
// LEFT JOIN products ON products.id = orderItems.productId

// ============================================================
// COMPLEX EXAMPLE: Multi-Level Relationships
// ============================================================

// Let's say products have categories, and categories have departments
const productSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string' },
  categoryId: { type: 'id', refs: { resource: 'categories' } }
});

const categorySchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string' },
  departmentId: { type: 'id', refs: { resource: 'departments' } }
});

api.addResource('products', productSchema);
api.addResource('categories', categorySchema);

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'products' && context.params.includeHierarchy) {
    // First level: include category
    context.query
      .includeRelated('categoryId', ['name', 'slug']);
    
    // Second level: we need manual join for department (for now)
    // But at least the first join was automatic!
    context.query
      .leftJoin('departments', 'departments.id = categories.departmentId')
      .select('departments.name as departmentName');
  }
});

// ============================================================
// DYNAMIC RELATIONSHIP EXPLORATION
// ============================================================

// Generic hook that can include any relationship
api.hook('modifyQuery', async (context) => {
  const expand = context.params.expand?.split(',') || [];
  const schema = api.schemas.get(context.options.type);
  
  if (!schema) return;
  
  for (const fieldName of expand) {
    const fieldDef = schema.structure[fieldName];
    
    // Only expand fields that have refs
    if (fieldDef?.refs?.resource) {
      if (context.params.expandFields) {
        // Include specific fields: ?expand=userId&expandFields[userId]=name,email
        const fields = context.params.expandFields[fieldName]?.split(',');
        context.query.includeRelated(fieldName, fields);
      } else {
        // Include all fields
        context.query.includeRelated(fieldName);
      }
    }
  }
});

// Usage examples:
// GET /api/reviews?expand=userId,productId
// GET /api/reviews?expand=userId&expandFields[userId]=name,avatar
// GET /api/orderItems?expand=orderId,productId&expandFields[productId]=name,price

// ============================================================
// CONDITIONAL JOINS BASED ON FIELDS REQUESTED
// ============================================================

api.hook('modifyQuery', async (context) => {
  // Only join if client requests fields from that table
  const requestedFields = context.params.fields?.[context.options.type] || [];
  
  // Check which relationships are needed based on requested fields
  const schema = api.schemas.get(context.options.type);
  
  for (const field of requestedFields) {
    // If field contains underscore, it might be a related field
    if (field.includes('_')) {
      const [possibleRef, relatedField] = field.split('_', 2);
      
      if (schema?.structure[possibleRef]?.refs) {
        // Add the join if needed
        context.query.leftJoin(possibleRef);
        
        // Add the specific field
        const relatedTable = schema.structure[possibleRef].refs.resource;
        context.query.select(`${relatedTable}.${relatedField} as ${field}`);
      }
    }
  }
});

// Usage: GET /api/reviews?fields[reviews]=id,rating,userId_name,productId_name
// Only joins users and products because those fields were requested

// ============================================================
// THE POWER OF REFS
// ============================================================

/*
Benefits of smart joins:

1. **Less Code**: One parameter instead of two
2. **Self-Documenting**: The schema shows relationships  
3. **Consistency**: Join conditions are always correct
4. **Refactoring-Safe**: Change the schema, joins still work
5. **Type-Safe**: With TypeScript, you get autocomplete for field names

Future possibilities:
- Automatic multi-level joins (follow refs recursively)
- Reverse relationships (hasMany)
- Join optimization based on requested fields
- Automatic relationship validation
*/