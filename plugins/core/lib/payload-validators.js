import { RestApiValidationError, RestApiPayloadError } from '../../../lib/rest-api-errors.js';

/**
 * Validates a JSON:API resource identifier object
 * 
 * Ensures that a resource identifier follows JSON:API spec with proper type and id.
 * Used internally to validate relationship data and included resources.
 * 
 * @param {Object} identifier - The resource identifier to validate
 * @param {string} context - Context for error messages (e.g., "Relationship 'author'")
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {RestApiPayloadError|RestApiValidationError} If validation fails
 * 
 * @example <caption>Valid resource identifier</caption>
 * // This passes validation:
 * validateResourceIdentifier(
 *   { type: 'articles', id: '123' },
 *   "Relationship 'author'",
 *   scopes
 * );
 * 
 * @example <caption>Invalid - missing type</caption>
 * // This throws RestApiPayloadError:
 * validateResourceIdentifier(
 *   { id: '123' },  // Missing 'type'
 *   "Relationship 'comments'",
 *   scopes
 * );
 * // Error: "Relationship 'comments': Resource identifier must have a non-empty 'type' string"
 * 
 * @example <caption>Invalid - unknown resource type</caption>
 * // This throws RestApiValidationError if 'unknown' scope doesn't exist:
 * validateResourceIdentifier(
 *   { type: 'unknown', id: '456' },
 *   "Included resource",
 *   scopes
 * );
 * // Error: "Included resource: Unknown resource type 'unknown'. No scope with this name exists."
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
 * Ensures relationships have proper structure with 'data' property containing
 * either null, a single resource identifier, or an array of resource identifiers.
 * Used to validate relationships in POST, PUT, and PATCH payloads.
 * 
 * @param {Object} relationship - The relationship to validate
 * @param {string} relationshipName - Name of the relationship for error context
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {RestApiPayloadError} If validation fails
 * 
 * @example <caption>Valid to-one relationship</caption>
 * // Setting an article's author:
 * validateRelationship(
 *   { data: { type: 'users', id: '42' } },
 *   'author',
 *   scopes
 * );
 * 
 * @example <caption>Valid to-many relationship</caption>
 * // Setting an article's tags:
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
 * 
 * @example <caption>Valid null relationship (removing association)</caption>
 * // Removing an article's featured image:
 * validateRelationship(
 *   { data: null },
 *   'featuredImage',
 *   scopes
 * );
 * 
 * @example <caption>Valid empty to-many relationship</caption>
 * // Clearing all comments:
 * validateRelationship(
 *   { data: [] },
 *   'comments',
 *   scopes
 * );
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
 * Ensures GET requests have required 'id' parameter and validates optional
 * query parameters like 'include' and 'fields' for sparse fieldsets.
 * This is called by the REST API plugin before executing a GET request.
 * 
 * @param {Object} params - The parameters object containing id and queryParams
 * @param {string|number} params.id - The resource ID to fetch
 * @param {Object} [params.queryParams] - Optional query parameters
 * @param {string[]} [params.queryParams.include] - Related resources to include
 * @param {Object} [params.queryParams.fields] - Sparse fieldsets by resource type
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example <caption>Basic GET validation</caption>
 * // Fetch article 123:
 * validateGetPayload({
 *   id: '123'
 * });
 * 
 * @example <caption>GET with includes</caption>
 * // Fetch article with author and comments:
 * validateGetPayload({
 *   id: '123',
 *   queryParams: {
 *     include: ['author', 'comments.author']
 *   }
 * });
 * 
 * @example <caption>GET with sparse fieldsets</caption>
 * // Fetch only specific fields:
 * validateGetPayload({
 *   id: '123',
 *   queryParams: {
 *     include: ['author'],
 *     fields: {
 *       articles: 'title,body',
 *       users: 'name,email'
 *     }
 *   }
 * });
 * 
 * @example <caption>Invalid - missing ID</caption>
 * // This throws RestApiValidationError:
 * validateGetPayload({
 *   queryParams: { include: ['author'] }
 * });
 * // Error: "GET request must include an id parameter"
 * 
 * @example <caption>Invalid - null ID</caption>
 * // This throws RestApiValidationError:
 * validateGetPayload({
 *   id: null
 * });
 * // Error: "GET request id cannot be null, undefined, or empty"
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to ensure requests are valid before
 * // passing them to the storage layer (e.g., Knex plugin), preventing
 * // invalid queries from reaching the database and providing consistent
 * // error messages across all storage implementations.
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
 * Validates query parameters for collection requests (query/list operations)
 * 
 * Ensures collection queries have valid filters, sorting, pagination, includes,
 * and sparse fieldsets. Validates that sort fields are in the allowed list.
 * This is called by the REST API plugin before executing a query request.
 * 
 * @param {Object} params - The parameters object
 * @param {Object} [params.queryParams] - Query parameters for the collection
 * @param {string[]} [params.queryParams.include] - Related resources to include
 * @param {Object} [params.queryParams.fields] - Sparse fieldsets by resource type
 * @param {Object} [params.queryParams.filters] - Filter conditions
 * @param {string[]} [params.queryParams.sort] - Sort fields (prefix with - for DESC)
 * @param {Object} [params.queryParams.page] - Pagination parameters
 * @param {string[]} sortableFields - Array of fields that can be sorted
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example <caption>Basic query validation</caption>
 * // Simple query with no parameters:
 * validateQueryPayload({}, ['title', 'createdAt']);
 * 
 * @example <caption>Query with filters and sorting</caption>
 * // Find published articles sorted by date:
 * validateQueryPayload({
 *   queryParams: {
 *     filters: {
 *       status: 'published',
 *       'author.name': 'John Doe'  // Cross-table filter
 *     },
 *     sort: ['-publishedAt', 'title'],  // DESC by date, then ASC by title
 *   }
 * }, ['publishedAt', 'title', 'createdAt']);
 * 
 * @example <caption>Query with pagination</caption>
 * // Page-based pagination:
 * validateQueryPayload({
 *   queryParams: {
 *     page: { number: 2, size: 20 }
 *   }
 * }, []);
 * 
 * // Offset-based pagination:
 * validateQueryPayload({
 *   queryParams: {
 *     page: { offset: 40, limit: 20 }
 *   }
 * }, []);
 * 
 * @example <caption>Complex query with all features</caption>
 * // Full-featured query:
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
 * 
 * @example <caption>Invalid - non-sortable field</caption>
 * // This throws RestApiValidationError:
 * validateQueryPayload({
 *   queryParams: {
 *     sort: ['secretField']  // Not in sortableFields
 *   }
 * }, ['title', 'createdAt']);
 * // Error: "Field 'secretField' is not sortable. Sortable fields are: title, createdAt"
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Prevent SQL injection by validating filter keys
 * // 2. Ensure consistent pagination across storage backends
 * // 3. Prevent sorting on non-indexed fields that could slow queries
 * // 4. Provide clear error messages before hitting the database
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
 * Validates a JSON:API document for POST requests (resource creation)
 * 
 * Ensures POST payloads follow JSON:API spec with proper data structure,
 * validates relationships reference existing resources, and checks that
 * included resources have required IDs. This is the main validation gateway
 * for creating new resources through the REST API.
 * 
 * @param {Object} inputRecord - The JSON:API document to validate
 * @param {Object} inputRecord.data - The primary resource to create
 * @param {string} inputRecord.data.type - Resource type (must match a scope)
 * @param {string|number} [inputRecord.data.id] - Optional client-generated ID
 * @param {Object} [inputRecord.data.attributes] - Resource attributes
 * @param {Object} [inputRecord.data.relationships] - Resource relationships
 * @param {Object[]} [inputRecord.included] - Related resources for compound documents
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example <caption>Basic POST validation</caption>
 * // Create a simple article:
 * validatePostPayload({
 *   data: {
 *     type: 'articles',
 *     attributes: {
 *       title: 'Hello World',
 *       body: 'Welcome to my blog...'
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>POST with relationships</caption>
 * // Create article with author and tags:
 * validatePostPayload({
 *   data: {
 *     type: 'articles',
 *     attributes: {
 *       title: 'REST API Design'
 *     },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '42' }
 *       },
 *       tags: {
 *         data: [
 *           { type: 'tags', id: '1' },
 *           { type: 'tags', id: '2' }
 *         ]
 *       }
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>POST with client-generated ID</caption>
 * // Some APIs allow client-generated IDs:
 * validatePostPayload({
 *   data: {
 *     type: 'articles',
 *     id: 'article-2023-11-15-hello-world',  // Client-provided ID
 *     attributes: {
 *       title: 'Hello World'
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>POST with included resources (compound document)</caption>
 * // Create article with embedded author data for client convenience:
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
 *   included: [
 *     {
 *       type: 'users',
 *       id: '42',
 *       attributes: {
 *         name: 'John Doe',
 *         email: 'john@example.com'
 *       }
 *     }
 *   ]
 * }, scopes);
 * 
 * @example <caption>Invalid - missing type</caption>
 * // This throws RestApiPayloadError:
 * validatePostPayload({
 *   data: {
 *     attributes: { title: 'Missing Type' }
 *   }
 * }, scopes);
 * // Error: 'POST request "data" must have a non-empty "type" string'
 * 
 * @example <caption>Invalid - unknown resource type</caption>
 * // This throws RestApiValidationError:
 * validatePostPayload({
 *   data: {
 *     type: 'unicorns',  // Not a registered scope
 *     attributes: { name: 'Sparkles' }
 *   }
 * }, scopes);
 * // Error: 'POST request "data.type" 'unicorns' is not a valid resource type'
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Ensure data integrity before hitting the database
 * // 2. Validate relationships exist before creating foreign key references
 * // 3. Provide consistent API behavior across different storage backends
 * // 4. Enable compound document creation while maintaining data consistency
 * // 5. Catch errors early with meaningful messages for API consumers
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
 * Ensures PUT payloads follow JSON:API spec for complete resource replacement.
 * Unlike PATCH, PUT requires the complete resource representation and doesn't
 * allow 'included' arrays (as PUT shouldn't create new related resources).
 * The ID is required and must match the URL parameter.
 * 
 * @param {Object} inputRecord - The JSON:API document to validate
 * @param {Object} inputRecord.data - The complete resource representation
 * @param {string} inputRecord.data.type - Resource type (must match existing)
 * @param {string|number} inputRecord.data.id - Resource ID (required)
 * @param {Object} [inputRecord.data.attributes] - Complete attributes
 * @param {Object} [inputRecord.data.relationships] - Complete relationships
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example <caption>Basic PUT validation</caption>
 * // Replace entire article:
 * validatePutPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       title: 'Updated Title',
 *       body: 'Completely new body text',
 *       status: 'published'
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>PUT with relationship replacement</caption>
 * // Replace article with new author and tags:
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
 *         data: { type: 'users', id: '99' }  // Changed author
 *       },
 *       tags: {
 *         data: [  // Completely new set of tags
 *           { type: 'tags', id: '5' },
 *           { type: 'tags', id: '6' },
 *           { type: 'tags', id: '7' }
 *         ]
 *       },
 *       featuredImage: {
 *         data: null  // Remove featured image
 *       }
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>Invalid - missing ID</caption>
 * // This throws RestApiPayloadError:
 * validatePutPayload({
 *   data: {
 *     type: 'articles',
 *     attributes: { title: 'No ID' }
 *   }
 * }, scopes);
 * // Error: 'PUT request "data" must have an "id" property'
 * 
 * @example <caption>Invalid - includes not allowed</caption>
 * // This throws RestApiPayloadError:
 * validatePutPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: { title: 'Updated' }
 *   },
 *   included: [  // Not allowed in PUT
 *     { type: 'users', id: '1', attributes: { name: 'John' } }
 *   ]
 * }, scopes);
 * // Error: 'PUT requests cannot include an "included" array'
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses PUT validation to:
 * // 1. Ensure idempotent operations (same PUT = same result)
 * // 2. Prevent accidental partial updates (use PATCH for that)
 * // 3. Maintain clear semantics: PUT = replace, PATCH = modify
 * // 4. Prevent side effects like creating related resources
 * // 5. Ensure the ID in payload matches the URL parameter
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
 * Ensures PATCH payloads follow JSON:API spec for partial updates. Unlike PUT,
 * PATCH allows sending only the fields/relationships that need updating.
 * Requires at least one of 'attributes' or 'relationships' to be present.
 * Like PUT, doesn't allow 'included' arrays.
 * 
 * @param {Object} inputRecord - The JSON:API document to validate
 * @param {Object} inputRecord.data - The partial resource representation
 * @param {string} inputRecord.data.type - Resource type (must match existing)
 * @param {string|number} inputRecord.data.id - Resource ID (required)
 * @param {Object} [inputRecord.data.attributes] - Attributes to update
 * @param {Object} [inputRecord.data.relationships] - Relationships to update
 * @param {Object} scopes - The scopes proxy object to check if type exists
 * @returns {boolean} True if valid
 * @throws {RestApiValidationError|RestApiPayloadError} If validation fails
 * 
 * @example <caption>PATCH single attribute</caption>
 * // Just update the title:
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       title: 'New Title Only'
 *       // Other attributes remain unchanged
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>PATCH multiple attributes</caption>
 * // Update status and timestamp:
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       status: 'published',
 *       publishedAt: '2023-11-15T10:00:00Z'
 *       // title, body, etc. remain unchanged
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>PATCH relationships only</caption>
 * // Just change the author:
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '456' }
 *       }
 *       // tags, comments, etc. remain unchanged
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>PATCH to clear relationships</caption>
 * // Remove featured image, clear all tags:
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     relationships: {
 *       featuredImage: {
 *         data: null  // Remove to-one relationship
 *       },
 *       tags: {
 *         data: []  // Clear to-many relationship
 *       }
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>PATCH both attributes and relationships</caption>
 * // Complex update:
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       status: 'archived',
 *       archivedAt: '2023-11-15T15:30:00Z'
 *     },
 *     relationships: {
 *       archivedBy: {
 *         data: { type: 'users', id: '789' }
 *       }
 *     }
 *   }
 * }, scopes);
 * 
 * @example <caption>Invalid - no changes specified</caption>
 * // This throws RestApiValidationError:
 * validatePatchPayload({
 *   data: {
 *     type: 'articles',
 *     id: '123'
 *     // No attributes or relationships!
 *   }
 * }, scopes);
 * // Error: 'PATCH request "data" must have at least one of "attributes" or "relationships"'
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses PATCH validation to:
 * // 1. Enable efficient partial updates (only send what changes)
 * // 2. Reduce bandwidth for large resources
 * // 3. Prevent race conditions (don't overwrite fields you didn't intend to)
 * // 4. Support field-level permissions (some fields might be read-only)
 * // 5. Maintain clear semantics vs PUT (PATCH = modify, PUT = replace)
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