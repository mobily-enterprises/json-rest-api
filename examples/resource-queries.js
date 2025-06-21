/**
 * Resource-Specific Query Patterns
 * 
 * Examples of how to define query modifications at the resource level
 * for clean, reusable code
 */

import { Api, Schema, MySQLPlugin, createApi } from '../../index.js';

// Note: This example requires MySQL configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'myapp'
};

// ============================================================
// APPROACH 1: Resource-Level Hooks
// Define modifications when adding the resource
// ============================================================

const api = createApi({
  name: 'ecommerce',
  version: '1.0.0',
  storage: 'mysql',
  mysql: { connection: dbConfig }
});

// Define product schema
const productSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true, searchable: true },
  description: { type: 'string' },
  price: { type: 'number', required: true },
  categoryId: { type: 'id', refs: { resource: 'categories' } },
  inventory: { type: 'number', default: 0 },
  active: { type: 'boolean', default: true, searchable: true }
});

// Products with automatic category and review data
api.addResource('products', productSchema, {
  // Hooks specific to this resource
  async modifyQuery(context) {
    const query = context.query;
    
    // Always include category name
    query
      .select('categories.name as categoryName')
      .leftJoin('categories', 'categories.id = products.categoryId');
    
    // Include review stats if requested
    if (context.params.include?.includes('reviews')) {
      query
        .select(
          'COUNT(DISTINCT reviews.id) as reviewCount',
          'COALESCE(AVG(reviews.rating), 0) as avgRating'
        )
        .leftJoin('reviews', 'reviews.productId = products.id')
        .groupBy('products.id');
    }
    
    // Price range filtering
    if (context.params.priceRange) {
      const [min, max] = context.params.priceRange;
      query.where('products.price BETWEEN ? AND ?', min, max);
    }
    
    // In-stock filtering
    if (context.params.inStock) {
      query.where('products.inventory > 0');
    }
  }
});

// ============================================================
// APPROACH 2: Schema-Driven Queries
// Use schema properties to drive query behavior
// ============================================================

// Enhanced schema with query hints
const userSchema = new Schema({
  id: { type: 'id' },
  email: { type: 'string', unique: true },
  name: { type: 'string', searchable: true },  // Hint for search
  bio: { type: 'string', searchable: true },   // Hint for search
  roleId: { 
    type: 'id', 
    refs: { resource: 'roles' },
    eager: true  // Always include role data
  },
  deletedAt: { type: 'timestamp', silent: true }  // Soft delete field
});

// Hook that uses schema hints
api.hook('modifyQuery', async (context) => {
  const schema = api.schemas.get(context.options.type);
  if (!schema) return;
  
  // Auto-join eager relationships
  for (const [field, def] of Object.entries(schema.structure)) {
    if (def.refs?.eager) {
      const table = def.refs.resource;
      context.query
        .select(`${table}.*`)
        .leftJoin(table, `${table}.id = ${context.options.type}.${field}`);
    }
  }
  
  // Auto-handle soft deletes
  if (schema.structure.deletedAt && !context.params.includeDeleted) {
    context.query.where(`${context.options.type}.deletedAt IS NULL`);
  }
  
  // Auto-handle searchable fields
  if (context.params.search) {
    const searchableFields = Object.entries(schema.structure)
      .filter(([_, def]) => def.searchable)
      .map(([field, _]) => field);
    
    if (searchableFields.length > 0) {
      const conditions = searchableFields
        .map(field => `${context.options.type}.${field} LIKE ?`)
        .join(' OR ');
      
      const searchTerm = `%${context.params.search}%`;
      const args = searchableFields.map(() => searchTerm);
      
      context.query.where(`(${conditions})`, ...args);
    }
  }
});

// ============================================================
// APPROACH 3: Query Presets
// Define named query configurations
// ============================================================

// Define query presets for common use cases
const queryPresets = {
  orders: {
    // Preset for order summary
    summary: (query) => {
      query
        .select(
          'orders.*',
          'users.name as customerName',
          'COUNT(orderItems.id) as itemCount',
          'SUM(orderItems.quantity * orderItems.price) as total'
        )
        .leftJoin('users', 'users.id = orders.userId')
        .leftJoin('orderItems', 'orderItems.orderId = orders.id')
        .groupBy('orders.id');
    },
    
    // Preset for detailed order with all items
    detailed: (query) => {
      query
        .select(
          'orders.*',
          'users.name as customerName',
          'users.email as customerEmail',
          `(
            SELECT JSON_ARRAYAGG(
              JSON_OBJECT(
                'id', oi.id,
                'productId', oi.productId,
                'productName', p.name,
                'quantity', oi.quantity,
                'price', oi.price,
                'subtotal', oi.quantity * oi.price
              )
            )
            FROM orderItems oi
            JOIN products p ON p.id = oi.productId
            WHERE oi.orderId = orders.id
          ) as items`
        )
        .leftJoin('users', 'users.id = orders.userId');
    },
    
    // Preset for export
    export: (query) => {
      query
        .select(
          'orders.id',
          'orders.createdAt',
          'users.name as customerName',
          'users.email as customerEmail',
          'orders.status',
          'SUM(orderItems.quantity * orderItems.price) as total',
          'orders.shippingAddress',
          'orders.notes'
        )
        .leftJoin('users', 'users.id = orders.userId')
        .leftJoin('orderItems', 'orderItems.orderId = orders.id')
        .groupBy('orders.id');
    }
  }
};

// Apply presets based on params
api.hook('modifyQuery', async (context) => {
  const preset = context.params.preset;
  const typePresets = queryPresets[context.options.type];
  
  if (preset && typePresets?.[preset]) {
    typePresets[preset](context.query);
  }
});

// Usage: GET /api/orders?preset=summary
// Usage: GET /api/orders?preset=detailed&filter[status]=pending

// ============================================================
// APPROACH 4: Computed Fields Pattern
// Add virtual fields calculated from other data
// ============================================================

const computedFields = {
  users: {
    // Full name from first + last
    fullName: (query) => {
      query.select("CONCAT(users.firstName, ' ', users.lastName) as fullName");
    },
    
    // Age from birth date
    age: (query) => {
      query.select('TIMESTAMPDIFF(YEAR, users.birthDate, CURDATE()) as age');
    },
    
    // Account age
    accountAge: (query) => {
      query.select('DATEDIFF(CURDATE(), users.createdAt) as accountAgeDays');
    },
    
    // Activity level based on last login
    activityLevel: (query) => {
      query.select(`
        CASE 
          WHEN users.lastLoginAt > DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 'active'
          WHEN users.lastLoginAt > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'recent'
          WHEN users.lastLoginAt > DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'inactive'
          ELSE 'dormant'
        END as activityLevel
      `);
    }
  },
  
  products: {
    // Stock status
    stockStatus: (query) => {
      query.select(`
        CASE
          WHEN products.inventory = 0 THEN 'out_of_stock'
          WHEN products.inventory < products.lowStockThreshold THEN 'low_stock'
          ELSE 'in_stock'
        END as stockStatus
      `);
    },
    
    // Discount percentage
    discountPercent: (query) => {
      query.select(`
        CASE
          WHEN products.salePrice IS NOT NULL 
          THEN ROUND((1 - products.salePrice / products.price) * 100)
          ELSE 0
        END as discountPercent
      `);
    }
  }
};

// Apply computed fields based on fields parameter
api.hook('modifyQuery', async (context) => {
  const requestedFields = context.params.fields?.[context.options.type] || [];
  const typeComputedFields = computedFields[context.options.type];
  
  if (typeComputedFields) {
    for (const field of requestedFields) {
      if (typeComputedFields[field]) {
        typeComputedFields[field](context.query);
      }
    }
  }
});

// Usage: GET /api/users?fields[users]=id,name,fullName,age,activityLevel

// ============================================================
// APPROACH 5: Relationship Expansion Pattern
// Automatically expand relationships based on refs
// ============================================================

// Generic relationship expander
api.hook('modifyQuery', async (context) => {
  const expand = context.params.expand?.split(',') || [];
  const schema = api.schemas.get(context.options.type);
  
  for (const field of expand) {
    const fieldDef = schema?.structure[field];
    
    if (fieldDef?.refs) {
      const relatedResource = fieldDef.refs.resource;
      const relatedSchema = api.schemas.get(relatedResource);
      
      if (relatedSchema) {
        // Get all non-silent fields from related resource
        const fields = Object.entries(relatedSchema.structure)
          .filter(([_, def]) => !def.silent)
          .map(([name, _]) => `${relatedResource}.${name} as ${field}_${name}`);
        
        context.query
          .select(...fields)
          .leftJoin(relatedResource, `${relatedResource}.id = ${context.options.type}.${field}`);
      }
    }
  }
});

// Usage: GET /api/reviews?expand=userId,productId
// Returns reviews with all user and product fields prefixed

// ============================================================
// APPROACH 6: Access Control in Queries
// Row-level security
// ============================================================

// Define access rules
const accessRules = {
  documents: {
    // Users can only see their own documents or public ones
    user: (query, user) => {
      query.where(
        '(documents.ownerId = ? OR documents.visibility = ?)',
        user.id, 'public'
      );
    },
    
    // Managers can see their team's documents
    manager: (query, user) => {
      query
        .leftJoin('users', 'users.id = documents.ownerId')
        .where('(users.teamId = ? OR documents.visibility = ?)', 
          user.teamId, 'public'
        );
    },
    
    // Admins see everything (no filter)
    admin: (query, user) => {}
  }
};

// Apply access control
api.hook('finalizeQuery', async (context) => {
  const user = context.options.user;
  if (!user) return; // No auth, no access
  
  const rules = accessRules[context.options.type];
  if (rules?.[user.role]) {
    rules[user.role](context.query, user);
  }
}, 95); // Run very late to ensure it's not overridden

// ============================================================
// APPROACH 7: Query Logging and Analysis
// Track slow queries and usage patterns
// ============================================================

api.hook('finalizeQuery', async (context) => {
  // Add query comment for tracking
  const comment = `/* route:${context.options.route} user:${context.options.user?.id || 'anonymous'} */`;
  
  // MySQL allows comments that can be seen in slow query log
  const originalSQL = context.query.toSQL();
  context.query.toSQL = () => comment + '\n' + originalSQL;
  
  // Log query complexity
  const complexity = {
    joins: context.query.parts.joins.length,
    conditions: context.query.parts.where.length,
    grouping: context.query.parts.groupBy.length > 0,
    ordering: context.query.parts.orderBy.length
  };
  
  // Warn about potentially slow queries
  if (complexity.joins > 3 || (complexity.grouping && !context.params.page?.size)) {
    console.warn('Potentially slow query detected:', {
      type: context.options.type,
      complexity,
      sql: context.query.toSQL()
    });
  }
}, 99);