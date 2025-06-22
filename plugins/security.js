/**
 * Security plugin implementing industry-standard security practices
 */
import DOMPurify from 'isomorphic-dompurify';
import { DistributedRateLimiter } from '../lib/distributed-rate-limiter.js';

export const SecurityPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: 'Too many requests from this IP',
        redis: null, // Redis config for distributed rate limiting
        keyGenerator: (req) => req.ip || req.connection.remoteAddress // Function to generate rate limit key
      },
      // CORS configuration moved to CorsPlugin
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

    // Initialize distributed rate limiter
    const rateLimiter = new DistributedRateLimiter({
      windowMs: defaultOptions.rateLimit.windowMs,
      max: defaultOptions.rateLimit.max,
      redis: defaultOptions.rateLimit.redis,
      keyPrefix: 'api:ratelimit:'
    });

    // Add security headers
    if (api.router) {
      // Security headers only (CORS moved to CorsPlugin)
      api.router.use((req, res, next) => {
        // Security headers
        res.header('X-Content-Type-Options', 'nosniff');
        res.header('X-Frame-Options', 'DENY');
        res.header('X-XSS-Protection', '1; mode=block');
        
        // Only add HSTS header for HTTPS connections
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
          res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }
        
        res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.header('X-Permitted-Cross-Domain-Policies', 'none');
        res.header('X-Download-Options', 'noopen');
        res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
        
        // Content Security Policy
        const csp = Object.entries(defaultOptions.contentSecurityPolicy.directives)
          .map(([key, values]) => `${key} ${values.join(' ')}`)
          .join('; ');
        res.header('Content-Security-Policy', csp);
        
        next();
      });

      // Rate limiting
      api.router.use(async (req, res, next) => {
        try {
          const key = defaultOptions.rateLimit.keyGenerator(req);
          const result = await rateLimiter.checkLimit(key);
          
          // Add rate limit headers
          res.header('X-RateLimit-Limit', String(defaultOptions.rateLimit.max));
          res.header('X-RateLimit-Remaining', String(result.remaining));
          res.header('X-RateLimit-Reset', result.resetAt.toISOString());
          
          if (!result.allowed) {
            if (result.retryAfter) {
              res.header('Retry-After', String(result.retryAfter));
            }
            
            // Emit rate limit exceeded event for audit logging
            await api.runHooks('rateLimitExceeded', {
              rateLimitKey: key,
              limit: defaultOptions.rateLimit.max,
              window: defaultOptions.rateLimit.windowMs,
              options: { request: req }
            });
            
            return res.status(429).json({
              errors: [{
                status: '429',
                title: 'Too Many Requests',
                detail: defaultOptions.rateLimit.message,
                meta: {
                  retryAfter: result.retryAfter,
                  resetAt: result.resetAt.toISOString()
                }
              }]
            });
          }
          
          next();
        } catch (error) {
          // Log error but don't block requests if rate limiting fails
          console.error('Rate limiting error:', error);
          next();
        }
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

    // Token methods removed - use JwtPlugin for JWT tokens
    
    // Add cleanup method
    api.hook('beforeDisconnect', async () => {
      if (rateLimiter) {
        await rateLimiter.close();
      }
    });
  }
};

// Helper functions
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeObject(obj, depth = 0) {
  const MAX_DEPTH = 100;
  
  if (depth > MAX_DEPTH) {
    throw new Error('Object depth exceeds maximum allowed depth');
  }
  
  if (typeof obj !== 'object' || obj === null) {
    return sanitizeValue(obj);
  }
  
  const sanitized = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Sanitize keys to prevent XSS
    const cleanKey = sanitizeValue(key, true);
    
    if (typeof value === 'object' && value !== null) {
      sanitized[cleanKey] = sanitizeObject(value, depth + 1);
    } else {
      sanitized[cleanKey] = sanitizeValue(value);
    }
  }
  
  return sanitized;
}

function sanitizeValue(value, isKey = false) {
  if (typeof value !== 'string') return value;
  
  // Block dangerous URL schemes - replace them with empty string
  value = value.replace(/(javascript|data|vbscript|file|about):[^\s]*/gi, '');
  
  // For keys, just remove dangerous characters
  if (isKey) {
    return value.replace(/[<>"'\/\\]/g, '');
  }
  
  // Use DOMPurify to sanitize string values
  // Strip all HTML tags and attributes for API context
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false
  });
}

// Duration parsing moved to JwtPlugin