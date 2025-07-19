  export const CorsPlugin = {
    name: 'rest-api-cors',
    dependencies: ['rest-api'],

    async install({ api, addHook, vars, helpers, log, pluginOptions, runHooks }) {
      // Get CORS configuration
      const corsOptions = pluginOptions?.['rest-api-cors'] || {};

      // Store configuration in vars
      vars.cors = {
        // Origin configuration
        origin: corsOptions.origin || '*', // Can be string, regex, array, or function
        credentials: corsOptions.credentials !== undefined ? corsOptions.credentials : true,

        // Allowed methods
        methods: corsOptions.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

        // Allowed headers
        allowedHeaders: corsOptions.allowedHeaders || [
          'Content-Type',
          'Authorization',
          'X-Requested-With',
          'X-HTTP-Method-Override',
          'Accept',
          'Origin'
        ],

        // Exposed headers (for client to read)
        exposedHeaders: corsOptions.exposedHeaders || [
          'X-Total-Count',
          'X-Page-Count',
          'Link',
          'Location'
        ],

        // Preflight cache
        maxAge: corsOptions.maxAge || 86400, // 24 hours

        // Options success status
        optionsSuccessStatus: corsOptions.optionsSuccessStatus || 204
      };

      // Helper to check if origin is allowed
      function isOriginAllowed(origin, allowedOrigin) {
        if (!origin) return !vars.cors.credentials; // No origin = same-origin request

        // String match
        if (typeof allowedOrigin === 'string') {
          return allowedOrigin === '*' || allowedOrigin === origin;
        }

        // Regex match
        if (allowedOrigin instanceof RegExp) {
          return allowedOrigin.test(origin);
        }

        // Array of allowed origins
        if (Array.isArray(allowedOrigin)) {
          return allowedOrigin.some(allowed => isOriginAllowed(origin, allowed));
        }

        // Function check
        if (typeof allowedOrigin === 'function') {
          return allowedOrigin(origin);
        }

        return false;
      }

      // Check if transport plugin is available
      if (!vars.transport) {
        log.error('CORS plugin requires a transport plugin (express, koa, etc.) to be installed');
        return;
      }


      // Register OPTIONS handler for all routes
      const optionsHandler = async ({ context, headers }) => {
        const origin = headers?.origin;
        
        log.debug('CORS OPTIONS request', { origin });

        // Check if origin is allowed
        if (isOriginAllowed(origin, vars.cors.origin)) {
          const responseHeaders = {
            'Access-Control-Allow-Methods': vars.cors.methods.join(', '),
            'Access-Control-Allow-Headers': vars.cors.allowedHeaders.join(', '),
            'Access-Control-Max-Age': String(vars.cors.maxAge)
          };

          // Set origin header
          if (vars.cors.origin === '*' && !vars.cors.credentials) {
            responseHeaders['Access-Control-Allow-Origin'] = '*';
          } else if (origin) {
            responseHeaders['Access-Control-Allow-Origin'] = origin;
            responseHeaders['Vary'] = 'Origin';
          }

          // Set credentials if enabled
          if (vars.cors.credentials) {
            responseHeaders['Access-Control-Allow-Credentials'] = 'true';
          }

          return {
            statusCode: vars.cors.optionsSuccessStatus,
            headers: responseHeaders,
            body: null
          };
        } else {
          // Origin not allowed
          log.warn('CORS origin not allowed', { origin });
          return {
            statusCode: 403,
            body: { error: 'CORS origin not allowed' }
          };
        }
      };

      // Register OPTIONS route for all paths
      await api.addRoute({
        method: 'OPTIONS',
        path: vars.transport.matchAll,
        handler: optionsHandler
      });

      // Hook to handle CORS headers for all responses
      addHook('transport:response', 'cors-headers', { order: -1000 }, async ({ context, methodParams }) => {
        // The Express plugin passes the hook context as methodParams
        const { request, response } = methodParams || {};
        
        if (!request) {
          log.error('CORS: request is undefined in transport:response hook');
          return;
        }
        
        const origin = request.headers?.origin;
        const method = request.method?.toUpperCase();

        log.debug('CORS processing response', {
          origin,
          method,
          path: request.path
        });

        // Skip if this was an OPTIONS request (already handled by route)
        if (method === 'OPTIONS') {
          return;
        }

        // Check if origin is allowed
        if (isOriginAllowed(origin, vars.cors.origin)) {
          // Set origin header
          if (vars.cors.origin === '*' && !vars.cors.credentials) {
            response.headers['Access-Control-Allow-Origin'] = '*';
          } else if (origin) {
            response.headers['Access-Control-Allow-Origin'] = origin;
            response.headers['Vary'] = 'Origin';
          }

          // Set credentials if enabled
          if (vars.cors.credentials) {
            response.headers['Access-Control-Allow-Credentials'] = 'true';
          }

          // Set exposed headers
          if (vars.cors.exposedHeaders.length > 0) {
            response.headers['Access-Control-Expose-Headers'] = vars.cors.exposedHeaders.join(', ');
          }
        } else if (origin) {
          // Origin not allowed - don't set any CORS headers
          log.warn('CORS origin not allowed for response', {
            origin,
            allowedOrigins: vars.cors.origin
          });
        }
      });

      // API method to update CORS settings at runtime
      api.cors = {
        updateOrigin: (newOrigin) => {
          vars.cors.origin = newOrigin;
          log.info('CORS origin updated', { origin: newOrigin });
        },

        addAllowedHeader: (header) => {
          if (!vars.cors.allowedHeaders.includes(header)) {
            vars.cors.allowedHeaders.push(header);
            log.info('CORS allowed header added', { header });
          }
        },

        addExposedHeader: (header) => {
          if (!vars.cors.exposedHeaders.includes(header)) {
            vars.cors.exposedHeaders.push(header);
            log.info('CORS exposed header added', { header });
          }
        },

        getConfig: () => ({ ...vars.cors })
      };

      log.info('CORS plugin installed', {
        origin: vars.cors.origin,
        credentials: vars.cors.credentials,
        methods: vars.cors.methods
      });
    }
  };

  /* 
  Usage examples:

  // Basic usage - allow all origins
  await api.use(CorsPlugin);

  // Specific origin
  await api.use(CorsPlugin, {
    'rest-api-cors': {
      origin: 'https://app.example.com'
    }
  });

  // Multiple origins
  await api.use(CorsPlugin, {
    'rest-api-cors': {
      origin: ['https://app.example.com', 'https://admin.example.com']
    }
  });

  // Dynamic origin with regex
  await api.use(CorsPlugin, {
    'rest-api-cors': {
      origin: /^https:\/\/.*\.example\.com$/
    }
  });

  // Function-based origin check
  await api.use(CorsPlugin, {
    'rest-api-cors': {
      origin: (origin) => {
        // Custom logic to determine if origin is allowed
        return myAllowedOrigins.includes(origin);
      }
    }
  });

  // Full configuration
  await api.use(CorsPlugin, {
    'rest-api-cors': {
      origin: 'https://app.example.com',
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom-Header'],
      exposedHeaders: ['X-Total-Count', 'X-RateLimit-Remaining'],
      maxAge: 3600 // 1 hour
    }
  });

*/