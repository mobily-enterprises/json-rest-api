import { checkPeerDependency } from '../../lib/check-peer-dependency.js';

/**
 * Express Plugin for Hooked API
 * 
 * This plugin creates HTTP endpoints for your REST API by translating
 * Express HTTP requests into hooked-api method calls.
 * 
 * Features:
 * - Automatic route creation for all scopes (including dynamically added ones)
 * - JSON:API compliant request/response handling
 * - Query parameter parsing (include, fields, filter, sort, page)
 * - Error mapping to HTTP status codes
 * - Content type validation
 * - Middleware injection points
 * 
 * Usage:
 * ```javascript
 * import { ExpressPlugin } from './express-plugin.js';
 * 
 * const api = new Api({ name: 'my-api', version: '1.0.0' });
 * api.use(RestApiPlugin);
 * api.use(ExpressPlugin, {
 *   basePath: '/api',          // Default: '/api'
 *   strictContentType: true,   // Default: true
 *   requestSizeLimit: '10mb'   // Default: '1mb'
 * });
 * 
 * // In your Express app:
 * app.use(api.expressRouter);
 * // or
 * api.mountExpress(app, '/v1');
 * ```
 */

export const ExpressPlugin = {
  name: 'express',
  dependencies: ['rest-api'],
  
  install({ on, vars, helpers, pluginOptions, log, scopes }) {
    // Check for Express dependency
    const express = checkPeerDependency('express', {
      optional: false,
      log,
      pluginName: 'Express plugin'
    });
    const expressOptions = pluginOptions.express || {};
    const basePath = expressOptions.basePath || '/api';
    const strictContentType = expressOptions.strictContentType !== false;
    const requestSizeLimit = expressOptions.requestSizeLimit || '1mb';
    
    // Track which scopes have routes created
    const routesCreated = new Set();
    
    // Create Express router
    const router = expressOptions.router || express.Router();
    
    // Add body parsing middleware
    router.use(express.json({ 
      limit: requestSizeLimit,
      type: ['application/json', 'application/vnd.api+json']
    }));
    
    // Content type validation middleware
    if (strictContentType) {
      router.use((req, res, next) => {
        // Only validate for requests with bodies
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const contentType = req.get('Content-Type');
          
          if (contentType && !contentType.includes('application/vnd.api+json') && !contentType.includes('application/json')) {
            return res.status(415).json({
              errors: [{
                status: '415',
                title: 'Unsupported Media Type',
                detail: `Content-Type must be application/vnd.api+json or application/json`
              }]
            });
          }
        }
        next();
      });
    }
    
    /**
     * Query parameter parser
     * Express with qs already handles bracket notation (filter[status] -> filter.status)
     * This just transforms the data to match our expected format
     */
    const parseQueryParams = (req) => {
      const query = req.query;
      const queryParams = {};
      
      // Parse include (comma-separated string to array)
      if (query.include) {
        queryParams.include = query.include.split(',').map(s => s.trim());
      }
      
      // Copy fields, filter, and page if they exist as objects
      if (query.fields && typeof query.fields === 'object') {
        queryParams.fields = query.fields;
      }
      
      if (query.filter && typeof query.filter === 'object') {
        queryParams.filter = query.filter;
      }
      
      if (query.page && typeof query.page === 'object') {
        queryParams.page = query.page;
      }
      
      // Parse sort (comma-separated string to array)
      if (query.sort) {
        queryParams.sort = query.sort.split(',').map(s => s.trim());
      }
      
      return queryParams;
    };
    
    /**
     * Error handler - maps API errors to HTTP responses
     */
    const handleError = (error, res) => {
      let status = 500;
      let errorResponse = {
        errors: [{
          status: '500',
          title: 'Internal Server Error',
          detail: error.message
        }]
      };
      
      // Check for RestApiError types by code
      if (error.code) {
        switch (error.code) {
          case 'REST_API_VALIDATION':
            status = 422;
            errorResponse.errors = [{
              status: '422',
              title: 'Validation Error',
              detail: error.message,
              source: error.details
            }];
            if (error.violations) {
              errorResponse.errors = error.violations.map(v => ({
                status: '422',
                title: 'Validation Error',
                detail: v.message,
                source: { pointer: v.field }
              }));
            }
            break;
            
          case 'REST_API_RESOURCE':
            // Map subtype to status
            switch (error.subtype) {
              case 'not_found':
                status = 404;
                errorResponse.errors[0].status = '404';
                errorResponse.errors[0].title = 'Not Found';
                break;
              case 'conflict':
                status = 409;
                errorResponse.errors[0].status = '409';
                errorResponse.errors[0].title = 'Conflict';
                break;
              case 'forbidden':
                status = 403;
                errorResponse.errors[0].status = '403';
                errorResponse.errors[0].title = 'Forbidden';
                break;
              default:
                status = 400;
                errorResponse.errors[0].status = '400';
                errorResponse.errors[0].title = 'Bad Request';
            }
            break;
            
          case 'REST_API_PAYLOAD':
            status = 400;
            errorResponse.errors = [{
              status: '400',
              title: 'Bad Request',
              detail: error.message,
              source: { pointer: error.path }
            }];
            break;
        }
      }
      
      res.status(status).json(errorResponse);
    };
    
    /**
     * Creates request handler for a specific HTTP method
     */
    const createRequestHandler = (scopeName, methodName) => {
      return async (req, res) => {
        try {
          const params = {};
          
          // Add ID parameter for single-resource operations
          if (['get', 'put', 'patch', 'delete'].includes(methodName)) {
            params.id = req.params.id;
          }
          
          // Add query parameters
          if (['query', 'get'].includes(methodName)) {
            params.queryParams = parseQueryParams(req);
          }
          
          // Add body for mutations
          if (['post', 'put', 'patch'].includes(methodName)) {
            params.inputRecord = req.body;
            
            // For PUT and PATCH, also parse query params
            if (['put', 'patch'].includes(methodName)) {
              params.queryParams = parseQueryParams(req);
            }
          }
          
          // Store Express request/response in params for plugins that need it
          params._expressReq = req;
          params._expressRes = res;
          
          log.debug(`HTTP ${req.method} ${req.path}`, { scopeName, methodName, params });
          
          // Call the API method
          const scope = scopes[scopeName];
          if (!scope) {
            return handleError({ 
              code: 'REST_API_RESOURCE', 
              subtype: 'not_found',
              message: `Scope '${scopeName}' not found`
            }, res);
          }
          
          const result = await scope[methodName](params);
          
          // Send response
          res.set('Content-Type', 'application/vnd.api+json');
          
          switch (methodName) {
            case 'post':
              res.status(201).json(result);
              break;
            case 'delete':
              res.sendStatus(204);
              break;
            default:
              res.json(result);
          }
        } catch (error) {
          handleError(error, res);
        }
      };
    };
    
    /**
     * Creates routes for a scope
     */
    const createRoutesForScope = (scopeName) => {
      if (routesCreated.has(scopeName)) {
        log.trace(`Routes already created for scope '${scopeName}'`);
        return;
      }
      
      const scopePath = `${basePath}/${scopeName}`;
      
      log.info(`Creating Express routes for scope '${scopeName}' at ${scopePath}`);
      
      // Apply any before middleware
      const beforeMiddleware = expressOptions.middleware?.beforeScope?.[scopeName] || [];
      
      // GET /api/{scope} - Query collection
      router.get(scopePath, ...beforeMiddleware, createRequestHandler(scopeName, 'query'));
      
      // GET /api/{scope}/{id} - Get single resource
      router.get(`${scopePath}/:id`, ...beforeMiddleware, createRequestHandler(scopeName, 'get'));
      
      // POST /api/{scope} - Create resource
      router.post(scopePath, ...beforeMiddleware, createRequestHandler(scopeName, 'post'));
      
      // PUT /api/{scope}/{id} - Replace resource
      router.put(`${scopePath}/:id`, ...beforeMiddleware, createRequestHandler(scopeName, 'put'));
      
      // PATCH /api/{scope}/{id} - Update resource
      router.patch(`${scopePath}/:id`, ...beforeMiddleware, createRequestHandler(scopeName, 'patch'));
      
      // DELETE /api/{scope}/{id} - Delete resource
      router.delete(`${scopePath}/:id`, ...beforeMiddleware, createRequestHandler(scopeName, 'delete'));
      
      // Apply any after middleware
      const afterMiddleware = expressOptions.middleware?.afterScope?.[scopeName] || [];
      if (afterMiddleware.length > 0) {
        router.use(scopePath, ...afterMiddleware);
      }
      
      routesCreated.add(scopeName);
    };
    
    // Listen for scope additions
    on('scope:added', 'createExpressRoutes', ({ eventData }) => {
      createRoutesForScope(eventData.scopeName);
    });
    
    // Create routes for any existing scopes
    for (const scopeName of Object.keys(scopes)) {
      createRoutesForScope(scopeName);
    }
    
    // 404 handler for unmatched routes within the API
    router.use((req, res) => {
      res.status(404).json({
        errors: [{
          status: '404',
          title: 'Not Found',
          detail: `The requested endpoint ${req.method} ${req.path} does not exist`
        }]
      });
    });
    
    // Apply global middleware if configured
    let finalRouter = router;
    if (expressOptions.middleware?.beforeAll) {
      const globalRouter = express.Router();
      globalRouter.use(...expressOptions.middleware.beforeAll);
      globalRouter.use(router);
      finalRouter = globalRouter;
    }
    
    // Store router in vars for external access
    vars.expressRouter = finalRouter;
    
    // Add convenient mounting method
    helpers.mountExpress = (app, path = '') => {
      app.use(path, finalRouter);
      log.info(`Express routes mounted at ${path || '/'}`);
    };
    
    log.info('Express plugin initialized successfully');
  }
};