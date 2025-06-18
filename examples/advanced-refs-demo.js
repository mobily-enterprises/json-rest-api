#!/usr/bin/env node

/**
 * Advanced Refs Demo
 * 
 * Demonstrates the power of automatic joins in JSON REST API
 */

import express from 'express';
import { createApi, Schema } from '../index.js';

const app = express();
app.use(express.json());

// Create API
const api = createApi({
  name: 'blog',
  version: '1.0.0',
  storage: 'memory', // Using memory for demo
  http: { basePath: '/api' }
});

// Define schemas with advanced refs
const userSchema = new Schema({
  id: { type: 'id' },
  username: { type: 'string', required: true },
  email: { type: 'string', required: true },
  name: { type: 'string' },
  avatar: { type: 'string' },
  bio: { type: 'string' },
  secretToken: { type: 'string', silent: true } // Won't be in joins
});

const categorySchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  slug: { type: 'string', required: true },
  description: { type: 'string' }
});

const postSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  content: { type: 'string' },
  publishedAt: { type: 'timestamp' },
  
  // Eager join - replaces ID with user object
  authorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        eager: true,
        fields: ['id', 'username', 'name', 'avatar']
      }
    }
  },
  
  // Lazy join with separate field
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories',
      join: {
        eager: false,
        resourceField: 'category'
      }
    }
  },
  
  // Eager with preserveId
  lastEditedById: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        eager: true,
        preserveId: true,
        fields: ['id', 'username']
      }
    }
  }
});

// Register resources
api.addResource('users', userSchema);
api.addResource('categories', categorySchema);
api.addResource('posts', postSchema);

// Add hooks to show join context
api.hook('afterGet', async (context) => {
  if (context.options.isJoinResult) {
    console.log(`🔗 Join hook called for ${context.options.type} as part of ${context.options.parentType}.${context.options.parentField}`);
  }
});

// Seed some data
async function seedData() {
  console.log('🌱 Seeding demo data...\n');
  
  // Create users
  const john = await api.resources.users.create({
    username: 'johndoe',
    email: 'john@example.com',
    name: 'John Doe',
    avatar: 'https://example.com/john.jpg',
    bio: 'Software developer',
    secretToken: 'secret123'
  });
  
  const jane = await api.resources.users.create({
    username: 'janesmith',
    email: 'jane@example.com',
    name: 'Jane Smith',
    avatar: 'https://example.com/jane.jpg',
    bio: 'Tech writer'
  });
  
  // Create categories
  const tech = await api.resources.categories.create({
    name: 'Technology',
    slug: 'technology',
    description: 'Tech news and tutorials'
  });
  
  const tutorial = await api.resources.categories.create({
    name: 'Tutorial',
    slug: 'tutorial',
    description: 'How-to guides'
  });
  
  // Create posts
  await api.resources.posts.create({
    title: 'Introduction to Advanced Refs',
    content: 'Learn how automatic joins work in JSON REST API...',
    publishedAt: Date.now(),
    authorId: john.data.id,
    categoryId: tech.data.id,
    lastEditedById: jane.data.id
  });
  
  await api.resources.posts.create({
    title: 'Building REST APIs with Node.js',
    content: 'A comprehensive guide to REST API development...',
    publishedAt: Date.now(),
    authorId: jane.data.id,
    categoryId: tutorial.data.id,
    lastEditedById: jane.data.id
  });
  
  console.log('✅ Data seeded successfully!\n');
}

// Mount API
api.mount(app);

// Demo routes
app.get('/', (req, res) => {
  res.send(`
    <h1>Advanced Refs Demo</h1>
    <h2>Try these endpoints:</h2>
    <ul>
      <li><a href="/api/1.0.0/posts">/api/1.0.0/posts</a> - Posts with eager joins</li>
      <li><a href="/api/1.0.0/posts?joins=false">/api/1.0.0/posts?joins=false</a> - Posts without joins</li>
      <li><a href="/api/1.0.0/posts?joins=categoryId">/api/1.0.0/posts?joins=categoryId</a> - Posts with category join</li>
      <li><a href="/api/1.0.0/posts/1">/api/1.0.0/posts/1</a> - Single post with joins</li>
      <li><a href="/api/1.0.0/posts/1?excludeJoins=authorId">/api/1.0.0/posts/1?excludeJoins=authorId</a> - Post without author join</li>
    </ul>
    <p>Check the console to see join hooks in action!</p>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;

seedData().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📚 API docs at http://localhost:${PORT}/`);
    console.log('\n🔍 Watch the console to see join hooks in action!');
  });
}).catch(console.error);