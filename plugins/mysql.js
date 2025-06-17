import mysql from 'mysql2/promise';
import { NotFoundError, InternalError, ConflictError, ErrorCodes } from '../errors.js';

/**
 * MySQL storage plugin for JSON REST API with full feature parity
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
        throw new InternalError(`Database connection '${connectionName}' not found`)
          .withContext({ connectionName });
      }
      return conn;
    };

    // Add hooks for advanced querying
    api.hook('beforeQuery', async (context) => {
      const { options } = context;
      if (options.queryFieldsAndJoins && typeof options.queryFieldsAndJoins === 'function') {
        const customQuery = await options.queryFieldsAndJoins(context);
        if (customQuery) {
          context.customQuery = customQuery;
        }
      }
    });

    api.hook('beforeUpdate', async (context) => {
      const { options } = context;
      if (options.updateConditionsAndArgs && typeof options.updateConditionsAndArgs === 'function') {
        const customConditions = await options.updateConditionsAndArgs(context);
        if (customConditions) {
          context.customConditions = customConditions;
        }
      }
    });

    api.hook('beforeDelete', async (context) => {
      const { options } = context;
      if (options.deleteConditionsAndArgs && typeof options.deleteConditionsAndArgs === 'function') {
        const customConditions = await options.deleteConditionsAndArgs(context);
        if (customConditions) {
          context.customConditions = customConditions;
        }
      }
    });

    // Implement CRUD operations
    api.implement('get', async (context) => {
      const { id, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;
      const idProperty = options.idProperty || api.options.idProperty;

      try {
        const [rows] = await pool.query(
          `SELECT * FROM ?? WHERE ?? = ?`,
          [table, idProperty, id]
        );

        if (!rows[0] && !options.allowNotFound) {
          throw new NotFoundError(options.type || table, id);
        }
        
        return rows[0] || null;
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new InternalError('Database query failed')
          .withContext({ 
            code: ErrorCodes.DATABASE_ERROR,
            originalError: error.message 
          });
      }
    });

    api.implement('query', async (context) => {
      const { params, options } = context;
      const { pool } = api.getConnection(options.connection);
      const table = options.table || options.type;

      // Check for custom query from queryFieldsAndJoins hook
      if (context.customQuery) {
        const { sql, params: customParams, countSql } = context.customQuery;
        
        // Execute count query
        const [countResult] = await pool.query(countSql || sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as total FROM'), customParams);
        const total = countResult[0].total;
        
        // Execute main query
        const [rows] = await pool.query(sql, customParams);
        
        const pageSize = Number(params.page?.size) || 10;
        const pageNumber = Number(params.page?.number) || 1;
        
        return {
          results: rows,
          meta: {
            total,
            pageSize,
            pageNumber,
            totalPages: Math.ceil(total / pageSize)
          }
        };
      }

      // Default query building
      let query = `SELECT * FROM ??`;
      const queryParams = [table];
      const conditions = [];

      // Build filter conditions with support for operators
      if (params.filter) {
        for (const [key, value] of Object.entries(params.filter)) {
          if (value === null) {
            conditions.push(`?? IS NULL`);
            queryParams.push(key);
          } else if (typeof value === 'object' && value !== null) {
            // Support for operators like $gt, $lt, $like, etc.
            for (const [op, val] of Object.entries(value)) {
              switch (op) {
                case '$gt':
                  conditions.push(`?? > ?`);
                  queryParams.push(key, val);
                  break;
                case '$gte':
                  conditions.push(`?? >= ?`);
                  queryParams.push(key, val);
                  break;
                case '$lt':
                  conditions.push(`?? < ?`);
                  queryParams.push(key, val);
                  break;
                case '$lte':
                  conditions.push(`?? <= ?`);
                  queryParams.push(key, val);
                  break;
                case '$ne':
                  conditions.push(`?? != ?`);
                  queryParams.push(key, val);
                  break;
                case '$like':
                  conditions.push(`?? LIKE ?`);
                  queryParams.push(key, val);
                  break;
                case '$in':
                  if (Array.isArray(val) && val.length > 0) {
                    conditions.push(`?? IN (${val.map(() => '?').join(',')})`);
                    queryParams.push(key, ...val);
                  }
                  break;
                case '$nin':
                  if (Array.isArray(val) && val.length > 0) {
                    conditions.push(`?? NOT IN (${val.map(() => '?').join(',')})`);
                    queryParams.push(key, ...val);
                  }
                  break;
              }
            }
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

      // Add sorting with multiple field support
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

      // Handle custom conditions from updateConditionsAndArgs hook
      let whereClause = `?? = ?`;
      let whereParams = [idProperty, id];
      
      if (context.customConditions) {
        const { conditions, params } = context.customConditions;
        whereClause = conditions;
        whereParams = params;
      }

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
        `UPDATE ?? SET ${setClause} WHERE ${whereClause}`,
        [table, ...values, ...whereParams]
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

      // Handle custom conditions from deleteConditionsAndArgs hook
      let whereClause = `?? = ?`;
      let whereParams = [idProperty, id];
      
      if (context.customConditions) {
        const { conditions, params } = context.customConditions;
        whereClause = conditions;
        whereParams = params;
      }

      await pool.query(
        `DELETE FROM ?? WHERE ${whereClause}`,
        [table, ...whereParams]
      );
    });

    // Add schema sync functionality
    api.syncSchema = async (schema, table, options = {}) => {
      try {
        const { pool } = api.getConnection(options.connection);
        // Merge options with API options
        const syncOptions = {
          idProperty: api.options.idProperty || 'id',
          positionField: api.options.positionField,
          dbExtraIndexes: api.options.dbExtraIndexes || [],
          stores: api.resources, // For foreign key references
          ...options
        };
        await syncMySQLSchema(pool, schema, table, syncOptions);
      } catch (error) {
        console.error(`Failed to sync schema for table ${table}:`, error);
        throw new Error(`Schema sync failed: ${error.message}`);
      }
    };
  }
};

/**
 * Handle MySQL record positioning with filtering support
 */
async function handleMySQLPositioning(pool, table, record, options) {
  const { positionField, beforeIdField, idProperty, positionFilter } = options;
  const beforeId = record[beforeIdField];

  // Build filter conditions for positioning
  let filterCondition = '';
  const filterParams = [];
  
  if (positionFilter && typeof positionFilter === 'object') {
    const conditions = [];
    for (const [key, value] of Object.entries(positionFilter)) {
      conditions.push(`?? = ?`);
      filterParams.push(key, value);
    }
    if (conditions.length > 0) {
      filterCondition = ` AND ${conditions.join(' AND ')}`;
    }
  }

  if (beforeId === null) {
    // Place at end
    let maxQuery = `SELECT MAX(??) as maxPosition FROM ??`;
    const maxParams = [positionField, table];
    
    if (filterCondition) {
      maxQuery += ` WHERE 1=1 ${filterCondition}`;
      maxParams.push(...filterParams);
    }
    
    const [maxResult] = await pool.query(maxQuery, maxParams);
    record[positionField] = (maxResult[0].maxPosition || 0) + 1;
  } else if (beforeId !== undefined) {
    // Get position of the record to place before
    const [beforeResult] = await pool.query(
      `SELECT ?? FROM ?? WHERE ?? = ?`,
      [positionField, table, idProperty, beforeId]
    );

    if (beforeResult[0]) {
      const position = beforeResult[0][positionField];
      
      // Shift positions with filter support
      let shiftQuery = `UPDATE ?? SET ?? = ?? + 1 WHERE ?? >= ?`;
      const shiftParams = [table, positionField, positionField, positionField, position];
      
      if (filterCondition) {
        shiftQuery += filterCondition;
        shiftParams.push(...filterParams);
      }
      
      await pool.query(shiftQuery, shiftParams);
      
      record[positionField] = position;
    }
  }
}

/**
 * Sync MySQL schema with comprehensive features
 */
async function syncMySQLSchema(pool, schema, table, options = {}) {
  const idProperty = options.idProperty || 'id';
  const positionField = options.positionField;
  const dbExtraIndexes = options.dbExtraIndexes || [];

  // Check if table exists
  const [tables] = await pool.query(
    `SHOW TABLES LIKE ?`,
    [table]
  );

  const tableAlreadyExists = tables.length > 0;
  
  // Create table with dummy column if it doesn't exist
  if (!tableAlreadyExists) {
    await pool.query(`CREATE TABLE \`${table}\` (__dummy__ INT(1))`);
  }

  // Get comprehensive table information
  const [columns] = await pool.query(
    `SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  
  const [indexes] = await pool.query(`SHOW INDEX FROM \`${table}\``);
  
  const [constraints] = await pool.query(
    `SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );

  // Create columns hash for easy lookup
  const columnsHash = columns.reduce((map, column) => {
    map[column.COLUMN_NAME] = column;
    return map;
  }, {});

  const primaryKeyColumn = columns.find(el => el.COLUMN_KEY === 'PRI');

  // Convert schema to array format for easier processing
  const schemaFieldsAsArray = Object.keys(schema.structure).map(k => ({ 
    ...schema.structure[k], 
    name: k 
  }));

  // Determine auto-increment field
  let autoIncrementField = schemaFieldsAsArray.find(el => el.autoIncrement);
  if (!autoIncrementField) {
    autoIncrementField = schemaFieldsAsArray.find(el => el.name === idProperty);
  }
  const autoIncrementFieldName = autoIncrementField ? autoIncrementField.name : idProperty;

  // Handle primary key changes if needed
  if (primaryKeyColumn) {
    await maybeChangePrimaryKey(pool, table, primaryKeyColumn, idProperty, schemaFieldsAsArray);
  }

  // Process columns
  const dbIndexes = [];
  const foreignEndpoints = [];
  
  for (let i = 0; i < schemaFieldsAsArray.length; i++) {
    const field = schemaFieldsAsArray[i];
    const creatingNewColumn = !columnsHash[field.name];
    
    await processColumn(
      pool, table, field, i, schemaFieldsAsArray, 
      creatingNewColumn, idProperty, autoIncrementFieldName,
      columnsHash, dbIndexes, foreignEndpoints, positionField
    );
  }

  // Add extra indexes
  if (dbExtraIndexes.length > 0) {
    for (const ei of dbExtraIndexes) {
      dbIndexes.push({
        column: ei.column,
        unique: ei.unique,
        name: ei.name
      });
    }
  }

  // Remove dummy column if it exists
  if (columnsHash.__dummy__) {
    await pool.query(`ALTER TABLE \`${table}\` DROP COLUMN \`__dummy__\``);
  }

  // Create indexes
  await createIndexes(pool, table, dbIndexes, indexes);

  // Create foreign key constraints
  await createForeignKeyConstraints(pool, table, foreignEndpoints, constraints, options);
}

/**
 * Get MySQL column definition from schema field
 */
function getMySQLColumnDefinition(fieldName, definition, options = {}) {
  let sqlType;
  let length = 256;
  
  // Allow custom DB type override
  if (definition.dbType) {
    sqlType = definition.dbType;
  } else {
    switch (definition.type) {
      case 'id':
        sqlType = 'INT';
        break;
      case 'number':
        if (definition.float) sqlType = 'FLOAT';
        else if (definition.currency) sqlType = 'NUMERIC(10,2)';
        else if (definition.longInt) sqlType = 'BIGINT';
        else sqlType = 'INT';
        break;
      case 'string':
        if (definition.length) length = definition.length;
        if (definition.max) length = definition.max;
        if (definition.asText || definition.text) sqlType = 'TEXT';
        else sqlType = `VARCHAR(${length})`;
        break;
      case 'boolean':
        sqlType = 'TINYINT';
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
      case 'blob':
        if (definition.length) length = definition.length;
        sqlType = `BLOB`;
        break;
      case 'object':
      case 'array':
      case 'serialize':
        sqlType = 'JSON';
        break;
      default:
        if (definition.type) {
          throw new Error(`${definition.type} not converted automatically. Use dbType instead`);
        }
        sqlType = 'VARCHAR(255)';
    }
  }

  // NULL clause - support both 'required' and 'canBeNull'
  const nullable = definition.required || !definition.canBeNull ? 'NOT NULL' : 'NULL';
  
  // Default value, giving priority to dbDefault
  let defaultValue = '';
  if (typeof definition.dbDefault !== 'undefined') {
    defaultValue = ` DEFAULT ${mysql.escape(definition.dbDefault)}`;
  } else if (typeof definition.default !== 'undefined') {
    defaultValue = ` DEFAULT ${mysql.escape(definition.default)}`;
  }

  // AUTO_INCREMENT clause
  const autoIncrement = (definition.autoIncrement || fieldName === options.idProperty) && !options.skipAutoIncrement ? 'AUTO_INCREMENT' : '';

  return `\`${fieldName}\` ${sqlType} ${nullable}${defaultValue} ${autoIncrement}`.trim();
}

/**
 * Process a single column during schema sync
 */
async function processColumn(
  pool, table, field, index, schemaFieldsAsArray,
  creatingNewColumn, idProperty, autoIncrementFieldName,
  columnsHash, dbIndexes, foreignEndpoints, positionField
) {
  const changeOrAddStatement = creatingNewColumn ? 'ADD COLUMN' : `CHANGE \`${field.name}\``;
  
  const def = getMySQLColumnDefinition(field.name, field, { 
    idProperty,
    skipAutoIncrement: autoIncrementFieldName !== field.name 
  });
  
  // Handle primary key for new columns
  const maybePrimaryKey = (creatingNewColumn && field.name === idProperty) ? 'PRIMARY KEY' : '';
  
  // Handle column ordering
  const maybeAfter = index > 0 ? `AFTER \`${schemaFieldsAsArray[index - 1].name}\`` : '';

  const sqlQuery = `ALTER TABLE \`${table}\` ${changeOrAddStatement} ${def} ${maybePrimaryKey} ${maybeAfter}`;
  await pool.query(sqlQuery);

  // Collect index information
  if (field.dbIndex || field.searchable || field.name === positionField) {
    if (columnsHash[field.name] || creatingNewColumn) {
      if (field.name !== idProperty) {
        dbIndexes.push({
          column: field.name,
          unique: field.dbUnique,
          name: field.dbIndexName || `jrs_${field.name}`
        });
      }
    }
  }

  // Collect foreign key information
  if (field.foreignEndpoint) {
    foreignEndpoints.push({
      sourceField: field.name,
      ...field.foreignEndpoint
    });
  }
}

/**
 * Handle primary key changes during schema sync
 */
async function maybeChangePrimaryKey(pool, table, primaryKeyColumn, idProperty, schemaFieldsAsArray) {
  // If primary key hasn't changed, don't do anything
  if (primaryKeyColumn && primaryKeyColumn.COLUMN_NAME === idProperty) {
    return;
  }

  const oldPrimaryKeyColumnName = primaryKeyColumn.COLUMN_NAME;

  // Remove AUTO_INCREMENT from old primary key if present
  if (primaryKeyColumn.EXTRA === 'auto_increment') {
    await pool.query('SET foreign_key_checks = 0');
    const pkc = primaryKeyColumn;
    const defWithoutAutoIncrement = `\`${pkc.COLUMN_NAME}\` ${pkc.COLUMN_TYPE} ${pkc.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'} ${pkc.COLUMN_DEFAULT !== null ? 'DEFAULT ' + mysql.escape(pkc.COLUMN_DEFAULT) : ''}`;
    await pool.query(`ALTER TABLE \`${table}\` CHANGE \`${oldPrimaryKeyColumnName}\` ${defWithoutAutoIncrement}`);
    await pool.query('SET foreign_key_checks = 1');
  }

  // Ensure old primary key has an index
  const [indexIsThere] = await pool.query(
    `SHOW INDEX FROM \`${table}\` WHERE Key_name <> 'PRIMARY' AND Seq_in_index = 1 AND Column_name = ?`,
    [oldPrimaryKeyColumnName]
  );
  
  if (indexIsThere.length === 0) {
    const field = schemaFieldsAsArray.find(def => def.name === oldPrimaryKeyColumnName);
    const dbIndex = field?.dbIndex || `jrs_${oldPrimaryKeyColumnName}`;
    await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${dbIndex}\`(\`${oldPrimaryKeyColumnName}\`)`);
  }

  // Drop old primary key and add new one
  await pool.query(`ALTER TABLE \`${table}\` DROP PRIMARY KEY, ADD PRIMARY KEY (\`${idProperty}\`)`);
  return true;
}

/**
 * Create indexes during schema sync
 */
async function createIndexes(pool, table, dbIndexes, existingIndexes) {
  for (const dbi of dbIndexes) {
    // Handle multiple columns
    let columns;
    if (!Array.isArray(dbi.column)) {
      columns = `\`${dbi.column}\``;
    } else {
      columns = dbi.column.map(c => `\`${c}\``).join(',');
    }

    // Generate index name if not provided
    let indexName = dbi.name;
    if (!indexName) {
      if (!Array.isArray(dbi.column)) {
        indexName = `jrs_${dbi.column}`;
      } else {
        indexName = 'jrs_' + dbi.column.join('_');
      }
    }

    // Skip if index already exists
    if (existingIndexes.find(i => i.Key_name === indexName)) {
      continue;
    }

    const sqlQuery = `ALTER TABLE \`${table}\` ADD ${dbi.unique ? 'UNIQUE' : ''} INDEX \`${indexName}\` (${columns})`;
    await pool.query(sqlQuery);
  }
}

/**
 * Create foreign key constraints during schema sync
 */
async function createForeignKeyConstraints(pool, table, foreignEndpoints, existingConstraints, options) {
  const stores = options.stores || {};
  
  for (const fe of foreignEndpoints) {
    let foreignTable;
    let foreignField;
    let constraintName;

    // Determine foreign table
    if (fe.foreignTable) {
      foreignTable = fe.foreignTable;
    } else if (fe.endpointName && stores[fe.endpointName]) {
      foreignTable = stores[fe.endpointName].table;
    } else {
      throw new Error('Cannot find the foreign table for field: ' + fe.sourceField);
    }

    // Determine foreign field
    if (fe.foreignField) {
      foreignField = fe.foreignField;
    } else if (fe.endpointName && stores[fe.endpointName]) {
      foreignField = stores[fe.endpointName].idProperty || 'id';
    } else {
      foreignField = 'id';
    }

    // Generate constraint name
    if (fe.constraintName) {
      constraintName = fe.constraintName;
    } else {
      constraintName = `jra_${fe.sourceField}_to_${foreignTable}_${foreignField}`;
    }

    // Skip if constraint already exists
    if (existingConstraints.find(c => c.CONSTRAINT_NAME === constraintName)) {
      continue;
    }

    const sqlQuery = `
      ALTER TABLE \`${table}\`
      ADD CONSTRAINT \`${constraintName}\`
      FOREIGN KEY (\`${fe.sourceField}\`)
      REFERENCES \`${foreignTable}\` (\`${foreignField}\`)
      ON DELETE NO ACTION
      ON UPDATE NO ACTION`;
    
    await pool.query(sqlQuery);
  }
}