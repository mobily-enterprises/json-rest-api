// This example demonstrates TypeScript usage with full type safety
// It would be compiled to JavaScript for runtime execution

import { createClient, RestClient, retryInterceptor, loggingInterceptor } from '../client/index.js';
import { InferSchema, InferInsert, InferUpdate } from '../types/inference.js';
import { SchemaDefinition } from '../types/schema.types.js';

// Define schemas as const for better type inference
const UserSchema = {
  id: { type: 'id' as const },
  email: { type: 'string' as const, required: true as const },
  name: { type: 'string' as const, required: true as const },
  role: { type: 'string' as const, enum: ['user', 'admin'] as const },
  createdAt: { type: 'timestamp' as const }
} satisfies SchemaDefinition;

const PostSchema = {
  id: { type: 'id' as const },
  title: { type: 'string' as const, required: true as const },
  content: { type: 'string' as const, required: true as const },
  authorId: { type: 'id' as const, required: true as const },
  tags: { type: 'array' as const, items: { type: 'string' as const } },
  status: { type: 'string' as const, enum: ['draft', 'published'] as const },
  createdAt: { type: 'timestamp' as const }
} satisfies SchemaDefinition;

// Generate types from schemas
type User = InferSchema<typeof UserSchema>;
type UserInsert = InferInsert<typeof UserSchema>;
type UserUpdate = InferUpdate<typeof UserSchema>;

type Post = InferSchema<typeof PostSchema>;
type PostInsert = InferInsert<typeof PostSchema>;
type PostUpdate = InferUpdate<typeof PostSchema>;

// Define the resource map for the client
interface ApiResources {
  users: {
    get(id: string | number): Promise<User>;
    query(options?: any): Promise<{ data: User[]; meta: any }>;
    create(data: UserInsert): Promise<User>;
    update(id: string | number, data: UserUpdate): Promise<User>;
    delete(id: string | number): Promise<void>;
    count(filter?: any): Promise<number>;
  };
  posts: {
    get(id: string | number): Promise<Post>;
    query(options?: any): Promise<{ data: Post[]; meta: any }>;
    create(data: PostInsert): Promise<Post>;
    update(id: string | number, data: PostUpdate): Promise<Post>;
    delete(id: string | number): Promise<void>;
    count(filter?: any): Promise<number>;
  };
}

// Create typed client
const client = createClient<ApiResources>({
  baseURL: 'http://localhost:3000/api',
  timeout: 10000
});

// Add interceptors
client.addRequestInterceptor(async (config, url) => {
  console.log(`🔵 Request: ${config.method} ${url}`);
  return config;
});

client.addResponseInterceptor(async (result) => {
  console.log(`🟢 Response:`, result.response.status);
  return result;
});

client.addErrorInterceptor(retryInterceptor(3, 1000));

// Example usage with full type safety
async function example() {
  try {
    // Create user - TypeScript enforces required fields
    const newUser = await client.resources.users.create({
      email: 'john@example.com',
      name: 'John Doe',
      role: 'admin' // TypeScript ensures this is 'user' | 'admin'
    });
    console.log('Created user:', newUser);
    
    // TypeScript error: Property 'invalidField' does not exist
    // await client.resources.users.create({ invalidField: true });
    
    // TypeScript error: role must be 'user' | 'admin'
    // await client.resources.users.create({ email: 'test@test.com', name: 'Test', role: 'invalid' });
    
    // Update user - all fields optional
    const updatedUser = await client.resources.users.update(newUser.id, {
      name: 'John Updated'
    });
    console.log('Updated user:', updatedUser);
    
    // Create post with author relationship
    const newPost = await client.resources.posts.create({
      title: 'TypeScript Integration Guide',
      content: 'This guide shows how to use TypeScript...',
      authorId: newUser.id,
      tags: ['typescript', 'api', 'tutorial'],
      status: 'published'
    });
    console.log('Created post:', newPost);
    
    // Query with type-safe filters
    const posts = await client.resources.posts.query({
      filter: {
        status: 'published',
        authorId: newUser.id
      },
      include: ['author'],
      sort: '-createdAt',
      page: { size: 10, number: 1 }
    });
    
    console.log(`Found ${posts.meta.total} posts`);
    posts.data.forEach(post => {
      // TypeScript knows post is of type Post
      console.log(`- ${post.title} (${post.status})`);
    });
    
    // Count posts
    const postCount = await client.resources.posts.count({
      status: 'published'
    });
    console.log(`Total published posts: ${postCount}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Advanced example with custom types
interface PostWithAuthor extends Post {
  author: User;
}

async function fetchPostsWithAuthors(): Promise<PostWithAuthor[]> {
  const result = await client.resources.posts.query({
    include: ['author']
  });
  
  // Type assertion needed here as the client doesn't know about includes
  return result.data as PostWithAuthor[];
}

// Generic helper for batch operations
async function batchUpdate<T, U>(
  resource: {
    update(id: string | number, data: U): Promise<T>;
  },
  items: Array<{ id: string | number; data: U }>
): Promise<T[]> {
  const results: T[] = [];
  
  for (const item of items) {
    const updated = await resource.update(item.id, item.data);
    results.push(updated);
  }
  
  return results;
}

// Usage of generic helper
async function updateMultiplePosts() {
  const updates = [
    { id: 1, data: { status: 'archived' as const } },
    { id: 2, data: { status: 'archived' as const } },
    { id: 3, data: { status: 'archived' as const } }
  ];
  
  const results = await batchUpdate(client.resources.posts, updates);
  console.log(`Updated ${results.length} posts`);
}

// Custom error handling with typed errors
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

client.addErrorInterceptor(async (error) => {
  if (error.response && error.data?.errors?.[0]) {
    const apiError = error.data.errors[0];
    throw new ApiError(
      error.status,
      apiError.code || 'UNKNOWN',
      apiError.detail || error.message,
      apiError.meta
    );
  }
  throw error;
});

// Type-safe event handling
interface ClientEvents {
  'request:start': (method: string, url: string) => void;
  'request:success': (method: string, url: string, duration: number) => void;
  'request:error': (method: string, url: string, error: Error) => void;
}

// Extend client with typed events (would need to modify base client)
class TypedClient<T extends ApiResources> extends RestClient<T> {
  on<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): this {
    super.on(event, listener);
    return this;
  }
  
  emit<K extends keyof ClientEvents>(event: K, ...args: Parameters<ClientEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}

// Run example
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}