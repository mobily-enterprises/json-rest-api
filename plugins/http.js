import express from 'express';
import { NotFoundError, BadRequestError, formatErrorResponse, normalizeError } from '../lib/errors.js';

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

    // Middleware for JSON parsing
    router.use(express.json({
      type: ['application/json', 'application/vnd.api+json']
    }));

    // Base path for all routes
    const basePath = options.basePath || '/api';
    
    // User extraction function
    const getUserFromRequest = options.getUserFromRequest || ((req) => req.user);

    // Helper to parse JSON:API request body
    const parseJsonApiBody = (body) => {
      if (body.data) {
        if (body.data.attributes) {
          // JSON:API format
          return { ...body.data.attributes, id: body.data.id };
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
        page: {
          size: req.query['page[size]'] || req.query.pageSize,
          number: req.query['page[number]'] || req.query.page
        },
        include: req.query.include,
        fields: {},
        view: req.query.view
      };
      
      if (api.options.debug) {
        console.log('Raw query:', req.query);
      }

      
      // Parse filters
      // Express already parses filter[field]=value into { filter: { field: value } }
      if (req.query.filter && typeof req.query.filter === 'object') {
        for (const [key, value] of Object.entries(req.query.filter)) {
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
      
      // Parse fields
      if (req.query.fields && typeof req.query.fields === 'object') {
        for (const [type, fields] of Object.entries(req.query.fields)) {
          params.fields[type] = typeof fields === 'string' ? fields.split(',') : fields;
        }
      }
      
      // Legacy support for filter[field] syntax if Express doesn't parse it
      for (const [key, value] of Object.entries(req.query)) {
        if (key.startsWith('filter[') && key.endsWith(']')) {
          const filterKey = key.slice(7, -1);
          // Convert string booleans to actual booleans
          if (value === 'true') {
            params.filter[filterKey] = true;
          } else if (value === 'false') {
            params.filter[filterKey] = false;
          } else {
            params.filter[filterKey] = value;
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
          if (!['sort', 'page', 'pageSize', 'include', 'fields', 'joins', 'excludeJoins', 'view'].includes(key) &&
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
      const queryParams = new URLSearchParams(req.query);

      // Self link
      links.self = `${baseUrl}?${queryParams}`;

      if (meta.totalPages > 1) {
        const currentPage = meta.pageNumber;

        // First page
        queryParams.set('page[number]', '1');
        links.first = `${baseUrl}?${queryParams}`;

        // Last page
        queryParams.set('page[number]', String(meta.totalPages));
        links.last = `${baseUrl}?${queryParams}`;

        // Previous page
        if (currentPage > 1) {
          queryParams.set('page[number]', String(currentPage - 1));
          links.prev = `${baseUrl}?${queryParams}`;
        }

        // Next page
        if (currentPage < meta.totalPages) {
          queryParams.set('page[number]', String(currentPage + 1));
          links.next = `${baseUrl}?${queryParams}`;
        }
      }

      return links;
    };

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
    
    // Routes
    
    // GET collection
    router.get(`${routePrefix}/:type`, async (req, res) => {
      try {
        const params = parseQueryParams(req);
        const user = getUserFromRequest(req);
        const result = await api.query(params, {
          type: req.params.type,
          user,
          ...options.typeOptions?.[req.params.type]
        });

        // Add links
        if (result.meta) {
          result.links = buildLinks(req, params, result.meta);
        }

        res.json(result);
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // GET single resource
    router.get(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        const params = parseQueryParams(req);
        const user = getUserFromRequest(req);
        const result = await api.get(req.params.id, {
          type: req.params.type,
          user,
          isHttp: true,
          view: params.view,
          ...options.typeOptions?.[req.params.type]
        });

        if (!result.data) {
          throw new NotFoundError(req.params.type, req.params.id);
        }

        res.json(result);
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // POST new resource
    router.post(`${routePrefix}/:type`, async (req, res) => {
      try {
        const data = parseJsonApiBody(req.body);
        const user = getUserFromRequest(req);
        const result = await api.insert(data, {
          type: req.params.type,
          user,
          isHttp: true,
          ...options.typeOptions?.[req.params.type]
        });

        res.status(201)
           .location(`${basePath}${routePrefix}/${req.params.type}/${result.data.id}`)
           .json(result);
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // PUT full replacement
    router.put(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        const data = parseJsonApiBody(req.body);
        const user = getUserFromRequest(req);
        const result = await api.update(req.params.id, data, {
          type: req.params.type,
          user,
          fullRecord: true,  // Validate as complete record for PUT
          isHttp: true,
          ...options.typeOptions?.[req.params.type]
        });

        if (!result.data) {
          throw new NotFoundError(req.params.type, req.params.id);
        }

        res.json(result);
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // PATCH partial update
    router.patch(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        const data = parseJsonApiBody(req.body);
        const user = getUserFromRequest(req);
        const result = await api.update(req.params.id, data, {
          type: req.params.type,
          user,
          isHttp: true,
          ...options.typeOptions?.[req.params.type]
        });

        if (!result.data) {
          throw new NotFoundError(req.params.type, req.params.id);
        }

        res.json(result);
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // DELETE resource
    router.delete(`${routePrefix}/:type/:id`, async (req, res) => {
      try {
        const user = getUserFromRequest(req);
        await api.delete(req.params.id, {
          type: req.params.type,
          user,
          isHttp: true,
          ...options.typeOptions?.[req.params.type]
        });

        res.status(204).end();
      } catch (error) {
        const apiError = normalizeError(error);
        res.status(apiError.status).json(formatErrors(error));
      }
    });

    // OPTIONS for CORS
    router.options('*', (req, res) => {
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).end();
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
              delete record[derivedField]; // Remove from attributes
            }
          }
          
          if (joinedData && relationshipName) {
            // Add to relationships
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