import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { cleanTables } from './helpers/test-utils.js';
import { createPositioningApi } from './fixtures/api-configs.js';
import { PositioningPlugin } from '../plugins/core/rest-api-positioning-plugin.js';

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance that persists across tests
let api;

describe('Positioning Plugin Tests', { timeout: 30000 }, () => {
  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Initialize API once
    api = await createPositioningApi(knex);
    
    // Install positioning plugin with default configuration
    await api.use(PositioningPlugin, {
      field: 'position',
      filters: ['category'], // Tasks will be grouped by category
      defaultPosition: 'last',
      autoIndex: true
    });
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
      'positioning_categories',
      'positioning_tasks',
      'positioning_projects',
      'positioning_items'
    ]);
  });

  describe('Basic Positioning', () => {
     it('should add position field to first item automatically', async () => {
      // Create a category first
      const category = await api.resources.categories.post({
        name: 'Work Tasks'
      });
      
      // Create first task
      const result = await api.resources.tasks.post({
        title: 'First Task',
        category: category.id
      });
      
      assert.equal(result.title, 'First Task');
      // Should have position assigned
      assert(result.position, 'Position should be assigned');
      assert.equal(typeof result.position, 'string');
    });
    
     it('should position items at the end by default', async () => {
      // Create a category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create multiple tasks
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
      
      // Verify positions are in order
      const pos1 = task1.position;
      const pos2 = task2.position;
      const pos3 = task3.position;
      
      assert(pos1 < pos2, 'Task 1 should be before Task 2');
      assert(pos2 < pos3, 'Task 2 should be before Task 3');
    });
    
     it('should maintain separate position sequences per filter group', async () => {
      // Create two categories
      const category1 = await api.resources.categories.post({ name: 'Category 1' });
      const category2 = await api.resources.categories.post({ name: 'Category 2' });
      
      // Create tasks in different categories
      const task1Cat1 = await api.resources.tasks.post({
        title: 'Cat1 Task 1',
        category: category1.id
      });
      
      const task1Cat2 = await api.resources.tasks.post({
        title: 'Cat2 Task 1',
        category: category2.id
      });
      
      const task2Cat1 = await api.resources.tasks.post({
        title: 'Cat1 Task 2',
        category: category1.id
      });
      
      // Positions should be independent per category
      assert(task1Cat1.position);
      assert(task1Cat2.position);
      assert(task2Cat1.position);
      
      // Task 2 in category 1 should be after task 1 in category 1
      assert(task1Cat1.position < task2Cat1.position);
      
      // But positions in different categories can be similar
      // (they're independent sequences)
    });
  });

  describe('Positioning with beforeId', () => {
     it('should position item before specified id', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create initial tasks
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });
      
      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      });
      
      // Create task that should go between 1 and 2
      const taskMiddle = await api.resources.tasks.post({
        title: 'Middle Task',
        category: category.id,
        beforeId: task2.id
      });
      
      // Verify positioning
      const pos1 = task1.position;
      const posMiddle = taskMiddle.position;
      const pos2 = task2.position;
      
      assert(pos1 < posMiddle, 'Task 1 should be before Middle Task');
      assert(posMiddle < pos2, 'Middle Task should be before Task 2');
    });
    
     it('should position at beginning when beforeId is first item', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create initial tasks
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });
      
      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      });
      
      // Create task at beginning
      const taskFirst = await api.resources.tasks.post({
        title: 'First Task',
        category: category.id,
        beforeId: task1.id
      });
      
      // Verify it's first
      const posFirst = taskFirst.position;
      const pos1 = task1.position;
      const pos2 = task2.position;
      
      assert(posFirst < pos1, 'First Task should be before Task 1');
      assert(pos1 < pos2, 'Task 1 should be before Task 2');
    });
  });

  describe('Position Updates', () => {
     it('should reposition item when updated with beforeId', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create three tasks
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
      
      // Move task 3 before task 2
      const updated = await api.resources.tasks.patch({
        id: task3.id,
        beforeId: task2.id
      });
      
      // Get fresh data
      const { data: allTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      });
      
      // Verify order is now: Task 1, Task 3, Task 2
      assert.equal(allTasks[0].title, 'Task 1');
      assert.equal(allTasks[1].title, 'Task 3');
      assert.equal(allTasks[2].title, 'Task 2');
    });
    
     it('should maintain position when updating without beforeId', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create task
      const task = await api.resources.tasks.post({
        title: 'Original Title',
        category: category.id
      });
      
      const originalPosition = task.position;
      
      // Update title without beforeId
      const updated = await api.resources.tasks.patch({
        id: task.id,
        title: 'Updated Title'
      });
      
      // Position should remain the same
      assert.equal(updated.position, originalPosition);
      assert.equal(updated.title, 'Updated Title');
    });
  });

  describe('Manual Position Override', () => {
     it('should ignore manual position setting', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create task with manual position attempt
      const task = await api.resources.tasks.post({
        title: 'Manual Position Task',
        category: category.id,
        position: 'zzz' // Manual position should be ignored
      });
      
      // Position should be automatically assigned, not 'zzz'
      assert.notEqual(task.position, 'zzz');
      assert(task.position); // Should have a position
      assert.equal(task.position, 'a0'); // First item gets 'a0'
    });
    
     it('should ignore manual position and use beforeId', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create initial task
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });
      
      // Create task with both manual position and beforeId
      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id,
        position: 'zzz', // Should be ignored
        beforeId: task1.id // Should be used
      });
      
      // Manual position should be ignored, beforeId should work
      assert.notEqual(task2.position, 'zzz');
      assert(task2.position < task1.position); // Should be positioned before task1
    });
  });

  describe('Position Configuration', () => {
     it('should handle different field name configuration', async () => {
      // Create a new API with different position field name
      const customApi = await createPositioningApi(knex, {
        apiName: 'positioning-custom-field-test',
        tablePrefix: 'pos_custom'
      });
      
      await customApi.use(PositioningPlugin, {
        field: 'sort_order', // Different field name
        filters: ['project'],
        defaultPosition: 'last'
      });
      
      // Create project
      const project = await customApi.resources.projects.post({ name: 'Test Project' });
      
      // Create item
      const item = await customApi.resources.items.post({
        name: 'Test Item',
        project: project.id
      });
      
      // Should have sort_order field, not position
      assert(item.sort_order, 'Should have sort_order field');
      assert(!item.position, 'Should not have position field');
    });
    
     it('should handle multiple filter fields', async () => {
      // Create a new API with multiple filters
      const multiFilterApi = await createPositioningApi(knex, {
        apiName: 'positioning-multi-filter-test',
        tablePrefix: 'pos_multi'
      });
      
      await multiFilterApi.use(PositioningPlugin, {
        field: 'position',
        filters: ['project', 'status'], // Multiple filters
        defaultPosition: 'last'
      });
      
      // Create project
      const project = await multiFilterApi.resources.projects.post({ name: 'Multi Filter Project' });
      
      // Create items with different statuses
      const item1Active = await multiFilterApi.resources.items.post({
        name: 'Active Item 1',
        project: project.id,
        status: 'active'
      });
      
      const item2Active = await multiFilterApi.resources.items.post({
        name: 'Active Item 2',
        project: project.id,
        status: 'active'
      });
      
      const item1Archived = await multiFilterApi.resources.items.post({
        name: 'Archived Item 1',
        project: project.id,
        status: 'archived'
      });
      
      // Active items should be in sequence
      assert(item1Active.position < item2Active.position);
      
      // Archived item should have its own sequence
      // (its position might be similar to active item 1, but they're in different groups)
    });
    
     it('should handle defaultPosition first configuration', async () => {
      // Create API with defaultPosition: 'first'
      const firstApi = await createPositioningApi(knex, {
        apiName: 'positioning-first-test',
        tablePrefix: 'pos_first'
      });
      
      await firstApi.use(PositioningPlugin, {
        field: 'position',
        filters: ['category'],
        defaultPosition: 'first' // Items go to beginning by default
      });
      
      // Create category
      const category = await firstApi.resources.categories.post({ name: 'First Default Category' });
      
      // Create tasks - they should be added at the beginning
      const task1 = await firstApi.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      });
      
      const task2 = await firstApi.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      });
      
      const task3 = await firstApi.resources.tasks.post({
        title: 'Task 3',
        category: category.id
      });
      
      // With defaultPosition: 'first', the order should be reversed
      // Task 3 should be first, then Task 2, then Task 1
      assert(task3.position < task2.position);
      assert(task2.position < task1.position);
    });
  });

  describe('Error Handling', () => {
     it('should handle invalid beforeId gracefully', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Test Category' });
      
      // Create task with non-existent beforeId
      const task = await api.resources.tasks.post({
        title: 'Task with Invalid BeforeId',
        category: category.id,
        beforeId: '99999' // Non-existent ID
      });
      
      // Should still create the task (positioned at end)
      assert(task.position);
      assert.equal(task.title, 'Task with Invalid BeforeId');
    });
    
     it('should handle null filter values', async () => {
      // Create task without category (null filter)
      const task = await api.resources.tasks.post({
        title: 'Task without Category',
        category: null
      });
      
      // Should still get position
      assert(task.position);
      
      // Create another task without category
      const task2 = await api.resources.tasks.post({
        title: 'Another Task without Category',
        category: null
      });
      
      // They should be in sequence
      assert(task.position < task2.position);
    });
  });

  describe('Excluded Resources', () => {
     it('should not add positioning to excluded resources', async () => {
      // Create API with excluded resources
      const excludeApi = await createPositioningApi(knex, {
        apiName: 'positioning-exclude-test',
        tablePrefix: 'pos_exclude'
      });
      
      await excludeApi.use(PositioningPlugin, {
        field: 'position',
        filters: [],
        excludeResources: ['categories'] // Exclude categories from positioning
      });
      
      // Create category - should not have position
      const category = await excludeApi.resources.categories.post({ name: 'Excluded Category' });
      
      assert(!category.position, 'Category should not have position');
      
      // Create task - should have position
      const task = await excludeApi.resources.tasks.post({
        title: 'Task with Position',
        category: category.id
      });
      
      assert(task.position, 'Task should have position');
    });
  });

  describe('Simplified API Mode', () => {
     it('should handle positioning in simplified mode', async () => {
      // We're already using simplified mode throughout these tests!
      // This test just verifies it works as expected
      
      // Create category
      const category = await api.resources.categories.post({ name: 'Simplified Category' });
      
      // Create tasks in simplified mode
      const task1 = await api.resources.tasks.post({
        title: 'Simplified Task 1',
        category: category.id
      });
      
      const task2 = await api.resources.tasks.post({
        title: 'Simplified Task 2',
        category: category.id,
        beforeId: task1.id
      });
      
      // Verify positioning
      assert(task1.position, 'Task 1 should have position');
      assert(task2.position, 'Task 2 should have position');
      assert(task2.position < task1.position, 'Task 2 should be before Task 1');
    });
  });

  describe('Query Ordering', () => {
     it('should allow sorting by position field', async () => {
      // Create category
      const category = await api.resources.categories.post({ name: 'Sort Test Category' });
      
      // Create tasks in specific order
      const taskC = await api.resources.tasks.post({
        title: 'C Task',
        category: category.id
      });
      
      const taskA = await api.resources.tasks.post({
        title: 'A Task',
        category: category.id,
        beforeId: taskC.id
      });
      
      const taskB = await api.resources.tasks.post({
        title: 'B Task',
        category: category.id,
        beforeId: taskC.id
      });
      
      // Query with position sort
      const { data: sorted } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      });
      
      // Should be in position order: A, B, C
      // Note: When both A and B are positioned before C, they maintain creation order
      assert.equal(sorted.length, 3);
      assert.equal(sorted[0].title, 'A Task');
      assert.equal(sorted[1].title, 'B Task');
      assert.equal(sorted[2].title, 'C Task');
      
      // Query with reverse position sort
      const { data: reverseSorted } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['-position']
        }
      });
      
      // Should be in reverse order: C, B, A
      assert.equal(reverseSorted[0].title, 'C Task');
      assert.equal(reverseSorted[1].title, 'B Task');
      assert.equal(reverseSorted[2].title, 'A Task');
    });
  });
});