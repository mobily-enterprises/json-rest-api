/**
 * Advanced Query Examples
 * 
 * Real-world patterns for complex queries with the query builder
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

// ============================================================
// PATTERN 1: Multi-Tenant Filtering
// Automatically filter all queries by tenant
// ============================================================

// Add tenant filtering to ALL resources
api.hook('initializeQuery', async (context) => {
  // Assume tenant is passed in options from auth middleware
  const tenantId = context.options.tenantId;
  
  if (tenantId && context.method === 'query') {
    // Check if table has tenantId field
    const schema = api.schemas.get(context.options.type);
    if (schema?.structure.tenantId) {
      context.query.where(`${context.options.type}.tenantId = ?`, tenantId);
    }
  }
}, 20); // Run after default initialization

// ============================================================
// PATTERN 2: Hierarchical Data (Categories with Subcategories)
// Load category tree with counts
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'categories' && context.params.includeTree) {
    context.query
      .select(
        'parent.name as parentName',
        'parent.slug as parentSlug',
        '(SELECT COUNT(*) FROM products WHERE products.categoryId = categories.id) as productCount',
        '(SELECT COUNT(*) FROM categories sub WHERE sub.parentId = categories.id) as childCount'
      )
      .leftJoin('categories as parent', 'parent.id = categories.parentId');
  }
});

// ============================================================
// PATTERN 3: Complex Search with Relevance Scoring
// Full-text search across multiple fields with ranking
// ============================================================

api.hook('modifyQuery', async (context) => {
  const search = context.params.search;
  
  if (context.options.type === 'products' && search) {
    // Clear default select to add our custom fields
    context.query.clearSelect();
    
    // Add all product fields plus relevance score
    context.query
      .select(
        'products.*',
        `(
          CASE
            WHEN products.name = ? THEN 100
            WHEN products.name LIKE ? THEN 50
            WHEN products.description LIKE ? THEN 20
            WHEN products.tags LIKE ? THEN 10
            ELSE 0
          END
        ) as relevance`
      )
      .where(
        '(products.name LIKE ? OR products.description LIKE ? OR products.tags LIKE ?)',
        `%${search}%`, `%${search}%`, `%${search}%`
      )
      .orderBy('relevance', 'DESC');
    
    // Add args for CASE statement
    const exactMatch = search;
    const likeMatch = `%${search}%`;
    context.query.parts.where[0].args.unshift(
      exactMatch,    // Exact name match
      likeMatch,     // Name contains
      likeMatch,     // Description contains
      likeMatch      // Tags contain
    );
  }
});

// ============================================================
// PATTERN 4: Time-Based Queries
// Common patterns for date filtering
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'orders') {
    const period = context.params.period;
    
    switch (period) {
      case 'today':
        context.query.where('DATE(orders.createdAt) = CURDATE()');
        break;
        
      case 'yesterday':
        context.query.where('DATE(orders.createdAt) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)');
        break;
        
      case 'thisWeek':
        context.query.where('YEARWEEK(orders.createdAt) = YEARWEEK(NOW())');
        break;
        
      case 'lastWeek':
        context.query.where('YEARWEEK(orders.createdAt) = YEARWEEK(NOW()) - 1');
        break;
        
      case 'thisMonth':
        context.query.where('MONTH(orders.createdAt) = MONTH(NOW()) AND YEAR(orders.createdAt) = YEAR(NOW())');
        break;
        
      case 'last30Days':
        context.query.where('orders.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)');
        break;
    }
    
    // Add time-based aggregations
    if (context.params.groupByDay) {
      context.query
        .select('DATE(orders.createdAt) as date', 'COUNT(*) as orderCount', 'SUM(orders.total) as revenue')
        .groupBy('DATE(orders.createdAt)')
        .orderBy('date', 'DESC');
    }
  }
});

// ============================================================
// PATTERN 5: Geographic Queries
// Find nearby locations using lat/lng
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'stores' && context.params.near) {
    const { lat, lng, radius = 10 } = context.params.near;
    
    // Haversine formula for distance calculation
    context.query
      .select(
        'stores.*',
        `(
          6371 * acos(
            cos(radians(?)) * 
            cos(radians(stores.latitude)) * 
            cos(radians(stores.longitude) - radians(?)) + 
            sin(radians(?)) * 
            sin(radians(stores.latitude))
          )
        ) as distance`
      )
      .having('distance < ?', radius)
      .orderBy('distance', 'ASC');
    
    // Add latitude/longitude args for distance calculation
    context.query.parts.select[1].args = [lat, lng, lat];
  }
});

// ============================================================
// PATTERN 6: Recursive Queries (Comments with Replies)
// Load comments with nested reply structure
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'comments' && context.params.includeReplies) {
    // This is complex - we'll build a CTE (Common Table Expression)
    const postId = context.params.filter?.postId;
    
    // For MySQL 8.0+ with CTE support
    const cteQuery = `
      WITH RECURSIVE comment_tree AS (
        -- Base case: top-level comments
        SELECT 
          c.*,
          0 as depth,
          CAST(c.id AS CHAR(255)) as path
        FROM comments c
        WHERE c.parentId IS NULL
          AND c.postId = ?
        
        UNION ALL
        
        -- Recursive case: replies
        SELECT 
          c.*,
          ct.depth + 1,
          CONCAT(ct.path, '/', c.id)
        FROM comments c
        JOIN comment_tree ct ON c.parentId = ct.id
      )
      SELECT * FROM comment_tree
      ORDER BY path
    `;
    
    // Replace the entire query with our CTE
    context.customQuery = {
      sql: cteQuery,
      args: [postId],
      countSql: 'SELECT COUNT(*) as total FROM comments WHERE postId = ?'
    };
  }
});

// ============================================================
// PATTERN 7: Pivot/Crosstab Queries
// Transform rows into columns for reporting
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'sales' && context.params.pivot === 'monthly') {
    context.query
      .clearSelect()
      .select(
        'products.name as product',
        'SUM(CASE WHEN MONTH(sales.date) = 1 THEN sales.amount ELSE 0 END) as jan',
        'SUM(CASE WHEN MONTH(sales.date) = 2 THEN sales.amount ELSE 0 END) as feb',
        'SUM(CASE WHEN MONTH(sales.date) = 3 THEN sales.amount ELSE 0 END) as mar',
        'SUM(CASE WHEN MONTH(sales.date) = 4 THEN sales.amount ELSE 0 END) as apr',
        'SUM(CASE WHEN MONTH(sales.date) = 5 THEN sales.amount ELSE 0 END) as may',
        'SUM(CASE WHEN MONTH(sales.date) = 6 THEN sales.amount ELSE 0 END) as jun',
        'SUM(CASE WHEN MONTH(sales.date) = 7 THEN sales.amount ELSE 0 END) as jul',
        'SUM(CASE WHEN MONTH(sales.date) = 8 THEN sales.amount ELSE 0 END) as aug',
        'SUM(CASE WHEN MONTH(sales.date) = 9 THEN sales.amount ELSE 0 END) as sep',
        'SUM(CASE WHEN MONTH(sales.date) = 10 THEN sales.amount ELSE 0 END) as oct',
        'SUM(CASE WHEN MONTH(sales.date) = 11 THEN sales.amount ELSE 0 END) as nov',
        'SUM(CASE WHEN MONTH(sales.date) = 12 THEN sales.amount ELSE 0 END) as dec',
        'SUM(sales.amount) as total'
      )
      .innerJoin('products', 'products.id = sales.productId')
      .where('YEAR(sales.date) = ?', new Date().getFullYear())
      .groupBy('products.id', 'products.name')
      .orderBy('total', 'DESC');
  }
});

// ============================================================
// PATTERN 8: Window Functions (Running Totals, Rankings)
// Advanced analytics with MySQL 8.0+
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'transactions' && context.params.includeAnalytics) {
    context.query
      .select(
        'transactions.*',
        'SUM(amount) OVER (PARTITION BY userId ORDER BY createdAt) as runningBalance',
        'ROW_NUMBER() OVER (PARTITION BY userId ORDER BY createdAt DESC) as transactionRank',
        'LAG(amount) OVER (PARTITION BY userId ORDER BY createdAt) as previousAmount',
        'LEAD(amount) OVER (PARTITION BY userId ORDER BY createdAt) as nextAmount'
      );
  }
});

// ============================================================
// PATTERN 9: JSON Aggregation
// Build nested JSON structures in the query
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'users' && context.params.includeOrders) {
    context.query
      .select(
        'users.*',
        `(
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', orders.id,
              'total', orders.total,
              'status', orders.status,
              'date', orders.createdAt
            )
          )
          FROM orders
          WHERE orders.userId = users.id
          ORDER BY orders.createdAt DESC
          LIMIT 5
        ) as recentOrders`
      );
  }
});

// ============================================================
// PATTERN 10: Performance Optimization Patterns
// ============================================================

// Use covering indexes by selecting only indexed fields
api.hook('modifyQuery', async (context) => {
  if (context.params.optimize === 'covering') {
    const indexedFields = context.options.indexedFields || ['id', 'status', 'createdAt'];
    context.query
      .clearSelect()
      .select(...indexedFields.map(f => `${context.options.type}.${f}`));
  }
});

// Force index usage for specific queries
api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'orders' && context.params.forceIndex) {
    // MySQL-specific syntax to force index
    const table = context.query.parts.from;
    context.query.parts.from = `${table} FORCE INDEX (${context.params.forceIndex})`;
  }
});

// Partition pruning for large tables
api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'logs' && context.params.filter?.date) {
    // Assuming logs table is partitioned by date
    // MySQL will automatically prune partitions based on WHERE clause
    context.query.where('DATE(logs.createdAt) = ?', context.params.filter.date);
  }
});