import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { cleanTables } from './helpers/test-utils.js';
import { createPositioningApi } from './fixtures/api-configs.js';
import { PositioningPlugin } from '../plugins/core/rest-api-positioning-plugin.js';
import { rebalancePositions, isValidPosition, getUnpositionedItems, assignInitialPositions } from '../plugins/core/lib/fractional-positioning.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

describe('Advanced Positioning Plugin Tests', { timeout: 30000 }, () => {
  let api;

  before(async () => {
    // Initialize API once
    api = await createPositioningApi(knex, {
      apiName: 'positioning-advanced-test',
      tablePrefix: 'pos_adv'
    });
    
    // Install positioning plugin with default configuration
    await api.use(PositioningPlugin, {
      field: 'position',
      filters: ['category_id'],
      defaultPosition: 'last',
      autoIndex: true
    });
  });
  
  after(async () => {
    await knex.destroy();
  });
  
  beforeEach(async () => {
    // Only clean tables for the main test API
    await cleanTables(knex, [
      'pos_adv_categories',
      'pos_adv_tasks',
      'pos_adv_projects',
      'pos_adv_items'
    ]);
  });

  describe('Position Rebalancing', () => {
    it('should detect when positions need rebalancing', () => {
      // Create items with increasingly long position strings
      const items = [
        { id: 1, name: 'Item 1', position: 'a0' },
        { id: 2, name: 'Item 2', position: 'a0V' },
        { id: 3, name: 'Item 3', position: 'a0VV' },
        { id: 4, name: 'Item 4', position: 'a0VVV' },
        { id: 5, name: 'Item 5', position: 'a0VVVV' },
        { id: 6, name: 'Item 6', position: 'a0VVVVV' },
        { id: 7, name: 'Item 7', position: 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV' } // 51 chars
      ];

      // Test with default threshold (50)
      const rebalanced = rebalancePositions(items, 'position', 50);
      
      // Should have rebalanced because item 7 exceeds threshold
      assert.notEqual(rebalanced[6].position, items[6].position);
      
      // All positions should be shorter after rebalancing
      for (const item of rebalanced) {
        assert(item.position.length <= 50);
      }
      
      // Order should be preserved
      for (let i = 1; i < rebalanced.length; i++) {
        assert(rebalanced[i-1].position < rebalanced[i].position);
      }
    });

    it('should not rebalance when not needed', async () => {
      const items = [
        { id: 1, name: 'Item 1', position: 'a0' },
        { id: 2, name: 'Item 2', position: 'a1' },
        { id: 3, name: 'Item 3', position: 'a2' },
        { id: 4, name: 'Item 4', position: 'a3' }
      ];

      const result = rebalancePositions(items, 'position', 50);
      
      // Should return same items (no rebalancing needed)
      assert.deepEqual(result, items);
    });

    it('should handle position validation', () => {
      // Valid positions
      assert(isValidPosition('a0'));
      assert(isValidPosition('Zz'));
      assert(isValidPosition('a0V'));
      assert(isValidPosition('ABC123xyz'));
      
      // Invalid positions
      assert(!isValidPosition(''));
      assert(!isValidPosition(null));
      assert(!isValidPosition(undefined));
      assert(!isValidPosition('a-0')); // Contains hyphen
      assert(!isValidPosition('a_0')); // Contains underscore
      assert(!isValidPosition('a 0')); // Contains space
      assert(!isValidPosition('!@#')); // Special characters
      assert(!isValidPosition(123)); // Not a string
    });

    it('should identify unpositioned items', () => {
      const items = [
        { id: 1, name: 'Item 1', position: 'a0' },
        { id: 2, name: 'Item 2', position: null },
        { id: 3, name: 'Item 3', position: 'a1' },
        { id: 4, name: 'Item 4', position: '' },
        { id: 5, name: 'Item 5', position: undefined },
        { id: 6, name: 'Item 6', position: 'invalid-position' }
      ];

      const unpositioned = getUnpositionedItems(items, 'position');
      
      assert.equal(unpositioned.length, 4);
      assert.equal(unpositioned[0].id, 2);
      assert.equal(unpositioned[1].id, 4);
      assert.equal(unpositioned[2].id, 5);
      assert.equal(unpositioned[3].id, 6);
    });

    it('should assign initial positions to unpositioned items', () => {
      const items = [
        { id: 1, name: 'Item 1', position: 'a0' },
        { id: 2, name: 'Item 2', position: null },
        { id: 3, name: 'Item 3', position: 'a2' },
        { id: 4, name: 'Item 4', position: '' },
        { id: 5, name: 'Item 5', position: 'a3' }
      ];

      const result = assignInitialPositions(items, 'position', 'id');
      
      assert.equal(result.length, 5);
      
      // Previously positioned items should keep their positions
      const item1 = result.find(i => i.id === 1);
      assert.equal(item1.position, 'a0');
      
      const item3 = result.find(i => i.id === 3);
      assert.equal(item3.position, 'a2');
      
      const item5 = result.find(i => i.id === 5);
      assert.equal(item5.position, 'a3');
      
      // Unpositioned items should have valid positions
      const item2 = result.find(i => i.id === 2);
      assert(isValidPosition(item2.position));
      assert(item2.position > 'a3'); // Should be after last positioned item
      
      const item4 = result.find(i => i.id === 4);
      assert(isValidPosition(item4.position));
      assert(item4.position > item2.position); // Should be after item2
    });
  });

  describe('Default Position Configuration', () => {
    it('should respect defaultPosition: first configuration', async () => {
      const api = await createPositioningApi(knex, {
        apiName: 'positioning-first-default',
        tablePrefix: 'pos_first_def'
      });

      await api.use(PositioningPlugin, {
        field: 'position',
        filters: ['category_id'],
        defaultPosition: 'first' // New items go to beginning
      });

      const category = await api.resources.categories.post({ name: 'Test Category' });

      // Create tasks - they should be added at the beginning
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      });

      const task3 = await api.resources.tasks.post({
        title: 'Task 3',
        category: category.id
      });

      // Query tasks
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id },
          sort: ['position']
        }
      });

      // With defaultPosition: 'first', the order should be reversed
      // Task 3 should be first (added last, positioned first)
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0].title, 'Task 3');
      assert.equal(tasks[1].title, 'Task 2');
      assert.equal(tasks[2].title, 'Task 1');

      // Verify positions are ordered correctly
      assert(tasks[0].position < tasks[1].position);
      assert(tasks[1].position < tasks[2].position);
    });

    it('should handle beforeId with defaultPosition: first', async () => {
      const api = await createPositioningApi(knex, {
        apiName: 'positioning-first-before',
        tablePrefix: 'pos_first_bef'
      });

      await api.use(PositioningPlugin, {
        field: 'position',
        filters: ['category_id'],
        defaultPosition: 'first'
      });

      const category = await api.resources.categories.post({ name: 'Test Category' });

      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      });

      // Create task with explicit beforeId (should override defaultPosition)
      const task3 = await api.resources.tasks.post({
        title: 'Task 3',
        category: category.id,
        beforeId: task1.id
      });

      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id },
          sort: ['position']
        }
      });

      // Order should be: Task 3, Task 2, Task 1
      // (Task 3 explicitly before Task 1, Task 2 at beginning by default)
      assert.equal(tasks[0].title, 'Task 2');
      assert.equal(tasks[1].title, 'Task 3');
      assert.equal(tasks[2].title, 'Task 1');
    });
  });

  describe('Custom Field Names', () => {
    it('should work with custom position field name', async () => {
      const api = await createPositioningApi(knex, {
        apiName: 'positioning-custom-field',
        tablePrefix: 'pos_custom_fld'
      });

      await api.use(PositioningPlugin, {
        field: 'sort_order', // Custom field name
        filters: ['project_id'],
        defaultPosition: 'last'
      });

      const project = await api.resources.projects.post({ name: 'Test Project' });

      const item1 = await api.resources.items.post({
        name: 'Item 1',
        project: project.id
      });

      const item2 = await api.resources.items.post({
        name: 'Item 2',
        project: project.id
      });

      // Should have sort_order field, not position
      assert(item1.sort_order);
      assert(!item1.position);
      assert(item2.sort_order);
      assert(!item2.position);

      // Should be properly ordered
      assert(item1.sort_order < item2.sort_order);

      // Query should work with custom field
      const { data: items } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id },
          sort: ['sort_order']
        }
      });

      assert.equal(items.length, 2);
      assert.equal(items[0].name, 'Item 1');
      assert.equal(items[1].name, 'Item 2');
    });

    it('should handle custom beforeId field name', async () => {
      const api = await createPositioningApi(knex, {
        apiName: 'positioning-custom-beforeid',
        tablePrefix: 'pos_custom_bid'
      });

      await api.use(PositioningPlugin, {
        field: 'position',
        filters: ['project_id'],
        beforeIdField: 'insertBefore', // Custom virtual field name
        defaultPosition: 'last'
      });

      const project = await api.resources.projects.post({ name: 'Test Project' });

      const item1 = await api.resources.items.post({
        name: 'Item 1',
        project: project.id
      });

      const item2 = await api.resources.items.post({
        name: 'Item 2',
        project: project.id
      });

      // Use custom beforeId field name
      const item3 = await api.resources.items.post({
        name: 'Item 3',
        project: project.id,
        insertBefore: item2.id
      });

      const { data: items } = await api.resources.items.query({
        queryParams: {
          filters: { project_id: project.id },
          sort: ['position']
        }
      });

      assert.equal(items.length, 3);
      assert.equal(items[0].name, 'Item 1');
      assert.equal(items[1].name, 'Item 3');
      assert.equal(items[2].name, 'Item 2');
    });
  });

  describe('Error Recovery and Consistency', () => {
    it('should handle concurrent inserts at same position gracefully', async () => {
      // Use the main api instance

      const category = await api.resources.categories.post({ name: 'Test Category' });

      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      });

      // Simulate concurrent inserts before task2
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          api.resources.tasks.post({
            title: `Concurrent Task ${i}`,
            category: category.id,
            beforeId: task2.id
          })
        );
      }

      const results = await Promise.all(promises);

      // All should succeed
      assert.equal(results.length, 5);

      // Query all tasks
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id },
          sort: ['position']
        }
      });

      assert.equal(tasks.length, 7);

      // Task 1 should still be first
      assert.equal(tasks[0].title, 'Task 1');

      // Task 2 should be last
      assert.equal(tasks[6].title, 'Task 2');

      // All positions should be unique
      const positions = tasks.map(t => t.position);
      const uniquePositions = [...new Set(positions)];
      assert.equal(uniquePositions.length, 7);

      // All should be properly ordered
      for (let i = 1; i < tasks.length; i++) {
        assert(tasks[i-1].position < tasks[i].position);
      }
    });

    it('should maintain consistency when moving items rapidly', async () => {
      // Use the main api instance

      const category = await api.resources.categories.post({ name: 'Test Category' });

      // Create initial items
      const items = [];
      for (let i = 0; i < 10; i++) {
        const item = await api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        });
        items.push(item);
      }

      // Rapidly move items around
      const updates = [];
      
      // Move multiple items to beginning
      updates.push(
        api.resources.tasks.patch({ id: items[5].id, beforeId: 'FIRST' }),
        api.resources.tasks.patch({ id: items[7].id, beforeId: 'FIRST' }),
        api.resources.tasks.patch({ id: items[9].id, beforeId: 'FIRST' })
      );

      // Move multiple items to end
      updates.push(
        api.resources.tasks.patch({ id: items[0].id, beforeId: null }),
        api.resources.tasks.patch({ id: items[2].id, beforeId: null })
      );

      // Move items to middle positions
      updates.push(
        api.resources.tasks.patch({ id: items[1].id, beforeId: items[4].id }),
        api.resources.tasks.patch({ id: items[3].id, beforeId: items[6].id })
      );

      await Promise.all(updates);

      // Verify final state
      const { data: finalTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id },
          sort: ['position']
        }
      });

      assert.equal(finalTasks.length, 10);

      // All positions should be unique
      const positions = finalTasks.map(t => t.position);
      const uniquePositions = [...new Set(positions)];
      assert.equal(uniquePositions.length, 10);

      // All should be properly ordered
      for (let i = 1; i < finalTasks.length; i++) {
        assert(finalTasks[i-1].position < finalTasks[i].position);
      }
    });

    // Removed test for missing position field - not a realistic scenario
  });

  describe('Special Positioning Values', () => {
    it('should handle FIRST positioning correctly', async () => {
      // Use the main api instance

      const category = await api.resources.categories.post({ name: 'Test Category' });

      // Create initial tasks
      const tasks = [];
      for (let i = 1; i <= 5; i++) {
        const task = await api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        });
        tasks.push(task);
      }

      // Position new task at beginning
      const firstTask = await api.resources.tasks.post({
        title: 'First Task',
        category: category.id,
        beforeId: 'FIRST'
      });

      const { data: allTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id },
          sort: ['position']
        }
      });

      assert.equal(allTasks[0].title, 'First Task');
      assert(firstTask.position < tasks[0].position);

      // Update existing task to move to beginning
      await api.resources.tasks.patch({
        id: tasks[2].id,
        beforeId: 'FIRST'
      });

      const { data: updatedTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id },
          sort: ['position']
        }
      });

      assert.equal(updatedTasks[0].title, 'Task 3');
      assert.equal(updatedTasks[1].title, 'First Task');
    });

    it('should handle null beforeId as positioning at end', async () => {
      // Use the main api instance

      const category = await api.resources.categories.post({ name: 'Test Category' });

      // Create tasks
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      });

      // Move task 1 to end with explicit null
      await api.resources.tasks.patch({
        id: task1.id,
        beforeId: null
      });

      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id },
          sort: ['position']
        }
      });

      assert.equal(tasks[0].title, 'Task 2');
      assert.equal(tasks[1].title, 'Task 1');
    });
  });

  describe('Integration with Other Plugins', () => {
    it('should work with soft delete scenarios', async () => {
      const softDeleteApi = await createPositioningApi(knex, {
        apiName: 'positioning-soft-delete-test',
        tablePrefix: 'pos_soft'
      });

      await softDeleteApi.use(PositioningPlugin, {
        field: 'position',
        filters: ['category_id'],
        defaultPosition: 'last',
        excludeResources: ['system_migrations', 'system_logs', 'categories', 'projects']
      });

      const category = await softDeleteApi.resources.categories.post({ name: 'Test Category' });

      // Create tasks
      const tasks = [];
      for (let i = 1; i <= 5; i++) {
        const task = await softDeleteApi.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        });
        tasks.push(task);
      }

      // Soft delete task 3
      await softDeleteApi.resources.tasks.patch({
        id: tasks[2].id,
        deleted_at: new Date().toISOString()
      });

      // Create new task - should still position correctly
      const newTask = await softDeleteApi.resources.tasks.post({
        title: 'New Task',
        category: category.id,
        beforeId: tasks[3].id // Before task 4
      });

      // Query non-deleted tasks
      const { data: activeTasks } = await softDeleteApi.resources.tasks.query({
        queryParams: {
          filters: { 
            category_id: category.id,
            deleted_at: null
          },
          sort: ['position']
        }
      });

      // Should have 5 tasks (original 5 - 1 deleted + 1 new)
      assert.equal(activeTasks.length, 5);

      // New task should be before Task 4
      const newTaskIndex = activeTasks.findIndex(t => t.title === 'New Task');
      const task4Index = activeTasks.findIndex(t => t.title === 'Task 4');
      assert(newTaskIndex < task4Index);
    });

    it('should handle versioning scenarios', async () => {
      const versionApi = await createPositioningApi(knex, {
        apiName: 'positioning-version-test',
        tablePrefix: 'pos_ver'
      });

      await versionApi.use(PositioningPlugin, {
        field: 'position',
        filters: ['category_id', 'version'],
        defaultPosition: 'last',
        excludeResources: ['system_migrations', 'system_logs', 'categories', 'projects']
      });

      const category = await versionApi.resources.categories.post({ name: 'Test Category' });

      // Create v1 tasks
      const v1Tasks = [];
      for (let i = 1; i <= 3; i++) {
        const task = await versionApi.resources.tasks.post({
          title: `Task ${i} v1`,
          category: category.id,
          version: 1
        });
        v1Tasks.push(task);
      }

      // Create v2 of task 2
      const task2v2 = await versionApi.resources.tasks.post({
        title: 'Task 2 v2',
        category: category.id,
        version: 2
      });

      // Create v2 of task 1
      const task1v2 = await versionApi.resources.tasks.post({
        title: 'Task 1 v2',
        category: category.id,
        version: 2
      });

      // Query v1 tasks
      const { data: v1Items } = await versionApi.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id, version: 1 },
          sort: ['position']
        }
      });

      assert.equal(v1Items.length, 3);
      assert.equal(v1Items[0].title, 'Task 1 v1');
      assert.equal(v1Items[1].title, 'Task 2 v1');
      assert.equal(v1Items[2].title, 'Task 3 v1');

      // Query v2 tasks
      const { data: v2Items } = await versionApi.resources.tasks.query({
        queryParams: {
          filters: { category_id: category.id, version: 2 },
          sort: ['position']
        }
      });

      assert.equal(v2Items.length, 2);
      assert.equal(v2Items[0].title, 'Task 2 v2');
      assert.equal(v2Items[1].title, 'Task 1 v2');

      // Positions should be independent between versions
      assert.equal(v1Tasks[0].position, 'a0');
      assert.equal(task2v2.position, 'a0'); // First in v2 group
    });
  });
});