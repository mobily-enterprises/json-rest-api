# HTTP EXPLANATION

## Complete Deep Dive into the HTTP Plugin for JSON REST API

This document provides an exhaustive explanation of the HTTP plugin (`plugins/http.js`), which implements JSON:API-compliant RESTful endpoints for the JSON REST API library.

## Table of Contents
1. [Overview](#overview)
2. [Plugin Structure](#plugin-structure)
3. [Helper Functions Deep Dive](#helper-functions-deep-dive)
   - [parseJsonApiBody](#parsejsonapibody)
   - [formatErrors](#formaterrors)
   - [parseQueryParams](#parsequeryparams)
   - [buildLinks](#buildlinks)
4. [Route Implementation](#route-implementation)
5. [JSON:API Specification Compliance](#jsonapi-specification-compliance)

## Overview

The HTTP plugin transforms the core API functionality into RESTful HTTP endpoints that strictly follow the JSON:API specification (https://jsonapi.org/). It acts as a bridge between Express.js HTTP requests and the internal API methods.

## Plugin Structure

```javascript
export const HTTPPlugin = {
  install(api, options = {}) {
    // Plugin initialization
  }
}
```

The plugin follows a standard pattern where:
- **`install`** method is called when the plugin is registered with `api.use(HTTPPlugin, options)`
- **`api`** parameter is the API instance to extend
- **`options`** parameter contains configuration like `basePath`, `app`, etc.

## Helper Functions Deep Dive

### parseJsonApiBody

```javascript
const parseJsonApiBody = (body) => {
  if (body.data) {
    if (body.data.attributes) {
      // JSON:API format
      return { ...body.data.attributes, id: body.data.id };
    }
    // Assume data is the actual data
    return body.data;
  }
  // Plain format
  return body;
};
```

**Purpose**: Normalizes incoming request bodies from JSON:API format to internal format.

**Data Sources**:
- `body`: The parsed JSON request body from Express.js middleware
- Comes from `req.body` in POST/PATCH requests

**Data Transformation Stages**:

1. **JSON:API Format Detection** (when `body.data` exists):
   ```javascript
   // Input (JSON:API compliant):
   {
     "data": {
       "type": "users",
       "id": "123",
       "attributes": {
         "name": "John Doe",
         "email": "john@example.com"
       }
     }
   }
   
   // Output (internal format):
   {
     "id": "123",
     "name": "John Doe",
     "email": "john@example.com"
   }
   ```

2. **Simplified Format** (when `body.data` exists but no `attributes`):
   ```javascript
   // Input:
   {
     "data": {
       "name": "John Doe",
       "email": "john@example.com"
     }
   }
   
   // Output:
   {
     "name": "John Doe",
     "email": "john@example.com"
   }
   ```

3. **Plain Format** (no `body.data`):
   ```javascript
   // Input:
   {
     "name": "John Doe",
     "email": "john@example.com"
   }
   
   // Output (unchanged):
   {
     "name": "John Doe",
     "email": "john@example.com"
   }
   ```

**JSON:API Specification Reference**: 
- Section 14.1: Creating Resources specifies that new resources MUST be sent as `data` with `type` and `attributes`
- The function supports both strict JSON:API and a more lenient format for developer convenience

### formatErrors

```javascript
const formatErrors = (errors, status = 400) => {
  if (!Array.isArray(errors)) {
    errors = [errors];
  }

  return {
    errors: errors.map(err => {
      if (err.status) return err; // Already formatted
      
      return {
        status: String(status),
        title: err.code || 'Error',
        detail: err.message || String(err),
        source: err.field ? { pointer: `/data/attributes/${err.field}` } : undefined
      };
    })
  };
};
```

**Purpose**: Converts internal errors to JSON:API-compliant error format.

**Data Sources**:
- `errors`: Can be a single error object, array of errors, or Error instance
- `status`: HTTP status code (defaults to 400 Bad Request)
- Errors come from validation failures, database errors, or business logic violations

**Data Transformation Examples**:

1. **Validation Error with Field**:
   ```javascript
   // Input:
   {
     message: "Email is required",
     field: "email",
     code: "REQUIRED_FIELD"
   }
   
   // Output:
   {
     "errors": [{
       "status": "400",
       "title": "REQUIRED_FIELD",
       "detail": "Email is required",
       "source": {
         "pointer": "/data/attributes/email"
       }
     }]
   }
   ```

2. **Generic Error**:
   ```javascript
   // Input:
   new Error("Database connection failed")
   
   // Output:
   {
     "errors": [{
       "status": "500",
       "title": "Error",
       "detail": "Database connection failed"
     }]
   }
   ```

3. **Pre-formatted Error** (passes through unchanged):
   ```javascript
   // Input:
   {
     status: "409",
     title: "Conflict",
     detail: "Resource already exists"
   }
   
   // Output:
   {
     "errors": [{
       "status": "409",
       "title": "Conflict",
       "detail": "Resource already exists"
     }]
   }
   ```

**JSON:API Specification Reference**:
- Section 7: Error Objects specifies the structure
- Required: errors MUST be returned as an array under `errors` key
- `status`: HTTP status code as string
- `title`: Short, human-readable summary
- `detail`: Human-readable explanation specific to this occurrence
- `source.pointer`: JSON Pointer to the associated entity in the request document

### parseQueryParams

```javascript
const parseQueryParams = (req) => {
  const params = {
    filter: {},
    sort: req.query.sort,
    page: {
      size: req.query['page[size]'] || req.query.pageSize,
      number: req.query['page[number]'] || req.query.page
    },
    include: req.query.include,
    fields: {}
  };

  // Parse filters
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith('filter[') && key.endsWith(']')) {
      const filterKey = key.slice(7, -1);
      params.filter[filterKey] = value;
    } else if (key.startsWith('fields[') && key.endsWith(']')) {
      const fieldType = key.slice(7, -1);
      params.fields[fieldType] = value.split(',');
    }
  }

  // Legacy filter support
  if (Object.keys(params.filter).length === 0) {
    for (const [key, value] of Object.entries(req.query)) {
      if (!['sort', 'page', 'pageSize', 'include', 'fields'].includes(key) &&
          !key.includes('[')) {
        params.filter[key] = value;
      }
    }
  }

  return params;
};
```

**Purpose**: Parses URL query parameters according to JSON:API specification and legacy formats.

**Data Sources**:
- `req`: Express request object
- `req.query`: Parsed query string object from Express

**Query Parameter Examples**:

1. **Filtering** (JSON:API format):
   ```
   GET /api/1.0.0/users?filter[name]=John&filter[active]=true
   
   // req.query:
   {
     "filter[name]": "John",
     "filter[active]": "true"
   }
   
   // Output params.filter:
   {
     "name": "John",
     "active": "true"
   }
   ```

2. **Pagination**:
   ```
   GET /api/1.0.0/users?page[size]=20&page[number]=3
   
   // Also supports legacy format:
   GET /api/1.0.0/users?pageSize=20&page=3
   
   // Output params.page:
   {
     "size": "20",
     "number": "3"
   }
   ```

3. **Sorting**:
   ```
   GET /api/1.0.0/users?sort=-createdAt,name
   
   // Output params.sort:
   "-createdAt,name"  // Minus prefix means descending
   ```

4. **Sparse Fieldsets**:
   ```
   GET /api/1.0.0/users?fields[users]=name,email&fields[posts]=title
   
   // Output params.fields:
   {
     "users": ["name", "email"],
     "posts": ["title"]
   }
   ```

5. **Including Related Resources**:
   ```
   GET /api/1.0.0/users?include=posts,comments
   
   // Output params.include:
   "posts,comments"
   ```

6. **Legacy Filter Support** (non-JSON:API):
   ```
   GET /api/1.0.0/users?name=John&active=true
   
   // Output params.filter:
   {
     "name": "John",
     "active": "true"
   }
   ```

**JSON:API Specification Reference**:
- Section 4.1: Fetching Data specifies query parameter formats
- `filter[]`: For filtering resources (implementation-specific)
- `page[]`: For pagination (size/number or limit/offset)
- `sort`: Comma-separated list of fields, minus prefix for descending
- `fields[]`: Sparse fieldsets to limit returned fields
- `include`: Related resources to include

### buildLinks

```javascript
const buildLinks = (req, params, meta) => {
  const links = {};
  const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
  const queryParams = new URLSearchParams(req.query);

  // Self link
  links.self = `${baseUrl}?${queryParams}`;

  if (meta.totalPages > 1) {
    const currentPage = meta.pageNumber;

    // First page
    queryParams.set('page[number]', '1');
    links.first = `${baseUrl}?${queryParams}`;

    // Last page
    queryParams.set('page[number]', String(meta.totalPages));
    links.last = `${baseUrl}?${queryParams}`;

    // Previous page
    if (currentPage > 1) {
      queryParams.set('page[number]', String(currentPage - 1));
      links.prev = `${baseUrl}?${queryParams}`;
    }

    // Next page
    if (currentPage < meta.totalPages) {
      queryParams.set('page[number]', String(currentPage + 1));
      links.next = `${baseUrl}?${queryParams}`;
    }
  }

  return links;
};
```

**Purpose**: Generates HATEOAS (Hypermedia as the Engine of Application State) links for pagination navigation.

**Data Sources**:
- `req`: Express request object for URL construction
  - `req.protocol`: 'http' or 'https'
  - `req.get('host')`: Domain and port
  - `req.baseUrl`: Base URL path (e.g., '/api')
  - `req.path`: Current path (e.g., '/1.0.0/users')
  - `req.query`: Original query parameters
- `params`: Parsed query parameters (unused but available)
- `meta`: Pagination metadata from query results
  - `meta.totalPages`: Total number of pages
  - `meta.pageNumber`: Current page number

**Link Generation Examples**:

1. **Single Page Results** (no pagination links):
   ```javascript
   // Request: GET http://example.com/api/1.0.0/users?filter[active]=true
   // Meta: { totalPages: 1, pageNumber: 1 }
   
   // Output:
   {
     "self": "http://example.com/api/1.0.0/users?filter[active]=true"
   }
   ```

2. **First Page of Multiple**:
   ```javascript
   // Request: GET http://example.com/api/1.0.0/users?page[size]=10&page[number]=1
   // Meta: { totalPages: 5, pageNumber: 1 }
   
   // Output:
   {
     "self": "http://example.com/api/1.0.0/users?page[size]=10&page[number]=1",
     "first": "http://example.com/api/1.0.0/users?page[size]=10&page[number]=1",
     "last": "http://example.com/api/1.0.0/users?page[size]=10&page[number]=5",
     "next": "http://example.com/api/1.0.0/users?page[size]=10&page[number]=2"
   }
   ```

3. **Middle Page**:
   ```javascript
   // Request: GET http://example.com/api/1.0.0/users?page[number]=3&sort=name
   // Meta: { totalPages: 5, pageNumber: 3 }
   
   // Output:
   {
     "self": "http://example.com/api/1.0.0/users?page[number]=3&sort=name",
     "first": "http://example.com/api/1.0.0/users?page[number]=1&sort=name",
     "last": "http://example.com/api/1.0.0/users?page[number]=5&sort=name",
     "prev": "http://example.com/api/1.0.0/users?page[number]=2&sort=name",
     "next": "http://example.com/api/1.0.0/users?page[number]=4&sort=name"
   }
   ```

**URL Construction Process**:
1. Build base URL from request components
2. Preserve all original query parameters using URLSearchParams
3. Modify only the `page[number]` parameter for each link
4. Maintain all filters, sorts, and other parameters across links

**JSON:API Specification Reference**:
- Section 4.5: Pagination specifies link requirements
- `self`: Link to the current page (always required)
- `first`: First page of results
- `last`: Last page of results
- `prev`: Previous page (only if not on first page)
- `next`: Next page (only if not on last page)

## Route Implementation

The plugin implements standard RESTful routes with JSON:API compliance:

### GET /:type (Collection)
```javascript
router.get(`${routePrefix}/:type`, async (req, res) => {
  // 1. Parse query parameters
  // 2. Call api.query() with parsed params
  // 3. Add pagination links
  // 4. Return JSON:API response
});
```

**Request Flow**:
1. `parseQueryParams(req)` extracts filters, sorting, pagination
2. `api.query()` fetches filtered/sorted/paginated results
3. `buildLinks()` adds navigation links if paginated
4. Response format:
   ```json
   {
     "data": [...],
     "meta": { "total": 100, "pageSize": 10, "pageNumber": 1 },
     "links": { "self": "...", "next": "..." }
   }
   ```

### GET /:type/:id (Single Resource)
```javascript
router.get(`${routePrefix}/:type/:id`, async (req, res) => {
  // 1. Call api.get() with ID
  // 2. Return 404 if not found
  // 3. Return JSON:API response
});
```

**Response Format**:
```json
{
  "data": {
    "type": "users",
    "id": "123",
    "attributes": { ... }
  }
}
```

### POST /:type (Create)
```javascript
router.post(`${routePrefix}/:type`, async (req, res) => {
  // 1. Parse request body with parseJsonApiBody()
  // 2. Call api.insert()
  // 3. Return 201 Created with Location header
});
```

**Key Features**:
- Status: 201 Created
- Location header: Points to created resource
- Returns created resource in response

### PATCH /:type/:id (Update)
```javascript
router.patch(`${routePrefix}/:type/:id`, async (req, res) => {
  // 1. Parse request body
  // 2. Call api.update()
  // 3. Return updated resource or 404
});
```

### DELETE /:type/:id (Delete)
```javascript
router.delete(`${routePrefix}/:type/:id`, async (req, res) => {
  // 1. Call api.delete()
  // 2. Return 204 No Content on success
});
```

**Key Features**:
- Status: 204 No Content
- No response body on success

## JSON:API Specification Compliance

### Document Structure
All responses follow the JSON:API document structure:
```json
{
  "data": { },      // Primary data (resource or array)
  "errors": [ ],    // Array of error objects (never with data)
  "meta": { },      // Non-standard meta-information
  "links": { },     // Links related to the primary data
  "included": [ ]   // Related resources (not implemented yet)
}
```

### Content Type
The plugin accepts both:
- `application/json` (standard JSON)
- `application/vnd.api+json` (JSON:API media type)

### Error Handling
All errors return proper JSON:API error objects with:
- `status`: HTTP status code
- `title`: Error summary
- `detail`: Specific error message
- `source.pointer`: Points to problematic field

### Query Parameters
Fully supports JSON:API query parameters:
- Filtering: `?filter[name]=value`
- Sorting: `?sort=-created,name`
- Pagination: `?page[size]=10&page[number]=2`
- Sparse Fieldsets: `?fields[users]=name,email`
- Including Relationships: `?include=posts,comments`

### CORS Support
The OPTIONS route enables CORS with appropriate headers for cross-origin requests.

### Versioning
When API versioning is enabled:
- Routes include version prefix: `/api/1.0.0/resources`
- API-Version header is added to all responses
- Supports version negotiation (future enhancement)

## Additional Features

### Express Middleware Integration
```javascript
router.use(express.json({
  type: ['application/json', 'application/vnd.api+json']
}));
```
Configures Express to parse both standard JSON and JSON:API content types.

### Mount Flexibility
```javascript
api.mount = (app, path = basePath) => {
  app.use(path, router);
  return api;
};
```
Allows mounting at any path on the Express app.

### Middleware Support
```javascript
api.useMiddleware = (middleware) => {
  router.use(middleware);
  return api;
};
```
Enables adding custom middleware (authentication, logging, etc.).

## Error Status Codes

The plugin uses appropriate HTTP status codes:
- **200 OK**: Successful GET requests
- **201 Created**: Successful POST with new resource
- **204 No Content**: Successful DELETE
- **400 Bad Request**: Validation errors, malformed requests
- **404 Not Found**: Resource doesn't exist
- **500 Internal Server Error**: Unexpected errors

Each status code is chosen to match REST conventions and help clients handle responses appropriately.