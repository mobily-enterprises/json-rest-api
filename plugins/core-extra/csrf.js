import crypto from 'crypto';

/**
 * CSRF Protection Plugin
 * 
 * Provides Cross-Site Request Forgery protection using double-submit cookies
 * and synchronizer tokens
 */
export const CsrfPlugin = {
  name: 'CsrfPlugin',
  version: '1.0.0',
  
  install(api, options = {}) {
    const config = {
      // Token configuration
      tokenLength: options.tokenLength || 32,
      tokenName: options.tokenName || 'csrf-token',
      headerName: options.headerName || 'x-csrf-token',
      cookieName: options.cookieName || '_csrf',
      paramName: options.paramName || '_csrf',
      
      // Protection settings
      methods: options.methods || ['POST', 'PUT', 'PATCH', 'DELETE'],
      ignorePaths: options.ignorePaths || [],
      ignoreRoutes: options.ignoreRoutes || [],
      
      // Cookie options
      cookieOptions: {
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secure !== false, // Default true for production
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        ...options.cookieOptions
      },
      
      // Mode
      mode: options.mode || 'double-submit', // 'double-submit' or 'synchronizer'
      
      // Session store for synchronizer mode
      sessionStore: options.sessionStore || new Map(),
      
      // Error handling
      onError: options.onError,
      
      ...options
    };
    
    // Token generation
    const generateToken = () => {
      return crypto.randomBytes(config.tokenLength).toString('hex');
    };
    
    // Token validation
    const validateToken = (token1, token2) => {
      if (!token1 || !token2) return false;
      if (token1.length !== token2.length) return false;
      
      // Constant-time comparison
      return crypto.timingSafeEqual(
        Buffer.from(token1),
        Buffer.from(token2)
      );
    };
    
    // Get token from request
    const getTokenFromRequest = (req) => {
      // Check header first
      let token = req.headers[config.headerName];
      
      // Check body parameter
      if (!token && req.body) {
        token = req.body[config.paramName];
      }
      
      // Check query parameter (not recommended)
      if (!token && req.query) {
        token = req.query[config.paramName];
      }
      
      return token;
    };
    
    // Check if path should be protected
    const shouldProtect = (req) => {
      // Check method
      if (!config.methods.includes(req.method)) {
        return false;
      }
      
      // Check ignored paths
      const path = req.path || req.url;
      for (const ignorePath of config.ignorePaths) {
        if (typeof ignorePath === 'string' && path === ignorePath) {
          return false;
        }
        if (ignorePath instanceof RegExp && ignorePath.test(path)) {
          return false;
        }
      }
      
      return true;
    };
    
    // Express middleware
    if (api.router) {
      // Token generation endpoint
      api.router.get(`${api.basePath || '/api'}/csrf-token`, (req, res) => {
        const token = generateToken();
        
        if (config.mode === 'synchronizer') {
          // Store token in session
          const sessionId = req.session?.id || req.cookies?.sessionId;
          if (sessionId) {
            config.sessionStore.set(sessionId, token);
          }
        } else {
          // Double-submit: set cookie
          res.cookie(config.cookieName, token, config.cookieOptions);
        }
        
        res.json({
          token,
          headerName: config.headerName,
          paramName: config.paramName
        });
      });
      
      // CSRF protection middleware
      api.router.use((req, res, next) => {
        // Skip if not a protected method/path
        if (!shouldProtect(req)) {
          return next();
        }
        
        // Skip if it's an API token authenticated request
        if (req.headers.authorization?.startsWith('Bearer ')) {
          return next();
        }
        
        // Get tokens
        const requestToken = getTokenFromRequest(req);
        let expectedToken;
        
        if (config.mode === 'synchronizer') {
          // Get token from session store
          const sessionId = req.session?.id || req.cookies?.sessionId;
          if (sessionId) {
            expectedToken = config.sessionStore.get(sessionId);
          }
        } else {
          // Double-submit: get token from cookie
          expectedToken = req.cookies?.[config.cookieName];
        }
        
        // Validate token
        if (!validateToken(requestToken, expectedToken)) {
          // Log security event
          api.runHooks('securityViolation', {
            violationType: 'CSRF_TOKEN_INVALID',
            severity: 'WARNING',
            options: { request: req },
            details: {
              method: req.method,
              path: req.path,
              hasRequestToken: !!requestToken,
              hasExpectedToken: !!expectedToken
            }
          }).catch(console.error);
          
          // Handle error
          if (config.onError) {
            return config.onError(req, res, next);
          }
          
          return res.status(403).json({
            errors: [{
              status: '403',
              title: 'Forbidden',
              detail: 'Invalid CSRF token'
            }]
          });
        }
        
        // Token is valid
        next();
      });
    }
    
    // Hook for adding CSRF token to responses
    api.hook('beforeHttpResponse', async (context) => {
      const { request, response } = context;
      
      if (!request || !response) return;
      
      // Add CSRF token to response headers for SPAs
      if (request.method === 'GET' && config.mode === 'double-submit') {
        const token = request.cookies?.[config.cookieName] || generateToken();
        
        // Set cookie if not present
        if (!request.cookies?.[config.cookieName]) {
          response.cookie(config.cookieName, token, config.cookieOptions);
        }
        
        // Add token to response header
        response.header(`X-${config.tokenName}`, token);
      }
    });
    
    // API methods
    api.getCsrfToken = (sessionId) => {
      if (config.mode === 'synchronizer' && sessionId) {
        return config.sessionStore.get(sessionId);
      }
      return generateToken();
    };
    
    api.validateCsrfToken = (requestToken, sessionIdOrCookie) => {
      let expectedToken;
      
      if (config.mode === 'synchronizer') {
        expectedToken = config.sessionStore.get(sessionIdOrCookie);
      } else {
        expectedToken = sessionIdOrCookie;
      }
      
      return validateToken(requestToken, expectedToken);
    };
    
    // Clean up old tokens periodically (for synchronizer mode)
    if (config.mode === 'synchronizer' && config.sessionStore instanceof Map) {
      setInterval(() => {
        const now = Date.now();
        const maxAge = config.cookieOptions.maxAge || 24 * 60 * 60 * 1000;
        
        for (const [sessionId, data] of config.sessionStore.entries()) {
          if (data.timestamp && now - data.timestamp > maxAge) {
            config.sessionStore.delete(sessionId);
          }
        }
      }, 60 * 60 * 1000); // Every hour
    }
    
    // Configuration for resources
    api.configureCsrfForResource = (resourceName, resourceConfig = {}) => {
      const resourceOptions = api.resourceOptions?.get(resourceName) || {};
      
      resourceOptions.csrf = {
        enabled: resourceConfig.enabled !== false,
        methods: resourceConfig.methods || config.methods,
        ...resourceConfig
      };
      
      if (!api.resourceOptions) {
        api.resourceOptions = new Map();
      }
      api.resourceOptions.set(resourceName, resourceOptions);
    };
    
    // Hook to check CSRF for specific resources
    api.hook('beforeOperation', async (context) => {
      const { type, method } = context.options;
      const resourceOptions = api.resourceOptions?.get(type);
      
      if (!resourceOptions?.csrf?.enabled) return;
      
      const request = context.options.request;
      if (!request) return;
      
      // Check if this method requires CSRF
      const protectedMethods = resourceOptions.csrf.methods || config.methods;
      const methodMap = {
        'insert': 'POST',
        'update': 'PUT',
        'delete': 'DELETE'
      };
      
      const httpMethod = methodMap[method];
      if (!httpMethod || !protectedMethods.includes(httpMethod)) return;
      
      // Validate CSRF token
      const requestToken = getTokenFromRequest(request);
      const cookieToken = request.cookies?.[config.cookieName];
      
      if (!validateToken(requestToken, cookieToken)) {
        context.errors.push({
          field: null,
          message: 'CSRF token validation failed',
          code: 'CSRF_INVALID'
        });
      }
    }, 20); // High priority
  }
};

// Export convenience function
export function createCsrfProtection(options) {
  return {
    install(api) {
      CsrfPlugin.install(api, options);
    }
  };
}