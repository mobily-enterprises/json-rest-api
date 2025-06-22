import express from 'express';
import { NotFoundError, BadRequestError, ApiError, formatErrorResponse, normalizeError } from '../lib/errors.js';

/**
 * HTTP plugin for JSON REST API with JSON:API compliance
 * 
 * Features:
 * - JSON:API compliant request/response handling
 * - Automatic handling of affected/related records in responses
 * - Support for compound documents with 'included' section
 */
export const HTTPPlugin = {
  install(api, options = {}) {
    const router = express.Router();
    api.router = router;
    
    // Store app reference for other plugins to use (like GraphQL)
    if (options.app) {
      api.app = options.app;
    }
    
    // Store basePath for other plugins to use
    api.basePath = options.basePath || '/api';

    // Middleware for JSON parsing
    router.use(express.json({
      type: ['application/json', 'application/vnd.api+json']
    }));
    
    
    // Content-Type validation middleware
    if (options.validateContentType !== false) {
      router.use((req, res, next) => {
        // Skip validation for requests without body
        if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
          return next();
        }
        
        const contentType = req.headers['content-type'];
        
        // Require Content-Type header for requests with body
        if (!contentType || contentType.trim() === '') {
          const error = new BadRequestError(
            'Content-Type header is required for requests with body'
          ).withContext({ method: req.method });
          return res.status(400).json(formatErrors(error));
        }
        
        // Check if content type is acceptable
        const validTypes = options.allowedContentTypes || 
          ['application/json', 'application/vnd.api+json'];
        
        const hasValidType = validTypes.some(type => 
          contentType.toLowerCase().includes(type.toLowerCase())
        );
        
        if (!hasValidType) {
          const error = new ApiError(
            `Content-Type must be one of: ${validTypes.join(', ')}`,
            415,
            'UNSUPPORTED_MEDIA_TYPE'
          );
          return res.status(415).json(formatErrors(error));
        }
        
        next();
      });
    }

    // Base path for all routes (already stored on api object)
    const basePath = api.basePath;
    
    // User extraction function
    const getUserFromRequest = options.getUserFromRequest || ((req) => req.user);

    // Helper to parse JSON:API request body
    const parseJsonApiBody = (body, includeId = false) => {
      if (body.data) {
        if (body.data.attributes) {
          // JSON:API format
          const result = { ...body.data.attributes };
          // Only include id if explicitly requested and it exists
          if (includeId && body.data.id) {
            result.id = body.data.id;
          }
          return result;
        }
        // Assume data is the actual data
        return body.data;
      }
      // Plain format
      return body;
    };

    // Helper to format JSON:API errors with sanitization options
    const formatErrors = (error) => {
      // Allow overriding sanitization via plugin options
      const sanitizeOptions = {};
      if (options.errorSanitization !== undefined) {
        sanitizeOptions.sanitize = options.errorSanitization;
      }
      if (options.forceProductionErrors) {
        sanitizeOptions.forceProduction = true;
      }
      if (options.forceDevelopmentErrors) {
        sanitizeOptions.forceDevelopment = true;
      }
      
      return formatErrorResponse(error, sanitizeOptions);
    };
    
    // Parse sort parameter from string to array
    // "-createdAt,name" => [{field: 'createdAt', direction: 'DESC'}, {field: 'name', direction: 'ASC'}]
    const parseSortParam = (sortString) => {
      if (!sortString) return [];
      
      return sortString.split(',').map(field => {
        field = field.trim();
        if (field.startsWith('-')) {
          return { field: field.slice(1), direction: 'DESC' };
        }
        return { field, direction: 'ASC' };
      });
    };

    // Parse query parameters
    const parseQueryParams = (req) => {
      const params = {
        filter: {},
        sort: parseSortParam(req.query.sort),
        page: {},
        include: req.query.include,
        fields: {},
        view: req.query.view
      };
      
      // Only include page parameters if they are provided
      // Check for JSON:API format first
      if (req.query.page && typeof req.query.page === 'object') {
        if (req.query.page.size !== undefined) {
          params.page.size = req.query.page.size;
        }
        if (req.query.page.number !== undefined) {
          params.page.number = req.query.page.number;
        }
      } else {
        // Legacy format support
        if (req.query.pageSize !== undefined) {
          params.page.size = req.query.pageSize;
        }
        if (req.query.page !== undefined && typeof req.query.page !== 'object') {
          params.page.number = req.query.page;
        }
      }
      
      if (api.options.debug) {
        console.log('Raw query:', req.query);
      }

      
      // Parse filters
      // Express already parses filter[field]=value into { filter: { field: value } }
      // Also supports filter[field][operator]=value syntax
      if (req.query.filter && typeof req.query.filter === 'object') {
        for (const [key, value] of Object.entries(req.query.filter)) {
          if (typeof value === 'object' && value !== null) {
            // Handle operator syntax: filter[field][operator]=value
            params.filter[key] = value;
          } else {
            // Handle simple syntax: filter[field]=value (implies 'eq' operator)
            // Convert string booleans to actual booleans
            if (value === 'true') {
              params.filter[key] = true;
            } else if (value === 'false') {
              params.filter[key] = false;
            } else {
              params.filter[key] = value;
            }
          }
        }
      }
      
      // Parse fields
      if (req.query.fields && typeof req.query.fields === 'object') {
        for (const [type, fields] of Object.entries(req.query.fields)) {
          params.fields[type] = typeof fields === 'string' ? fields.split(',') : fields;
        }
      }
      
      // Legacy support for filter[field] syntax if Express doesn't parse it
      // Also handles filter[field][operator] syntax
      const filterRegex = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/;
      for (const [key, value] of Object.entries(req.query)) {
        const filterMatch = key.match(filterRegex);
        if (filterMatch) {
          const [, field, operator] = filterMatch;
          if (operator) {
            // filter[field][operator]=value syntax
            if (!params.filter[field]) {
              params.filter[field] = {};
            }
            params.filter[field][operator] = value;
          } else {
            // filter[field]=value syntax
            // Convert string booleans to actual booleans
            if (value === 'true') {
              params.filter[field] = true;
            } else if (value === 'false') {
              params.filter[field] = false;
            } else {
              params.filter[field] = value;
            }
          }
        } else if (key.startsWith('fields[') && key.endsWith(']')) {
          const fieldType = key.slice(7, -1);
          params.fields[fieldType] = value.split(',');
        }
      }

      // Legacy filter support
      if (Object.keys(params.filter).length === 0) {
        // Copy non-standard query params as filters
        for (const [key, value] of Object.entries(req.query)) {
          if (!['sort', 'page', 'pageSize', 'include', 'fields', 'view'].includes(key) &&
              !key.includes('[')) {
            params.filter[key] = value;
          }
        }
      }

      if (api.options.debug) {
        console.log('Parsed params:', JSON.stringify(params, null, 2));
      }
      
      return params;
    };

    // Build links for pagination
    const buildLinks = (req, params, meta) => {
      const links = {};
      const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
      
      // Build query string manually to handle bracket notation
      const buildQueryString = (pageNum) => {
        const parts = [];
        
        // Add all existing query params
        for (const [key, value] of Object.entries(req.query)) {
          if (key === 'page' && typeof value === 'object') {
            // Handle page object
            if (value.size !== undefined) {
              parts.push(`page[size]=${encodeURIComponent(value.size)}`);
            }
            if (pageNum !== undefined) {
              parts.push(`page[number]=${encodeURIComponent(pageNum)}`);
            } else if (value.number !== undefined) {
              parts.push(`page[number]=${encodeURIComponent(value.number)}`);
            }
          } else if (key === 'filter' && typeof value === 'object') {
            // Handle filter object
            for (const [filterKey, filterValue] of Object.entries(value)) {
              parts.push(`filter[${filterKey}]=${encodeURIComponent(filterValue)}`);
            }
          } else if (key === 'fields' && typeof value === 'object') {
            // Handle fields object
            for (const [fieldKey, fieldValue] of Object.entries(value)) {
              parts.push(`fields[${fieldKey}]=${encodeURIComponent(fieldValue)}`);
            }
          } else {
            // Other params
            parts.push(`${key}=${encodeURIComponent(value)}`);
          }
        }
        
        return parts.join('&');
      };

      // Self link - preserve current state
      links.self = `${baseUrl}?${buildQueryString()}`;

      if (meta.totalPages > 1) {
        const currentPage = meta.pageNumber;

        // First page
        links.first = `${baseUrl}?${buildQueryString(1)}`;

        // Last page
        links.last = `${baseUrl}?${buildQueryString(meta.totalPages)}`;

        // Previous page
        if (currentPage > 1) {
          links.prev = `${baseUrl}?${buildQueryString(currentPage - 1)}`;
        }

        // Next page
        if (currentPage < meta.totalPages) {
          links.next = `${baseUrl}?${buildQueryString(currentPage + 1)}`;
        }
      }

      return links;
    };

    // Helper to wrap responses with JSON:API metadata
    const wrapResponse = (data) => {
      let result = data;
      
      // Transform meta fields if configured
      if (options.jsonApiMetaFormat && result && result.meta) {
        const oldMeta = result.meta;
        
        // Check if it's pagination meta
        if (oldMeta.total !== undefined || oldMeta.pageSize !== undefined) {
          result = {
            ...result,
            meta: {
              page: {
                total: oldMeta.total,
                size: oldMeta.pageSize,
                number: oldMeta.pageNumber,
                totalPages: oldMeta.totalPages
              }
            }
          };
        }
      }
      
      // Add JSON:API version if configured
      if (options.jsonApiVersion) {
        // Don't wrap if already has jsonapi field
        if (result && typeof result === 'object' && !result.jsonapi) {
          result = {
            jsonapi: { version: options.jsonApiVersion },
            ...result
          };
        }
      }
      
      return result;
    };
    
    // Helper to build resource URLs
    const buildResourceUrl = (req, type, id = null, relationship = null) => {
      const baseUrl = `${req.protocol}://${req.get('host')}${basePath}`;
      let url = `${baseUrl}/${type}`;
      
      if (id) {
        url += `/${id}`;
      }
      
      if (relationship) {
        url += `/relationships/${relationship}`;
      }
      
      return url;
    };

    // Strict JSON:API mode validation
    if (options.strictJsonApi) {
      router.use((req, res, next) => {
        // Content-Type validation for strict mode
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const contentType = req.headers['content-type'];
          if (!contentType || !contentType.includes('application/vnd.api+json')) {
            const error = new ApiError(
              'Content-Type must be application/vnd.api+json in strict JSON:API mode',
              415,
              'UNSUPPORTED_MEDIA_TYPE'
            );
            return res.status(415).json(formatErrors(error));
          }
        }
        
        // Query parameter validation for strict mode
        if (req.method === 'GET') {
          const allowedParams = ['include', 'fields', 'sort', 'page', 'filter', 'view'];
          const unknownParams = [];
          
          for (const param of Object.keys(req.query)) {
            // Check top-level params
            if (!allowedParams.includes(param)) {
              // Check if it's a bracket notation param
              const bracketMatch = param.match(/^(filter|fields|page)\[/);
              if (!bracketMatch) {
                unknownParams.push(param);
              }
            }
          }
          
          if (unknownParams.length > 0) {
            const error = new BadRequestError(
              `Unknown query parameter(s): ${unknownParams.join(', ')}. Allowed parameters in strict JSON:API mode: ${allowedParams.join(', ')}`
            ).withContext({ 
              unknownParameters: unknownParams,
              allowedParameters: allowedParams,
              parameter: unknownParams[0]  // For source.parameter in JSON:API error
            });
            return res.status(400).json(formatErrors(error));
          }
        }
        
        next();
      });
    }

    // Version-aware routing
    let routePrefix = '';
    if (api.options.name && api.options.version) {
      // Add version to route prefix
      routePrefix = `/${api.options.version}`;
      
      // Add version info to all responses
      router.use((req, res, next) => {
        res.set('API-Version', api.options.version);
        next();
      });
    }

    /**
     * Hook to handle affected records and build compound documents
     * 
     * After insert/update/delete operations, this hook checks for:
     * 1. context.affectedRecords - Direct list of records to include
     * 2. context.refetchRelated - Field names with refs to auto-fetch
     * 3. context.calculateAffected - Function to determine affected records
     * 
     * Example usage in your resource hooks:
     * 
     * api.hook('afterInsert', async (context) => {
     *   if (context.options.type === 'reviews') {
     *     // Option 1: Specify exact records
     *     context.affectedRecords = [
     *       { type: 'users', id: context.data.userId },
     *       { type: 'products', id: context.data.productId }
     *     ];
     *     
     *     // Option 2: Use schema refs (if userId has refs: { resource: 'users' })
     *     context.refetchRelated = ['userId', 'productId'];
     *     
     *     // Option 3: Calculate dynamically after DB write
     *     context.calculateAffected = async (review) => {
     *       const stats = await db.query('SELECT ...', [review.userId]);
     *       return [{ type: 'users', id: review.userId }];
     *     };
     *   }
     * });
     */
    api.hook('beforeSend', async (context) => {
      // Only process for HTTP responses with results
      if (!context.isHttp || !context.result) return;
      
      // Handle joined data for JSON:API relationships
      if (context.joinFields && Object.keys(context.joinFields).length > 0) {
        await processJoinedDataForJsonApi(context);
      }
      
      // Resolve all affected records
      const affectedRecords = await api.resolveAffectedRecords(context);
      
      if (affectedRecords.length > 0) {
        // Fetch all related records
        const includedRecords = await api.fetchRelatedRecords(affectedRecords);
        
        if (includedRecords.length > 0) {
          // Add to response as 'included' per JSON:API spec
          context.result.included = context.result.included || [];
          context.result.included.push(...includedRecords);
        }
      }
    }, 80); // High priority to run before response is sent
    
    // Transform API response to JSON:API format with relationships
    const transformToJsonApi = (result, type) => {
      if (!result || !result.data) return result;
      
      const schema = api.schemas?.get(type);
      if (!schema) return result;
      
      const processRecord = (record) => {
        if (!record) return record;
        
        // Don't process if record already has correct structure
        if (record.relationships) return record;
        
        // Initialize relationships object
        const relationships = {};
        
        // Check each field for refs to create relationships
        for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
          if (!fieldDef.refs) continue;
          
          // Check if this field has a value in attributes
          const fieldValue = record.attributes?.[fieldName] || record[fieldName];
          if (fieldValue === undefined || fieldValue === null) continue;
          
          // Determine relationship name (remove 'Id' suffix if present)
          const relationshipName = fieldName.endsWith('Id') 
            ? fieldName.slice(0, -2) 
            : fieldName;
          
          // Check if joined data exists
          let joinedData = null;
          let idValue = fieldValue;
          
          // If field value is an object, it's joined data (no preserveId)
          if (typeof fieldValue === 'object' && fieldValue !== null) {
            // Check if this is actually joined data with an id property
            if (fieldValue.id !== undefined) {
              joinedData = fieldValue;
              idValue = fieldValue.id;
              // Replace the object with just the ID in attributes
              if (record.attributes) {
                record.attributes[fieldName] = idValue;
              } else {
                record[fieldName] = idValue;
              }
            }
          }
          
          // Check for joined data in separate field (preserveId case)
          const attrs = record.attributes || record;
          if (attrs[relationshipName] && typeof attrs[relationshipName] === 'object') {
            joinedData = attrs[relationshipName];
            // Only remove from attributes if preserveId is false
            // Default preserveId to true if not explicitly set
            const preserveId = fieldDef.refs?.join?.preserveId !== false;
            if (!preserveId) {
              delete attrs[relationshipName]; // Remove from attributes
            }
          }
          
          // Also check for alternate field names (e.g., 'author' for 'authorId')
          const altFieldName = fieldDef.refs?.join?.resourceField;
          if (altFieldName && attrs[altFieldName] && typeof attrs[altFieldName] === 'object') {
            joinedData = attrs[altFieldName];
            // Only remove from attributes if preserveId is false
            // Default preserveId to true if not explicitly set
            const preserveId = fieldDef.refs?.join?.preserveId !== false;
            if (!preserveId) {
              delete attrs[altFieldName]; // Remove from attributes
            }
          }
          
          // Create relationship entry
          relationships[relationshipName] = {
            data: {
              type: fieldDef.refs.resource,
              id: String(idValue)
            }
          };
          
          // If we have joined data, add to included
          if (joinedData) {
            // Initialize included array if needed
            if (!result.included) {
              result.included = [];
            }
            const existingIndex = result.included.findIndex(
              item => item.type === fieldDef.refs.resource && item.id === String(idValue)
            );
            
            if (existingIndex === -1) {
              // Format joined data for included section
              const includedItem = {
                type: fieldDef.refs.resource,
                id: String(idValue),
                attributes: {}
              };
              
              // Copy non-id fields to attributes
              for (const [key, value] of Object.entries(joinedData)) {
                if (key !== 'id' && key !== 'type') {
                  includedItem.attributes[key] = value;
                }
              }
              
              result.included.push(includedItem);
            }
          }
        }
        
        // Add relationships to record if any exist
        if (Object.keys(relationships).length > 0) {
          record.relationships = relationships;
        }
        
        return record;
      };
      
      // Process single record or array
      if (Array.isArray(result.data)) {
        result.data = result.data.map(processRecord);
      } else {
        result.data = processRecord(result.data);
      }
      
      return result;
    };
    
    // Helper function to add links to a response
    const addLinks = (result, req, type) => {
      if (!options.includeLinks || !result) return result;
      
      // Add links to single resource
      if (result.data && !Array.isArray(result.data)) {
        const resource = result.data;
        if (resource.id) {
          resource.links = {
            self: buildResourceUrl(req, type, resource.id)
          };
          
          // Add relationship links
          if (resource.relationships) {
            for (const [relName, relData] of Object.entries(resource.relationships)) {
              if (!relData.links) {
                relData.links = {
                  self: buildResourceUrl(req, type, resource.id, relName),
                  related: `${buildResourceUrl(req, type, resource.id)}/${relName}`
                };
              }
            }
          }
          
          // Add top-level self link for single resource responses
          result.links = result.links || {};
          result.links.self = buildResourceUrl(req, type, resource.id);
        }
      }
      
      // Add links to collection resources
      if (result.data && Array.isArray(result.data)) {
        for (const resource of result.data) {
          if (resource.id) {
            resource.links = {
              self: buildResourceUrl(req, type, resource.id)
            };
            
            // Add relationship links
            if (resource.relationships) {
              for (const [relName, relData] of Object.entries(resource.relationships)) {
                if (!relData.links) {
                  relData.links = {
                    self: buildResourceUrl(req, type, resource.id, relName),
                    related: `${buildResourceUrl(req, type, resource.id)}/${relName}`
                  };
                }
              }
            }
          }
        }
      }
      
      // Add links to included resources
      if (result.included && Array.isArray(result.included)) {
        for (const resource of result.included) {
          if (resource.id && resource.type) {
            resource.links = {
              self: buildResourceUrl(req, resource.type, resource.id)
            };
          }
        }
      }
      
      return result;
    };
    
    // Implement batch method if not present
    if (!api.batch) {
      api.batch = async (operations, options = {}) => {
        const results = [];
        let successful = 0;
        let failed = 0;
        
        for (const op of operations) {
          try {
            let result;
            const opOptions = { ...options, ...op.options };
            
            switch (op.method) {
              case 'get':
                result = await api.get(op.id, opOptions);
                break;
              case 'query':
                result = await api.query(op.params || {}, opOptions);
                break;
              case 'insert':
              case 'create':
                result = await api.insert(op.data, opOptions);
                break;
              case 'update':
                result = await api.update(op.id, op.data, opOptions);
                break;
              case 'delete':
                result = await api.delete(op.id, opOptions);
                break;
              default:
                throw new BadRequestError(`Unknown batch operation method: ${op.method}`);
            }
            
            results.push({ 
              success: true, 
              data: result 
            });
            successful++;
          } catch (error) {
            results.push({ 
              success: false, 
              error: normalizeError(error).toJSON() 
            });
            failed++;
          }
        }
        
        return { results, successful, failed };
      };
    }
    
    // Routes
    
    // Install discovery routes if available (must be before /:type routes)
    if (api._installDiscoveryRoutes) {
      api._installDiscoveryRoutes();
    }
    
    // Batch operations endpoint (must be before /:type routes)
    router.post(`/batch`, async (req, res) => {
      try {
        const { operations, options: batchOptions = {} } = req.body;
        const user = getUserFromRequest(req);
        
        if (!Array.isArray(operations)) {
          throw new BadRequestError('Operations must be an array');
        }
        
        // Add user context to all operations
        const opsWithUser = operations.map(op => ({
          ...op,
          options: { ...op.options, user, type: op.type }
        }));
        
        const results = await api.batch(opsWithUser, batchOptions);
        
        // Return appropriate status based on results
        const status = results.failed > 0 ? 207 : 200; // 207 Multi-Status
        
        res.status(status).json(wrapResponse({
          data: results.results,
          meta: {
            successful: results.successful,
            failed: results.failed,
            total: results.results.length
          }
        }));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });
    
    // GET collection
    router.get(`${routePrefix}/:type`, async (req, res) => {
      try {
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const params = parseQueryParams(req);
        const user = getUserFromRequest(req);
        const result = await api.query(params, {
          type: req.params.type,
          user,
          req, // Pass request for link generation
          ...options.typeOptions?.[req.params.type]
        });

        // Add links
        if (result.meta) {
          result.links = buildLinks(req, params, result.meta);
        }

        res.json(wrapResponse(addLinks(transformToJsonApi(result, req.params.type), req, req.params.type)));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // GET single resource
    router.get(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const params = parseQueryParams(req);
        const user = getUserFromRequest(req);
        const result = await api.get(req.params.id, {
          type: req.params.type,
          user,
          isHttp: true,
          view: params.view,
          include: params.include,
          req, // Pass request for link generation
          ...options.typeOptions?.[req.params.type]
        });

        if (!result.data) {
          throw new NotFoundError(req.params.type, req.params.id);
        }

        res.json(wrapResponse(addLinks(transformToJsonApi(result, req.params.type), req, req.params.type)));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // GET relationship endpoint
    router.get(`${routePrefix}/:type/:id/relationships/:field`, async (req, res) => {
      try {
        const { type, id, field } = req.params;
        
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(type)) {
          throw new NotFoundError(`Resource type '${type}' not found`);
        }
        
        const schema = api.schemas.get(type);
        const fieldDef = schema.structure[field];
        
        if (!fieldDef) {
          throw new NotFoundError(`Relationship '${field}' not found on resource '${type}'`);
        }
        
        // Check if relationship endpoints are enabled
        const provideUrl = fieldDef.provideUrl || fieldDef.refs?.provideUrl;
        if (!provideUrl) {
          throw new BadRequestError(`Relationship endpoint not enabled for '${field}'`);
        }
        
        const user = getUserFromRequest(req);
        
        // Check field permissions
        if (fieldDef.permissions?.read !== undefined) {
          const hasPermission = api.checkFieldPermission(user, fieldDef.permissions.read);
          if (!hasPermission) {
            throw new NotFoundError(`Relationship '${field}' not found on resource '${type}'`);
          }
        }
        
        // Get the parent resource
        const parent = await api.get(id, { type, user });
        if (!parent.data) {
          throw new NotFoundError(type, id);
        }
        
        // Handle to-one relationships
        if (fieldDef.refs) {
          const relatedId = parent.data.attributes[field];
          const response = {
            data: relatedId ? {
              type: fieldDef.refs.resource,
              id: String(relatedId)
            } : null,
            links: {
              self: buildResourceUrl(req, type, id, 'relationships', field),
              related: buildResourceUrl(req, type, id, field)
            }
          };
          
          res.json(wrapResponse(response));
          return;
        }
        
        // Handle to-many relationships
        if (fieldDef.type === 'list' && fieldDef.foreignResource) {
          const params = parseQueryParams(req);
          
          // Force filter by parent ID
          const filter = {
            ...params.filter,
            [fieldDef.foreignKey]: id
          };
          
          // Apply default filter if any
          if (fieldDef.defaultFilter) {
            Object.assign(filter, fieldDef.defaultFilter);
          }
          
          // Query related resources
          const result = await api.query({
            ...params,
            filter,
            sort: params.sort || fieldDef.defaultSort,
            page: params.page || (fieldDef.limit ? { size: fieldDef.limit } : undefined)
          }, {
            type: fieldDef.foreignResource,
            user,
            isHttp: true
          });
          
          // Return just the linkage data
          const response = {
            data: result.data.map(item => ({
              type: item.type,
              id: item.id
            })),
            links: {
              self: buildResourceUrl(req, type, id, 'relationships', field),
              related: buildResourceUrl(req, type, id, field)
            },
            meta: result.meta
          };
          
          res.json(wrapResponse(response));
          return;
        }
        
        throw new BadRequestError(`Invalid relationship type for '${field}'`);
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // GET related resource endpoint
    router.get(`${routePrefix}/:type/:id/:field`, async (req, res) => {
      try {
        const { type, id, field } = req.params;
        
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(type)) {
          throw new NotFoundError(`Resource type '${type}' not found`);
        }
        
        const schema = api.schemas.get(type);
        const fieldDef = schema.structure[field];
        
        if (!fieldDef) {
          throw new NotFoundError(`Relationship '${field}' not found on resource '${type}'`);
        }
        
        // Check if relationship endpoints are enabled
        const provideUrl = fieldDef.provideUrl || fieldDef.refs?.provideUrl;
        if (!provideUrl) {
          throw new BadRequestError(`Relationship endpoint not enabled for '${field}'`);
        }
        
        const user = getUserFromRequest(req);
        
        // Check field permissions
        if (fieldDef.permissions?.read !== undefined) {
          const hasPermission = api.checkFieldPermission(user, fieldDef.permissions.read);
          if (!hasPermission) {
            throw new NotFoundError(`Relationship '${field}' not found on resource '${type}'`);
          }
        }
        
        // Get the parent resource
        const parent = await api.get(id, { type, user });
        if (!parent.data) {
          throw new NotFoundError(type, id);
        }
        
        // Handle to-one relationships
        if (fieldDef.refs) {
          const relatedId = parent.data.attributes[field];
          if (!relatedId) {
            res.json(wrapResponse({ data: null }));
            return;
          }
          
          const result = await api.get(relatedId, {
            type: fieldDef.refs.resource,
            user,
            isHttp: true,
            req
          });
          
          res.json(wrapResponse(addLinks(result, req, fieldDef.refs.resource)));
          return;
        }
        
        // Handle to-many relationships
        if (fieldDef.type === 'list' && fieldDef.foreignResource) {
          const params = parseQueryParams(req);
          
          // Force filter by parent ID
          const filter = {
            ...params.filter,
            [fieldDef.foreignKey]: id
          };
          
          // Apply default filter if any
          if (fieldDef.defaultFilter) {
            Object.assign(filter, fieldDef.defaultFilter);
          }
          
          // Query related resources with full data
          const result = await api.query({
            ...params,
            filter,
            sort: params.sort || fieldDef.defaultSort,
            page: params.page || (fieldDef.limit ? { size: fieldDef.limit } : undefined)
          }, {
            type: fieldDef.foreignResource,
            user,
            isHttp: true,
            req
          });
          
          res.json(wrapResponse(addLinks(result, req, fieldDef.foreignResource)));
          return;
        }
        
        throw new BadRequestError(`Invalid relationship type for '${field}'`);
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // PATCH relationship endpoint (to-one relationships)
    router.patch(`${routePrefix}/:type/:id/relationships/:field`, async (req, res) => {
      try {
        const { type, id, field } = req.params;
        
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(type)) {
          throw new NotFoundError(`Resource type '${type}' not found`);
        }
        
        const schema = api.schemas.get(type);
        const fieldDef = schema.structure[field];
        
        if (!fieldDef || !fieldDef.refs) {
          throw new BadRequestError(`Cannot update relationship '${field}' - not a to-one relationship`);
        }
        
        // Check if relationship endpoints are enabled
        const provideUrl = fieldDef.provideUrl || fieldDef.refs?.provideUrl;
        if (!provideUrl) {
          throw new BadRequestError(`Relationship endpoint not enabled for '${field}'`);
        }
        
        const user = getUserFromRequest(req);
        
        // Validate request body
        if (!req.body || !('data' in req.body)) {
          throw new BadRequestError('Request must include "data" member');
        }
        
        const newRelationship = req.body.data;
        let newId = null;
        
        if (newRelationship !== null) {
          if (!newRelationship.type || !newRelationship.id) {
            throw new BadRequestError('Relationship data must include "type" and "id"');
          }
          
          if (newRelationship.type !== fieldDef.refs.resource) {
            throw new BadRequestError(`Invalid type '${newRelationship.type}' - expected '${fieldDef.refs.resource}'`);
          }
          
          newId = newRelationship.id;
        }
        
        // Update the parent resource
        const updateData = { [field]: newId };
        const result = await api.update(id, updateData, { type, user });
        
        if (!result.data) {
          throw new NotFoundError(type, id);
        }
        
        // Return the updated relationship
        const response = {
          data: newId ? {
            type: fieldDef.refs.resource,
            id: String(newId)
          } : null
        };
        
        res.json(wrapResponse(response));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // POST relationship endpoint (to-many relationships)
    router.post(`${routePrefix}/:type/:id/relationships/:field`, async (req, res) => {
      try {
        const { type, id, field } = req.params;
        
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(type)) {
          throw new NotFoundError(`Resource type '${type}' not found`);
        }
        
        const schema = api.schemas.get(type);
        const fieldDef = schema.structure[field];
        
        if (!fieldDef || fieldDef.type !== 'list' || !fieldDef.foreignResource) {
          throw new BadRequestError(`Cannot add to relationship '${field}' - not a to-many relationship`);
        }
        
        // Check if relationship endpoints are enabled
        const provideUrl = fieldDef.provideUrl || fieldDef.refs?.provideUrl;
        if (!provideUrl) {
          throw new BadRequestError(`Relationship endpoint not enabled for '${field}'`);
        }
        
        const user = getUserFromRequest(req);
        
        // Validate request body
        if (!req.body || !req.body.data || !Array.isArray(req.body.data)) {
          throw new BadRequestError('Request must include "data" member as an array');
        }
        
        // Verify parent exists
        const parent = await api.get(id, { type, user });
        if (!parent.data) {
          throw new NotFoundError(type, id);
        }
        
        // Add relationships by updating the foreign resources
        const results = [];
        for (const item of req.body.data) {
          if (!item.type || !item.id) {
            throw new BadRequestError('Each relationship item must include "type" and "id"');
          }
          
          if (item.type !== fieldDef.foreignResource) {
            throw new BadRequestError(`Invalid type '${item.type}' - expected '${fieldDef.foreignResource}'`);
          }
          
          // Update the foreign resource to point to this parent
          const updateData = { [fieldDef.foreignKey]: id };
          await api.update(item.id, updateData, { 
            type: fieldDef.foreignResource, 
            user 
          });
          
          results.push(item);
        }
        
        // Query the updated relationships
        const filter = {
          [fieldDef.foreignKey]: id
        };
        
        // Apply default filter if any
        if (fieldDef.defaultFilter) {
          Object.assign(filter, fieldDef.defaultFilter);
        }
        
        const updatedRelationships = await api.query({
          filter,
          sort: fieldDef.defaultSort
        }, {
          type: fieldDef.foreignResource,
          user
        });
        
        // Return the updated linkage data
        const response = {
          data: updatedRelationships.data.map(item => ({
            type: item.type,
            id: item.id
          })),
          links: {
            self: buildResourceUrl(req, type, id, 'relationships', field),
            related: buildResourceUrl(req, type, id, field)
          }
        };
        
        res.json(wrapResponse(response));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // DELETE relationship endpoint (to-many relationships)
    router.delete(`${routePrefix}/:type/:id/relationships/:field`, async (req, res) => {
      try {
        const { type, id, field } = req.params;
        
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(type)) {
          throw new NotFoundError(`Resource type '${type}' not found`);
        }
        
        const schema = api.schemas.get(type);
        const fieldDef = schema.structure[field];
        
        if (!fieldDef || fieldDef.type !== 'list' || !fieldDef.foreignResource) {
          throw new BadRequestError(`Cannot remove from relationship '${field}' - not a to-many relationship`);
        }
        
        // Check if relationship endpoints are enabled
        const provideUrl = fieldDef.provideUrl || fieldDef.refs?.provideUrl;
        if (!provideUrl) {
          throw new BadRequestError(`Relationship endpoint not enabled for '${field}'`);
        }
        
        const user = getUserFromRequest(req);
        
        // Validate request body
        if (!req.body || !req.body.data || !Array.isArray(req.body.data)) {
          throw new BadRequestError('Request must include "data" member as an array');
        }
        
        // Verify parent exists
        const parent = await api.get(id, { type, user });
        if (!parent.data) {
          throw new NotFoundError(type, id);
        }
        
        // Remove relationships by nullifying the foreign key
        for (const item of req.body.data) {
          if (!item.type || !item.id) {
            throw new BadRequestError('Each relationship item must include "type" and "id"');
          }
          
          if (item.type !== fieldDef.foreignResource) {
            throw new BadRequestError(`Invalid type '${item.type}' - expected '${fieldDef.foreignResource}'`);
          }
          
          // Check current relationship
          const currentResource = await api.get(item.id, {
            type: fieldDef.foreignResource,
            user
          });
          
          if (currentResource.data && 
              String(currentResource.data.attributes[fieldDef.foreignKey]) === String(id)) {
            // Nullify the foreign key
            const updateData = { [fieldDef.foreignKey]: null };
            await api.update(item.id, updateData, { 
              type: fieldDef.foreignResource, 
              user 
            });
          }
        }
        
        // Query the updated relationships
        const filter = {
          [fieldDef.foreignKey]: id
        };
        
        // Apply default filter if any
        if (fieldDef.defaultFilter) {
          Object.assign(filter, fieldDef.defaultFilter);
        }
        
        const updatedRelationships = await api.query({
          filter,
          sort: fieldDef.defaultSort
        }, {
          type: fieldDef.foreignResource,
          user
        });
        
        // Return the updated linkage data
        const response = {
          data: updatedRelationships.data.map(item => ({
            type: item.type,
            id: item.id
          })),
          links: {
            self: buildResourceUrl(req, type, id, 'relationships', field),
            related: buildResourceUrl(req, type, id, field)
          }
        };
        
        res.json(wrapResponse(response));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // POST new resource
    router.post(`${routePrefix}/:type`, async (req, res) => {
      try {
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const data = parseJsonApiBody(req.body, false); // Don't include id for POST
        const user = getUserFromRequest(req);
        const result = await api.insert(data, {
          type: req.params.type,
          user,
          isHttp: true,
          req, // Pass request for link generation
          ...options.typeOptions?.[req.params.type]
        });

        res.status(201)
           .location(`${basePath}${routePrefix}/${req.params.type}/${result.data.id}`)
           .json(wrapResponse(result));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // PUT full replacement
    router.put(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const data = parseJsonApiBody(req.body);
        const user = getUserFromRequest(req);
        const result = await api.update(req.params.id, data, {
          type: req.params.type,
          user,
          fullRecord: true,  // Validate as complete record for PUT
          isHttp: true,
          req, // Pass request for link generation
          ...options.typeOptions?.[req.params.type]
        });

        if (!result.data) {
          throw new NotFoundError(req.params.type, req.params.id);
        }

        res.json(wrapResponse(addLinks(transformToJsonApi(result, req.params.type), req, req.params.type)));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // PATCH partial update
    router.patch(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const data = parseJsonApiBody(req.body);
        const user = getUserFromRequest(req);
        const result = await api.update(req.params.id, data, {
          type: req.params.type,
          user,
          isHttp: true,
          req, // Pass request for link generation
          ...options.typeOptions?.[req.params.type]
        });

        if (!result.data) {
          throw new NotFoundError(req.params.type, req.params.id);
        }

        res.json(wrapResponse(addLinks(transformToJsonApi(result, req.params.type), req, req.params.type)));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // DELETE resource
    router.delete(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        // Check if resource type exists
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const user = getUserFromRequest(req);
        await api.delete(req.params.id, {
          type: req.params.type,
          user,
          isHttp: true,
          req, // Pass request for link generation
          ...options.typeOptions?.[req.params.type]
        });

        res.status(204).send();
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // Bulk create endpoint
    router.post(`${routePrefix}/:type/bulk`, async (req, res) => {
      try {
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const user = getUserFromRequest(req);
        const { data, options = {} } = req.body;
        
        if (!Array.isArray(data)) {
          throw new BadRequestError('Data must be an array for bulk operations');
        }
        
        // Extract attributes from JSON:API format
        const items = data.map(item => {
          if (item.attributes) {
            return item.attributes;
          }
          return item;
        });
        
        const results = await api.resources[req.params.type].bulk.create(items, {
          ...options,
          user
        });
        
        // Format response
        const formatted = results.map(item => ({
          type: req.params.type,
          id: String(item.id || item[api.options.idProperty]),
          attributes: Object.keys(item).reduce((attrs, key) => {
            if (key !== 'id' && key !== api.options.idProperty) {
              attrs[key] = item[key];
            }
            return attrs;
          }, {})
        }));
        
        res.status(201).json(wrapResponse({ data: formatted }));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // Bulk update endpoint
    router.patch(`${routePrefix}/:type/bulk`, async (req, res) => {
      try {
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const user = getUserFromRequest(req);
        const { data, filter, options = {} } = req.body;
        
        let result;
        
        if (filter) {
          // Update by filter
          const updates = data?.attributes || data || {};
          result = await api.resources[req.params.type].bulk.update({
            filter,
            data: updates
          }, { ...options, user });
          
          res.json(wrapResponse({ 
            data: { type: 'bulk-update', id: 'filter' },
            meta: { updated: result.updated }
          }));
        } else {
          // Update specific records
          if (!Array.isArray(data)) {
            throw new BadRequestError('Data must be an array for bulk updates');
          }
          
          const updates = data.map(item => ({
            id: item.id,
            data: item.attributes || item
          }));
          
          const results = await api.resources[req.params.type].bulk.update(updates, {
            ...options,
            user
          });
          
          // Format response
          const formatted = results.map(item => ({
            type: req.params.type,
            id: String(item.id || item[api.options.idProperty]),
            attributes: Object.keys(item).reduce((attrs, key) => {
              if (key !== 'id' && key !== api.options.idProperty) {
                attrs[key] = item[key];
              }
              return attrs;
            }, {})
          }));
          
          res.json(wrapResponse({ data: formatted }));
        }
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // Bulk delete endpoint
    router.delete(`${routePrefix}/:type/bulk`, async (req, res) => {
      try {
        if (!api.schemas || !api.schemas.has(req.params.type)) {
          throw new NotFoundError(`Resource type '${req.params.type}' not found`);
        }
        
        const user = getUserFromRequest(req);
        const { data, filter, options = {} } = req.body;
        
        let result;
        
        if (filter) {
          // Delete by filter
          result = await api.resources[req.params.type].bulk.delete({
            filter
          }, { ...options, user });
        } else if (data?.ids) {
          // Delete by IDs
          result = await api.resources[req.params.type].bulk.delete(data.ids, {
            ...options,
            user
          });
        } else {
          throw new BadRequestError('Must provide either filter or data.ids for bulk delete');
        }
        
        res.json(wrapResponse({ 
          data: { type: 'bulk-delete', id: 'result' },
          meta: { deleted: result.deleted || result.length }
        }));
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // CORS middleware
    if (options.cors !== false) {
      router.use((req, res, next) => {
        // Set CORS headers
        const origin = req.headers.origin || '*';
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        
        // Handle preflight
        if (req.method === 'OPTIONS') {
          res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
          res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization');
          res.header('Access-Control-Max-Age', '86400'); // 24 hours
          return res.status(204).end();
        }
        
        next();
      });
    }
    
    // OPTIONS for CORS (fallback if middleware disabled)
    router.options('*', (req, res) => {
      if (options.cors === false) {
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      res.status(204).end();
    });
    
    // Error handler for JSON parsing errors (must be after all routes)
    router.use((err, req, res, next) => {
      // Handle body-parser errors
      if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        const error = new BadRequestError(
          'Invalid JSON in request body',
          'INVALID_JSON'
        ).withContext({ 
          detail: err.message,
          position: err.body ? err.body.substring(0, 50) + '...' : undefined
        });
        return res.status(400).json(formatErrors(error));
      }
      
      // Pass other errors to next handler
      next(err);
    });

    // Mount router on Express app if provided
    if (options.app) {
      options.app.use(basePath, router);
    }

    // Add method to manually mount router
    api.mount = (app, path = basePath) => {
      app.use(path, router);
      return api;
    };

    // Add middleware support
    api.useMiddleware = (middleware) => {
      router.use(middleware);
      return api;
    };

    // Add route-specific middleware
    api.useRouteMiddleware = (method, path, ...middlewares) => {
      // Store middleware to be applied when routes are defined
      if (!api._routeMiddlewares) {
        api._routeMiddlewares = [];
      }
      api._routeMiddlewares.push({ method, path, middlewares });
      return api;
    };
    
    /**
     * Process joined data for JSON:API compliance
     * Moves joined objects to relationships and included sections
     */
    async function processJoinedDataForJsonApi(context) {
      const schema = api.schemas?.get(context.options.type);
      if (!schema) return;
      
      const records = context.method === 'query' ? context.results : [context.result];
      const included = [];
      const seen = new Set();
      
      for (const record of records) {
        if (!record) continue;
        
        record.relationships = record.relationships || {};
        
        for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
          if (!fieldDef.refs?.join) continue;
          
          const joinMeta = context.joinFields[fieldName];
          if (!joinMeta) continue;
          
          const resourceField = joinMeta.resourceField;
          const preserveId = joinMeta.preserveId;
          
          // Determine where the joined data is stored
          let joinedData = null;
          let relationshipName = null;
          
          if (resourceField && record[resourceField]) {
            // Data is in separate field
            joinedData = record[resourceField];
            relationshipName = resourceField;
            delete record[resourceField]; // Remove from attributes
          } else if (!preserveId && typeof record[fieldName] === 'object' && record[fieldName]) {
            // Data replaced the ID field
            joinedData = record[fieldName];
            relationshipName = fieldName.replace(/Id$/, '');
            // Replace with just the ID in attributes
            record[fieldName] = joinedData.id || joinedData[api.options.idProperty];
          } else if (preserveId) {
            // Data is in derived field (fieldName without 'Id')
            const derivedField = fieldName.replace(/Id$/, '');
            if (record[derivedField]) {
              joinedData = record[derivedField];
              relationshipName = derivedField;
              // When preserveId is true, keep the joined data in attributes
              // Only delete if not preserveId
            }
          }
          
          if (joinedData && relationshipName && !preserveId) {
            // Only process as relationship if not preserveId
            // When preserveId is true, keep data in attributes for backward compatibility
            record.relationships[relationshipName] = {
              data: {
                type: fieldDef.refs.resource,
                id: String(joinedData.id || joinedData[api.options.idProperty])
              }
            };
            
            // Add to included (avoid duplicates)
            const resourceId = joinedData.id || joinedData[api.options.idProperty];
            const key = `${fieldDef.refs.resource}:${resourceId}`;
            
            if (!seen.has(key)) {
              seen.add(key);
              
              // Format for JSON:API
              const includedResource = {
                type: fieldDef.refs.resource,
                id: String(resourceId),
                attributes: {}
              };
              
              // Copy all fields except id to attributes
              for (const [key, value] of Object.entries(joinedData)) {
                if (key !== 'id' && key !== api.options.idProperty) {
                  includedResource.attributes[key] = value;
                }
              }
              
              included.push(includedResource);
            }
          }
        }
        
        // Remove empty relationships object
        if (Object.keys(record.relationships).length === 0) {
          delete record.relationships;
        }
      }
      
      // Add included resources to response
      if (included.length > 0) {
        if (context.method === 'query') {
          context.result.included = context.result.included || [];
          context.result.included.push(...included);
        } else {
          context.result.included = context.result.included || [];
          context.result.included.push(...included);
        }
      }
    }
  }
};