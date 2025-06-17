import mysql from 'mysql2/promise';

/**
 * MySQL storage plugin for JSON REST API
 */
export const MySQLPlugin = {
  install(api, options = {}) {
    // Initialize connection pools
    api.mysqlPools = new Map();
    api.mysqlConfig = options;

    // Create connection pools
    if (options.connections) {
      for (const conn of options.connections) {
        const pool = mysql.createPool(conn.config);
        api.mysqlPools.set(conn.name || 'default', {
          pool,
          options: conn.options || {}
        });
      }
    } else if (options.connection) {
      // Single connection config
      const pool = mysql.createPool(options.connection);
      api.mysqlPools.set('default', { pool, options: {} });
    }

    // Helper to get current connection
    api.getConnection = (connectionName = 'default') => {
      const conn = api.mysqlPools.get(connectionName);
      if (!conn) {
        throw new Error(`Connection '${connectionName}' not found`);
      }
      return conn;
    };

    // Implement CRUD operations
    api.implement('get', async (context) => {
      const { id, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      const [rows] = await pool.query(
        `SELECT * FROM ?? WHERE ?? = ?`,
        [table, idProperty, id]
      );

      return rows[0] || null;
    });

    api.implement('query', async (context) => {
      const { params, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;

      let query = `SELECT * FROM ??`;
      const queryParams = [table];
      const conditions = [];

      // Build filter conditions
      if (params.filter) {
        for (const [key, value] of Object.entries(params.filter)) {
          if (value === null) {
            conditions.push(`?? IS NULL`);
            queryParams.push(key);
          } else {
            conditions.push(`?? = ?`);
            queryParams.push(key, value);
          }
        }
      }

      // Build search conditions
      if (params.search && options.searchFields) {
        const searchConditions = options.searchFields.map(field => {
          queryParams.push(field, `%${params.search}%`);
          return `?? LIKE ?`;
        });
        if (searchConditions.length > 0) {
          conditions.push(`(${searchConditions.join(' OR ')})`);
        }
      }

      // Add WHERE clause
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      // Count total rows
      const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
      const [countResult] = await pool.query(countQuery, queryParams);
      const total = countResult[0].total;

      // Add sorting
      if (params.sort) {
        const orderBy = params.sort.split(',').map(field => {
          const desc = field.startsWith('-');
          const cleanField = field.replace(/^-/, '');
          queryParams.push(cleanField);
          return `?? ${desc ? 'DESC' : 'ASC'}`;
        });
        query += ` ORDER BY ${orderBy.join(', ')}`;
      }

      // Add pagination
      const pageSize = Number(params.page?.size) || 10;
      const pageNumber = Number(params.page?.number) || 1;
      const offset = (pageNumber - 1) * pageSize;
      
      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(pageSize, offset);

      // Execute query
      const [rows] = await pool.query(query, queryParams);

      return {
        results: rows,
        meta: {
          total,
          pageSize,
          pageNumber,
          totalPages: Math.ceil(total / pageSize)
        }
      };
    });

    api.implement('insert', async (context) => {
      const { data, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      // Handle positioning if enabled
      if (options.positionField && data[options.beforeIdField] !== undefined) {
        await handleMySQLPositioning(pool, table, data, options);
      }

      // Prepare insert data
      const insertData = { ...data };
      delete insertData[options.beforeIdField]; // Remove virtual field

      // Build insert query
      const fields = Object.keys(insertData);
      const placeholders = fields.map(() => '?').join(', ');
      const values = fields.map(field => insertData[field]);

      const [result] = await pool.query(
        `INSERT INTO ?? (${fields.map(() => '??').join(', ')}) VALUES (${placeholders})`,
        [table, ...fields, ...values]
      );

      // Return the inserted record
      if (result.insertId) {
        insertData[idProperty] = result.insertId;
      }

      return insertData;
    });

    api.implement('update', async (context) => {
      const { id, data, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      // Handle positioning if enabled
      if (options.positionField && data[options.beforeIdField] !== undefined) {
        await handleMySQLPositioning(pool, table, { ...data, [idProperty]: id }, options);
      }

      // Prepare update data
      const updateData = { ...data };
      delete updateData[options.beforeIdField]; // Remove virtual field
      delete updateData[idProperty]; // Don't update ID

      // Build update query
      const fields = Object.keys(updateData);
      if (fields.length === 0) {
        // Nothing to update
        return context.result || { [idProperty]: id };
      }

      const setClause = fields.map(() => '?? = ?').join(', ');
      const values = [];
      fields.forEach(field => {
        values.push(field, updateData[field]);
      });

      await pool.query(
        `UPDATE ?? SET ${setClause} WHERE ?? = ?`,
        [table, ...values, idProperty, id]
      );

      // Fetch and return updated record
      const [rows] = await pool.query(
        `SELECT * FROM ?? WHERE ?? = ?`,
        [table, idProperty, id]
      );

      return rows[0] || null;
    });

    api.implement('delete', async (context) => {
      const { id, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      await pool.query(
        `DELETE FROM ?? WHERE ?? = ?`,
        [table, idProperty, id]
      );
    });

    // Add schema sync functionality
    api.syncSchema = async (schema, table, options = {}) => {
      try {
        const { pool } = api.getConnection(options.connection);
        await syncMySQLSchema(pool, schema, table, options);
      } catch (error) {
        console.error(`Failed to sync schema for table ${table}:`, error);
        throw new Error(`Schema sync failed: ${error.message}`);
      }
    };
  }
};

/**
 * Handle MySQL record positioning
 */
async function handleMySQLPositioning(pool, table, record, options) {
  const { positionField, beforeIdField, idProperty } = options;
  const beforeId = record[beforeIdField];

  if (beforeId === null) {
    // Place at end
    const [maxResult] = await pool.query(
      `SELECT MAX(??) as maxPosition FROM ??`,
      [positionField, table]
    );
    record[positionField] = (maxResult[0].maxPosition || 0) + 1;
  } else if (beforeId !== undefined) {
    // Get position of the record to place before
    const [beforeResult] = await pool.query(
      `SELECT ?? FROM ?? WHERE ?? = ?`,
      [positionField, table, idProperty, beforeId]
    );

    if (beforeResult[0]) {
      const position = beforeResult[0][positionField];
      
      // Shift positions
      await pool.query(
        `UPDATE ?? SET ?? = ?? + 1 WHERE ?? >= ?`,
        [table, positionField, positionField, positionField, position]
      );
      
      record[positionField] = position;
    }
  }
}

/**
 * Sync MySQL schema
 */
async function syncMySQLSchema(pool, schema, table, options = {}) {
  const idProperty = options.idProperty || 'id';

  // Check if table exists
  const [tables] = await pool.query(
    `SHOW TABLES LIKE ?`,
    [table]
  );

  if (tables.length === 0) {
    // Create table
    await createMySQLTable(pool, schema, table, idProperty);
  } else {
    // Update table schema
    await updateMySQLTable(pool, schema, table, idProperty);
  }
}

/**
 * Create MySQL table from schema
 */
async function createMySQLTable(pool, schema, table, idProperty) {
  const columns = [];
  
  for (const [fieldName, definition] of Object.entries(schema.structure)) {
    const columnDef = getMySQLColumnDefinition(fieldName, definition);
    columns.push(columnDef);
  }

  // Add primary key
  columns.push(`PRIMARY KEY (\`${idProperty}\`)`);

  const createQuery = `CREATE TABLE \`${table}\` (${columns.join(', ')})`;
  await pool.query(createQuery);
}

/**
 * Update MySQL table schema
 */
async function updateMySQLTable(pool, schema, table, idProperty) {
  // Get existing columns
  const [columns] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  
  const existingColumns = new Set(columns.map(col => col.COLUMN_NAME));

  // Add new columns
  for (const [fieldName, definition] of Object.entries(schema.structure)) {
    if (!existingColumns.has(fieldName)) {
      const columnDef = getMySQLColumnDefinition(fieldName, definition);
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${columnDef}`);
    }
  }
}

/**
 * Get MySQL column definition from schema field
 */
function getMySQLColumnDefinition(fieldName, definition) {
  let sqlType;
  
  switch (definition.type) {
    case 'id':
      sqlType = fieldName === 'id' ? 'INT AUTO_INCREMENT' : 'INT';
      break;
    case 'number':
      if (definition.float) sqlType = 'FLOAT';
      else if (definition.currency) sqlType = 'DECIMAL(10,2)';
      else sqlType = 'INT';
      break;
    case 'string':
      const length = definition.max || definition.length || 255;
      sqlType = definition.text ? 'TEXT' : `VARCHAR(${length})`;
      break;
    case 'boolean':
      sqlType = 'BOOLEAN';
      break;
    case 'timestamp':
      sqlType = 'BIGINT';
      break;
    case 'date':
      sqlType = 'DATE';
      break;
    case 'dateTime':
      sqlType = 'DATETIME';
      break;
    case 'object':
    case 'array':
    case 'serialize':
      sqlType = 'JSON';
      break;
    case 'blob':
      sqlType = 'BLOB';
      break;
    default:
      sqlType = 'VARCHAR(255)';
  }

  const nullable = definition.required ? 'NOT NULL' : 'NULL';
  const defaultValue = definition.default !== undefined 
    ? ` DEFAULT ${mysql.escape(definition.default)}` 
    : '';

  return `\`${fieldName}\` ${sqlType} ${nullable}${defaultValue}`;
}