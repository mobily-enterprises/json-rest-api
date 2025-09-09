# Authentication and Permissions Guide

This guide shows you how to add authentication to your REST API using the JWT Authentication Plugin. The plugin validates JWT tokens from any auth provider (Supabase, Auth0, Firebase, etc.) and enforces permissions on your resources.

## Table of Contents
- [How It Works - The Architecture](#how-it-works---the-architecture)
- [Quick Start - Get Running in 5 Minutes](#quick-start---get-running-in-5-minutes)
- [Frontend: Getting Auth Tokens](#frontend-getting-auth-tokens)
  - [Supabase Setup](#supabase-setup)
  - [Auth0 Setup](#auth0-setup)
  - [Google OAuth Login](#google-oauth-login)
- [Backend: Validating Tokens](#backend-validating-tokens)
- [Using Built-in Checkers](#using-built-in-checkers)
- [Progressive Examples](#progressive-examples)
- [Advanced: Custom Authorization](#advanced-custom-authorization)
- [Token Management](#token-management)
- [Migration Guide](#migration-guide)

## How It Works - The Architecture

The JWT plugin is a **backend/server-side** tool that validates tokens. Here's the complete flow:

```
┌─────────────┐      ┌─────────────┐      ┌──────────────┐
│   Browser   │      │  Supabase/  │      │  Your API    │
│  (Frontend) │ ───> │    Auth0    │      │  (Backend)   │
└─────────────┘      └─────────────┘      └──────────────┘
      │                     │                      │
      │ 1. Login with       │                      │
      │    email/Google     │                      │
      │ ─────────────────>  │                      │
      │                     │                      │
      │ 2. Get JWT token    │                      │
      │ <─────────────────  │                      │
      │                     │                      │
      │ 3. API request with Bearer token           │
      │ ──────────────────────────────────────>    │
      │                                            │
      │                                   4. JWT Plugin validates
      │                                      token with Supabase
      │                                            │
      │ 5. Response (allowed or denied)            │
      │ <──────────────────────────────────────    │
```

**Key Points:**
- **Frontend**: Handles user login (email/password, Google, etc.) and gets JWT token
- **Auth Provider**: Issues and manages JWT tokens (Supabase, Auth0, etc.)
- **Backend (Your API)**: Uses JWT plugin to validate tokens and enforce permissions
- **JWT Plugin**: Does NOT handle login/signup - only validates existing tokens

## Quick Start - Get Running in 5 Minutes

### Step 1: Install the Plugin

```bash
npm install jose
```

### Step 2: Configure Your Backend API

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { JwtAuthPlugin } from 'json-rest-api/plugins/core/jwt-auth-plugin.js';

// Create your API
const api = new Api();
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Add JWT authentication (example with Supabase)
await api.use(JwtAuthPlugin, {
  jwksUrl: 'https://your-project.supabase.co/auth/v1/.well-known/jwks.json'
});

// Add a protected resource
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' }  // Automatically set to current user
  },
  
  // Simple auth rules using built-in checkers
  auth: {
    query: ['public'],         // Anyone can read posts
    post: ['authenticated'],   // Must be logged in to create
    patch: ['owns'],          // Can only edit your own posts
    delete: ['owns']          // Can only delete your own posts
  }
});
```

### Step 3: Test It

```javascript
// From your frontend (after user logs in)
const response = await fetch('http://localhost:3000/api/posts', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,  // Token from Supabase/Auth0
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    data: {
      type: 'posts',
      attributes: {
        title: 'My First Post',
        content: 'Hello world!'
      }
    }
  })
});
```

That's it! You now have authenticated API endpoints.

## Frontend: Getting Auth Tokens

The JWT plugin validates tokens from any provider. Here's how to get tokens from popular services:

### Supabase Setup

#### 1. Create a Supabase Project
Go to [supabase.com](https://supabase.com) and create a new project. You'll get:
- Project URL: `https://your-project.supabase.co`
- Anon Key: `eyJhbGc...` (public key for frontend)

#### 2. Frontend: Email/Password Login

```javascript
// In your React/Vue/etc app
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)

// Sign up new user
async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  })
  if (error) throw error
  return data.session.access_token  // This is your JWT!
}

// Sign in existing user
async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  if (error) throw error
  return data.session.access_token  // This is your JWT!
}

// Use the token for API calls
async function createPost(token, title, content) {
  const response = await fetch('http://localhost:3000/api/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: {
        type: 'posts',
        attributes: { title, content }
      }
    })
  })
  return response.json()
}
```

#### 3. Backend Configuration

```javascript
// Your API server
await api.use(JwtAuthPlugin, {
  jwksUrl: 'https://your-project.supabase.co/auth/v1/.well-known/jwks.json'
})
```

### Auth0 Setup

#### 1. Create an Auth0 Application
Go to [auth0.com](https://auth0.com) and create a new Single Page Application.

#### 2. Frontend: Auth0 Login

```javascript
// In your React/Vue/etc app
import { createAuth0Client } from '@auth0/auth0-spa-js'

const auth0 = await createAuth0Client({
  domain: 'your-domain.auth0.com',
  clientId: 'your-client-id',
  authorizationParams: {
    redirect_uri: window.location.origin,
    audience: 'https://your-api.com'  // Your API identifier
  }
})

// Login
async function login() {
  await auth0.loginWithRedirect()
}

// After redirect, get token
async function getToken() {
  const token = await auth0.getAccessTokenSilently()
  return token  // Your JWT!
}
```

#### 3. Backend Configuration

```javascript
// Your API server
await api.use(JwtAuthPlugin, {
  jwksUrl: 'https://your-domain.auth0.com/.well-known/jwks.json',
  audience: 'https://your-api.com',
  issuer: 'https://your-domain.auth0.com/'
})
```

### Google OAuth Login

Google login works through your auth provider (Supabase/Auth0), not directly. The user logs in with Google, but you still get a JWT from Supabase/Auth0.

#### Supabase + Google

##### 1. Enable Google in Supabase Dashboard
- Go to Authentication → Providers → Google
- Add your Google Client ID and Secret (from Google Cloud Console)

##### 2. Frontend: Google Login Button

```javascript
// React component example
function GoogleLoginButton() {
  const handleGoogleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:3000/auth/callback'
      }
    })
    if (error) throw error
    // User will be redirected to Google, then back to your app
  }
  
  return (
    <button onClick={handleGoogleLogin}>
      Sign in with Google
    </button>
  )
}

// After redirect, get the session
useEffect(() => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      const token = session.access_token  // JWT from Supabase!
      // Use this token for API calls
    }
  })
}, [])
```

##### 3. Backend: Same Configuration!

```javascript
// No change needed - same as email/password
await api.use(JwtAuthPlugin, {
  jwksUrl: 'https://your-project.supabase.co/auth/v1/.well-known/jwks.json'
})
```

The beauty is that your backend doesn't care HOW users logged in (email, Google, Facebook) - it just validates the JWT from Supabase.

## Backend: Validating Tokens

### Basic Configuration Options

```javascript
await api.use(JwtAuthPlugin, {
  // Option 1: For external auth providers (Supabase, Auth0)
  jwksUrl: 'https://.../.well-known/jwks.json',
  
  // Option 2: For symmetric key (your own auth)
  secret: process.env.JWT_SECRET,
  
  // Option 3: For asymmetric key (your own auth)
  publicKey: '-----BEGIN PUBLIC KEY-----...',
  
  // Optional settings
  audience: 'your-api-audience',  // Required for Auth0
  issuer: 'https://issuer.com',   // Validate token issuer
  userIdField: 'sub',              // Where to find user ID (default: 'sub')
  emailField: 'email',            // Where to find email (default: 'email')
  ownershipField: 'user_id'       // Field for ownership checks (default: 'user_id')
})
```

### Understanding JWKS Configuration (Recommended)

When you use `jwksUrl` (the recommended approach for Supabase/Auth0), here's what actually happens behind the scenes:

#### What is JWKS?
JWKS (JSON Web Key Set) is a URL that provides public keys for verifying JWT signatures. Instead of hardcoding keys, your API fetches them dynamically.

#### The Automatic Process
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: 'https://your-project.supabase.co/auth/v1/.well-known/jwks.json'
});
```

This single line sets up:

1. **Automatic Key Fetching**: On first request, downloads Supabase's current public keys
2. **Smart Caching**: Caches keys for 10 minutes to avoid repeated downloads
3. **Key Rotation Handling**: When Supabase rotates keys, your API automatically gets the new ones
4. **Multiple Key Support**: Handles multiple keys during rotation periods

#### What the JWKS URL Returns
```json
{
  "keys": [
    {
      "kid": "abc123",    // Key ID - matches 'kid' in JWT header
      "kty": "RSA",       // Key type
      "use": "sig",       // Usage: signature verification
      "n": "xGOr-H7A...", // RSA public key modulus
      "e": "AQAB"         // RSA public key exponent
    },
    {
      "kid": "def456",    // Another key (during rotation)
      "n": "yKPq-J8B...",
      "e": "AQAB"
    }
  ]
}
```

#### Performance Impact
- **First request**: ~50-100ms (downloads keys from Supabase)
- **Next 10 minutes**: ~1-2ms (uses cached keys)
- **After cache expires**: Re-downloads automatically
- **On verification failure**: Attempts to refresh keys

#### Why This is Superior to Hardcoded Keys
- **Zero Maintenance**: Keys update automatically when provider rotates them
- **Always Secure**: You never handle or store private keys
- **No Downtime**: Key rotation happens seamlessly
- **No Code Changes**: Provider can change keys without you knowing

### What Happens During Validation

1. **Token Extraction**: Plugin extracts token from `Authorization: Bearer <token>` header
2. **Key Selection**: Matches token's `kid` (key ID) with cached JWKS keys
3. **Signature Verification**: Validates JWT signature using the matching public key
4. **Claims Validation**: Checks audience, issuer, expiration
5. **Context Population**: Sets `context.auth`:
   ```javascript
   context.auth = {
     userId: '123',              // From 'sub' claim
     email: 'user@example.com',  // From 'email' claim
     token: { /* full JWT */ },  // All token data
     tokenId: 'jti-123'          // For revocation
   }
   ```

## Using Built-in Checkers

The plugin provides only THREE built-in authorization checkers:

### 1. `public` - No Authentication Required

```javascript
auth: {
  query: ['public'],  // Anyone can read, even without token
  get: ['public']
}
```

### 2. `authenticated` - Must Be Logged In

```javascript
auth: {
  post: ['authenticated'],   // Must have valid JWT token
  patch: ['authenticated']
}
```

### 3. `owns` - Must Own the Resource

```javascript
auth: {
  patch: ['owns'],  // Can only edit records where user_id matches
  delete: ['owns']  // Can only delete your own records
}
```

The `owns` checker compares the `user_id` field in the database record with the current user's ID from the token.

## Progressive Examples

Let's build up from simple to complex:

### Example 1: Public API (No Auth)

```javascript
await api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'text' }
  }
  // No auth property = completely open
})
```

### Example 2: Read-Only Public, Write Requires Login

```javascript
await api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' }
  },
  
  auth: {
    query: ['public'],         // Anyone can read
    get: ['public'],
    post: ['authenticated'],   // Must be logged in to create
    patch: ['authenticated'],
    delete: ['authenticated']
  }
})
```

### Example 3: Users Can Only Edit Their Own Content

```javascript
await api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' }  // Auto-set on create
  },
  
  auth: {
    query: ['public'],
    get: ['public'],
    post: ['authenticated'],
    patch: ['owns'],  // Only edit your own
    delete: ['owns']  // Only delete your own
  }
})

// Also enable auto-ownership
await api.use(JwtAuthPlugin, {
  jwksUrl: '...',
  autoOwnership: {
    enabled: true,  // Auto-set user_id on create
    filterByOwner: true  // Users only see their own records in queries
  }
})
```

### Example 4: Adding Admin Override (Custom Checker)

```javascript
// Register a custom role checker
api.helpers.auth.registerChecker('role', async (context, { param }) => {
  // In real app, query your users table
  const user = await api.resources.users.get(context.auth.userId)
  return user.role === param
})

await api.addResource('articles', {
  schema: { /* ... */ },
  
  auth: {
    query: ['public'],
    get: ['public'],
    post: ['authenticated'],
    patch: ['owns', 'role:admin'],  // Owner OR admin
    delete: ['owns', 'role:admin']   // Owner OR admin
  }
})
```

## Advanced: Custom Authorization

The plugin is designed to be minimal. For complex authorization, you create custom checkers:

### Database-Driven Roles

```javascript
// Store roles in your database
await api.addResource('user_roles', {
  schema: {
    user_id: { type: 'string', required: true },
    role: { type: 'string', required: true }
  }
})

// Create role checker
api.helpers.auth.registerChecker('role', async (context, { param }) => {
  const roles = await api.resources.user_roles.query({
    filter: { user_id: context.auth.userId }
  })
  return roles.some(r => r.role === param)
})

// Use it
auth: {
  delete: ['role:admin']  // Must have admin role in database
}
```

### Subscription Tiers

```javascript
api.helpers.auth.registerChecker('plan', async (context, { param }) => {
  const user = await api.resources.users.get(context.auth.userId)
  const plans = ['free', 'basic', 'pro', 'enterprise']
  const requiredLevel = plans.indexOf(param)
  const userLevel = plans.indexOf(user.subscription_plan)
  return userLevel >= requiredLevel
})

// Premium features
auth: {
  post: ['plan:pro']  // Need pro plan or higher
}
```

### Team Membership

```javascript
api.helpers.auth.registerChecker('team', async (context, { param }) => {
  const membership = await api.resources.team_members.query({
    filter: { 
      user_id: context.auth.userId,
      team_id: param
    }
  })
  return membership.length > 0
})

// Team resources
auth: {
  query: ['team:engineering']  // Must be on engineering team
}
```

### Multi-Tenant Permissions

```javascript
api.helpers.auth.registerChecker('tenant_role', async (context, { param }) => {
  const tenantId = context.request.headers['x-tenant-id']
  const membership = await api.resources.tenant_members.query({
    filter: { 
      tenant_id: tenantId,
      user_id: context.auth.userId
    }
  })
  return membership[0]?.role === param
})

// Tenant-specific permissions
auth: {
  delete: ['tenant_role:admin']  // Admin in current tenant
}
```

## Token Management

### Accessing Token Data

```javascript
// After validation, you have access to:
context.auth = {
  userId: '123',                    // From 'sub' claim
  email: 'user@example.com',        // From 'email' claim
  token: {                          // Full JWT payload
    sub: '123',
    email: 'user@example.com',
    iat: 1234567890,
    exp: 1234567890,
    // Any custom claims from your auth provider
    app_metadata: { /* ... */ },
    user_metadata: { /* ... */ }
  },
  tokenId: 'jti-123'               // For revocation
}
```

### Token Revocation / Logout

```javascript
// Enable revocation
await api.use(JwtAuthPlugin, {
  jwksUrl: '...',
  revocation: {
    enabled: true,
    storage: 'database'  // Survives restarts
  },
  endpoints: {
    logout: '/auth/logout'  // Add logout endpoint
  }
})

// Frontend logout
async function logout(token) {
  // 1. Revoke token on your API
  await fetch('http://localhost:3000/auth/logout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  
  // 2. Clear Supabase session
  await supabase.auth.signOut()
}
```

### Direct API Usage (No HTTP)

For testing or server-side operations:

```javascript
// Create auth context manually
const authContext = {
  auth: {
    userId: 'user-123',
    email: 'user@example.com'
  }
}

// Use API methods directly
const posts = await api.resources.posts.query({
  filter: { published: true }
}, authContext)  // Pass context as second parameter

const newPost = await api.resources.posts.post({
  inputRecord: { /* ... */ }
}, authContext)
```

## Common Issues and Solutions

### Issue: "Access denied" on all requests
**Solution**: Check that your token is being sent correctly:
```javascript
// Correct
headers: { 'Authorization': `Bearer ${token}` }

// Wrong
headers: { 'Authorization': token }  // Missing "Bearer "
```

### Issue: Token validation fails
**Solution**: Ensure your JWKS URL matches your auth provider:
```javascript
// Supabase: Check your project URL
jwksUrl: 'https://YOUR-PROJECT.supabase.co/auth/v1/.well-known/jwks.json'

// Auth0: Check your domain
jwksUrl: 'https://YOUR-DOMAIN.auth0.com/.well-known/jwks.json'
```

### Issue: Google login token not working
**Solution**: Remember that Google login still goes through your auth provider:
- User logs in with Google → Supabase/Auth0 → Get Supabase/Auth0 JWT
- Your API validates the Supabase/Auth0 JWT, not Google's token

### Issue: Ownership not working
**Solution**: Ensure your schema has a `user_id` field:
```javascript
schema: {
  user_id: { type: 'string' }  // Required for 'owns' checker
}
```

## Summary

The JWT Authentication Plugin provides:
1. **Token validation** from any JWT provider (Supabase, Auth0, etc.)
2. **Three built-in checkers**: `public`, `authenticated`, `owns`
3. **Framework for custom authorization** via `checker:parameter` pattern

Remember:
- **Frontend**: Handles login (email, Google, etc.) and gets JWT
- **Backend**: Validates JWT and enforces permissions
- **Start simple**: Use built-in checkers, add custom logic as needed