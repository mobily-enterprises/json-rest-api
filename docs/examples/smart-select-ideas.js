/**
 * Smart Select Ideas - Making field selection more intuitive
 * 
 * Instead of SQL strings, use JavaScript-friendly syntax
 */

// ============================================================
// CURRENT WAY (Still SQL-ish)
// ============================================================

query
  .leftJoin('authorId')
  .select('users.name as authorName', 'users.email as authorEmail');

// ============================================================
// IDEA 1: Method Chaining for Joined Tables
// ============================================================

query
  .leftJoin('authorId')
  .selectFrom('users', ['name', 'email']);  // Automatically aliases as authorId_name, authorId_email

// Or with custom aliases:
query
  .leftJoin('authorId')
  .selectFrom('users', {
    name: 'authorName',      // users.name as authorName
    email: 'authorEmail'     // users.email as authorEmail
  });

// ============================================================
// IDEA 2: Smart Field Selection with Refs Context
// ============================================================

// Since we know authorId refs to users, we could do:
query
  .includeFrom('authorId', ['name', 'email']);  // Knows to join AND select

// Or with aliases:
query
  .includeFrom('authorId', {
    name: 'authorName',
    email: 'authorEmail'
  });

// ============================================================
// IDEA 3: Fluent Interface for Each Join
// ============================================================

query
  .leftJoin('authorId')
    .fields(['name', 'email'])  // Context knows we're selecting from the just-joined table
  .leftJoin('categoryId')
    .fields(['name', 'slug']);  // These come from categories

// ============================================================
// IDEA 4: Object-Based Query Building
// ============================================================

query.include({
  authorId: ['name', 'email'],        // Include these fields from users
  categoryId: ['name', 'slug']        // Include these fields from categories
});

// Or with aliases:
query.include({
  authorId: {
    name: 'authorName',
    email: 'authorEmail',
    avatar: true  // Use field name as-is
  },
  categoryId: {
    name: 'categoryName',
    slug: true
  }
});

// ============================================================
// IDEA 5: Smart Defaults with Override
// ============================================================

// By default, use the relationship field as prefix
query
  .leftJoin('authorId')
  .selectJoined(['name', 'email']);  // Becomes: authorId_name, authorId_email

// But allow override:
query
  .leftJoin('authorId')
  .selectJoined(['name', 'email'], { prefix: 'author' });  // Becomes: author_name, author_email

// Or no prefix:
query
  .leftJoin('authorId')
  .selectJoined(['name', 'email'], { prefix: false });  // Becomes: name, email (dangerous!)

// ============================================================
// IDEA 6: Builder Pattern for Complex Selections
// ============================================================

query
  .join('authorId', join => {
    join
      .select('name', 'email')
      .where('active = ?', true);  // Join-specific conditions!
  })
  .join('categoryId', join => {
    join.select('name').as('categoryName');
  });

// ============================================================
// MY RECOMMENDATION: Combine the Best Ideas
// ============================================================

// 1. Extend includeRelated to accept objects for aliases
query.includeRelated('authorId', {
  name: 'authorName',      // Alias
  email: true,             // Use default alias: authorId_email
  avatar: 'authorAvatar'   // Alias
});

// 2. Add selectFrom for manual control
query
  .leftJoin('authorId')
  .selectFrom('users', {
    name: 'authorName',
    email: 'authorEmail'
  });

// 3. Add a simple array version that auto-prefixes
query
  .leftJoin('authorId')
  .selectFrom('users', ['name', 'email']);  // Auto becomes: authorId_name, authorId_email

// ============================================================
// IMPLEMENTATION SKETCH
// ============================================================

class QueryBuilder {
  /**
   * Select fields from a specific table
   * @param {string} table - Table name
   * @param {Array|Object} fields - Fields to select
   */
  selectFrom(table, fields) {
    // Find which join this table belongs to
    const join = this.parts.joins.find(j => j.table === table);
    const prefix = join?.field || table;
    
    if (Array.isArray(fields)) {
      // Auto-prefix with field name
      fields.forEach(field => {
        this.select(`${table}.${field} as ${prefix}_${field}`);
      });
    } else {
      // Object format for custom aliases
      Object.entries(fields).forEach(([field, alias]) => {
        if (alias === true) {
          // Use auto-prefix
          this.select(`${table}.${field} as ${prefix}_${field}`);
        } else {
          // Use custom alias
          this.select(`${table}.${field} as ${alias}`);
        }
      });
    }
    
    return this;
  }
  
  /**
   * Enhanced includeRelated with alias support
   */
  includeRelated(fieldName, fieldsOrOptions = null) {
    // ... existing join logic ...
    
    if (typeof fieldsOrOptions === 'object' && !Array.isArray(fieldsOrOptions)) {
      // Object format with aliases
      Object.entries(fieldsOrOptions).forEach(([field, alias]) => {
        if (alias === true) {
          this.select(`${relatedResource}.${field} as ${fieldName}_${field}`);
        } else {
          this.select(`${relatedResource}.${field} as ${alias}`);
        }
      });
    }
    // ... rest of existing logic ...
  }
}