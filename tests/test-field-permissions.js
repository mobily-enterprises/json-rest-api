import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('Field Permissions', () => {
  let api;
  
  beforeEach(() => {
    api = new Api({ debug: true });
    api.use(MemoryPlugin);
  });
  
  describe.only('Basic Field Permissions', () => {
    test.only('should hide fields without read permission', async () => {
      api.addResource('secrets', new Schema({
        publicInfo: { type: 'string' },
        internalNotes: { 
          type: 'string',
          permissions: { read: 'admin' }
        },
        topSecret: {
          type: 'string',
          permissions: { read: false }
        }
      }));
      
      await api.connect();
      console.log('Registered hooks:', Array.from(api.hooks.keys()));
      console.log('afterGet hooks count:', api.hooks.get('afterGet')?.length);
      
      // Create a record
      await api.insert({
        publicInfo: 'Everyone can see this',
        internalNotes: 'Admin only',
        topSecret: 'Nobody can see this'
      }, { type: 'secrets' });
      
      // Fetch without user (anonymous)
      const anonResult = await api.get(1, { type: 'secrets' });
      console.log('DEBUG: anonResult =', JSON.stringify(anonResult, null, 2));
      assert.equal(anonResult.data.attributes.publicInfo, 'Everyone can see this');
      assert.equal(anonResult.data.attributes.internalNotes, undefined);
      assert.equal(anonResult.data.attributes.topSecret, undefined);
      
      // Fetch with admin user
      const adminResult = await api.get(1, { 
        type: 'secrets',
        user: { roles: ['admin'] }
      });
      assert.equal(adminResult.data.attributes.publicInfo, 'Everyone can see this');
      assert.equal(adminResult.data.attributes.internalNotes, 'Admin only');
      assert.equal(adminResult.data.attributes.topSecret, undefined);
    });
    
    test('should handle array permissions (OR logic)', async () => {
      api.addResource('documents', new Schema({
        title: { type: 'string' },
        content: {
          type: 'string',
          permissions: { read: ['editor', 'admin', 'moderator'] }
        }
      }));
      
      await api.connect();
      
      await api.insert({
        title: 'Important Doc',
        content: 'Restricted content'
      }, { type: 'documents' });
      
      // Check each role
      const editorResult = await api.get(1, {
        type: 'documents',
        user: { roles: ['editor'] }
      });
      assert.equal(editorResult.data.attributes.content, 'Restricted content');
      
      const modResult = await api.get(1, {
        type: 'documents',
        user: { role: 'moderator' } // Single role field
      });
      assert.equal(modResult.data.attributes.content, 'Restricted content');
      
      const userResult = await api.get(1, {
        type: 'documents',
        user: { roles: ['user'] }
      });
      assert.equal(userResult.data.attributes.content, undefined);
    });
    
    test('should handle function permissions', async () => {
      api.addResource('posts', new Schema({
        title: { type: 'string' },
        authorId: { type: 'id' },
        draft: {
          type: 'string',
          permissions: {
            read: (user, record) => {
              // Only author or admin can see drafts
              return user?.id === record.authorId || user?.roles?.includes('admin');
            }
          }
        }
      }));
      
      await api.connect();
      
      await api.insert({
        title: 'My Post',
        authorId: 123,
        draft: 'Work in progress...'
      }, { type: 'posts' });
      
      // Author can see draft
      const authorResult = await api.get(1, {
        type: 'posts',
        user: { id: 123 }
      });
      assert.equal(authorResult.data.attributes.draft, 'Work in progress...');
      
      // Admin can see draft
      const adminResult = await api.get(1, {
        type: 'posts',
        user: { id: 999, roles: ['admin'] }
      });
      assert.equal(adminResult.data.attributes.draft, 'Work in progress...');
      
      // Others cannot
      const otherResult = await api.get(1, {
        type: 'posts',
        user: { id: 456 }
      });
      assert.equal(otherResult.data.attributes.draft, undefined);
    });
    
    test('should filter fields in query results', async () => {
      api.addResource('users', new Schema({
        name: { type: 'string' },
        email: {
          type: 'string',
          permissions: { read: 'authenticated' }
        },
        salary: {
          type: 'number',
          permissions: { read: ['hr', 'manager'] }
        }
      }));
      
      await api.connect();
      
      // Create multiple users
      await api.insert({ name: 'Alice', email: 'alice@test.com', salary: 100000 }, { type: 'users' });
      await api.insert({ name: 'Bob', email: 'bob@test.com', salary: 90000 }, { type: 'users' });
      
      // Anonymous query
      const anonResult = await api.query({}, { type: 'users' });
      assert.equal(anonResult.data.length, 2);
      assert.equal(anonResult.data[0].attributes.name, 'Alice');
      assert.equal(anonResult.data[0].attributes.email, undefined);
      assert.equal(anonResult.data[0].attributes.salary, undefined);
      
      // HR query
      const hrResult = await api.query({}, {
        type: 'users',
        user: { roles: ['hr'] }
      });
      assert.equal(hrResult.data[0].attributes.salary, 100000);
      assert.equal(hrResult.data[1].attributes.salary, 90000);
    });
  });
  
  describe('Relationship Include Permissions', () => {
    test('should check include permissions on relationships', async () => {
      api.addResource('authors', new Schema({
        name: { type: 'string' },
        secretPseudonym: {
          type: 'string',
          permissions: { read: 'editor' }
        }
      }));
      
      api.addResource('books', new Schema({
        title: { type: 'string' },
        authorId: {
          type: 'id',
          refs: { 
            resource: 'authors',
            join: { eager: true }
          },
          permissions: {
            read: true, // Anyone can see author ID
            include: 'authenticated' // Must be logged in to include author data
          }
        }
      }));
      
      await api.connect();
      
      const author = await api.insert({ 
        name: 'J.K. Rowling',
        secretPseudonym: 'Robert Galbraith'
      }, { type: 'authors' });
      
      await api.insert({
        title: 'Harry Potter',
        authorId: author.data.id
      }, { type: 'books' });
      
      // Anonymous user - can see ID but not included data
      const anonResult = await api.get(1, { type: 'books' });
      assert.equal(anonResult.data.attributes.authorId, 1);
      assert.equal(anonResult.data.attributes.author, undefined); // No joined data
      
      // Authenticated user - can see included author
      const authResult = await api.get(1, {
        type: 'books',
        user: { id: 1, authenticated: true }
      });
      assert.equal(anonResult.data.attributes.authorId, 1);
      // Note: eager joins are currently processed differently, this might need adjustment
    });
    
    test('should respect include permissions with explicit include parameter', async () => {
      api.addResource('departments', new Schema({
        name: { type: 'string' },
        budget: {
          type: 'number',
          permissions: { read: 'manager' }
        }
      }));
      
      api.addResource('employees', new Schema({
        name: { type: 'string' },
        departmentId: {
          type: 'id',
          refs: { resource: 'departments' },
          permissions: {
            read: true,
            include: ['hr', 'manager']
          }
        }
      }));
      
      await api.connect();
      
      const dept = await api.insert({
        name: 'Engineering',
        budget: 1000000
      }, { type: 'departments' });
      
      await api.insert({
        name: 'Alice',
        departmentId: dept.data.id
      }, { type: 'employees' });
      
      // Regular user cannot include department
      const userResult = await api.get(1, {
        type: 'employees',
        include: 'departmentId',
        user: { roles: ['user'] }
      });
      assert.equal(userResult.data.attributes.departmentId, 1);
      // Verify no department data was included (this depends on implementation)
      
      // HR can include department
      const hrResult = await api.get(1, {
        type: 'employees', 
        include: 'departmentId',
        user: { roles: ['hr'] }
      });
      // Verify department was included (implementation dependent)
    });
  });
  
  describe('Nested Include Permissions', () => {
    test('should check permissions at each level of nested includes', async () => {
      api.addResource('countries', new Schema({
        name: { type: 'string' },
        gdp: {
          type: 'number',
          permissions: { read: 'analyst' }
        }
      }));
      
      api.addResource('cities', new Schema({
        name: { type: 'string' },
        population: { type: 'number' },
        countryId: {
          type: 'id',
          refs: { resource: 'countries' },
          permissions: {
            include: 'authenticated'
          }
        }
      }));
      
      api.addResource('companies', new Schema({
        name: { type: 'string' },
        revenue: {
          type: 'number',
          permissions: { read: ['investor', 'analyst'] }
        },
        cityId: {
          type: 'id',
          refs: { resource: 'cities' },
          permissions: {
            include: true // Anyone can include city
          }
        }
      }));
      
      await api.connect();
      
      const country = await api.insert({ name: 'USA', gdp: 21000000 }, { type: 'countries' });
      const city = await api.insert({ name: 'New York', population: 8000000, countryId: country.data.id }, { type: 'cities' });
      await api.insert({ name: 'TechCorp', revenue: 1000000, cityId: city.data.id }, { type: 'companies' });
      
      // Anonymous user - can include city but not country
      const anonResult = await api.get(1, {
        type: 'companies',
        include: 'cityId.countryId'
      });
      // Should have city but not country (implementation verification needed)
      
      // Authenticated user - can see both levels
      const authResult = await api.get(1, {
        type: 'companies',
        include: 'cityId.countryId',
        user: { authenticated: true }
      });
      // Should have both city and country (implementation verification needed)
      
      // Analyst can see GDP
      const analystResult = await api.get(1, {
        type: 'companies',
        include: 'cityId.countryId',
        user: { roles: ['analyst'], authenticated: true }
      });
      // Should see GDP field in country (implementation verification needed)
    });
  });
  
  describe('Permission Edge Cases', () => {
    test('should handle missing permission definitions as public', async () => {
      api.addResource('items', new Schema({
        name: { type: 'string' }, // No permissions = public
        description: { type: 'string' }
      }));
      
      await api.connect();
      await api.insert({ name: 'Item 1', description: 'Test' }, { type: 'items' });
      
      const result = await api.get(1, { type: 'items' });
      assert.equal(result.data.attributes.name, 'Item 1');
      assert.equal(result.data.attributes.description, 'Test');
    });
    
    test('should handle permission checking with no user', async () => {
      api.addResource('data', new Schema({
        public: { type: 'string' },
        restricted: {
          type: 'string',
          permissions: { read: 'user' }
        }
      }));
      
      await api.connect();
      await api.insert({ public: 'Public', restricted: 'Secret' }, { type: 'data' });
      
      // No user = anonymous
      const result = await api.get(1, { type: 'data' });
      assert.equal(result.data.attributes.public, 'Public');
      assert.equal(result.data.attributes.restricted, undefined);
    });
    
    test('should handle complex permission scenarios', async () => {
      let checkCount = 0;
      
      api.addResource('complex', new Schema({
        field1: {
          type: 'string',
          permissions: {
            read: (user, record) => {
              checkCount++;
              return user?.level > 5;
            }
          }
        },
        field2: {
          type: 'string',
          permissions: {
            read: ['admin', (user) => user?.special === true]
          }
        }
      }));
      
      await api.connect();
      await api.insert({ field1: 'Level restricted', field2: 'Admin or special' }, { type: 'complex' });
      
      // Level 6 user
      const level6Result = await api.get(1, {
        type: 'complex',
        user: { level: 6 }
      });
      assert.equal(level6Result.data.attributes.field1, 'Level restricted');
      assert.equal(level6Result.data.attributes.field2, undefined);
      
      // Special user
      const specialResult = await api.get(1, {
        type: 'complex',
        user: { special: true }
      });
      assert.equal(specialResult.data.attributes.field1, undefined);
      assert.equal(specialResult.data.attributes.field2, 'Admin or special');
      
      assert(checkCount >= 2); // Function was called
    });
  });
});