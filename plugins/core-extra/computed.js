import { NotFoundError, BadRequestError } from '../../lib/errors.js';

/**
 * Computed Plugin
 * 
 * Provides a way to create API resources that generate data on-the-fly
 * without any database storage. This plugin enables you to mix computed
 * resources with database-backed resources in the same API instance.
 * 
 * ## Key Features:
 * - No database required - data is generated on demand
 * - Full API feature support - validation, authentication, hooks, filtering, sorting, pagination
 * - Can access other resources (both computed and database-backed)
 * - Support for all CRUD operations (optional implementation)
 * - Automatic filtering/sorting/pagination of results
 * - Performance optimization options
 * 
 * ## Use Cases:
 * - **Computed/Derived Data**: Calculate statistics, aggregations, or derived values
 * - **External API Proxies**: Wrap third-party APIs with your schema and features
 * - **Real-time Calculations**: Generate data based on current system state
 * - **Mock Data**: Generate test data during development
 * - **Aggregations**: Combine data from multiple resources
 * - **System Metrics**: Expose server stats, health checks, or monitoring data
 * 
 * ## Basic Usage:
 * ```javascript
 * import { ComputedPlugin } from 'json-rest-api/plugins/computed.js';
 * 
 * api.use(ComputedPlugin);
 * 
 * // Simple computed resource
 * api.addResource('random-numbers', numberSchema, {
 *   compute: {
 *     get: async (id, context) => {
 *       // Return computed data for single item
 *       return { id, value: Math.random() * 1000 };
 *     },
 *     query: async (params, context) => {
 *       // Return array of computed items
 *       // The plugin will handle filtering, sorting, and pagination!
 *       return Array.from({ length: 100 }, (_, i) => ({
 *         id: i + 1,
 *         value: Math.random() * 1000,
 *         category: ['A', 'B', 'C', 'D'][i % 4]
 *       }));
 *     }
 *   }
 * });
 * 
 * // Now you can use it with all API features:
 * // GET /api/random-numbers?filter[category]=A&filter[value][gte]=500&sort=-value&page[size]=10
 * ```
 * 
 * ## Advanced Example - Aggregating Database Data:
 * ```javascript
 * api.addResource('user-stats', statsSchema, {
 *   compute: {
 *     get: async (userId, context) => {
 *       // Access other resources via context.api
 *       const user = await context.api.resources.users.get(userId);
 *       const posts = await context.api.resources.posts.query({ 
 *         filter: { userId } 
 *       });
 *       
 *       // Return computed statistics
 *       return {
 *         id: userId,
 *         username: user.data.attributes.name,
 *         postCount: posts.data.length,
 *         avgPostLength: posts.data.reduce((sum, p) => 
 *           sum + p.attributes.content.length, 0) / posts.data.length,
 *         lastActive: posts.data[0]?.attributes.createdAt || user.data.attributes.createdAt
 *       };
 *     }
 *   }
 * });
 * ```
 * 
 * ## Performance Optimization:
 * ```javascript
 * api.addResource('external-data', dataSchema, {
 *   compute: {
 *     query: async (params, context) => {
 *       // When calling external APIs, you can handle filtering yourself
 *       // to avoid fetching unnecessary data
 *       const url = new URL('https://api.example.com/data');
 *       
 *       // Apply filters to external API call
 *       if (params.filter?.category) {
 *         url.searchParams.set('category', params.filter.category);
 *       }
 *       
 *       const response = await fetch(url);
 *       const data = await response.json();
 *       
 *       // Transform to your schema
 *       return data.map(transformToSchema);
 *     },
 *     
 *     // Tell the plugin you handle these operations
 *     handlesFiltering: true,   // You apply filters in your query
 *     handlesSorting: true,     // You apply sorting in your query
 *     handlesPagination: true   // You apply pagination in your query
 *   }
 * });
 * ```
 */
export const ComputedPlugin = {
  /**
   * Install the ComputedPlugin into an API instance
   * 
   * @param {Api} api - The API instance to install into
   * @param {Object} options - Plugin options (currently unused)
   */
  install(api, options = {}) {
    // Store compute functions for each resource type
    // This map holds the compute configuration for each resource
    if (!api._computeFunctions) {
      api._computeFunctions = new Map();
    }

    // Override addResource to capture compute configurations
    // This allows us to intercept resource registration and store
    // compute functions when a resource has a 'compute' option
    const originalAddResource = api.addResource.bind(api);
    api.addResource = function(type, schema, resourceOptions = {}) {
      if (resourceOptions.compute) {
        // Validate compute configuration
        const compute = resourceOptions.compute;
        if (typeof compute !== 'object' || compute === null) {
          throw new Error(`Compute option for resource '${type}' must be an object`);
        }
        
        // At least one operation must be defined
        const operations = ['get', 'query', 'insert', 'update', 'delete'];
        const hasOperation = operations.some(op => typeof compute[op] === 'function');
        if (!hasOperation) {
          throw new Error(`Compute option for resource '${type}' must define at least one operation (get, query, insert, update, delete)`);
        }
        
        api._computeFunctions.set(type, resourceOptions.compute);
      }
      return originalAddResource(type, schema, resourceOptions);
    };

    // Hook: beforeGet - Check if this is a computed resource
    // This runs early (default priority) to mark computed operations
    // before any storage plugins try to handle them
    api.hook('beforeGet', async (context) => {
      const computeFns = api._computeFunctions.get(context.options.type);
      if (!computeFns?.get) return;

      // Mark this as a computed operation
      // This flag prevents database storage plugins from running
      context.isComputed = true;
    });

    // Hook: beforeQuery - Check if this is a computed resource
    api.hook('beforeQuery', async (context) => {
      const computeFns = api._computeFunctions.get(context.options.type);
      if (!computeFns?.query) return;

      // Mark this as a computed operation
      context.isComputed = true;
    });

    /**
     * Implementation: get - Retrieve a single computed resource
     * 
     * The compute.get function receives:
     * - id: The requested resource ID
     * - context: Full operation context including api reference
     * 
     * The function should return:
     * - An object representing the resource
     * - null/undefined if not found (will throw NotFoundError)
     * - Can throw errors directly for other error cases
     */
    api.implement('get', async (context) => {
      // Skip if not a computed resource
      if (!context.isComputed) return;

      const computeFns = api._computeFunctions.get(context.options.type);
      if (!computeFns?.get) {
        throw new BadRequestError(`Resource ${context.options.type} does not support get operations`);
      }

      try {
        // Call the user's compute function
        const result = await computeFns.get(context.id, context);
        
        // Handle not found
        if (!result) {
          throw new NotFoundError(context.options.type, context.id);
        }

        // Ensure result has the requested ID
        // This is important for JSON:API compliance
        const idProperty = api.options.idProperty || 'id';
        if (!result[idProperty]) {
          result[idProperty] = context.id;
        }

        return result;
      } catch (error) {
        // Preserve NotFoundError
        if (error instanceof NotFoundError) throw error;
        // Wrap other errors in BadRequestError with context
        throw new BadRequestError(`Failed to compute ${context.options.type}: ${error.message}`);
      }
    });

    /**
     * Implementation: query - Retrieve multiple computed resources
     * 
     * The compute.query function receives:
     * - params: Query parameters including filter, sort, page, etc.
     * - context: Full operation context including api reference
     * 
     * The function should return:
     * - An array of objects representing resources
     * - Can be empty array for no results
     * 
     * Automatic Processing:
     * By default, the plugin will automatically handle:
     * - Filtering (using filter parameters)
     * - Sorting (using sort parameter)
     * - Pagination (using page parameter)
     * 
     * Performance Optimization:
     * If your compute function handles these operations itself
     * (e.g., when calling an external API), you can disable
     * automatic processing by setting:
     * - handlesFiltering: true
     * - handlesSorting: true  
     * - handlesPagination: true
     * 
     * Example:
     * ```javascript
     * compute: {
     *   query: async (params) => {
     *     // Your external API handles filtering
     *     const url = `https://api.example.com/data?category=${params.filter?.category}`;
     *     return await fetch(url).then(r => r.json());
     *   },
     *   handlesFiltering: true // Disable automatic filtering
     * }
     * ```
     */
    api.implement('query', async (context) => {
      // Skip if not a computed resource
      if (!context.isComputed) return;

      const computeFns = api._computeFunctions.get(context.options.type);
      if (!computeFns?.query) {
        throw new BadRequestError(`Resource ${context.options.type} does not support query operations`);
      }

      try {
        // Call the user's compute function
        let results = await computeFns.query(context.params, context);
        
        // Validate the result
        if (!Array.isArray(results)) {
          throw new Error('Computed query must return an array');
        }

        // Apply filtering if compute function didn't handle it
        // This allows the compute function to fetch all data and let
        // the plugin handle filtering, which is useful for small datasets
        if (context.params.filter && !computeFns.handlesFiltering) {
          results = applyFilters(results, context.params.filter);
        }

        // Apply sorting if compute function didn't handle it
        // The plugin can sort by any field in the returned data
        if (context.params.sort && !computeFns.handlesSorting) {
          results = applySort(results, context.params.sort);
        }

        // Calculate total before pagination
        // This is the total count after filtering
        const total = results.length;

        // Apply pagination if compute function didn't handle it
        // Standard page[size] and page[number] parameters
        if (context.params.page && !computeFns.handlesPagination) {
          const { size = 10, number = 1 } = context.params.page;
          const start = (number - 1) * size;
          results = results.slice(start, start + size);
        }

        // Return in the format expected by the query method
        return {
          results,
          meta: {
            total,
            pageSize: context.params.page?.size || 10,
            pageNumber: context.params.page?.number || 1,
            totalPages: Math.ceil(total / (context.params.page?.size || 10))
          }
        };
      } catch (error) {
        throw new BadRequestError(`Failed to compute ${context.options.type}: ${error.message}`);
      }
    });

    /**
     * Implementation: insert - Create a new computed resource
     * 
     * This is optional - only implement if your computed resource
     * supports creation (e.g., creating records in an external API).
     * 
     * The compute.insert function receives:
     * - data: The resource data to create
     * - context: Full operation context
     * 
     * The function should return:
     * - The created resource object with an ID
     */
    api.implement('insert', async (context) => {
      if (!context.isComputed) return;

      const computeFns = api._computeFunctions.get(context.options.type);
      if (!computeFns?.insert) {
        throw new BadRequestError(`Resource ${context.options.type} does not support insert operations`);
      }

      try {
        // Call the user's compute function
        const result = await computeFns.insert(context.data, context);
        
        // Ensure result has ID
        const idProperty = api.options.idProperty || 'id';
        if (!result[idProperty]) {
          result[idProperty] = context.data[idProperty] || generateId();
        }

        return result;
      } catch (error) {
        throw new BadRequestError(`Failed to compute insert for ${context.options.type}: ${error.message}`);
      }
    });

    /**
     * Implementation: update - Update an existing computed resource
     * 
     * This is optional - only implement if your computed resource
     * supports updates (e.g., updating records in an external API).
     * 
     * The compute.update function receives:
     * - id: The resource ID to update
     * - data: The update data (partial or full based on context.options.fullRecord)
     * - context: Full operation context
     * 
     * The function should return:
     * - The updated resource object
     * - null/undefined if not found (will throw NotFoundError)
     */
    api.implement('update', async (context) => {
      if (!context.isComputed) return;

      const computeFns = api._computeFunctions.get(context.options.type);
      if (!computeFns?.update) {
        throw new BadRequestError(`Resource ${context.options.type} does not support update operations`);
      }

      try {
        const result = await computeFns.update(context.id, context.data, context);
        
        if (!result) {
          throw new NotFoundError(context.options.type, context.id);
        }

        // Ensure result has ID
        const idProperty = api.options.idProperty || 'id';
        if (!result[idProperty]) {
          result[idProperty] = context.id;
        }

        return result;
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new BadRequestError(`Failed to compute update for ${context.options.type}: ${error.message}`);
      }
    });

    /**
     * Implementation: delete - Delete a computed resource
     * 
     * This is optional - only implement if your computed resource
     * supports deletion (e.g., deleting records in an external API).
     * 
     * The compute.delete function receives:
     * - id: The resource ID to delete
     * - context: Full operation context
     * 
     * The function should return:
     * - true/truthy value if successful
     * - false/falsy if not found (will throw NotFoundError)
     */
    api.implement('delete', async (context) => {
      if (!context.isComputed) return;

      const computeFns = api._computeFunctions.get(context.options.type);
      if (!computeFns?.delete) {
        throw new BadRequestError(`Resource ${context.options.type} does not support delete operations`);
      }

      try {
        const success = await computeFns.delete(context.id, context);
        
        if (!success) {
          throw new NotFoundError(context.options.type, context.id);
        }
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new BadRequestError(`Failed to compute delete for ${context.options.type}: ${error.message}`);
      }
    });

    // Add early hooks for insert/update/delete operations
    // These run at priority 5 (very early) to mark computed operations
    // before any storage plugins try to handle them
    api.hook('beforeInsert', checkComputed, 5);
    api.hook('beforeUpdate', checkComputed, 5);
    api.hook('beforeDelete', checkComputed, 5);
  }
};

/**
 * Helper: checkComputed - Mark computed operations early in the hook chain
 * 
 * This function runs at high priority (5) in the before* hooks to set
 * the isComputed flag. This prevents database storage plugins from
 * attempting to handle computed resources.
 */
function checkComputed(context) {
  const api = context.api;
  const computeFns = api._computeFunctions.get(context.options.type);
  if (computeFns) {
    context.isComputed = true;
  }
}

/**
 * Helper: applyFilters - Apply filter parameters to result array
 * 
 * Supports both simple equality filters and advanced operators.
 * This is used when the compute function returns all data and
 * lets the plugin handle filtering.
 * 
 * @param {Array} results - Array of resources to filter
 * @param {Object} filters - Filter parameters from query
 * @returns {Array} Filtered results
 * 
 * Examples:
 * - Simple: filter[status]=active
 * - Operators: filter[age][gte]=18
 * - Multiple: filter[status]=active&filter[age][gte]=18
 */
function applyFilters(results, filters) {
  return results.filter(item => {
    for (const [field, value] of Object.entries(filters)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Handle operators like {gte: 18, lte: 65}
        for (const [op, val] of Object.entries(value)) {
          if (!checkOperator(item[field], op, val)) return false;
        }
      } else {
        // Simple equality check
        if (item[field] !== value) return false;
      }
    }
    return true;
  });
}

/**
 * Helper: checkOperator - Evaluate a single filter operator
 * 
 * Supports all standard JSON:API filter operators.
 * 
 * @param {*} fieldValue - The actual field value from the resource
 * @param {string} operator - The operator name (eq, gte, contains, etc.)
 * @param {*} value - The value to compare against
 * @returns {boolean} True if the condition is met
 * 
 * Supported operators:
 * - eq: Equal to
 * - ne: Not equal to
 * - gt: Greater than
 * - gte: Greater than or equal to
 * - lt: Less than
 * - lte: Less than or equal to
 * - in: Value is in array
 * - nin: Value is not in array
 * - contains: String contains value (case-insensitive)
 * - startsWith: String starts with value (case-insensitive)
 * - endsWith: String ends with value (case-insensitive)
 * - null: Value is null or undefined
 * - notnull: Value is not null or undefined
 */
function checkOperator(fieldValue, operator, value) {
  switch (operator) {
    case 'eq': return fieldValue === value;
    case 'ne': return fieldValue !== value;
    case 'gt': return fieldValue > value;
    case 'gte': return fieldValue >= value;
    case 'lt': return fieldValue < value;
    case 'lte': return fieldValue <= value;
    case 'in': return Array.isArray(value) && value.includes(fieldValue);
    case 'nin': return Array.isArray(value) && !value.includes(fieldValue);
    case 'contains': 
      return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
    case 'startsWith':
      return String(fieldValue).toLowerCase().startsWith(String(value).toLowerCase());
    case 'endsWith':
      return String(fieldValue).toLowerCase().endsWith(String(value).toLowerCase());
    case 'null': return fieldValue === null || fieldValue === undefined;
    case 'notnull': return fieldValue !== null && fieldValue !== undefined;
    default: return true;
  }
}

/**
 * Helper: applySort - Apply sort parameters to result array
 * 
 * Sorts results by one or more fields in ascending or descending order.
 * This is used when the compute function returns all data and lets
 * the plugin handle sorting.
 * 
 * @param {Array} results - Array of resources to sort
 * @param {string|Array} sort - Sort parameter(s)
 * @returns {Array} Sorted copy of results
 * 
 * Examples:
 * - Single field: sort=name (ascending)
 * - Descending: sort=-createdAt 
 * - Multiple: sort=-priority,name
 */
function applySort(results, sort) {
  const sortFields = parseSortParam(sort);
  
  // Create a copy and sort it
  return [...results].sort((a, b) => {
    for (const { field, direction } of sortFields) {
      const aVal = a[field];
      const bVal = b[field];
      
      if (aVal < bVal) return direction === 'ASC' ? -1 : 1;
      if (aVal > bVal) return direction === 'ASC' ? 1 : -1;
    }
    return 0;
  });
}

/**
 * Helper: parseSortParam - Parse sort parameter into structured format
 * 
 * Handles various sort parameter formats:
 * - String: "name" or "-createdAt" or "name,-createdAt"
 * - Array of strings: ["name", "-createdAt"]
 * - Array of objects: [{field: "name", direction: "ASC"}]
 * 
 * @param {string|Array} sort - Sort parameter
 * @returns {Array<{field: string, direction: string}>} Parsed sort fields
 */
function parseSortParam(sort) {
  if (!sort) return [];
  
  if (Array.isArray(sort)) {
    return sort.map(s => {
      if (typeof s === 'string') {
        return { field: s, direction: 'ASC' };
      }
      return { field: s.field, direction: s.direction || 'ASC' };
    });
  }
  
  if (typeof sort === 'string') {
    return sort.split(',').map(field => {
      field = field.trim();
      if (field.startsWith('-')) {
        return { field: field.slice(1), direction: 'DESC' };
      }
      return { field, direction: 'ASC' };
    });
  }
  
  return [];
}

/**
 * Helper: generateId - Generate unique IDs for created resources
 * 
 * This is used when a compute.insert function doesn't provide an ID.
 * Generates a unique string ID based on timestamp and counter.
 * 
 * @returns {string} Unique ID
 */
let idCounter = 1;
function generateId() {
  return String(Date.now() + idCounter++);
}