/**
 * Helper functions to normalize values returned from the database.
 * 
 * Handles:
 * - Boolean values: Converts 1/0 to true/false (some databases don't have native boolean support)
 * - Date values: Ensures JavaScript Date objects are properly handled
 *   - date: Already Date objects from Knex, no conversion needed
 *   - dateTime: Already Date objects from Knex, no conversion needed  
 *   - time: Returned as HH:MM:SS strings from the database
 * 
 * Note: With the updated json-rest-schema, dates are stored as Date objects in the database,
 * and Knex returns them as Date objects when fetching. We mainly need to handle edge cases
 * and ensure consistency.
 */

/**
 * Normalizes a date value to a JavaScript Date object.
 * Handles various input formats from different databases and fixes timezone issues.
 * 
 * @param {*} value - The date value from the database (could be Date, string, or number)
 * @param {string} type - The field type ('date', 'dateTime', or 'time')
 * @returns {Date|string|null} Date object for date/dateTime, string for time, or null
 */
function normalizeDateValue(value, type) {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }

  // Handle time type specially - always return as string
  if (type === 'time') {
    // If it's already a properly formatted time string, return as-is
    if (typeof value === 'string' && /^\d{2}:\d{2}:\d{2}/.test(value)) {
      return value;
    }
    // If we got a Date object for a time field, extract the time portion
    if (value instanceof Date) {
      return value.toISOString().slice(11, 19); // Extract HH:MM:SS
    }
    // Try to parse and extract time
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(11, 19);
      }
    }
    return null;
  }

  // For date and dateTime: Already a Date object? Return as-is
  if (value instanceof Date) {
    return value;
  }
  
  // Handle string values
  if (typeof value === 'string') {
    // Detect MySQL datetime format: 'YYYY-MM-DD HH:MM:SS'
    // These have no T separator and no timezone indicator
    const isMySQLDateTime = type === 'dateTime' && 
                           /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value) &&
                           !value.includes('T') && 
                           !value.includes('Z') &&
                           !value.includes('+') &&
                           !value.includes('-', 10); // Don't match date separators
    
    if (isMySQLDateTime) {
      // Convert to ISO format and force UTC interpretation
      // '2024-01-15 10:30:00' becomes '2024-01-15T10:30:00Z'
      return new Date(value.replace(' ', 'T') + 'Z');
    }
    
    // For date-only fields, ensure parsing at UTC midnight
    // This prevents timezone shifts when parsing dates
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(value + 'T00:00:00Z');
    }
  }
  
  // Handle numeric values (Unix timestamps)
  if (typeof value === 'number') {
    return new Date(value);
  }
  
  // Try to parse any other format
  const dateObj = new Date(value);
  
  // Check if date is valid
  if (isNaN(dateObj.getTime())) {
    console.warn(`Invalid date value for field type '${type}': ${value}`);
    return null; // Return null for invalid dates
  }
  
  return dateObj;
}

/**
 * Normalizes database values in an attributes object.
 * Handles:
 * - Boolean normalization (1/0 to true/false)
 * - Date/dateTime/time normalization to Date objects with proper timezone handling
 * 
 * @param {Object} attributes - The attributes object to normalize
 * @param {Object} schemaStructure - The schema structure defining field types
 * @returns {Object} The normalized attributes object with Date objects for date fields
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
    
    // Normalize date/dateTime/time values
    if (fieldDef.type === 'date' || fieldDef.type === 'dateTime' || fieldDef.type === 'time') {
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