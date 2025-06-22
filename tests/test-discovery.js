import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin, HTTPPlugin } from '../index.js';
import { DiscoveryPlugin } from '../plugins/discovery/index.js';
import express from 'express';
import request from 'supertest';

// Test schemas with permissions
const userSchema = new Schema({
  name: { 
    type: 'string', 
    required: true,
    description: 'User name'
  },
  email: { 
    type: 'string', 
    required: true,
    unique: true,
    description: 'Email address'
  },
  role: {
    type: 'string',
    enum: ['admin', 'user'],
    default: 'user'
  },
  // Admin-only field
  internalNotes: {
    type: 'string',
    permissions: {
      read: 'admin',
      write: 'admin'
    }
  },
  // Field that's never exposed
  password: {
    type: 'string',
    silent: true
  }
});

const postSchema = new Schema({
  title: {
    type: 'string',
    required: true,
    searchable: true
  },
  content: {
    type: 'string',
    required: true
  },
  authorId: {
    type: 'id',
    required: true,
    refs: { 
      resource: 'users',
      join: { eager: true },
      provideUrl: true
    }
  },
  tags: {
    type: 'array',
    items: { type: 'string' }
  },
  // Admin-only can see draft status
  isDraft: {
    type: 'boolean',
    default: true,
    permissions: {
      read: 'admin'
    }
  },
  // Virtual to-many relationship
  comments: {
    type: 'list',
    virtual: true,
    foreignResource: 'comments',
    foreignKey: 'postId',
    permissions: {
      include: true // Anyone can include
    }
  }
});

const commentSchema = new Schema({
  content: {
    type: 'string',
    required: true
  },
  postId: {
    type: 'id',
    required: true,
    refs: { resource: 'posts' },
    searchable: true
  },
  authorId: {
    type: 'id',
    required: true,
    refs: { resource: 'users' }
  }
});

describe('Discovery Plugin', () => {

it('should extract schema with permission awareness', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(DiscoveryPlugin);
  
  api.addResource('users', userSchema);
  api.addResource('posts', postSchema);
  api.addResource('comments', commentSchema);
  
  // Test as anonymous user
  const anonDiscovery = await api.discovery.openapi(null);
  
  // Check that admin fields are not exposed
  const userProperties = anonDiscovery.components.schemas.UsersAttributes.properties;
  assert.ok(userProperties.name, 'Public fields are included');
  assert.ok(userProperties.email, 'Public fields are included');
  assert.ok(!userProperties.internalNotes, 'Admin-only fields are excluded');
  assert.ok(!userProperties.password, 'Silent fields are never exposed');
  
  const postProperties = anonDiscovery.components.schemas.PostsAttributes.properties;
  assert.ok(postProperties.title, 'Public post fields included');
  assert.ok(!postProperties.isDraft, 'Admin-only post fields excluded');
  
  // Test as admin user
  const adminUser = { role: 'admin', roles: ['admin'] };
  const adminDiscovery = await api.discovery.openapi(adminUser);
  
  const adminUserProperties = adminDiscovery.components.schemas.UsersAttributes.properties;
  assert.ok(adminUserProperties.internalNotes, 'Admin can see admin-only fields');
  assert.ok(!adminUserProperties.password, 'Silent fields still excluded for admin');
  
  const adminPostProperties = adminDiscovery.components.schemas.PostsAttributes.properties;
  assert.ok(adminPostProperties.isDraft, 'Admin can see draft status');
});

it('should generate valid OpenAPI specification', async () => {
  const api = new Api({
    name: 'Test API',
    version: '1.0.0'
  });
  
  api.use(MemoryPlugin);
  api.use(DiscoveryPlugin, {
    info: {
      description: 'Test API Description',
      contact: { email: 'test@example.com' }
    }
  });
  
  api.addResource('users', userSchema);
  api.addResource('posts', postSchema);
  
  const spec = await api.discovery.openapi();
  
  // Validate OpenAPI structure
  assert.equal(spec.openapi, '3.0.3', 'OpenAPI version is correct');
  assert.equal(spec.info.title, 'Test API', 'API title is set');
  assert.equal(spec.info.version, '1.0.0', 'API version is set');
  assert.equal(spec.info.description, 'Test API Description', 'Description is set');
  
  // Check paths
  assert.ok(spec.paths['/users'], 'Users collection path exists');
  assert.ok(spec.paths['/users/{id}'], 'Users item path exists');
  assert.ok(spec.paths['/posts'], 'Posts collection path exists');
  assert.ok(spec.paths['/posts/{id}'], 'Posts item path exists');
  
  // Check operations
  assert.ok(spec.paths['/users'].get, 'GET users exists');
  assert.ok(spec.paths['/users'].post, 'POST users exists');
  assert.ok(spec.paths['/users/{id}'].get, 'GET user by id exists');
  assert.ok(spec.paths['/users/{id}'].patch, 'PATCH user exists');
  assert.ok(spec.paths['/users/{id}'].delete, 'DELETE user exists');
  
  // Bulk operations would only exist if BatchOperationsPlugin is loaded
  // Skip this check since we're not loading that plugin in this test
  
  // Check relationship endpoints
  assert.ok(spec.paths['/posts/{id}/relationships/authorId'], 'Relationship endpoint exists');
  assert.ok(spec.paths['/posts/{id}/authorId'], 'Related resource endpoint exists');
  
  // Check schemas
  assert.ok(spec.components.schemas.UsersResource, 'User resource schema exists');
  assert.ok(spec.components.schemas.UsersAttributes, 'User attributes schema exists');
  assert.ok(spec.components.schemas.UsersCreateRequest, 'User create request schema exists');
  
  // Validate query parameters
  const listUsersParams = spec.paths['/users'].get.parameters;
  const sortParam = listUsersParams.find(p => p.name === 'sort');
  assert.ok(sortParam, 'Sort parameter exists');
  
  const pageParams = listUsersParams.filter(p => p.name.startsWith('page['));
  assert.equal(pageParams.length, 2, 'Pagination parameters exist');
});

it('should generate valid JSON Schema', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(DiscoveryPlugin);
  
  api.addResource('users', userSchema);
  api.addResource('posts', postSchema);
  
  const schema = await api.discovery.jsonschema();
  
  // Validate JSON Schema structure
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', 'JSON Schema version');
  assert.ok(schema.definitions, 'Has definitions');
  assert.ok(schema.definitions.users, 'Users definition exists');
  assert.ok(schema.definitions.posts, 'Posts definition exists');
  
  // Check user schema
  const userDef = schema.definitions.users;
  assert.equal(userDef.type, 'object', 'User is object type');
  assert.ok(userDef.properties.name, 'Has name property');
  assert.ok(userDef.properties.email, 'Has email property');
  assert.ok(userDef.required.includes('name'), 'Name is required');
  assert.ok(userDef.required.includes('email'), 'Email is required');
  
  // Posts would have relationships, not users in our test schema
  const postDef = schema.definitions.posts;
  assert.ok(postDef.relationships, 'Posts have relationships section');
  
  // Test individual resource schema
  const userResourceSchema = await api.discovery.resourceSchema('users');
  assert.ok(userResourceSchema.$id, 'Individual schema has $id');
  assert.ok(userResourceSchema.properties, 'Individual schema has properties');
});

it('should expose HTTP discovery endpoints', async () => {
  const app = express();
  const api = new Api();
  
  api.use(MemoryPlugin);
  api.use(DiscoveryPlugin, {
    swaggerUI: { tryItOut: true }
  });
  api.use(HTTPPlugin, { app });
  
  // Ensure discovery routes are installed after HTTPPlugin
  if (api._installDiscoveryRoutes) {
    api._installDiscoveryRoutes();
  }
  
  api.addResource('users', userSchema);
  api.addResource('posts', postSchema);
  
  // Test discovery index
  let res = await request(app)
    .get('/api/discovery')
    .expect(200);
  
  assert.ok(res.body.meta.formats.openapi, 'OpenAPI format links present');
  assert.ok(res.body.meta.formats.jsonschema, 'JSON Schema format links present');
  
  // Test OpenAPI JSON endpoint
  res = await request(app)
    .get('/api/discovery/openapi')
    .expect(200);
  
  assert.equal(res.body.openapi, '3.0.3', 'OpenAPI JSON endpoint works');
  assert.ok(res.body.paths, 'Has paths');
  
  // Test OpenAPI YAML endpoint
  res = await request(app)
    .get('/api/discovery/openapi.yaml')
    .expect(200);
  
  assert.ok(res.text.includes('openapi: 3.0.3'), 'OpenAPI YAML endpoint works');
  assert.equal(res.type, 'text/yaml', 'Correct content type');
  
  // Test JSON Schema endpoint
  res = await request(app)
    .get('/api/discovery/jsonschema')
    .expect(200);
  
  assert.ok(res.body.$schema, 'JSON Schema endpoint works');
  assert.ok(res.body.definitions, 'Has definitions');
  
  // Test individual resource schema
  res = await request(app)
    .get('/api/discovery/jsonschema/users')
    .expect(200);
  
  assert.ok(res.body.$id, 'Individual resource schema works');
  
  // Test non-existent resource
  res = await request(app)
    .get('/api/discovery/jsonschema/nonexistent')
    .expect(404);
  
  assert.ok(res.body.errors, 'Returns error for non-existent resource');
  
  // Test Swagger UI endpoint
  res = await request(app)
    .get('/api/docs')
    .expect(200);
  
  assert.ok(res.text.includes('swagger-ui'), 'Swagger UI HTML served');
});

it('should include searchable fields and relationships in OpenAPI', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(DiscoveryPlugin);
  
  api.addResource('posts', postSchema, {
    searchableFields: {
      'author.name': 'authorId->name',
      'status': '*' // Virtual searchable field
    }
  });
  
  const spec = await api.discovery.openapi();
  
  // Check that searchable fields are in query parameters
  const queryParams = spec.paths['/posts'].get.parameters;
  
  const titleFilter = queryParams.find(p => p.name === 'filter[title]');
  assert.ok(titleFilter, 'Searchable field title has filter parameter');
  
  const authorNameFilter = queryParams.find(p => p.name === 'filter[author.name]');
  assert.ok(authorNameFilter, 'Mapped searchable field has filter parameter');
  
  const statusFilter = queryParams.find(p => p.name === 'filter[status]');
  assert.ok(statusFilter, 'Virtual searchable field has filter parameter');
  
  // Check include parameter
  const includeParam = queryParams.find(p => p.name === 'include');
  assert.ok(includeParam, 'Include parameter exists');
  assert.ok(includeParam.example.includes('authorId'), 'Include example shows relationships');
});

}); // End of describe block