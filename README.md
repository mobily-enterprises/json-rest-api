# JSON REST API Tutorial

This tutorial will guide you through building a REST API using the `jsonrestapi` package and `hooked-api`. We'll start with the basics and gradually add more features.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Basic REST API Plugin](#basic-rest-api-plugin)
3. [Connector Plugins](#connector-plugins)
   - [Express Plugin](#express-plugin)
   - [HTTP Plugin](#http-plugin)
4. [File Storage](#file-storage)
   - [File Uploads with Express](#file-uploads-with-express)
   - [Storage Adapters](#storage-adapters)

## Getting Started

First, let's install the required packages:

```bash
npm install hooked-api json-rest-api
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
api.use(RestApiPlugin);
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

// Add simple data helpers (in real apps, these would connect to a database)
api.vars.helpers.dataQuery = async ({ scopeName, queryParams }) => {
  // For now, just return some fake books
  const fakeBooks = [
    { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', year: 1925 },
    { id: '2', title: '1984', author: 'George Orwell', year: 1949 },
    { id: '3', title: 'To Kill a Mockingbird', author: 'Harper Lee', year: 1960 }
  ];
  
  return {
    data: fakeBooks.map(book => ({
      type: 'books',
      id: book.id,
      attributes: {
        title: book.title,
        author: book.author,
        year: book.year
      }
    }))
  };
};

api.vars.helpers.dataGet = async ({ scopeName, id }) => {
  // Return a single fake book
  const book = { id, title: 'Example Book', author: 'Example Author', year: 2024 };
  
  return {
    data: {
      type: 'books',
      id: book.id,
      attributes: {
        title: book.title,
        author: book.author,
        year: book.year
      }
    }
  };
};

api.vars.helpers.dataPost = async ({ scopeName, inputRecord }) => {
  // Pretend to create a book and return it
  const newBook = {
    id: String(Date.now()), // Simple ID generation
    ...inputRecord.data.attributes
  };
  
  return {
    data: {
      type: 'books',
      id: newBook.id,
      attributes: {
        title: newBook.title,
        author: newBook.author,
        year: newBook.year
      }
    }
  };
};

api.vars.helpers.dataPut = async ({ scopeName, id, inputRecord }) => {
  // Pretend to replace a book
  return {
    data: {
      type: 'books',
      id: id,
      attributes: inputRecord.data.attributes
    }
  };
};

api.vars.helpers.dataPatch = async ({ scopeName, id, inputRecord }) => {
  // Pretend to update a book
  return {
    data: {
      type: 'books',
      id: id,
      attributes: inputRecord.data.attributes
    }
  };
};

api.vars.helpers.dataDelete = async ({ scopeName, id }) => {
  // Just return success
  return { success: true };
};
```

### Using the API Programmatically

With just the REST API plugin, you can only use the API programmatically:

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
  id: '1',
  inputRecord: {
    data: {
      type: 'books',
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
  id: '1',
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: 'New Title Only'
      }
    }
  }
});

// Delete a book
await api.resources.books.delete({ id: '1' });
```

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
api.use(RestApiPlugin);
api.use(ExpressPlugin, {
  basePath: '/api',  // Optional, defaults to '/api'
});

// Add your books resource and helpers here (same as before)
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
api.use(RestApiPlugin);
api.use(HttpPlugin, {
  port: 3000,                // Server port (default: 3000)
  basePath: '/api',          // API base path (default: '/api')
  strictContentType: true,   // Enforce JSON content types (default: true)
  requestSizeLimit: '10mb'   // Max request body size (default: '1mb')
});

// Add your books resource and helpers here (same as before)
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

### Database Integration with Knex

While these examples use fake data helpers for demonstration, jsonrestapi includes a basic Knex plugin for database integration:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import knex from 'knex';

// Create your Knex instance
const db = knex({
  client: 'postgres',
  connection: process.env.DATABASE_URL
});

// Use the Knex plugin
api.use(RestApiPlugin);
api.use(RestApiKnexPlugin, {
  knex: { knex: db }
});

// Now all your resources automatically use the database!
api.addResource('books', {
  schema: { /* ... */ }
});
```

The basic Knex plugin provides simple CRUD operations. More advanced database plugins (coming soon) will add filtering, sorting, pagination, and relationships out of the box!


### File Upload Support in Connector Plugins

Both the Express and HTTP plugins provide support for the FileHandlingPlugin by:

1. **Providing raw request/response access**: The plugins add `_httpReq` and `_httpRes` parameters that the FileHandlingPlugin uses to detect and parse multipart uploads.

2. **Registering file detectors**: When file uploads are enabled, the connector plugins register appropriate file detectors with the REST API.

#### Configuration

##### Express Plugin
```javascript
api.use(ExpressPlugin, {
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
api.use(HttpPlugin, {
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
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);  // Must come after RestApiPlugin
api.use(ExpressPlugin);       // Must come after FileHandlingPlugin

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

// Update dataPost to handle the cover URL
api.vars.helpers.dataPost = async ({ scopeName, inputRecord }) => {
  const newBook = {
    id: String(Date.now()),
    ...inputRecord.data.attributes
  };
  
  // The file has already been uploaded and replaced with a URL
  console.log('Book cover URL:', newBook.cover);
  
  return {
    data: {
      type: 'books',
      id: newBook.id,
      attributes: {
        title: newBook.title,
        author: newBook.author,
        year: newBook.year,
        cover: newBook.cover  // This is now a URL!
      }
    }
  };
};

// Add other helpers...

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

## Next Steps

This tutorial covered the basics of creating a REST API with jsonrestapi:

1. The REST API plugin for core functionality
2. Connector plugins for HTTP access (Express or pure HTTP)
3. File handling with storage adapters

In future sections, we'll cover:
- Database integration for persistent storage
- Advanced querying with filters, sorting, and pagination
- Relationships between resources
- Authentication and authorization
- Custom validation and business logic

For now, you have everything you need to create a basic REST API with file upload support!