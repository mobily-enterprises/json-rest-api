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
 * - File upload support with busboy or formidable
 * 
 * Required dependencies:
 * - express: npm install express
 * 
 * Optional dependencies (for file uploads):
 * - busboy: npm install busboy
 * - formidable: npm install formidable
 * 
 * Basic usage:
 * ```javascript
 * import { ExpressPlugin } from 'json-rest-api';
 * import express from 'express';
 * 
 * const api = new Api({ name: 'my-api', version: '1.0.0' });
 * api.use(RestApiPlugin);
 * api.use(ExpressPlugin, {
 *   basePath: '/api',          // Default: '/api'
 *   strictContentType: true,   // Default: true
 *   requestSizeLimit: '10mb'   // Default: '1mb'
 * });
 * 
 * const app = express();
 * 
 * // Both approaches are equivalent:
 * 
 * // Approach 1: Direct router usage (standard Express pattern)
 * app.use(api.express.router);                    // Mount at root
 * app.use('/v1', api.express.router);             // Mount at /v1
 * app.use('/api/v2', api.express.router);         // Mount at /api/v2
 * 
 * // Approach 2: Convenience method (adds logging)
 * api.express.mount(app);                         // Mount at root
 * api.express.mount(app, '/v1');                  // Mount at /v1
 * api.express.mount(app, '/api/v2');              // Mount at /api/v2
 * 
 * // The mount method is just syntactic sugar that calls app.use() and logs the mount path
 * ```
 * 
 * Advanced usage with middleware:
 * ```javascript
 * api.use(ExpressPlugin, {
 *   basePath: '/api',
 *   middleware: {
 *     // Apply middleware before all routes
 *     beforeAll: [authMiddleware, loggingMiddleware],
 *     
 *     // Apply middleware to specific scopes
 *     beforeScope: {
 *       users: [requireAuth],
 *       posts: [requireAuth, checkPermissions]
 *     },
 *     
 *     // Apply middleware after scope routes
 *     afterScope: {
 *       users: [auditLogger]
 *     }
 *   },
 *   
 *   // Provide your own router instance
 *   router: express.Router({ mergeParams: true })
 * });
 * ```
 * 
 * File upload configuration:
 * ```javascript
 * api.use(ExpressPlugin, {
 *   enableFileUploads: true,  // Default: true
 *   fileParser: 'busboy',     // 'busboy' or 'formidable'
 *   fileParserOptions: {
 *     limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
 *   }
 * });
 * ```
 */

// Import Express as a regular dependency
import express from 'express';
import { parseJsonApiQuery } from '../lib/connectors-query-parser.js';
import { createContext } from './lib/request-helpers.js';

export const ExpressPlugin = {
  name: 'express',
  dependencies: ['rest-api'],
  
  async install({ on, vars, helpers, pluginOptions, log, scopes, addApiMethod, api, runHooks }) {
    // Initialize express namespace under api.http
    if (!api.http) {
      api.http = {};
    }
    api.http.express = {};
    
    const expressOptions = pluginOptions.express || {};
    const basePath = expressOptions.basePath || '/api';
    const strictContentType = expressOptions.strictContentType !== false;
    const requestSizeLimit = expressOptions.requestSizeLimit || '1mb';
    
    // Track which scopes have routes created
    const routesCreated = new Set();
    
    // Register file detector if file handling is enabled
    if (expressOptions.enableFileUploads !== false && api.rest?.registerFileDetector) {
      // Determine which parser to use
      const parserLib = expressOptions.fileParser || 'busboy';
      const parserOptions = expressOptions.fileParserOptions || {};
      
      let detector;
      
      if (parserLib === 'multer') {
        // Multer is Express-specific and works differently
        log.info('Multer file parsing should be configured via Express middleware');
      } else if (parserLib === 'busboy') {
        try {
          const { createBusboyDetector } = await import('../lib/busboy-detector.js');
          detector = createBusboyDetector(parserOptions);
        } catch (e) {
          log.warn('Busboy not installed. Install with: npm install busboy');
        }
      } else if (parserLib === 'formidable') {
        try {
          const { createFormidableDetector } = await import('../lib/formidable-detector.js');
          detector = createFormidableDetector(parserOptions);
        } catch (e) {
          log.warn('Formidable not installed. Install with: npm install formidable');
        }
      }
      
      // Register the detector
      if (detector) {
        api.rest.registerFileDetector({
          name: `express-${detector.name}`,
          detect: (params, context) => {
            // Only detect for Express requests
            if (!context || !context.raw || !context.raw.req) return false;
            // Pass params with the Express request for the detector
            const detectParams = { ...params, _expressReq: context.raw.req };
            return detector.detect(detectParams);
          },
          parse: (params, context) => {
            // Pass params with the Express request for the parser
            const parseParams = { ...params, _expressReq: context.raw.req, _expressRes: context.raw.res };
            return detector.parse(parseParams);
          }
        });
        
        log.info(`Express plugin registered file detector: ${detector.name}`);
      }
    }
    
    // Create Express router
    const router = expressOptions.router || express.Router();
    
    // Add body parsing middleware
    router.use(express.json({ 
      limit: requestSizeLimit,
      type: ['application/json', 'application/vnd.api+json']
    }));
    
    // Add hook middleware to intercept all requests
    router.use(async (req, res, next) => {
      // Create context for this request
      const context = createContext(req, res, 'express');
      
      // Run transport:request hook to allow plugins to intercept or enrich context
      const hookParams = { req, res, url: req.url, method: req.method };
      const shouldContinue = await runHooks('transport:request', context, hookParams);
      
      // Check if request was handled by a hook
      if (!shouldContinue || context.handled) {
        // If there's a rejection, send the appropriate error response
        if (context.rejection) {
          return res.status(context.rejection.status || 500).json({
            errors: [{
              status: String(context.rejection.status || 500),
              title: context.rejection.title || 'Request Rejected',
              detail: context.rejection.message
            }]
          });
        }
        return; // Request was intercepted, don't call next()
      }
      
      // Store context on request for later use
      req.context = context;
      next();
    });
    
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
     * Query parameter parser using shared JSON:API parser
     * Handles bracket notation parsing consistently across all plugins
     */
    const parseQueryParams = (req) => {
      // Extract query string from URL (Express doesn't give us the raw query string)
      const queryString = req.url.split('?')[1] || '';
      return parseJsonApiQuery(queryString);
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
            params.simplified = false; // Force JSON:API mode for HTTP
            // Debug fields parameter specifically
            if (req.url.includes('fields[')) {
              log.trace(`Fields URL: ${req.url}, parsed fields: ${JSON.stringify(params.queryParams.fields)}`);
            }
          }
          
          // Add body for mutations
          if (['post', 'put', 'patch'].includes(methodName)) {
            params.inputRecord = req.body;
            params.simplified = false; // Force JSON:API mode for HTTP
            
            // For PUT and PATCH, also parse query params
            if (['put', 'patch'].includes(methodName)) {
              params.queryParams = parseQueryParams(req);
            }
            
            // For POST, parse query params for includes/fields
            if (methodName === 'post') {
              params.queryParams = parseQueryParams(req);
            }
            
            // Check for returnFullRecord query parameter
            if (req.query.returnFullRecord !== undefined) {
              // Check if remote override is allowed
              const scopeConfig = api.scopes[scopeName]?.scopeOptions?.returnFullRecord;
              const allowRemoteOverride = 
                scopeConfig?.allowRemoteOverride !== undefined ? 
                scopeConfig.allowRemoteOverride : 
                vars.returnFullRecord.allowRemoteOverride;
              
              if (allowRemoteOverride) {
                // Parse the boolean value
                params.returnFullRecord = req.query.returnFullRecord === 'true';
              }
            }
          }
          
          // Use context from middleware or create new one
          const context = req.context || createContext(req, res, 'express');
          
          log.debug(`HTTP ${req.method} ${req.path}`, { scopeName, methodName, params });
          
          // Call the API method
          const scope = api.scopes[scopeName];
          if (!scope) {
            return handleError({ 
              code: 'REST_API_RESOURCE', 
              subtype: 'not_found',
              message: `Scope '${scopeName}' not found`
            }, res);
          }
          
          const result = await scope[methodName](params, context);
          
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
          log.error('Request handler error:', { 
            errorMessage: error.message,
            errorStack: error.stack,
            errorType: error.constructor.name 
          });
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
      
      // Ensure 404 handler stays at the end after adding routes
      ensure404HandlerIsLast();
    };
    
    // Listen for scope additions
    on('scope:added', 'createExpressRoutes', ({ eventData }) => {
      log.info(`Creating routes for scope added via event: ${eventData.scopeName}`);
      createRoutesForScope(eventData.scopeName);
    });
    
    // Create routes for any existing scopes
    // Use api.scopes instead of scopes parameter to get all scopes
    log.info(`Available scopes during plugin install: ${Object.keys(api.scopes || {}).join(', ')}`);
    for (const scopeName of Object.keys(api.scopes || {})) {
      log.info(`Creating routes for existing scope: ${scopeName}`);
      createRoutesForScope(scopeName);
    }
    
    // Store 404 handler to be added later
    const notFoundHandler = (req, res, next) => {
      // Only handle requests that start with our basePath
      if (req.path.startsWith(basePath)) {
        res.status(404).json({
          errors: [{
            status: '404',
            title: 'Not Found',
            detail: `The requested endpoint ${req.method} ${req.path} does not exist`
          }]
        });
      } else {
        // Pass through requests that don't match our basePath
        next();
      }
    };
    
    // Function to ensure 404 handler is always last
    const ensure404HandlerIsLast = () => {
      // Remove existing 404 handler if present
      const existingIndex = router.stack.findIndex(layer => layer.handle === notFoundHandler);
      if (existingIndex !== -1) {
        router.stack.splice(existingIndex, 1);
      }
      // Add at the end
      router.use(notFoundHandler);
    };
    
    // Add 404 handler initially
    ensure404HandlerIsLast();
    
    // Apply global middleware if configured
    let finalRouter = router;
    if (expressOptions.middleware?.beforeAll) {
      const globalRouter = express.Router();
      globalRouter.use(...expressOptions.middleware.beforeAll);
      globalRouter.use(router);
      finalRouter = globalRouter;
    }
    
    // Store router in api.http.express namespace
    api.http.express.router = finalRouter;
    
    // Add convenient mounting method
    api.http.express.mount = (app, path = '') => {
      app.use(path, finalRouter);
      log.info(`Express routes mounted at ${path || '/'}`);
    };
    
    log.info('Express plugin initialized successfully');
  }
};