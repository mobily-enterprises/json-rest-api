import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

describe('REST API Plugin - Relationship Includes', () => {
  let api;
  let db;
  let article3Id;
  
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
    
    // Helper to extract ID from SQLite returning result
    const extractId = (result) => {
      if (Array.isArray(result) && result.length > 0) {
        return typeof result[0] === 'object' ? result[0].id : result[0];
      }
      return result;
    };
    
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
    
    await api.use(RestApiKnexPlugin, { knex: db });
    
    // Create comprehensive database schema
    await db.schema.createTable('organizations', (table) => {
      table.increments('id');
      table.string('name');
      table.string('type'); // tech, media, finance
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('departments', (table) => {
      table.increments('id');
      table.string('name');
      table.integer('organization_id').unsigned().references('organizations.id');
      table.integer('parent_department_id').unsigned().references('departments.id'); // Self-referential
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('people', (table) => {
      table.increments('id');
      table.string('name');
      table.string('email');
      table.string('role'); // author, editor, admin
      table.integer('department_id').unsigned().references('departments.id');
      table.integer('manager_id').unsigned().references('people.id'); // Self-referential
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('categories', (table) => {
      table.increments('id');
      table.string('name');
      table.string('slug');
      table.integer('parent_id').unsigned().references('categories.id'); // Hierarchical
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('articles', (table) => {
      table.increments('id');
      table.string('title');
      table.text('body');
      table.string('status'); // draft, published, archived
      table.integer('author_id').unsigned().references('people.id');
      table.integer('editor_id').unsigned().references('people.id');
      table.integer('category_id').unsigned().references('categories.id');
      table.integer('view_count').defaultTo(0);
      table.datetime('published_at');
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('comments', (table) => {
      table.increments('id');
      table.text('body');
      table.integer('article_id').unsigned().references('articles.id');
      table.integer('author_id').unsigned().references('people.id');
      table.integer('parent_comment_id').unsigned().references('comments.id'); // Nested comments
      table.boolean('approved').defaultTo(false);
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('tags', (table) => {
      table.increments('id');
      table.string('name');
      table.string('slug');
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('article_tags', (table) => {
      table.increments('id');
      table.integer('article_id').unsigned().references('articles.id');
      table.integer('tag_id').unsigned().references('tags.id');
      table.unique(['article_id', 'tag_id']);
    });
    
    // Insert comprehensive test data
    
    // Organizations
    const techOrgResult = await db('organizations').insert({
      name: 'TechCorp',
      type: 'tech'
    }).returning('id');
    const techOrgId = extractId(techOrgResult);
    
    const mediaOrgResult = await db('organizations').insert({
      name: 'MediaInc',
      type: 'media'
    }).returning('id');
    const mediaOrgId = extractId(mediaOrgResult);
    
    // Departments
    const engineeringDeptResult = await db('departments').insert({
      name: 'Engineering',
      organization_id: techOrgId
    }).returning('id');
    const engineeringDeptId = extractId(engineeringDeptResult);
    
    const frontendDeptResult = await db('departments').insert({
      name: 'Frontend Team',
      organization_id: techOrgId,
      parent_department_id: engineeringDeptId
    }).returning('id');
    const frontendDeptId = extractId(frontendDeptResult);
    
    const editorialDeptResult = await db('departments').insert({
      name: 'Editorial',
      organization_id: mediaOrgId
    }).returning('id');
    const editorialDeptId = extractId(editorialDeptResult);
    
    // People
    const johnResult = await db('people').insert({
      name: 'John Doe',
      email: 'john@techcorp.com',
      role: 'author',
      department_id: frontendDeptId,
      active: true
    }).returning('id');
    const johnId = extractId(johnResult);
    
    const janeResult = await db('people').insert({
      name: 'Jane Smith',
      email: 'jane@techcorp.com',
      role: 'editor',
      department_id: engineeringDeptId,
      manager_id: johnId,
      active: true
    }).returning('id');
    const janeId = extractId(janeResult);
    
    const bobResult = await db('people').insert({
      name: 'Bob Johnson',
      email: 'bob@mediainc.com',
      role: 'author',
      department_id: editorialDeptId,
      active: true
    }).returning('id');
    const bobId = extractId(bobResult);
    
    const aliceResult = await db('people').insert({
      name: 'Alice Brown',
      email: 'alice@mediainc.com',
      role: 'admin',
      department_id: editorialDeptId,
      manager_id: bobId,
      active: false
    }).returning('id');
    const aliceId = extractId(aliceResult);
    
    // Categories (hierarchical)
    const techCatResult = await db('categories').insert({
      name: 'Technology',
      slug: 'technology'
    }).returning('id');
    const techCatId = extractId(techCatResult);
    
    const jsCatResult = await db('categories').insert({
      name: 'JavaScript',
      slug: 'javascript',
      parent_id: techCatId
    }).returning('id');
    const jsCatId = extractId(jsCatResult);
    
    const reactCatResult = await db('categories').insert({
      name: 'React',
      slug: 'react',
      parent_id: jsCatId
    }).returning('id');
    const reactCatId = extractId(reactCatResult);
    
    // Tags
    const tagResults = await db('tags').insert([
      { name: 'frontend', slug: 'frontend' },
      { name: 'backend', slug: 'backend' },
      { name: 'tutorial', slug: 'tutorial' },
      { name: 'advanced', slug: 'advanced' }
    ]).returning('id');
    
    // Extract tag IDs
    const tagIds = tagResults.map(result => 
      typeof result === 'object' ? result.id : result
    );
    
    // Articles
    const article1Result = await db('articles').insert({
      title: 'Getting Started with React',
      body: 'React is a powerful library...',
      status: 'published',
      author_id: johnId,
      editor_id: janeId,
      category_id: reactCatId,
      view_count: 1500,
      published_at: '2024-01-15 10:00:00'
    }).returning('id');
    const article1Id = extractId(article1Result);
    
    const article2Result = await db('articles').insert({
      title: 'Advanced React Patterns',
      body: 'Let us explore advanced patterns...',
      status: 'published',
      author_id: johnId,
      editor_id: janeId,
      category_id: reactCatId,
      view_count: 800,
      published_at: '2024-02-20 14:30:00'
    }).returning('id');
    const article2Id = extractId(article2Result);
    
    const article3Result = await db('articles').insert({
      title: 'JavaScript Performance Tips',
      body: 'Performance is crucial...',
      status: 'draft',
      author_id: bobId,
      editor_id: null,
      category_id: jsCatId,
      view_count: 0,
      published_at: null
    }).returning('id');
    article3Id = extractId(article3Result);
    
    const article4Result = await db('articles').insert({
      title: 'The Future of Web Development',
      body: 'Web development is evolving...',
      status: 'published',
      author_id: bobId,
      editor_id: aliceId,
      category_id: techCatId,
      view_count: 2000,
      published_at: '2024-03-01 09:00:00'
    }).returning('id');
    const article4Id = extractId(article4Result);
    
    // Article tags
    await db('article_tags').insert([
      { article_id: article1Id, tag_id: tagIds[0] }, // frontend
      { article_id: article1Id, tag_id: tagIds[2] }, // tutorial
      { article_id: article2Id, tag_id: tagIds[0] }, // frontend
      { article_id: article2Id, tag_id: tagIds[3] }, // advanced
      { article_id: article3Id, tag_id: tagIds[1] }, // backend
      { article_id: article4Id, tag_id: tagIds[0] }, // frontend
      { article_id: article4Id, tag_id: tagIds[1] }  // backend
    ]);
    
    // Comments (with nesting)
    const comment1Result = await db('comments').insert({
      body: 'Great article!',
      article_id: article1Id,
      author_id: bobId,
      approved: true
    }).returning('id');
    const comment1Id = extractId(comment1Result);
    
    const comment2Result = await db('comments').insert({
      body: 'Thanks for sharing',
      article_id: article1Id,
      author_id: janeId,
      parent_comment_id: comment1Id,
      approved: true
    }).returning('id');
    const comment2Id = extractId(comment2Result);
    
    const comment3Result = await db('comments').insert({
      body: 'Very helpful',
      article_id: article2Id,
      author_id: aliceId,
      approved: false
    }).returning('id');
    const comment3Id = extractId(comment3Result);
    
    const comment4Result = await db('comments').insert({
      body: 'Looking forward to more',
      article_id: article4Id,
      author_id: johnId,
      approved: true
    }).returning('id');
    const comment4Id = extractId(comment4Result);
    
    // Define resources with relationships
    api.addResource('organizations', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string' },
        type: { type: 'string' }
      },
      relationships: {
        departments: {
          hasMany: 'departments',
          foreignKey: 'organization_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('departments', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', indexed: true, search: true },
        organization_id: {
          belongsTo: 'organizations',
          as: 'organization',
          sideLoad: true
        },
        parent_department_id: {
          belongsTo: 'departments',
          as: 'parentDepartment',
          sideLoad: true
        }
      },
      relationships: {
        people: {
          hasMany: 'people',
          foreignKey: 'department_id',
          sideLoad: true
        },
        subDepartments: {
          hasMany: 'departments',
          foreignKey: 'parent_department_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('people', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', indexed: true, search: true },
        email: { type: 'string', search: true },
        role: { type: 'string', search: true },
        active: { type: 'boolean', search: true },
        department_id: {
          belongsTo: 'departments',
          as: 'department',
          sideLoad: true,
          sideSearch: true
        },
        manager_id: {
          belongsTo: 'people',
          as: 'manager',
          sideLoad: true
        }
      },
      relationships: {
        authoredArticles: {
          hasMany: 'articles',
          foreignKey: 'author_id',
          sideLoad: true
        },
        editedArticles: {
          hasMany: 'articles',
          foreignKey: 'editor_id',
          sideLoad: true
        },
        comments: {
          hasMany: 'comments',
          foreignKey: 'author_id',
          sideLoad: true
        },
        subordinates: {
          hasMany: 'people',
          foreignKey: 'manager_id',
          sideLoad: true
        }
      },
      searchSchema: {
        departmentName: {
          type: 'string',
          actualField: 'departments.name',
          filterUsing: 'like'
        }
      }
    });
    
    api.addResource('categories', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', indexed: true, search: true },
        slug: { type: 'string' },
        parent_id: {
          belongsTo: 'categories',
          as: 'parent',
          sideLoad: true
        }
      },
      relationships: {
        subcategories: {
          hasMany: 'categories',
          foreignKey: 'parent_id',
          sideLoad: true
        },
        articles: {
          hasMany: 'articles',
          foreignKey: 'category_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('articles', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', search: { filterUsing: 'like' } },
        body: { type: 'string', search: { filterUsing: 'like' } },
        status: { type: 'string', search: true },
        view_count: { type: 'number', search: true },
        published_at: { type: 'datetime' },
        author_id: {
          belongsTo: 'people',
          as: 'author',
          sideLoad: true,
          sideSearch: true
        },
        editor_id: {
          belongsTo: 'people',
          as: 'editor',
          sideLoad: true
        },
        category_id: {
          belongsTo: 'categories',
          as: 'category',
          sideLoad: true,
          sideSearch: true
        }
      },
      relationships: {
        comments: {
          hasMany: 'comments',
          foreignKey: 'article_id',
          sideLoad: true
        },
        tags: {
          hasMany: 'tags',
          through: 'article_tags'
          // sideLoad: true  // Many-to-many not yet implemented
        }
      },
      searchSchema: {
        authorName: {
          type: 'string',
          actualField: 'people.name',
          filterUsing: 'like'
        },
        categoryName: {
          type: 'string',
          actualField: 'categories.name',
          filterUsing: 'like'
        }
      }
    });
    
    api.addResource('comments', {
      schema: {
        id: { type: 'id' },
        body: { type: 'string' },
        approved: { type: 'boolean' },
        article_id: {
          belongsTo: 'articles',
          as: 'article',
          sideLoad: true
        },
        author_id: {
          belongsTo: 'people',
          as: 'author',
          sideLoad: true
        },
        parent_comment_id: {
          belongsTo: 'comments',
          as: 'parentComment',
          sideLoad: true
        }
      },
      relationships: {
        replies: {
          hasMany: 'comments',
          foreignKey: 'parent_comment_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('tags', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string' },
        slug: { type: 'string' }
      },
      relationships: {
        articles: {
          hasMany: 'articles',
          through: 'article_tags'
          // sideLoad: true  // Many-to-many not yet implemented
        }
      }
    });
  });
  
  afterEach(async () => {
    if (db) {
      await db.destroy();
    }
  });
  
  describe('Basic Include Functionality', () => {
    test('should include single belongsTo relationship', async () => {
      const result = await api.resources.articles.query({
        queryParams: { include: ['author'] }
      });
      
      assert.ok(result.data.length > 0, 'Should have articles');
      assert.ok(result.included, 'Should have included array');
      
      // Check that all authors are included
      const authorIds = new Set(
        result.data
          .map(article => article.relationships?.author?.data?.id)
          .filter(Boolean)
      );
      
      const includedAuthorIds = new Set(
        result.included
          .filter(item => item.type === 'people')
          .map(item => item.id)
      );
      
      authorIds.forEach(id => {
        assert.ok(includedAuthorIds.has(id), `Author ${id} should be included`);
      });
    });
    
    test('should include multiple belongsTo relationships', async () => {
      const result = await api.resources.articles.query({
        queryParams: { include: ['author', 'editor', 'category'] }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      const includedTypes = new Set(result.included.map(item => item.type));
      assert.ok(includedTypes.has('people'), 'Should include people');
      assert.ok(includedTypes.has('categories'), 'Should include categories');
      
      // Check relationships are properly set
      const article = result.data.find(a => a.relationships?.editor?.data);
      if (article) {
        assert.ok(article.relationships.author, 'Should have author relationship');
        assert.ok(article.relationships.editor, 'Should have editor relationship');
        assert.ok(article.relationships.category, 'Should have category relationship');
      }
    });
    
    test('should include hasMany relationships', async () => {
      const result = await api.resources.articles.query({
        queryParams: { include: ['comments'] }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      const articleWithComments = result.data.find(
        article => article.relationships?.comments?.data?.length > 0
      );
      
      assert.ok(articleWithComments, 'Should have article with comments');
      
      // Verify all comment IDs in relationships exist in included
      const commentIds = articleWithComments.relationships.comments.data.map(c => c.id);
      const includedCommentIds = result.included
        .filter(item => item.type === 'comments')
        .map(item => item.id);
      
      commentIds.forEach(id => {
        assert.ok(includedCommentIds.includes(id), `Comment ${id} should be included`);
      });
    });
    
    test('should handle null relationships', async () => {
      // Article 3 has no editor
      const result = await api.resources.articles.get({
        id: article3Id,
        queryParams: { include: ['editor'] }
      });
      
      assert.ok(result, 'Should have result');
      assert.ok(result.data, 'Should have data');
      assert.ok(result.data.relationships, 'Should have relationships');
      assert.ok(result.data.relationships.editor, 'Should have editor relationship');
      assert.strictEqual(result.data.relationships.editor.data, null, 'Editor should be null');
      assert.ok(!result.included || result.included.length === 0, 'Should not have included array for null relationship');
    });
    
    test('should handle empty hasMany relationships', async () => {
      // Get article without comments
      const result = await api.resources.articles.get({
        id: article3Id,
        queryParams: { include: ['comments'] }
      });
      
      assert.ok(result, 'Should have result');
      assert.ok(result.data, 'Should have data');
      assert.ok(result.data.relationships, 'Should have relationships');
      assert.ok(result.data.relationships.comments, 'Should have comments relationship');
      assert.ok(Array.isArray(result.data.relationships.comments.data), 'Comments data should be array');
      assert.strictEqual(result.data.relationships.comments.data.length, 0, 'Should have no comments');
    });
  });
  
  describe('Nested Includes', () => {
    test('should include two levels deep', async () => {
      const result = await api.resources.articles.query({
        queryParams: { include: ['author.department'] }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      const authors = result.included.filter(item => item.type === 'people');
      const departments = result.included.filter(item => item.type === 'departments');
      
      assert.ok(authors.length > 0, 'Should include authors');
      assert.ok(departments.length > 0, 'Should include departments');
      
      // Verify authors have department relationships
      const authorWithDept = authors.find(a => a.relationships?.department?.data);
      assert.ok(authorWithDept, 'At least one author should have department');
      
      // Verify department is in included
      const deptId = authorWithDept.relationships.department.data.id;
      assert.ok(
        departments.some(d => d.id === deptId),
        'Department should be in included'
      );
    });
    
    test('should include three levels deep', async () => {
      const result = await api.resources.articles.query({
        queryParams: { include: ['author.department.organization'] }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      const orgs = result.included.filter(item => item.type === 'organizations');
      assert.ok(orgs.length > 0, 'Should include organizations');
      
      // Verify chain: article -> author -> department -> organization
      const article = result.data[0];
      if (article.relationships?.author?.data) {
        const author = result.included.find(
          i => i.type === 'people' && i.id === article.relationships.author.data.id
        );
        assert.ok(author, 'Author should be included');
        
        if (author.relationships?.department?.data) {
          const dept = result.included.find(
            i => i.type === 'departments' && i.id === author.relationships.department.data.id
          );
          assert.ok(dept, 'Department should be included');
          
          if (dept.relationships?.organization?.data) {
            const org = result.included.find(
              i => i.type === 'organizations' && i.id === dept.relationships.organization.data.id
            );
            assert.ok(org, 'Organization should be included');
          }
        }
      }
    });
    
    test('should include multiple nested paths', async () => {
      const result = await api.resources.articles.query({
        queryParams: { 
          include: ['author.department', 'comments.author', 'category.parent'] 
        }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      const types = new Set(result.included.map(i => i.type));
      assert.ok(types.has('people'), 'Should include people');
      assert.ok(types.has('departments'), 'Should include departments');
      assert.ok(types.has('comments'), 'Should include comments');
      assert.ok(types.has('categories'), 'Should include categories');
      
      // Verify comment authors have relationships
      const comment = result.included.find(i => i.type === 'comments');
      if (comment && comment.relationships?.author?.data) {
        const commentAuthor = result.included.find(
          i => i.type === 'people' && i.id === comment.relationships.author.data.id
        );
        assert.ok(commentAuthor, 'Comment author should be included');
      }
    });
    
    test('should handle self-referential relationships', async () => {
      // Get people with their managers
      const result = await api.resources.people.query({
        queryParams: { include: ['manager', 'subordinates'] }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      // Jane has John as manager
      const jane = result.data.find(p => p.attributes.name === 'Jane Smith');
      assert.ok(jane, 'Should find Jane');
      assert.ok(jane.relationships.manager.data, 'Jane should have manager');
      
      // John should be in included
      const john = result.included.find(
        i => i.type === 'people' && i.id === jane.relationships.manager.data.id
      );
      assert.ok(john, 'Manager should be included');
      assert.strictEqual(john.attributes.name, 'John Doe', 'Manager should be John');
      
      // John should have Jane as subordinate
      const johnMain = result.data.find(p => p.attributes.name === 'John Doe');
      assert.ok(
        johnMain.relationships.subordinates.data.some(s => s.id === jane.id),
        'John should have Jane as subordinate'
      );
    });
    
    test('should handle deeply nested self-referential relationships', async () => {
      // Categories with subcategories
      const result = await api.resources.categories.query({
        queryParams: { include: ['parent', 'subcategories.subcategories'] }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      // JavaScript category should have Technology as parent
      const jsCategory = result.data.find(c => c.attributes.name === 'JavaScript');
      assert.ok(jsCategory.relationships.parent.data, 'JavaScript should have parent');
      
      // React should be in subcategories of JavaScript
      assert.ok(
        jsCategory.relationships.subcategories.data.length > 0,
        'JavaScript should have subcategories'
      );
    });
  });
  
  describe('Edge Cases and Error Handling', () => {
    test('should handle circular references without infinite loops', async () => {
      // Comments with replies that might reference back
      const result = await api.resources.comments.query({
        queryParams: { include: ['parentComment', 'replies.parentComment'] }
      });
      
      assert.ok(result.data, 'Should return data');
      assert.ok(!result.error, 'Should not have errors');
      
      // Check that we don't have duplicate resources
      const ids = result.included?.map(i => `${i.type}:${i.id}`) || [];
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size, 'Should not have duplicate resources');
    });
    
    test('should deduplicate included resources', async () => {
      // Multiple articles by same author
      debugger
      const result = await api.resources.articles.query({
        queryParams: { 
          include: ['author', 'editor'],
          filters: { status: 'published' }
        }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      // Count how many times each person appears
      const personCounts = {};
      result.included
        .filter(i => i.type === 'people')
        .forEach(person => {
          const key = `${person.type}:${person.id}`;
          personCounts[key] = (personCounts[key] || 0) + 1;
        });
      
      Object.entries(personCounts).forEach(([key, count]) => {
        assert.strictEqual(count, 1, `${key} should appear exactly once`);
      });
    });
    
    test('should handle includes with pagination', async () => {
      const result = await api.resources.articles.query({
        queryParams: { 
          include: ['author', 'comments'],
          page: { size: 2, number: 1 }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should return 2 articles');
      assert.ok(result.included, 'Should have included array');
      
      // Included should only contain resources for these 2 articles
      const authorIds = result.data
        .map(a => a.relationships?.author?.data?.id)
        .filter(Boolean);
      
      const includedAuthorIds = result.included
        .filter(i => i.type === 'people')
        .map(i => i.id);
      
      // All article authors should be included
      authorIds.forEach(id => {
        assert.ok(includedAuthorIds.includes(id), `Author ${id} should be included`);
      });
    });
    
    test('should handle includes with sorting', async () => {
      const result = await api.resources.articles.query({
        queryParams: { 
          include: ['author', 'category'],
          sort: ['-view_count']
        }
      });
      
      // Verify sorting
      for (let i = 1; i < result.data.length; i++) {
        assert.ok(
          result.data[i-1].attributes.view_count >= result.data[i].attributes.view_count,
          'Articles should be sorted by view count descending'
        );
      }
      
      assert.ok(result.included, 'Should still have included resources');
    });
    
    test('should handle invalid include paths gracefully', async () => {
      const result = await api.resources.articles.query({
        queryParams: { include: ['nonexistent', 'author'] }
      });
      
      // Should still work and include valid relationships
      assert.ok(result.data, 'Should return data');
      assert.ok(result.included, 'Should have included array');
      
      const authors = result.included.filter(i => i.type === 'people');
      assert.ok(authors.length > 0, 'Should still include valid relationships');
    });
    
    test('should handle empty include array', async () => {
      const result = await api.resources.articles.query({
        queryParams: { include: [] }
      });
      
      assert.ok(result.data, 'Should return data');
      assert.ok(!result.included || result.included.length === 0, 'Should not have included array');
    });
    
    test('should handle includes on empty result set', async () => {
      const result = await api.resources.articles.query({
        queryParams: { 
          include: ['author', 'comments'],
          filters: { title: 'Nonexistent Article' }
        }
      });
      
      assert.strictEqual(result.data.length, 0, 'Should return no articles');
      assert.ok(!result.included || result.included.length === 0, 'Should not have included array');
    });
  });
  
  describe('Complex Scenarios', () => {
    test('should handle multiple relationship types on same resource', async () => {
      // People can be both authors and editors
      const result = await api.resources.people.query({
        queryParams: { 
          include: ['authoredArticles', 'editedArticles', 'department.organization']
        }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      // John has authored articles, Jane has edited articles
      const john = result.data.find(p => p.attributes.name === 'John Doe');
      assert.ok(john.relationships.authoredArticles.data.length > 0, 'John should have authored articles');
      
      const jane = result.data.find(p => p.attributes.name === 'Jane Smith');
      assert.ok(jane.relationships.editedArticles.data.length > 0, 'Jane should have edited articles');
      
      // All referenced articles should be included
      const articleIds = [
        ...john.relationships.authoredArticles.data.map(a => a.id),
        ...jane.relationships.editedArticles.data.map(a => a.id)
      ];
      
      const includedArticleIds = result.included
        .filter(i => i.type === 'articles')
        .map(i => i.id);
      
      articleIds.forEach(id => {
        assert.ok(includedArticleIds.includes(id), `Article ${id} should be included`);
      });
    });
    
    test('should handle diamond-shaped include paths', async () => {
      // Article -> Author -> Department <- Editor -> Department
      const result = await api.resources.articles.query({
        queryParams: { 
          include: ['author.department', 'editor.department']
        }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      // Find article where author and editor are from same department
      const article = result.data.find(a => 
        a.attributes.author_id === '1' && a.attributes.editor_id === '2'
      );
      
      if (article) {
        const author = result.included.find(
          i => i.type === 'people' && i.id === article.relationships.author.data.id
        );
        const editor = result.included.find(
          i => i.type === 'people' && i.id === article.relationships.editor.data.id
        );
        
        // Both should reference same department
        assert.ok(author.relationships.department.data, 'Author should have department');
        assert.ok(editor.relationships.department.data, 'Editor should have department');
        
        // Department should only be included once
        const deptId = author.relationships.department.data.id;
        const deptCount = result.included.filter(
          i => i.type === 'departments' && i.id === deptId
        ).length;
        assert.strictEqual(deptCount, 1, 'Department should be included exactly once');
      }
    });
    
    test('should handle includes with many-to-many relationships', async () => {
      // Articles have many tags through article_tags
      const result = await api.resources.articles.query({
        queryParams: { include: ['tags'] }
      });
      
      // Note: This test documents current behavior - many-to-many through tables
      // are not yet implemented. This should be updated when that feature is added.
      assert.ok(result.data, 'Should return data');
      
      // For now, tags relationship should be empty or not loaded
      const article = result.data[0];
      if (article.relationships?.tags) {
        assert.ok(
          !article.relationships.tags.data || 
          article.relationships.tags.data.length === 0,
          'Many-to-many relationships not yet implemented'
        );
      }
    });
  });
  
  describe('Performance Considerations', () => {
    test('should batch load relationships efficiently', async () => {
      // This test verifies that we're not doing N+1 queries
      // In a real test, we'd count SQL queries, but here we just verify the result
      const result = await api.resources.articles.query({
        queryParams: { 
          include: ['author', 'editor', 'category', 'comments.author']
        }
      });
      
      assert.ok(result.included, 'Should have included array');
      
      // All relationships should be loaded
      result.data.forEach(article => {
        if (article.relationships.author?.data) {
          assert.ok(
            result.included.some(i => 
              i.type === 'people' && i.id === article.relationships.author.data.id
            ),
            'Author should be included'
          );
        }
      });
    });
    
    test('should handle large include sets', async () => {
      const result = await api.resources.organizations.query({
        queryParams: { 
          include: ['departments.people.authoredArticles.comments']
        }
      });
      
      assert.ok(result.data, 'Should return data');
      assert.ok(result.included, 'Should have included array');
      
      // Verify we have all the types
      const types = new Set(result.included.map(i => i.type));
      assert.ok(types.has('departments'), 'Should include departments');
      assert.ok(types.has('people'), 'Should include people');
      assert.ok(types.has('articles'), 'Should include articles');
      assert.ok(types.has('comments'), 'Should include comments');
    });
  });
  
  describe('Filtering with Includes', () => {
    test('should filter by status while including relationships', async () => {
      const result = await api.resources.articles.query({
        queryParams: { 
          filters: { status: 'published' },
          include: ['author', 'editor', 'category']
        }
      });
      
      assert.strictEqual(result.data.length, 3, 'Should have 3 published articles');
      assert.ok(result.included, 'Should have included array');
      
      // Verify all articles are published
      result.data.forEach(article => {
        assert.strictEqual(article.attributes.status, 'published', 'Article should be published');
        assert.ok(article.relationships, 'Article should have relationships');
      });
      
      // Verify all referenced resources are included
      const types = new Set(result.included.map(i => i.type));
      assert.ok(types.has('people'), 'Should include people');
      assert.ok(types.has('categories'), 'Should include categories');
    });
    
    test('should filter by cross-table field while including relationships', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { authorName: 'John Doe' },
          include: ['author', 'comments.author']
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'John Doe authored 2 articles');
      
      // Verify author is included
      const authors = result.included.filter(i => i.type === 'people');
      const john = authors.find(a => a.attributes.name === 'John Doe');
      assert.ok(john, 'John should be in included');
      
      // Verify comments and their authors are included
      const comments = result.included.filter(i => i.type === 'comments');
      assert.ok(comments.length > 0, 'Should include comments');
    });
    
    test('should combine pagination, sorting, filtering, and includes', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { status: 'published' },
          include: ['author', 'category'],
          sort: ['-view_count'],
          page: { size: 2, number: 1 }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should return 2 articles');
      
      // Verify sorting (highest view count first)
      assert.ok(
        result.data[0].attributes.view_count >= result.data[1].attributes.view_count,
        'Should be sorted by view count descending'
      );
      
      // Verify relationships are included
      result.data.forEach(article => {
        assert.ok(article.relationships?.author, 'Should have author relationship');
        assert.ok(article.relationships?.category, 'Should have category relationship');
      });
      
      assert.ok(result.included, 'Should have included resources');
    });
    
    test('should filter by multiple fields while including nested relationships', async () => {
      const result = await api.resources.people.query({
        queryParams: {
          filters: { 
            role: 'author',
            active: true
          },
          include: ['department.organization', 'authoredArticles.comments']
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should have 2 active authors');
      
      // Verify included types
      const types = new Set(result.included.map(i => i.type));
      assert.ok(types.has('departments'), 'Should include departments');
      assert.ok(types.has('organizations'), 'Should include organizations');
      assert.ok(types.has('articles'), 'Should include articles');
      assert.ok(types.has('comments'), 'Should include comments');
    });
    
    test('should handle filtering with no results while requesting includes', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { 
            status: 'archived' // No articles have this status
          },
          include: ['author', 'comments']
        }
      });
      
      assert.strictEqual(result.data.length, 0, 'Should return no articles');
      assert.ok(!result.included || result.included.length === 0, 'Should not have included array');
    });
    
    test('should filter by view count while including relationships', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { 
            view_count: 1500 // Exact match
          },
          include: ['author', 'editor']
        }
      });
      
      assert.strictEqual(result.data.length, 1, 'Should have 1 article with 1500 views');
      assert.strictEqual(result.data[0].attributes.view_count, 1500, 'View count should be 1500');
      assert.ok(result.included, 'Should have included resources');
    });
  });
});