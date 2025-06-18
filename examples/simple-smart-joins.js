/**
 * Simple Smart Joins Example
 * 
 * A complete, runnable example showing how to use automatic joins with refs
 */

import express from 'express';
import { createApi, Schema } from '../index.js';

const app = express();

// 1. CREATE YOUR API
const api = createApi({
  name: 'blog',
  version: '1.0.0',
  storage: 'mysql',
  mysql: {
    connection: {
      host: 'localhost',
      user: 'root',
      password: 'password',
      database: 'blog_db'
    }
  },
  http: { basePath: '/api' }
});

// 2. DEFINE SCHEMAS WITH RELATIONSHIPS
// Notice the 'refs' property - this is the magic!

const postSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  content: { type: 'string' },
  authorId: { 
    type: 'id', 
    refs: { resource: 'users' }  // This says: authorId points to the users table
  },
  categoryId: { 
    type: 'id', 
    refs: { resource: 'categories' }  // This says: categoryId points to categories table
  },
  createdAt: { type: 'timestamp' }
});

const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  avatar: { type: 'string' },
  bio: { type: 'string' }
});

const categorySchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  slug: { type: 'string', required: true }
});

// 3. REGISTER YOUR RESOURCES
api.addResource('posts', postSchema);
api.addResource('users', userSchema);
api.addResource('categories', categorySchema);

// 4. USE SMART JOINS IN A HOOK
// This is where the magic happens!

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'posts') {
    // OLD WAY (without refs):
    // context.query
    //   .leftJoin('users', 'users.id = posts.authorId')
    //   .leftJoin('categories', 'categories.id = posts.categoryId')
    //   .select('users.name as authorName', 'categories.name as categoryName');
    
    // NEW WAY (with refs) - SO MUCH SIMPLER!
    context.query
      .leftJoin('authorId')      // That's it! It knows to join users table
      .leftJoin('categoryId')    // That's it! It knows to join categories table
      .select('users.name as authorName', 'categories.name as categoryName');
  }
});

// 5. EVEN SIMPLER - INCLUDE ALL FIELDS FROM RELATED TABLES

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'posts' && context.params.includeAll) {
    // This single line includes ALL fields from the author (user)
    context.query.includeRelated('authorId');
    
    // This single line includes ALL fields from the category
    context.query.includeRelated('categoryId');
    
    // That's it! No need to specify joins or field names!
  }
});

// 6. SELECTIVE INCLUDES - CHOOSE SPECIFIC FIELDS

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'posts' && context.params.include) {
    // Only include specific fields from related tables
    context.query
      .includeRelated('authorId', ['name', 'avatar'])     // Only name and avatar from users
      .includeRelated('categoryId', ['name', 'slug']);    // Only name and slug from categories
  }
});

// 7. MOUNT THE API
api.mount(app);

// Start server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

// ============================================================
// HOW TO USE IT - API CALLS
// ============================================================

/*
1. BASIC QUERY (no joins):
   GET http://localhost:3000/api/1.0.0/posts
   
   Returns:
   {
     "data": [{
       "type": "posts",
       "id": "1",
       "attributes": {
         "title": "My First Post",
         "content": "Hello world!",
         "authorId": 123,
         "categoryId": 456,
         "createdAt": 1634567890
       }
     }]
   }

2. WITH AUTHOR AND CATEGORY NAMES (using our first hook):
   GET http://localhost:3000/api/1.0.0/posts
   
   Returns:
   {
     "data": [{
       "type": "posts",
       "id": "1",
       "attributes": {
         "title": "My First Post",
         "content": "Hello world!",
         "authorId": 123,
         "categoryId": 456,
         "createdAt": 1634567890,
         "authorName": "John Doe",        // Added by our hook!
         "categoryName": "Technology"      // Added by our hook!
       }
     }]
   }

3. INCLUDE ALL RELATED FIELDS:
   GET http://localhost:3000/api/1.0.0/posts?includeAll=true
   
   Returns:
   {
     "data": [{
       "type": "posts",
       "id": "1",
       "attributes": {
         "title": "My First Post",
         "content": "Hello world!",
         "authorId": 123,
         "categoryId": 456,
         "createdAt": 1634567890,
         "authorId_id": 123,              // All user fields prefixed with authorId_
         "authorId_name": "John Doe",
         "authorId_email": "john@example.com",
         "authorId_avatar": "avatar.jpg",
         "authorId_bio": "Developer",
         "categoryId_id": 456,            // All category fields prefixed with categoryId_
         "categoryId_name": "Technology",
         "categoryId_slug": "technology"
       }
     }]
   }

4. INCLUDE SPECIFIC FIELDS:
   GET http://localhost:3000/api/1.0.0/posts?include=true
   
   Returns:
   {
     "data": [{
       "type": "posts",
       "id": "1",
       "attributes": {
         "title": "My First Post",
         "content": "Hello world!",
         "authorId": 123,
         "categoryId": 456,
         "createdAt": 1634567890,
         "authorId_name": "John Doe",      // Only requested fields
         "authorId_avatar": "avatar.jpg",
         "categoryId_name": "Technology",
         "categoryId_slug": "technology"
       }
     }]
   }
*/

// ============================================================
// STEP BY STEP EXPLANATION
// ============================================================

/*
1. When you define a schema field with refs:
   authorId: { type: 'id', refs: { resource: 'users' } }
   
   This tells the system: "authorId is a foreign key that points to the users table"

2. When you call:
   query.leftJoin('authorId')
   
   The query builder:
   - Looks up the field 'authorId' in your schema
   - Finds refs: { resource: 'users' }
   - Automatically generates: LEFT JOIN users ON users.id = posts.authorId

3. When you call:
   query.includeRelated('authorId')
   
   The query builder:
   - Does the join (like above)
   - Looks up the users schema
   - Adds SELECT for all non-silent fields from users table
   - Prefixes them with 'authorId_' to avoid conflicts

4. When you call:
   query.includeRelated('authorId', ['name', 'avatar'])
   
   The query builder:
   - Does the join (like above)
   - Only selects the specified fields
   - Still prefixes them with 'authorId_'
*/

// ============================================================
// COMPLETE SQL COMPARISON
// ============================================================

/*
OLD WAY (manual joins):
  query
    .leftJoin('users', 'users.id = posts.authorId')
    .leftJoin('categories', 'categories.id = posts.categoryId')
    .select('users.name as authorName', 'users.email as authorEmail')
    .select('categories.name as categoryName');

NEW WAY (smart joins):
  query
    .includeRelated('authorId', ['name', 'email'])
    .includeRelated('categoryId', ['name']);

Both produce similar SQL, but the new way:
- Is much shorter
- Uses your schema definitions
- Is less error-prone
- Self-documents relationships
*/