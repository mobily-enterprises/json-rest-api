import express from 'express';
import { Api, Schema, MemoryPlugin, HTTPPlugin } from '../index.js';
import { DiscoveryPlugin } from '../plugins/discovery/index.js';

// Create Express app
const app = express();

// Create API instance
const api = new Api({
  name: 'Blog API',
  version: '2.0.0'
});

// Use memory storage
api.use(MemoryPlugin);

// Add Discovery plugin BEFORE HTTPPlugin to ensure routes are registered properly
api.use(DiscoveryPlugin, {
  info: {
    title: 'Blog API',
    description: 'A simple blog API with posts and comments',
    contact: { email: 'api@example.com' }
  },
  swaggerUI: { tryItOut: true }
});

// Add HTTP plugin
api.use(HTTPPlugin, { app });

// Manual route installation (needed if HTTPPlugin was loaded first)
if (api._installDiscoveryRoutes) {
  api._installDiscoveryRoutes();
}

// Define schemas
const userSchema = new Schema({
  name: { 
    type: 'string', 
    required: true, 
    min: 2, 
    max: 100,
    description: 'The user\'s full name'
  },
  email: { 
    type: 'string', 
    required: true, 
    unique: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    description: 'Valid email address'
  },
  role: { 
    type: 'string', 
    enum: ['admin', 'editor', 'user'],
    default: 'user',
    description: 'User role for permissions'
  },
  active: {
    type: 'boolean',
    default: true,
    description: 'Whether the user account is active'
  }
});

const postSchema = new Schema({
  title: { 
    type: 'string', 
    required: true,
    searchable: true,
    description: 'Post title'
  },
  content: { 
    type: 'string', 
    required: true,
    description: 'Post content in markdown'
  },
  authorId: { 
    type: 'id', 
    required: true,
    refs: { 
      resource: 'users',
      join: { eager: true },
      provideUrl: true 
    },
    description: 'ID of the post author'
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Array of tag strings'
  },
  published: {
    type: 'boolean',
    default: false,
    searchable: true,
    description: 'Whether the post is published'
  },
  publishedAt: {
    type: 'date',
    description: 'When the post was published'
  },
  viewCount: {
    type: 'number',
    default: 0,
    permissions: { write: 'admin' }, // Only admins can modify view count
    description: 'Number of times the post has been viewed'
  }
});

const commentSchema = new Schema({
  content: {
    type: 'string',
    required: true,
    description: 'Comment text'
  },
  postId: {
    type: 'id',
    required: true,
    refs: { resource: 'posts' },
    searchable: true,
    description: 'ID of the post this comment belongs to'
  },
  authorId: {
    type: 'id',
    required: true,
    refs: { resource: 'users' },
    description: 'ID of the comment author'
  },
  approved: {
    type: 'boolean',
    default: true,
    permissions: { write: 'admin' }, // Only admins can approve/reject
    description: 'Whether the comment is approved'
  }
});

// Register resources
api.addResource('users', userSchema);
api.addResource('posts', postSchema);
api.addResource('comments', commentSchema);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Blog API with Discovery running on http://localhost:${PORT}`);
  console.log('\nDiscovery endpoints:');
  console.log(`  GET http://localhost:${PORT}/api/discovery              - Discovery index`);
  console.log(`  GET http://localhost:${PORT}/api/discovery/openapi      - OpenAPI JSON`);
  console.log(`  GET http://localhost:${PORT}/api/discovery/openapi.yaml - OpenAPI YAML`);
  console.log(`  GET http://localhost:${PORT}/api/discovery/jsonschema   - JSON Schema`);
  console.log(`  GET http://localhost:${PORT}/api/docs                   - Swagger UI`);
  console.log('\nAPI endpoints:');
  console.log(`  GET http://localhost:${PORT}/api/users                  - List users`);
  console.log(`  GET http://localhost:${PORT}/api/posts                  - List posts`);
  console.log(`  GET http://localhost:${PORT}/api/comments               - List comments`);
  console.log('\nTry the interactive documentation at http://localhost:' + PORT + '/api/docs');
});