# Permissions and Authentication Guide

The JWT Authentication Plugin provides a powerful declarative permission system that makes it easy to secure your REST API resources. This guide shows you how to use authentication and define permissions using the book catalog example.

## Table of Contents
- [Overview](#overview)
- [Quick Start](#quick-start)
- [Getting Tokens from Auth Providers](#getting-tokens-from-auth-providers)
  - [Supabase](#supabase)
  - [Auth0](#auth0)
  - [Custom JWT](#custom-jwt)
- [Installation and Setup](#installation-and-setup)
- [Declarative Permissions](#declarative-permissions)
- [Built-in Auth Checkers](#built-in-auth-checkers)
- [Making Authenticated API Calls Directly](#making-authenticated-api-calls-directly)
- [Using Auth Helpers](#using-auth-helpers)
- [Token Management](#token-management)
- [Custom Auth Checkers](#custom-auth-checkers)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Overview

The JWT Auth Plugin provides two main features:

1. **Authentication** - Validates JWT tokens and populates `context.auth`
2. **Authorization** - Declarative permission rules on resources

The plugin validates tokens from any JWT provider (Supabase, Auth0, your own auth server) and enforces permissions you define on your resources.

## Quick Start

Here's how to get authentication working in 3 steps:

### 1. Get JWT tokens from your auth provider
```javascript
// Example with Supabase (in your frontend)
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// User login
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})

const token = session.access_token // This is your JWT token!
```

### 2. Configure the plugin in your API
```javascript
// In your API server
await api.use(JwtAuthPlugin, {
  // For Supabase
  jwksUrl: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  rolesField: 'app_metadata.roles'
})
```

### 3. Define permissions on resources
```javascript
await api.addResource('posts', {
  schema: { /* ... */ },
  
  auth: {
    query: ['public'],         // Anyone can read
    post: ['authenticated'],   // Must be logged in
    patch: ['is_owner'],       // Must own the post
    delete: ['is_owner', 'admin'] // Owner or admin
  }
})
```

That's it! Your API now requires authentication and enforces permissions.

## Getting Tokens from Auth Providers

The plugin doesn't generate tokens - it validates them. Here's how to get tokens from popular providers:

### Supabase

#### Step 1: Set up Supabase Auth
```javascript
// In your frontend app
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)
```

#### Step 2: User Registration/Login
```javascript
// Sign up new user
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'secure-password'
})

// Sign in existing user
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'secure-password'
})

// The JWT token is in session.access_token
const token = session.access_token
```

#### Step 3: Use token with your API
```javascript
// Make authenticated requests to your API
const response = await fetch('https://your-api.com/api/posts', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    data: {
      type: 'posts',
      attributes: {
        title: 'My Post',
        content: 'Hello world'
      }
    }
  })
})
```

#### Step 4: Configure plugin for Supabase
```javascript
await api.use(JwtAuthPlugin, {
  // Supabase JWKS URL - replace with your project URL
  jwksUrl: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  
  // Supabase stores roles in app_metadata
  rolesField: 'app_metadata.roles',
  
  // Optional: Add these for extra security
  audience: 'authenticated',
  issuer: process.env.SUPABASE_URL
})
```

### Auth0

#### Step 1: Set up Auth0
```javascript
// In your frontend
import { createAuth0Client } from '@auth0/auth0-spa-js'

const auth0 = await createAuth0Client({
  domain: 'your-domain.auth0.com',
  clientId: 'your-client-id',
  authorizationParams: {
    redirect_uri: window.location.origin,
    audience: 'https://your-api.com'
  }
})
```

#### Step 2: User Login
```javascript
// Redirect to Auth0 login
await auth0.loginWithRedirect()

// After redirect back, get token
const token = await auth0.getAccessTokenSilently()
```

#### Step 3: Configure plugin for Auth0
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  audience: process.env.AUTH0_AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  
  // Auth0 uses custom claims
  rolesField: 'https://your-app.com/roles'
})
```

### Custom JWT

If you're generating your own JWTs:

#### Step 1: Generate tokens in your auth server
```javascript
// In your auth server
import jwt from 'jsonwebtoken'

const token = jwt.sign(
  {
    sub: user.id,           // User ID
    email: user.email,
    roles: ['user', 'editor'],
    jti: generateUniqueId(), // For revocation
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' }
)
```

#### Step 2: Configure plugin with secret
```javascript
await api.use(JwtAuthPlugin, {
  secret: process.env.JWT_SECRET,
  
  // Your token structure
  userIdField: 'sub',
  rolesField: 'roles'
})
```

## Installation and Setup

```javascript
import { JwtAuthPlugin } from 'json-rest-api/plugins/core/jwt-auth-plugin.js';

// Install the plugin
await api.use(JwtAuthPlugin, {
  // Required: Choose one authentication method
  secret: 'your-secret-key',              // For HS256 tokens
  // OR
  publicKey: '-----BEGIN PUBLIC KEY...', // For RS256 tokens  
  // OR
  jwksUrl: 'https://your-auth-provider.com/.well-known/jwks.json', // For external auth
  
  // Optional: Token configuration
  audience: 'your-api-audience',
  issuer: 'https://your-auth-provider.com',
  
  // Optional: Field mappings
  userIdField: 'sub',        // Where to find user ID in token (default: 'sub')
  rolesField: 'roles',       // Where to find roles (default: 'roles')
  ownershipField: 'user_id', // Field in resources for ownership (default: 'user_id')
  
  // Optional: Revocation settings
  revocation: {
    enabled: true,           // Enable token revocation (default: true)
    storage: 'database',     // 'database' or 'memory' (default: 'database')
  },
  
  // Optional: Endpoints
  endpoints: {
    logout: '/auth/logout',   // Add logout endpoint
    session: '/auth/session'  // Add session check endpoint
  }
});
```

## How Auth Rules Work

**Important**: Auth rules must be defined in the same configuration object as your schema when calling `addResource`:

```javascript
await api.addResource('resource-name', {
  schema: { ... },        // Your field definitions
  relationships: { ... }, // Optional relationships
  auth: {                 // Permission rules go here!
    query: ['public'],
    get: ['public'],
    post: ['authenticated'],
    patch: ['is_owner', 'has_role:editor', 'admin'],
    delete: ['is_owner', 'has_role:moderator', 'admin']
  }
});
```

The JWT plugin will automatically extract these rules and enforce them on all operations.

### Common Permission Patterns

```javascript
// Public read, authenticated write
auth: {
  query: ['public'],
  get: ['public'],
  post: ['authenticated'],
  patch: ['authenticated'],
  delete: ['admin']
}

// Private resource with role-based access
auth: {
  query: ['authenticated'],
  get: ['authenticated'],
  post: ['has_role:author', 'has_role:editor'],
  patch: ['is_owner', 'has_role:editor'],
  delete: ['is_owner', 'has_role:moderator', 'admin']
}

// Admin-only resource
auth: {
  query: ['admin'],
  get: ['admin'],
  post: ['admin'],
  patch: ['admin'],
  delete: ['admin']
}

// User profiles (self-service)
auth: {
  query: ['admin'],                    // Only admins can list all users
  get: ['is_owner', 'admin'],         // Users can see their own profile
  post: ['admin'],                     // Only admins create users
  patch: ['is_owner', 'admin'],       // Users can edit their own profile
  delete: ['admin']                    // Only admins can delete users
}
```

## Declarative Permissions

Instead of writing permission checks in hooks, you declare permissions directly on your resources:

```javascript
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' },
    country_id: { type: 'number', belongsTo: 'countries', as: 'country' },
    published: { type: 'boolean', default: false }
  },
  
  // Declare permissions for each operation
  auth: {
    query: ['public'],                    // Anyone can list books
    get: ['public'],                      // Anyone can read a book
    post: ['authenticated'],              // Must be logged in to create
    patch: ['is_owner', 'has_role:editor', 'admin'], // Owner, editor, or admin
    delete: ['is_owner', 'admin']         // Only owner or admin
  }
});
```

The permission rules are checked automatically - no manual hook writing needed!

## Built-in Auth Checkers

The plugin includes these auth checkers out of the box:

### `public`
Anyone can access, no authentication required.

```javascript
auth: {
  query: ['public']  // Anyone can list resources
}
```

### `authenticated`
User must be logged in (have a valid token).

```javascript
auth: {
  post: ['authenticated']  // Must be logged in to create
}
```

### `is_owner`
User must own the resource (their ID matches the ownership field).

```javascript
auth: {
  patch: ['is_owner'],  // Only owner can update
  delete: ['is_owner']  // Only owner can delete
}

// The plugin checks: record.user_id === context.auth.userId
// The ownership field is configurable (default: 'user_id')
```

### `admin`
User must have the 'admin' role.

```javascript
auth: {
  delete: ['admin']  // Only admins can delete
}
```

### `has_role:X`
User must have a specific role.

```javascript
auth: {
  patch: ['has_role:editor'],        // Must be editor
  delete: ['has_role:moderator']     // Must be moderator
}
```

### `has_permission:X`
User must have a specific permission (for fine-grained control).

```javascript
auth: {
  patch: ['has_permission:posts:write'],
  delete: ['has_permission:posts:delete']
}
```

## Making Authenticated API Calls Directly

When using the API programmatically (not through HTTP), you can pass authentication context as the second parameter to any API method:

### Direct API Usage

```javascript
// Import your configured API
import { api } from './your-api-setup.js';

// Make authenticated calls by passing auth context as second parameter
const authContext = {
  auth: {
    userId: 'user-123',
    email: 'user@example.com',
    role: 'admin',
    // Any other auth data your app needs
  }
};

// Query with auth
const books = await api.resources.books.query({
  filters: { published: true },
  include: ['author'],
  page: { size: 10 }
}, authContext);

// Get single resource with auth
const book = await api.resources.books.get({
  id: 123
}, authContext);

// Create with auth
const newBook = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: 'My New Book',
        isbn: '978-3-16-148410-0'
      }
    }
  }
}, authContext);

// Update with auth
const updated = await api.resources.books.patch({
  id: 123,
  inputRecord: {
    data: {
      type: 'books',
      id: '123',
      attributes: {
        title: 'Updated Title'
      }
    }
  }
}, authContext);

// Delete with auth
await api.resources.books.delete({
  id: 123
}, authContext);
```

### Multi-tenancy Example

If using the MultiHome plugin for multi-tenancy:

```javascript
// Tenant-specific context
const tenantContext = {
  auth: {
    userId: 'user-123',
    multihome_id: 'tenant-a'  // Required for multihome
  }
};

// All operations will be scoped to tenant-a
const tenantProjects = await api.resources.projects.query({}, tenantContext);
```

### Script/Admin Usage

For administrative scripts or background jobs:

```javascript
// Admin context with elevated privileges
const adminContext = {
  auth: {
    userId: 'system',
    role: 'superadmin',
    isSystem: true
  }
};

// Batch operations
async function processAllBooks() {
  const books = await api.resources.books.query({
    page: { size: 100 }
  }, adminContext);
  
  for (const book of books.data) {
    // Process each book with admin privileges
    await api.resources.books.patch({
      id: book.id,
      inputRecord: { /* ... */ }
    }, adminContext);
  }
}
```

### Testing Example

In tests, you can easily simulate different users:

```javascript
// Test different permission scenarios
const contexts = {
  anonymous: {},  // No auth
  regular: { auth: { userId: 'user-1', role: 'member' } },
  editor: { auth: { userId: 'user-2', role: 'editor' } },
  admin: { auth: { userId: 'user-3', role: 'admin' } }
};

// Test that regular users can't delete
await assert.rejects(
  api.resources.books.delete({ id: 1 }, contexts.regular),
  /Forbidden/
);

// Test that editors can update
await api.resources.books.patch({
  id: 1,
  inputRecord: { /* ... */ }
}, contexts.editor);
```

## Using Auth Helpers

While declarative permissions handle most cases, you can also use auth helpers in custom hooks:

```javascript
// In any hook, you have access to helpers.auth
api.addHook('beforeCreate', async ({ context, inputRecord, helpers }) => {
  // Require authentication
  helpers.auth.requireAuth(context);
  
  // Require specific roles
  helpers.auth.requireRoles(context, ['editor', 'admin']);
  
  // Check ownership (multiple ways)
  helpers.auth.requireOwnership(context);              // Uses context.existingRecord
  helpers.auth.requireOwnership(context, record);      // Pass record
  helpers.auth.requireOwnership(context, '123');       // Pass user ID
  
  // Set owner on new records
  inputRecord.user_id = context.auth.userId;
});
```

## Token Management

### Context Population

When a valid JWT token is provided, the plugin populates `context.auth`:

```javascript
context.auth = {
  userId: '123',                    // From token 'sub' claim
  email: 'user@example.com',        // From token 'email' claim
  roles: ['user', 'editor'],        // From token 'roles' claim
  permissions: ['posts:write'],     // From token 'permissions' claim
  token: { /* full JWT payload */ },
  tokenId: 'jti-value'              // For revocation
}
```

### Token Revocation and Logout

The plugin supports token revocation for logout and security. Here's how it works:

#### Frontend Logout Flow
```javascript
// 1. Call your API's logout endpoint
await fetch('/api/auth/logout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// 2. Clear local storage
localStorage.removeItem('supabase.auth.token');

// 3. Sign out from Supabase (optional but recommended)
await supabase.auth.signOut();
```

#### API-Side Token Management
```javascript
// The plugin provides these methods:

// In your custom endpoints
await helpers.auth.logout(context);  // Revokes current token

// Revoke specific token (e.g., from webhook)
await helpers.auth.revokeToken(jti, userId, expiresAt);

// Check current session
GET /api/auth/session
// Returns: { authenticated: true/false, user: {...} }
```

#### Handling Auth Provider Webhooks

If your auth provider supports webhooks, you can sync logouts:

```javascript
// Handle Supabase auth events
api.addRoute('POST', '/webhooks/supabase-auth', async ({ body }) => {
  if (body.event === 'SIGNED_OUT') {
    // Revoke the token in your API too
    await helpers.auth.revokeToken(
      body.logout_token_id,
      body.user_id,
      body.token_exp
    );
  }
});
```

### Working with Different Auth Providers

The plugin works with any JWT provider. Here are the common configurations:

#### Supabase Configuration
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  rolesField: 'app_metadata.roles',     // Supabase stores custom data here
  
  // Add roles in Supabase Dashboard:
  // Authentication > Users > Select User > Edit User Metadata
  // Add to app_metadata: { "roles": ["admin", "editor"] }
});
```

#### Auth0 Configuration
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  audience: AUTH0_AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  rolesField: 'https://your-app.com/roles',  // Auth0 uses namespaced claims
  
  // Add roles in Auth0:
  // Create a Rule or Action that adds roles to the token
});
```

#### Firebase Auth Configuration
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
  audience: process.env.FIREBASE_PROJECT_ID,
  issuer: `https://securetoken.google.com/${process.env.FIREBASE_PROJECT_ID}`,
  rolesField: 'custom_claims.roles'
});
```

## Custom Auth Checkers

You can create domain-specific auth checkers:

```javascript
// Register a custom checker
helpers.auth.registerChecker('is_team_member', async (context, { existingRecord }) => {
  if (!context.auth?.userId) return false;
  
  // Check if user is part of the team
  const team = await api.resources.teams.get({ 
    id: existingRecord.team_id 
  });
  
  return team.member_ids.includes(context.auth.userId);
});

// Use in a resource
await api.addResource('team_documents', {
  schema: { /* ... */ },
  
  auth: {
    query: ['is_team_member'],
    get: ['is_team_member'],
    patch: ['is_team_member', 'admin']
  }
});
```

## Complete Example: Book Catalog API

Let's build a complete authenticated book catalog API:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, HttpPlugin } from 'json-rest-api';
import { JwtAuthPlugin } from 'json-rest-api/plugins/core/jwt-auth-plugin.js';

// 1. Create and configure API
const api = new Api();

await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// 2. Configure JWT Auth for Supabase
await api.use(JwtAuthPlugin, {
  jwksUrl: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  rolesField: 'app_metadata.roles',
  ownershipField: 'user_id'
});

// 3. Define authenticated resources
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    isbn: { type: 'string' },
    user_id: { type: 'string' },        // Owner
    country_id: { type: 'number', belongsTo: 'countries' },
    published: { type: 'boolean', default: false }
  },
  
  auth: {
    query: ['public'],                  // Anyone can browse
    get: ['public'],                    // Anyone can read
    post: ['authenticated'],            // Must be logged in
    patch: ['is_owner', 'has_role:librarian'], // Owner or librarian
    delete: ['is_owner', 'admin']       // Owner or admin
  }
});

// 4. Auto-set ownership on create
api.addHook('beforeCreate', async ({ context, inputRecord, scopeName }) => {
  if (scopeName === 'books' && context.auth) {
    inputRecord.user_id = context.auth.userId;
  }
});

// 5. Filter unpublished books for anonymous users
api.addHook('beforeQuery', async ({ context, queryParams, scopeName }) => {
  if (scopeName === 'books' && !context.auth) {
    queryParams.filter = { ...queryParams.filter, published: true };
  }
});

// 6. Start HTTP server
await api.use(HttpPlugin, { port: 3000, basePath: '/api' });

// Frontend usage:
// const { data: { session } } = await supabase.auth.signIn(...)
// const token = session.access_token
// 
// fetch('/api/books', {
//   headers: { 'Authorization': `Bearer ${token}` }
// })
```

## More Examples

### Public Blog with Private Drafts

```javascript
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' },
    published: { type: 'boolean', default: false }
  },
  
  auth: {
    query: ['public'],           // Anyone can list
    get: ['public'],             // Anyone can read
    post: ['authenticated'],     // Must be logged in to create
    patch: ['is_owner'],         // Only owner can edit
    delete: ['is_owner', 'admin'] // Owner or admin can delete
  }
});

// Add custom filtering for drafts
api.addHook('beforeQuery', async ({ context, queryParams }) => {
  // Non-owners only see published posts
  if (!context.auth || context.auth.userId !== queryParams.filter?.user_id) {
    queryParams.filter = { ...queryParams.filter, published: true };
  }
});
```

### Multi-Author Books

```javascript
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    publisher_id: { type: 'number', belongsTo: 'publishers' }
  },
  
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors' }
  },
  
  auth: {
    query: ['public'],
    get: ['public'],
    post: ['has_role:author', 'has_role:editor'],
    patch: ['is_book_author', 'has_role:editor'],
    delete: ['admin']
  }
});

// Custom checker for multi-author books
helpers.auth.registerChecker('is_book_author', async (context, { existingRecord }) => {
  if (!context.auth?.userId || !existingRecord) return false;
  
  const bookAuthors = await api.resources.book_authors.query({
    queryParams: {
      filter: {
        book_id: existingRecord.id,
        author_id: context.auth.userId
      }
    }
  });
  
  return bookAuthors.length > 0;
});
```

### Admin Panel

```javascript
await api.addResource('users', {
  schema: {
    id: { type: 'id' },
    email: { type: 'string', required: true },
    role: { type: 'string' },
    banned: { type: 'boolean', default: false }
  },
  
  auth: {
    query: ['admin', 'has_role:user_manager'],
    get: ['admin', 'has_role:user_manager', 'is_self'],
    post: ['admin'],
    patch: ['admin', 'has_role:user_manager', 'is_self'],
    delete: ['admin']
  }
});

// Users can view/edit their own profile
helpers.auth.registerChecker('is_self', (context, { existingRecord }) => {
  return context.auth?.userId === existingRecord?.id;
});
```

## Best Practices

### 1. Use Declarative Permissions

Instead of:
```javascript
// ❌ Manual permission checks in hooks
api.addHook('checkPermissions', async ({ context, operation }) => {
  if (operation === 'post' && !context.auth) {
    throw new Error('Must be authenticated');
  }
});
```

Do this:
```javascript
// ✅ Declarative permissions
auth: {
  post: ['authenticated']
}
```

### 2. Combine Rules with OR Logic

Multiple rules in an array work as OR conditions:
```javascript
auth: {
  patch: ['is_owner', 'has_role:moderator', 'admin']
  // Can update if: owner OR moderator OR admin
}
```

### 3. Set Ownership on Create

```javascript
api.addHook('beforeCreate', async ({ context, inputRecord, scopeName }) => {
  // Set owner for user-owned resources
  if (scopeName === 'posts' && context.auth) {
    inputRecord.user_id = context.auth.userId;
  }
});
```

### 4. Use Appropriate Checkers

- `public` - For truly public data
- `authenticated` - When you just need a logged-in user
- `is_owner` - For user-owned resources
- `has_role:X` - For role-based access
- `admin` - For administrative functions

### 5. Handle Unauthenticated Users Gracefully

```javascript
// Filter data for unauthenticated users instead of denying access
api.addHook('beforeQuery', async ({ context, queryParams, scopeName }) => {
  if (scopeName === 'posts' && !context.auth) {
    // Only show published posts to anonymous users
    queryParams.filter = { ...queryParams.filter, published: true };
  }
});
```

### 6. Create Semantic Custom Checkers

```javascript
// ✅ Good: Semantic name that explains the permission
helpers.auth.registerChecker('can_moderate_content', (context) => {
  return context.auth?.roles?.includes('moderator') || 
         context.auth?.roles?.includes('admin');
});

// ❌ Bad: Technical implementation detail
helpers.auth.registerChecker('has_mod_or_admin', (context) => {
  // Same logic but less clear intent
});
```

## Summary

The JWT Auth Plugin provides a clean, declarative way to handle authentication and authorization in your REST API. By defining permissions directly on resources, you eliminate boilerplate code and create a more maintainable, secure API.

Key benefits:
- **No manual hook writing** for common permission patterns
- **Clear, readable** permission declarations
- **Flexible** enough for complex scenarios
- **Secure by default** with deny-by-default behavior
- **Extensible** with custom checkers

Whether you're building a simple blog or a complex multi-tenant application, the declarative permission system scales with your needs while keeping your code clean and maintainable.