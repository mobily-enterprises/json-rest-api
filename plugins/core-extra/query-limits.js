import { BadRequestError } from '../../lib/errors.js';

/**
 * Query Limits Plugin
 * 
 * Prevents resource exhaustion by limiting query complexity:
 * - Maximum join depth and count
 * - Maximum page size
 * - Maximum filter fields
 * - Query cost calculation
 */
export const QueryLimitsPlugin = {
  name: 'QueryLimitsPlugin',
  version: '1.0.0',
  
  install(api, options = {}) {
    // Default configuration
    const config = {
      maxJoins: options.maxJoins ?? 5,
      maxJoinDepth: options.maxJoinDepth ?? 3,
      maxPageSize: options.maxPageSize ?? 100,
      defaultPageSize: options.defaultPageSize ?? 20,
      maxFilterFields: options.maxFilterFields ?? 10,
      maxSortFields: options.maxSortFields ?? 3,
      maxIncludeFields: options.maxIncludeFields ?? 10,
      maxQueryCost: options.maxQueryCost ?? 100,
      
      // Cost weights for different operations
      costs: {
        join: options.costs?.join ?? 10,
        nestedJoin: options.costs?.nestedJoin ?? 15,
        filter: options.costs?.filter ?? 2,
        sort: options.costs?.sort ?? 3,
        pageSize: options.costs?.pageSize ?? 0.1,
        include: options.costs?.include ?? 1,
        ...options.costs
      },
      
      // Per-resource overrides
      resources: options.resources || {},
      
      // Bypass for certain users/roles
      bypassRoles: options.bypassRoles || ['admin', 'superadmin'],
      bypassCheck: options.bypassCheck || ((user) => false),
      
      // Error messages
      messages: {
        maxJoins: `Maximum number of joins (${options.maxJoins ?? 5}) exceeded`,
        maxJoinDepth: `Maximum join depth (${options.maxJoinDepth ?? 3}) exceeded`,
        maxPageSize: `Maximum page size (${options.maxPageSize ?? 100}) exceeded`,
        maxFilterFields: `Maximum number of filter fields (${options.maxFilterFields ?? 10}) exceeded`,
        maxSortFields: `Maximum number of sort fields (${options.maxSortFields ?? 3}) exceeded`,
        maxQueryCost: `Query too complex (cost exceeds ${options.maxQueryCost ?? 100})`,
        ...options.messages
      }
    };
    
    // Store config on API instance
    api._queryLimits = config;
    
    /**
     * Calculate join depth for nested joins like 'authorId.departmentId.countryId'
     */
    function calculateJoinDepth(joinPath) {
      if (typeof joinPath !== 'string') return 1;
      return joinPath.split('.').length;
    }
    
    /**
     * Count total joins including nested ones
     */
    function countJoins(joins) {
      if (!Array.isArray(joins)) return 0;
      
      let count = 0;
      for (const join of joins) {
        if (typeof join === 'string') {
          // Count each level in nested joins
          count += join.split('.').length;
        } else {
          count += 1;
        }
      }
      return count;
    }
    
    /**
     * Calculate query cost based on complexity
     */
    function calculateQueryCost(params, limits) {
      let cost = 0;
      
      // Join costs
      if (params.joins && params.joins !== false) {
        const joins = Array.isArray(params.joins) ? params.joins : [params.joins];
        for (const join of joins) {
          const depth = calculateJoinDepth(join);
          cost += limits.costs.join;
          // Extra cost for nested joins
          if (depth > 1) {
            cost += (depth - 1) * limits.costs.nestedJoin;
          }
        }
      }
      
      // Filter costs
      if (params.filter) {
        const filterCount = Object.keys(params.filter).length;
        cost += filterCount * limits.costs.filter;
      }
      
      // Sort costs
      if (params.sort) {
        const sortFields = params.sort.split(',').length;
        cost += sortFields * limits.costs.sort;
      }
      
      // Page size cost
      const pageSize = params.page?.size || limits.defaultPageSize;
      cost += pageSize * limits.costs.pageSize;
      
      // Include fields cost
      if (params.fields) {
        const fieldCount = Object.keys(params.fields).reduce((sum, key) => {
          const fields = params.fields[key];
          return sum + (Array.isArray(fields) ? fields.length : fields.split(',').length);
        }, 0);
        cost += fieldCount * limits.costs.include;
      }
      
      return cost;
    }
    
    /**
     * Get limits for a specific resource (with overrides)
     */
    function getResourceLimits(resourceType) {
      const resourceConfig = config.resources[resourceType] || {};
      return {
        ...config,
        ...resourceConfig,
        costs: {
          ...config.costs,
          ...(resourceConfig.costs || {})
        }
      };
    }
    
    /**
     * Check if user can bypass limits
     */
    function canBypassLimits(user) {
      if (!user) return false;
      
      // Check custom bypass function
      if (config.bypassCheck(user)) return true;
      
      // Check roles
      if (user.roles && Array.isArray(user.roles)) {
        return user.roles.some(role => config.bypassRoles.includes(role));
      }
      
      return false;
    }
    
    // Hook: Validate query parameters before execution
    api.hook('beforeQuery', async (context) => {
      const { params, options } = context;
      const user = options.user;
      
      // Skip validation if user can bypass
      if (canBypassLimits(user)) {
        return;
      }
      
      // Get limits for this resource
      const limits = getResourceLimits(options.type);
      
      // Validate joins
      if (params.joins && params.joins !== false) {
        const joins = Array.isArray(params.joins) ? params.joins : [params.joins];
        
        // Check max joins
        const joinCount = countJoins(joins);
        if (joinCount > limits.maxJoins) {
          throw new BadRequestError(limits.messages.maxJoins)
            .withContext({ 
              joinCount, 
              maxJoins: limits.maxJoins,
              joins 
            });
        }
        
        // Check max depth
        for (const join of joins) {
          const depth = calculateJoinDepth(join);
          if (depth > limits.maxJoinDepth) {
            throw new BadRequestError(limits.messages.maxJoinDepth)
              .withContext({ 
                join, 
                depth, 
                maxJoinDepth: limits.maxJoinDepth 
              });
          }
        }
      }
      
      // Validate page size
      if (params.page?.size) {
        const pageSize = parseInt(params.page.size, 10);
        if (pageSize > limits.maxPageSize) {
          throw new BadRequestError(limits.messages.maxPageSize)
            .withContext({ 
              pageSize, 
              maxPageSize: limits.maxPageSize 
            });
        }
      }
      
      // Set default page size if not specified
      if (!params.page) {
        params.page = { size: limits.defaultPageSize };
      } else if (!params.page.size) {
        params.page.size = limits.defaultPageSize;
      }
      
      // Validate filter fields
      if (params.filter) {
        const filterCount = Object.keys(params.filter).length;
        if (filterCount > limits.maxFilterFields) {
          throw new BadRequestError(limits.messages.maxFilterFields)
            .withContext({ 
              filterCount, 
              maxFilterFields: limits.maxFilterFields,
              filters: Object.keys(params.filter)
            });
        }
      }
      
      // Validate sort fields
      if (params.sort) {
        const sortFields = params.sort.split(',').filter(s => s.trim());
        if (sortFields.length > limits.maxSortFields) {
          throw new BadRequestError(limits.messages.maxSortFields)
            .withContext({ 
              sortCount: sortFields.length, 
              maxSortFields: limits.maxSortFields,
              sorts: sortFields
            });
        }
      }
      
      // Calculate and check total query cost
      const queryCost = calculateQueryCost(params, limits);
      if (queryCost > limits.maxQueryCost) {
        throw new BadRequestError(limits.messages.maxQueryCost)
          .withContext({ 
            queryCost, 
            maxQueryCost: limits.maxQueryCost,
            breakdown: {
              joins: params.joins ? countJoins(Array.isArray(params.joins) ? params.joins : [params.joins]) : 0,
              filters: params.filter ? Object.keys(params.filter).length : 0,
              sorts: params.sort ? params.sort.split(',').length : 0,
              pageSize: params.page?.size || limits.defaultPageSize
            }
          });
      }
      
      // Store calculated cost for monitoring
      context.queryCost = queryCost;
    }, 5); // Run early to prevent expensive operations
    
    // API method to get current limits
    api.getQueryLimits = (resourceType) => {
      return resourceType ? getResourceLimits(resourceType) : config;
    };
    
    // API method to check if a query would exceed limits
    api.validateQueryComplexity = (params, resourceType, user) => {
      if (canBypassLimits(user)) {
        return { valid: true, cost: 0 };
      }
      
      const limits = getResourceLimits(resourceType);
      const cost = calculateQueryCost(params, limits);
      
      return {
        valid: cost <= limits.maxQueryCost,
        cost,
        maxCost: limits.maxQueryCost,
        limits
      };
    };
  }
};