/**
 * @file Creates Knex table definitions from json-rest-schema definitions
 */

/**
 * Maps json-rest-schema types to Knex column types
 * @param {object} table - The Knex table builder instance
 * @param {string} columnName - The name of the column
 * @param {object} definition - The schema definition for the field
 * @returns {object} The Knex column builder instance
 */
function mapTypeToKnex(table, columnName, definition) {
  const { type, precision, scale, maxLength, unsigned } = definition;
  
  switch (type) {
    case 'string':
      return maxLength ? table.string(columnName, maxLength) : table.string(columnName);
    
    case 'number':
      if (precision !== undefined && scale !== undefined) {
        return table.decimal(columnName, precision, scale);
      }
      return table.float(columnName);
    
    case 'id':
      const col = table.integer(columnName);
      return unsigned !== false ? col.unsigned() : col;
    
    case 'boolean':
      return table.boolean(columnName);
    
    case 'date':
      return table.date(columnName);
    
    case 'dateTime':
      return table.datetime(columnName);
    
    case 'time':
      return table.time(columnName);
    
    case 'timestamp':
      return table.integer(columnName);
    
    case 'array':
    case 'object':
    case 'serialize':
      return table.json(columnName);
    
    case 'blob':
    case 'file':
      return table.binary(columnName);
    
    case 'none':
    default:
      return table.string(columnName);
  }
}

/**
 * Applies schema constraints to a Knex column
 * @param {object} column - The Knex column builder instance
 * @param {object} definition - The schema definition for the field
 */
function applyConstraints(column, definition) {
  // Nullability
  if (definition.nullable === true) {
    column.nullable();
  } else if (definition.required === true || definition.nullable === false) {
    column.notNullable();
  }
  
  // Default value
  if (definition.defaultTo !== undefined) {
    column.defaultTo(definition.defaultTo);
  }
  
  // Database-specific constraints
  if (definition.unique === true) {
    column.unique();
  }
  
  if (definition.primary === true) {
    column.primary();
  }
  
  if (definition.index === true) {
    column.index();
  }
  
  if (definition.references) {
    column.references(definition.references.column || 'id')
      .inTable(definition.references.table);
    
    if (definition.references.onDelete) {
      column.onDelete(definition.references.onDelete);
    }
    
    if (definition.references.onUpdate) {
      column.onUpdate(definition.references.onUpdate);
    }
  }
  
  if (definition.comment) {
    column.comment(definition.comment);
  }
}

/**
 * Creates a Knex table from a json-rest-schema definition
 * @param {object} knex - The Knex instance
 * @param {string} tableName - The name of the table to create
 * @param {object} schema - The json-rest-schema instance
 * @param {string} [idProperty='id'] - The name of the ID column
 * @param {object} [options={}] - Additional options
 * @param {boolean} [options.autoIncrement=true] - Whether to use auto-incrementing IDs
 * @param {boolean} [options.timestamps=false] - Whether to add created_at/updated_at columns
 * @returns {Promise} A promise that resolves when the table is created
 */
export async function createKnexTable(knex, tableName, schema, idProperty = 'id', options = {}) {
  const { autoIncrement = true, timestamps = false } = options;
  
  return knex.schema.createTable(tableName, (table) => {
    // Check if schema has the idProperty field with primary key
    const hasIdField = schema.structure[idProperty] && schema.structure[idProperty].primary === true;
    
    // Add auto-incrementing ID if no primary key is defined and autoIncrement is true
    if (!hasIdField && autoIncrement) {
      table.increments(idProperty).primary();
    }
    
    // Process each field in the schema
    for (const [fieldName, definition] of Object.entries(schema.structure)) {
      // Skip if this is the ID field and we already handled it
      if (fieldName === idProperty && !hasIdField && autoIncrement) {
        continue;
      }
      
      // Create the column with the appropriate type
      const column = mapTypeToKnex(table, fieldName, definition);
      
      // Apply constraints
      applyConstraints(column, definition);
    }
    
    // Add timestamps if requested
    if (timestamps) {
      table.timestamps(true, true);
    }
  });
}

export async function addKnexFields(knex, tableName, schema) {  
  return knex.schema.alterTable(tableName, (table) => {
    for (const [fieldName, definition] of Object.entries(schema.structure)) {   
      const column = mapTypeToKnex(table, fieldName, definition);      
      applyConstraints(column, definition);
    }
  });
}

/**
 * Generates a Knex migration string from a json-rest-schema definition
 * @param {string} tableName - The name of the table
 * @param {object} schema - The json-rest-schema instance
 * @param {object} [options={}] - Additional options
 * @returns {string} The migration code as a string
 */
export function generateKnexMigration(tableName, schema, options = {}) {
  const { autoIncrement = true, timestamps = false } = options;
  
  let migration = `exports.up = function(knex) {
  return knex.schema.createTable('${tableName}', (table) => {\n`;
  
  // Check if schema has an 'id' field with primary key
  const hasIdField = schema.structure.id && schema.structure.id.primary === true;
  
  // Add auto-incrementing ID if needed
  if (!hasIdField && autoIncrement) {
    migration += `    table.increments('id').primary();\n`;
  }
  
  // Process each field
  for (const [fieldName, definition] of Object.entries(schema.structure)) {
    if (fieldName === 'id' && !hasIdField && autoIncrement) {
      continue;
    }
    
    let line = '    ';
    
    // Map type
    switch (definition.type) {
      case 'string':
        line += definition.maxLength 
          ? `table.string('${fieldName}', ${definition.maxLength})`
          : `table.string('${fieldName}')`;
        break;
      case 'number':
        if (definition.precision !== undefined && definition.scale !== undefined) {
          line += `table.decimal('${fieldName}', ${definition.precision}, ${definition.scale})`;
        } else {
          line += `table.float('${fieldName}')`;
        }
        break;
      case 'id':
        line += `table.integer('${fieldName}')`;
        if (definition.unsigned !== false) line += '.unsigned()';
        break;
      case 'boolean':
        line += `table.boolean('${fieldName}')`;
        break;
      case 'date':
        line += `table.date('${fieldName}')`;
        break;
      case 'dateTime':
        line += `table.datetime('${fieldName}')`;
        break;
      case 'time':
        line += `table.time('${fieldName}')`;
        break;
      case 'timestamp':
        line += `table.integer('${fieldName}')`;
        break;
      case 'array':
      case 'object':
      case 'serialize':
        line += `table.json('${fieldName}')`;
        break;
      case 'blob':
      case 'file':
        line += `table.binary('${fieldName}')`;
        break;
      default:
        line += `table.string('${fieldName}')`;
    }
    
    // Add constraints
    if (definition.nullable === true) {
      line += '.nullable()';
    } else if (definition.required === true || definition.nullable === false) {
      line += '.notNullable()';
    }
    
    if (definition.defaultTo !== undefined) {
      const defaultValue = typeof definition.defaultTo === 'string' 
        ? `'${definition.defaultTo}'` 
        : definition.defaultTo;
      line += `.defaultTo(${defaultValue})`;
    }
    
    if (definition.unique === true) line += '.unique()';
    if (definition.primary === true) line += '.primary()';
    if (definition.index === true) line += '.index()';
    
    if (definition.references) {
      const refCol = definition.references.column || 'id';
      line += `.references('${refCol}').inTable('${definition.references.table}')`;
      if (definition.references.onDelete) {
        line += `.onDelete('${definition.references.onDelete}')`;
      }
      if (definition.references.onUpdate) {
        line += `.onUpdate('${definition.references.onUpdate}')`;
      }
    }
    
    if (definition.comment) {
      line += `.comment('${definition.comment}')`;
    }
    
    migration += line + ';\n';
  }
  
  if (timestamps) {
    migration += `    table.timestamps(true, true);\n`;
  }
  
  migration += `  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('${tableName}');
};`;
  
  return migration;
}