# TypeScript Support

TypeScript brings compile-time type safety, better IDE support, and self-documenting code to your JSON REST API projects. This guide shows you how to leverage TypeScript for building robust, type-safe APIs.

## Table of Contents
- [Why TypeScript](#why-typescript)
- [Getting Started](#getting-started)
- [Type Inference from Schemas](#type-inference-from-schemas)
- [Type-Safe Resources](#type-safe-resources)
- [Client SDK](#client-sdk)
- [Migration Guide](#migration-guide)
- [Advanced Patterns](#advanced-patterns)

## Why TypeScript

### Benefits for API Development

1. **Compile-Time Type Checking**
   - Catch errors before runtime
   - Ensure data consistency
   - Validate API contracts

2. **Enhanced IDE Support**
   - Auto-completion for all API methods
   - Inline documentation
   - Refactoring tools

3. **Self-Documenting Code**
   - Types serve as documentation
   - Clear API contracts
   - Easier onboarding

4. **Better Maintainability**
   - Catch breaking changes early
   - Confident refactoring
   - Type-safe migrations

## Getting Started

### Installation

```bash
npm install --save-dev typescript @types/node @types/express tsx rimraf
```

### TypeScript Configuration

Create a `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowJs": true,
    "checkJs": false,
    "resolveJsonModule": true
  },
  "include": ["lib/**/*", "plugins/**/*", "types/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### Project Structure

```
your-api/
├── src/
│   ├── schemas/       # Schema definitions
│   ├── resources/     # Resource controllers
│   ├── plugins/       # Custom plugins
│   └── index.ts       # Main entry point
├── types/             # Type definitions
│   └── index.d.ts     # Generated types
├── tsconfig.json
└── package.json
```

## Type Inference from Schemas

### Basic Type Definitions

The library includes TypeScript types that match your schema definitions:

```typescript
import { Schema, SchemaDefinition } from 'json-rest-api';

// Define schema with proper typing
const UserSchema = {
  id: { type: 'id' as const },
  email: { 
    type: 'string' as const, 
    required: true as const,
    format: /^[\w\.-]+@[\w\.-]+\.\w+$/
  },
  name: { type: 'string' as const, required: true as const },
  role: { 
    type: 'string' as const,
    enum: ['user', 'admin', 'moderator'] as const,
    defaultValue: 'user'
  },
  createdAt: { type: 'timestamp' as const }
} satisfies SchemaDefinition;

// Create schema instance
const userSchema = new Schema(UserSchema);
```

### Automatic Type Inference

Use the provided type utilities to infer TypeScript types from your schemas:

```typescript
import { InferSchema, InferInsert, InferUpdate } from 'json-rest-api/types';

// Infer the full type
type User = InferSchema<typeof UserSchema>;
// Result: { id: string | number; email: string; name: string; role: 'user' | 'admin' | 'moderator'; createdAt: Date }

// Infer insert type (required fields mandatory)
type UserInsert = InferInsert<typeof UserSchema>;
// Result: { email: string; name: string; role?: 'user' | 'admin' | 'moderator' }

// Infer update type (all fields optional)
type UserUpdate = InferUpdate<typeof UserSchema>;
// Result: { email?: string; name?: string; role?: 'user' | 'admin' | 'moderator' }
```

### Complex Types

```typescript
const PostSchema = {
  id: { type: 'id' as const },
  title: { type: 'string' as const, required: true as const },
  content: { type: 'string' as const, required: true as const },
  tags: { 
    type: 'array' as const,
    items: { type: 'string' as const }
  },
  metadata: { type: 'object' as const },
  authorId: {
    type: 'id' as const,
    required: true as const,
    refs: {
      resource: 'users',
      join: { eager: true }
    }
  }
} satisfies SchemaDefinition;

type Post = InferSchema<typeof PostSchema>;
// Result: { id: string | number; title: string; content: string; tags: string[]; metadata: Record<string, any>; authorId: string | number }
```

## Type-Safe Resources

### Typed API Instance

```typescript
import { Api, HookContext } from 'json-rest-api';
import { MySQLPlugin } from 'json-rest-api/plugins/mysql';

// Create typed API
const api = new Api({
  debug: true,
  pageSize: 20
});

// Add plugins
api.use(MySQLPlugin, { 
  host: 'localhost',
  database: 'myapp' 
});

// Add resources with type safety
const users = api.addResource('users', userSchema);
const posts = api.addResource('posts', postSchema);

// Type-safe hooks
api.hook<User>('beforeInsert', async (context: HookContext<UserInsert>) => {
  // context.data is typed as UserInsert
  context.data.email = context.data.email.toLowerCase();
});

api.hook<Post>('afterQuery', async (context: HookContext<Post>) => {
  // context.result.data is typed as Post[]
  for (const post of context.result.data) {
    post.readTime = Math.ceil(post.content.split(' ').length / 200);
  }
});
```

### Resource Proxy Types

```typescript
// The resource proxy is fully typed
const user = await api.resources.users.create({
  email: 'john@example.com',
  name: 'John Doe'
  // TypeScript error if missing required fields
});

// Update with type checking
await api.resources.users.update(user.id, {
  role: 'admin' // TypeScript ensures valid enum value
});

// Query with typed results
const posts = await api.resources.posts.query({
  filter: { authorId: user.id },
  sort: '-createdAt'
});

posts.data.forEach(post => {
  console.log(post.title); // TypeScript knows post structure
});
```

## Client SDK

### Type-Safe Client

The library includes a type-safe client for consuming your API:

```typescript
import { createClient } from 'json-rest-api/client';

// Define your API types
interface ApiResources {
  users: {
    get(id: string | number): Promise<User>;
    query(options?: QueryOptions): Promise<QueryResult<User>>;
    create(data: UserInsert): Promise<User>;
    update(id: string | number, data: UserUpdate): Promise<User>;
    delete(id: string | number): Promise<void>;
  };
  posts: {
    get(id: string | number): Promise<Post>;
    query(options?: QueryOptions): Promise<QueryResult<Post>>;
    create(data: PostInsert): Promise<Post>;
    update(id: string | number, data: PostUpdate): Promise<Post>;
    delete(id: string | number): Promise<void>;
  };
}

// Create typed client
const client = createClient<ApiResources>({
  baseURL: 'https://api.example.com'
});

// Use with full type safety
const user = await client.resources.users.create({
  email: 'test@example.com',
  name: 'Test User'
});

const posts = await client.resources.posts.query({
  filter: { authorId: user.id }
});
```

### Client Interceptors

```typescript
import { retryInterceptor, loggingInterceptor } from 'json-rest-api/client';

// Add typed interceptors
client.addErrorInterceptor(retryInterceptor(3, 1000));

client.addRequestInterceptor(async (config, url) => {
  console.log(`Request: ${config.method} ${url}`);
  return config;
});

// Auth token management
client.setAuthToken('your-jwt-token');
```

## Migration Guide

### Step 1: Install Dependencies

```bash
npm install -D typescript @types/node tsx rimraf
```

### Step 2: Add TypeScript Config

Create `tsconfig.json` with the configuration shown above.

### Step 3: Convert Files Gradually

Start with type definitions:

```typescript
// types/schemas.ts
export const UserSchema = {
  // ... your schema
} satisfies SchemaDefinition;

export type User = InferSchema<typeof UserSchema>;
export type UserInsert = InferInsert<typeof UserSchema>;
export type UserUpdate = InferUpdate<typeof UserSchema>;
```

### Step 4: Update Imports

```typescript
// Before (JavaScript)
import { Api } from 'json-rest-api';

// After (TypeScript)
import { Api, Schema, type HookContext } from 'json-rest-api';
import type { User, UserInsert } from './types/schemas';
```

### Step 5: Add Type Annotations

```typescript
// Add types to functions
async function createUser(data: UserInsert): Promise<User> {
  return await api.resources.users.create(data);
}

// Type hook contexts
api.hook('beforeInsert', async (context: HookContext<UserInsert>) => {
  // Type-safe context usage
});
```

## Advanced Patterns

### Decorator Support

Use decorators for cleaner, NestJS-style code:

```typescript
import { Resource, BeforeInsert, AfterQuery, Validate } from 'json-rest-api/decorators';

@Resource('users', UserSchema)
export class UserResource {
  @BeforeInsert()
  async hashPassword(context: HookContext<UserInsert>) {
    if (context.data.password) {
      context.data.password = await bcrypt.hash(context.data.password, 10);
    }
  }

  @Validate('email')
  async validateUniqueEmail(email: string) {
    const existing = await this.api.resources.users.query({
      filter: { email }
    });
    if (existing.data.length > 0) {
      throw new Error('Email already exists');
    }
  }

  @AfterQuery()
  async enrichUsers(context: HookContext<User>) {
    // Add computed fields
    for (const user of context.result.data) {
      user.displayName = `${user.name} (${user.role})`;
    }
  }
}
```

### Generic Resource Controllers

Create reusable, type-safe controllers:

```typescript
abstract class BaseResourceController<T, TInsert, TUpdate> {
  constructor(
    protected api: Api,
    protected resourceName: string
  ) {}

  async findById(id: string | number): Promise<T> {
    return this.api.resources[this.resourceName].get(id);
  }

  async findAll(filter?: Record<string, any>): Promise<T[]> {
    const result = await this.api.resources[this.resourceName].query({ filter });
    return result.data;
  }

  async create(data: TInsert): Promise<T> {
    return this.api.resources[this.resourceName].create(data);
  }

  async update(id: string | number, data: TUpdate): Promise<T> {
    return this.api.resources[this.resourceName].update(id, data);
  }

  async delete(id: string | number): Promise<void> {
    return this.api.resources[this.resourceName].delete(id);
  }
}

// Concrete implementation
class UserController extends BaseResourceController<User, UserInsert, UserUpdate> {
  constructor(api: Api) {
    super(api, 'users');
  }

  async findByEmail(email: string): Promise<User | null> {
    const users = await this.findAll({ email });
    return users[0] || null;
  }
}
```

### Type-Safe Query Builder

```typescript
import { QueryBuilder } from 'json-rest-api';

// Create typed query builder
const qb = new QueryBuilder<User>('users')
  .select(['id', 'name', 'email'])
  .where('role', '=', 'admin')
  .where('createdAt', '>=', new Date('2024-01-01'))
  .orderBy('name', 'ASC')
  .limit(10);

const sql = qb.build();
// TypeScript ensures fields exist on User type
```

### Shared Type Packages

Create a shared types package for microservices:

```typescript
// @mycompany/api-types/index.ts
export * from './schemas';
export * from './models';
export * from './client';

// Use in services
import { User, UserInsert, ApiClient } from '@mycompany/api-types';

const client = new ApiClient({
  baseURL: process.env.USER_SERVICE_URL
});

const user = await client.users.create({
  email: 'test@example.com',
  name: 'Test User'
});
```

## Best Practices

1. **Use `satisfies` for Schema Definitions**
   ```typescript
   const schema = { /* ... */ } satisfies SchemaDefinition;
   ```

2. **Export Types Alongside Schemas**
   ```typescript
   export const UserSchema = { /* ... */ };
   export type User = InferSchema<typeof UserSchema>;
   ```

3. **Type Your Hooks**
   ```typescript
   api.hook<User>('beforeInsert', async (context: HookContext<UserInsert>) => {
     // Type-safe context
   });
   ```

4. **Use Strict Mode**
   ```json
   {
     "compilerOptions": {
       "strict": true
     }
   }
   ```

5. **Generate Types from Running API**
   ```typescript
   // scripts/generate-types.ts
   const types = generateTypesFromApi(api);
   writeFileSync('./types/generated.d.ts', types);
   ```

## Summary

TypeScript support in json-rest-api provides:

- **Automatic type inference** from schema definitions
- **Type-safe resource operations** with compile-time checking
- **Typed client SDK** for API consumption
- **Decorator support** for clean, maintainable code
- **Generic patterns** for reusable components

By adopting TypeScript, you get better IDE support, catch errors earlier, and create more maintainable APIs. The gradual migration path means you can adopt TypeScript incrementally without rewriting your entire codebase.