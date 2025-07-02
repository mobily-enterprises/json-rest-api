/**
 * File Upload Example
 * 
 * This example demonstrates how to use the file handling plugin
 * with various storage backends and protocols.
 */

import { Api } from 'hooked-api';
import { 
  RestApiPlugin, 
  FileHandlingPlugin,
  ExpressPlugin,
  HttpPlugin 
} from '../index.js';
import { LocalStorage } from '../plugins/storage/local-storage.js';
import { S3Storage } from '../plugins/storage/s3-storage.js';
import express from 'express';

// Create API instance
const api = new Api({
  name: 'file-upload-example',
  version: '1.0.0'
});

// Configure storage backends
const localStorage = new LocalStorage({
  directory: './uploads/images',
  baseUrl: 'http://localhost:3000/uploads/images'
});

const s3Storage = new S3Storage({
  bucket: 'my-app-uploads',
  region: 'us-east-1',
  prefix: 'user-uploads/',
  mockMode: true // Using mock mode for this example
});

// Use plugins - order matters!
api.use(RestApiPlugin);
api.use(FileHandlingPlugin); // Must come after RestApiPlugin
api.use(ExpressPlugin, {
  fileParser: 'busboy', // or 'formidable'
  fileParserOptions: {
    limits: { 
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 5 // Max 5 files per request
    }
  }
});

// Define schemas with file fields
api.addScope('users', {
  schema: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    avatar: {
      type: 'file',
      storage: localStorage,
      accepts: ['image/jpeg', 'image/png', 'image/gif'],
      maxSize: '5mb',
      required: false
    }
  }
});

api.addScope('documents', {
  schema: {
    title: { type: 'string', required: true },
    description: { type: 'string' },
    file: {
      type: 'file',
      storage: s3Storage,
      accepts: ['application/pdf', 'application/msword', 'text/plain'],
      maxSize: '50mb',
      required: true
    },
    thumbnail: {
      type: 'file',
      storage: localStorage,
      accepts: ['image/*'],
      maxSize: '2mb',
      required: false
    }
  }
});

// Add storage helpers for demonstration
api.vars.helpers.dataPost = async ({ scopeName, inputRecord }) => {
  console.log(`Creating ${scopeName}:`, inputRecord);
  
  // Simulate database save
  const id = Math.random().toString(36).substring(7);
  
  return {
    data: {
      type: scopeName,
      id: id,
      attributes: inputRecord.data.attributes
    }
  };
};

api.vars.helpers.dataGet = async ({ scopeName, id }) => {
  // Simulate database fetch
  return {
    data: {
      type: scopeName,
      id: id,
      attributes: {
        // Would normally fetch from database
      }
    }
  };
};

// Create Express app
const app = express();

// Serve uploaded files statically
app.use('/uploads', express.static('./uploads'));

// Mount API
api.mountExpress(app, '/api');

// Add a simple upload form for testing
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>File Upload Example</title>
    </head>
    <body>
      <h1>File Upload Example</h1>
      
      <h2>Create User with Avatar</h2>
      <form action="/api/users" method="POST" enctype="multipart/form-data">
        <div>
          <label>Name: <input name="name" required></label>
        </div>
        <div>
          <label>Email: <input name="email" type="email" required></label>
        </div>
        <div>
          <label>Avatar: <input name="avatar" type="file" accept="image/*"></label>
        </div>
        <button type="submit">Create User</button>
      </form>
      
      <h2>Upload Document</h2>
      <form action="/api/documents" method="POST" enctype="multipart/form-data">
        <div>
          <label>Title: <input name="title" required></label>
        </div>
        <div>
          <label>Description: <textarea name="description"></textarea></label>
        </div>
        <div>
          <label>Document: <input name="file" type="file" accept=".pdf,.doc,.txt" required></label>
        </div>
        <div>
          <label>Thumbnail: <input name="thumbnail" type="file" accept="image/*"></label>
        </div>
        <button type="submit">Upload Document</button>
      </form>
      
      <hr>
      <p>Note: The form data will be automatically converted to JSON:API format by the file handling plugin.</p>
    </body>
    </html>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`File upload example running at http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  POST http://localhost:${PORT}/api/users (with multipart form data)`);
  console.log(`  POST http://localhost:${PORT}/api/documents (with multipart form data)`);
});

// Example cURL commands:
/*
# Upload user with avatar
curl -X POST http://localhost:3000/api/users \
  -F "name=John Doe" \
  -F "email=john@example.com" \
  -F "avatar=@/path/to/avatar.jpg"

# Upload document with thumbnail
curl -X POST http://localhost:3000/api/documents \
  -F "title=Important Document" \
  -F "description=This is a very important document" \
  -F "file=@/path/to/document.pdf" \
  -F "thumbnail=@/path/to/thumbnail.png"

# The file handling plugin will:
# 1. Detect the multipart upload
# 2. Parse the files
# 3. Validate file types and sizes
# 4. Upload to configured storage
# 5. Replace file fields with URLs
# 6. Convert to JSON:API format
*/