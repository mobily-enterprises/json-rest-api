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
    
    const expressOptions = pluginOptions.express || {};
    const basePath = expressOptions.basePath || '';
    const strictContentType = expressOptions.strictContentType !== false;
    const requestSizeLimit = expressOptions.requestSizeLimit || '1mb';
    
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
    
    // Create Express router
    const router = expressOptions.router || express.Router();
    
    // Add body parsing middleware
    router.use(express.json({ 
      limit: requestSizeLimit,
      type: ['application/json', 'application/vnd.api+json']
    }));
    
    // Add transport hook middleware
    router.use(async (req, res, next) => {
      const context = createContext(req, res, 'express');
      
      const hookParams = { req, res, url: req.url, method: req.method };
      const shouldContinue = await runHooks('transport:request', context, hookParams);
      
      if (!shouldContinue || context.handled) {
        if (context.rejection) {
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
    const handleError = (error, res) => {
      enhancedLog.logError('HTTP request error', error, {
        method: res.req?.method,
        path: res.req?.path,
        url: res.req?.url
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
      
      res.status(status).json(errorResponse);
    };
    
    /**
     * Listen to addRoute hook to create Express routes
     */
    addHook('addRoute', 'expressRouteCreator', {}, async ({ methodParams }) => {
      const { method, path, handler } = methodParams;
      
      // Apply any global before middleware
      const beforeMiddleware = expressOptions.middleware?.beforeAll || [];
      
      // Create the Express route
      const expressPath = basePath + path;
      
      router[method.toLowerCase()](expressPath, ...beforeMiddleware, async (req, res) => {
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
          
          // Handle response based on method
          res.set('Content-Type', 'application/vnd.api+json');
          
          if (method === 'DELETE' && !result) {
            res.sendStatus(204);
          } else if (method === 'POST') {
            // Set Location header for created resources
            if (result?.data?.id && helpers.getLocation) {
              const scopeName = path.split('/')[2]; // Extract from /api/scopeName
              const location = helpers.getLocation({ scopeName, id: result.data.id });
              res.set('Location', `${basePath}/api${location}`);
            }
            res.status(201).json(result);
          } else {
            res.json(result);
          }
        } catch (error) {
          handleError(error, res);
        }
      });
      
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
    
    // Store router in api.http.express namespace
    api.http.express.router = finalRouter;
    
    // Add convenient mounting method
    api.http.express.mount = (app, path = '') => {
      app.use(path, finalRouter);
      
      // Add 404 handler AFTER mounting the routes
      app.use((req, res, next) => {
        if (req.path.startsWith('/api')) {
          res.status(404).json({
            errors: [{
              status: '404',
              title: 'Not Found',
              detail: `The requested endpoint ${req.method} ${req.path} does not exist`
            }]
          });
        } else {
          next();
        }
      });
      
      log.info(`Express routes mounted at ${path || '/'}`);
    };
    
    log.info('Express plugin initialized successfully');
  }
};