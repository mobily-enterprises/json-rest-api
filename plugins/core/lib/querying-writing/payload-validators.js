import { RestApiValidationError, RestApiPayloadError } from '../../../../lib/rest-api-errors.js';

/**
 * Validates that include paths don't exceed maximum depth
 * 
 * @param {string[]} includes - Array of include paths to validate
 * @param {number} maxDepth - Maximum allowed depth
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError} If depth is exceeded
 * 
 * @example
 * // Input: Valid include paths
 * validateIncludeDepth(['author', 'comments.author'], 3);
 * // Output: true (depths are 1 and 2, both under limit)
 * 
 * @example
 * // Input: Path exceeding depth limit
 * validateIncludeDepth(['author.company.employees.manager'], 3);
 * // Throws: RestApiValidationError
 * // "Include path 'author.company.employees.manager' exceeds maximum depth of 3"
 * 
 * @private
 */
function validateIncludeDepth(includes, maxDepth) {
  if (!includes || !Array.isArray(includes)) {
    return true;
  }
  
  for (const includePath of includes) {
    if (typeof includePath !== 'string') {
      continue; // Let other validators handle type errors
    }
    
    const depth = includePath.split('.').length;
    if (depth > maxDepth) {
      throw new RestApiValidationError(
        `Include path '${includePath}' exceeds maximum depth of ${maxDepth}`,
        { 
          fields: ['include'], 
          violations: [{ 
            field: 'include', 
            rule: 'max_depth', 
            message: `Path '${includePath}' has depth ${depth}, maximum allowed is ${maxDepth}` 
          }] 
        }
      );
    }
  }
  
  return true;
}

/**
 * Validates a JSON:API resource identifier object
 * 
 * @param {Object} identifier - Resource identifier to validate  
 * @param {string} context - Context for error messages
 * @param {Object} scopes - Scopes proxy to verify resource types
 * @returns {boolean} True if valid
 * @throws {RestApiPayloadError|RestApiValidationError} If validation fails
 * 
 * @example
 * // Input: Valid identifier
 * validateResourceIdentifier(
 *   { type: 'articles', id: '123' },
 *   "Relationship 'author'",
 *   scopes
 * );
 * // Output: true
 * 
 * @example  
 * // Input: Missing type field
 * validateResourceIdentifier(
 *   { id: '123' },
 *   "Relationship 'comments'",
 *   scopes
 * );
 * // Throws: RestApiPayloadError
 * // "Relationship 'comments': Resource identifier must have a non-empty 'type' string"
 * 
 * @example
 * // Input: Unknown resource type
 * validateResourceIdentifier(
 *   { type: 'unicorns', id: '456' },
 *   "Included resource",
 *   scopes  // scopes['unicorns'] doesn't exist
 * );
 * // Throws: RestApiValidationError
 * // "Included resource: Unknown resource type 'unicorns'. No scope with this name exists."
 * 
 * @description
 * Used by:
 * - validateRelationship to check relationship data
 * - validatePostPayload to validate included resources
 * - Internal validation of resource references
 * 
 * Purpose:
 * - Ensures JSON:API compliance for resource identifiers
 * - Validates resource types exist in the system
 * - Provides clear error context for debugging
 * 
 * @private
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
 * Validates a relationship object in JSON:API format
 * 
 * @param {Object} relationship - Relationship object to validate
 * @param {string} relationshipName - Name for error context
 * @param {Object} scopes - Scopes proxy to verify resource types
 * @returns {boolean} True if valid
 * @throws {RestApiPayloadError} If validation fails
 * 
 * @example
 * // Input: To-one relationship
 * validateRelationship(
 *   { data: { type: 'users', id: '42' } },
 *   'author',
 *   scopes
 * );
 * // Output: true
 * 
 * @example
 * // Input: To-many relationship  
 * validateRelationship(
 *   { 
 *     data: [
 *       { type: 'tags', id: '1' },
 *       { type: 'tags', id: '2' }
 *     ] 
 *   },
 *   'tags',
 *   scopes
 * );
 * // Output: true
 * 
 * @example
 * // Input: Null relationship (remove association)
 * validateRelationship(
 *   { data: null },
 *   'featuredImage',
 *   scopes
 * );
 * // Output: true (null is valid for clearing)
 * 
 * @example
 * // Input: Missing data property
 * validateRelationship(
 *   { type: 'users', id: '1' },  // Wrong structure
 *   'author',
 *   scopes
 * );
 * // Throws: RestApiPayloadError
 * // "Relationship 'author' must have a 'data' property"
 * 
 * @description
 * Used by:
 * - validatePostPayload for new resource relationships
 * - validatePutPayload for relationship replacement
 * - validatePatchPayload for relationship updates
 * 
 * Purpose:
 * - Ensures JSON:API relationship structure
 * - Validates both to-one and to-many relationships
 * - Handles null/empty cases for clearing relationships
 * - Validates each resource identifier in arrays
 * 
 * @private
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
 * Validates query parameters for GET requests (single resource retrieval)
 * 
 * @param {Object} params - Parameters containing id and queryParams
 * @param {string|number} params.id - Resource ID to fetch
 * @param {Object} [params.queryParams] - Optional query parameters
 * @param {string[]} [params.queryParams.include] - Related resources to include
 * @param {Object} [params.queryParams.fields] - Sparse fieldsets by resource type
 * @param {number} maxIncludeDepth - Maximum allowed include depth
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example
 * // Input: Basic GET request
 * validateGetPayload({
 *   id: '123'
 * });
 * // Output: true
 * 
 * @example
 * // Input: GET with nested includes
 * validateGetPayload({
 *   id: '123',
 *   queryParams: {
 *     include: ['author', 'comments.author']
 *   }
 * });
 * // Output: true (include depths are 1 and 2)
 * 
 * @example
 * // Input: GET with sparse fieldsets
 * validateGetPayload({
 *   id: '123',
 *   queryParams: {
 *     include: ['author'],
 *     fields: {
 *       articles: 'title,body',      // Only these article fields
 *       users: 'name,email'          // Only these user fields
 *     }
 *   }
 * });
 * // Output: true
 * 
 * @example
 * // Input: Missing ID parameter
 * validateGetPayload({
 *   queryParams: { include: ['author'] }
 * });
 * // Throws: RestApiValidationError
 * // "GET request must include an id parameter"
 * 
 * @example
 * // Input: Invalid field specification
 * validateGetPayload({
 *   id: '123',
 *   queryParams: {
 *     fields: {
 *       articles: ['title', 'body']  // Should be string, not array
 *     }
 *   }
 * });
 * // Throws: RestApiPayloadError  
 * // "queryParams.fields['articles'] must be a comma-separated string"
 * 
 * @description
 * Used by:
 * - rest-api-plugin.get() method before data fetching
 * - Validates parameters before passing to storage layer
 * 
 * Purpose:
 * - Ensures required ID parameter is present and valid
 * - Validates JSON:API query parameter structure
 * - Prevents invalid queries from reaching database
 * - Enforces include depth limits for performance
 * - Provides consistent error messages across storage backends
 * 
 * Data flow:
 * 1. Checks params object structure
 * 2. Validates required ID parameter
 * 3. If queryParams exist, validates each type
 * 4. Validates include paths don't exceed depth limit
 * 5. Returns true or throws descriptive error
 */
export function validateGetPayload(params, maxIncludeDepth = 3) {
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
      
      // Validate include depth
      validateIncludeDepth(include, maxIncludeDepth);
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
 * Validates query parameters for collection requests (query/list operations)
 * 
 * @param {Object} params - Parameters object
 * @param {Object} [params.queryParams] - Query parameters for the collection
 * @param {string[]} [params.queryParams.include] - Related resources to include
 * @param {Object} [params.queryParams.fields] - Sparse fieldsets by resource type
 * @param {Object} [params.queryParams.filters] - Filter conditions
 * @param {string[]} [params.queryParams.sort] - Sort fields (prefix with - for DESC)
 * @param {Object} [params.queryParams.page] - Pagination parameters
 * @param {string[]} sortableFields - Fields allowed for sorting
 * @param {number} maxIncludeDepth - Maximum allowed include depth
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example
 * // Input: Empty query (fetch all)
 * validateQueryPayload({}, ['title', 'createdAt']);
 * // Output: true
 * 
 * @example
 * // Input: Query with filters and sorting
 * validateQueryPayload({
 *   queryParams: {
 *     filters: {
 *       status: 'published',
 *       'author.name': 'John Doe'    // Dot notation for relationships
 *     },
 *     sort: ['-publishedAt', 'title'] // DESC publishedAt, ASC title
 *   }
 * }, ['publishedAt', 'title', 'createdAt']);
 * // Output: true
 * 
 * @example
 * // Input: Different pagination styles
 * // Page-based:
 * validateQueryPayload({
 *   queryParams: {
 *     page: { number: 2, size: 20 }  // Page 2, 20 items per page
 *   }
 * }, []);
 * // Output: true
 * 
 * // Offset-based:
 * validateQueryPayload({
 *   queryParams: {
 *     page: { offset: 40, limit: 20 } // Skip 40, take 20
 *   }
 * }, []);
 * // Output: true
 * 
 * @example
 * // Input: Complex query with all features
 * validateQueryPayload({
 *   queryParams: {
 *     include: ['author', 'tags', 'comments.author'],
 *     fields: {
 *       articles: 'title,summary,publishedAt',
 *       users: 'name,avatar',
 *       tags: 'name'
 *     },
 *     filters: {
 *       status: 'published',
 *       'tags.name': 'javascript'
 *     },
 *     sort: ['-publishedAt'],
 *     page: { number: 1, size: 10 }
 *   }
 * }, ['publishedAt', 'title', 'updatedAt']);
 * // Output: true (all parameters valid)
 * 
 * @example
 * // Input: Invalid sort field
 * validateQueryPayload({
 *   queryParams: {
 *     sort: ['password']  // Not in sortableFields
 *   }
 * }, ['title', 'createdAt']);
 * // Throws: RestApiValidationError
 * // "Field 'password' is not sortable. Sortable fields are: title, createdAt"
 * 
 * @description
 * Used by:
 * - rest-api-plugin.query() method before data fetching
 * - Validates collection request parameters
 * 
 * Purpose:
 * - Validates all JSON:API query parameters for collections
 * - Prevents SQL injection via filter key validation
 * - Enforces sortable field restrictions for performance
 * - Ensures consistent pagination across storage backends
 * - Validates include depth limits
 * 
 * Data flow:
 * 1. Validates params object structure
 * 2. For each query parameter type, validates format
 * 3. Checks sort fields against allowed list
 * 4. Validates pagination parameters are numbers/strings
 * 5. Returns true or throws descriptive error
 */
export function validateQueryPayload(params, sortableFields = [], maxIncludeDepth = 3) {
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
      
      // Validate include depth
      validateIncludeDepth(include, maxIncludeDepth);
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
 * Validates a JSON:API document for POST requests (resource creation)
 * 
 * @param {Object} inputRecord - JSON:API document to validate
 * @param {Object} inputRecord.data - Primary resource to create
 * @param {string} inputRecord.data.type - Resource type (must match a scope)
 * @param {string|number} [inputRecord.data.id] - Optional client-generated ID
 * @param {Object} [inputRecord.data.attributes] - Resource attributes
 * @param {Object} [inputRecord.data.relationships] - Resource relationships
 * @param {Object[]} [inputRecord.included] - Related resources for compound documents
 * @param {Object} scopes - Scopes proxy to verify resource types exist
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example
 * // Input: Simple resource creation
 * validatePostPayload({
 *   data: {
 *     type: 'articles',
 *     attributes: {
 *       title: 'Hello World',
 *       body: 'Welcome to my blog...'
 *     }
 *   }
 * }, scopes);
 * // Output: true
 * 
 * @example
 * // Input: Create with relationships
 * validatePostPayload({
 *   data: {
 *     type: 'articles',
 *     attributes: {
 *       title: 'REST API Design'
 *     },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '42' }      // To-one
 *       },
 *       tags: {
 *         data: [                                 // To-many
 *           { type: 'tags', id: '1' },
 *           { type: 'tags', id: '2' }
 *         ]
 *       }
 *     }
 *   }
 * }, scopes);
 * // Output: true (validates each relationship)
 * 
 * @example
 * // Input: Client-generated ID
 * validatePostPayload({
 *   data: {
 *     type: 'articles',
 *     id: 'article-2023-11-15',     // Client provides ID
 *     attributes: {
 *       title: 'Hello World'
 *     }
 *   }
 * }, scopes);
 * // Output: true (ID is optional for POST)
 * 
 * @example
 * // Input: Compound document with included
 * validatePostPayload({
 *   data: {
 *     type: 'articles',
 *     attributes: { title: 'My Article' },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '42' }
 *       }
 *     }
 *   },
 *   included: [            // Related resource data
 *     {
 *       type: 'users',
 *       id: '42',          // Must have ID
 *       attributes: {
 *         name: 'John Doe',
 *         email: 'john@example.com'
 *       }
 *     }
 *   ]
 * }, scopes);
 * // Output: true (included resources validated)
 * 
 * @example
 * // Input: Missing required type
 * validatePostPayload({
 *   data: {
 *     attributes: { title: 'Missing Type' }
 *   }
 * }, scopes);
 * // Throws: RestApiPayloadError
 * // 'POST request "data" must have a non-empty "type" string'
 * 
 * @description
 * Used by:
 * - rest-api-plugin.post() method before creating resources
 * - Validates complete document structure
 * 
 * Purpose:
 * - Ensures JSON:API compliance for resource creation
 * - Validates resource types exist in system
 * - Checks relationship references are valid
 * - Validates included resources have required fields
 * - Enables compound document creation patterns
 * 
 * Data flow:
 * 1. Validates document has required 'data' property
 * 2. Checks primary resource type exists in scopes
 * 3. Validates attributes object if present
 * 4. Validates each relationship if present
 * 5. Validates included resources array if present
 * 6. Returns true or throws descriptive error
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
 * Validates a JSON:API document for PUT requests (full resource replacement)
 * 
 * @param {Object} inputRecord - JSON:API document to validate
 * @param {Object} inputRecord.data - Complete resource representation
 * @param {string} inputRecord.data.type - Resource type (must match existing)
 * @param {string|number} inputRecord.data.id - Resource ID (required)
 * @param {Object} [inputRecord.data.attributes] - Complete attributes
 * @param {Object} [inputRecord.data.relationships] - Complete relationships
 * @param {Object} scopes - Scopes proxy to verify resource types exist
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example
 * // Input: Complete resource replacement
 * validatePutPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',                   // Required for PUT
 *     attributes: {
 *       title: 'Updated Title',
 *       body: 'Completely new body text',
 *       status: 'published'
 *     }
 *   }
 * }, scopes);
 * // Output: true
 * 
 * @example
 * // Input: Replace with new relationships
 * validatePutPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       title: 'REST API Best Practices',
 *       body: 'Here are some tips...'
 *     },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '99' }    // New author
 *       },
 *       tags: {
 *         data: [                              // Replace all tags
 *           { type: 'tags', id: '5' },
 *           { type: 'tags', id: '6' },
 *           { type: 'tags', id: '7' }
 *         ]
 *       },
 *       featuredImage: {
 *         data: null                           // Remove relationship
 *       }
 *     }
 *   }
 * }, scopes);
 * // Output: true (complete replacement)
 * 
 * @example
 * // Input: Missing required ID
 * validatePutPayload({
 *   data: {
 *     type: 'articles',
 *     attributes: { title: 'No ID' }
 *   }
 * }, scopes);
 * // Throws: RestApiPayloadError
 * // 'PUT request "data" must have an "id" property'
 * 
 * @example
 * // Input: Includes not allowed
 * validatePutPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: { title: 'Updated' }
 *   },
 *   included: [                        // Not allowed!
 *     { type: 'users', id: '1' }
 *   ]
 * }, scopes);
 * // Throws: RestApiPayloadError
 * // 'PUT requests cannot include an "included" array for creating new resources'
 * 
 * @description
 * Used by:
 * - rest-api-plugin.put() method for full replacement
 * - Enforces PUT semantics vs PATCH
 * 
 * Purpose:
 * - Ensures complete resource replacement semantics
 * - Requires ID to match URL parameter
 * - Prevents included resources (no side effects)
 * - Maintains idempotency of PUT operations
 * - Differentiates from PATCH partial updates
 * 
 * Data flow:
 * 1. Validates document structure with data property
 * 2. Ensures no included array present
 * 3. Validates resource type exists in scopes
 * 4. Requires ID property (unlike POST)
 * 5. Validates attributes and relationships if present
 * 6. Returns true or throws descriptive error
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
 * Validates a JSON:API document for PATCH requests (partial resource updates)
 * 
 * @param {Object} inputRecord - JSON:API document to validate
 * @param {Object} inputRecord.data - Partial resource representation
 * @param {string} inputRecord.data.type - Resource type (must match existing)
 * @param {string|number} inputRecord.data.id - Resource ID (required)
 * @param {Object} [inputRecord.data.attributes] - Attributes to update
 * @param {Object} [inputRecord.data.relationships] - Relationships to update
 * @param {Object} scopes - Scopes proxy to verify resource types exist
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example
 * // Input: Update single field
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       title: 'New Title Only'     // Only title changes
 *       // body, status, etc. remain unchanged
 *     }
 *   }
 * }, scopes);
 * // Output: true
 * 
 * @example
 * // Input: Update multiple fields
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       status: 'published',
 *       publishedAt: '2023-11-15T10:00:00Z'
 *       // Other fields untouched
 *     }
 *   }
 * }, scopes);
 * // Output: true (partial update)
 * 
 * @example
 * // Input: Update relationships only
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '456' }  // Change author
 *       }
 *       // Other relationships unchanged
 *     }
 *   }
 * }, scopes);
 * // Output: true
 * 
 * @example
 * // Input: Clear relationships
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     relationships: {
 *       featuredImage: {
 *         data: null                // Remove to-one
 *       },
 *       tags: {
 *         data: []                  // Clear to-many
 *       }
 *     }
 *   }
 * }, scopes);
 * // Output: true (clearing is valid)
 * 
 * @example
 * // Input: No changes specified
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123'
 *     // Missing both attributes and relationships!
 *   }
 * }, scopes);
 * // Throws: RestApiValidationError
 * // 'PATCH request "data" must have at least one of "attributes" or "relationships"'
 * 
 * @description
 * Used by:
 * - rest-api-plugin.patch() method for partial updates
 * - Enforces PATCH semantics vs PUT
 * 
 * Purpose:
 * - Enables efficient partial updates (send only changes)
 * - Requires at least one change (attributes or relationships)
 * - Prevents included resources (no side effects)
 * - Reduces bandwidth for large resources
 * - Prevents race conditions in concurrent updates
 * 
 * Data flow:
 * 1. Validates document structure with data property
 * 2. Ensures no included array present
 * 3. Validates resource type exists in scopes
 * 4. Requires ID property for targeting
 * 5. Requires at least attributes or relationships
 * 6. Validates each if present
 * 7. Returns true or throws descriptive error
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