import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { cleanTables } from './helpers/test-utils.js';
import { createPositioningApi } from './fixtures/api-configs.js';
import { PositioningPlugin } from '../plugins/core/rest-api-positioning-plugin.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

describe('Multi-Filter Positioning Tests', { timeout: 30000 }, () => {
  let api;

  before(async () => {
    // Initialize API
    api = await createPositioningApi(knex);
    
    // Install positioning plugin with default configuration
    await api.use(PositioningPlugin, {
      field: 'position',
      filters: ['project_id', 'status'], // Default filters for most tests
      defaultPosition: 'last'
    });
  });
  
  after(async () => {
    await knex.destroy();
  });
  
  beforeEach(async () => {
    await cleanTables(knex, [
      'positioning_categories',
      'positioning_tasks',
      'positioning_projects',
      'positioning_items'
    ]);
  });

  describe('Multiple Filter Fields', () => {
    it('should maintain separate position sequences for each filter combination', async () => {
      // Plugin already installed with filters in before hook

      // Create projects
      const project1 = await api.resources.projects.post({ name: 'Project 1' });
      const project2 = await api.resources.projects.post({ name: 'Project 2' });

      // Create items in different filter combinations
      // Project 1, Active
      const p1Active1 = await api.resources.items.post({
        name: 'P1 Active 1',
        project_id: project1.id,
        status: 'active'
      });

      const p1Active2 = await api.resources.items.post({
        name: 'P1 Active 2',
        project_id: project1.id,
        status: 'active'
      });

      // Project 1, Archived
      const p1Archived1 = await api.resources.items.post({
        name: 'P1 Archived 1',
        project_id: project1.id,
        status: 'archived'
      });

      const p1Archived2 = await api.resources.items.post({
        name: 'P1 Archived 2',
        project_id: project1.id,
        status: 'archived'
      });

      // Project 2, Active
      const p2Active1 = await api.resources.items.post({
        name: 'P2 Active 1',
        project_id: project2.id,
        status: 'active'
      });

      const p2Active2 = await api.resources.items.post({
        name: 'P2 Active 2',
        project_id: project2.id,
        status: 'active'
      });

      // Project 2, Archived
      const p2Archived1 = await api.resources.items.post({
        name: 'P2 Archived 1',
        project_id: project2.id,
        status: 'archived'
      });

      // Query each combination
      const { data: p1ActiveItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project1.id, status: 'active' },
          sort: ['position']
        }
      });

      assert.equal(p1ActiveItems.length, 2);
      assert.equal(p1ActiveItems[0].name, 'P1 Active 1');
      assert.equal(p1ActiveItems[1].name, 'P1 Active 2');

      const { data: p1ArchivedItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project1.id, status: 'archived' },
          sort: ['position']
        }
      });

      assert.equal(p1ArchivedItems.length, 2);
      assert.equal(p1ArchivedItems[0].name, 'P1 Archived 1');
      assert.equal(p1ArchivedItems[1].name, 'P1 Archived 2');

      const { data: p2ActiveItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project2.id, status: 'active' },
          sort: ['position']
        }
      });

      assert.equal(p2ActiveItems.length, 2);
      assert.equal(p2ActiveItems[0].name, 'P2 Active 1');
      assert.equal(p2ActiveItems[1].name, 'P2 Active 2');

      // Verify positions are independent across filter combinations
      // Items in different groups can have the same position
      assert.equal(p1Active1.position, 'a0');
      assert.equal(p1Archived1.position, 'a0');
      assert.equal(p2Active1.position, 'a0');
      assert.equal(p2Archived1.position, 'a0');
    });

    it('should handle positioning with null values in multi-filter setup', async () => {
      // Plugin already installed with filters in before hook

      const project = await api.resources.projects.post({ name: 'Project' });

      // Create items with various null combinations
      const item1 = await api.resources.items.post({
        name: 'Item 1',
        project_id: project.id,
        status: 'active'
      });

      const item2 = await api.resources.items.post({
        name: 'Item 2',
        project_id: project.id,
        status: null // Null status
      });

      const item3 = await api.resources.items.post({
        name: 'Item 3',
        project_id: null, // Null project
        status: 'active'
      });

      const item4 = await api.resources.items.post({
        name: 'Item 4',
        project_id: null,
        status: null // Both null
      });

      // Query different combinations
      const { data: projectActiveItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: 'active' },
          sort: ['position']
        }
      });
      assert.equal(projectActiveItems.length, 1);
      assert.equal(projectActiveItems[0].name, 'Item 1');

      const { data: projectNullStatusItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: null },
          sort: ['position']
        }
      });
      assert.equal(projectNullStatusItems.length, 1);
      assert.equal(projectNullStatusItems[0].name, 'Item 2');

      const { data: nullProjectActiveItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: null, status: 'active' },
          sort: ['position']
        }
      });
      assert.equal(nullProjectActiveItems.length, 1);
      assert.equal(nullProjectActiveItems[0].name, 'Item 3');

      const { data: bothNullItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: null, status: null },
          sort: ['position']
        }
      });
      assert.equal(bothNullItems.length, 1);
      assert.equal(bothNullItems[0].name, 'Item 4');
    });

    it('should handle beforeId correctly with multi-filter positioning', async () => {
      // Plugin already installed with filters in before hook

      const project = await api.resources.projects.post({ name: 'Project' });

      // Create initial items
      const item1 = await api.resources.items.post({
        name: 'Item 1',
        project_id: project.id,
        status: 'active'
      });

      const item2 = await api.resources.items.post({
        name: 'Item 2',
        project_id: project.id,
        status: 'active'
      });

      const item3 = await api.resources.items.post({
        name: 'Item 3',
        project_id: project.id,
        status: 'active'
      });

      // Create item in different filter group with beforeId from first group
      const item4 = await api.resources.items.post({
        name: 'Item 4',
        project_id: project.id,
        status: 'archived',
        beforeId: item2.id // This should be ignored since it's in a different filter group
      });

      // Item 4 should be first in its filter group
      const { data: archivedItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: 'archived' },
          sort: ['position']
        }
      });

      assert.equal(archivedItems.length, 1);
      assert.equal(archivedItems[0].name, 'Item 4');
      assert.equal(archivedItems[0].position, 'a0'); // First in its group

      // Now position an item before another in the same filter group
      const item5 = await api.resources.items.post({
        name: 'Item 5',
        project_id: project.id,
        status: 'active',
        beforeId: item2.id
      });

      const { data: activeItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: 'active' },
          sort: ['position']
        }
      });

      assert.equal(activeItems.length, 4);
      const item5Index = activeItems.findIndex(i => i.name === 'Item 5');
      const item2Index = activeItems.findIndex(i => i.name === 'Item 2');
      assert(item5Index < item2Index, 'Item 5 should be before Item 2');
    });

    it('should handle updates that change filter values', async () => {
      // Plugin already installed with filters in before hook

      const project1 = await api.resources.projects.post({ name: 'Project 1' });
      const project2 = await api.resources.projects.post({ name: 'Project 2' });

      // Create items in project 1
      const item1 = await api.resources.items.post({
        name: 'Item 1',
        project_id: project1.id,
        status: 'active'
      });

      const item2 = await api.resources.items.post({
        name: 'Item 2',
        project_id: project1.id,
        status: 'active'
      });

      const item3 = await api.resources.items.post({
        name: 'Item 3',
        project_id: project1.id,
        status: 'active'
      });

      // Create items in project 2
      const item4 = await api.resources.items.post({
        name: 'Item 4',
        project_id: project2.id,
        status: 'active'
      });

      // Move item2 to project 2, positioning it before item4
      await api.resources.items.patch({
        id: item2.id,
        project_id: project2.id,
        beforeId: item4.id
      });

      // Verify project 1 now has 2 items
      const { data: p1Items } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project1.id, status: 'active' },
          sort: ['position']
        }
      });

      assert.equal(p1Items.length, 2);
      assert.equal(p1Items[0].name, 'Item 1');
      assert.equal(p1Items[1].name, 'Item 3');

      // Verify project 2 has items in correct order
      const { data: p2Items } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project2.id, status: 'active' },
          sort: ['position']
        }
      });

      assert.equal(p2Items.length, 2);
      assert.equal(p2Items[0].name, 'Item 2');
      assert.equal(p2Items[1].name, 'Item 4');

      // Change status of item3 to archived
      await api.resources.items.patch({
        id: item3.id,
        status: 'archived'
      });

      // Verify it's now in a different filter group
      const { data: p1ActiveItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project1.id, status: 'active' },
          sort: ['position']
        }
      });

      assert.equal(p1ActiveItems.length, 1);
      assert.equal(p1ActiveItems[0].name, 'Item 1');

      const { data: p1ArchivedItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project1.id, status: 'archived' },
          sort: ['position']
        }
      });

      assert.equal(p1ArchivedItems.length, 1);
      assert.equal(p1ArchivedItems[0].name, 'Item 3');
      // Position should be maintained when moving to new filter group
      // (the plugin doesn't know where to position it in the new group)
      assert(p1ArchivedItems[0].position); // Just verify it has a position
    });
  });

  describe('Complex Multi-Filter Scenarios', () => {
    it('should handle three or more filter fields', async () => {
      // Create a new API instance for this test
      const multiApi = await createPositioningApi(knex, {
        apiName: 'multi-filter-three',
        tablePrefix: 'mf3'
      });

      // Priority field is already in the items schema

      await multiApi.use(PositioningPlugin, {
        field: 'position',
        filters: ['project_id', 'status', 'priority'],
        defaultPosition: 'last'
      });

      const project = await multiApi.resources.projects.post({ name: 'Project' });

      // Create items in different combinations
      const items = [];
      const statuses = ['active', 'pending', 'archived'];
      const priorities = ['high', 'medium', 'low'];

      for (const status of statuses) {
        for (const priority of priorities) {
          const item = await multiApi.resources.items.post({
            name: `Item ${status}-${priority}`,
            project_id: project.id,
            status,
            priority
          });
          items.push(item);
        }
      }

      // Each combination should have its own sequence
      for (const status of statuses) {
        for (const priority of priorities) {
          const { data: filtered } = await multiApi.resources.items.query({
            queryParams: {
              filters: { 
                project_id: project.id, 
                status: status,
                priority: priority 
              },
              sort: ['position']
            }
          });

          assert.equal(filtered.length, 1);
          assert.equal(filtered[0].name, `Item ${status}-${priority}`);
          assert.equal(filtered[0].position, 'a0'); // Each is first in its group
        }
      }

      // Add more items to one combination
      const moreItems = [];
      for (let i = 2; i <= 5; i++) {
        const item = await multiApi.resources.items.post({
          name: `Item active-high ${i}`,
          project_id: project.id,
          status: 'active',
          priority: 'high'
        });
        moreItems.push(item);
      }

      // Verify the active-high combination now has 5 items
      const { data: activeHighItems } = await multiApi.resources.items.query({
        queryParams: {
          filters: { 
            project_id: project.id, 
            status: 'active',
            priority: 'high' 
          },
          sort: ['position']
        }
      });

      assert.equal(activeHighItems.length, 5);
      
      // Verify they're in order
      for (let i = 1; i < activeHighItems.length; i++) {
        assert(activeHighItems[i-1].position < activeHighItems[i].position);
      }
    });

    it('should handle partial filter queries correctly', async () => {
      // Plugin already installed with filters in before hook

      const project1 = await api.resources.projects.post({ name: 'Project 1' });
      const project2 = await api.resources.projects.post({ name: 'Project 2' });

      // Create items
      await api.resources.items.post({
        name: 'P1 Active 1',
        project_id: project1.id,
        status: 'active'
      });

      await api.resources.items.post({
        name: 'P1 Active 2',
        project_id: project1.id,
        status: 'active'
      });

      await api.resources.items.post({
        name: 'P1 Archived',
        project_id: project1.id,
        status: 'archived'
      });

      await api.resources.items.post({
        name: 'P2 Active',
        project_id: project2.id,
        status: 'active'
      });

      // Query with only one filter (should return items from multiple position groups)
      const { data: activeItems } = await api.resources.items.query({
        queryParams: {
          filters: { status: 'active' },
          sort: ['position']
        }
      });

      assert.equal(activeItems.length, 3);
      
      // Items from different projects might have same position
      const p1ActiveItems = activeItems.filter(i => i.name.startsWith('P1'));
      const p2ActiveItems = activeItems.filter(i => i.name.startsWith('P2'));
      
      assert.equal(p1ActiveItems.length, 2);
      assert.equal(p2ActiveItems.length, 1);
      
      // Within same project, positions should be unique and ordered
      assert(p1ActiveItems[0].position < p1ActiveItems[1].position);
    });

    it('should handle filter changes during bulk operations', async () => {
      // Plugin already installed with filters in before hook

      const project1 = await api.resources.projects.post({ name: 'Project 1' });
      const project2 = await api.resources.projects.post({ name: 'Project 2' });

      // Create multiple items
      const items = [];
      for (let i = 1; i <= 10; i++) {
        const item = await api.resources.items.post({
          name: `Item ${i}`,
          project_id: project1.id,
          status: 'active'
        });
        items.push(item);
      }

      // Move multiple items to different filter groups concurrently
      const updates = [
        // Move to archived
        api.resources.items.patch({ id: items[0].id, status: 'archived' }),
        api.resources.items.patch({ id: items[1].id, status: 'archived' }),
        api.resources.items.patch({ id: items[2].id, status: 'archived' }),
        
        // Move to project 2
        api.resources.items.patch({ id: items[3].id, project_id: project2.id }),
        api.resources.items.patch({ id: items[4].id, project_id: project2.id }),
        
        // Move to project 2 and archived
        api.resources.items.patch({ 
          id: items[5].id, 
          project_id: project2.id, 
          status: 'archived' 
        })
      ];

      await Promise.all(updates);

      // Verify distributions
      const { data: p1Active } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project1.id, status: 'active' },
          sort: ['position']
        }
      });
      assert.equal(p1Active.length, 4); // 10 - 3 archived - 3 moved to p2

      const { data: p1Archived } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project1.id, status: 'archived' },
          sort: ['position']
        }
      });
      assert.equal(p1Archived.length, 3);

      const { data: p2Active } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project2.id, status: 'active' },
          sort: ['position']
        }
      });
      assert.equal(p2Active.length, 2);

      const { data: p2Archived } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project2.id, status: 'archived' },
          sort: ['position']
        }
      });
      assert.equal(p2Archived.length, 1);

      // Verify all groups have proper positioning
      const allGroups = [p1Active, p1Archived, p2Active, p2Archived];
      for (const group of allGroups) {
        if (group.length > 0) {
          // All items should have positions and be properly ordered
          for (let i = 0; i < group.length; i++) {
            assert(group[i].position, `Item ${i} should have a position`);
            if (i > 0) {
              assert(group[i-1].position < group[i].position, `Items should be ordered`);
            }
          }
        }
      }
    });
  });

  describe('Edge Cases with Multi-Filter', () => {
    it('should handle empty string vs null in filters', async () => {
      // Plugin already installed with filters in before hook

      const project = await api.resources.projects.post({ name: 'Project' });

      // Create items with various empty/null combinations
      const item1 = await api.resources.items.post({
        name: 'Item 1',
        project_id: project.id,
        status: '' // Empty string
      });

      const item2 = await api.resources.items.post({
        name: 'Item 2',
        project_id: project.id,
        status: null // Null
      });

      const item3 = await api.resources.items.post({
        name: 'Item 3',
        project_id: project.id,
        status: 'active'
      });

      // Query with empty string filter
      const { data: emptyStatusItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: '' },
          sort: ['position']
        }
      });

      assert.equal(emptyStatusItems.length, 1);
      assert.equal(emptyStatusItems[0].name, 'Item 1');

      // Query with null filter
      const { data: nullStatusItems } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: null },
          sort: ['position']
        }
      });

      assert.equal(nullStatusItems.length, 1);
      assert.equal(nullStatusItems[0].name, 'Item 2');

      // Verify they're in different position groups
      assert.equal(item1.position, 'a0');
      assert.equal(item2.position, 'a0');
      assert.equal(item3.position, 'a0');
    });

    it('should handle numeric vs string filter values', async () => {
      // Plugin already installed with filters in before hook

      const project = await api.resources.projects.post({ name: 'Project' });

      // Create items with numeric-like status values
      const item1 = await api.resources.items.post({
        name: 'Item 1',
        project_id: project.id,
        status: '1'
      });

      const item2 = await api.resources.items.post({
        name: 'Item 2',
        project_id: project.id,
        status: '01' // Different string representation
      });

      const item3 = await api.resources.items.post({
        name: 'Item 3',
        project_id: project.id,
        status: '1'
      });

      // Query with string '1'
      const { data: status1Items } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: '1' },
          sort: ['position']
        }
      });

      assert.equal(status1Items.length, 2);
      assert.equal(status1Items[0].name, 'Item 1');
      assert.equal(status1Items[1].name, 'Item 3');
      assert(status1Items[0].position < status1Items[1].position);

      // Query with string '01'
      const { data: status01Items } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id, status: '01' },
          sort: ['position']
        }
      });

      assert.equal(status01Items.length, 1);
      assert.equal(status01Items[0].name, 'Item 2');
      assert.equal(status01Items[0].position, 'a0');
    });
  });
});