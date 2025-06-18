/**
 * Silent Fields Example
 * 
 * Shows how to use the 'silent' option to exclude fields from default selection
 */

import { createApi, Schema } from '../index.js';

// Setup
const api = createApi({
  name: 'app',
  version: '1.0.0',
  storage: 'mysql',
  mysql: { connection: dbConfig }
});

// ============================================================
// SCHEMA WITH SILENT FIELDS
// ============================================================

const userSchema = new Schema({
  id: { type: 'id' },
  username: { type: 'string', required: true },
  email: { type: 'string', required: true },
  firstName: { type: 'string' },
  lastName: { type: 'string' },
  
  // Silent fields - not selected by default
  passwordHash: { type: 'string', silent: true },
  salt: { type: 'string', silent: true },
  twoFactorSecret: { type: 'string', silent: true },
  
  // Internal metadata - also silent
  internalNotes: { type: 'string', silent: true },
  riskScore: { type: 'number', silent: true },
  
  // Regular fields
  avatar: { type: 'string' },
  bio: { type: 'string' },
  createdAt: { type: 'timestamp' },
  lastLoginAt: { type: 'timestamp' }
});

const postSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  content: { type: 'string' },
  publishedAt: { type: 'timestamp' },
  authorId: { type: 'id', refs: { resource: 'users' } },
  
  // Draft content - only for internal use
  draftContent: { type: 'string', silent: true },
  editorNotes: { type: 'string', silent: true },
  
  // Analytics data - not public
  viewCount: { type: 'number', silent: true },
  uniqueVisitors: { type: 'number', silent: true }
});

api.addResource('users', userSchema);
api.addResource('posts', postSchema);

// ============================================================
// DEFAULT BEHAVIOR - SILENT FIELDS EXCLUDED
// ============================================================

// When no fields are specified, the query builder automatically
// excludes silent fields

api.hook('initializeQuery', async (context) => {
  console.log('Query SQL:', context.query.toSQL());
});

/*
For users table, the default query will be:

SELECT 
  `users`.`id`,
  `users`.`username`,
  `users`.`email`,
  `users`.`firstName`,
  `users`.`lastName`,
  `users`.`avatar`,
  `users`.`bio`,
  `users`.`createdAt`,
  `users`.`lastLoginAt`
FROM `users`

Notice: passwordHash, salt, twoFactorSecret, internalNotes, 
and riskScore are NOT included!
*/

// ============================================================
// EXPLICIT SELECTION - CAN INCLUDE SILENT FIELDS
// ============================================================

// Admin endpoints might need access to silent fields
api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'users' && context.options.admin) {
    // Explicitly add some silent fields for admin view
    context.query
      .select('users.internalNotes')
      .select('users.riskScore');
  }
});

// ============================================================
// RELATED RESOURCES - SILENT FIELDS ALSO EXCLUDED
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'posts') {
    // When including related user data, silent fields are still excluded
    context.query.includeRelated('authorId');
    
    // This will include: id, username, email, firstName, lastName, avatar, bio, etc.
    // But NOT: passwordHash, salt, twoFactorSecret, etc.
  }
});

// ============================================================
// USE CASES FOR SILENT FIELDS
// ============================================================

// 1. Security - Sensitive data that should never be exposed publicly
const authSchema = new Schema({
  id: { type: 'id' },
  userId: { type: 'id', refs: { resource: 'users' } },
  token: { type: 'string' },
  refreshToken: { type: 'string', silent: true },
  clientSecret: { type: 'string', silent: true }
});

// 2. Performance - Large fields that are rarely needed
const articleSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string' },
  summary: { type: 'string' },
  fullHtmlContent: { type: 'string', silent: true },  // Could be megabytes
  cachedPdfVersion: { type: 'binary', silent: true }  // Large binary data
});

// 3. Internal Metadata - System fields not meant for API consumers
const productSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string' },
  price: { type: 'number' },
  
  // Internal fields
  costPrice: { type: 'number', silent: true },
  supplierCode: { type: 'string', silent: true },
  warehouseLocation: { type: 'string', silent: true }
});

// ============================================================
// CONDITIONAL SILENT FIELDS
// ============================================================

// You can make fields conditionally silent based on context
api.hook('beforeSchema', async (context) => {
  if (context.options.type === 'users' && !context.options.includePrivate) {
    // Make email silent for non-authenticated requests
    const schema = api.schemas.get('users');
    if (!context.authenticated) {
      schema.structure.email.silent = true;
    }
  }
});

// ============================================================
// COMPARISON WITH MANUAL FIELD SELECTION
// ============================================================

// Without silent fields - you'd have to manually specify fields everywhere:
/*
api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'users') {
    context.query
      .clearSelect()
      .select('id', 'username', 'email', 'firstName', 'lastName', 
              'avatar', 'bio', 'createdAt', 'lastLoginAt');
    // Tedious and error-prone!
  }
});
*/

// With silent fields - just mark sensitive fields once in schema:
// Much cleaner and maintainable!

// ============================================================
// INTEGRATION WITH JSON:API
// ============================================================

// Silent fields are automatically excluded from JSON:API responses
// Even if they somehow get selected in the query

api.hook('beforeSend', async (context) => {
  if (context.result?.data) {
    const schema = api.schemas.get(context.options.type);
    const records = Array.isArray(context.result.data) 
      ? context.result.data 
      : [context.result.data];
    
    // Remove any silent fields that might have been included
    records.forEach(record => {
      Object.keys(schema.structure).forEach(field => {
        if (schema.structure[field].silent) {
          delete record.attributes[field];
        }
      });
    });
  }
});

// ============================================================
// BEST PRACTICES
// ============================================================

/*
1. Use silent for:
   - Passwords and authentication secrets
   - Internal IDs and codes
   - Large binary data
   - Cached/computed fields
   - System metadata

2. Don't use silent for:
   - Fields that users might occasionally need
   - Fields that should be permission-controlled (use hooks instead)

3. Remember:
   - Silent only affects DEFAULT selection
   - You can always explicitly select silent fields when needed
   - Silent fields are a performance optimization AND security feature
*/