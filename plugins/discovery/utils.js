/**
 * Utility functions for discovery plugin
 * Type mappings and shared helpers
 */

/**
 * Map json-rest-api types to OpenAPI types
 */
export const typeToOpenAPI = {
  'string': { type: 'string' },
  'number': { type: 'number' },
  'integer': { type: 'integer' },
  'boolean': { type: 'boolean' },
  'date': { type: 'string', format: 'date-time' },
  'id': { type: 'string' },
  'array': { type: 'array' },
  'object': { type: 'object' },
  'list': { type: 'array' } // Virtual to-many relationships
};

/**
 * Map json-rest-api types to JSON Schema types
 */
export const typeToJsonSchema = {
  'string': { type: 'string' },
  'number': { type: 'number' },
  'integer': { type: 'integer' },
  'boolean': { type: 'boolean' },
  'date': { type: 'string', format: 'date-time' },
  'id': { type: 'string' },
  'array': { type: 'array' },
  'object': { type: 'object' },
  'list': { type: 'array' }
};

/**
 * Convert field definition to OpenAPI schema
 * @param {Object} fieldDef - Field definition from schema
 * @param {Object} relationships - Resource relationships
 * @param {string} fieldName - Field name
 * @returns {Object} OpenAPI schema
 */
export function fieldToOpenAPISchema(fieldDef, relationships = {}, fieldName = '') {
  const baseType = typeToOpenAPI[fieldDef.type] || { type: 'string' };
  const schema = { ...baseType };
  
  // Add description
  if (fieldDef.description) {
    schema.description = fieldDef.description;
  }
  
  // Add validation constraints
  if (fieldDef.min !== undefined) {
    if (fieldDef.type === 'string') {
      schema.minLength = fieldDef.min;
    } else {
      schema.minimum = fieldDef.min;
    }
  }
  
  if (fieldDef.max !== undefined) {
    if (fieldDef.type === 'string') {
      schema.maxLength = fieldDef.max;
    } else {
      schema.maximum = fieldDef.max;
    }
  }
  
  if (fieldDef.enum) {
    schema.enum = fieldDef.enum;
  }
  
  if (fieldDef.pattern) {
    // Convert regex to string, removing leading/trailing slashes
    const patternStr = fieldDef.pattern.toString();
    schema.pattern = patternStr.slice(1, patternStr.lastIndexOf('/'));
  }
  
  // Handle arrays
  if (fieldDef.type === 'array' && fieldDef.items) {
    schema.items = fieldToOpenAPISchema(fieldDef.items);
  }
  
  // Handle relationships
  if (relationships[fieldName]) {
    if (relationships[fieldName].type === 'to-many') {
      // Virtual to-many relationship - not included in create/update schemas
      schema['x-relationship'] = relationships[fieldName];
    }
  }
  
  // Add default if not a function
  if (fieldDef.default !== undefined && typeof fieldDef.default !== 'function') {
    schema.default = fieldDef.default;
  }
  
  // Add custom extensions for json-rest-api specific features
  if (fieldDef.unique) {
    schema['x-unique'] = true;
  }
  
  return schema;
}

/**
 * Convert field definition to JSON Schema
 * @param {Object} fieldDef - Field definition from schema
 * @param {string} fieldName - Field name
 * @returns {Object} JSON Schema
 */
export function fieldToJsonSchema(fieldDef, fieldName = '') {
  const baseType = typeToJsonSchema[fieldDef.type] || { type: 'string' };
  const schema = { ...baseType };
  
  // Add description
  if (fieldDef.description) {
    schema.description = fieldDef.description;
  }
  
  // Add validation constraints
  if (fieldDef.min !== undefined) {
    if (fieldDef.type === 'string') {
      schema.minLength = fieldDef.min;
    } else {
      schema.minimum = fieldDef.min;
    }
  }
  
  if (fieldDef.max !== undefined) {
    if (fieldDef.type === 'string') {
      schema.maxLength = fieldDef.max;
    } else {
      schema.maximum = fieldDef.max;
    }
  }
  
  if (fieldDef.enum) {
    schema.enum = fieldDef.enum;
  }
  
  if (fieldDef.pattern) {
    // Convert regex to string, removing leading/trailing slashes
    const patternStr = fieldDef.pattern.toString();
    schema.pattern = patternStr.slice(1, patternStr.lastIndexOf('/'));
  }
  
  // Handle arrays
  if (fieldDef.type === 'array' && fieldDef.items) {
    schema.items = fieldToJsonSchema(fieldDef.items);
  }
  
  // Add default if not a function
  if (fieldDef.default !== undefined && typeof fieldDef.default !== 'function') {
    schema.default = fieldDef.default;
  }
  
  return schema;
}

/**
 * Build OpenAPI parameter objects for query operations
 * @param {Array} searchableFields - List of searchable fields
 * @param {Object} relationships - Resource relationships
 * @returns {Array} OpenAPI parameters
 */
export function buildQueryParameters(searchableFields = [], relationships = {}) {
  const parameters = [
    // Pagination
    {
      name: 'page[number]',
      in: 'query',
      description: 'Page number',
      schema: { type: 'integer', minimum: 1, default: 1 }
    },
    {
      name: 'page[size]',
      in: 'query',
      description: 'Page size',
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    },
    
    // Sorting
    {
      name: 'sort',
      in: 'query',
      description: 'Sort fields (prefix with - for descending)',
      schema: { type: 'string' },
      example: '-createdAt,name'
    }
  ];
  
  // Add filter parameters for searchable fields
  searchableFields.forEach(field => {
    parameters.push({
      name: `filter[${field}]`,
      in: 'query',
      description: `Filter by ${field}`,
      schema: { type: 'string' }
    });
  });
  
  // Add include parameter if there are relationships
  if (Object.keys(relationships).length > 0) {
    const includableRels = Object.entries(relationships)
      .filter(([_, rel]) => rel.canInclude)
      .map(([name]) => name);
    
    if (includableRels.length > 0) {
      parameters.push({
        name: 'include',
        in: 'query',
        description: 'Include related resources',
        schema: { type: 'string' },
        example: includableRels.join(',')
      });
    }
  }
  
  // Add fields parameter
  parameters.push({
    name: 'fields',
    in: 'query',
    description: 'Sparse fieldsets',
    schema: { type: 'object' },
    style: 'deepObject'
  });
  
  return parameters;
}

/**
 * Build JSON:API compliant error response schema
 */
export function buildErrorResponseSchema() {
  return {
    type: 'object',
    properties: {
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique identifier for this error' },
            status: { type: 'string', description: 'HTTP status code' },
            code: { type: 'string', description: 'Application-specific error code' },
            title: { type: 'string', description: 'Short, human-readable summary' },
            detail: { type: 'string', description: 'Human-readable explanation' },
            source: {
              type: 'object',
              properties: {
                pointer: { type: 'string', description: 'JSON Pointer to the error' },
                parameter: { type: 'string', description: 'Query parameter that caused the error' }
              }
            }
          }
        }
      }
    }
  };
}

/**
 * Generate example value based on field definition
 * @param {Object} fieldDef - Field definition
 * @param {string} fieldName - Field name
 * @returns {*} Example value
 */
export function generateExample(fieldDef, fieldName = 'field') {
  // Use enum value if available
  if (fieldDef.enum && fieldDef.enum.length > 0) {
    return fieldDef.enum[0];
  }
  
  // Use default if it's not a function
  if (fieldDef.default !== undefined && typeof fieldDef.default !== 'function') {
    return fieldDef.default;
  }
  
  // Generate based on type
  switch (fieldDef.type) {
    case 'string':
      if (fieldName.includes('email')) return 'user@example.com';
      if (fieldName.includes('name')) return 'John Doe';
      if (fieldName.includes('title')) return 'Example Title';
      if (fieldName.includes('content')) return 'Lorem ipsum dolor sit amet';
      return 'example string';
      
    case 'number':
      if (fieldName.includes('age')) return 25;
      if (fieldName.includes('price')) return 99.99;
      return 42;
      
    case 'integer':
      return 1;
      
    case 'boolean':
      return true;
      
    case 'date':
      return new Date().toISOString();
      
    case 'id':
      return '123';
      
    case 'array':
      if (fieldDef.items) {
        return [generateExample(fieldDef.items, fieldName)];
      }
      return [];
      
    case 'object':
      return {};
      
    default:
      return null;
  }
}