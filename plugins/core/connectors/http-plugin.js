import { createServer } from 'http';
import { parse as parseUrl } from 'url';

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
 * - Query parameter parsing with full qs support
 * - Error mapping to HTTP status codes
 * - Content type validation
 * - File upload support with busboy or formidable
 * - Character encoding support
 * - Configurable request size limits
 * 
 * Optional dependencies:
 * - busboy or formidable: File upload support
 * 
 * Basic usage:
 * ```javascript
 * import { HttpPlugin } from 'json-rest-api';
 * 
 * const api = new Api({ name: 'my-api', version: '1.0.0' });
 * api.use(RestApiPlugin);
 * api.use(HttpPlugin, {
 *   port: 3000,                // Default: 3000
 *   basePath: '/api',          // Default: '/api'
 *   strictContentType: true,   // Default: true
 *   requestSizeLimit: '10mb'   // Default: '1mb'
 * });
 * 
 * // Start the server on the configured port
 * api.http.startServer();
 * 
 * // Or start on a different port
 * api.http.startServer(4000);
 * ```
 * 
 * Advanced usage:
 * ```javascript
 * // Access the raw HTTP server for custom configuration
 * const server = api.http.server;
 * server.timeout = 60000; // 60 second timeout
 * 
 * // Use the request handler with your own server
 * import { createServer } from 'https';
 * const httpsServer = createServer(sslOptions, api.http.handler);
 * httpsServer.listen(443);
 * 
 * // Or integrate into an existing HTTP server
 * myExistingServer.on('request', (req, res) => {
 *   if (req.url.startsWith('/api')) {
 *     api.http.handler(req, res);
 *   } else {
 *     // Handle other routes
 *   }
 * });
 * ```
 * 
 * File upload configuration:
 * ```javascript
 * api.use(HttpPlugin, {
 *   enableFileUploads: true,  // Default: true
 *   fileParser: 'busboy',     // 'busboy' or 'formidable'
 *   fileParserOptions: {
 *     limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
 *   }
 * });
 * ```
 */

// Import qs for query string parsing
import qs from 'qs';

export const HttpPlugin = {
  name: 'http',
  dependencies: ['rest-api'],
  
  async install({ on, vars, helpers, pluginOptions, log, scopes, api }) {
    // Initialize http namespace
    api.http = {};
    
    const httpOptions = pluginOptions.http || {};
    const basePath = httpOptions.basePath || '/api';
    const strictContentType = httpOptions.strictContentType !== false;
    const port = httpOptions.port || 3000;
    const requestSizeLimit = httpOptions.requestSizeLimit || '1mb';
    
    // Simple body parsing
    const getRawBody = async (req, options = {}) => {
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
    
    // Simple content type parsing
    const parseContentType = (req) => {
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
    };
    
    // Register file detector if file handling is enabled
    if (httpOptions.enableFileUploads !== false && vars.rest?.registerFileDetector) {
      const parserLib = httpOptions.fileParser || 'busboy';
      const parserOptions = httpOptions.fileParserOptions || {};
      
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
        vars.rest.registerFileDetector({
          name: `http-${detector.name}`,
          detect: (params) => {
            if (!params._httpReq) return false;
            return detector.detect(params);
          },
          parse: detector.parse
        });
        log.info(`HTTP plugin registered file detector: ${detector.name}`);
      }
    }
    
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
      if (!api.scopes[scopeName]) {
        handleError({ 
          code: 'REST_API_RESOURCE', 
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
          const ct = parseContentType(req);
          const rawBody = await getRawBody(req, {
            length: req.headers['content-length'],
            limit: requestSizeLimit,
            encoding: ct.parameters.charset || 'utf-8'
          });
          params.inputRecord = JSON.parse(rawBody);
        }
        
        // Store HTTP request/response in params for plugins that need it
        params._httpReq = req;
        params._httpRes = res;
        
        log.debug(`HTTP ${req.method} ${pathname}`, { scopeName, methodName, params });
        
        // Call the API method
        const scope = api.scopes[scopeName];
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
    
    // Store server and handler in http namespace
    api.http.server = server;
    api.http.handler = handleRequest;
    
    // Add convenient start method
    api.http.startServer = (customPort) => {
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