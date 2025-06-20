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
  constructor(resourceType, api = null) {
    this.resourceType = resourceType;
    this.api = api;  // Reference to API for schema lookups
    
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
   * @param {string} tableOrField - Table name OR field name with refs
   * @param {string} on - JOIN condition (optional if using field with refs)
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * // Traditional way
   * query.leftJoin('posts', 'posts.userId = users.id')
   * 
   * // Smart way using refs
   * query.leftJoin('userId')  // Automatically uses refs: { resource: 'users' }
   */
  join(type, tableOrField, on) {
    // If no ON condition provided, try to build it from schema refs
    if (!on && this.api) {
      const schema = this.api.schemas?.get(this.resourceType);
      const fieldDef = schema?.structure?.[tableOrField];
      
      if (fieldDef?.refs?.resource) {
        // We have refs! Build the join automatically
        const joinTable = fieldDef.refs.resource;
        const baseTable = this.parts.from; // Use the actual table name, not resourceType
        
        // Check if we already have a join to this table
        const existingJoins = this.parts.joins.filter(j => j.table === joinTable || j.table.startsWith(joinTable + ' '));
        const needsAlias = existingJoins.length > 0;
        
        // Use field name as alias if we need one
        const tableAlias = needsAlias ? tableOrField : null;
        const joinTableRef = tableAlias ? `${joinTable} AS ${tableAlias}` : joinTable;
        const joinTarget = tableAlias || joinTable;
        
        const joinCondition = `${joinTarget}.id = ${baseTable}.${tableOrField}`;
        
        this.parts.joins.push({ 
          type: type.toUpperCase(), 
          table: joinTableRef, 
          on: joinCondition,
          field: tableOrField,  // Store the field for reference
          alias: tableAlias     // Store the alias if used
        });
        return this;
      }
    }
    
    // Traditional join with explicit table and condition
    this.parts.joins.push({ type: type.toUpperCase(), table: tableOrField, on });
    return this;
  }
  
  // Convenience methods for common joins
  innerJoin(tableOrField, on) { return this.join('INNER', tableOrField, on); }
  leftJoin(tableOrField, on) { return this.join('LEFT', tableOrField, on); }
  rightJoin(tableOrField, on) { return this.join('RIGHT', tableOrField, on); }
  
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
   * @param {string} field - Field to order by (can be already escaped)
   * @param {string} direction - ASC or DESC (default: ASC)
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * query.orderBy('name')  // ASC by default
   * query.orderBy('createdAt', 'DESC')
   * query.orderBy('`users`.`name`', 'DESC')  // Pre-escaped
   */
  orderBy(field, direction = 'ASC') {
    // Validate direction to prevent injection
    const validDirections = ['ASC', 'DESC'];
    const normalizedDirection = direction.toUpperCase();
    
    if (!validDirections.includes(normalizedDirection)) {
      throw new Error(`Invalid sort direction: ${direction}`);
    }
    
    this.parts.orderBy.push({ 
      field, 
      direction: normalizedDirection 
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
      // Default: select all non-silent fields from the main table
      if (this.api) {
        const schema = this.api.schemas?.get(this.resourceType);
        if (schema) {
          const fields = schemaFields(schema, this.resourceType);
          if (fields.length > 0) {
            sql.push(`SELECT ${fields.join(', ')}`);
          } else {
            // No non-silent fields defined, fall back to *
            sql.push(`SELECT ${this.resourceType}.*`);
          }
        } else {
          // No schema found, use table.*
          sql.push(`SELECT ${this.resourceType}.*`);
        }
      } else {
        // No API reference, fall back to *
        sql.push('SELECT *');
      }
    }
    
    // FROM clause
    sql.push(`FROM \`${this.parts.from}\``);
    
    // JOIN clauses
    for (const join of this.parts.joins) {
      // Handle table with alias properly
      let tableClause = join.table;
      if (join.table.includes(' AS ')) {
        const [table, alias] = join.table.split(' AS ');
        tableClause = `\`${table}\` AS \`${alias.trim()}\``;
      } else {
        tableClause = `\`${join.table}\``;
      }
      sql.push(`${join.type} JOIN ${tableClause} ON ${join.on}`);
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
      sql.push(`LIMIT ${this.parts.limit}`);
      if (this.parts.offset !== null) {
        sql.push(`OFFSET ${this.parts.offset}`);
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
    sql.push('SELECT COUNT(*) AS cnt');
    
    // FROM clause
    sql.push(`FROM \`${this.parts.from}\``);
    
    // JOIN clauses (same as main query)
    for (const join of this.parts.joins) {
      // Handle table with alias properly (same as in toSQL)
      let tableClause = join.table;
      if (join.table.includes(' AS ')) {
        const [table, alias] = join.table.split(' AS ');
        tableClause = `\`${table}\` AS \`${alias.trim()}\``;
      } else {
        tableClause = `\`${join.table}\``;
      }
      sql.push(`${join.type} JOIN ${tableClause} ON ${join.on}`);
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
   * Select fields from a specific table with automatic aliasing
   * @param {string} table - Table name to select from
   * @param {Array<string>|Object} fieldsOrAliases - Fields or field:alias mapping
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * // Auto-prefix with relationship field name
   * query.selectFrom('users', ['name', 'email'])
   * 
   * // Custom aliases
   * query.selectFrom('users', {
   *   name: 'authorName',
   *   email: 'authorEmail',
   *   id: true  // Auto-prefix
   * })
   */
  selectFrom(table, fieldsOrAliases) {
    // Try to find which relationship this table belongs to
    const join = this.parts.joins.find(j => j.table === table);
    const defaultPrefix = join?.field || table;
    
    if (Array.isArray(fieldsOrAliases)) {
      // Array format: auto-prefix with relationship field name
      fieldsOrAliases.forEach(field => {
        this.select(`${table}.${field} as ${defaultPrefix}_${field}`);
      });
    } else if (typeof fieldsOrAliases === 'object') {
      // Object format: custom aliases
      Object.entries(fieldsOrAliases).forEach(([field, alias]) => {
        if (alias === true) {
          // true = use auto-prefix
          this.select(`${table}.${field} as ${defaultPrefix}_${field}`);
        } else if (alias === false) {
          // false = no alias
          this.select(`${table}.${field}`);
        } else if (typeof alias === 'string') {
          // string = custom alias
          this.select(`${table}.${field} as ${alias}`);
        }
      });
    }
    
    return this;
  }
  
  /**
   * Include related resource fields using refs
   * @param {string} fieldName - Field with refs definition
   * @param {Array<string>|Object} fieldsOrOptions - Fields to include or object with aliases
   * @returns {QueryBuilder} this for chaining
   * 
   * @example
   * // Include all user fields
   * query.includeRelated('userId')
   * 
   * // Include specific fields with auto-prefixing
   * query.includeRelated('userId', ['name', 'email'])
   * 
   * // Include with custom aliases
   * query.includeRelated('userId', {
   *   name: 'userName',     // Custom alias
   *   email: true,          // Auto-prefix: userId_email
   *   avatar: 'userAvatar'  // Custom alias
   * })
   */
  includeRelated(fieldName, fieldsOrOptions = null) {
    if (!this.api) return this;
    
    const schema = this.api.schemas?.get(this.resourceType);
    const fieldDef = schema?.structure?.[fieldName];
    
    if (fieldDef?.refs?.resource) {
      const relatedResource = fieldDef.refs.resource;
      const relatedSchema = this.api.schemas?.get(relatedResource);
      
      // First, add the join if not already added
      const joinExists = this.parts.joins.some(j => 
        j.field === fieldName || 
        (j.table === relatedResource && j.on?.includes(fieldName))
      );
      
      if (!joinExists) {
        this.leftJoin(fieldName);
      }
      
      // Handle different input formats
      if (Array.isArray(fieldsOrOptions)) {
        // Array format: auto-prefix all fields
        fieldsOrOptions.forEach(field => {
          this.select(`${relatedResource}.${field} as ${fieldName}_${field}`);
        });
      } else if (typeof fieldsOrOptions === 'object' && fieldsOrOptions !== null) {
        // Object format: support custom aliases
        Object.entries(fieldsOrOptions).forEach(([field, alias]) => {
          if (alias === true) {
            // true means use auto-prefix
            this.select(`${relatedResource}.${field} as ${fieldName}_${field}`);
          } else if (alias === false) {
            // false means no alias (use field name as-is)
            this.select(`${relatedResource}.${field}`);
          } else if (typeof alias === 'string') {
            // Custom alias provided
            this.select(`${relatedResource}.${field} as ${alias}`);
          }
        });
      } else if (relatedSchema) {
        // No fields specified: include all non-silent fields
        Object.entries(relatedSchema.structure).forEach(([field, def]) => {
          if (!def.silent) {
            this.select(`${relatedResource}.${field} as ${fieldName}_${field}`);
          }
        });
      } else {
        // Fallback: include all fields
        this.select(`${relatedResource}.*`);
      }
    }
    
    return this;
  }
  
  /**
   * Clone this query builder
   * @returns {QueryBuilder} A deep copy of this builder
   */
  clone() {
    const cloned = new QueryBuilder(this.resourceType, this.api);
    
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
      fields.push(`${tablePrefix}.${fieldName}`);
    } else {
      fields.push(fieldName);
    }
  }
  
  return fields;
}