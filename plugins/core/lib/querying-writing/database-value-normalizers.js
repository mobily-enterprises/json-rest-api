/**
 * Normalizes a date value to appropriate format based on field type
 *
 * @param {*} value - The date value from the database
 * @param {string} type - The field type ('date', 'dateTime', or 'time')
 * @returns {Date|string|null} Date object for date/dateTime, string for time, or null
 *
 * @example
 * // Input: Already a Date object
 * normalizeDateValue(new Date('2024-01-15T10:30:00Z'), 'dateTime');
 * // Output: Date object (unchanged)
 *
 * @example
 * // Input: MySQL datetime string without timezone
 * normalizeDateValue('2024-01-15 10:30:00', 'dateTime');
 * // Output: Date object parsed as UTC (2024-01-15T10:30:00Z)
 *
 * @example
 * // Input: Date-only string
 * normalizeDateValue('2024-01-15', 'date');
 * // Output: Date object at UTC midnight (2024-01-15T00:00:00Z)
 *
 * @example
 * // Input: Time field (always returns string)
 * normalizeDateValue('14:30:45', 'time');
 * // Output: "14:30:45" (string)
 *
 * @example
 * // Input: Date object for time field
 * normalizeDateValue(new Date('2024-01-15T14:30:45Z'), 'time');
 * // Output: "14:30:45" (extracts time portion)
 *
 * @description
 * Used by:
 * - normalizeAttributes to process individual field values
 * - Applied to all date/time fields fetched from database
 *
 * Purpose:
 * - Handles database-specific date formats (especially MySQL)
 * - Prevents timezone shifts for date-only fields
 * - Ensures consistent Date objects across databases
 * - Keeps time fields as HH:MM:SS strings
 *
 * Data flow:
 * 1. Checks for null/undefined (returns null)
 * 2. For time fields: ensures HH:MM:SS string format
 * 3. For date/dateTime: converts to Date objects
 * 4. Handles MySQL datetime format (no T separator)
 * 5. Forces UTC interpretation to prevent timezone issues
 */
function normalizeDateValue (value, type) {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null
  }

  // Handle time type specially - always return as string
  if (type === 'time') {
    // If it's already a properly formatted time string, return as-is
    if (typeof value === 'string' && /^\d{2}:\d{2}:\d{2}/.test(value)) {
      return value
    }
    // If we got a Date object for a time field, extract the time portion
    if (value instanceof Date) {
      return value.toISOString().slice(11, 19) // Extract HH:MM:SS
    }
    // Try to parse and extract time
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value)
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(11, 19)
      }
    }
    return null
  }

  // For date and dateTime: Already a Date object? Return as-is
  if (value instanceof Date) {
    return value
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
                           !value.includes('-', 10) // Don't match date separators

    if (isMySQLDateTime) {
      // Convert to ISO format and force UTC interpretation
      // '2024-01-15 10:30:00' becomes '2024-01-15T10:30:00Z'
      return new Date(value.replace(' ', 'T') + 'Z')
    }

    // For date-only fields, ensure parsing at UTC midnight
    // This prevents timezone shifts when parsing dates
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(value + 'T00:00:00Z')
    }
  }

  // Handle numeric values (Unix timestamps)
  if (typeof value === 'number') {
    return new Date(value)
  }

  // Try to parse any other format
  const dateObj = new Date(value)

  // Check if date is valid
  if (isNaN(dateObj.getTime())) {
    console.warn(`Invalid date value for field type '${type}': ${value}`)
    return null // Return null for invalid dates
  }

  return dateObj
}

/**
 * Normalizes database values in an attributes object
 *
 * @param {Object} attributes - The attributes object to normalize
 * @param {Object} schemaStructure - The schema structure defining field types
 * @returns {Object} The normalized attributes object
 *
 * @example
 * // Input: Raw database values
 * const attributes = {
 *   id: 1,
 *   is_active: 1,              // Boolean as 0/1
 *   created_at: '2024-01-15 10:30:00',  // MySQL datetime
 *   birth_date: '1990-05-20',           // Date string
 *   shift_time: '09:00:00'              // Time string
 * };
 *
 * const schema = {
 *   is_active: { type: 'boolean' },
 *   created_at: { type: 'dateTime' },
 *   birth_date: { type: 'date' },
 *   shift_time: { type: 'time' }
 * };
 *
 * const normalized = normalizeAttributes(attributes, schema);
 *
 * // Output: Properly typed values
 * // {
 * //   id: 1,
 * //   is_active: true,                    // 1 → true
 * //   created_at: Date('2024-01-15T10:30:00Z'),  // Date object
 * //   birth_date: Date('1990-05-20T00:00:00Z'),  // Date at midnight UTC
 * //   shift_time: '09:00:00'                     // String unchanged
 * // }
 *
 * @example
 * // Input: Boolean edge cases
 * const attributes = {
 *   flag1: 0,      // Number 0
 *   flag2: '1',    // String '1'
 *   flag3: true,   // Already boolean
 *   flag4: null    // Null value
 * };
 *
 * const normalized = normalizeAttributes(attributes, {
 *   flag1: { type: 'boolean' },
 *   flag2: { type: 'boolean' },
 *   flag3: { type: 'boolean' },
 *   flag4: { type: 'boolean' }
 * });
 *
 * // Output:
 * // {
 * //   flag1: false,  // 0 → false
 * //   flag2: true,   // '1' → true
 * //   flag3: true,   // unchanged
 * //   flag4: null    // null preserved
 * // }
 *
 * @description
 * Used by:
 * - normalizeRecordAttributes for each record's attributes
 * - Applied after fetching data from database
 *
 * Purpose:
 * - Handles databases without native boolean support (SQLite, older MySQL)
 * - Normalizes date formats from different databases
 * - Ensures consistent data types in API responses
 * - Preserves null values appropriately
 *
 * Data flow:
 * 1. Creates copy of attributes to avoid mutation
 * 2. Iterates through each field with schema definition
 * 3. Normalizes booleans: 1/0 or '1'/'0' to true/false
 * 4. Normalizes dates using normalizeDateValue
 * 5. Returns new object with normalized values
 */
export function normalizeAttributes (attributes, schemaStructure) {
  if (!attributes || !schemaStructure) {
    return attributes
  }

  const normalized = { ...attributes }

  // Iterate through each attribute
  for (const [fieldName, value] of Object.entries(attributes)) {
    const fieldDef = schemaStructure[fieldName]

    // Skip if no field definition found
    if (!fieldDef) continue

    // Normalize boolean values
    if (fieldDef.type === 'boolean') {
      if (value === 1 || value === '1') {
        normalized[fieldName] = true
      } else if (value === 0 || value === '0') {
        normalized[fieldName] = false
      }
      // null/undefined remain as-is
    }

    // Normalize date/dateTime/time values
    if (fieldDef.type === 'date' || fieldDef.type === 'dateTime' || fieldDef.type === 'time') {
      normalized[fieldName] = normalizeDateValue(value, fieldDef.type)
    }
  }

  return normalized
}

/**
 * Normalizes all records in a JSON:API response
 *
 * @param {Object} record - The JSON:API response object
 * @param {Object} scopes - All available scopes for schema lookup
 * @returns {Object} The response with normalized values
 *
 * @example
 * // Input: JSON:API response with various data types
 * const response = {
 *   data: {
 *     type: 'articles',
 *     id: '1',
 *     attributes: {
 *       title: 'My Article',
 *       is_published: 1,                    // Boolean as number
 *       published_at: '2024-01-15 10:00:00' // MySQL datetime
 *     }
 *   },
 *   included: [{
 *     type: 'users',
 *     id: '10',
 *     attributes: {
 *       name: 'John',
 *       is_admin: 0,         // Boolean as number
 *       last_login: '2024-01-14 15:30:00'
 *     }
 *   }]
 * };
 *
 * const normalized = normalizeRecordAttributes(response, scopes);
 *
 * // Output: All booleans and dates normalized
 * // {
 * //   data: {
 * //     type: 'articles',
 * //     id: '1',
 * //     attributes: {
 * //       title: 'My Article',
 * //       is_published: true,                        // 1 → true
 * //       published_at: Date('2024-01-15T10:00:00Z') // Date object
 * //     }
 * //   },
 * //   included: [{
 * //     type: 'users',
 * //     id: '10',
 * //     attributes: {
 * //       name: 'John',
 * //       is_admin: false,                          // 0 → false
 * //       last_login: Date('2024-01-14T15:30:00Z')  // Date object
 * //     }
 * //   }]
 * // }
 *
 * @example
 * // Input: Collection response (array of records)
 * const response = {
 *   data: [
 *     {
 *       type: 'comments',
 *       id: '1',
 *       attributes: { approved: 1, created_at: '2024-01-01 09:00:00' }
 *     },
 *     {
 *       type: 'comments',
 *       id: '2',
 *       attributes: { approved: 0, created_at: '2024-01-02 10:00:00' }
 *     }
 *   ]
 * };
 *
 * // Each record in the array is normalized
 *
 * @description
 * Used by:
 * - rest-api-knex-plugin after fetching data, before sending response
 * - Applied to both GET (single) and QUERY (collection) responses
 *
 * Purpose:
 * - Ensures consistent data types in API responses
 * - Handles both primary data and included resources
 * - Works with single records and collections
 * - Uses schema definitions to determine field types
 *
 * Data flow:
 * 1. Checks if data is array (collection) or object (single)
 * 2. For each record, looks up its schema by type
 * 3. Calls normalizeAttributes with schema structure
 * 4. Processes included array the same way
 * 5. Returns complete response with normalized values
 */
export function normalizeRecordAttributes (record, scopes) {
  if (!record || !scopes) {
    return record
  }

  // Normalize main data records
  if (record.data) {
    if (Array.isArray(record.data)) {
      // Handle array of records (query result)
      for (const entry of record.data) {
        const scope = scopes[entry.type]
        if (scope?.vars?.schemaInfo?.schemaStructure && entry.attributes) {
          entry.attributes = normalizeAttributes(
            entry.attributes,
            scope.vars.schemaInfo.schemaStructure
          )
        }
      }
    } else {
      // Handle single record (get result)
      const entry = record.data
      const scope = scopes[entry.type]
      if (scope?.vars?.schemaInfo?.schemaStructure && entry.attributes) {
        entry.attributes = normalizeAttributes(
          entry.attributes,
          scope.vars.schemaInfo.schemaStructure
        )
      }
    }
  }

  // Normalize included records
  if (record.included && Array.isArray(record.included)) {
    for (const entry of record.included) {
      const scope = scopes[entry.type]
      if (scope?.vars?.schemaInfo?.schemaStructure && entry.attributes) {
        entry.attributes = normalizeAttributes(
          entry.attributes,
          scope.vars.schemaInfo.schemaStructure
        )
      }
    }
  }

  return record
}
