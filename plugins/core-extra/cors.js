/**
 * CORS Plugin with automatic platform detection
 * 
 * Zero-config CORS that works everywhere:
 * - Development: Auto-allows localhost
 * - Production: Uses environment variables
 * - Platforms: Auto-detects Vercel, Netlify, Heroku, etc.
 */

// Platform detection functions
const platformDetectors = {
  // Vercel
  vercel: () => {
    if (process.env.VERCEL) {
      const urls = [];
      if (process.env.VERCEL_URL) {
        urls.push(`https://${process.env.VERCEL_URL}`);
      }
      if (process.env.VERCEL_BRANCH_URL) {
        urls.push(`https://${process.env.VERCEL_BRANCH_URL}`);
      }
      if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
        urls.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Netlify
  netlify: () => {
    if (process.env.NETLIFY) {
      const urls = [];
      if (process.env.URL) {
        urls.push(process.env.URL);
      }
      if (process.env.DEPLOY_URL) {
        urls.push(process.env.DEPLOY_URL);
      }
      if (process.env.DEPLOY_PRIME_URL) {
        urls.push(process.env.DEPLOY_PRIME_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Heroku
  heroku: () => {
    if (process.env.DYNO) {
      const appName = process.env.HEROKU_APP_NAME;
      if (appName) {
        return [`https://${appName}.herokuapp.com`];
      }
    }
    return null;
  },

  // AWS Amplify
  amplify: () => {
    if (process.env.AWS_APP_ID) {
      const urls = [];
      if (process.env.AWS_BRANCH_URL) {
        urls.push(process.env.AWS_BRANCH_URL);
      }
      if (process.env.AWS_APP_URL) {
        urls.push(process.env.AWS_APP_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Railway
  railway: () => {
    if (process.env.RAILWAY_ENVIRONMENT) {
      const urls = [];
      if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        urls.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
      }
      if (process.env.RAILWAY_STATIC_URL) {
        urls.push(process.env.RAILWAY_STATIC_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Render
  render: () => {
    if (process.env.RENDER) {
      const urls = [];
      if (process.env.RENDER_EXTERNAL_URL) {
        urls.push(process.env.RENDER_EXTERNAL_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Google Cloud Run
  cloudRun: () => {
    if (process.env.K_SERVICE) {
      const urls = [];
      if (process.env.CLOUD_RUN_SERVICE_URL) {
        urls.push(process.env.CLOUD_RUN_SERVICE_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Azure Web Apps
  azure: () => {
    if (process.env.WEBSITE_INSTANCE_ID) {
      const urls = [];
      if (process.env.WEBSITE_HOSTNAME) {
        urls.push(`https://${process.env.WEBSITE_HOSTNAME}`);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // DigitalOcean App Platform
  digitalocean: () => {
    if (process.env.DO_APP_ID) {
      const urls = [];
      if (process.env.APP_URL) {
        urls.push(process.env.APP_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Fly.io
  fly: () => {
    if (process.env.FLY_APP_NAME) {
      const urls = [];
      if (process.env.FLY_PUBLIC_IP) {
        urls.push(`https://${process.env.FLY_APP_NAME}.fly.dev`);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Cloudflare Workers/Pages
  cloudflare: () => {
    if (process.env.CF_PAGES) {
      const urls = [];
      if (process.env.CF_PAGES_URL) {
        urls.push(process.env.CF_PAGES_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Deno Deploy
  deno: () => {
    if (process.env.DENO_DEPLOYMENT_ID) {
      const urls = [];
      if (process.env.DENO_URL) {
        urls.push(process.env.DENO_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Replit
  replit: () => {
    if (process.env.REPL_OWNER) {
      const urls = [];
      if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
        urls.push(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Glitch
  glitch: () => {
    if (process.env.PROJECT_DOMAIN) {
      return [`https://${process.env.PROJECT_DOMAIN}.glitch.me`];
    }
    return null;
  },

  // CodeSandbox
  codesandbox: () => {
    if (process.env.CODESANDBOX_HOST) {
      return [process.env.CODESANDBOX_HOST];
    }
    return null;
  },

  // StackBlitz
  stackblitz: () => {
    if (process.env.STACKBLITZ_ENV) {
      const urls = [];
      if (process.env.STACKBLITZ_URL) {
        urls.push(process.env.STACKBLITZ_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // GitHub Codespaces
  codespaces: () => {
    if (process.env.CODESPACES) {
      const urls = [];
      if (process.env.CODESPACE_NAME) {
        urls.push(`https://${process.env.CODESPACE_NAME}.github.dev`);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  },

  // Gitpod
  gitpod: () => {
    if (process.env.GITPOD_WORKSPACE_ID) {
      const urls = [];
      if (process.env.GITPOD_WORKSPACE_URL) {
        urls.push(process.env.GITPOD_WORKSPACE_URL);
      }
      return urls.length > 0 ? urls : null;
    }
    return null;
  }
};

// Development patterns
const developmentPatterns = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/0\.0\.0\.0(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,  // IPv6 localhost
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,  // Local network
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,  // Local network
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,  // Docker
  /^https?:\/\/[^.]+\.(local|test|dev|localhost)(:\d+)?$/,  // Custom local domains
  /^https?:\/\/[^.]+\.ngrok\.io$/,  // ngrok tunnels
  /^https?:\/\/[^.]+\.loca\.lt$/,  // localtunnel
  /^https?:\/\/[^.]+\.trycloudflare\.com$/,  // Cloudflare tunnels
  /^capacitor:\/\/localhost$/,  // Capacitor mobile
  /^ionic:\/\/localhost$/,  // Ionic mobile
  /^http:\/\/localhost$/,  // Mobile webviews
  /^file:\/\/.*$/  // Electron apps
];

export const CorsPlugin = {
  name: 'CorsPlugin',
  version: '1.0.0',
  
  install(api, options = {}) {
    // Get CORS configuration
    const corsConfig = this.getCorsConfig(options);
    
    // Store current request for dynamic CORS
    let currentRequest = null;
    
    // Add CORS middleware to router if available
    if (api.router) {
      api.router.use((req, res, next) => {
        currentRequest = req;
        this.applyCors(req, res, corsConfig);
        
        // Handle preflight
        if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
        }
        
        next();
      });
    }
    
    // Add hook for non-HTTP contexts
    api.hook('beforeOperation', async (context) => {
      if (context.options.request && context.options.response) {
        this.applyCors(
          context.options.request,
          context.options.response,
          corsConfig
        );
      }
    }, 1); // High priority
  },
  
  getCorsConfig(options) {
    // 1. If explicit function provided, use it
    if (typeof options.cors === 'function') {
      return {
        origin: options.cors,
        credentials: options.cors.credentials !== false,
        methods: options.cors.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: options.cors.allowedHeaders || ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: options.cors.exposedHeaders || ['X-Total-Count', 'Link', 'X-Request-ID'],
        maxAge: options.cors.maxAge || 86400
      };
    }
    
    // 2. If explicit config provided, validate and use it
    if (options.cors?.origin !== undefined) {
      // Security check
      if (options.cors.origin === '*' && options.cors.credentials === true) {
        console.error('🚨 SECURITY ERROR: Cannot use credentials:true with origin:*');
        console.error('   This would allow any website to make authenticated requests!');
        console.error('   Setting credentials to false for safety.');
        options.cors.credentials = false;
      }
      
      return {
        origin: options.cors.origin,
        credentials: options.cors.credentials !== false,
        methods: options.cors.methods || ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: options.cors.allowedHeaders || ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: options.cors.exposedHeaders || ['X-Total-Count', 'Link', 'X-Request-ID'],
        maxAge: options.cors.maxAge || 86400
      };
    }
    
    // 3. Auto-detect based on environment
    const env = process.env.NODE_ENV || 'development';
    const isProduction = env === 'production' || env === 'prod';
    
    // 4. Try platform auto-detection
    for (const [platform, detector] of Object.entries(platformDetectors)) {
      const origins = detector();
      if (origins) {
        if (options.debug) {
          console.log(`📍 Detected platform: ${platform}`);
          console.log(`   Auto-configured CORS origins:`, origins);
        }
        
        return {
          origin: origins,
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
          exposedHeaders: ['X-Total-Count', 'Link', 'X-Request-ID'],
          maxAge: 86400
        };
      }
    }
    
    // 5. Check environment variables
    const envOrigins = 
      process.env.CORS_ORIGINS || 
      process.env.CORS_ORIGIN ||
      process.env.ALLOWED_ORIGINS ||
      process.env.ALLOWED_ORIGIN ||
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      process.env.APP_URL ||
      process.env.WEB_URL ||
      process.env.PUBLIC_URL;
    
    if (envOrigins) {
      const origins = envOrigins.includes(',') 
        ? envOrigins.split(',').map(o => o.trim()).filter(Boolean)
        : [envOrigins.trim()];
      
      return {
        origin: origins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-Total-Count', 'Link', 'X-Request-ID'],
        maxAge: 86400
      };
    }
    
    // 6. Production without configuration
    if (isProduction) {
      console.error('⚠️  WARNING: CORS not configured for production!');
      console.error('   Set one of these environment variables:');
      console.error('   - CORS_ORIGINS (recommended): comma-separated list of allowed origins');
      console.error('   - FRONTEND_URL: URL of your frontend application');
      console.error('   Example: CORS_ORIGINS=https://myapp.com,https://www.myapp.com');
      console.error('');
      console.error('   Using restrictive defaults (no cross-origin requests allowed)');
      
      return {
        origin: false,  // Deny all cross-origin requests
        credentials: false,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-Total-Count', 'Link', 'X-Request-ID'],
        maxAge: 86400
      };
    }
    
    // 7. Development defaults
    if (options.debug) {
      console.log('🔧 Development mode: Using permissive CORS settings');
    }
    
    return {
      origin: developmentPatterns,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['X-Total-Count', 'Link', 'X-Request-ID'],
      maxAge: 86400
    };
  },
  
  async applyCors(req, res, config) {
    const origin = req.headers.origin || req.headers.referer;
    
    if (!origin && !config.allowNoOrigin) {
      // No origin header - likely same-origin or non-browser request
      return;
    }
    
    let allowed = false;
    let allowedOrigin = null;
    
    // Check if origin is allowed
    if (typeof config.origin === 'function') {
      // Dynamic origin function
      try {
        allowed = await new Promise((resolve, reject) => {
          const callback = (err, result) => {
            if (err) reject(err);
            else resolve(result);
          };
          
          // Support both sync and async functions
          const result = config.origin(origin, callback);
          if (result !== undefined) {
            resolve(result);
          }
        });
        
        if (allowed === true) {
          allowedOrigin = origin;
        } else if (typeof allowed === 'string') {
          allowedOrigin = allowed;
          allowed = true;
        }
      } catch (error) {
        console.error('CORS origin function error:', error);
        allowed = false;
      }
    } else if (config.origin === '*') {
      allowed = true;
      allowedOrigin = '*';
    } else if (config.origin === false) {
      allowed = false;
    } else if (Array.isArray(config.origin)) {
      // Check array of origins/patterns
      for (const allowedPattern of config.origin) {
        if (allowedPattern instanceof RegExp) {
          if (allowedPattern.test(origin)) {
            allowed = true;
            allowedOrigin = origin;
            break;
          }
        } else if (allowedPattern === origin) {
          allowed = true;
          allowedOrigin = origin;
          break;
        }
      }
    } else if (config.origin instanceof RegExp) {
      if (config.origin.test(origin)) {
        allowed = true;
        allowedOrigin = origin;
      }
    } else if (typeof config.origin === 'string') {
      if (config.origin === origin) {
        allowed = true;
        allowedOrigin = origin;
      }
    }
    
    // Apply CORS headers
    if (allowed && allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      
      if (config.credentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      
      res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '));
      res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
      res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
      res.setHeader('Access-Control-Max-Age', String(config.maxAge));
      
      // Add Vary header for proper caching
      const vary = res.getHeader('Vary');
      if (vary) {
        res.setHeader('Vary', `${vary}, Origin`);
      } else {
        res.setHeader('Vary', 'Origin');
      }
    }
    
    // Debug logging
    if (config.debug || process.env.DEBUG_CORS) {
      console.log(`CORS: ${req.method} ${req.url}`);
      console.log(`  Origin: ${origin}`);
      console.log(`  Allowed: ${allowed}`);
      if (allowed) {
        console.log(`  Allowed Origin: ${allowedOrigin}`);
      }
    }
  }
};