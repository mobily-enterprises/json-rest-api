import alasql from 'alasql';

/**
 * AlaSQL Memory Database Adapter
 * 
 * Implements the database interface for in-memory SQL using AlaSQL.
 * Handles AlaSQL-specific quirks and type conversions.
 */
export const AlaSQLAdapter = {
  install(api, options = {}) {
    // Initialize AlaSQL database
    const db = new alasql.Database();
    api._alasqlDb = db;
    
    // ID counter for auto-increment simulation
    let idCounter = options.initialIdCounter || 1;
    const idCounters = new Map(); // Per-table counters
    
    // Position counters for atomic positioning
    const positionCounters = new Map(); // Key: "table:field:filter" -> counter
    
    // Implement database interface
    api.implement('db.query', async (context) => {
      const { sql, params } = context;
      
      try {
        // AlaSQL doesn't like newlines in SQL
        const cleanSql = sql.replace(/\n/g, ' ');
        
        // Execute query
        const result = db.exec(cleanSql, params);
        
        // Determine affected rows based on query type
        let affectedRows = 0;
        if (cleanSql.trim().toUpperCase().startsWith('UPDATE') || 
            cleanSql.trim().toUpperCase().startsWith('DELETE')) {
          // For UPDATE/DELETE, AlaSQL returns the number of affected rows
          affectedRows = result || 0;
        } else if (cleanSql.trim().toUpperCase().startsWith('INSERT')) {
          affectedRows = 1; // INSERT always affects 1 row
        } else if (Array.isArray(result)) {
          // For SELECT, count returned rows
          affectedRows = result.length;
        }
        
        // Return in consistent format
        return { 
          rows: Array.isArray(result) ? result : [], 
          fields: [], 
          info: { 
            affectedRows,
            insertId: null // Will be set by insert logic
          } 
        };
      } catch (error) {
        // Add context to error
        error.sql = sql;
        error.params = params;
        throw error;
      }
    });
    
    api.implement('db.connect', async (context) => {
      // Nothing to connect for in-memory database
      // But we can create tables for all registered schemas
      if (api.schemas) {
        for (const [type, schema] of api.schemas.entries()) {
          const ctx = {
            table: type,
            schema,
            idProperty: api.options.idProperty || 'id'
          };
          await api.execute('db.createTable', ctx);
        }
      }
    });
    
    api.implement('db.disconnect', async (context) => {
      // Nothing to disconnect for in-memory database
    });
    
    // AlaSQL-specific formatting
    api.implement('db.formatIdentifier', (context) => {
      const { identifier } = context;
      // AlaSQL uses backticks for identifiers
      return `\`${identifier}\``;
    });
    
    api.implement('db.formatParam', (context) => {
      // AlaSQL uses ? for parameters
      return '?';
    });
    
    api.implement('db.escapeIdentifier', (context) => {
      const { identifier } = context;
      // AlaSQL uses backticks like MySQL
      return `\`${identifier.replace(/`/g, '``')}\``;
    });
    
    api.implement('db.convertId', (context) => {
      const { id } = context;
      // AlaSQL is strict about types - convert string IDs to numbers
      return !isNaN(Number(id)) ? Number(id) : id;
    });
    
    api.implement('db.getInsertId', (context) => {
      const { table, data, idProperty } = context;
      // Return the ID that was inserted
      return data[idProperty] || idCounters.get(table) - 1;
    });
    
    api.implement('db.getAffectedRows', (context) => {
      const { result } = context;
      return result.info.affectedRows;
    });
    
    // Generate auto-increment ID
    api.implement('db.generateId', (context) => {
      const { table } = context;
      
      if (!idCounters.has(table)) {
        // Initialize counter for this table
        try {
          const rows = db.exec(`SELECT MAX(id) as maxId FROM \`${table}\``);
          const maxId = rows[0]?.maxId || 0;
          idCounters.set(table, maxId + 1);
        } catch (e) {
          // Table doesn't exist yet
          idCounters.set(table, 1);
        }
      }
      
      const id = idCounters.get(table);
      idCounters.set(table, id + 1);
      return id;
    });
    
    // AlaSQL-specific features
    api.implement('db.features', (context) => {
      return {
        transactions: false, // No transaction support
        returning: false,    // No RETURNING clause
        arrays: true,        // Supports array operations
        json: true,          // Supports JSON
        upsert: false,       // No native upsert
        schemas: false,      // No schema support
        tableCreation: true,
        requiresIdGeneration: true // Needs manual ID generation
      };
    });
    
    // Fix SQL for AlaSQL quirks
    api.implement('db.preprocessSql', (context) => {
      let { sql } = context;
      
      // AlaSQL needs AS in uppercase
      sql = sql.replace(/\s+as\s+/gi, ' AS ');
      
      // AlaSQL doesn't like 'total' as alias
      sql = sql.replace(/AS\s+total\b/gi, 'AS cnt');
      sql = sql.replace(/\.total\b/g, '.cnt');
      
      return sql;
    });
    
    // Clear position counters when dropping tables (for tests)
    api.implement('db.dropTable', async (context) => {
      const { table } = context;
      
      // Clear position counters for this table
      for (const key of positionCounters.keys()) {
        if (key.startsWith(`${table}:`)) {
          positionCounters.delete(key);
        }
      }
      
      // Drop the table
      try {
        db.exec(`DROP TABLE \`${table}\``);
      } catch (e) {
        // Ignore if table doesn't exist
      }
    });
    
    // Table creation for AlaSQL
    api.implement('db.createTable', async (context) => {
      const { table, schema, idProperty } = context;
      
      // Check if table exists
      try {
        db.exec(`SELECT * FROM \`${table}\` LIMIT 0`);
        return; // Table exists
      } catch (e) {
        // Table doesn't exist, create it
      }
      
      const columns = [`\`${idProperty}\` INT PRIMARY KEY`];
      
      for (const [field, def] of Object.entries(schema.structure)) {
        if (field === idProperty) continue;
        
        let sqlType = 'TEXT';
        if (def.type === 'number' || def.type === 'integer') {
          sqlType = 'NUMBER';
        } else if (def.type === 'boolean') {
          sqlType = 'BOOLEAN';
        } else if (def.type === 'timestamp') {
          sqlType = 'DATETIME';
        } else if (def.type === 'object' || def.type === 'array') {
          sqlType = 'JSON';
        }
        
        columns.push(`\`${field}\` ${sqlType}`);
      }
      
      const createSql = `CREATE TABLE \`${table}\` (${columns.join(', ')})`;
      db.exec(createSql);
      
      // Create indexes
      for (const [field, def] of Object.entries(schema.structure)) {
        if (def.searchable || def.dbIndex) {
          try {
            const indexName = `idx_${table}_${field}`;
            db.exec(`CREATE INDEX ${indexName} ON \`${table}\`(\`${field}\`)`);
          } catch (e) {
            // Index might already exist
          }
        }
      }
    });
    
    // Atomic positioning support using counters
    api.implement('atomicGetNextPosition', async (context) => {
      const { type, filter, field } = context;
      
      // Create a unique key for this position sequence
      const filterKey = JSON.stringify(filter || {});
      const counterKey = `${type}:${field}:${filterKey}`;
      
      // Get or initialize counter for this sequence
      if (!positionCounters.has(counterKey)) {
        // Initialize counter by checking existing max position
        const db = api._alasqlDb;
        const conditions = [];
        const values = [];
        
        for (const [key, value] of Object.entries(filter || {})) {
          conditions.push(`\`${key}\` = ?`);
          values.push(value);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        
        let maxPos = 0;
        try {
          const result = db.exec(`
            SELECT MAX(\`${field}\`) as maxPos 
            FROM \`${type}\` 
            ${whereClause}
          `, values);
          
          maxPos = result[0]?.maxPos || 0;
        } catch (error) {
          // Table doesn't exist yet - that's OK
          if (!error.message?.includes('Table does not exist')) {
            throw error;
          }
        }
        
        positionCounters.set(counterKey, maxPos);
      }
      
      // Atomically increment and return next position
      // This is synchronous, so truly atomic in JavaScript!
      const currentMax = positionCounters.get(counterKey);
      const nextPos = currentMax + 1;
      positionCounters.set(counterKey, nextPos);
      
      return nextPos;
    });
    
    // Mark that we support atomic operations
    api.storagePlugin = api.storagePlugin || {};
    api.storagePlugin.supportsAtomicIncrement = true;
    api.storagePlugin.atomicGetNextPosition = async (type, filter, field) => {
      return await api.execute('atomicGetNextPosition', { type, filter, field });
    };
  }
};