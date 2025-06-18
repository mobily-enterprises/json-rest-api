/**
 * Query Builder for JSON REST API
 * 
 * A simple, maintainable query builder that generates SQL from composable parts.
 * Designed to be modified by multiple hooks without conflicts.
 * 
 * Example usage:
 *   const query = new QueryBuilder('users');
 *   query
 *     .select('users.*', 'COUNT(posts.id) as postCount')
 *     .leftJoin('posts', 'posts.userId = users.id')
 *     .where('users.active = ?', true)
 *     .groupBy('users.id')
 *     .orderBy('users.name');
 */

export class QueryBuilder {
  constructor(resourceType) {
    this.resourceType = resourceType;
    
    // Parts of the query stored separately for easy modification
    this.parts = {
      select: [],        // Array of strings: ['users.*', 'COUNT(posts.id) as postCount']
      from: resourceType, // String: 'users'
      joins: [],         // Array of objects: [{type: 'LEFT', table: 'posts', on: 'posts.userId = users.id'}]
      where: [],         // Array of objects: [{sql: 'users.active = ?', args: [true]}]
      groupBy: [],       // Array of strings: ['users.id']
      having: [],        // Array of objects: [{sql: 'COUNT(posts.id) > ?', args: [5]}]
      orderBy: [],       // Array of objects: [{field: 'users.name', direction: 'ASC'}]
      limit: null,       // Number or null
      offset: null       // Number or null
    };
    
    // Track all args in order for parameterized queries
    this._args = [];
  }
  
  /**
   * Add fields to SELECT clause
   * @param {...string} fields - Fields to select
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * query.select('users.*', 'posts.title')
   */
  select(...fields) {
    this.parts.select.push(...fields);
    return this;
  }
  
  /**
   * Clear all select fields (useful for count queries)
   * @returns {QueryBuilder} this for chaining
   */
  clearSelect() {
    this.parts.select = [];
    return this;
  }
  
  /**
   * Add a JOIN clause
   * @param {string} type - JOIN type (INNER, LEFT, RIGHT)
   * @param {string} table - Table to join
   * @param {string} on - JOIN condition
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * query.leftJoin('posts', 'posts.userId = users.id')
   */
  join(type, table, on) {
    this.parts.joins.push({ type: type.toUpperCase(), table, on });
    return this;
  }
  
  // Convenience methods for common joins
  innerJoin(table, on) { return this.join('INNER', table, on); }
  leftJoin(table, on) { return this.join('LEFT', table, on); }
  rightJoin(table, on) { return this.join('RIGHT', table, on); }
  
  /**
   * Add a WHERE condition
   * @param {string} sql - SQL condition with ? placeholders
   * @param {...any} args - Arguments for placeholders
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * query.where('users.age > ?', 18)
   * query.where('users.name LIKE ?', '%john%')
   */
  where(sql, ...args) {
    this.parts.where.push({ sql, args });
    return this;
  }
  
  /**
   * Add a GROUP BY field
   * @param {...string} fields - Fields to group by
   * @returns {QueryBuilder} this for chaining
   */
  groupBy(...fields) {
    this.parts.groupBy.push(...fields);
    return this;
  }
  
  /**
   * Add a HAVING condition
   * @param {string} sql - SQL condition with ? placeholders
   * @param {...any} args - Arguments for placeholders
   * @returns {QueryBuilder} this for chaining
   */
  having(sql, ...args) {
    this.parts.having.push({ sql, args });
    return this;
  }
  
  /**
   * Add ORDER BY clause
   * @param {string} field - Field to order by
   * @param {string} direction - ASC or DESC (default: ASC)
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * query.orderBy('name')  // ASC by default
   * query.orderBy('createdAt', 'DESC')
   */
  orderBy(field, direction = 'ASC') {
    this.parts.orderBy.push({ 
      field, 
      direction: direction.toUpperCase() 
    });
    return this;
  }
  
  /**
   * Set LIMIT and OFFSET
   * @param {number} limit - Maximum rows to return
   * @param {number} offset - Rows to skip (optional)
   * @returns {QueryBuilder} this for chaining
   */
  limit(limit, offset = null) {
    this.parts.limit = limit;
    if (offset !== null) {
      this.parts.offset = offset;
    }
    return this;
  }
  
  /**
   * Set just the OFFSET
   * @param {number} offset - Rows to skip
   * @returns {QueryBuilder} this for chaining
   */
  offset(offset) {
    this.parts.offset = offset;
    return this;
  }
  
  /**
   * Build the final SQL query
   * @returns {string} Complete SQL query
   */
  toSQL() {
    const sql = [];
    
    // SELECT clause
    if (this.parts.select.length > 0) {
      sql.push(`SELECT ${this.parts.select.join(', ')}`);
    } else {
      sql.push('SELECT *');
    }
    
    // FROM clause
    sql.push(`FROM \`${this.parts.from}\``);
    
    // JOIN clauses
    for (const join of this.parts.joins) {
      sql.push(`${join.type} JOIN \`${join.table}\` ON ${join.on}`);
    }
    
    // WHERE clause
    if (this.parts.where.length > 0) {
      const conditions = this.parts.where.map(w => w.sql).join(' AND ');
      sql.push(`WHERE ${conditions}`);
    }
    
    // GROUP BY clause
    if (this.parts.groupBy.length > 0) {
      sql.push(`GROUP BY ${this.parts.groupBy.join(', ')}`);
    }
    
    // HAVING clause
    if (this.parts.having.length > 0) {
      const conditions = this.parts.having.map(h => h.sql).join(' AND ');
      sql.push(`HAVING ${conditions}`);
    }
    
    // ORDER BY clause
    if (this.parts.orderBy.length > 0) {
      const orderClauses = this.parts.orderBy
        .map(o => `${o.field} ${o.direction}`)
        .join(', ');
      sql.push(`ORDER BY ${orderClauses}`);
    }
    
    // LIMIT clause
    if (this.parts.limit !== null) {
      if (this.parts.offset !== null) {
        sql.push(`LIMIT ${this.parts.offset}, ${this.parts.limit}`);
      } else {
        sql.push(`LIMIT ${this.parts.limit}`);
      }
    }
    
    return sql.join('\n');
  }
  
  /**
   * Build a COUNT query (for pagination)
   * @returns {string} SQL query that counts total rows
   */
  toCountSQL() {
    const sql = [];
    
    // Simple COUNT(*)
    sql.push('SELECT COUNT(*) as total');
    
    // FROM clause
    sql.push(`FROM \`${this.parts.from}\``);
    
    // JOIN clauses (same as main query)
    for (const join of this.parts.joins) {
      sql.push(`${join.type} JOIN \`${join.table}\` ON ${join.on}`);
    }
    
    // WHERE clause (same as main query)
    if (this.parts.where.length > 0) {
      const conditions = this.parts.where.map(w => w.sql).join(' AND ');
      sql.push(`WHERE ${conditions}`);
    }
    
    // Note: COUNT query doesn't need GROUP BY, HAVING, ORDER BY, or LIMIT
    
    return sql.join('\n');
  }
  
  /**
   * Get all query arguments in order
   * @returns {Array} Flattened array of all arguments
   */
  getArgs() {
    const args = [];
    
    // Collect args from WHERE
    for (const where of this.parts.where) {
      args.push(...where.args);
    }
    
    // Collect args from HAVING
    for (const having of this.parts.having) {
      args.push(...having.args);
    }
    
    return args;
  }
  
  /**
   * Clone this query builder
   * @returns {QueryBuilder} A deep copy of this builder
   */
  clone() {
    const cloned = new QueryBuilder(this.resourceType);
    
    // Deep copy all parts
    cloned.parts = {
      select: [...this.parts.select],
      from: this.parts.from,
      joins: this.parts.joins.map(j => ({...j})),
      where: this.parts.where.map(w => ({...w, args: [...w.args]})),
      groupBy: [...this.parts.groupBy],
      having: this.parts.having.map(h => ({...h, args: [...h.args]})),
      orderBy: this.parts.orderBy.map(o => ({...o})),
      limit: this.parts.limit,
      offset: this.parts.offset
    };
    
    return cloned;
  }
  
  /**
   * Debug helper - get human-readable representation
   * @returns {Object} Current state of the builder
   */
  inspect() {
    return {
      sql: this.toSQL(),
      args: this.getArgs(),
      parts: this.parts
    };
  }
}

/**
 * Helper to safely escape field names
 * @param {string} field - Field name, possibly with table prefix
 * @returns {string} Escaped field name
 * 
 * @example
 * escapeField('users.name') => '`users`.`name`'
 * escapeField('name') => '`name`'
 */
export function escapeField(field) {
  if (field.includes('.')) {
    const [table, column] = field.split('.');
    return `\`${table}\`.\`${column}\``;
  }
  return `\`${field}\``;
}

/**
 * Helper to build field list from schema
 * @param {Schema} schema - Schema object
 * @param {string} tablePrefix - Optional table prefix
 * @returns {Array<string>} Array of field names
 */
export function schemaFields(schema, tablePrefix = null) {
  const fields = [];
  
  for (const [fieldName, definition] of Object.entries(schema.structure)) {
    // Skip silent fields
    if (definition.silent) continue;
    
    if (tablePrefix) {
      fields.push(`\`${tablePrefix}\`.\`${fieldName}\``);
    } else {
      fields.push(`\`${fieldName}\``);
    }
  }
  
  return fields;
}