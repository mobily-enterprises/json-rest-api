/**
 * Helper functions to normalize values returned from the database.
 * 
 * Handles:
 * - Boolean values: Knex returns 1/0 instead of true/false
 * - Date values: Normalizes to ISO 8601 format for JSON:API compatibility
 *   - date: YYYY-MM-DD
 *   - datetime: YYYY-MM-DDTHH:MM:SS.sssZ
 *   - time: HH:MM:SS
 * 
 * Note: For MySQL datetime fields without timezone info, we assume UTC.
 */

/**
 * Normalizes a date value to ISO 8601 format for JSON:API compatibility.
 * Handles various input formats from different databases.
 * 
 * @param {*} value - The date value from the database (could be Date, string, or number)
 * @param {string} type - The field type ('date', 'datetime', or 'time')
 * @returns {string|null} The normalized date string in ISO 8601 format, or null
 */
function normalizeDateValue(value, type) {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }

  // Convert to Date object if it isn't already
  let dateObj;
  
  if (value instanceof Date) {
    dateObj = value;
  } else if (typeof value === 'string') {
    // Handle MySQL date strings that might not have timezone info
    // MySQL returns dates like '2024-01-15 10:30:00' without timezone
    if (type === 'datetime' && !value.includes('T') && !value.includes('Z') && !value.includes('+')) {
      // Assume UTC for MySQL datetime values
      dateObj = new Date(value + 'Z');
    } else {
      dateObj = new Date(value);
    }
  } else if (typeof value === 'number') {
    // Unix timestamp
    dateObj = new Date(value);
  } else {
    // Unknown format, return as-is
    return value;
  }

  // Check if date is valid
  if (isNaN(dateObj.getTime())) {
    console.warn(`Invalid date value: ${value}`);
    return value; // Return original value if we can't parse it
  }

  // Format based on type
  switch (type) {
    case 'date':
      // Return date only in YYYY-MM-DD format
      return dateObj.toISOString().split('T')[0];
      
    case 'datetime':
      // Return full ISO 8601 datetime with timezone
      return dateObj.toISOString();
      
    case 'time':
      // Return time only in HH:MM:SS format
      // Note: This is tricky as time without date context loses meaning
      // We'll return the time portion of the ISO string
      return dateObj.toISOString().split('T')[1].split('.')[0];
      
    default:
      return dateObj.toISOString();
  }
}

/**
 * Normalizes database values in an attributes object.
 * Handles:
 * - Boolean normalization (1/0 to true/false)
 * - Date/datetime/time normalization to ISO 8601 format
 * 
 * @param {Object} attributes - The attributes object to normalize
 * @param {Object} schemaStructure - The schema structure defining field types
 * @returns {Object} The normalized attributes object
 */
export function normalizeAttributes(attributes, schemaStructure) {
  if (!attributes || !schemaStructure) {
    return attributes;
  }

  const normalized = { ...attributes };

  // Iterate through each attribute
  for (const [fieldName, value] of Object.entries(attributes)) {
    const fieldDef = schemaStructure[fieldName];
    
    // Skip if no field definition found
    if (!fieldDef) continue;

    // Normalize boolean values
    if (fieldDef.type === 'boolean') {
      if (value === 1 || value === '1') {
        normalized[fieldName] = true;
      } else if (value === 0 || value === '0') {
        normalized[fieldName] = false;
      }
      // null/undefined remain as-is
    }
    
    // Normalize date/datetime/time values
    if (fieldDef.type === 'date' || fieldDef.type === 'datetime' || fieldDef.type === 'time') {
      normalized[fieldName] = normalizeDateValue(value, fieldDef.type);
    }
  }

  return normalized;
}

/**
 * Normalizes all records in a JSON:API response.
 * Handles both main data records and included records.
 * 
 * @param {Object} record - The JSON:API record object with data and optional included arrays
 * @param {Object} scopes - All available scopes for looking up schema structures
 * @returns {Object} The record with normalized attribute values
 */
export function normalizeRecordAttributes(record, scopes) {
  if (!record || !scopes) {
    return record;
  }

  // Normalize main data records
  if (record.data) {
    if (Array.isArray(record.data)) {
      // Handle array of records (query result)
      for (const entry of record.data) {
        const scope = scopes[entry.type];
        if (scope?.vars?.schemaInfo?.schemaStructure && entry.attributes) {
          entry.attributes = normalizeAttributes(
            entry.attributes,
            scope.vars.schemaInfo.schemaStructure
          );
        }
      }
    } else {
      // Handle single record (get result)
      const entry = record.data;
      const scope = scopes[entry.type];
      if (scope?.vars?.schemaInfo?.schemaStructure && entry.attributes) {
        entry.attributes = normalizeAttributes(
          entry.attributes,
          scope.vars.schemaInfo.schemaStructure
        );
      }
    }
  }

  // Normalize included records
  if (record.included && Array.isArray(record.included)) {
    for (const entry of record.included) {
      const scope = scopes[entry.type];
      if (scope?.vars?.schemaInfo?.schemaStructure && entry.attributes) {
        entry.attributes = normalizeAttributes(
          entry.attributes,
          scope.vars.schemaInfo.schemaStructure
        );
      }
    }
  }

  return record;
}