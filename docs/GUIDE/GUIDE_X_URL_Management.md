# URL Management in JSON REST API

## Overview

JSON REST API generates JSON:API links and `Location` headers from explicit library configuration. By default, generated URLs are relative to the configured transport `mountPath`.

Request headers such as `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` are not trusted for URL generation. This keeps links from reflecting attacker-controlled request headers.

## Default Relative Links

For a standard Express or Fastify setup:

```javascript
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' });
```

Generated links use the mount path:

```json
{
  "data": {
    "type": "books",
    "id": "123",
    "links": {
      "self": "/api/books/123"
    }
  }
}
```

This is the recommended default for most deployments. Browsers and HTTP clients resolve the relative links against the origin they already used to call the API.

## Absolute Public Links

When clients require absolute public URLs, configure the connector with `publicBaseUrl`. The value is the complete public URL prefix for generated API links, including any public path prefix such as `/api`.

```javascript
await api.use(ExpressPlugin, {
  mountPath: '/api',
  publicBaseUrl: 'https://api.example.com/api'
});
```

Fastify uses the same option:

```javascript
await api.use(FastifyPlugin, {
  app,
  mountPath: '/api',
  publicBaseUrl: 'https://api.example.com/api'
});
```

Generated links then use the configured public base URL:

```json
{
  "links": {
    "self": "https://api.example.com/api/books/123"
  }
}
```

Trailing slashes on `publicBaseUrl` are normalized before links are built.

## Per-Request Overrides

For multi-tenant deployments or API gateways with request-specific public URLs, set `context.urlPrefixOverride` in a `transport:request` hook. Only set this from trusted configuration or validated request metadata.

```javascript
await api.customize({
  hooks: {
    'transport:request': {
      functionName: 'tenant-url-prefix',
      handler: async ({ context }) => {
        const tenantId = context.auth?.tenantId;
        const tenantPublicUrls = {
          tenant_a: 'https://tenant-a.example.com/api',
          tenant_b: 'https://tenant-b.example.com/api'
        };

        if (tenantPublicUrls[tenantId]) {
          context.urlPrefixOverride = tenantPublicUrls[tenantId];
        }
      }
    }
  }
});
```

Express middleware can also set `req.urlPrefixOverride` before the API router runs:

```javascript
const allowedPublicUrls = new Set([
  'https://api.example.com/api',
  'https://partner.example.com/api'
]);

app.use((req, res, next) => {
  const requestedPublicUrl = req.get('x-public-url');
  if (allowedPublicUrls.has(requestedPublicUrl)) {
    req.urlPrefixOverride = requestedPublicUrl;
  }
  next();
});

api.http.express.mount(app);
```

Do not copy arbitrary `Host`, `X-Forwarded-Host`, or custom public URL headers into `urlPrefixOverride`. If a reverse proxy supplies public URL metadata, validate it against trusted configuration first.

## Priority Order

URL prefix resolution uses this order:

1. `context.urlPrefixOverride`
2. Connector `publicBaseUrl`
3. Connector `mountPath`
4. Empty string

The same helper is used for resource links, relationship links, pagination links, and connector `Location` headers.

## Reverse Proxies

A reverse proxy should still forward requests to the Node.js application normally, but URL generation does not require forwarding public host headers.

Use explicit configuration for public links:

```javascript
await api.use(ExpressPlugin, {
  mountPath: '/api',
  publicBaseUrl: process.env.PUBLIC_API_URL
});
```

Set `PUBLIC_API_URL` to the externally visible API prefix, for example `https://api.example.com/api`.

## Troubleshooting

### Links are relative

This is the default behavior. Configure `publicBaseUrl` if your clients require absolute URLs.

### Links are missing a public path prefix

Include the public path prefix in `publicBaseUrl`.

```javascript
publicBaseUrl: 'https://api.example.com/v2'
```

### Multi-tenant links need different hosts

Use `context.urlPrefixOverride` from trusted tenant or auth state. Avoid deriving tenant URLs directly from untrusted request host headers.
