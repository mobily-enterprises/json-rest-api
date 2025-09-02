# URL Management in JSON REST API

## Overview

The JSON REST API automatically generates appropriate URLs for all resources in JSON:API responses. URLs are calculated **per-request** based on the incoming request headers, ensuring correct URLs in all deployment scenarios without configuration.

## How It Works

### Automatic URL Detection

URLs in responses (links, hrefs) are automatically generated based on:

1. **Protocol**: Detected from `X-Forwarded-Proto` header or request protocol
2. **Host**: Detected from `X-Forwarded-Host` or `Host` header  
3. **Mount Path**: Where your API routes are mounted (e.g., `/api`)

```javascript
// Example: Simple setup - no URL configuration needed!
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' });
```

### Different Deployment Scenarios

#### Local Development
```
Request: GET http://localhost:3000/api/books
Response links: http://localhost:3000/api/books/1
```

#### Production with Domain
```
Request: GET https://api.example.com/api/books
Response links: https://api.example.com/api/books/1
```

#### Behind Reverse Proxy (Nginx/Apache)
```nginx
# Nginx configuration
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_pass http://backend:3000;
```

```
Request headers:
  X-Forwarded-Proto: https
  X-Forwarded-Host: api.example.com
Response links: https://api.example.com/api/books/1
```

#### Multi-Tenant SaaS
Each tenant gets their own domain in responses automatically:
```
Tenant A request: GET https://customer-a.api.com/api/books
Response links: https://customer-a.api.com/api/books/1

Tenant B request: GET https://customer-b.api.com/api/books  
Response links: https://customer-b.api.com/api/books/1
```

## Advanced: Custom URL Override

For complex deployments (API gateways, CDNs, etc.), you can override URL generation using hooks.

### Recommended Method: API Hooks (Best Practice)

Define a hook when creating your API to handle URL overrides:

```javascript
const api = new Api({ 
  name: 'my-api',
  
  // Define hooks at API creation time
  hooks: {
    'transport:request:start': [
      async (payload) => {
        const { context, req } = payload;
        
        // Example: Override based on custom header
        if (req?.headers?.['x-public-url']) {
          context.urlPrefixOverride = req.headers['x-public-url'];
        }
        
        // Example: API versioning
        if (req?.headers?.['x-api-version'] === 'v2') {
          context.urlPrefixOverride = 'https://api.example.com/v2';
        }
        
        // Example: Multi-tenant based on host
        const host = req?.hostname;
        if (host?.includes('tenant-a')) {
          context.urlPrefixOverride = 'https://tenant-a.api.com/api';
        }
        
        // Example: Environment-based override
        if (process.env.PUBLIC_API_URL) {
          context.urlPrefixOverride = process.env.PUBLIC_API_URL;
        }
        
        return payload;
      }
    ]
  }
});

// Then use plugins normally
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' });
```

### Alternative Method: Express Middleware

If you cannot use hooks, you can use Express middleware before mounting the API:

```javascript
app.use((req, res, next) => {
  // Set urlPrefixOverride on the request
  if (req.headers['x-public-url']) {
    req.urlPrefixOverride = req.headers['x-public-url'];
  }
  next();
});

// Then mount your API
app.use(api.http.express.router);
```

### Common Use Cases for Override

1. **API Gateway with Path Rewriting**
   ```javascript
   hooks: {
     'transport:request:start': [async (payload) => {
       if (payload.req?.headers?.['x-forwarded-prefix'] === '/v2') {
         payload.context.urlPrefixOverride = 'https://api.company.com/v2';
       }
       return payload;
     }]
   }
   ```

2. **CDN with Different Public URL**
   ```javascript
   hooks: {
     'transport:request:start': [async (payload) => {
       if (payload.req?.headers?.['x-cdn-host']) {
         payload.context.urlPrefixOverride = `https://${payload.req.headers['x-cdn-host']}/api`;
       }
       return payload;
     }]
   }
   ```

3. **Multi-Tenant SaaS**
   ```javascript
   hooks: {
     'transport:request:start': [async (payload) => {
       const { context, req } = payload;
       const tenant = req?.hostname?.split('.')[0];
       if (tenant && tenant !== 'api') {
         context.urlPrefixOverride = `https://${tenant}.api.com/api`;
       }
       return payload;
     }]
   }
   ```

4. **Environment-Based URLs**
   ```javascript
   hooks: {
     'transport:request:start': [async (payload) => {
       // Force production URLs in staging for testing
       if (process.env.NODE_ENV === 'staging' && process.env.PRODUCTION_URL) {
         payload.context.urlPrefixOverride = process.env.PRODUCTION_URL;
       }
       return payload;
     }]
   }
   ```

## What You DON'T Need to Configure

❌ **No need for:**
- Static URL configuration
- Per-environment URL settings
- Manual protocol detection
- Proxy configuration in the API

The system automatically handles:
- HTTP vs HTTPS detection
- Domain detection from headers
- Proxy headers (`X-Forwarded-*`)
- Port numbers
- Mount paths

## URL Generation Examples

### Resource URLs
```javascript
// Generated in responses as:
{
  "type": "books",
  "id": "123",
  "attributes": { ... },
  "links": {
    "self": "https://api.example.com/api/books/123"  // Automatically generated
  }
}
```

### Relationship URLs
```javascript
{
  "relationships": {
    "author": {
      "links": {
        "self": "https://api.example.com/api/books/123/relationships/author",
        "related": "https://api.example.com/api/books/123/author"
      }
    }
  }
}
```

### Pagination URLs
```javascript
{
  "links": {
    "self": "https://api.example.com/api/books?page[number]=2",
    "first": "https://api.example.com/api/books?page[number]=1",
    "prev": "https://api.example.com/api/books?page[number]=1",
    "next": "https://api.example.com/api/books?page[number]=3",
    "last": "https://api.example.com/api/books?page[number]=10"
  }
}
```

## Benefits of Per-Request URL Generation

1. **Zero Configuration**: Works correctly out of the box
2. **Multi-Domain Safe**: Each request gets appropriate URLs
3. **Proxy Friendly**: Automatically handles reverse proxies
4. **Flexible**: Override when needed for complex scenarios
5. **Stateless**: No global state that can be contaminated

## Troubleshooting

### URLs are showing localhost in production
- Ensure your reverse proxy is setting `X-Forwarded-Host` and `X-Forwarded-Proto` headers
- Check that these headers are being passed through to your application

### Need different URLs for different environments
- Use the `urlPrefixOverride` pattern with environment variables
- Set `PUBLIC_API_URL` environment variable appropriately

### API Gateway stripping paths
- Use middleware to set `req.urlPrefixOverride` with the full public path
- Include any path prefixes that the gateway strips

## Complete Working Example

Here's a full example showing URL override with hooks:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';
import express from 'express';

// Create API with URL override hook
const api = new Api({ 
  name: 'my-api',
  hooks: {
    'transport:request:start': [
      async (payload) => {
        const { context, req } = payload;
        
        // Check for custom public URL header
        if (req?.headers?.['x-public-url']) {
          context.urlPrefixOverride = req.headers['x-public-url'];
        }
        
        return payload;
      }
    ]
  }
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' });

// Define resources...
await api.addResource('books', { /* schema */ });

// Create Express app
const app = express();
app.use(api.http.express.router);
app.listen(3000);
```

Now your API automatically handles:
- `curl http://localhost:3000/api/books` → URLs: `http://localhost:3000/api/books/1`
- `curl -H "X-Public-URL: https://cdn.example.com/api" http://localhost:3000/api/books` → URLs: `https://cdn.example.com/api/books/1`

## Summary

The JSON REST API's URL management system provides:
- **Automatic detection** for 99% of use cases
- **Hook-based override** for complex deployments
- **Per-request isolation** preventing cross-domain issues
- **No configuration** required for standard deployments

Just set your `mountPath` in the Express plugin and optionally define hooks for custom scenarios!