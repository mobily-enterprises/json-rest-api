/**
 * Express Plugin for Hooked API
 * 
 * This plugin creates HTTP endpoints for your REST API by listening to
 * route registrations from the REST API plugin and creating Express routes.
 * 
 * Features:
 * - Automatic route creation via addRoute hook
 * - JSON:API compliant request/response handling
 * - Query parameter parsing
 * - Error mapping to HTTP status codes
 * - Content type validation
 * - Middleware injection points
 * - File upload support with busboy or formidable
 */

import express from 'express';
import { parseJsonApiQuery } from '../utils/connectors-query-parser.js';
import { createContext } from './lib/request-helpers.js';
import { createEnhancedLogger } from '../../../lib/enhanced-logger.js';

export const ExpressPlugin = {
  name: 'express',
  dependencies: ['rest-api'],
  
  async install({ on, vars, helpers, pluginOptions, log, scopes, api, runHooks, addHook }) {
    // Enhance the logger
    const enhancedLog = createEnhancedLogger(log, { 
      logFullErrors: true, 
      includeStack: true 
    });
    
    // Initialize express namespace
    if (!api.http) {
      api.http = {};
    }
    api.http.express = {};
    
    const expressOptions = pluginOptions['express'] || {};
    
    const basePath = expressOptions.basePath || '';
    const strictContentType = expressOptions.strictContentType !== false;
    const requestSizeLimit = expressOptions.requestSizeLimit || '1mb';
    
    // Set transport information for other plugins
    vars.transport = {
      type: 'express',
      matchAll: '*' // Express wildcard pattern for matching all routes
    };
    
    // Register file detector if enabled
    if (expressOptions.enableFileUploads !== false && api.rest?.registerFileDetector) {
      const parserLib = expressOptions.fileParser || 'busboy';
      const parserOptions = expressOptions.fileParserOptions || {};
      
      let detector;
      
      if (parserLib === 'busboy') {
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
      
      if (detector) {
        api.rest.registerFileDetector({
          name: `express-${detector.name}`,
          detect: (params, context) => {
            if (!context || !context.raw || !context.raw.req) return false;
            const detectParams = { ...params, _expressReq: context.raw.req };
            return detector.detect(detectParams);
          },
          parse: (params, context) => {
            const parseParams = { ...params, _expressReq: context.raw.req, _expressRes: context.raw.res };
            return detector.parse(parseParams);
          }
        });
        log.info(`Express plugin registered file detector: ${detector.name}`);
      }
    }
    
    // Create Express routers
    const router = expressOptions.router || express.Router();
    const notFoundRouter = express.Router();
    
    // Add body parsing middleware
    router.use(express.json({ 
      limit: requestSizeLimit,
      type: ['application/json', 'application/vnd.api+json']
    }));
    
    // Add transport hook middleware
    router.use(async (req, res, next) => {
      const context = createContext(req, res, 'express');
      
      // Transport-specific data for hooks
      const transportData = {
        request: {
          method: req.method,
          url: req.url,
          path: req.path,
          headers: req.headers,
          body: req.body,
          params: req.params,
          query: req.query
        },
        response: {
          headers: {},
          status: null
        }
      };
      
      // Add transport data to context
      context.transport = transportData;
      const shouldContinue = await runHooks('transport:request', context);
      
      if (!shouldContinue || context.handled) {
        if (context.rejection) {
          // Apply response headers from hooks
          if (transportData.response.headers) {
            res.set(transportData.response.headers);
          }
          return res.status(context.rejection.status || 500).json({
            errors: [{
              status: String(context.rejection.status || 500),
              title: context.rejection.title || 'Request Rejected',
              detail: context.rejection.message
            }]
          });
        }
        return;
      }
      
      // Store transport data and context for later use
      req.transportData = transportData;
      req.context = context;
      next();
    });
    
    // Content type validation middleware
    if (strictContentType) {
      router.use((req, res, next) => {
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const contentType = req.get('Content-Type');
          
          if (contentType && !contentType.includes('application/vnd.api+json') && 
              !contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
            return res.status(415).json({
              errors: [{
                status: '415',
                title: 'Unsupported Media Type',
                detail: 'Content-Type must be application/vnd.api+json or application/json'
              }]
            });
          }
        }
        next();
      });
    }
    
    /**
     * Error handler - maps REST API errors to HTTP responses
     */
    const handleError = async (error, req, res) => {
      enhancedLog.logError('HTTP request error', error, {
        method: req.method,
        path: req.path,
        url: req.url
      });
      
      let status = 500;
      let errorResponse = {
        errors: [{
          status: '500',
          title: 'Internal Server Error',
          detail: error.message
        }]
      };
      
      // Map error codes to HTTP status
      if (error.code === 'REST_API_VALIDATION') {
        status = 422;
        errorResponse.errors = [{
          status: '422',
          title: 'Validation Error',
          detail: error.message,
          source: error.details
        }];
        if (error.details?.violations) {
          errorResponse.errors = error.details.violations.map(v => ({
            status: '422',
            title: 'Validation Error',
            detail: v.message,
            source: { pointer: v.field }
          }));
        }
      } else if (error.code === 'REST_API_RESOURCE') {
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
      } else if (error.code === 'REST_API_PAYLOAD') {
        status = 400;
        errorResponse.errors = [{
          status: '400',
          title: 'Bad Request',
          detail: error.message,
          source: { pointer: error.path }
        }];
      }
      
      // Run transport:response hook for errors
      if (req.transportData && req.context) {
        req.transportData.response.status = status;
        req.transportData.response.body = errorResponse;
        req.context.transport = req.transportData;
        await runHooks('transport:response', req.context);
        
        // Apply response headers from hooks
        if (req.transportData.response.headers) {
          res.set(req.transportData.response.headers);
        }
      }
      
      res.status(status).json(errorResponse);
    };
    
    /**
     * Listen to addRoute hook to create Express routes
     */
    addHook('addRoute', 'expressRouteCreator', {}, async ({ context }) => {
      const { method, path, handler } = context;
      
      // Apply any global before middleware
      const beforeMiddleware = expressOptions.middleware?.beforeAll || [];
      
      // Create the Express route
      // Special handling for wildcard paths when basePath is set
      let expressPath;
      if (path === vars.transport.matchAll && basePath) {
        // When we have a basePath and a wildcard, we need to use proper Express wildcard syntax
        expressPath = basePath + '/*';
      } else {
        expressPath = basePath + path;
      }
      
      
      try {
      
        // 1. Extract the handler logic into a shared function to keep it DRY (Don't Repeat Yourself).
        const expressHandler = async (req, res) => {
          try {
            // Extract request data
            const queryString = req.url.split('?')[1] || '';
            const context = req.context || createContext(req, res, 'express');

            // Call the generic handler
            const result = await handler({
              queryString,
              headers: req.headers,
              params: req.params,
              body: req.body,
              context
            });

            // Prepare response status
            let responseStatus = 200;
            if (result && typeof result.statusCode === 'number') {
              responseStatus = result.statusCode;
            } else if (req.method === 'DELETE' && !result) {
              responseStatus = 204;
            } else if (req.method === 'POST') {
              responseStatus = 201;
            }

            // Apply headers from the handler result
            if (result && result.headers) {
              res.set(result.headers);
            }

            // Update transport data for response (if transport data exists)
            if (req.transportData) {
              req.transportData.response.status = responseStatus;
              req.transportData.response.body = result;
              context.transport = req.transportData;
              await runHooks('transport:response', context);
              if (req.transportData.response.headers) {
                res.set(req.transportData.response.headers);
              }
            }

            // Set content type
            res.set('Content-Type', 'application/vnd.api+json');

            // Handle response based on status
            if (responseStatus === 204) {
              res.sendStatus(204);
            } else {
              // If result has a body property, that's what we should send
              // This happens when handler returns { statusCode, body, headers }
              const responseBody = result && result.body !== undefined ? result.body : result;
              
              if (req.method === 'POST' && responseBody?.data?.id && helpers.getLocation) {
                const scopeName = path.split('/')[2];
                const location = helpers.getLocation({ scopeName, id: responseBody.data.id });
                res.set('Location', `${basePath}/api${location}`);
              }
              res.status(responseStatus).json(responseBody);
            }
          } catch (error) {
            handleError(error, req, res);
          }
        };

        // 2. Check for the wildcard path and use the appropriate Express method.
        if (path === vars.transport.matchAll) {
          // For wildcard paths in Express 5, we need to use middleware approach
          // Create a middleware that only responds to the specific method
          const methodSpecificMiddleware = (req, res, next) => {
            if (req.method.toLowerCase() === method.toLowerCase()) {
              expressHandler(req, res);
            } else {
              next();
            }
          };
          router.use(...beforeMiddleware, methodSpecificMiddleware);
        } else {
          // Use the specific method (get, post, all, etc.) for all other defined routes
          router[method.toLowerCase()](expressPath, ...beforeMiddleware, expressHandler);
        }


      } catch (routeError) {
        console.log('[EXPRESS DEBUG] Error creating route:', {
          error: routeError.message,
          stack: routeError.stack,
          path: expressPath,
          method: method.toLowerCase()
        });
        throw routeError;
      }
      
      log.trace(`Express route created: ${method} ${expressPath}`);
    });
    
    // Apply global middleware if configured
    let finalRouter = router;
    if (expressOptions.middleware?.beforeAll) {
      const globalRouter = express.Router();
      globalRouter.use(...expressOptions.middleware.beforeAll);
      globalRouter.use(router);
      finalRouter = globalRouter;
    }
    
    // Set up 404 handler in separate router (unless disabled)
    if (expressOptions.handle404 !== false) {
      notFoundRouter.use(async (req, res, next) => {
        if (req.path.startsWith('/api')) {
          // Create minimal context for 404
          const context = createContext(req, res, 'express');
          const transportData = {
            request: {
              method: req.method,
              url: req.url,
              path: req.path,
              headers: req.headers
            },
            response: {
              headers: {},
              status: 404,
              body: {
                errors: [{
                  status: '404',
                  title: 'Not Found',
                  detail: `The requested endpoint ${req.method} ${req.path} does not exist`
                }]
              }
            }
          };
          
          // Add transport data to context
          context.transport = transportData;
          
          // Run transport:response hook for 404
          await runHooks('transport:response', context);
          
          // Apply response headers from hooks
          if (transportData.response.headers) {
            res.set(transportData.response.headers);
          }
          
          res.status(404).json(transportData.response.body);
        } else {
          next();
        }
      });
    }
    
    // Store routers in api.http.express namespace
    api.http.express.router = finalRouter;
    api.http.express.notFoundRouter = notFoundRouter;
    
    // Allow other plugins to add middleware before 404 handler
    const beforeNotFoundMiddleware = [];
    api.http.express.beforeNotFound = (middleware) => {
      beforeNotFoundMiddleware.push(middleware);
    };
    
    // Add convenient mounting method
    api.http.express.mount = (app, path = '') => {
      // Mount main router with all routes
      app.use(path, finalRouter);
      
      // Mount any middleware that should come before 404
      beforeNotFoundMiddleware.forEach(middleware => {
        app.use(path, middleware);
      });
      
      // Mount 404 handler router after all other routes (if enabled)
      if (expressOptions.handle404 !== false) {
        app.use(path, notFoundRouter);
      }
      
      log.info(`Express routes mounted at ${path || '/'}`);
    };
    
    log.info('Express plugin initialized successfully');
  }
};