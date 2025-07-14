# JSON REST API Tutorial

This tutorial will guide you through building a REST API using `jsonrestapi`. We'll start with the basics and gradually add more features.

## Quick Start

Here's a complete working example to get you started:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, HttpPlugin, FileHandlingPlugin } from 'json-rest-api';

// Create API
const api = new Api({ name: 'my-api' });

// Create a reusable in-memory storage plugin
// (In production, you'd use RestApiKnexPlugin or another database plugin)
const inMemoryStoragePlugin = {
  name: 'in-memory-storage',
  install({ helpers }) {
    const storage = new Map();
    
    // Seed with some initial data
    storage.set('books', [
      { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', year: 1925 },
      { id: '2', title: '1984', author: 'George Orwell', year: 1949 },
      { id: '3', title: 'To Kill a Mockingbird', author: 'Harper Lee', year: 1960 }
    ]);

    helpers.dataQuery = async ({ scopeName }) => {
      const records = storage.get(scopeName) || [];
      return { 
        data: records.map(record => ({
          type: scopeName,
          id: record.id,
          attributes: record
        }))
      };
    };

    helpers.dataGet = async ({ scopeName, id }) => {
      const records = storage.get(scopeName) || [];
      const record = records.find(r => r.id === id);
      
      if (!record) {
        return { data: null };
      }
      
      return {
        data: {
          type: scopeName,
          id: record.id,
          attributes: record
        }
      };
    };

    helpers.dataPost = async ({ scopeName, inputRecord }) => {
      const records = storage.get(scopeName) || [];
      const newRecord = {
        id: Date.now().toString(),
        ...inputRecord.data.attributes
      };
      
      records.push(newRecord);
      storage.set(scopeName, records);
      
      return {
        data: {
          type: scopeName,
          id: newRecord.id,
          attributes: newRecord
        }
      };
    };

    helpers.dataPut = async ({ scopeName, id, inputRecord }) => {
      const records = storage.get(scopeName) || [];
      const index = records.findIndex(r => r.id === id);
      
      if (index === -1) {
        throw new Error('Record not found');
      }
      
      records[index] = {
        id,
        ...inputRecord.data.attributes
      };
      
      return {
        data: {
          type: scopeName,
          id: id,
          attributes: records[index]
        }
      };
    };

    helpers.dataPatch = async ({ scopeName, id, inputRecord }) => {
      const records = storage.get(scopeName) || [];
      const index = records.findIndex(r => r.id === id);
      
      if (index === -1) {
        throw new Error('Record not found');
      }
      
      records[index] = {
        ...records[index],
        ...inputRecord.data.attributes
      };
      
      return {
        data: {
          type: scopeName,
          id: id,
          attributes: records[index]
        }
      };
    };

    helpers.dataDelete = async ({ scopeName, id }) => {
      const records = storage.get(scopeName) || [];
      const filtered = records.filter(r => r.id !== id);
      storage.set(scopeName, filtered);
      return { success: true };
    };

    helpers.dataExists = async ({ scopeName, id }) => {
      const records = storage.get(scopeName) || [];
      return records.some(r => r.id === id);
    };
  }
};

// Install plugins (order matters!)
await api.use(RestApiPlugin);
await api.use(inMemoryStoragePlugin);
await api.use(HttpPlugin);

// Define a resource
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' }
  }
});

// Start the server
api.http.startServer(3000);
console.log('API running at http://localhost:3000/api');

// Your API is now ready!
// GET http://localhost:3000/api/books
// POST http://localhost:3000/api/books
// etc.
```

## Table of Contents

1. [Getting Started](#getting-started)
2. [Basic REST API Plugin](#basic-rest-api-plugin)
3. [Response Control and ID Handling](#response-control-and-id-handling)
   - [Return Full Record Configuration](#return-full-record-configuration)
   - [Strict ID Handling](#strict-id-handling)
4. [Connector Plugins](#connector-plugins)
   - [Express Plugin](#express-plugin)
   - [HTTP Plugin](#http-plugin)
5. [File Storage](#file-storage)
   - [File Uploads with Express](#file-uploads-with-express)
   - [Storage Adapters](#storage-adapters)

## Getting Started

First, install the required packages:

```bash
npm install hooked-api json-rest-api
# If you get peer dependency conflicts, use:
# npm install hooked-api json-rest-api --legacy-peer-deps
```

Create a new file called `api.js`:

```javascript
import { Api } from 'hooked-api';

// Create a new API instance
const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});
```

This is a pure Hooked API with no plugins. So, it doesn't do anything.

## Basic REST API Plugin

The `RestApiPlugin` is the foundation of jsonrestapi. It adds REST methods (query, get, post, put, patch, delete) to your API scopes.

### Adding the REST API Plugin

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from 'json-rest-api';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Use the REST API plugin
await api.use(RestApiPlugin);
```

### Creating a Books Resource

Now let's create a simple "books" resource with fake data:

```javascript
// Define a books resource
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    isbn: { type: 'string' }
  }
});

// To actually use the REST API methods, you need a storage plugin
// Use the same inMemoryStoragePlugin from the Quick Start example above
await api.use(inMemoryStoragePlugin);
```

### Using the API Programmatically

With the REST API plugin and a storage plugin, you can now use the API programmatically:

```javascript
// Query all books
const allBooks = await api.resources.books.query({});
console.log(allBooks);
// Output: { data: [{ type: 'books', id: '1', attributes: {...} }, ...] }

// Get a single book
const book = await api.resources.books.get({ id: '1' });
console.log(book);
// Output: { data: { type: 'books', id: '1', attributes: {...} } }

// Create a new book
const newBook = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: 'New Book',
        author: 'New Author',
        year: 2024
      }
    }
  }
});
console.log(newBook);

// Update a book (replace all fields)
const updatedBook = await api.resources.books.put({
  inputRecord: {
    data: {
      type: 'books',
      id: '1',
      attributes: {
        title: 'Updated Title',
        author: 'Updated Author',
        year: 2024
      }
    }
  }
});

// Partially update a book
const patchedBook = await api.resources.books.patch({
  inputRecord: {
    data: {
      type: 'books',
      id: '1',
      attributes: {
        title: 'New Title Only'
      }
    }
  }
});

// Delete a book
await api.resources.books.delete({ id: '1' });
```

## Response Control and ID Handling

The REST API plugin provides advanced configuration options for controlling response payloads and ID validation behavior.

### Return Full Record Configuration

By default, POST, PUT, and PATCH operations return the complete record including all fields, defaults, and relationships. You can configure this behavior to return minimal responses containing only the data that was sent in the request.

#### Configuration Levels

The `returnFullRecord` option can be configured at three levels (from lowest to highest priority):

1. **API-level** (default for all resources)
2. **Resource-level** (override for specific resources)
3. **Method parameter** (override for individual calls)

#### Basic Configuration

```javascript
// API-level configuration
await api.use(RestApiPlugin, {
  returnFullRecord: {
    post: false,   // Don't return full record for POST
    put: false,    // Don't return full record for PUT
    patch: false,  // Don't return full record for PATCH
    allowRemoteOverride: true  // Allow clients to override via query param
  }
});

// Resource-level override
api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true },
    body: { type: 'string' },
    status: { type: 'string', default: 'draft' }
  },
  returnFullRecord: {
    post: true,  // Always return full record for articles POST
    allowRemoteOverride: false  // Don't allow client override for articles
  }
});

// Method-level override
const result = await api.resources.articles.post({
  inputRecord: { 
    data: { 
      type: 'articles', 
      attributes: { title: 'New Article' } 
    } 
  },
  returnFullRecord: false  // Override for this specific call
});
```

#### Behavior Differences

**Full Record (default, `returnFullRecord: true`):**
- Returns the complete record after creation/update
- Includes all fields with their current database values
- Includes default values applied by schema or database
- Can include relationships if requested via `include` parameter
- Equivalent to performing a GET request after the operation

**Minimal Record (`returnFullRecord: false`):**
- Returns only the fields that were provided in the request
- Includes the generated/updated ID
- Does not include default values or unchanged fields
- More efficient for large records or when defaults aren't needed
- Useful for bandwidth-constrained environments

#### Example Responses

```javascript
// Input
const input = {
  data: {
    type: 'articles',
    attributes: {
      title: 'My Article'
    }
  }
};

// With returnFullRecord: true (default)
{
  "data": {
    "type": "articles",
    "id": "123",
    "attributes": {
      "title": "My Article",
      "status": "draft",      // Default value included
      "createdAt": "2024-01-01T00:00:00Z",  // Database-generated
      "updatedAt": "2024-01-01T00:00:00Z"   // Database-generated
    }
  }
}

// With returnFullRecord: false
{
  "data": {
    "type": "articles", 
    "id": "123",
    "attributes": {
      "title": "My Article"   // Only what was provided
    }
  }
}
```

#### Remote Override via Query Parameters

When `allowRemoteOverride` is enabled, clients can control the response format using query parameters:

```bash
# Request minimal response
POST /api/articles?returnFullRecord=false

# Request full response (when API default is false)
POST /api/articles?returnFullRecord=true
```


#### Network vs Programmatic Usage

### Complete Example

Here's a complete example demonstrating both features:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, ExpressPlugin, RestApiKnexPlugin } from 'json-rest-api';
import express from 'express';

const api = new Api({ name: 'my-api' });

// Configure REST API with custom settings
await api.use(RestApiPlugin, {
  returnFullRecord: {
    post: false,
    put: false,
    patch: true,  // Only PATCH returns full record by default
    allowRemoteOverride: true
  }
});

// Add Express connector
await api.use(ExpressPlugin, { basePath: '/api' });

// Add your database plugin
await api.use(RestApiKnexPlugin, { /* your config */ });

// Define resources with overrides
api.addResource('users', {
  schema: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    role: { type: 'string', default: 'user' },
    createdAt: { type: 'string', default: () => new Date().toISOString() }
  },
  // Users always return full record for audit purposes
  returnFullRecord: {
    post: true,
    put: true,
    patch: true,
    allowRemoteOverride: false  // Don't allow clients to change this
  }
});

api.addResource('posts', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string' },
    status: { type: 'string', default: 'draft' }
  }
  // Uses API defaults (minimal response)
});

// Start server
const app = express();
app.use(api.expressRouter);
app.listen(3000);

// Client examples:

// 1. Create post with minimal response (API default)
// POST /api/posts
// Returns: { "data": { "type": "posts", "id": "1", "attributes": { "title": "Hello" } } }

// 2. Create post with full response (query override)  
// POST /api/posts?returnFullRecord=true
// Returns: { "data": { "type": "posts", "id": "1", "attributes": { "title": "Hello", "status": "draft" } } }

// 3. Create user (always returns full record)
// POST /api/users?returnFullRecord=false  // Ignored due to allowRemoteOverride: false
// Returns: { "data": { "type": "users", "id": "2", "attributes": { "name": "John", "email": "john@example.com", "role": "user", "createdAt": "2024-01-01T00:00:00Z" } } }

// 4. Update with relaxed ID handling (programmatic)
await api.resources.posts.patch({
  id: '1',
  inputRecord: { 
    data: { 
      type: 'posts',
      // No ID required in body
      attributes: { status: 'published' } 
    } 
  },
  returnFullRecord: false  // Override to get minimal response
});
```

### Use Cases

**When to use minimal responses (`returnFullRecord: false`):**
- High-volume APIs where bandwidth is a concern
- When clients already have the full record and only need confirmation
- Mobile applications with limited data plans
- When default values are computed client-side

The connector plugins allow you to expose the API in several ways. The core plugins expose the API to Express or to pure Node.

## Connector Plugins

While the REST API plugin provides the core functionality, you need a connector plugin to expose your API over HTTP. You can choose between Express or the pure HTTP plugin.

> **Important**: Use either the Express plugin OR the HTTP plugin, not both!

### Features (Common to Both Plugins)

Both connector plugins provide these features:

- Automatic route creation for all resources (GET, POST, PUT, PATCH, DELETE)
- Full JSON:API compliant request/response handling
- Query parameter parsing (include, fields, filter, sort, page)
- Request body parsing with configurable size limits
- Strict content type validation with `strictContentType` option (default: true)
  - Enforces `application/vnd.api+json` or `application/json` for POST/PUT/PATCH
  - Returns 415 Unsupported Media Type for invalid content types
- Error responses in JSON:API format with proper HTTP status codes (400, 403, 404, 405, 409, 415, 422, 500)
- File upload support when used with FileHandlingPlugin
- Access to raw request/response objects for advanced use cases
- Dynamic resource support (resources added after server startup work automatically)

Example error response (same for both plugins):
```json
{
  "errors": [{
    "status": "422",
    "title": "Validation Error",
    "detail": "Title is required",
    "source": { "pointer": "/data/attributes/title" }
  }]
}
```

### Express Plugin

The Express plugin integrates your API with Express.js, the popular Node.js web framework. In addition to the common features above, it provides:

- Middleware injection support (before/after routes, per-resource)
- Works with any Express middleware ecosystem
- Familiar Express router patterns

First, install Express:

```bash
npm install express
```

Then update your code:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, ExpressPlugin } from 'json-rest-api';
import express from 'express';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Add plugins
await api.use(RestApiPlugin);
await api.use(ExpressPlugin, {
  basePath: '/api',  // Optional, defaults to '/api'
});

// Add your books resource (you'll need a storage plugin for it to work)
// ...

// Create Express app
const app = express();

// Mount the API routes - both approaches work:

// Approach 1: Direct router usage (standard Express pattern)
app.use(api.http.express.router);                    // Mount at root
// OR
app.use('/v1', api.http.express.router);             // Mount at specific path

// Approach 2: Convenience method (adds logging)
api.http.express.mount(app);                         // Mount at root
// OR
api.http.express.mount(app, '/v1');                  // Mount at specific path

// Note: The mount() method is just syntactic sugar that calls app.use() and logs the mount path

// Start the server
app.listen(3000, () => {
  console.log('API running at http://localhost:3000/api');
});
```

Now your API is ready to receive HTTP requests!

### HTTP Plugin

If you prefer not to use Express, the HTTP plugin provides a lightweight alternative using only Node.js built-in modules. In addition to the common features above, it provides:

- Zero framework dependencies (pure Node.js)
- Built-in HTTP server with configurable port
- Multiple deployment options (standalone server, HTTPS with custom handler, integration with existing servers)
- Character encoding support (respects Content-Type charset)

#### Configuration Options

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, HttpPlugin } from 'json-rest-api';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Add plugins
await api.use(RestApiPlugin);
await api.use(HttpPlugin, {
  port: 3000,                // Server port (default: 3000)
  basePath: '/api',          // API base path (default: '/api')
  strictContentType: true,   // Enforce JSON content types (default: true)
  requestSizeLimit: '10mb'   // Max request body size (default: '1mb')
});

// Add your books resource (you'll need a storage plugin for it to work)
// ...

// Start the HTTP server - multiple options:

// Option 1: Start on configured port (3000 by default)
api.http.startServer();

// Option 2: Start on a different port
api.http.startServer(4000);

// Option 3: Access the raw server for custom configuration
const server = api.http.server;
server.timeout = 60000; // 60 second timeout
server.listen(3000);

// Option 4: Use with HTTPS
import { createServer } from 'https';
const httpsServer = createServer(sslOptions, api.http.handler);
httpsServer.listen(443);

// Option 5: Integrate into existing server
myExistingServer.on('request', (req, res) => {
  if (req.url.startsWith('/api')) {
    api.http.handler(req, res);
  } else {
    // Handle other routes
  }
});

console.log('API running at http://localhost:3000/api');
```


#### Character Encoding

The plugin respects the charset parameter in Content-Type headers:

```bash
curl -X POST http://localhost:3000/api/books \
  -H "Content-Type: application/json; charset=utf-16" \
  -d '...'
```

The HTTP plugin provides the same REST endpoints as Express but with zero external framework dependencies.

### Using Your REST API

Once you've set up either the Express or HTTP plugin, you can interact with your API using any HTTP client. Here are examples using curl that show the **full JSON:API compliant responses** you'll receive:

```bash
# Get all books
curl http://localhost:3000/api/books

# Returns:
{
  "data": [
    {
      "type": "books",
      "id": "1",
      "attributes": {
        "title": "The Great Gatsby",
        "author": "F. Scott Fitzgerald",
        "year": 1925
      }
    },
    {
      "type": "books",
      "id": "2",
      "attributes": {
        "title": "1984",
        "author": "George Orwell",
        "year": 1949
      }
    }
  ]
}

# Get a single book
curl http://localhost:3000/api/books/1

# Returns:
{
  "data": {
    "type": "books",
    "id": "1",
    "attributes": {
      "title": "The Great Gatsby",
      "author": "F. Scott Fitzgerald",
      "year": 1925
    }
  }
}

# Create a new book
curl -X POST http://localhost:3000/api/books \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "books",
      "attributes": {
        "title": "New Book",
        "author": "New Author",
        "year": 2024
      }
    }
  }'

# Returns (201 Created):
{
  "data": {
    "type": "books",
    "id": "1234567890",
    "attributes": {
      "title": "New Book",
      "author": "New Author",
      "year": 2024
    }
  }
}

# Update a book
curl -X PATCH http://localhost:3000/api/books/1 \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "books",
      "id": "1",
      "attributes": {
        "title": "Updated Title"
      }
    }
  }'

# Returns:
{
  "data": {
    "type": "books",
    "id": "1",
    "attributes": {
      "title": "Updated Title",
      "author": "F. Scott Fitzgerald",
      "year": 1925
    }
  }
}

# Delete a book
curl -X DELETE http://localhost:3000/api/books/1

# Returns: 204 No Content (empty response)
```

### File Upload Support in Connector Plugins

Both the Express and HTTP plugins provide support for the FileHandlingPlugin by:

1. **Providing raw request/response access**: The plugins add `_httpReq` and `_httpRes` parameters that the FileHandlingPlugin uses to detect and parse multipart uploads.

2. **Registering file detectors**: When file uploads are enabled, the connector plugins register appropriate file detectors with the REST API.

#### Configuration

##### Express Plugin
```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, ExpressPlugin } from 'json-rest-api';

const api = new Api({ name: 'my-api' });
await api.use(RestApiPlugin);

// Configure Express plugin with file upload options
await api.use(ExpressPlugin, {
  enableFileUploads: true,   // Enable file upload support (default: true)
  fileParser: 'busboy',      // Parser: 'busboy' or 'formidable'
  fileParserOptions: {       // Options passed to the file parser
    limits: {
      fileSize: 10 * 1024 * 1024,  // 10MB file size limit
      files: 5                     // Max 5 files per request
    }
  }
});
```

##### HTTP Plugin
```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, HttpPlugin } from 'json-rest-api';

const api = new Api({ name: 'my-api' });
await api.use(RestApiPlugin);

// Configure HTTP plugin with file upload options
await api.use(HttpPlugin, {
  enableFileUploads: true,   // Enable file upload support (default: true)
  fileParser: 'busboy',      // Parser: 'busboy' or 'formidable'
  fileParserOptions: {       // Options passed to the file parser
    limits: {
      fileSize: 10 * 1024 * 1024,  // 10MB file size limit
      files: 5                     // Max 5 files per request
    }
  }
});
```

#### File Parsers

Both plugins support the same file parsers:

- **busboy**: Streaming parser, memory efficient, good for large files
- **formidable**: Saves to temp files, includes progress tracking

**Installation**: File parsers must be installed separately:
```bash
# For busboy (recommended)
npm install busboy

# For formidable
npm install formidable
```

**Note**: File parsing requires the FileHandlingPlugin to be loaded. The connector plugins only provide the detection and parsing capabilities; the actual file handling logic is implemented by the FileHandlingPlugin.

## File Storage

The file handling system allows you to accept file uploads in your API. It consists of three parts:

1. The `FileHandlingPlugin` - orchestrates file processing
2. File detectors - parse multipart uploads (built into connector plugins)
3. Storage adapters - save files to disk or cloud storage

### Setting Up File Uploads

First, let's add file support to our books API. We'll allow users to upload book covers:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api';
import { LocalStorage } from 'jsonrestapi/plugins/storage/local-storage.js';
import express from 'express';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Create a storage adapter
const coverStorage = new LocalStorage({
  directory: './uploads/covers',
  baseUrl: 'http://localhost:3000/uploads/covers'
});

// Add plugins (ORDER MATTERS!)
await api.use(RestApiPlugin);
await api.use(FileHandlingPlugin);  // Must come after RestApiPlugin
await api.use(ExpressPlugin);       // Must come after FileHandlingPlugin

// Update the books schema to include a cover image
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    isbn: { type: 'string' },
    cover: {
      type: 'file',
      storage: coverStorage,
      accepts: ['image/jpeg', 'image/png', 'image/gif'],
      maxSize: '5mb'
    }
  }
});

// You'll need a storage plugin to handle the data
// Use the same inMemoryStoragePlugin from the Quick Start example
await api.use(inMemoryStoragePlugin);

// Create Express app
const app = express();

// Serve uploaded files
app.use('/uploads', express.static('./uploads'));

// Mount the API (both approaches work)
app.use(api.express.router);       // Direct Express approach
// OR
api.express.mount(app);            // Convenience method

app.listen(3000, () => {
  console.log('API with file uploads running at http://localhost:3000/api');
});
```

### File Uploads with Express

To upload a file, you need to send a multipart/form-data request. Here's an example HTML form:

```html
<!DOCTYPE html>
<html>
<body>
  <h2>Add a Book</h2>
  <form action="http://localhost:3000/api/books" method="POST" enctype="multipart/form-data">
    <label>Title: <input name="title" required></label><br>
    <label>Author: <input name="author" required></label><br>
    <label>Year: <input name="year" type="number"></label><br>
    <label>Cover: <input name="cover" type="file" accept="image/*"></label><br>
    <button type="submit">Add Book</button>
  </form>
</body>
</html>
```

Or using curl:

```bash
curl -X POST http://localhost:3000/api/books \
  -F "title=The Hobbit" \
  -F "author=J.R.R. Tolkien" \
  -F "year=1937" \
  -F "cover=@/path/to/cover.jpg"
```

The file handling plugin will:
1. Detect the multipart upload
2. Parse the files using busboy (you'll need to install it: `npm install busboy`)
3. Validate file type and size according to your schema
4. Upload the file using the storage adapter
5. Replace the file field with the uploaded file's URL
6. Convert everything to JSON:API format

### Storage Adapters

#### LocalStorage

The LocalStorage adapter saves files to your local filesystem:

```javascript
import { LocalStorage } from 'jsonrestapi/plugins/storage/local-storage.js';

// Basic usage
const storage = new LocalStorage({
  directory: './uploads',
  baseUrl: 'http://localhost:3000/uploads'
});

// With security options
const secureStorage = new LocalStorage({
  directory: './uploads',
  baseUrl: 'http://localhost:3000/uploads',
  nameStrategy: 'hash',  // Generate random filenames
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
  maxFilenameLength: 255
});

// Different naming strategies
const customStorage = new LocalStorage({
  directory: './uploads',
  baseUrl: 'http://localhost:3000/uploads',
  nameStrategy: 'custom',
  nameGenerator: async (file) => {
    // Generate your own filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `book_cover_${timestamp}_${random}`;
  }
});
```

#### S3Storage (Mock Implementation)

The package includes a mock S3 storage adapter for development:

```javascript
import { S3Storage } from 'jsonrestapi/plugins/storage/s3-storage.js';

const s3Storage = new S3Storage({
  bucket: 'my-book-covers',
  region: 'us-east-1',
  prefix: 'covers/',
  mockMode: true  // Currently only mock mode is implemented
});
```

> **Looking for a complete example with multiple files?** Check out our [Complete File Upload Guide](docs/mini-guides/file-uploads-complete.md) that shows multiple file fields, HTML forms, and static file serving.

## Transactions

The JSON REST API supports database transactions for atomic operations across multiple resources. This is essential for maintaining data consistency when creating or updating related resources.

### Basic Transaction Usage

```javascript
// Manual transaction management
const trx = await api.knex.instance.transaction();
try {
  // All operations share the same transaction
  const author = await api.resources.people.post({
    transaction: trx,
    inputRecord: {
      data: {
        type: 'people',
        attributes: { name: 'New Author' }
      }
    }
  });
  
  const book = await api.resources.books.post({
    transaction: trx,
    inputRecord: {
      data: {
        type: 'books',
        attributes: { title: 'New Book' },
        relationships: {
          author: { data: { type: 'people', id: author.data.id } }
        }
      }
    }
  });
  
  // Commit if everything succeeds
  await trx.commit();
  return { author, book };
  
} catch (error) {
  // Rollback on any error
  await trx.rollback();
  throw error;
}
```

### Automatic Transaction Handling

POST operations automatically use transactions when creating resources with many-to-many relationships:

```javascript
// This single POST will use a transaction internally
const book = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: { title: 'Tagged Book' },
      relationships: {
        tags: {
          data: [
            { type: 'tags', id: '1' },
            { type: 'tags', id: '2' }
          ]
        }
      }
    }
  }
});
// The book and pivot table entries are created atomically
```

### Nested Transactions

The system intelligently handles nested transactions by reusing existing ones:

```javascript
const trx = await api.knex.instance.transaction();
try {
  // This POST will use the existing transaction
  const book = await api.resources.books.post({
    transaction: trx,
    inputRecord: {
      data: {
        type: 'books',
        attributes: { title: 'Book with Tags' },
        relationships: {
          tags: { data: [{ type: 'tags', id: '1' }] }
        }
      }
    }
  });
  // Even though POST creates its own transaction for many-to-many,
  // it detects and uses the existing one
  
  await trx.commit();
} catch (error) {
  await trx.rollback();
}
```

### Transaction Support Across Methods

All REST API methods support transactions:

```javascript
const trx = await api.knex.instance.transaction();
try {
  // Query with transaction
  const books = await api.resources.books.query({ 
    transaction: trx,
    queryParams: { filters: { status: 'draft' } }
  });
  
  // Update with transaction
  await api.resources.books.patch({
    transaction: trx,
    id: '123',
    inputRecord: {
      data: {
        type: 'books',
        id: '123',
        attributes: { status: 'published' }
      }
    }
  });
  
  // Delete with transaction
  await api.resources.drafts.delete({
    transaction: trx,
    id: '456'
  });
  
  await trx.commit();
} catch (error) {
  await trx.rollback();
}
```

## Updating Resources with Relationships

The REST API plugin now fully supports updating relationships in PUT and PATCH operations according to JSON:API specifications.

### PUT - Complete Replacement

PUT replaces the entire resource, including all relationships. Any relationships not provided in the request will be removed.

```javascript
// Example: Update an article with new author and categories
const updatedArticle = await api.resources.articles.put({
  id: '123',
  inputRecord: {
    data: {
      type: 'articles',
      id: '123',
      attributes: {
        title: 'Updated Title',
        body: 'New content'
      },
      relationships: {
        // 1:1 relationship - will update author_id in the database
        author: {
          data: { type: 'users', id: '42' }
        },
        // n:n relationship - will replace ALL category associations
        categories: {
          data: [
            { type: 'categories', id: '1' },
            { type: 'categories', id: '3' }
          ]
        }
        // Note: any other relationships not listed here will be cleared!
      }
    }
  }
});
```

### PATCH - Partial Update

PATCH only updates the fields and relationships explicitly provided, leaving everything else unchanged.

```javascript
// Example: Update only the author, keeping categories unchanged
const patchedArticle = await api.resources.articles.patch({
  id: '123',
  inputRecord: {
    data: {
      type: 'articles',
      id: '123',
      relationships: {
        // Only update the author relationship
        author: {
          data: { type: 'users', id: '99' }
        }
        // categories relationship remains untouched
      }
    }
  }
});

// Example: Clear a relationship by setting it to null
const clearedRelationship = await api.resources.articles.patch({
  id: '123',
  inputRecord: {
    data: {
      type: 'articles',
      id: '123',
      relationships: {
        reviewer: {
          data: null  // Removes the reviewer
        }
      }
    }
  }
});

// Example: Update many-to-many relationship
const updatedCategories = await api.resources.articles.patch({
  id: '123',
  inputRecord: {
    data: {
      type: 'articles',
      id: '123',
      relationships: {
        // This will replace the categories for this article
        categories: {
          data: [
            { type: 'categories', id: '5' },
            { type: 'categories', id: '7' },
            { type: 'categories', id: '9' }
          ]
        }
      }
    }
  }
});
```

### Transaction Support for Relationship Updates

All relationship updates are performed within the same transaction as the main record update, ensuring data consistency:

```javascript
// This entire operation is atomic
const result = await api.resources.articles.put({
  id: '123',
  inputRecord: {
    data: {
      type: 'articles',
      id: '123',
      attributes: {
        title: 'New Title',
        status: 'published'
      },
      relationships: {
        author: {
          data: { type: 'users', id: '10' }
        },
        categories: {
          data: [
            { type: 'categories', id: '1' },
            { type: 'categories', id: '2' }
          ]
        },
        tags: {
          data: [
            { type: 'tags', id: '100' },
            { type: 'tags', id: '101' }
          ]
        }
      }
    }
  }
});
// If any part fails, everything is rolled back
```

## Database Configuration with MySQL

The REST API Knex Plugin supports MySQL databases out of the box. Here's how to configure your API to use MySQL:

### Installing MySQL Driver

First, install the MySQL driver for Knex:

```bash
npm install mysql2
```

### Basic MySQL Configuration

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, HttpPlugin } from 'json-rest-api';
import knex from 'knex';

// Create a Knex instance with MySQL configuration
const db = knex({
  client: 'mysql2',
  connection: {
    host: 'localhost',
    port: 3306,
    user: 'your_database_user',
    password: 'your_database_password',
    database: 'your_database_name'
  },
  pool: { 
    min: 2,
    max: 10 
  }
});

// Create the API
const api = new Api({ name: 'my-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });
await api.use(HttpPlugin);

// The Knex instance is now available as api.knex for direct queries
console.log('Database connected:', await api.knex.raw('SELECT 1+1 AS result'));

// Add a sample resource
api.addResource('users', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true }
  }
});

// Create the users table if it doesn't exist
await api.knex.schema.createTableIfNotExists('users', (table) => {
  table.increments('id');
  table.string('name');
  table.string('email');
  table.timestamps(true, true);
});

// Start the HTTP server
api.http.startServer();
console.log('API server running at http://localhost:3000/api');
console.log('Try: curl http://localhost:3000/api/users');
```

### Testing the API with curl

Once your server is running, you can test it with these curl commands:

```bash
# Get all users (initially empty)
curl http://localhost:3000/api/users

# Create a new user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "users",
      "attributes": {
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  }'

# Get all users again (should show the created user)
curl http://localhost:3000/api/users

# Get a specific user
curl http://localhost:3000/api/users/1

# Update a user
curl -X PATCH http://localhost:3000/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "users",
      "id": "1",
      "attributes": {
        "name": "John Smith"
      }
    }
  }'

# Delete a user
curl -X DELETE http://localhost:3000/api/users/1
```

### Using Environment Variables

For production deployments, use environment variables to store sensitive credentials:

```javascript
// Load environment variables (using dotenv package)
import dotenv from 'dotenv';
dotenv.config();

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  },
  pool: { 
    min: 2,
    max: 10 
  }
});
```

Create a `.env` file (remember to add it to `.gitignore`):

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=myapp_user
DB_PASSWORD=secret_password
DB_NAME=myapp_db
```

### Connection URL Format

You can also use a connection URL:

```javascript
const db = knex({
  client: 'mysql2',
  connection: process.env.DATABASE_URL || 'mysql://user:pass@localhost:3306/dbname'
});
```

### Advanced MySQL Configuration

For production environments, consider these additional options:

```javascript
const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
      // For MySQL servers with SSL/TLS
      rejectUnauthorized: true,
      ca: fs.readFileSync('path/to/ca.pem')
    },
    timezone: 'UTC',
    charset: 'utf8mb4',
    connectTimeout: 60000,  // 60 seconds
    stringifyObjects: false,
    multipleStatements: true
  },
  pool: {
    min: 2,
    max: 10,
    createTimeoutMillis: 30000,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 100
  },
  acquireConnectionTimeout: 60000,
  debug: process.env.NODE_ENV === 'development'
});
```

### Creating Tables

Once connected, you can create tables using Knex migrations or directly:

```javascript
// Create a books table
await api.knex.schema.createTable('books', (table) => {
  table.increments('id').primary();
  table.string('title', 255).notNullable();
  table.string('author', 255).notNullable();
  table.integer('year').unsigned();
  table.string('isbn', 20).unique();
  table.text('description');
  table.decimal('price', 10, 2);
  table.boolean('in_stock').defaultTo(true);
  table.timestamps(true, true);  // created_at, updated_at
  
  // Indexes for better query performance
  table.index(['author']);
  table.index(['year']);
});
```

### Complete Example with MySQL

Here's a complete working example:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, HttpPlugin } from 'json-rest-api';
import knex from 'knex';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configure MySQL connection
const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bookstore'
  },
  pool: { min: 2, max: 10 }
});

// Create API instance
const api = new Api({ name: 'bookstore-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });
await api.use(HttpPlugin);

// Define the books resource with filtering
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { 
      type: 'string', 
      required: true,
      search: { filterUsing: 'like' }  // Enable LIKE filtering
    },
    author: { 
      type: 'string', 
      required: true,
      search: true  // Enable exact match filtering
    },
    year: { 
      type: 'number',
      search: {
        year_min: { filterUsing: '>=' },
        year_max: { filterUsing: '<=' }
      }
    },
    price: { 
      type: 'decimal',
      search: true
    },
    in_stock: { 
      type: 'boolean',
      search: true
    }
  },
  sortableFields: ['title', 'author', 'year', 'price'],
  tableName: 'books'  // Explicitly set table name (optional)
});

// Start the HTTP server
api.http.startServer(3000);
console.log('API running at http://localhost:3000/api');

// Test the database connection
try {
  await db.raw('SELECT 1+1 AS result');
  console.log('Database connected successfully');
} catch (error) {
  console.error('Database connection failed:', error);
}
```

### Troubleshooting MySQL Connections

Common issues and solutions:

1. **Authentication Error**: If you get "ER_NOT_SUPPORTED_AUTH_MODE", your MySQL 8.0 server might be using the newer authentication plugin. Fix:
   ```sql
   ALTER USER 'your_user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';
   FLUSH PRIVILEGES;
   ```

2. **Connection Timeout**: Increase the `connectTimeout` in your configuration.

3. **SSL/TLS Issues**: For cloud MySQL instances (AWS RDS, Google Cloud SQL), you may need to configure SSL:
   ```javascript
   connection: {
     // ... other config
     ssl: {
       rejectUnauthorized: true,
       ca: fs.readFileSync('path/to/server-ca.pem')
     }
   }
   ```

4. **Character Set Issues**: Use `utf8mb4` for full Unicode support including emojis:
   ```javascript
   connection: {
     // ... other config
     charset: 'utf8mb4'
   }
   ```

### Direct Database Access

The plugin exposes the Knex instance as `api.knex`, allowing you to run complex queries directly:

```javascript
// Complex query with joins
const results = await api.knex('books')
  .join('authors', 'books.author_id', 'authors.id')
  .select('books.*', 'authors.name as author_name')
  .where('books.year', '>', 2020)
  .orderBy('books.created_at', 'desc')
  .limit(10);

// Raw SQL queries
const stats = await api.knex.raw(`
  SELECT 
    COUNT(*) as total_books,
    AVG(price) as avg_price,
    MAX(price) as max_price
  FROM books
  WHERE in_stock = ?
`, [true]);

// Transactions
await api.knex.transaction(async (trx) => {
  const [authorId] = await trx('authors').insert({ name: 'New Author' });
  await trx('books').insert({
    title: 'New Book',
    author_id: authorId,
    year: 2024
  });
});
```

With this configuration, your REST API will automatically use MySQL for all database operations, with full support for filtering, sorting, and pagination as described in the previous sections.

### Advanced Filtering with Hooks

The REST API Knex Plugin supports extensible filtering through hooks. When adding custom filters, always use grouping to prevent accidental security bypasses:

```javascript
// Add a tenant isolation filter
api.addHook('knexQueryFiltering', 'tenantFilter', { order: -100 }, ({ query }) => {
  query.where(function() {
    this.where('tenant_id', getCurrentTenant());
    this.where('deleted_at', null);
  });
});

// Add a complex search filter
api.addHook('knexQueryFiltering', 'searchFilter', {}, ({ query, filters }) => {
  if (filters.search) {
    query.where(function() {
      const term = `%${filters.search}%`;
      this.where('title', 'like', term)
          .orWhere('description', 'like', term)
          .orWhere('tags', 'like', term);
    });
  }
});

// Add region-based filtering
api.addHook('knexQueryFiltering', 'regionFilter', {}, ({ query }) => {
  query.where(function() {
    const userRegion = getUserRegion();
    // Show items from user's region, global items, or items without a region
    this.where('region', userRegion)
        .orWhere('region', 'global')
        .orWhereNull('region');
  });
});
```

These filters will be combined with AND, ensuring that security filters cannot be bypassed:
- `WHERE (tenant_id = 123 AND deleted_at IS NULL) AND (title LIKE '%search%' OR description LIKE '%search%' OR tags LIKE '%search%') AND (region = 'US' OR region = 'global' OR region IS NULL)`

**Important**: Always wrap your filter conditions in `query.where(function() { ... })` to ensure proper grouping. This prevents OR conditions from accidentally bypassing other filters.

## Many-to-Many Relationships

Many-to-many relationships require a pivot table. In the JSON REST API system, the pivot table is treated as a full resource with its own schema and endpoints.

### Understanding Relationships and Side-Loading

Before diving into many-to-many relationships, it's important to understand how relationships work in the JSON REST API system and the side-loading functionality.

#### Relationship Types

The system supports three types of relationships:

1. **belongsTo** (Many-to-One) - A foreign key relationship where a resource belongs to another resource
2. **hasMany** (One-to-Many) - The inverse of belongsTo, where a resource has many related resources
3. **hasMany with through** (Many-to-Many) - A relationship through a pivot/junction table

#### Side-Loading with Include Parameter

Side-loading allows you to fetch related resources in a single request using the `include` query parameter. This follows the JSON:API specification and helps prevent N+1 query problems.

```javascript
// Example: Get a book with its author included
GET /api/books/1?include=author

// Example: Get a book with nested includes
GET /api/books/1?include=author.company,reviews.reviewer
```

#### Configuring Side-Load Behavior

The side-loading functionality is controlled by the following properties in your relationship definitions:

##### For belongsTo Relationships

- **`sideLoadSingle`** (default: `true`) - Controls whether the related resource can be included via the `include` parameter
- **`sideSearchSingle`** (default: `true`) - Controls whether you can filter parent resources by fields in the related resource

```javascript
api.addResource('books', {
  schema: {
    author_id: {
      belongsTo: 'authors',
      as: 'author',
      // sideLoadSingle: true,  // Default - can be omitted
      // sideSearchSingle: true  // Default - can be omitted
    }
  }
});

// This allows:
// GET /api/books?include=author
// GET /api/books?filter[authorName]=Tolkien (with appropriate searchSchema)
```

##### For hasMany Relationships

- **`canSideLoadMany`** (default: `false`) - Controls whether related resources can be included
- **`sideSearchMany`** (default: `false`) - Controls whether you can filter by related resources

```javascript
api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' }
  },
  relationships: {
    books: {
      hasMany: 'books',
      foreignKey: 'author_id',
      canSideLoadMany: true,    // Must be explicitly enabled
      sideSearchMany: true   // Must be explicitly enabled
    }
  }
});

// This allows:
// GET /api/authors/1?include=books
// GET /api/authors?filter[bookTitle]=Hobbit (with appropriate searchSchema)
```

##### For Many-to-Many Relationships

Many-to-many relationships using `hasMany` with `through` also use `canSideLoadMany`:

```javascript
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string' }
  },
  relationships: {
    tags: {
      hasMany: 'tags',
      through: 'book_tags',    // Pivot table
      foreignKey: 'book_id',
      otherKey: 'tag_id',
      canSideLoadMany: true       // Enable including tags
    }
  }
});

// This allows:
// GET /api/books/1?include=tags
```

#### Important Notes on Side-Loading

1. **Performance Consideration**: hasMany relationships have `canSideLoadMany` disabled by default because including many related resources can impact performance. Enable it only when needed.

2. **Nested Includes**: You can include nested relationships using dot notation:
   ```
   GET /api/books/1?include=author.company,reviews.reviewer.department
   ```

3. **Sparse Fieldsets**: Combine includes with sparse fieldsets to fetch only needed fields:
   ```
   GET /api/books/1?include=author&fields[authors]=name,email
   ```

4. **Cross-Table Search**: When `sideSearchSingle` or `sideSearchMany` is enabled, you can define searchSchema fields that reference related tables:
   ```javascript
   api.addResource('books', {
     schema: { /* ... */ },
     searchSchema: {
       authorName: {
         type: 'string',
         actualField: 'authors.name',  // Reference field in related table
         filterUsing: 'like'
       }
     }
   });
   ```

### Books with Multiple Authors Example

Let's update our books example to support multiple authors. Previously, books had a single `author` field. Now we'll create a many-to-many relationship between `books` and `people` (authors).

#### Step 1: Define the Pivot Resource

```javascript
// Define the book_authors pivot table as a resource
api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { 
      type: 'number',
      belongsTo: 'books',
      as: 'book',
      sideSearchSingle: true
    },
    author_id: {
      type: 'number', 
      belongsTo: 'people',
      as: 'author',
      // sideLoadSingle: true,  // Default for belongsTo - can be omitted
      sideSearchSingle: true
    },
    author_order: { type: 'number' }, // Display order for multiple authors
    contribution_type: { type: 'string' } // 'primary', 'co-author', 'contributor'
  },
  searchSchema: {
    // Search by book title
    bookTitle: {
      type: 'string',
      actualField: 'books.title',
      filterUsing: 'like'
    },
    // Search by author name
    authorName: {
      type: 'string',
      actualField: 'people.name',
      filterUsing: 'like'
    }
  }
});
```

#### Step 2: Update Books and People Resources

```javascript
// Update books resource (remove single author field)
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, indexed: true },
    year: { type: 'number' },
    isbn: { type: 'string' }
    // Note: removed 'author' field - now using many-to-many
  },
  relationships: {
    authors: {
      hasMany: 'book_authors',
      foreignKey: 'book_id',
      as: 'authors',
      canSideLoadMany: true
    }
  }
});

// Define people resource
api.addResource('people', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, indexed: true },
    email: { type: 'string' }
  },
  relationships: {
    books: {
      hasMany: 'book_authors',
      foreignKey: 'author_id',
      as: 'books',
      canSideLoadMany: true
    }
  }
});
```

### Using Many-to-Many Relationships

#### NEW: Creating Books with Authors in One Request

With the enhanced POST implementation, you can now create a book and establish many-to-many relationships in a single atomic request:

```javascript
// First, define the pivot table resource (with searchable fields for updates)
api.addResource('book_tags', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, search: true },
    tag_id: { type: 'number', required: true, search: true }
  }
  // Note: You can also define these in a separate searchSchema instead:
  // searchSchema: {
  //   book_id: { type: 'number' },
  //   tag_id: { type: 'number' }
  // }
});

// Then define the tags resource
api.addResource('tags', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true }
  }
});

// Finally, define the books resource with the many-to-many relationship
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    year: { type: 'number' }
  },
  relationships: {
    tags: {
      hasMany: 'tags',
      through: 'book_tags',      // Pivot table resource
      foreignKey: 'book_id',     // Key for this resource
      otherKey: 'tag_id'         // Key for related resource
    }
  }
});

// Create book with tags in one request
const response = await api.resources.books.post({
  inputRecord: {
    "data": {
      "type": "books",
      "attributes": {
        "title": "Good Omens",
        "year": 1990
      },
      "relationships": {
        "tags": {
          "data": [
            { "type": "tags", "id": "1" },  // Must be existing tags
            { "type": "tags", "id": "2" }
          ]
        }
      }
    }
  }
});
```

This will atomically:
1. Create the book
2. Create entries in the `book_tags` pivot table
3. Return the book with its relationships

#### Traditional Method: Creating Relationships Separately

Alternatively, you can still use the traditional approach:

```bash
# First, create a book
curl -X POST http://localhost:3000/api/books \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "books",
      "attributes": {
        "title": "Good Omens",
        "year": 1990
      }
    }
  }'

# Then link authors to the book via pivot table
curl -X POST http://localhost:3000/api/book_authors \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "book_authors",
      "attributes": {
        "author_order": 1,
        "contribution_type": "co-author"
      },
      "relationships": {
        "book": { "data": { "type": "books", "id": "1" } },
        "author": { "data": { "type": "people", "id": "1" } }
      }
    }
  }'
```

#### Querying Books with Authors

```bash
# Get a book with all its authors
curl "http://localhost:3000/api/books/1?include=authors.author"

# Search for books by author name
curl "http://localhost:3000/api/book_authors?filter[authorName]=Fitzgerald&include=book"

# Get all books by a specific author
curl "http://localhost:3000/api/people/1?include=books.book"
```

#### Example Response

```json
{
  "data": {
    "type": "books",
    "id": "1",
    "attributes": {
      "title": "Good Omens",
      "year": 1990
    },
    "relationships": {
      "authors": {
        "data": [
          { "type": "book_authors", "id": "1" },
          { "type": "book_authors", "id": "2" }
        ]
      }
    }
  },
  "included": [
    {
      "type": "book_authors",
      "id": "1",
      "attributes": {
        "author_order": 1,
        "contribution_type": "co-author"
      },
      "relationships": {
        "author": { "data": { "type": "people", "id": "10" } }
      }
    },
    {
      "type": "book_authors",
      "id": "2",
      "attributes": {
        "author_order": 2,
        "contribution_type": "co-author"
      },
      "relationships": {
        "author": { "data": { "type": "people", "id": "11" } }
      }
    },
    {
      "type": "people",
      "id": "10",
      "attributes": { "name": "Terry Pratchett" }
    },
    {
      "type": "people",
      "id": "11",
      "attributes": { "name": "Neil Gaiman" }
    }
  ]
}
```

## Polymorphic Relationships

Polymorphic relationships allow a model to belong to multiple other models using a single association.

### Comments Example

Let's add a commenting system where comments can be attached to books or articles.

#### Define Comments with Polymorphic Relationship

```javascript
api.addResource('comments', {
  schema: {
    id: { type: 'id' },
    body: { type: 'string', required: true },
    user_id: {
      type: 'number',
      belongsTo: 'people',
      as: 'author'
      // sideLoadSingle: true  // Default for belongsTo - can be omitted
    },
    // Polymorphic relationship - defines both the relationship and the fields
    commentable: {
      belongsToPolymorphic: {
        types: ['books', 'articles'],
        typeField: 'commentable_type',
        idField: 'commentable_id'
      },
      as: 'commentable'
      // sideLoadSingle: true  // Default for belongsToPolymorphic - can be omitted
    }
  },
  searchSchema: {
    // Search by title of the commented item
    commentableTitle: {
      type: 'string',
      filterUsing: 'like',
      polymorphicField: 'commentable',
      targetFields: {
        books: 'title',
        articles: 'title'
      }
    }
  }
});

// Add reverse relationship to books
api.addResource('books', {
  schema: {
    // ... existing schema ...
  },
  relationships: {
    // ... existing relationships ...
    comments: {
      hasMany: 'comments',
      via: 'commentable',
      as: 'comments',
      canSideLoadMany: true
    }
  }
});

// Define articles resource
api.addResource('articles', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, indexed: true },
    content: { type: 'text' }
  },
  relationships: {
    comments: {
      hasMany: 'comments',
      via: 'commentable',
      as: 'comments',
      canSideLoadMany: true
    }
  }
});
```

### Using Polymorphic Relationships

#### Creating Comments

```bash
# Comment on a book
curl -X POST http://localhost:3000/api/comments \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "comments",
      "attributes": {
        "body": "This book changed my perspective!"
      },
      "relationships": {
        "author": { "data": { "type": "people", "id": "1" } },
        "commentable": { "data": { "type": "books", "id": "1" } }
      }
    }
  }'

# Comment on an article
curl -X POST http://localhost:3000/api/comments \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "type": "comments",
      "attributes": {
        "body": "Great article!"
      },
      "relationships": {
        "author": { "data": { "type": "people", "id": "1" } },
        "commentable": { "data": { "type": "articles", "id": "5" } }
      }
    }
  }'
```

#### Querying Polymorphic Relationships

```bash
# Get all comments with their parent (book or article)
curl "http://localhost:3000/api/comments?include=commentable"

# Search comments on items with "REST" in title
curl "http://localhost:3000/api/comments?filter[commentableTitle]=REST"

# Get all comments for a specific book
curl "http://localhost:3000/api/books/1?include=comments.author"
```

#### Example Response

```json
{
  "data": [
    {
      "type": "comments",
      "id": "1",
      "attributes": {
        "body": "Great book!"
      },
      "relationships": {
        "commentable": { "data": { "type": "books", "id": "1" } }
      }
    },
    {
      "type": "comments",
      "id": "2",
      "attributes": {
        "body": "Interesting article!"
      },
      "relationships": {
        "commentable": { "data": { "type": "articles", "id": "5" } }
      }
    }
  ],
  "included": [
    {
      "type": "books",
      "id": "1",
      "attributes": { "title": "The Great Gatsby" }
    },
    {
      "type": "articles",
      "id": "5",
      "attributes": { "title": "Understanding REST APIs" }
    }
  ]
}
```

### How Polymorphic Search Works

The system generates conditional JOINs for polymorphic searches:

```sql
-- GET /comments?filter[commentableTitle]=gatsby
SELECT comments.* 
FROM comments 
LEFT JOIN books AS comments_commentable_books 
  ON comments.commentable_type = 'books' 
  AND comments.commentable_id = comments_commentable_books.id
LEFT JOIN articles AS comments_commentable_articles 
  ON comments.commentable_type = 'articles' 
  AND comments.commentable_id = comments_commentable_articles.id
WHERE (
  (comments.commentable_type = 'books' 
   AND comments_commentable_books.title LIKE '%gatsby%')
  OR 
  (comments.commentable_type = 'articles' 
   AND comments_commentable_articles.title LIKE '%gatsby%')
)
```