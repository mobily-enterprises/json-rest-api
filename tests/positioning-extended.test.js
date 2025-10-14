import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { cleanTables } from './helpers/test-utils.js'
import { createPositioningApi } from './fixtures/api-configs.js'
import { PositioningPlugin } from '../plugins/core/rest-api-positioning-plugin.js'

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

// API instance that persists across tests
let api

describe('Extended Positioning Plugin Tests', { timeout: 30000 }, () => {
  before(async () => {
    // Initialize API once
    api = await createPositioningApi(knex)

    // Install positioning plugin with default configuration
    await api.use(PositioningPlugin, {
      field: 'position',
      filters: ['category'],
      defaultPosition: 'last',
      autoIndex: true
    })
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'positioning_categories',
      'positioning_tasks',
      'positioning_projects',
      'positioning_items'
    ])
  })

  describe('Edge Cases for Positioning', () => {
    it('should handle positioning multiple items before the same target in sequence', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create initial task
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      })

      // Position multiple tasks before task1
      const taskA = await api.resources.tasks.post({
        title: 'Task A',
        category: category.id,
        beforeId: task1.id
      })

      const taskB = await api.resources.tasks.post({
        title: 'Task B',
        category: category.id,
        beforeId: task1.id
      })

      const taskC = await api.resources.tasks.post({
        title: 'Task C',
        category: category.id,
        beforeId: task1.id
      })

      // Query and verify order
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      // Should be: A, B, C, 1 (in creation order when positioned before same target)
      assert.equal(tasks.length, 4)
      assert.equal(tasks[0].title, 'Task A')
      assert.equal(tasks[1].title, 'Task B')
      assert.equal(tasks[2].title, 'Task C')
      assert.equal(tasks[3].title, 'Task 1')

      // Verify positions are unique
      const positions = tasks.map(t => t.position)
      const uniquePositions = [...new Set(positions)]
      assert.equal(uniquePositions.length, 4, 'All positions should be unique')
    })

    it('should handle positioning between very close positions', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create initial tasks
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      })

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      })

      // Insert many tasks between 1 and 2
      const insertedTasks = []
      for (let i = 0; i < 10; i++) {
        const task = await api.resources.tasks.post({
          title: `Inserted Task ${i}`,
          category: category.id,
          beforeId: task2.id
        })
        insertedTasks.push(task)
      }

      // Query and verify all are properly ordered
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      assert.equal(tasks.length, 12)

      // Verify positions are in correct order
      for (let i = 1; i < tasks.length; i++) {
        assert(tasks[i - 1].position < tasks[i].position,
          `Task ${tasks[i - 1].title} should come before ${tasks[i].title}`)
      }
    })

    it('should handle beforeId pointing to non-existent item in same category', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      })

      // Create task with non-existent beforeId
      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id,
        beforeId: '99999'
      })

      // Should position at end since beforeId doesn't exist
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      assert.equal(tasks.length, 2)
      assert.equal(tasks[0].title, 'Task 1')
      assert.equal(tasks[1].title, 'Task 2')
    })

    it('should handle beforeId from different category', async () => {
      const category1 = await api.resources.categories.post({ name: 'Category 1' })
      const category2 = await api.resources.categories.post({ name: 'Category 2' })

      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category1.id
      })

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category2.id,
        beforeId: task1.id // Task from different category
      })

      // Task 2 should be positioned normally in its category (ignoring beforeId from other category)
      const { data: cat2Tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category2.id },
          sort: ['position']
        }
      })

      assert.equal(cat2Tasks.length, 1)
      assert.equal(cat2Tasks[0].title, 'Task 2')
      assert(cat2Tasks[0].position) // Should have a position
    })
  })

  describe('Complex Update Scenarios', () => {
    it('should handle moving items multiple times', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create initial tasks
      const tasks = []
      for (let i = 1; i <= 5; i++) {
        const task = await api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        })
        tasks.push(task)
      }

      // Move task 5 before task 3
      await api.resources.tasks.patch({
        id: tasks[4].id,
        beforeId: tasks[2].id
      })

      // Move task 1 to the end
      await api.resources.tasks.patch({
        id: tasks[0].id,
        beforeId: null
      })

      // Move task 3 to the beginning
      await api.resources.tasks.patch({
        id: tasks[2].id,
        beforeId: 'FIRST'
      })

      // Query final order
      const { data: finalTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      // Expected order: 3, 2, 5, 4, 1
      assert.equal(finalTasks[0].title, 'Task 3')
      assert.equal(finalTasks[1].title, 'Task 2')
      assert.equal(finalTasks[2].title, 'Task 5')
      assert.equal(finalTasks[3].title, 'Task 4')
      assert.equal(finalTasks[4].title, 'Task 1')
    })

    it('should handle category changes with positioning', async () => {
      const category1 = await api.resources.categories.post({ name: 'Category 1' })
      const category2 = await api.resources.categories.post({ name: 'Category 2' })

      // Create tasks in category 1
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category1.id
      })

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category1.id
      })

      // Create tasks in category 2
      const task3 = await api.resources.tasks.post({
        title: 'Task 3',
        category: category2.id
      })

      // Move task 1 to category 2, positioning it before task 3
      await api.resources.tasks.patch({
        id: task1.id,
        category: category2.id,
        beforeId: task3.id
      })

      // Verify category 1 only has task 2
      const { data: cat1Tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category1.id },
          sort: ['position']
        }
      })

      assert.equal(cat1Tasks.length, 1)
      assert.equal(cat1Tasks[0].title, 'Task 2')

      // Verify category 2 has tasks in correct order
      const { data: cat2Tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category2.id },
          sort: ['position']
        }
      })

      assert.equal(cat2Tasks.length, 2)
      assert.equal(cat2Tasks[0].title, 'Task 1')
      assert.equal(cat2Tasks[1].title, 'Task 3')
    })

    it('should maintain position when updating other fields', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create tasks
      const tasks = []
      for (let i = 1; i <= 3; i++) {
        const task = await api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        })
        tasks.push(task)
      }

      // Update title without beforeId
      const originalPosition = tasks[1].position
      await api.resources.tasks.patch({
        id: tasks[1].id,
        title: 'Updated Task 2'
      })

      // Get updated task
      const updatedTask = await api.resources.tasks.get({ id: tasks[1].id })

      assert.equal(updatedTask.title, 'Updated Task 2')
      assert.equal(updatedTask.position, originalPosition, 'Position should not change')

      // Verify order is maintained
      const { data: allTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      assert.equal(allTasks[0].title, 'Task 1')
      assert.equal(allTasks[1].title, 'Updated Task 2')
      assert.equal(allTasks[2].title, 'Task 3')
    })
  })

  describe('Bulk Operations', () => {
    it('should handle bulk creation with positioning', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create initial task
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      })

      // Create multiple tasks in parallel (simulating bulk creation)
      const promises = []
      for (let i = 2; i <= 10; i++) {
        promises.push(api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        }))
      }

      await Promise.all(promises)

      // Query all tasks
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      assert.equal(tasks.length, 10)

      // Verify all have unique positions
      const positions = tasks.map(t => t.position)
      const uniquePositions = [...new Set(positions)]
      assert.equal(uniquePositions.length, 10, 'All positions should be unique')

      // Verify they're in order
      for (let i = 1; i < tasks.length; i++) {
        assert(tasks[i - 1].position < tasks[i].position)
      }
    })

    it('should handle bulk positioning before same target', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create initial tasks
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      })

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      })

      // Create multiple tasks before task2 in parallel
      const promises = []
      for (let i = 1; i <= 5; i++) {
        promises.push(api.resources.tasks.post({
          title: `Inserted Task ${i}`,
          category: category.id,
          beforeId: task2.id
        }))
      }

      await Promise.all(promises)

      // Query all tasks
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      assert.equal(tasks.length, 7)

      // Task 1 should still be first
      assert.equal(tasks[0].title, 'Task 1')

      // All inserted tasks should come before Task 2
      const task2Index = tasks.findIndex(t => t.title === 'Task 2')
      assert.equal(task2Index, 6, 'Task 2 should be last')

      // All positions should be unique
      const positions = tasks.map(t => t.position)
      const uniquePositions = [...new Set(positions)]
      assert.equal(uniquePositions.length, 7, 'All positions should be unique')
    })
  })

  describe('Query and Filtering', () => {
    it('should sort correctly with mixed position values', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create tasks in random order
      const taskC = await api.resources.tasks.post({
        title: 'Task C',
        category: category.id
      })

      const taskA = await api.resources.tasks.post({
        title: 'Task A',
        category: category.id,
        beforeId: taskC.id
      })

      const taskE = await api.resources.tasks.post({
        title: 'Task E',
        category: category.id
      })

      const taskB = await api.resources.tasks.post({
        title: 'Task B',
        category: category.id,
        beforeId: taskC.id
      })

      const taskD = await api.resources.tasks.post({
        title: 'Task D',
        category: category.id,
        beforeId: taskE.id
      })

      // Query with ascending sort
      const { data: ascTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      // Should be alphabetical: A, B, C, D, E
      assert.equal(ascTasks.map(t => t.title).join(','), 'Task A,Task B,Task C,Task D,Task E')

      // Query with descending sort
      const { data: descTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['-position']
        }
      })

      // Should be reverse: E, D, C, B, A
      assert.equal(descTasks.map(t => t.title).join(','), 'Task E,Task D,Task C,Task B,Task A')
    })

    it('should handle pagination with position sorting', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create 20 tasks
      for (let i = 1; i <= 20; i++) {
        await api.resources.tasks.post({
          title: `Task ${i.toString().padStart(2, '0')}`,
          category: category.id
        })
      }

      // Query first page
      const { data: page1 } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position'],
          page: { size: 5, number: 1 }
        }
      })

      assert.equal(page1.length, 5)
      assert.equal(page1[0].title, 'Task 01')
      assert.equal(page1[4].title, 'Task 05')

      // Query second page
      const { data: page2 } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position'],
          page: { size: 5, number: 2 }
        }
      })

      assert.equal(page2.length, 5)
      assert.equal(page2[0].title, 'Task 06')
      assert.equal(page2[4].title, 'Task 10')

      // Verify no overlap and correct ordering
      assert(page1[4].position < page2[0].position)
    })

    it('should combine position sort with other sorts', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create tasks with same titles
      const positions = []
      for (let i = 0; i < 3; i++) {
        const task = await api.resources.tasks.post({
          title: 'Task A',
          category: category.id
        })
        positions.push(task)
      }

      for (let i = 0; i < 3; i++) {
        const task = await api.resources.tasks.post({
          title: 'Task B',
          category: category.id
        })
        positions.push(task)
      }

      // Sort by title then position
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['title', 'position']
        }
      })

      // First 3 should be Task A, last 3 should be Task B
      assert.equal(tasks.slice(0, 3).every(t => t.title === 'Task A'), true)
      assert.equal(tasks.slice(3, 6).every(t => t.title === 'Task B'), true)

      // Within each group, should be sorted by position
      for (let i = 1; i < 3; i++) {
        assert(tasks[i - 1].position < tasks[i].position)
        assert(tasks[i + 2].position < tasks[i + 3].position)
      }
    })
  })

  describe('Special Characters and Extreme Values', () => {
    it('should handle special position values correctly', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create many tasks to test various position values
      const tasks = []
      for (let i = 0; i < 50; i++) {
        const task = await api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        })
        tasks.push(task)
      }

      // Insert tasks between existing ones
      for (let i = 0; i < 10; i++) {
        await api.resources.tasks.post({
          title: `Inserted ${i}`,
          category: category.id,
          beforeId: tasks[i * 5].id
        })
      }

      // Query all and verify ordering
      const { data: allTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position'],
          page: { size: 100 }
        }
      })

      assert.equal(allTasks.length, 60)

      // Verify all positions are valid strings
      for (const task of allTasks) {
        assert.equal(typeof task.position, 'string')
        assert(task.position.length > 0)
        // Fractional indexing uses alphanumeric characters
        assert.match(task.position, /^[a-zA-Z0-9]+$/)
      }

      // Verify ordering
      for (let i = 1; i < allTasks.length; i++) {
        assert(allTasks[i - 1].position < allTasks[i].position)
      }
    })

    it('should handle rapid position updates', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create initial tasks
      const tasks = []
      for (let i = 0; i < 10; i++) {
        const task = await api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        })
        tasks.push(task)
      }

      // Rapidly move last task to different positions
      const lastTask = tasks[9]

      // Move to beginning
      await api.resources.tasks.patch({
        id: lastTask.id,
        beforeId: tasks[0].id
      })

      // Move to middle
      await api.resources.tasks.patch({
        id: lastTask.id,
        beforeId: tasks[5].id
      })

      // Move to near end
      await api.resources.tasks.patch({
        id: lastTask.id,
        beforeId: tasks[8].id
      })

      // Move back to beginning
      await api.resources.tasks.patch({
        id: lastTask.id,
        beforeId: 'FIRST'
      })

      // Verify final state
      const { data: finalTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      assert.equal(finalTasks[0].title, 'Task 9')

      // Verify all positions are still unique and ordered
      const positions = finalTasks.map(t => t.position)
      const uniquePositions = [...new Set(positions)]
      assert.equal(uniquePositions.length, 10)

      for (let i = 1; i < finalTasks.length; i++) {
        assert(finalTasks[i - 1].position < finalTasks[i].position)
      }
    })
  })

  describe('Null and Empty Filter Values', () => {
    it('should handle tasks with null category separately', async () => {
      // Create tasks with categories
      const category = await api.resources.categories.post({ name: 'Test Category' })

      const taskWithCat1 = await api.resources.tasks.post({
        title: 'Task with Category 1',
        category: category.id
      })

      const taskWithCat2 = await api.resources.tasks.post({
        title: 'Task with Category 2',
        category: category.id
      })

      // Create tasks without category - don't send category_id at all for null
      const taskNoCat1 = await api.resources.tasks.post({
        title: 'Task without Category 1'
      })

      const taskNoCat2 = await api.resources.tasks.post({
        title: 'Task without Category 2'
      })

      const taskNoCat3 = await api.resources.tasks.post({
        title: 'Task without Category 3',
        beforeId: taskNoCat1.id
      })

      // Query tasks with category
      const { data: tasksWithCat } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      assert.equal(tasksWithCat.length, 2)
      assert(tasksWithCat[0].position < tasksWithCat[1].position)

      // Query tasks without category
      const { data: tasksNoCat } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: null },
          sort: ['position']
        }
      })

      // Debug: Check what we actually have
      const { data: allTasks } = await api.resources.tasks.query({
        queryParams: {
          sort: ['position']
        }
      })
      console.log('All tasks:', allTasks.map(t => ({ title: t.title, category: t.category_id })))
      console.log('Tasks with null category:', tasksNoCat.length)

      // Try querying without filter
      const { data: tasksNoFilter } = await api.resources.tasks.query({
        queryParams: {
          sort: ['position']
        }
      })
      const actualNullCategoryTasks = tasksNoFilter.filter(t => t.category_id === null || t.category_id === undefined)
      console.log('Actual tasks without category:', actualNullCategoryTasks.length)

      assert.equal(tasksNoCat.length, 3)
      assert.equal(tasksNoCat[0].title, 'Task without Category 3') // Positioned before 1
      assert.equal(tasksNoCat[1].title, 'Task without Category 1')
      assert.equal(tasksNoCat[2].title, 'Task without Category 2')
    })
  })

  describe('Position Field Validation', () => {
    it('should ignore manually set position values', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Try to set position manually on create
      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id,
        position: 'ZZZZ' // Should be ignored
      })

      assert.notEqual(task1.position, 'ZZZZ')
      assert.equal(task1.position, 'a0') // First item gets 'a0'

      // Try to set position manually on update
      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      })

      const originalPosition = task2.position

      await api.resources.tasks.patch({
        id: task2.id,
        position: 'AAAA' // Should be ignored
      })

      const updated = await api.resources.tasks.get({ id: task2.id })
      assert.equal(updated.position, originalPosition) // Position unchanged
    })

    it('should handle both position and beforeId in update', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      const task1 = await api.resources.tasks.post({
        title: 'Task 1',
        category: category.id
      })

      const task2 = await api.resources.tasks.post({
        title: 'Task 2',
        category: category.id
      })

      const task3 = await api.resources.tasks.post({
        title: 'Task 3',
        category: category.id
      })

      // Update with both position (ignored) and beforeId (used)
      await api.resources.tasks.patch({
        id: task3.id,
        position: 'XXXX', // Should be ignored
        beforeId: task1.id // Should be used
      })

      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      // Task 3 should now be before Task 1
      assert.equal(tasks[0].title, 'Task 3')
      assert.equal(tasks[1].title, 'Task 1')
      assert.equal(tasks[2].title, 'Task 2')
      assert.notEqual(tasks[0].position, 'XXXX')
    })
  })

  describe('Performance and Stress Tests', () => {
    it('should handle large number of tasks efficiently', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create 100 tasks
      for (let i = 0; i < 100; i++) {
        await api.resources.tasks.post({
          title: `Task ${i.toString().padStart(3, '0')}`,
          category: category.id
        })
      }

      // Query with position sort
      const { data: tasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position'],
          page: { size: 100 }
        }
      })

      assert.equal(tasks.length, 100)

      // Verify all are in correct order
      for (let i = 0; i < tasks.length; i++) {
        assert.equal(tasks[i].title, `Task ${i.toString().padStart(3, '0')}`)
      }

      // Insert task in the middle
      const middleTask = await api.resources.tasks.post({
        title: 'Middle Task',
        category: category.id,
        beforeId: tasks[50].id
      })

      // Verify it's positioned correctly
      const { data: updatedTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position'],
          page: { size: 102 }
        }
      })

      const middleIndex = updatedTasks.findIndex(t => t.title === 'Middle Task')
      assert.equal(middleIndex, 50)
      assert(updatedTasks[49].position < middleTask.position)
      assert(middleTask.position < updatedTasks[51].position)
    })

    it('should maintain consistency under concurrent updates', async () => {
      const category = await api.resources.categories.post({ name: 'Test Category' })

      // Create initial tasks
      const tasks = []
      for (let i = 0; i < 20; i++) {
        const task = await api.resources.tasks.post({
          title: `Task ${i}`,
          category: category.id
        })
        tasks.push(task)
      }

      // Perform concurrent position updates
      const updates = [
        api.resources.tasks.patch({ id: tasks[5].id, beforeId: tasks[0].id }),
        api.resources.tasks.patch({ id: tasks[10].id, beforeId: tasks[0].id }),
        api.resources.tasks.patch({ id: tasks[15].id, beforeId: tasks[0].id }),
        api.resources.tasks.patch({ id: tasks[19].id, beforeId: 'FIRST' }),
        api.resources.tasks.patch({ id: tasks[1].id, beforeId: null }) // Move to end
      ]

      await Promise.all(updates)

      // Verify final state
      const { data: finalTasks } = await api.resources.tasks.query({
        queryParams: {
          filters: { category: category.id },
          sort: ['position']
        }
      })

      // All tasks should still exist
      assert.equal(finalTasks.length, 20)

      // All positions should be unique
      const positions = finalTasks.map(t => t.position)
      const uniquePositions = [...new Set(positions)]
      assert.equal(uniquePositions.length, 20)

      // Verify ordering is consistent
      for (let i = 1; i < finalTasks.length; i++) {
        assert(finalTasks[i - 1].position < finalTasks[i].position)
      }
    })
  })
})
