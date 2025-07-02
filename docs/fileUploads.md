# File Uploads Guide

This guide explains how to handle file uploads in JSON REST API using the FileHandlingPlugin. The system is designed to be protocol-agnostic, storage-pluggable, and schema-driven.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Schema Configuration](#schema-configuration)
4. [Storage Adapters](#storage-adapters)
5. [Protocol Configuration](#protocol-configuration)
6. [File Validation](#file-validation)
7. [Complete Examples](#complete-examples)
8. [Troubleshooting](#troubleshooting)

## Overview

The file handling system consists of three main components:

1. **FileHandlingPlugin** - Orchestrates file detection and processing
2. **Protocol Detectors** - Parse files from different protocols (HTTP, Express)
3. **Storage Adapters** - Save files to different backends (local, S3, etc.)

### How It Works

1. You define file fields in your schema with `type: 'file'`
2. Protocol plugins detect and parse multipart uploads
3. FileHandlingPlugin validates and processes files
4. Storage adapters save files and return URLs
5. File fields are replaced with URLs in your data

## Quick Start

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'jsonrestapi';
import { LocalStorage } from 'jsonrestapi/plugins/storage/local-storage.js';

// Create API
const api = new Api({ name: 'my-api', version: '1.0.0' });

// Create storage
const storage = new LocalStorage({
  directory: './uploads',
  baseUrl: 'http://localhost:3000/uploads'
});

// Use plugins (order matters!)
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);
api.use(ExpressPlugin);

// Define schema with file field
api.addScope('images', {
  schema: {
    title: { type: 'string', required: true },
    file: { 
      type: 'file',
      storage: storage,
      accepts: ['image/*'],
      maxSize: '10mb'
    }
  }
});
```

## Schema Configuration

File fields are defined in your scope schema with `type: 'file'`:

```javascript
api.addScope('documents', {
  schema: {
    // Regular fields
    title: { type: 'string', required: true },
    description: { type: 'string' },
    
    // File field
    attachment: {
      type: 'file',
      storage: myStorage,        // Required: storage adapter instance
      accepts: ['*'],            // Optional: accepted mime types (default: ['*'])
      maxSize: '50mb',           // Optional: max file size
      required: false            // Optional: is field required? (default: false)
    }
  }
});
```

### File Field Options

- **type**: Must be `'file'`
- **storage**: Storage adapter instance (required)
- **accepts**: Array of accepted MIME types
  - `['*']` - Accept any file type (default)
  - `['image/*']` - Accept any image
  - `['image/jpeg', 'image/png']` - Accept specific types
  - `['application/pdf', 'text/*']` - Mix specific and wildcard
- **maxSize**: Maximum file size
  - `'10mb'`, `'1.5gb'`, `'500kb'` - Human readable format
  - Number of bytes also supported
- **required**: Whether the file is required

## Storage Adapters

Storage adapters handle where and how files are saved. The library includes two built-in adapters.

### Storage Adapter Comparison

| Feature | LocalStorage | S3Storage |
|---------|-------------|-----------|
| **Production Ready** | ✅ Yes | ⚠️ Mock only |
| **Filename Strategies** | 4 (hash, timestamp, original, custom) | 1 (hash only) |
| **Path Traversal Protection** | ✅ Full | ✅ N/A |
| **Extension Whitelist** | ✅ Yes | ❌ No |
| **Duplicate Handling** | ✅ Yes | ✅ Automatic |
| **Custom Naming** | ✅ Yes | ❌ No |
| **Best For** | Local file storage | Cloud storage |

### S3Storage

Saves files to Amazon S3 or S3-compatible storage:

```javascript
import { S3Storage } from 'jsonrestapi/plugins/storage/s3-storage.js';

const s3Storage = new S3Storage({
  bucket: 'my-uploads',                // S3 bucket name (required)
  region: 'us-east-1',                 // AWS region (default: 'us-east-1')
  prefix: 'uploads/',                  // Path prefix in bucket (default: '')
  acl: 'public-read',                  // Access control (default: 'public-read')
  mockMode: false                      // Use mock mode? (default: true)
});
```

**Filename Handling:**
- Always generates random hash + extension (e.g., `uploads/a7f8d9e2b4c6e1f3.jpg`)
- Original filenames are never used for security

**Note**: The included S3Storage is a mock implementation for demonstration. For production use, you'll need to implement the actual AWS SDK calls.

### LocalStorage

Saves files to the local filesystem with secure filename handling:

```javascript
import { LocalStorage } from 'jsonrestapi/plugins/storage/local-storage.js';

const localStorage = new LocalStorage({
  directory: './uploads',              // Where to save files
  baseUrl: '/uploads',                 // Public URL prefix
  nameStrategy: 'hash',                // Filename strategy (see below)
  preserveExtension: true,             // Keep file extensions? (default: true)
  allowedExtensions: ['.jpg', '.png'], // Extension whitelist (optional)
  maxFilenameLength: 255,              // Max filename length
  nameGenerator: async (file) => {...} // Custom name generator (optional)
});
```

**Filename Strategies:**

1. **`'hash'`** (default) - Cryptographically secure random names
   ```javascript
   nameStrategy: 'hash'
   // Result: "a7f8d9e2b4c6e1f3.jpg"
   ```

2. **`'timestamp'`** - Timestamp with random suffix (sortable)
   ```javascript
   nameStrategy: 'timestamp'
   // Result: "1672531200000_a8f9.pdf"
   ```

3. **`'original'`** - Sanitized original filename (user-friendly)
   ```javascript
   nameStrategy: 'original'
   // "My Photo!.jpg" → "My_Photo_.jpg"
   // Duplicates → "My_Photo_1.jpg", "My_Photo_2.jpg"
   ```

4. **`'custom'`** - Your own naming logic
   ```javascript
   nameStrategy: 'custom',
   nameGenerator: async (file) => {
     const userId = file.metadata?.userId || 'anonymous';
     return `user_${userId}_${Date.now()}`;
   }
   // Result: "user_12345_1672531200000.jpg"
   ```

**Security Features:**
- Path traversal protection (removes `..` and `/`)
- Control character filtering
- Extension validation against whitelist
- Automatic duplicate handling
- MIME type to extension mapping

### Custom Storage Adapters

Create your own storage adapter by implementing the required interface:

```javascript
class MyCustomStorage {
  async upload(file) {
    // file object contains:
    // - filename: original filename
    // - mimetype: MIME type
    // - size: size in bytes
    // - data: Buffer with file contents
    // - filepath: temp file path (if using formidable)
    // - cleanup: async function to cleanup temp files
    
    // Save the file somewhere
    const url = await saveFileSomewhere(file);
    
    // Return the public URL
    return url;
  }
  
  async delete(url) {
    // Optional: implement file deletion
    await deleteFileSomewhere(url);
  }
}
```

## Protocol Configuration

Different protocols have different configuration options for file parsing.

### ExpressPlugin Configuration

The Express plugin supports multiple file parsers:

```javascript
api.use(ExpressPlugin, {
  // Choose parser: 'busboy', 'formidable', or a function
  fileParser: 'busboy',
  
  // Parser-specific options
  fileParserOptions: {
    // For busboy
    limits: {
      fileSize: 10 * 1024 * 1024,  // 10MB max file size
      files: 5,                     // Max 5 files per request
      fields: 20,                   // Max 20 non-file fields
      parts: 25                     // Max 25 total parts
    }
  },
  
  // Or use formidable
  // fileParser: 'formidable',
  // fileParserOptions: {
  //   uploadDir: './temp',        // Temp directory
  //   keepExtensions: true,       // Keep file extensions
  //   maxFileSize: 200 * 1024 * 1024  // 200MB max
  // }
  
  // Disable file uploads entirely
  // enableFileUploads: false
});
```

#### Using Express Middleware

For advanced use cases, you can use Express middleware for file handling:

```javascript
import multer from 'multer';

const upload = multer({ dest: 'uploads/' });

api.use(ExpressPlugin, {
  middleware: {
    beforeScope: {
      // Add multer to specific scope
      images: [upload.single('file')],
      
      // Multiple files for another scope
      gallery: [upload.array('photos', 10)]
    }
  },
  
  // Disable built-in file handling since we're using multer
  enableFileUploads: false
});
```

### HttpPlugin Configuration

The HTTP plugin has similar configuration:

```javascript
api.use(HttpPlugin, {
  // Choose parser: 'busboy', 'formidable', or a function
  fileParser: 'formidable',
  
  fileParserOptions: {
    uploadDir: './uploads/temp',
    keepExtensions: true,
    maxFileSize: 100 * 1024 * 1024  // 100MB
  },
  
  // Other HTTP options
  port: 3000,
  basePath: '/api'
});
```

### Custom File Parsers

You can provide a custom file parser:

```javascript
api.use(HttpPlugin, {
  fileParser: (options) => ({
    name: 'my-custom-parser',
    detect: (params) => {
      // Return true if this parser can handle the request
      const req = params._httpReq;
      return req.headers['content-type']?.includes('multipart/form-data');
    },
    parse: async (params) => {
      // Parse the request and return { fields, files }
      const req = params._httpReq;
      const { fields, files } = await myCustomParser(req);
      return { fields, files };
    }
  })
});
```

## File Validation

The FileHandlingPlugin automatically validates files based on schema configuration.

### MIME Type Validation

```javascript
// Accept only images
file: {
  type: 'file',
  storage: localStorage,
  accepts: ['image/*']
}

// Accept specific types
document: {
  type: 'file',
  storage: s3Storage,
  accepts: ['application/pdf', 'application/msword', 'text/plain']
}

// Accept anything (not recommended)
attachment: {
  type: 'file',
  storage: localStorage,
  accepts: ['*']
}
```

### Size Validation

```javascript
// Human-readable format
avatar: {
  type: 'file',
  storage: localStorage,
  maxSize: '5mb'
}

// Supports: b, kb, mb, gb
largeFile: {
  type: 'file',
  storage: s3Storage,
  maxSize: '1.5gb'
}
```

### Required Files

```javascript
// This file must be provided
document: {
  type: 'file',
  storage: s3Storage,
  required: true
}
```

### Validation Errors

When validation fails, you'll get appropriate error responses:

```json
{
  "errors": [{
    "status": "422",
    "title": "Validation Error",
    "detail": "Invalid file type for field 'avatar'",
    "source": {
      "pointer": "/data/attributes/avatar"
    }
  }]
}
```

## Complete Examples

### Basic Image Upload

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'jsonrestapi';
import { LocalStorage } from 'jsonrestapi/plugins/storage/local-storage.js';
import express from 'express';

// Setup
const api = new Api({ name: 'image-api', version: '1.0.0' });
const storage = new LocalStorage({
  directory: './uploads/images',
  baseUrl: 'http://localhost:3000/uploads/images'
});

// Plugins
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);
api.use(ExpressPlugin);

// Schema
api.addScope('photos', {
  schema: {
    caption: { type: 'string', required: true },
    image: {
      type: 'file',
      storage: storage,
      accepts: ['image/jpeg', 'image/png'],
      maxSize: '10mb',
      required: true
    }
  }
});

// Express app
const app = express();
app.use('/uploads', express.static('./uploads'));
api.mountExpress(app);

// HTML form for testing
app.get('/', (req, res) => {
  res.send(`
    <form action="/api/photos" method="POST" enctype="multipart/form-data">
      <input name="caption" placeholder="Caption" required>
      <input name="image" type="file" accept="image/*" required>
      <button type="submit">Upload Photo</button>
    </form>
  `);
});

app.listen(3000);
```

### Multiple Storage Backends

```javascript
// Different storage for different fields
api.addScope('articles', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    
    // Featured image goes to S3
    featuredImage: {
      type: 'file',
      storage: s3Storage,
      accepts: ['image/*'],
      maxSize: '20mb'
    },
    
    // Attachments stay local
    attachment: {
      type: 'file',
      storage: localStorage,
      accepts: ['application/pdf', 'application/zip'],
      maxSize: '100mb'
    }
  }
});
```

### Filename Handling Examples

Different strategies for different use cases:

```javascript
import { LocalStorage } from 'jsonrestapi/plugins/storage/local-storage.js';

// User avatars - use hash for security and deduplication
const avatarStorage = new LocalStorage({
  directory: './uploads/avatars',
  baseUrl: '/uploads/avatars',
  nameStrategy: 'hash'
});

// Documents - use timestamp for sorting
const documentStorage = new LocalStorage({
  directory: './uploads/documents',
  baseUrl: '/uploads/documents',
  nameStrategy: 'timestamp'
});

// User downloads - preserve original names
const downloadStorage = new LocalStorage({
  directory: './uploads/downloads',
  baseUrl: '/uploads/downloads',
  nameStrategy: 'original',
  maxFilenameLength: 100
});

// High security - no extensions
const secureStorage = new LocalStorage({
  directory: './uploads/secure',
  baseUrl: '/uploads/secure',
  nameStrategy: 'hash',
  preserveExtension: false,  // All files saved as .bin
  allowedExtensions: ['.pdf', '.doc', '.docx']  // Still validates input
});

// Organized by date
const organizedStorage = new LocalStorage({
  directory: './uploads',
  baseUrl: '/uploads',
  nameStrategy: 'custom',
  nameGenerator: async (file) => {
    const date = new Date();
    const dateDir = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `${dateDir}/${crypto.randomBytes(16).toString('hex')}`;
  }
});
// Saves as: "2024/01/a7f8d9e2b4c6e1f3.jpg"
```

### Using cURL

```bash
# Upload with cURL
curl -X POST http://localhost:3000/api/photos \
  -F "caption=Beautiful sunset" \
  -F "image=@/path/to/sunset.jpg"

# Multiple files
curl -X POST http://localhost:3000/api/articles \
  -F "title=My Article" \
  -F "content=Article content here" \
  -F "featuredImage=@/path/to/hero.jpg" \
  -F "attachment=@/path/to/document.pdf"
```

### Programmatic Upload

```javascript
// Using fetch with FormData
const formData = new FormData();
formData.append('caption', 'My photo');
formData.append('image', fileInput.files[0]);

const response = await fetch('/api/photos', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Uploaded:', result.data.attributes.image); // URL of uploaded file
```

## Troubleshooting

### Common Issues

#### 1. "Busboy not available, file uploads disabled"

Install the peer dependency:
```bash
npm install busboy
```

#### 2. "No storage configured for file field"

Make sure you've set the storage property:
```javascript
file: {
  type: 'file',
  storage: myStorage  // This is required!
}
```

#### 3. Files not being detected

Check that:
1. The FileHandlingPlugin is loaded AFTER RestApiPlugin
2. Your protocol plugin has file uploads enabled
3. The request has proper multipart headers
4. You're using the correct form encoding

```html
<!-- HTML forms need this -->
<form enctype="multipart/form-data">
```

#### 4. "File too large" errors

Check both:
1. Schema `maxSize` configuration
2. Parser limits in plugin options

```javascript
// Both limits apply!
api.use(ExpressPlugin, {
  fileParserOptions: {
    limits: { fileSize: 10 * 1024 * 1024 }  // 10MB parser limit
  }
});

api.addScope('images', {
  schema: {
    photo: {
      type: 'file',
      maxSize: '5mb'  // 5MB schema limit (lower wins)
    }
  }
});
```

### Debug Mode

Enable debug logging to see what's happening:

```javascript
const api = new Api({
  name: 'my-api',
  version: '1.0.0',
  logLevel: 'debug'  // or 'trace' for more detail
});
```

### Testing File Uploads

Use the included example to test your setup:

```javascript
// Run the example
node ./node_modules/jsonrestapi/examples/file-upload-example.js
```

Then visit http://localhost:3000 to see the test forms.

## Best Practices

1. **Always validate file types** - Don't use `accepts: ['*']` in production
2. **Set reasonable size limits** - Prevent abuse and server overload
3. **Use appropriate storage** - Local for small files, S3 for large/many files
4. **Clean up temp files** - Storage adapters should handle cleanup
5. **Serve files separately** - Don't serve uploaded files through your API
6. **Validate file contents** - Consider virus scanning for user uploads
7. **Use CDN for images** - Serve uploaded images through a CDN in production

## Security Considerations

### Filename Security

1. **Never trust user filenames** - Always sanitize or generate new names
   ```javascript
   // BAD - Direct use of user filename
   const filename = file.originalname;
   
   // GOOD - Generate secure name
   const filename = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
   ```

2. **Prevent path traversal** - Remove dangerous characters
   ```javascript
   // Dangerous filenames to watch for:
   // "../../../etc/passwd"
   // "..\\..\\windows\\system32\\config\\sam"
   // "uploads/../../../index.js"
   
   // LocalStorage handles this automatically
   ```

3. **Extension validation** - Whitelist allowed extensions
   ```javascript
   // Use LocalStorage with whitelist
   const storage = new LocalStorage({
     allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf']
   });
   ```

4. **Consider removing extensions entirely** for sensitive files
   ```javascript
   const highSecurityStorage = new LocalStorage({
     nameStrategy: 'hash',
     preserveExtension: false  // All files become .bin
   });
   ```

### General File Security

1. **Validate MIME types** - But remember they can be spoofed
2. **Check file contents** - Use libraries like `file-type` for verification
3. **Limit upload sizes** - Prevent denial of service
4. **Store files outside web root** - Prevent direct execution
5. **Use virus scanning** - For user-uploaded content
6. **Set proper permissions** - Uploaded files shouldn't be executable
7. **Serve files with proper headers** - Use Content-Disposition for downloads

## Next Steps

- Implement production S3 storage with actual AWS SDK
- Add image processing (thumbnails, resizing)
- Implement virus scanning for uploads
- Add progress tracking for large files
- Create a chunked upload system for very large files