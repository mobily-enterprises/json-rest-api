/**
 * Security plugin implementing industry-standard security practices
 */
export const SecurityPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: 'Too many requests from this IP'
      },
      cors: {
        origin: '*',
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-Total-Count', 'Link']
      },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      authentication: {
        type: 'bearer', // 'bearer', 'basic', 'apikey'
        header: 'Authorization',
        queryParam: 'api_key'
      },
      ...options
    };

    // Store rate limit data
    const rateLimitStore = new Map();

    // Add security headers
    if (api.router) {
      // CORS
      api.router.use((req, res, next) => {
        const cors = defaultOptions.cors;
        res.header('Access-Control-Allow-Origin', cors.origin);
        res.header('Access-Control-Allow-Methods', cors.methods.join(', '));
        res.header('Access-Control-Allow-Headers', cors.allowedHeaders.join(', '));
        res.header('Access-Control-Expose-Headers', cors.exposedHeaders.join(', '));
        res.header('Access-Control-Allow-Credentials', cors.credentials);
        
        // Security headers
        res.header('X-Content-Type-Options', 'nosniff');
        res.header('X-Frame-Options', 'DENY');
        res.header('X-XSS-Protection', '1; mode=block');
        res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        
        // Content Security Policy
        const csp = Object.entries(defaultOptions.contentSecurityPolicy.directives)
          .map(([key, values]) => `${key} ${values.join(' ')}`)
          .join('; ');
        res.header('Content-Security-Policy', csp);
        
        next();
      });

      // Rate limiting
      api.router.use((req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const windowStart = now - defaultOptions.rateLimit.windowMs;
        
        // Clean old entries
        const requests = rateLimitStore.get(ip) || [];
        const recentRequests = requests.filter(time => time > windowStart);
        
        if (recentRequests.length >= defaultOptions.rateLimit.max) {
          return res.status(429).json({
            errors: [{
              status: '429',
              title: 'Too Many Requests',
              detail: defaultOptions.rateLimit.message
            }]
          });
        }
        
        recentRequests.push(now);
        rateLimitStore.set(ip, recentRequests);
        
        // Add rate limit headers
        res.header('X-RateLimit-Limit', defaultOptions.rateLimit.max);
        res.header('X-RateLimit-Remaining', defaultOptions.rateLimit.max - recentRequests.length);
        res.header('X-RateLimit-Reset', new Date(now + defaultOptions.rateLimit.windowMs).toISOString());
        
        next();
      });

      // Request ID for tracing
      api.router.use((req, res, next) => {
        req.id = req.headers['x-request-id'] || generateRequestId();
        res.header('X-Request-ID', req.id);
        next();
      });
    }

    // Authentication hook
    api.hook('beforeValidate', async (context) => {
      // Skip auth check for read operations if configured
      if (options.publicRead && (context.method === 'get' || context.method === 'query')) {
        return;
      }

      const authConfig = defaultOptions.authentication;
      let token = null;

      // Extract token based on auth type
      if (context.options.request) {
        const req = context.options.request;
        
        switch (authConfig.type) {
          case 'bearer':
            const authHeader = req.headers[authConfig.header.toLowerCase()];
            if (authHeader && authHeader.startsWith('Bearer ')) {
              token = authHeader.substring(7);
            }
            break;
            
          case 'apikey':
            token = req.headers[authConfig.header.toLowerCase()] || 
                   req.query[authConfig.queryParam];
            break;
            
          case 'basic':
            const basicAuth = req.headers[authConfig.header.toLowerCase()];
            if (basicAuth && basicAuth.startsWith('Basic ')) {
              token = basicAuth.substring(6);
            }
            break;
        }
      }

      // Verify token
      if (!token && authConfig.required !== false) {
        context.errors.push({
          field: null,
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
        return;
      }

      if (token && options.verifyToken) {
        try {
          const user = await options.verifyToken(token, context);
          context.options.user = user;
          context.options.authenticated = true;
        } catch (error) {
          context.errors.push({
            field: null,
            message: 'Invalid authentication token',
            code: 'AUTH_INVALID'
          });
        }
      }
    });

    // Input sanitization
    api.hook('beforeValidate', async (context) => {
      if (context.data) {
        context.data = sanitizeObject(context.data);
      }
    });

    // SQL injection protection for MySQL
    api.hook('beforeQuery', async (context) => {
      if (context.params.filter) {
        // Validate filter keys against schema
        const type = context.options.type;
        const schema = api.schemas.get(type);
        
        if (schema) {
          for (const key in context.params.filter) {
            if (!schema.structure[key] && !options.allowUnknownFilters) {
              delete context.params.filter[key];
            }
          }
        }
      }
    });

    // Add security methods
    api.generateToken = (payload, expiresIn = '24h') => {
      // This would use JWT in production
      return Buffer.from(JSON.stringify({
        ...payload,
        exp: Date.now() + parseDuration(expiresIn)
      })).toString('base64');
    };

    api.verifyToken = (token) => {
      try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        if (decoded.exp && decoded.exp < Date.now()) {
          throw new Error('Token expired');
        }
        return decoded;
      } catch (error) {
        throw new Error('Invalid token');
      }
    };
  }
};

// Helper functions
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  
  const sanitized = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Remove potential XSS in keys
    const cleanKey = key.replace(/[<>]/g, '');
    
    if (typeof value === 'string') {
      // Basic XSS prevention
      sanitized[cleanKey] = value
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    } else if (typeof value === 'object') {
      sanitized[cleanKey] = sanitizeObject(value);
    } else {
      sanitized[cleanKey] = value;
    }
  }
  
  return sanitized;
}

function parseDuration(duration) {
  const units = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 24 * 60 * 60 * 1000; // Default 24h
  
  return parseInt(match[1]) * units[match[2]];
}