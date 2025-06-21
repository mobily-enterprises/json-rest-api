import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('Field Permissions - Edge Cases', () => {
  let api;
  
  beforeEach(() => {
    api = new Api({ debug: false });
    api.use(MemoryPlugin);
  });
  
  describe('Permission Inheritance and Defaults', () => {
    test('should treat undefined permissions as public access', async () => {
      api.addResource('items', new Schema({
        publicField: { type: 'string' }, // No permissions defined
        privateField: { 
          type: 'string',
          permissions: { read: false }
        }
      }));
      
      await api.connect();
      await api.insert({
        publicField: 'visible',
        privateField: 'hidden'
      }, { type: 'items' });
      
      const result = await api.get(1, { type: 'items' });
      assert.equal(result.data.attributes.publicField, 'visible');
      assert.equal(result.data.attributes.privateField, undefined);
    });
    
    test('should handle null and undefined permission values', async () => {
      api.addResource('tests', new Schema({
        nullPerm: { 
          type: 'string',
          permissions: { read: null } // Null should be treated as public
        },
        undefinedPerm: {
          type: 'string',
          permissions: { read: undefined } // Undefined should be public
        },
        explicitFalse: {
          type: 'string',
          permissions: { read: false }
        }
      }));
      
      await api.connect();
      await api.insert({
        nullPerm: 'visible1',
        undefinedPerm: 'visible2',
        explicitFalse: 'hidden'
      }, { type: 'tests' });
      
      const result = await api.get(1, { type: 'tests' });
      assert.equal(result.data.attributes.nullPerm, 'visible1');
      assert.equal(result.data.attributes.undefinedPerm, 'visible2');
      assert.equal(result.data.attributes.explicitFalse, undefined);
    });
  });
  
  describe('Complex Permission Functions', () => {
    test('should handle permission functions that throw errors', async () => {
      api.addResource('items', new Schema({
        name: { type: 'string' },
        errorField: {
          type: 'string',
          permissions: {
            read: (user, record) => {
              throw new Error('Permission check failed');
            }
          }
        }
      }));
      
      await api.connect();
      await api.insert({
        name: 'Test',
        errorField: 'This might error'
      }, { type: 'items' });
      
      // Should gracefully handle the error and deny access
      const result = await api.get(1, { type: 'items', user: { id: 1 } });
      assert.equal(result.data.attributes.name, 'Test');
      assert.equal(result.data.attributes.errorField, undefined);
    });
    
    test('should pass correct record context to permission functions', async () => {
      let capturedRecord = null;
      let capturedUser = null;
      
      api.addResource('posts', new Schema({
        title: { type: 'string' },
        authorId: { type: 'id' },
        secretNotes: {
          type: 'string',
          permissions: {
            read: (user, record) => {
              capturedUser = user;
              capturedRecord = record;
              return user?.id === record?.authorId;
            }
          }
        }
      }));
      
      await api.connect();
      await api.insert({
        title: 'My Post',
        authorId: 123,
        secretNotes: 'Only author can see'
      }, { type: 'posts' });
      
      // Query as the author
      const authorResult = await api.get(1, { 
        type: 'posts',
        user: { id: 123 }
      });
      
      assert.equal(capturedUser.id, 123);
      assert.equal(capturedRecord.authorId, 123);
      assert.equal(authorResult.data.attributes.secretNotes, 'Only author can see');
      
      // Query as someone else
      const otherResult = await api.get(1, {
        type: 'posts', 
        user: { id: 456 }
      });
      assert.equal(otherResult.data.attributes.secretNotes, undefined);
    });
  });
  
  describe('Mixed Permission Types in Arrays', () => {
    test('should handle arrays with mixed permission types', async () => {
      api.addResource('data', new Schema({
        mixedField: {
          type: 'string',
          permissions: {
            read: [
              'admin',                    // String role
              (user) => user?.vip === true,  // Function
              false,                      // This should be ignored in OR logic
              ['manager', 'supervisor']   // Nested array (should be flattened)
            ]
          }
        }
      }));
      
      await api.connect();
      await api.insert({
        mixedField: 'Complex permissions'
      }, { type: 'data' });
      
      // Test different user types
      const adminResult = await api.get(1, {
        type: 'data',
        user: { roles: ['admin'] }
      });
      assert.equal(adminResult.data.attributes.mixedField, 'Complex permissions');
      
      const vipResult = await api.get(1, {
        type: 'data',
        user: { vip: true }
      });
      assert.equal(vipResult.data.attributes.mixedField, 'Complex permissions');
      
      const regularResult = await api.get(1, {
        type: 'data',
        user: { roles: ['user'] }
      });
      assert.equal(regularResult.data.attributes.mixedField, undefined);
    });
  });
  
  describe('Permission Edge Cases with Different User Objects', () => {
    test('should handle various user object structures', async () => {
      api.addResource('items', new Schema({
        roleField: {
          type: 'string',
          permissions: { read: 'editor' }
        }
      }));
      
      await api.connect();
      await api.insert({ roleField: 'test' }, { type: 'items' });
      
      // Test different ways users might have roles
      const variations = [
        { user: { role: 'editor' }, should: true },              // Single role field
        { user: { roles: ['editor'] }, should: true },          // Roles array
        { user: { roles: ['admin', 'editor'] }, should: true }, // Multiple roles
        { user: { permissions: ['editor'] }, should: true },    // Permissions array
        { user: { groups: ['editor'] }, should: false },        // Wrong field name
        { user: { roles: 'editor' }, should: false },           // String instead of array
        { user: null, should: false },                          // No user
        { user: {}, should: false },                            // Empty user
        { user: { roles: [] }, should: false },                 // Empty roles
      ];
      
      for (const { user, should } of variations) {
        const result = await api.get(1, { type: 'items', user });
        const hasField = result.data.attributes.roleField !== undefined;
        assert.equal(hasField, should, 
          `User ${JSON.stringify(user)} should ${should ? '' : 'not '}have access`);
      }
    });
  });
  
  describe('Permissions on Computed and Virtual Fields', () => {
    test('should apply permissions to fields added by hooks', async () => {
      api.addResource('products', new Schema({
        name: { type: 'string' },
        price: { type: 'number' },
        // Virtual field added by hook
        margin: {
          type: 'number',
          permissions: { read: 'analyst' }
        }
      }));
      
      // Add hook that computes margin
      api.hook('afterGet', async (context) => {
        if (context.options.type === 'products' && context.result) {
          context.result.margin = context.result.price * 0.3;
        }
      });
      
      await api.connect();
      await api.insert({
        name: 'Widget',
        price: 100
      }, { type: 'products' });
      
      // Regular user shouldn't see margin
      const userResult = await api.get(1, {
        type: 'products',
        user: { roles: ['user'] }
      });
      assert.equal(userResult.data.attributes.price, 100);
      assert.equal(userResult.data.attributes.margin, undefined);
      
      // Analyst should see margin
      const analystResult = await api.get(1, {
        type: 'products',
        user: { roles: ['analyst'] }
      });
      assert.equal(analystResult.data.attributes.margin, 30);
    });
  });
  
  describe('Permissions with Silent Fields', () => {
    test('should respect both silent and permission settings', async () => {
      api.addResource('users', new Schema({
        name: { type: 'string' },
        password: {
          type: 'string',
          silent: true,  // Never returned in SELECT
          permissions: { read: 'admin' } // Even admin can't see it
        },
        apiKey: {
          type: 'string',
          silent: false,
          permissions: { read: 'admin' } // Only admin can see
        }
      }));
      
      await api.connect();
      await api.insert({
        name: 'John',
        password: 'secret123',
        apiKey: 'key123'
      }, { type: 'users' });
      
      // Admin user - still can't see silent field
      const adminResult = await api.get(1, {
        type: 'users',
        user: { roles: ['admin'] }
      });
      assert.equal(adminResult.data.attributes.password, undefined); // Silent wins
      assert.equal(adminResult.data.attributes.apiKey, 'key123');    // Admin can see
      
      // Regular user
      const userResult = await api.get(1, {
        type: 'users',
        user: { roles: ['user'] }
      });
      assert.equal(userResult.data.attributes.password, undefined);
      assert.equal(userResult.data.attributes.apiKey, undefined);
    });
  });
  
  describe('Permissions in Batch Operations', () => {
    test('should apply permissions consistently in batch queries', async () => {
      api.addResource('documents', new Schema({
        title: { type: 'string' },
        authorId: { type: 'id' },
        content: {
          type: 'string',
          permissions: {
            read: (user, record) => user?.id === record.authorId
          }
        }
      }));
      
      await api.connect();
      
      // Create documents by different authors
      for (let i = 1; i <= 5; i++) {
        await api.insert({
          title: `Doc ${i}`,
          authorId: i,
          content: `Secret content ${i}`
        }, { type: 'documents' });
      }
      
      // Query as user 3
      const results = await api.query({}, {
        type: 'documents',
        user: { id: 3 }
      });
      
      assert.equal(results.data.length, 5);
      
      // Check each document
      results.data.forEach((doc, index) => {
        const docNum = index + 1;
        assert.equal(doc.attributes.title, `Doc ${docNum}`);
        
        // Only doc 3 should have content visible
        if (docNum === 3) {
          assert.equal(doc.attributes.content, 'Secret content 3');
        } else {
          assert.equal(doc.attributes.content, undefined);
        }
      });
    });
  });
  
  describe('Performance and Caching', () => {
    test('should not call permission functions multiple times for same field', async () => {
      let callCount = 0;
      
      api.addResource('items', new Schema({
        name: { type: 'string' },
        field1: {
          type: 'string',
          permissions: {
            read: (user) => {
              callCount++;
              return true;
            }
          }
        }
      }));
      
      await api.connect();
      await api.insert({
        name: 'Test',
        field1: 'Value'
      }, { type: 'items' });
      
      callCount = 0;
      await api.get(1, { type: 'items', user: { id: 1 } });
      
      // Should only call once per field
      assert.equal(callCount, 1);
    });
  });
  
  describe('Empty and Special Values', () => {
    test('should handle empty strings, null, and special values correctly', async () => {
      api.addResource('specials', new Schema({
        emptyString: {
          type: 'string',
          permissions: { read: 'admin' }
        },
        nullValue: {
          type: 'string',
          permissions: { read: 'admin' }
        },
        zero: {
          type: 'number',
          permissions: { read: 'admin' }
        },
        falseBool: {
          type: 'boolean',
          permissions: { read: 'admin' }
        },
        emptyArray: {
          type: 'array',
          permissions: { read: 'admin' }
        },
        emptyObject: {
          type: 'object',
          permissions: { read: 'admin' }
        }
      }));
      
      await api.connect();
      await api.insert({
        emptyString: '',
        nullValue: null,
        zero: 0,
        falseBool: false,
        emptyArray: [],
        emptyObject: {}
      }, { type: 'specials' });
      
      // Non-admin should see nothing
      const userResult = await api.get(1, {
        type: 'specials',
        user: { roles: ['user'] }
      });
      assert.equal(Object.keys(userResult.data.attributes).length, 0);
      
      // Admin should see all values preserved correctly
      const adminResult = await api.get(1, {
        type: 'specials',
        user: { roles: ['admin'] }
      });
      assert.strictEqual(adminResult.data.attributes.emptyString, '');
      assert.strictEqual(adminResult.data.attributes.nullValue, null);
      assert.strictEqual(adminResult.data.attributes.zero, 0);
      assert.strictEqual(adminResult.data.attributes.falseBool, false);
      assert.deepEqual(adminResult.data.attributes.emptyArray, []);
      assert.deepEqual(adminResult.data.attributes.emptyObject, {});
    });
  });
});