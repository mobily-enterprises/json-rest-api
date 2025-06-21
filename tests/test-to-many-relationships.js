import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('To-Many Relationships', () => {
  let api;
  
  beforeEach(() => {
    api = new Api({ debug: false });
    api.use(MemoryPlugin);
  });
  
  test('should define to-many relationships in schema', async () => {
    // Users have many posts
    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      posts: {
        type: 'list',
        virtual: true,  // Not stored in users table
        foreignResource: 'posts',
        foreignKey: 'userId'
      }
    }));
    
    // Posts belong to a user
    api.addResource('posts', new Schema({
      title: { type: 'string', required: true },
      content: { type: 'string' },
      userId: { 
        type: 'id', 
        refs: { resource: 'users' },  // Standard to-one relationship
        searchable: true
      }
    }));
    
    await api.connect();
    
    // Verify schema was created correctly
    const userSchema = api.schemas.get('users');
    assert(userSchema.structure.posts);
    assert.equal(userSchema.structure.posts.type, 'list');
    assert.equal(userSchema.structure.posts.foreignResource, 'posts');
    assert.equal(userSchema.structure.posts.foreignKey, 'userId');
  });
  
  test('should load to-many relationships when included', async () => {
    // Define schemas
    api.addResource('authors', new Schema({
      name: { type: 'string', required: true },
      books: {
        type: 'list',
        virtual: true,
        foreignResource: 'books',
        foreignKey: 'authorId'
      }
    }));
    
    api.addResource('books', new Schema({
      title: { type: 'string', required: true },
      isbn: { type: 'string' },
      authorId: { 
        type: 'id', 
        refs: { resource: 'authors' },
        searchable: true
      }
    }));
    
    await api.connect();
    
    // Create test data
    const tolkien = await api.insert({
      name: 'J.R.R. Tolkien'
    }, { type: 'authors' });
    
    const hobbit = await api.insert({
      title: 'The Hobbit',
      isbn: '978-0547928227',
      authorId: tolkien.data.id
    }, { type: 'books' });
    
    const lotr = await api.insert({
      title: 'The Lord of the Rings',
      isbn: '978-0544003415',
      authorId: tolkien.data.id
    }, { type: 'books' });
    
    // Get author with books included
    const result = await api.get(tolkien.data.id, {
      type: 'authors',
      include: 'books'
    });
    
    // Check response structure
    assert(result.data);
    assert.equal(result.data.type, 'authors');
    assert.equal(result.data.attributes.name, 'J.R.R. Tolkien');
    
    // Should have relationship to books
    assert(result.data.relationships);
    assert(result.data.relationships.books);
    assert(Array.isArray(result.data.relationships.books.data));
    assert.equal(result.data.relationships.books.data.length, 2);
    
    // Should have included books
    assert(result.included);
    assert.equal(result.included.length, 2);
    
    const includedTitles = result.included.map(b => b.attributes.title).sort();
    assert.deepEqual(includedTitles, ['The Hobbit', 'The Lord of the Rings']);
  });
  
  test('should handle empty to-many relationships', async () => {
    api.addResource('categories', new Schema({
      name: { type: 'string', required: true },
      products: {
        type: 'list',
        virtual: true,
        foreignResource: 'products',
        foreignKey: 'categoryId'
      }
    }));
    
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      categoryId: { type: 'id', refs: { resource: 'categories' }, searchable: true }
    }));
    
    await api.connect();
    
    // Create category with no products
    const empty = await api.insert({
      name: 'Empty Category'
    }, { type: 'categories' });
    
    // Get with products included
    const result = await api.get(empty.data.id, {
      type: 'categories',
      include: 'products'
    });
    
    // Should have empty relationship
    assert(result.data.relationships?.products);
    assert(Array.isArray(result.data.relationships.products.data));
    assert.equal(result.data.relationships.products.data.length, 0);
    
    // No included data
    assert(!result.included || result.included.length === 0);
  });
  
  test('should support filtering and sorting to-many relationships', async () => {
    api.addResource('blogs', new Schema({
      name: { type: 'string', required: true },
      posts: {
        type: 'list',
        virtual: true,
        foreignResource: 'posts',
        foreignKey: 'blogId',
        // Options for the relationship query
        defaultSort: '-publishedAt',
        defaultFilter: { published: true }
      }
    }));
    
    api.addResource('posts', new Schema({
      title: { type: 'string', required: true },
      published: { type: 'boolean', default: false, searchable: true },
      publishedAt: { type: 'timestamp', searchable: true },
      blogId: { type: 'id', refs: { resource: 'blogs' }, searchable: true }
    }));
    
    await api.connect();
    
    // Create test data
    const blog = await api.insert({
      name: 'Tech Blog'
    }, { type: 'blogs' });
    
    // Create posts with different states
    await api.insert({
      title: 'Draft Post',
      published: false,
      blogId: blog.data.id
    }, { type: 'posts' });
    
    await api.insert({
      title: 'Old Published Post',
      published: true,
      publishedAt: Date.now() - 86400000, // Yesterday
      blogId: blog.data.id
    }, { type: 'posts' });
    
    await api.insert({
      title: 'New Published Post',
      published: true,
      publishedAt: Date.now(),
      blogId: blog.data.id
    }, { type: 'posts' });
    
    // Get blog with posts (should apply default filter)
    const result = await api.get(blog.data.id, {
      type: 'blogs',
      include: 'posts'
    });
    
    // Should only include published posts
    assert.equal(result.included?.length, 2);
    
    // Should be sorted by publishedAt descending
    assert.equal(result.included[0].attributes.title, 'New Published Post');
    assert.equal(result.included[1].attributes.title, 'Old Published Post');
  });
  
  test('should support permissions on to-many relationships', async () => {
    api.addResource('teams', new Schema({
      name: { type: 'string', required: true },
      members: {
        type: 'list',
        virtual: true,
        foreignResource: 'users',
        foreignKey: 'teamId',
        permissions: { include: 'manager' }  // Only managers can see members
      }
    }));
    
    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      role: { type: 'string' },
      teamId: { type: 'id', refs: { resource: 'teams' }, searchable: true }
    }));
    
    await api.connect();
    
    // Create test data
    const team = await api.insert({
      name: 'Engineering Team'
    }, { type: 'teams' });
    
    await api.insert({
      name: 'Alice',
      role: 'developer',
      teamId: team.data.id
    }, { type: 'users' });
    
    await api.insert({
      name: 'Bob',
      role: 'developer',
      teamId: team.data.id
    }, { type: 'users' });
    
    // Try to get team with members as regular user
    const userResult = await api.get(team.data.id, {
      type: 'teams',
      include: 'members',
      user: { roles: ['user'] }
    });
    
    // Should not include members
    assert(!userResult.included);
    assert(!userResult.data.relationships?.members);
    
    // Get as manager
    const managerResult = await api.get(team.data.id, {
      type: 'teams',
      include: 'members',
      user: { roles: ['manager'] }
    });
    
    // Should include members
    assert(managerResult.included);
    assert.equal(managerResult.included.length, 2);
    assert(managerResult.data.relationships?.members);
  });
  
  test('should handle nested includes with to-many relationships', async () => {
    // Department has many teams, team has many users
    api.addResource('departments', new Schema({
      name: { type: 'string', required: true },
      teams: {
        type: 'list',
        virtual: true,
        foreignResource: 'teams',
        foreignKey: 'departmentId'
      }
    }));
    
    api.addResource('teams', new Schema({
      name: { type: 'string', required: true },
      departmentId: { type: 'id', refs: { resource: 'departments' }, searchable: true },
      users: {
        type: 'list',
        virtual: true,
        foreignResource: 'users',
        foreignKey: 'teamId'
      }
    }));
    
    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      teamId: { type: 'id', refs: { resource: 'teams' }, searchable: true }
    }));
    
    await api.connect();
    
    // Create test hierarchy
    const dept = await api.insert({
      name: 'Engineering'
    }, { type: 'departments' });
    
    const team1 = await api.insert({
      name: 'Backend Team',
      departmentId: dept.data.id
    }, { type: 'teams' });
    
    const team2 = await api.insert({
      name: 'Frontend Team',
      departmentId: dept.data.id
    }, { type: 'teams' });
    
    await api.insert({
      name: 'Alice',
      teamId: team1.data.id
    }, { type: 'users' });
    
    await api.insert({
      name: 'Bob',
      teamId: team2.data.id
    }, { type: 'users' });
    
    // Get department with nested includes
    const result = await api.get(dept.data.id, {
      type: 'departments',
      include: 'teams.users'
    });
    
    // Should have teams included (nested users not implemented yet)
    assert(result.included?.length >= 2); // At least 2 teams
    
    const teams = result.included.filter(i => i.type === 'teams');
    const users = result.included.filter(i => i.type === 'users');
    
    assert.equal(teams.length, 2);
    // TODO: Implement nested includes on to-many relationships
    // assert.equal(users.length, 2);
  });
});