import { createServer } from 'http';
import { parse as parseUrl } from 'url';
import { checkPeerDependency, createBasicQueryParser } from '../../lib/check-peer-dependency.js';

/**
 * HTTP Plugin for Hooked API
 * 
 * This plugin creates a pure Node.js HTTP server for your REST API,
 * without any framework dependencies like Express.
 * 
 * Features:
 * - Lightweight alternative to Express plugin
 * - Automatic route creation for all scopes
 * - JSON:API compliant request/response handling
 * - Query parameter parsing (with qs if available)
 * - Error mapping to HTTP status codes
 * - Content type validation
 * 
 * Usage:
 * ```javascript
 * import { HttpPlugin } from 'jsonrestapi';
 * 
 * const api = new Api({ name: 'my-api', version: '1.0.0' });
 * api.use(RestApiPlugin);
 * api.use(HttpPlugin, {
 *   port: 3000,              // Default: 3000
 *   basePath: '/api',        // Default: '/api'
 *   strictContentType: true  // Default: true
 * });
 * 
 * // Start the server
 * api.vars.httpServer.listen();
 * ```
 */

export const HttpPlugin = {
  name: 'http',
  dependencies: ['rest-api'],
  
  install({ on, vars, helpers, pluginOptions, log, scopes }) {
    const httpOptions = pluginOptions.http || {};
    const basePath = httpOptions.basePath || '/api';
    const strictContentType = httpOptions.strictContentType !== false;
    const port = httpOptions.port || 3000;
    
    // Check for optional dependencies
    const qs = checkPeerDependency('qs', {
      optional: true,
      fallback: createBasicQueryParser(),
      log,
      pluginName: 'HTTP plugin'
    });
    
    let getRawBody;
    try {
      getRawBody = checkPeerDependency('raw-body', {
        optional: true,
        log,
        pluginName: 'HTTP plugin'
      });
    } catch (e) {
      // Fallback implementation for raw-body
      getRawBody = async (req, options = {}) => {
        return new Promise((resolve, reject) => {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
            if (options.limit && body.length > options.limit) {
              reject(new Error('Request body too large'));
            }
          });
          req.on('end', () => resolve(body));
          req.on('error', reject);
        });
      };
    }
    
    let contentType;
    try {
      contentType = checkPeerDependency('content-type', {
        optional: true,
        log,
        pluginName: 'HTTP plugin'
      });
    } catch (e) {
      // Fallback - basic content type parsing
      contentType = {
        parse: (req) => {
          const header = req.headers['content-type'] || 'application/json';
          const [type, ...params] = header.split(';');
          const parameters = {};
          params.forEach(param => {
            const [key, value] = param.trim().split('=');
            if (key && value) {
              parameters[key] = value.replace(/^["']|["']$/g, '');
            }
          });
          return { type: type.trim(), parameters };
        }
      };
    }
    
    // Track which scopes have routes
    const routesCreated = new Set();
    
    /**
     * Parse query parameters from URL
     */
    const parseQueryParams = (url) => {
      const queryString = url.split('?')[1] || '';
      const rawParams = qs.parse(queryString);
      const queryParams = {};
      
      // Transform to expected format
      if (rawParams.include) {
        queryParams.include = rawParams.include.split(',').map(s => s.trim());
      }
      
      if (rawParams.fields) {
        queryParams.fields = rawParams.fields;
      }
      
      if (rawParams.filter) {
        queryParams.filter = rawParams.filter;
      }
      
      if (rawParams.sort) {
        queryParams.sort = rawParams.sort.split(',').map(s => s.trim());
      }
      
      if (rawParams.page) {
        queryParams.page = rawParams.page;
      }
      
      return queryParams;
    };
    
    /**
     * Map errors to HTTP responses
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
      
      // Map error codes to HTTP status
      if (error.code) {
        switch (error.code) {
          case 'REST_API_VALIDATION_ERROR':
            status = 422;
            errorResponse.errors[0].status = '422';
            errorResponse.errors[0].title = 'Validation Error';
            if (error.details) {
              errorResponse.errors[0].source = error.details;
            }
            break;
            
          case 'REST_API_RESOURCE_ERROR':
            if (error.subtype === 'not_found') {
              status = 404;
              errorResponse.errors[0].status = '404';
              errorResponse.errors[0].title = 'Not Found';
            } else if (error.subtype === 'conflict') {
              status = 409;
              errorResponse.errors[0].status = '409';
              errorResponse.errors[0].title = 'Conflict';
            } else if (error.subtype === 'forbidden') {
              status = 403;
              errorResponse.errors[0].status = '403';
              errorResponse.errors[0].title = 'Forbidden';
            }
            break;
            
          case 'REST_API_PAYLOAD_ERROR':
            status = 400;
            errorResponse.errors[0].status = '400';
            errorResponse.errors[0].title = 'Bad Request';
            break;
        }
      }
      
      res.writeHead(status, { 'Content-Type': 'application/vnd.api+json' });
      res.end(JSON.stringify(errorResponse));
    };
    
    /**
     * Main request handler
     */
    const handleRequest = async (req, res) => {
      const { pathname } = parseUrl(req.url);
      
      // Check if path starts with basePath
      if (!pathname.startsWith(basePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      
      // Parse the path
      const pathParts = pathname.slice(basePath.length).split('/').filter(Boolean);
      if (pathParts.length === 0 || pathParts.length > 2) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      
      const [scopeName, id] = pathParts;
      
      // Check if scope exists
      if (!scopes[scopeName]) {
        handleError({ 
          code: 'REST_API_RESOURCE_ERROR', 
          subtype: 'not_found',
          message: `Scope '${scopeName}' not found`
        }, res);
        return;
      }
      
      // Validate content type for requests with body
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && strictContentType) {
        const ct = req.headers['content-type'];
        if (ct && !ct.includes('application/vnd.api+json') && !ct.includes('application/json')) {
          res.writeHead(415, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            errors: [{
              status: '415',
              title: 'Unsupported Media Type',
              detail: 'Content-Type must be application/vnd.api+json or application/json'
            }]
          }));
          return;
        }
      }
      
      try {
        // Determine method based on HTTP method and path
        let methodName;
        const params = {};
        
        switch (req.method) {
          case 'GET':
            if (id) {
              methodName = 'get';
              params.id = id;
            } else {
              methodName = 'query';
            }
            params.queryParams = parseQueryParams(req.url);
            break;
            
          case 'POST':
            if (id) {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method not allowed' }));
              return;
            }
            methodName = 'post';
            params.queryParams = parseQueryParams(req.url);
            break;
            
          case 'PUT':
            if (!id) {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method not allowed' }));
              return;
            }
            methodName = 'put';
            params.id = id;
            params.queryParams = parseQueryParams(req.url);
            break;
            
          case 'PATCH':
            if (!id) {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method not allowed' }));
              return;
            }
            methodName = 'patch';
            params.id = id;
            params.queryParams = parseQueryParams(req.url);
            break;
            
          case 'DELETE':
            if (!id) {
              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method not allowed' }));
              return;
            }
            methodName = 'delete';
            params.id = id;
            break;
            
          default:
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        
        // Parse body for mutations
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const ct = contentType.parse(req);
          const rawBody = await getRawBody(req, {
            length: req.headers['content-length'],
            limit: '1mb',
            encoding: ct.parameters.charset || 'utf-8'
          });
          params.inputRecord = JSON.parse(rawBody);
        }
        
        // Store HTTP request/response in params for plugins that need it
        params._httpReq = req;
        params._httpRes = res;
        
        log.debug(`HTTP ${req.method} ${pathname}`, { scopeName, methodName, params });
        
        // Call the API method
        const scope = scopes[scopeName];
        const result = await scope[methodName](params);
        
        // Send response
        res.setHeader('Content-Type', 'application/vnd.api+json');
        
        switch (methodName) {
          case 'post':
            res.writeHead(201);
            res.end(JSON.stringify(result));
            break;
          case 'delete':
            res.writeHead(204);
            res.end();
            break;
          default:
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }
      } catch (error) {
        handleError(error, res);
      }
    };
    
    // Create HTTP server
    const server = createServer(handleRequest);
    
    // Store server in vars
    vars.httpServer = server;
    
    // Add convenient start method
    helpers.startHttpServer = (customPort) => {
      const finalPort = customPort || port;
      server.listen(finalPort, () => {
        log.info(`HTTP server listening on port ${finalPort}`);
        log.info(`API available at http://localhost:${finalPort}${basePath}`);
      });
      return server;
    };
    
    // Listen for scope additions (for future dynamic scopes)
    on('scope:added', 'logHttpRoute', ({ eventData }) => {
      log.info(`HTTP routes available for scope '${eventData.scopeName}' at ${basePath}/${eventData.scopeName}`);
    });
    
    // Log existing scopes
    for (const scopeName of Object.keys(scopes)) {
      log.info(`HTTP routes available for scope '${scopeName}' at ${basePath}/${scopeName}`);
    }
    
    log.info('HTTP plugin initialized successfully');
  }
};