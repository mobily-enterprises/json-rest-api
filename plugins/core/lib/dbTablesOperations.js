/**
 * @file Creates Knex table definitions from json-rest-schema definitions
 */

import { normalizeFieldStorage } from './storage/storage-mapping.js'

/**
 * Maps json-rest-schema types to Knex column types
 * @param {object} table - The Knex table builder instance
 * @param {string} columnName - The name of the column
 * @param {object} definition - The schema definition for the field
 * @returns {object} The Knex column builder instance
 */
function mapTypeToKnex (table, columnName, definition) {
  const { type, precision, scale, maxLength, unsigned } = definition

  switch (type) {
    case 'string':
      return maxLength ? table.string(columnName, maxLength) : table.string(columnName)

    case 'number':
      if (precision !== undefined && scale !== undefined) {
        return table.decimal(columnName, precision, scale)
      }
      return table.float(columnName)

    case 'id':
      const col = table.integer(columnName)
      return unsigned !== false ? col.unsigned() : col

    case 'boolean':
      return table.boolean(columnName)

    case 'date':
      return table.date(columnName)

    case 'dateTime':
      return table.datetime(columnName)

    case 'time':
      return table.time(columnName)

    case 'timestamp':
      return table.integer(columnName)

    case 'array':
    case 'object':
    case 'serialize':
      return table.json(columnName)

    case 'blob':
    case 'file':
      return table.binary(columnName)

    case 'none':
    default:
      return table.string(columnName)
  }
}

function getColumnNameForDefinition (fieldName, definition, idColumn = 'id') {
  return normalizeFieldStorage(fieldName, definition, { idColumn }).column
}

function resolveTableSchemaContext (schemaLike, options = {}) {
  const schemaStructure = schemaLike.structure || schemaLike || {}
  const configuredIdColumn = options.idProperty || schemaStructure.id?.storage?.column || 'id'

  let resourceIdField = null
  for (const [fieldName, definition] of Object.entries(schemaStructure)) {
    if (definition?.type !== 'id') continue
    const columnName = getColumnNameForDefinition(fieldName, definition, configuredIdColumn)
    if (columnName === configuredIdColumn) {
      resourceIdField = fieldName
      break
    }
  }

  return {
    schemaStructure,
    idColumn: configuredIdColumn,
    resourceIdField,
    hasPrimaryIdField: resourceIdField
      ? schemaStructure[resourceIdField]?.primary === true
      : false
  }
}

/**
 * Applies schema constraints to a Knex column
 * @param {object} column - The Knex column builder instance
 * @param {object} definition - The schema definition for the field
 */
function applyConstraints (column, definition) {
  // Nullability
  if (definition.nullable === true) {
    column.nullable()
  } else if (definition.required === true || definition.nullable === false) {
    column.notNullable()
  }

  // Default value
  if (definition.defaultTo !== undefined) {
    column.defaultTo(definition.defaultTo)
  }

  // Database-specific constraints
  if (definition.unique === true) {
    column.unique()
  }

  if (definition.primary === true) {
    column.primary()
  }

  if (definition.index === true) {
    column.index()
  }

  if (definition.references) {
    column.references(definition.references.column || 'id')
      .inTable(definition.references.table)

    if (definition.references.onDelete) {
      column.onDelete(definition.references.onDelete)
    }

    if (definition.references.onUpdate) {
      column.onUpdate(definition.references.onUpdate)
    }
  }

  if (definition.comment) {
    column.comment(definition.comment)
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
export async function createKnexTable (knex, schemaInfo, tableSchemaInstance, options = {}) {
  const { autoIncrement = true, timestamps = false } = options

  const tableName = schemaInfo.tableName
  const {
    schemaStructure: tableSchemaStructure,
    idColumn,
    resourceIdField,
    hasPrimaryIdField
  } = resolveTableSchemaContext(tableSchemaInstance, { idProperty: schemaInfo.idProperty })

  return knex.schema.createTable(tableName, (table) => {
    if (!hasPrimaryIdField && autoIncrement) {
      table.increments(idColumn).primary()
    }

    // Process each field in the schema
    for (const [fieldName, definition] of Object.entries(tableSchemaStructure)) {
      if (fieldName === resourceIdField && !hasPrimaryIdField && autoIncrement) {
        continue
      }

      // Create the column with the appropriate type
      const columnName = getColumnNameForDefinition(fieldName, definition, idColumn)
      const column = mapTypeToKnex(table, columnName, definition)

      // Apply constraints
      applyConstraints(column, definition)
    }

    // Add timestamps if requested
    if (timestamps) {
      table.timestamps(true, true)
    }
  })
}

export async function addKnexFields (knex, tableName, schema, options = {}) {
  const { schemaStructure, idColumn } = resolveTableSchemaContext(schema, options)

  return knex.schema.alterTable(tableName, (table) => {
    for (const [fieldName, definition] of Object.entries(schemaStructure)) {
      const columnName = getColumnNameForDefinition(fieldName, definition, idColumn)
      const column = mapTypeToKnex(table, columnName, definition)
      applyConstraints(column, definition)
    }
  })
}

// Helper function to alter multiple fields in an existing table
export async function alterKnexFields (knex, tableName, fields, options = {}) {
  const { schemaStructure, idColumn } = resolveTableSchemaContext(fields, options)

  return knex.schema.alterTable(tableName, (table) => {
    for (const [fieldName, definition] of Object.entries(schemaStructure)) {
      // Create the column with alter flag
      const columnName = getColumnNameForDefinition(fieldName, definition, idColumn)
      const column = mapTypeToKnex(table, columnName, definition)

      // Mark this as an alteration
      column.alter()

      // Apply constraints (these will be reapplied with the alter)
      applyConstraints(column, definition)
    }
  })
}

/**
 * Generates a Knex migration string from a json-rest-schema definition
 * @param {string} tableName - The name of the table
 * @param {object} schema - The json-rest-schema instance
 * @param {object} [options={}] - Additional options
 * @returns {string} The migration code as a string
 */
export function generateKnexMigration (tableName, schema, options = {}) {
  const { autoIncrement = true, timestamps = false } = options
  const {
    schemaStructure,
    idColumn,
    resourceIdField,
    hasPrimaryIdField
  } = resolveTableSchemaContext(schema, options)

  let migration = `exports.up = function(knex) {
  return knex.schema.createTable('${tableName}', (table) => {\n`

  if (!hasPrimaryIdField && autoIncrement) {
    migration += `    table.increments('${idColumn}').primary();\n`
  }

  // Process each field
  for (const [fieldName, definition] of Object.entries(schemaStructure)) {
    if (fieldName === resourceIdField && !hasPrimaryIdField && autoIncrement) {
      continue
    }

    let line = '    '
    const columnName = getColumnNameForDefinition(fieldName, definition, idColumn)

    // Map type
    switch (definition.type) {
      case 'string':
        line += definition.maxLength
          ? `table.string('${columnName}', ${definition.maxLength})`
          : `table.string('${columnName}')`
        break
      case 'number':
        if (definition.precision !== undefined && definition.scale !== undefined) {
          line += `table.decimal('${columnName}', ${definition.precision}, ${definition.scale})`
        } else {
          line += `table.float('${columnName}')`
        }
        break
      case 'id':
        line += `table.integer('${columnName}')`
        if (definition.unsigned !== false) line += '.unsigned()'
        break
      case 'boolean':
        line += `table.boolean('${columnName}')`
        break
      case 'date':
        line += `table.date('${columnName}')`
        break
      case 'dateTime':
        line += `table.datetime('${columnName}')`
        break
      case 'time':
        line += `table.time('${columnName}')`
        break
      case 'timestamp':
        line += `table.integer('${columnName}')`
        break
      case 'array':
      case 'object':
      case 'serialize':
        line += `table.json('${columnName}')`
        break
      case 'blob':
      case 'file':
        line += `table.binary('${columnName}')`
        break
      default:
        line += `table.string('${columnName}')`
    }

    // Add constraints
    if (definition.nullable === true) {
      line += '.nullable()'
    } else if (definition.required === true || definition.nullable === false) {
      line += '.notNullable()'
    }

    if (definition.defaultTo !== undefined) {
      const defaultValue = typeof definition.defaultTo === 'string'
        ? `'${definition.defaultTo}'`
        : definition.defaultTo
      line += `.defaultTo(${defaultValue})`
    }

    if (definition.unique === true) line += '.unique()'
    if (definition.primary === true) line += '.primary()'
    if (definition.index === true) line += '.index()'

    if (definition.references) {
      const refCol = definition.references.column || 'id'
      line += `.references('${refCol}').inTable('${definition.references.table}')`
      if (definition.references.onDelete) {
        line += `.onDelete('${definition.references.onDelete}')`
      }
      if (definition.references.onUpdate) {
        line += `.onUpdate('${definition.references.onUpdate}')`
      }
    }

    if (definition.comment) {
      line += `.comment('${definition.comment}')`
    }

    migration += line + ';\n'
  }

  if (timestamps) {
    migration += '    table.timestamps(true, true);\n'
  }

  migration += `  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('${tableName}');
};`

  return migration
}
