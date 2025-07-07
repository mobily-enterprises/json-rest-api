import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

describe('Enhanced Many-to-Many Relationships', () => {
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
    });
    
    await db.schema.createTable('projects', table => {
      table.increments('id');
      table.string('name');
      table.text('description');
      table.string('status');
    });
    
    await db.schema.createTable('skills', table => {
      table.increments('id');
      table.string('name');
      table.string('category');
      table.integer('difficulty_level');
    });
    
    await db.schema.createTable('teams', table => {
      table.increments('id');
      table.string('name');
      table.string('department');
    });
    
    // Enhanced pivot table with additional attributes
    await db.schema.createTable('project_members', table => {
      table.increments('id');
      table.integer('project_id').notNullable();
      table.integer('user_id').notNullable();
      table.string('role').notNullable();
      table.decimal('hours_allocated');
      table.date('joined_at');
      table.date('left_at');
      table.boolean('is_lead').defaultTo(false);
      table.text('notes');
      table.unique(['project_id', 'user_id', 'role']); // Allow same user with different roles
    });
    
    // Another enhanced pivot table
    await db.schema.createTable('user_skills', table => {
      table.increments('id');
      table.integer('user_id').notNullable();
      table.integer('skill_id').notNullable();
      table.integer('proficiency_level').notNullable(); // 1-5
      table.integer('years_experience');
      table.date('certified_at');
      table.string('certification_authority');
      table.boolean('is_primary').defaultTo(false);
      table.unique(['user_id', 'skill_id']);
    });
    
    // Team members pivot
    await db.schema.createTable('team_members', table => {
      table.increments('id');
      table.integer('team_id').notNullable();
      table.integer('user_id').notNullable();
      table.date('joined_at').notNullable();
      table.date('left_at');
      table.string('position');
      table.boolean('is_manager').defaultTo(false);
    });
    
    // Insert test data
    await db('users').insert([
      { id: 1, name: 'Alice Johnson', email: 'alice@example.com' },
      { id: 2, name: 'Bob Smith', email: 'bob@example.com' },
      { id: 3, name: 'Charlie Davis', email: 'charlie@example.com' },
      { id: 4, name: 'Diana Wilson', email: 'diana@example.com' }
    ]);
    
    await db('projects').insert([
      { id: 1, name: 'E-commerce Platform', description: 'Online shopping site', status: 'active' },
      { id: 2, name: 'Mobile App', description: 'Cross-platform mobile app', status: 'active' },
      { id: 3, name: 'Data Analytics Tool', description: 'BI dashboard', status: 'planning' }
    ]);
    
    await db('skills').insert([
      { id: 1, name: 'JavaScript', category: 'programming', difficulty_level: 3 },
      { id: 2, name: 'React', category: 'framework', difficulty_level: 4 },
      { id: 3, name: 'Node.js', category: 'runtime', difficulty_level: 3 },
      { id: 4, name: 'PostgreSQL', category: 'database', difficulty_level: 4 },
      { id: 5, name: 'Project Management', category: 'soft-skill', difficulty_level: 3 }
    ]);
    
    await db('teams').insert([
      { id: 1, name: 'Frontend Team', department: 'Engineering' },
      { id: 2, name: 'Backend Team', department: 'Engineering' },
      { id: 3, name: 'DevOps Team', department: 'Operations' }
    ]);
    
    // Project members with rich attributes
    await db('project_members').insert([
      { id: 1, project_id: 1, user_id: 1, role: 'lead-developer', hours_allocated: 40, joined_at: '2024-01-01', is_lead: true },
      { id: 2, project_id: 1, user_id: 2, role: 'developer', hours_allocated: 30, joined_at: '2024-01-15' },
      { id: 3, project_id: 1, user_id: 3, role: 'designer', hours_allocated: 20, joined_at: '2024-02-01' },
      { id: 4, project_id: 2, user_id: 2, role: 'lead-developer', hours_allocated: 35, joined_at: '2024-01-10', is_lead: true },
      { id: 5, project_id: 2, user_id: 3, role: 'developer', hours_allocated: 40, joined_at: '2024-01-10' },
      { id: 6, project_id: 3, user_id: 1, role: 'architect', hours_allocated: 15, joined_at: '2024-03-01' },
      { id: 7, project_id: 3, user_id: 4, role: 'project-manager', hours_allocated: 25, joined_at: '2024-02-15', is_lead: true }
    ]);
    
    // User skills with proficiency
    await db('user_skills').insert([
      { id: 1, user_id: 1, skill_id: 1, proficiency_level: 5, years_experience: 8, is_primary: true },
      { id: 2, user_id: 1, skill_id: 2, proficiency_level: 4, years_experience: 5 },
      { id: 3, user_id: 1, skill_id: 3, proficiency_level: 5, years_experience: 6 },
      { id: 4, user_id: 2, skill_id: 1, proficiency_level: 4, years_experience: 5 },
      { id: 5, user_id: 2, skill_id: 3, proficiency_level: 5, years_experience: 7, is_primary: true },
      { id: 6, user_id: 2, skill_id: 4, proficiency_level: 4, years_experience: 4 },
      { id: 7, user_id: 3, skill_id: 2, proficiency_level: 3, years_experience: 2 },
      { id: 8, user_id: 3, skill_id: 5, proficiency_level: 4, years_experience: 3 },
      { id: 9, user_id: 4, skill_id: 5, proficiency_level: 5, years_experience: 10, is_primary: true, certified_at: '2020-06-15', certification_authority: 'PMI' }
    ]);
    
    // Team members
    await db('team_members').insert([
      { id: 1, team_id: 1, user_id: 1, joined_at: '2023-01-01', position: 'Senior Developer' },
      { id: 2, team_id: 1, user_id: 3, joined_at: '2023-06-01', position: 'Developer' },
      { id: 3, team_id: 2, user_id: 2, joined_at: '2023-01-01', position: 'Lead Developer', is_manager: true },
      { id: 4, team_id: 2, user_id: 1, joined_at: '2023-03-01', position: 'Senior Developer' },
      { id: 5, team_id: 3, user_id: 2, joined_at: '2023-07-01', position: 'DevOps Engineer' }
    ]);
    
    // Define schemas
    const usersSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      email: { type: 'string', required: true }
    };
    
    const projectsSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      description: { type: 'string' },
      status: { type: 'string' }
    };
    
    const skillsSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      category: { type: 'string' },
      difficulty_level: { type: 'number', min: 1, max: 5 }
    };
    
    const teamsSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      department: { type: 'string' }
    };
    
    // Enhanced pivot table schemas
    const projectMembersSchema = {
      id: { type: 'id' },
      project_id: { 
        type: 'number', 
        required: true,
        belongsTo: 'projects',
        as: 'project',
        sideLoad: true
      },
      user_id: { 
        type: 'number', 
        required: true,
        belongsTo: 'users',
        as: 'user',
        sideLoad: true
      },
      role: { type: 'string', required: true },
      hours_allocated: { type: 'decimal' },
      joined_at: { type: 'string' },
      left_at: { type: 'string' },
      is_lead: { type: 'boolean' },
      notes: { type: 'string' }
    };
    
    const userSkillsSchema = {
      id: { type: 'id' },
      user_id: { 
        type: 'number', 
        required: true,
        belongsTo: 'users',
        as: 'user',
        sideLoad: true
      },
      skill_id: { 
        type: 'number', 
        required: true,
        belongsTo: 'skills',
        as: 'skill',
        sideLoad: true
      },
      proficiency_level: { type: 'number', required: true, min: 1, max: 5 },
      years_experience: { type: 'number' },
      certified_at: { type: 'string' },
      certification_authority: { type: 'string' },
      is_primary: { type: 'boolean' }
    };
    
    const teamMembersSchema = {
      id: { type: 'id' },
      team_id: { 
        type: 'number', 
        required: true,
        belongsTo: 'teams',
        as: 'team',
        sideLoad: true
      },
      user_id: { 
        type: 'number', 
        required: true,
        belongsTo: 'users',
        as: 'user',
        sideLoad: true
      },
      joined_at: { type: 'string', required: true },
      left_at: { type: 'string' },
      position: { type: 'string' },
      is_manager: { type: 'boolean' }
    };
    
    // Register scopes with enhanced many-to-many relationships
    api.addResource('users', { 
      schema: usersSchema,
      relationships: {
        projectMemberships: {
          hasMany: 'project_members',
          foreignKey: 'user_id',
          as: 'projectMemberships',
          sideLoad: true
        },
        skills: {
          hasMany: 'user_skills',
          foreignKey: 'user_id',
          as: 'skills',
          sideLoad: true
        },
        teamMemberships: {
          hasMany: 'team_members',
          foreignKey: 'user_id',
          as: 'teamMemberships',
          sideLoad: true
        }
      }
    });
    
    api.addResource('projects', { 
      schema: projectsSchema,
      relationships: {
        members: {
          hasMany: 'project_members',
          foreignKey: 'project_id',
          as: 'members',
          sideLoad: true
        }
      }
    });
    
    api.addResource('skills', { 
      schema: skillsSchema,
      relationships: {
        users: {
          hasMany: 'user_skills',
          foreignKey: 'skill_id',
          as: 'users',
          sideLoad: true
        }
      }
    });
    
    api.addResource('teams', { 
      schema: teamsSchema,
      relationships: {
        members: {
          hasMany: 'team_members',
          foreignKey: 'team_id',
          as: 'members',
          sideLoad: true
        }
      }
    });
    
    // Register pivot tables as full resources
    api.addResource('project_members', { 
      schema: projectMembersSchema,
      searchSchema: {
        project_id: { type: 'number' },
        user_id: { type: 'number' },
        role: { type: 'string' },
        is_lead: { type: 'boolean' },
        min_hours: { 
          type: 'number',
          applyFilter: (query, value) => {
            query.where('hours_allocated', '>=', value);
          }
        }
      }
    });
    
    api.addResource('user_skills', { 
      schema: userSkillsSchema,
      searchSchema: {
        min_proficiency: { 
          type: 'number',
          applyFilter: (query, value) => {
            query.where('proficiency_level', '>=', value);
          }
        },
        is_primary: { type: 'boolean' },
        certified: { 
          type: 'boolean',
          applyFilter: (query, value) => {
            if (value) {
              query.whereNotNull('certified_at');
            } else {
              query.whereNull('certified_at');
            }
          }
        }
      }
    });
    
    api.addResource('team_members', { 
      schema: teamMembersSchema,
      searchSchema: {
        is_manager: { type: 'boolean' },
        position: { type: 'string', filterUsing: 'like' },
        active: {
          type: 'boolean',
          applyFilter: (query, value) => {
            if (value) {
              query.whereNull('left_at');
            } else {
              query.whereNotNull('left_at');
            }
          }
        }
      }
    });
  });
  
  afterEach(async () => {
    // Clean up
    await db.schema.dropTableIfExists('team_members');
    await db.schema.dropTableIfExists('user_skills');
    await db.schema.dropTableIfExists('project_members');
    await db.schema.dropTableIfExists('teams');
    await db.schema.dropTableIfExists('skills');
    await db.schema.dropTableIfExists('projects');
    await db.schema.dropTableIfExists('users');
    await db.destroy();
  });
  
  // Test 1: Query pivot table directly with filters
  test('should query pivot table as a full resource with filters', async () => {
    const response = await api.resources.project_members.query({
      queryParams: {
        filters: { is_lead: true }
      }
    });
    
    assert.strictEqual(response.data.length, 3); // 3 project leads
    response.data.forEach(member => {
      // SQLite returns 1 for true, need to compare appropriately
      assert.ok(member.attributes.is_lead === 1 || member.attributes.is_lead === true);
    });
  });
  
  // Test 2: Get single pivot table entry with all attributes
  test('should get pivot table entry with all attributes', async () => {
    const response = await api.resources.project_members.get({ id: '1' });
    
    assert.strictEqual(response.data.type, 'project_members');
    assert.strictEqual(response.data.id, '1');
    assert.strictEqual(response.data.attributes.role, 'lead-developer');
    assert.strictEqual(response.data.attributes.hours_allocated, 40); // Decimal type returned as number
    assert.strictEqual(response.data.attributes.is_lead, 1); // SQLite stores true as 1
    
    // Check relationships
    assert.deepStrictEqual(response.data.relationships.project, {
      data: { type: 'projects', id: '1' }
    });
    assert.deepStrictEqual(response.data.relationships.user, {
      data: { type: 'users', id: '1' }
    });
  });
  
  // Test 3: Query pivot table with includes
  test('should include related resources through pivot table', async () => {
    const response = await api.resources.project_members.query({
      queryParams: {
        filters: { project_id: 1 },
        include: ['project', 'user']
      }
    });
    
    assert.strictEqual(response.data.length, 3); // 3 members in project 1
    assert.ok(response.included);
    
    const includedProjects = response.included.filter(r => r.type === 'projects');
    const includedUsers = response.included.filter(r => r.type === 'users');
    
    assert.strictEqual(includedProjects.length, 1);
    assert.strictEqual(includedUsers.length, 3);
  });
  
  // Test 4: Complex queries on pivot table
  test('should support complex queries on pivot table attributes', async () => {
    const response = await api.resources.project_members.query({
      queryParams: {
        filters: { 
          role: 'developer',
          min_hours: 30
        }
      }
    });
    
    assert.strictEqual(response.data.length, 2);
    response.data.forEach(member => {
      assert.ok(member.attributes.role.includes('developer'));
      assert.ok(parseFloat(member.attributes.hours_allocated) >= 30);
    });
  });
  
  // Test 5: User skills with proficiency filtering
  test('should filter user skills by proficiency level', async () => {
    const response = await api.resources.user_skills.query({
      queryParams: {
        filters: { min_proficiency: 4 },
        include: ['user', 'skill']
      }
    });
    
    // Should find skills with proficiency 4 or 5
    response.data.forEach(userSkill => {
      assert.ok(userSkill.attributes.proficiency_level >= 4);
    });
    
    assert.ok(response.included);
  });
  
  // Test 6: Query primary skills
  test('should find primary skills for users', async () => {
    const response = await api.resources.user_skills.query({
      queryParams: {
        filters: { is_primary: true },
        include: ['user', 'skill']
      }
    });
    
    assert.strictEqual(response.data.length, 3); // 3 primary skills
    response.data.forEach(userSkill => {
      assert.strictEqual(userSkill.attributes.is_primary, 1); // SQLite stores true as 1
    });
  });
  
  // Test 7: Certified skills query
  test('should find certified skills', async () => {
    const response = await api.resources.user_skills.query({
      queryParams: {
        filters: { certified: true },
        include: ['skill']
      }
    });
    
    assert.strictEqual(response.data.length, 1);
    assert.strictEqual(response.data[0].attributes.certification_authority, 'PMI');
    assert.ok(response.data[0].attributes.certified_at);
  });
  
  // Test 8: Active team members
  test('should find active team members', async () => {
    const response = await api.resources.team_members.query({
      queryParams: {
        filters: { active: true },
        include: ['team', 'user']
      }
    });
    
    // All team members are active (no left_at date)
    assert.strictEqual(response.data.length, 5);
    response.data.forEach(member => {
      assert.strictEqual(member.attributes.left_at, null);
    });
  });
  
  // Test 9: Nested includes through enhanced many-to-many
  test('should support nested includes through pivot tables', async () => {
    const response = await api.resources.users.get({
      id: '1',
      queryParams: {
        include: ['projectMemberships.project', 'skills.skill']
      }
    });
    
    assert.strictEqual(response.data.type, 'users');
    assert.strictEqual(response.data.id, '1');
    
    assert.ok(response.included);
    
    const includedMemberships = response.included.filter(r => r.type === 'project_members');
    const includedProjects = response.included.filter(r => r.type === 'projects');
    const includedUserSkills = response.included.filter(r => r.type === 'user_skills');
    const includedSkills = response.included.filter(r => r.type === 'skills');
    
    assert.ok(includedMemberships.length > 0);
    assert.ok(includedProjects.length > 0);
    assert.ok(includedUserSkills.length > 0);
    assert.ok(includedSkills.length > 0);
  });
  
  // Test 10: Sort pivot table entries
  test('should sort pivot table entries', async () => {
    const response = await api.resources.project_members.query({
      queryParams: {
        sort: ['-hours_allocated']
      }
    });
    
    // Should be sorted by hours_allocated descending
    const hours = response.data.map(m => parseFloat(m.attributes.hours_allocated));
    for (let i = 1; i < hours.length; i++) {
      assert.ok(hours[i] <= hours[i - 1]);
    }
  });
  
  // Test 11: Pagination of pivot table
  test('should paginate pivot table results', async () => {
    const page1 = await api.resources.project_members.query({
      queryParams: {
        page: { size: 3, number: 1 },
        sort: ['id']
      }
    });
    
    const page2 = await api.resources.project_members.query({
      queryParams: {
        page: { size: 3, number: 2 },
        sort: ['id']
      }
    });
    
    assert.strictEqual(page1.data.length, 3);
    assert.strictEqual(page2.data.length, 3);
    assert.notStrictEqual(page1.data[0].id, page2.data[0].id);
  });
  
  // Test 12: Sparse fieldsets on pivot tables
  test('should support sparse fieldsets on pivot tables', async () => {
    const response = await api.resources.project_members.query({
      queryParams: {
        fields: { project_members: 'role,hours_allocated' }
      }
    });
    
    response.data.forEach(member => {
      // Should have requested fields
      assert.ok('role' in member.attributes);
      assert.ok('hours_allocated' in member.attributes);
      
      // Should not have non-requested fields
      assert.strictEqual(member.attributes.notes, undefined);
      assert.strictEqual(member.attributes.joined_at, undefined);
      
      // Relationships should still be included
      assert.ok(member.relationships);
    });
  });
});