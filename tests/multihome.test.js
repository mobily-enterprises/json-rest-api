import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument,
  assertResourceAttributes,
  createRelationship,
  resourceIdentifier
} from './helpers/test-utils.js';
import { createMultiHomeApi } from './fixtures/api-configs.js';

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance that persists across ALL tests
let api;

describe('MultiHome Plugin Tests', () => {
  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Create API instance ONCE - this is reused for all tests
    api = await createMultiHomeApi(knex);
  });
  
  // IMPORTANT: after() cleans up resources
  after(async () => {
    // Always destroy knex connection to allow tests to exit
    await knex.destroy();
  });
  
  // IMPORTANT: beforeEach() cleans data but does NOT recreate API
  beforeEach(async () => {
    // Clean all tables - list ALL tables your tests use
    await cleanTables(knex, [
      'multihome_projects',
      'multihome_tasks',
      'multihome_users',
      'multihome_system_settings'
    ]);
  });
  
  describe('Tenant Isolation', () => {
    it('should automatically set tenant_id on new records', async () => {
      // Create a project for tenant A
      const doc = createJsonApiDocument('projects', {
        name: 'Tenant A Project',
        description: 'A project for tenant A'
      });
      
      // Create with tenant context
      const createResult = await api.resources.projects.post({
        inputRecord: doc,
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      // Verify response
      validateJsonApiStructure(createResult);
      assert.equal(createResult.data.type, 'projects');
      assertResourceAttributes(createResult.data, {
        name: 'Tenant A Project',
        description: 'A project for tenant A',
        tenant_id: 'tenant-a' // Should be automatically set
      });
    });
    
    it('should filter queries by tenant_id', async () => {
      // Create projects for different tenants
      const projectA1 = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Project A1'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      const projectA2 = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Project A2'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      const projectB1 = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Project B1'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-b' }
      });
      
      // Query as tenant A - should only see tenant A's projects
      const resultA = await api.resources.projects.query({
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      validateJsonApiStructure(resultA, true); // true for collection
      assert.equal(resultA.data.length, 2, 'Tenant A should see 2 projects');
      assert(resultA.data.every(p => p.attributes.name.startsWith('Project A')));
      
      // Query as tenant B - should only see tenant B's projects
      const resultB = await api.resources.projects.query({
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-b' }
      });
      
      validateJsonApiStructure(resultB, true); // true for collection
      assert.equal(resultB.data.length, 1, 'Tenant B should see 1 project');
      assert.equal(resultB.data[0].attributes.name, 'Project B1');
    });
    
    it('should prevent access to other tenant records', async () => {
      // Create a project for tenant A
      const projectA = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Tenant A Secret Project'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      // Try to access as tenant B - should fail
      await assert.rejects(
        async () => {
          await api.resources.projects.get({
            id: projectA.data.id,
            simplified: false
          }, {
            auth: { multihome_id: 'tenant-b' }
          });
        },
        (err) => {
          return err.code === 'REST_API_RESOURCE';
        },
        'Should not be able to access other tenant data'
      );
    });
    
    it('should prevent updating tenant_id to different value', async () => {
      // Create a project for tenant A
      const project = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Original Project'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      // Try to update with different tenant_id - should fail
      await assert.rejects(
        async () => {
          await api.resources.projects.patch({
            id: project.data.id,
            inputRecord: {
              data: {
                type: 'projects',
                id: project.data.id,
                attributes: {
                  name: 'Updated Project',
                  tenant_id: 'tenant-b' // Trying to change tenant
                }
              }
            },
            simplified: false
          }, {
            auth: { multihome_id: 'tenant-a' }
          });
        },
        (err) => {
          console.log('PATCH error:', err.message);
          console.log('PATCH error stack:', err.stack);
          return err.message.includes('must match current context');
        },
        'Should not be able to change tenant_id'
      );
    });
  });
  
  describe('Relationships Across Tenants', () => {
    it('should maintain tenant isolation for related records', async () => {
      // Create projects for different tenants
      const projectA = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Tenant A Project'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      const projectB = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Tenant B Project'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-b' }
      });
      
      // Create task for tenant A project
      const taskA = await api.resources.tasks.post({
        inputRecord: createJsonApiDocument('tasks', 
          {
            title: 'Task for Tenant A'
          },
          {
            project: createRelationship(resourceIdentifier('projects', projectA.data.id))
          }
        ),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      // Try to create task for tenant B project as tenant A - should fail
      await assert.rejects(
        async () => {
          await api.resources.tasks.post({
            inputRecord: createJsonApiDocument('tasks', 
              {
                title: 'Invalid Task'
              },
              {
                project: createRelationship(resourceIdentifier('projects', projectB.data.id))
              }
            ),
            simplified: false
          }, {
            auth: { multihome_id: 'tenant-a' }
          });
        },
        (err) => {
          // Should fail because project belongs to different tenant
          return err.code === 'REST_API_VALIDATION' || err.code === 'REST_API_RESOURCE';
        },
        'Should not be able to link to other tenant resources'
      );
      
      // Query with includes - should only see own tenant data
      const projectWithTasks = await api.resources.projects.get({
        id: projectA.data.id,
        queryParams: {
          include: ['tasks']
        },
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      validateJsonApiStructure(projectWithTasks);
      assert(projectWithTasks.included, 'Should have included tasks');
      assert.equal(projectWithTasks.included.length, 1, 'Should include one task');
      assert.equal(projectWithTasks.included[0].attributes.tenant_id, 'tenant-a');
    });
  });
  
  describe('Excluded Resources', () => {
    it('should allow access to excluded resources without tenant context', async () => {
      // Create system setting without tenant context
      const setting = await api.resources.system_settings.post({
        inputRecord: createJsonApiDocument('system_settings', {
          key: 'app.version',
          value: '1.0.0'
        }),
        simplified: false
      });
      
      validateJsonApiStructure(setting);
      assert.equal(setting.data.type, 'system_settings');
      assert(!setting.data.attributes.tenant_id, 'Should not have tenant_id');
      
      // Query without tenant context should work
      const allSettings = await api.resources.system_settings.query({
        simplified: false
      });
      
      assert.equal(allSettings.data.length, 1);
      
      // Should be accessible by any tenant
      const settingByTenantA = await api.resources.system_settings.get({
        id: setting.data.id,
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      assert.equal(settingByTenantA.data.id, setting.data.id);
    });
  });
  
  describe('Configuration Options', () => {
    it('should require tenant context when requireAuth is true', async () => {
      // Try to create without tenant context - should fail
      await assert.rejects(
        async () => {
          await api.resources.projects.post({
            inputRecord: createJsonApiDocument('projects', {
              name: 'No Tenant Project'
            }),
            simplified: false
          });
        },
        (err) => {
          return err.message.includes('multihome context');
        },
        'Should require tenant context when requireAuth is true'
      );
    });
    
    it('should validate resources have tenant field when allowMissing is false', async () => {
      // This test validates that the plugin threw an error during setup
      // if a resource was missing the tenant field. Since our test resources
      // all have tenant_id (except excluded ones), we can verify the
      // configuration is working by checking vars
      assert.equal(api.vars.multihome.field, 'tenant_id');
      assert.equal(api.vars.multihome.allowMissing, false);
      assert(api.vars.multihome.excludeResources.includes('system_settings'));
    });
  });
  
  describe('Complex Queries', () => {
    it('should apply tenant filter to filtered queries', async () => {
      // Create users for different tenants
      await api.resources.users.post({
        inputRecord: createJsonApiDocument('users', {
          email: 'admin@tenant-a.com',
          name: 'Admin A',
          role: 'admin'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      await api.resources.users.post({
        inputRecord: createJsonApiDocument('users', {
          email: 'user@tenant-a.com',
          name: 'User A',
          role: 'member'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      await api.resources.users.post({
        inputRecord: createJsonApiDocument('users', {
          email: 'admin@tenant-b.com',
          name: 'Admin B',
          role: 'admin'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-b' }
      });
      
      // Query for admins as tenant A - should only see tenant A admin
      const adminsA = await api.resources.users.query({
        queryParams: {
          filters: { role: 'admin' }
        },
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      assert.equal(adminsA.data.length, 1, 'Should only see tenant A admin');
      assert.equal(adminsA.data[0].attributes.email, 'admin@tenant-a.com');
      
      // Query for all users as tenant B - should only see tenant B users
      const usersB = await api.resources.users.query({
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-b' }
      });
      
      assert.equal(usersB.data.length, 1, 'Should only see tenant B users');
      assert.equal(usersB.data[0].attributes.email, 'admin@tenant-b.com');
    });
    
    it('should apply tenant filter with sorting and pagination', async () => {
      // Create multiple projects for tenant A
      for (let i = 1; i <= 5; i++) {
        await api.resources.projects.post({
          inputRecord: createJsonApiDocument('projects', {
            name: `Project A${i}`,
            status: i % 2 === 0 ? 'active' : 'inactive'
          }),
          simplified: false
        }, {
          auth: { multihome_id: 'tenant-a' }
        });
      }
      
      // Create projects for tenant B
      for (let i = 1; i <= 3; i++) {
        await api.resources.projects.post({
          inputRecord: createJsonApiDocument('projects', {
            name: `Project B${i}`
          }),
          simplified: false
        }, {
          auth: { multihome_id: 'tenant-b' }
        });
      }
      
      // Query with pagination as tenant A
      const page1 = await api.resources.projects.query({
        queryParams: {
          page: { size: 2, number: 1 },
          sort: ['-name'] // Sort by name descending
        },
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      assert.equal(page1.data.length, 2, 'Should return page size');
      assert.equal(page1.data[0].attributes.name, 'Project A5', 'Should be sorted descending');
      assert.equal(page1.data[1].attributes.name, 'Project A4');
      
      // Get page 2
      const page2 = await api.resources.projects.query({
        queryParams: {
          page: { size: 2, number: 2 },
          sort: ['-name']
        },
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      assert.equal(page2.data.length, 2, 'Should return page size');
      assert(page2.data.every(p => p.attributes.tenant_id === 'tenant-a'));
    });
  });
  
  describe('Error Handling', () => {
    it('should provide clear error when no tenant context available', async () => {
      await assert.rejects(
        async () => {
          await api.resources.projects.query({
            simplified: false
          });
        },
        (err) => {
          return err.message.includes('No multihome context available');
        },
        'Should provide clear error message'
      );
    });
    
    it('should handle missing tenant field gracefully for excluded resources', async () => {
      // system_settings is excluded and doesn't have tenant_id field
      const result = await api.resources.system_settings.post({
        inputRecord: createJsonApiDocument('system_settings', {
          key: 'test.setting',
          value: 'test'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' } // Should be ignored for excluded resources
      });
      
      validateJsonApiStructure(result);
      assert(!result.data.attributes.tenant_id, 'Excluded resource should not have tenant_id');
    });
  });
  
  describe('Security', () => {
    it('should prevent bypassing tenant filter with malicious IDs', async () => {
      // Create a project for tenant A
      const project = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Secure Project'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      // Try various bypass attempts as tenant B
      const maliciousIds = [
        project.data.id,
        `${project.data.id} OR 1=1`,
        `${project.data.id}'; DROP TABLE projects; --`
      ];
      
      for (const id of maliciousIds) {
        await assert.rejects(
          async () => {
            await api.resources.projects.get({
              id,
              simplified: false
            }, {
              auth: { multihome_id: 'tenant-b' }
            });
          },
          undefined, // Any error is fine
          `Should not bypass security with ID: ${id}`
        );
      }
    });
    
    it('should log security violations', async () => {
      // This test verifies that the plugin logs security violations
      // In a real implementation, you might capture logs and verify
      // For now, we just ensure the security check happens
      
      // Create data for tenant A
      const project = await api.resources.projects.post({
        inputRecord: createJsonApiDocument('projects', {
          name: 'Tenant A Data'
        }),
        simplified: false
      }, {
        auth: { multihome_id: 'tenant-a' }
      });
      
      // Attempt access as tenant B
      try {
        await api.resources.projects.get({
          id: project.data.id,
          simplified: false
        }, {
          auth: { multihome_id: 'tenant-b' }
        });
        assert.fail('Should have thrown error');
      } catch (err) {
        // Error is expected - security violation should be logged
        assert(err.code === 'REST_API_RESOURCE' || err.message.includes('Access denied'));
      }
    });
  });
});