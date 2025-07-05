import { RestApiValidationError, RestApiPayloadError } from './rest-api-errors.js';

/**
 * Validates a JSON:API resource identifier object
 * @param {Object} identifier - The resource identifier to validate
 * @param {string} context - Context for error messages
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {RestApiPayloadError|RestApiValidationError} If validation fails
 */
function validateResourceIdentifier(identifier, context, scopes = null) {
  if (!identifier || typeof identifier !== 'object') {
    throw new RestApiPayloadError(
      `${context}: Resource identifier must be an object`,
      { path: context, expected: 'object', received: typeof identifier }
    );
  }
  
  if (typeof identifier.type !== 'string' || !identifier.type) {
    throw new RestApiPayloadError(
      `${context}: Resource identifier must have a non-empty 'type' string`,
      { path: `${context}.type`, expected: 'non-empty string', received: identifier.type }
    );
  }
  
  // Check if type is valid by checking if scope exists
  if (scopes && !scopes[identifier.type]) {
    throw new RestApiValidationError(
      `${context}: Unknown resource type '${identifier.type}'. No scope with this name exists.`,
      { 
        fields: [`${context}.type`],
        violations: [{ field: `${context}.type`, rule: 'valid_resource_type', message: `Resource type '${identifier.type}' does not exist` }]
      }
    );
  }
  
  if (!('id' in identifier)) {
    throw new RestApiPayloadError(
      `${context}: Resource identifier must have an 'id' property`,
      { path: `${context}.id`, expected: 'property exists', received: 'missing' }
    );
  }
  
  if (identifier.id !== null && typeof identifier.id !== 'string' && typeof identifier.id !== 'number') {
    throw new RestApiPayloadError(
      `${context}: Resource identifier 'id' must be a string, number, or null`,
      { path: `${context}.id`, expected: 'string, number, or null', received: typeof identifier.id }
    );
  }
  
  return true;
}

/**
 * Validates a relationship object
 * @param {Object} relationship - The relationship to validate
 * @param {string} relationshipName - Name of the relationship for error context
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateRelationship(relationship, relationshipName, scopes = null) {
  if (!relationship || typeof relationship !== 'object') {
    throw new RestApiPayloadError(
      `Relationship '${relationshipName}' must be an object`,
      { path: `relationships.${relationshipName}`, expected: 'object', received: typeof relationship }
    );
  }
  
  if (!('data' in relationship)) {
    throw new RestApiPayloadError(
      `Relationship '${relationshipName}' must have a 'data' property`,
      { path: `relationships.${relationshipName}.data`, expected: 'property exists', received: 'missing' }
    );
  }
  
  const { data } = relationship;
  
  // data can be null (empty to-one relationship)
  if (data === null) {
    return true;
  }
  
  // data can be a single resource identifier (to-one)
  if (!Array.isArray(data)) {
    validateResourceIdentifier(data, `Relationship '${relationshipName}'`, scopes);
    return true;
  }
  
  // data can be an array of resource identifiers (to-many)
  if (data.length === 0) {
    return true; // Empty to-many relationship is valid
  }
  
  data.forEach((identifier, index) => {
    validateResourceIdentifier(identifier, `Relationship '${relationshipName}[${index}]'`, scopes);
  });
  
  return true;
}

/**
 * Validates query parameters for GET requests
 * @param {Object} params - The parameters object containing id and queryParams
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export function validateGetPayload(params) {
  if (!params || typeof params !== 'object') {
    throw new RestApiPayloadError(
      'GET parameters must be an object',
      { path: 'params', expected: 'object', received: typeof params }
    );
  }
  
  // Validate ID
  if (!('id' in params)) {
    throw new RestApiValidationError(
      'GET request must include an id parameter',
      { fields: ['id'], violations: [{ field: 'id', rule: 'required', message: 'ID parameter is required' }] }
    );
  }
  
  if (params.id === null || params.id === undefined || params.id === '') {
    throw new RestApiValidationError(
      'GET request id cannot be null, undefined, or empty',
      { fields: ['id'], violations: [{ field: 'id', rule: 'not_empty', message: 'ID cannot be null, undefined, or empty' }] }
    );
  }
  
  // Validate queryParams if present
  if (params.queryParams) {
    if (typeof params.queryParams !== 'object') {
      throw new RestApiPayloadError(
        'queryParams must be an object',
        { path: 'queryParams', expected: 'object', received: typeof params.queryParams }
      );
    }
    
    const { include, fields } = params.queryParams;
    
    // Validate include
    if (include !== undefined) {
      if (!Array.isArray(include)) {
        throw new RestApiPayloadError(
          'queryParams.include must be an array of strings',
          { path: 'queryParams.include', expected: 'array', received: typeof include }
        );
      }
      
      include.forEach((path, index) => {
        if (typeof path !== 'string') {
          throw new RestApiPayloadError(
            `queryParams.include[${index}] must be a string`,
            { path: `queryParams.include[${index}]`, expected: 'string', received: typeof path }
          );
        }
      });
    }
    
    // Validate fields
    if (fields !== undefined) {
      if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
        throw new RestApiPayloadError(
          'queryParams.fields must be an object',
          { path: 'queryParams.fields', expected: 'object', received: Array.isArray(fields) ? 'array' : typeof fields }
        );
      }
      
      Object.entries(fields).forEach(([resourceType, fieldList]) => {
        if (typeof fieldList !== 'string') {
          throw new RestApiPayloadError(
            `queryParams.fields['${resourceType}'] must be a comma-separated string`,
            { path: `queryParams.fields['${resourceType}']`, expected: 'string', received: typeof fieldList }
          );
        }
      });
    }
  }
  
  return true;
}

/**
 * Validates query parameters for collection requests
 * @param {Object} params - The parameters object
 * @param {string[]} sortableFields - Array of fields that can be sorted
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export function validateQueryPayload(params, sortableFields = []) {
  if (!params || typeof params !== 'object') {
    throw new RestApiPayloadError(
      'Query parameters must be an object',
      { path: 'params', expected: 'object', received: typeof params }
    );
  }
  
  // queryParams is optional but if present must be an object
  if (params.queryParams) {
    if (typeof params.queryParams !== 'object') {
      throw new RestApiPayloadError(
        'queryParams must be an object',
        { path: 'queryParams', expected: 'object', received: typeof params.queryParams }
      );
    }
    
    const { include, fields, filters, sort, page } = params.queryParams;
    
    // Validate include
    if (include !== undefined) {
      if (!Array.isArray(include)) {
        throw new RestApiPayloadError(
          'queryParams.include must be an array of strings',
          { path: 'queryParams.include', expected: 'array', received: typeof include }
        );
      }
      
      include.forEach((path, index) => {
        if (typeof path !== 'string') {
          throw new RestApiPayloadError(
            `queryParams.include[${index}] must be a string`,
            { path: `queryParams.include[${index}]`, expected: 'string', received: typeof path }
          );
        }
      });
    }
    
    // Validate fields
    if (fields !== undefined) {
      if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
        throw new RestApiPayloadError(
          'queryParams.fields must be an object',
          { path: 'queryParams.fields', expected: 'object', received: Array.isArray(fields) ? 'array' : typeof fields }
        );
      }
      
      Object.entries(fields).forEach(([resourceType, fieldList]) => {
        if (typeof fieldList !== 'string') {
          throw new RestApiPayloadError(
            `queryParams.fields['${resourceType}'] must be a comma-separated string`,
            { path: `queryParams.fields['${resourceType}']`, expected: 'string', received: typeof fieldList }
          );
        }
      });
    }
    
    // Validate filters
    if (filters !== undefined) {
      if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) {
        throw new RestApiPayloadError(
          'queryParams.filters must be an object',
          { path: 'queryParams.filters', expected: 'object', received: Array.isArray(filters) ? 'array' : typeof filters }
        );
      }
    }
    
    // Validate sort
    if (sort !== undefined) {
      if (!Array.isArray(sort)) {
        throw new RestApiPayloadError(
          'queryParams.sort must be an array of strings',
          { path: 'queryParams.sort', expected: 'array', received: typeof sort }
        );
      }
      
      sort.forEach((field, index) => {
        if (typeof field !== 'string') {
          throw new RestApiPayloadError(
            `queryParams.sort[${index}] must be a string`,
            { path: `queryParams.sort[${index}]`, expected: 'string', received: typeof field }
          );
        }
        
        // Check if field is sortable (remove leading - for descending sort)
        const fieldName = field.startsWith('-') ? field.substring(1) : field;
        if (sortableFields.length > 0 && !sortableFields.includes(fieldName)) {
          throw new RestApiValidationError(
            `Field '${fieldName}' is not sortable. Sortable fields are: ${sortableFields.join(', ')}`,
            { fields: ['sort'], violations: [{ field: 'sort', rule: 'sortable_field', message: `Field '${fieldName}' is not in the list of sortable fields` }] }
          );
        }
      });
    }
    
    // Validate page
    if (page !== undefined) {
      if (typeof page !== 'object' || page === null || Array.isArray(page)) {
        throw new RestApiPayloadError(
          'queryParams.page must be an object',
          { path: 'queryParams.page', expected: 'object', received: Array.isArray(page) ? 'array' : typeof page }
        );
      }
      
      // Common pagination parameters
      if ('number' in page && typeof page.number !== 'number' && typeof page.number !== 'string') {
        throw new RestApiPayloadError(
          'queryParams.page.number must be a number or string',
          { path: 'queryParams.page.number', expected: 'number or string', received: typeof page.number }
        );
      }
      
      if ('size' in page && typeof page.size !== 'number' && typeof page.size !== 'string') {
        throw new RestApiPayloadError(
          'queryParams.page.size must be a number or string',
          { path: 'queryParams.page.size', expected: 'number or string', received: typeof page.size }
        );
      }
      
      if ('limit' in page && typeof page.limit !== 'number' && typeof page.limit !== 'string') {
        throw new RestApiPayloadError(
          'queryParams.page.limit must be a number or string',
          { path: 'queryParams.page.limit', expected: 'number or string', received: typeof page.limit }
        );
      }
      
      if ('offset' in page && typeof page.offset !== 'number' && typeof page.offset !== 'string') {
        throw new RestApiPayloadError(
          'queryParams.page.offset must be a number or string',
          { path: 'queryParams.page.offset', expected: 'number or string', received: typeof page.offset }
        );
      }
    }
  }
  
  return true;
}

/**
 * Validates a JSON:API document for POST requests
 * @param {Object} inputRecord - The JSON:API document to validate
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export function validatePostPayload(inputRecord, scopes = null) {
  if (!inputRecord || typeof inputRecord !== 'object') {
    throw new RestApiPayloadError(
      'POST request body must be a JSON:API document object',
      { path: 'body', expected: 'object', received: typeof inputRecord }
    );
  }
  
  // Validate required 'data' property
  if (!('data' in inputRecord)) {
    throw new RestApiPayloadError(
      'POST request body must have a "data" property',
      { path: 'data', expected: 'property exists', received: 'missing' }
    );
  }
  
  const { data, included } = inputRecord;
  
  // Validate primary data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RestApiPayloadError(
      'POST request "data" must be a single resource object',
      { path: 'data', expected: 'object', received: Array.isArray(data) ? 'array' : typeof data }
    );
  }
  
  if (typeof data.type !== 'string' || !data.type) {
    throw new RestApiPayloadError(
      'POST request "data" must have a non-empty "type" string',
      { path: 'data.type', expected: 'non-empty string', received: data.type || 'empty' }
    );
  }
  
  // Check if primary resource type is valid
  if (scopes && !scopes[data.type]) {
    throw new RestApiValidationError(
      `POST request "data.type" '${data.type}' is not a valid resource type. No scope with this name exists.`,
      { fields: ['data.type'], violations: [{ field: 'data.type', rule: 'valid_resource_type', message: `Resource type '${data.type}' does not exist` }] }
    );
  }
  
  // For POST, id is optional (server may generate it)
  if ('id' in data && data.id !== null && typeof data.id !== 'string' && typeof data.id !== 'number') {
    throw new RestApiPayloadError(
      'POST request "data.id" if present must be a string, number, or null',
      { path: 'data.id', expected: 'string, number, or null', received: typeof data.id }
    );
  }
  
  // Validate attributes if present
  if ('attributes' in data) {
    if (typeof data.attributes !== 'object' || data.attributes === null || Array.isArray(data.attributes)) {
      throw new RestApiPayloadError(
        'POST request "data.attributes" must be an object',
        { path: 'data.attributes', expected: 'object', received: Array.isArray(data.attributes) ? 'array' : typeof data.attributes }
      );
    }
  }
  
  // Validate relationships if present
  if ('relationships' in data) {
    if (typeof data.relationships !== 'object' || data.relationships === null || Array.isArray(data.relationships)) {
      throw new RestApiPayloadError(
        'POST request "data.relationships" must be an object',
        { path: 'data.relationships', expected: 'object', received: Array.isArray(data.relationships) ? 'array' : typeof data.relationships }
      );
    }
    
    Object.entries(data.relationships).forEach(([relName, relationship]) => {
      validateRelationship(relationship, relName, scopes);
    });
  }
  
  // Validate included resources if present
  if (included !== undefined) {
    if (!Array.isArray(included)) {
      throw new RestApiPayloadError(
        'POST request "included" must be an array',
        { path: 'included', expected: 'array', received: typeof included }
      );
    }
    
    included.forEach((resource, index) => {
      if (!resource || typeof resource !== 'object') {
        throw new RestApiPayloadError(
          `POST request "included[${index}]" must be a resource object`,
          { path: `included[${index}]`, expected: 'object', received: typeof resource }
        );
      }
      
      if (typeof resource.type !== 'string' || !resource.type) {
        throw new RestApiPayloadError(
          `POST request "included[${index}]" must have a non-empty "type" string`,
          { path: `included[${index}].type`, expected: 'non-empty string', received: resource.type || 'empty' }
        );
      }
      
      // Check if included resource type is valid
      if (scopes && !scopes[resource.type]) {
        throw new RestApiValidationError(
          `POST request "included[${index}].type" '${resource.type}' is not a valid resource type. No scope with this name exists.`,
          { fields: [`included[${index}].type`], violations: [{ field: `included[${index}].type`, rule: 'valid_resource_type', message: `Resource type '${resource.type}' does not exist` }] }
        );
      }
      
      if (!('id' in resource) || resource.id === null || resource.id === undefined) {
        throw new RestApiPayloadError(
          `POST request "included[${index}]" must have a non-null "id"`,
          { path: `included[${index}].id`, expected: 'non-null value', received: 'null or undefined' }
        );
      }
      
      if (typeof resource.id !== 'string' && typeof resource.id !== 'number') {
        throw new RestApiPayloadError(
          `POST request "included[${index}].id" must be a string or number`,
          { path: `included[${index}].id`, expected: 'string or number', received: typeof resource.id }
        );
      }
      
      if ('attributes' in resource) {
        if (typeof resource.attributes !== 'object' || resource.attributes === null || Array.isArray(resource.attributes)) {
          throw new RestApiPayloadError(
            `POST request "included[${index}].attributes" must be an object`,
            { path: `included[${index}].attributes`, expected: 'object', received: Array.isArray(resource.attributes) ? 'array' : typeof resource.attributes }
          );
        }
      }
    });
  }
  
  return true;
}

/**
 * Validates a JSON:API document for PUT requests
 * @param {Object} inputRecord - The JSON:API document to validate
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export function validatePutPayload(inputRecord, scopes = null) {
  if (!inputRecord || typeof inputRecord !== 'object') {
    throw new RestApiPayloadError(
      'PUT request body must be a JSON:API document object',
      { path: 'body', expected: 'object', received: typeof inputRecord }
    );
  }
  
  // Validate required 'data' property
  if (!('data' in inputRecord)) {
    throw new RestApiPayloadError(
      'PUT request body must have a "data" property',
      { path: 'data', expected: 'property exists', received: 'missing' }
    );
  }
  
  const { data, included } = inputRecord;
  
  // PUT cannot have included array
  if (included !== undefined) {
    throw new RestApiPayloadError(
      'PUT requests cannot include an "included" array for creating new resources',
      { path: 'included', expected: 'undefined', received: 'array' }
    );
  }
  
  // Validate primary data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RestApiPayloadError(
      'PUT request "data" must be a single resource object',
      { path: 'data', expected: 'object', received: Array.isArray(data) ? 'array' : typeof data }
    );
  }
  
  if (typeof data.type !== 'string' || !data.type) {
    throw new RestApiPayloadError(
      'PUT request "data" must have a non-empty "type" string',
      { path: 'data.type', expected: 'non-empty string', received: data.type || 'empty' }
    );
  }
  
  // Check if resource type is valid
  if (scopes && !scopes[data.type]) {
    throw new RestApiValidationError(
      `PUT request "data.type" '${data.type}' is not a valid resource type. No scope with this name exists.`,
      { fields: ['data.type'], violations: [{ field: 'data.type', rule: 'valid_resource_type', message: `Resource type '${data.type}' does not exist` }] }
    );
  }
  
  // For PUT, id is required
  if (!('id' in data)) {
    throw new RestApiPayloadError(
      'PUT request "data" must have an "id" property',
      { path: 'data.id', expected: 'property exists', received: 'missing' }
    );
  }
  
  if (data.id === null || data.id === undefined || data.id === '') {
    throw new RestApiValidationError(
      'PUT request "data.id" cannot be null, undefined, or empty',
      { fields: ['data.id'], violations: [{ field: 'data.id', rule: 'not_empty', message: 'ID cannot be null, undefined, or empty' }] }
    );
  }
  
  if (typeof data.id !== 'string' && typeof data.id !== 'number') {
    throw new RestApiPayloadError(
      'PUT request "data.id" must be a string or number',
      { path: 'data.id', expected: 'string or number', received: typeof data.id }
    );
  }
  
  // Validate attributes if present
  if ('attributes' in data) {
    if (typeof data.attributes !== 'object' || data.attributes === null || Array.isArray(data.attributes)) {
      throw new RestApiPayloadError(
        'PUT request "data.attributes" must be an object',
        { path: 'data.attributes', expected: 'object', received: Array.isArray(data.attributes) ? 'array' : typeof data.attributes }
      );
    }
  }
  
  // Validate relationships if present
  if ('relationships' in data) {
    if (typeof data.relationships !== 'object' || data.relationships === null || Array.isArray(data.relationships)) {
      throw new RestApiPayloadError(
        'PUT request "data.relationships" must be an object',
        { path: 'data.relationships', expected: 'object', received: Array.isArray(data.relationships) ? 'array' : typeof data.relationships }
      );
    }
    
    Object.entries(data.relationships).forEach(([relName, relationship]) => {
      validateRelationship(relationship, relName, scopes);
    });
  }
  
  return true;
}

/**
 * Validates a JSON:API document for PATCH requests
 * @param {Object} inputRecord - The JSON:API document to validate
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export function validatePatchPayload(inputRecord, scopes = null) {
  if (!inputRecord || typeof inputRecord !== 'object') {
    throw new RestApiPayloadError(
      'PATCH request body must be a JSON:API document object',
      { path: 'body', expected: 'object', received: typeof inputRecord }
    );
  }
  
  // Validate required 'data' property
  if (!('data' in inputRecord)) {
    throw new RestApiPayloadError(
      'PATCH request body must have a "data" property',
      { path: 'data', expected: 'property exists', received: 'missing' }
    );
  }
  
  const { data, included } = inputRecord;
  
  // PATCH cannot have included array
  if (included !== undefined) {
    throw new RestApiPayloadError(
      'PATCH requests cannot include an "included" array for creating new resources',
      { path: 'included', expected: 'undefined', received: 'array' }
    );
  }
  
  // Validate primary data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RestApiPayloadError(
      'PATCH request "data" must be a single resource object',
      { path: 'data', expected: 'object', received: Array.isArray(data) ? 'array' : typeof data }
    );
  }
  
  if (typeof data.type !== 'string' || !data.type) {
    throw new RestApiPayloadError(
      'PATCH request "data" must have a non-empty "type" string',
      { path: 'data.type', expected: 'non-empty string', received: data.type || 'empty' }
    );
  }
  
  // Check if resource type is valid
  if (scopes && !scopes[data.type]) {
    throw new RestApiValidationError(
      `PATCH request "data.type" '${data.type}' is not a valid resource type. No scope with this name exists.`,
      { fields: ['data.type'], violations: [{ field: 'data.type', rule: 'valid_resource_type', message: `Resource type '${data.type}' does not exist` }] }
    );
  }
  
  // For PATCH, id is required
  if (!('id' in data)) {
    throw new RestApiPayloadError(
      'PATCH request "data" must have an "id" property',
      { path: 'data.id', expected: 'property exists', received: 'missing' }
    );
  }
  
  if (data.id === null || data.id === undefined || data.id === '') {
    throw new RestApiValidationError(
      'PATCH request "data.id" cannot be null, undefined, or empty',
      { fields: ['data.id'], violations: [{ field: 'data.id', rule: 'not_empty', message: 'ID cannot be null, undefined, or empty' }] }
    );
  }
  
  if (typeof data.id !== 'string' && typeof data.id !== 'number') {
    throw new RestApiPayloadError(
      'PATCH request "data.id" must be a string or number',
      { path: 'data.id', expected: 'string or number', received: typeof data.id }
    );
  }
  
  // For PATCH, at least one of attributes or relationships should be present
  if (!('attributes' in data) && !('relationships' in data)) {
    throw new RestApiValidationError(
      'PATCH request "data" must have at least one of "attributes" or "relationships"',
      { fields: ['data'], violations: [{ field: 'data', rule: 'partial_update', message: 'Must include at least one of attributes or relationships' }] }
    );
  }
  
  // Validate attributes if present
  if ('attributes' in data && data.attributes !== undefined) {
    if (typeof data.attributes !== 'object' || data.attributes === null || Array.isArray(data.attributes)) {
      throw new RestApiPayloadError(
        'PATCH request "data.attributes" must be an object',
        { path: 'data.attributes', expected: 'object', received: Array.isArray(data.attributes) ? 'array' : typeof data.attributes }
      );
    }
  }
  
  // Validate relationships if present
  if ('relationships' in data && data.relationships !== undefined) {
    if (typeof data.relationships !== 'object' || data.relationships === null || Array.isArray(data.relationships)) {
      throw new RestApiPayloadError(
        'PATCH request "data.relationships" must be an object',
        { path: 'data.relationships', expected: 'object', received: Array.isArray(data.relationships) ? 'array' : typeof data.relationships }
      );
    }
    
    Object.entries(data.relationships).forEach(([relName, relationship]) => {
      validateRelationship(relationship, relName, scopes);
    });
  }
  
  return true;
}