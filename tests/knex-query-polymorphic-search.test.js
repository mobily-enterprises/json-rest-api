import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

describe('Polymorphic Relationships - Search Support', () => {
  let api;
  let db;
  
  beforeEach(async () => {
    // Reset the global registry to avoid conflicts between tests
    resetGlobalRegistryForTesting();
    
    // Create in-memory SQLite database for testing
    db = knex({
      client: 'sqlite3',
      connection: {
        filename: ':memory:'
      },
      useNullAsDefault: true
    });
    
    // Create API instance
    api = new Api({
      name: 'test-api',
      version: '1.0.0'
    });
    
    // Install plugins
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      pageSize: 10,
      maxPageSize: 50
    });
    
    await api.use(RestApiKnexPlugin, {
      knex: db
    });
    
    // Create test tables
    await db.schema.createTable('users', table => {
      table.increments('id');
      table.string('name');
      table.string('email');
      table.string('role');
    });
    
    await db.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.text('body');
      table.integer('author_id');
      table.string('status');
    });
    
    await db.schema.createTable('videos', table => {
      table.increments('id');
      table.string('title');
      table.string('url');
      table.integer('creator_id');
      table.string('status');
    });
    
    await db.schema.createTable('courses', table => {
      table.increments('id');
      table.string('name');
      table.text('description');
      table.integer('instructor_id');
      table.string('level');
    });
    
    await db.schema.createTable('activities', table => {
      table.increments('id');
      table.string('action');
      table.string('trackable_type');
      table.integer('trackable_id');
      table.integer('user_id');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    
    await db.schema.createTable('tags', table => {
      table.increments('id');
      table.string('name');
      table.string('taggable_type');
      table.integer('taggable_id');
    });
    
    // Insert test data
    await db('users').insert([
      { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'author' },
      { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'creator' },
      { id: 3, name: 'Charlie Davis', email: 'charlie@example.com', role: 'instructor' }
    ]);
    
    await db('articles').insert([
      { id: 1, title: 'JavaScript Advanced Tips', body: 'Advanced content...', author_id: 1, status: 'published' },
      { id: 2, title: 'REST API Best Practices', body: 'API design patterns...', author_id: 1, status: 'draft' },
      { id: 3, title: 'Database Optimization', body: 'Query optimization...', author_id: 2, status: 'published' }
    ]);
    
    await db('videos').insert([
      { id: 1, title: 'JavaScript Tutorial', url: 'https://example.com/js', creator_id: 2, status: 'published' },
      { id: 2, title: 'Advanced React Patterns', url: 'https://example.com/react', creator_id: 2, status: 'published' },
      { id: 3, title: 'Node.js Basics', url: 'https://example.com/node', creator_id: 1, status: 'draft' }
    ]);
    
    await db('courses').insert([
      { id: 1, name: 'Full Stack JavaScript', description: 'Complete JS course', instructor_id: 3, level: 'advanced' },
      { id: 2, name: 'Introduction to Programming', description: 'Beginner friendly', instructor_id: 3, level: 'beginner' }
    ]);
    
    await db('activities').insert([
      { id: 1, action: 'created', trackable_type: 'articles', trackable_id: 1, user_id: 1 },
      { id: 2, action: 'updated', trackable_type: 'articles', trackable_id: 1, user_id: 1 },
      { id: 3, action: 'created', trackable_type: 'videos', trackable_id: 1, user_id: 2 },
      { id: 4, action: 'published', trackable_type: 'videos', trackable_id: 1, user_id: 2 },
      { id: 5, action: 'created', trackable_type: 'courses', trackable_id: 1, user_id: 3 },
      { id: 6, action: 'updated', trackable_type: 'articles', trackable_id: 2, user_id: 1 },
      { id: 7, action: 'created', trackable_type: 'videos', trackable_id: 2, user_id: 2 } // For "Advanced React Patterns"
    ]);
    
    await db('tags').insert([
      { id: 1, name: 'javascript', taggable_type: 'articles', taggable_id: 1 },
      { id: 2, name: 'advanced', taggable_type: 'articles', taggable_id: 1 },
      { id: 3, name: 'javascript', taggable_type: 'videos', taggable_id: 1 },
      { id: 4, name: 'tutorial', taggable_type: 'videos', taggable_id: 1 },
      { id: 5, name: 'javascript', taggable_type: 'courses', taggable_id: 1 },
      { id: 6, name: 'api', taggable_type: 'articles', taggable_id: 2 }
    ]);
    
    // Define schemas with search support
    const usersSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      role: { type: 'string' }
    };
    
    const articlesSchema = {
      id: { type: 'id' },
      title: { type: 'string', required: true },
      body: { type: 'string' },
      author_id: { 
        type: 'number',
        belongsTo: 'users',
        as: 'author'
      },
      status: { type: 'string' }
    };
    
    const videosSchema = {
      id: { type: 'id' },
      title: { type: 'string', required: true },
      url: { type: 'string', required: true },
      creator_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'creator'
      },
      status: { type: 'string' }
    };
    
    const coursesSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      description: { type: 'string' },
      instructor_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'instructor'
      },
      level: { type: 'string' }
    };
    
    const activitiesSchema = {
      id: { type: 'id' },
      action: { type: 'string', required: true },
      trackable_type: { type: 'string' },
      trackable_id: { type: 'number' },
      user_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'user'
      },
      created_at: { type: 'string' }
    };
    
    const tagsSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      taggable_type: { type: 'string' },
      taggable_id: { type: 'number' }
    };
    
    // Register scopes with search schemas
    api.addResource('users', { schema: usersSchema });
    
    api.addResource('articles', { 
      schema: articlesSchema,
      relationships: {
        activities: {
          hasMany: 'activities',
          via: 'trackable',
          as: 'activities',
          sideLoad: true
        },
        tags: {
          hasMany: 'tags',
          via: 'taggable',
          as: 'tags',
          sideLoad: true
        }
      }
    });
    
    api.addResource('videos', { 
      schema: videosSchema,
      relationships: {
        activities: {
          hasMany: 'activities',
          via: 'trackable',
          as: 'activities',
          sideLoad: true
        },
        tags: {
          hasMany: 'tags',
          via: 'taggable',
          as: 'tags',
          sideLoad: true
        }
      }
    });
    
    api.addResource('courses', { 
      schema: coursesSchema,
      relationships: {
        activities: {
          hasMany: 'activities',
          via: 'trackable',
          as: 'activities',
          sideLoad: true
        },
        tags: {
          hasMany: 'tags',
          via: 'taggable',
          as: 'tags',
          sideLoad: true
        }
      }
    });
    
    api.addResource('activities', {
      schema: activitiesSchema,
      searchSchema: {
        action: { type: 'string' },
        // Search by content title across polymorphic types
        trackableTitle: {
          type: 'string',
          filterUsing: 'like',
          polymorphicField: 'trackable',
          targetFields: {
            articles: 'title',
            videos: 'title',
            courses: 'name'
          }
        },
        // Search by author/creator/instructor name
        trackableAuthor: {
          type: 'string',
          filterUsing: 'like',
          polymorphicField: 'trackable',
          targetFields: {
            articles: 'author.name',
            videos: 'creator.name',
            courses: 'instructor.name'
          }
        },
        // Search by status (only articles and videos have status)
        trackableStatus: {
          type: 'string',
          polymorphicField: 'trackable',
          targetFields: {
            articles: 'status',
            videos: 'status'
          }
        }
      },
      relationships: {
        trackable: {
          belongsToPolymorphic: {
            types: ['articles', 'videos', 'courses'],
            typeField: 'trackable_type',
            idField: 'trackable_id'
          },
          as: 'trackable',
          sideLoad: true
        }
      }
    });
    
    api.addResource('tags', {
      schema: tagsSchema,
      searchSchema: {
        // Search by taggable content title
        taggableTitle: {
          type: 'string',
          filterUsing: 'like',
          polymorphicField: 'taggable',
          targetFields: {
            articles: 'title',
            videos: 'title',
            courses: 'name'
          }
        }
      },
      relationships: {
        taggable: {
          belongsToPolymorphic: {
            types: ['articles', 'videos', 'courses'],
            typeField: 'taggable_type',
            idField: 'taggable_id'
          },
          as: 'taggable',
          sideLoad: true
        }
      }
    });
  });
  
  afterEach(async () => {
    // Clean up
    await db.schema.dropTableIfExists('tags');
    await db.schema.dropTableIfExists('activities');
    await db.schema.dropTableIfExists('courses');
    await db.schema.dropTableIfExists('videos');
    await db.schema.dropTableIfExists('articles');
    await db.schema.dropTableIfExists('users');
    await db.destroy();
  });
  
  // Test 1: Basic polymorphic search by title
  test('should search activities by trackable title', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableTitle: 'JavaScript' }
      }
    });
    
    // Should find activities for "JavaScript Advanced Tips" article and "JavaScript Tutorial" video  
    assert.strictEqual(response.data.length, 5); // 2 for article, 2 for video, 1 for course
    
    const trackableTypes = response.data.map(a => a.relationships?.trackable?.data?.type).filter(Boolean);
    assert.ok(trackableTypes.includes('articles'));
    assert.ok(trackableTypes.includes('videos'));
    assert.ok(trackableTypes.includes('courses'));
  });
  
  // Test 2: Case-insensitive polymorphic search
  test('should perform case-insensitive search on polymorphic fields', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableTitle: 'javascript' }
      }
    });
    
    // Should still find results despite lowercase search term
    assert.ok(response.data.length >= 3);
  });
  
  // Test 3: Cross-table polymorphic search
  test('should search activities by trackable author name', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableAuthor: 'Alice' }
      }
    });
    
    // Should find activities for content created by Alice (articles and videos where she's the creator)
    const foundActivities = response.data;
    assert.ok(foundActivities.length >= 2);
    
    // Check that we found activities for Alice's content
    const relatedTypes = foundActivities.map(a => a.relationships?.trackable?.data?.type).filter(Boolean);
    assert.ok(relatedTypes.length > 0);
    // Alice created articles and also created a video (id: 3)
    assert.ok(relatedTypes.includes('articles') || relatedTypes.includes('videos'));
  });
  
  // Test 4: Polymorphic search with partial matches
  test('should find partial matches in polymorphic search', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableTitle: 'Advanced' }
      }
    });
    
    // Should find activities for "JavaScript Advanced Tips" article and "Advanced React Patterns" video
    assert.ok(response.data.length >= 2);
    
    const types = [...new Set(response.data.map(a => a.relationships?.trackable?.data?.type).filter(Boolean))];
    assert.ok(types.includes('articles')); // JavaScript Advanced Tips
    assert.ok(types.includes('videos')); // Advanced React Patterns
  });
  
  // Test 5: Polymorphic search on fields not present in all types
  test('should handle polymorphic search on type-specific fields', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableStatus: 'published' }
      }
    });
    
    // Only articles and videos have status, not courses
    const trackableTypes = response.data.map(a => a.relationships?.trackable?.data?.type).filter(Boolean);
    assert.ok(!trackableTypes.includes('courses'));
    
    // Should find published articles and videos
    assert.ok(trackableTypes.filter(t => t === 'articles').length >= 1);
    assert.ok(trackableTypes.filter(t => t === 'videos').length >= 1);
  });
  
  // Test 6: Multiple polymorphic search filters
  test('should combine multiple polymorphic search filters', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { 
          action: 'created',
          trackableTitle: 'JavaScript'
        }
      }
    });
    
    // Should only find 'created' activities for JavaScript content
    response.data.forEach(activity => {
      assert.strictEqual(activity.attributes.action, 'created');
    });
    
    assert.ok(response.data.length >= 2);
  });
  
  // Test 7: Polymorphic search with includes
  test('should perform polymorphic search with includes', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableTitle: 'JavaScript' },
        include: ['trackable', 'user']
      }
    });
    
    // Should include the trackable resources and users
    assert.ok(response.included);
    
    const includedTypes = [...new Set(response.included.map(r => r.type))];
    assert.ok(includedTypes.includes('users'));
    assert.ok(includedTypes.includes('articles'));
    assert.ok(includedTypes.includes('videos'));
  });
  
  // Test 8: Search tags by polymorphic content
  test('should search tags by taggable content title', async () => {
    const response = await api.resources.tags.query({
      queryParams: {
        filters: { taggableTitle: 'JavaScript' }
      }
    });
    
    // Should find tags on JavaScript content
    assert.ok(response.data.length >= 3);
    
    // Check tag names
    const tagNames = response.data.map(t => t.attributes.name);
    assert.ok(tagNames.includes('javascript'));
    assert.ok(tagNames.includes('advanced'));
    assert.ok(tagNames.includes('tutorial'));
  });
  
  // Test 9: Empty results for non-matching polymorphic search
  test('should return empty results for non-matching polymorphic search', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableTitle: 'NonExistentTitle' }
      }
    });
    
    assert.strictEqual(response.data.length, 0);
  });
  
  // Test 10: Polymorphic search with sorting
  test('should sort results with polymorphic search filters', async () => {
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableTitle: 'JavaScript' },
        sort: ['-created_at']
      }
    });
    
    // Results should be sorted by created_at descending
    const dates = response.data.map(a => new Date(a.attributes.created_at).getTime());
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] <= dates[i - 1]);
    }
  });
  
  // Test 11: Polymorphic search with pagination
  test('should paginate polymorphic search results', async () => {
    const page1 = await api.resources.activities.query({
      queryParams: {
        filters: { trackableAuthor: 'Alice' },
        page: { size: 1, number: 1 }
      }
    });
    
    const page2 = await api.resources.activities.query({
      queryParams: {
        filters: { trackableAuthor: 'Alice' },
        page: { size: 1, number: 2 }
      }
    });
    
    assert.strictEqual(page1.data.length, 1);
    assert.strictEqual(page2.data.length, 1);
    assert.notStrictEqual(page1.data[0].id, page2.data[0].id);
  });
  
  // Test 12: Complex nested path in polymorphic search
  test('should handle complex nested paths in polymorphic search', async () => {
    // Search for activities where the trackable's author is named "Charlie"
    const response = await api.resources.activities.query({
      queryParams: {
        filters: { trackableAuthor: 'Charlie' }
      }
    });
    
    // Should find activities for courses (Charlie is an instructor)
    response.data.forEach(activity => {
      assert.strictEqual(activity.relationships?.trackable?.data?.type, 'courses');
    });
    
    assert.ok(response.data.length >= 1);
  });
});