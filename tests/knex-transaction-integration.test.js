import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';

describe('Comprehensive Transaction Integration Tests', () => {
  let api;
  let knex;
  
  beforeEach(async () => {
    // Reset the global registry
    resetGlobalRegistryForTesting();
    
    // Create in-memory SQLite database
    knex = knexConfig({
      client: 'sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });
    
    // Create comprehensive test schema
    await knex.schema.createTable('organizations', table => {
      table.increments('id');
      table.string('name');
      table.string('type');
    });
    
    await knex.schema.createTable('departments', table => {
      table.increments('id');
      table.string('name');
      table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
      table.integer('budget');
    });
    
    await knex.schema.createTable('employees', table => {
      table.increments('id');
      table.string('name');
      table.string('email').unique();
      table.integer('department_id').references('id').inTable('departments').onDelete('SET NULL');
      table.integer('salary');
      table.string('position');
    });
    
    await knex.schema.createTable('projects', table => {
      table.increments('id');
      table.string('name');
      table.string('status');
      table.integer('department_id').references('id').inTable('departments');
      table.date('start_date');
      table.date('end_date');
      table.integer('budget');
    });
    
    await knex.schema.createTable('skills', table => {
      table.increments('id');
      table.string('name');
      table.string('category');
    });
    
    // Many-to-many: employees-projects
    await knex.schema.createTable('project_assignments', table => {
      table.increments('id');
      table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE');
      table.integer('employee_id').references('id').inTable('employees').onDelete('CASCADE');
      table.string('role');
      table.integer('hours_allocated');
      table.unique(['project_id', 'employee_id']);
    });
    
    // Many-to-many: employees-skills
    await knex.schema.createTable('employee_skills', table => {
      table.increments('id');
      table.integer('employee_id').references('id').inTable('employees').onDelete('CASCADE');
      table.integer('skill_id').references('id').inTable('skills').onDelete('CASCADE');
      table.integer('level'); // 1-5
      table.unique(['employee_id', 'skill_id']);
    });
    
    await knex.schema.createTable('audit_logs', table => {
      table.increments('id');
      table.string('action');
      table.string('resource_type');
      table.integer('resource_id');
      table.string('details');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    
    // Insert test data
    await knex('organizations').insert([
      { id: 1, name: 'TechCorp', type: 'technology' },
      { id: 2, name: 'FinanceInc', type: 'finance' }
    ]);
    
    await knex('departments').insert([
      { id: 1, name: 'Engineering', organization_id: 1, budget: 1000000 },
      { id: 2, name: 'Sales', organization_id: 1, budget: 500000 },
      { id: 3, name: 'Trading', organization_id: 2, budget: 2000000 }
    ]);
    
    await knex('employees').insert([
      { id: 1, name: 'Alice', email: 'alice@tech.com', department_id: 1, salary: 100000, position: 'Senior Engineer' },
      { id: 2, name: 'Bob', email: 'bob@tech.com', department_id: 1, salary: 80000, position: 'Engineer' },
      { id: 3, name: 'Carol', email: 'carol@tech.com', department_id: 2, salary: 90000, position: 'Sales Manager' },
      { id: 4, name: 'Dave', email: 'dave@fin.com', department_id: 3, salary: 120000, position: 'Trader' }
    ]);
    
    await knex('projects').insert([
      { id: 1, name: 'Website Redesign', status: 'active', department_id: 1, start_date: '2024-01-01', budget: 100000 },
      { id: 2, name: 'Mobile App', status: 'planning', department_id: 1, start_date: '2024-06-01', budget: 200000 },
      { id: 3, name: 'Sales Campaign', status: 'active', department_id: 2, start_date: '2024-02-01', budget: 50000 }
    ]);
    
    await knex('skills').insert([
      { id: 1, name: 'JavaScript', category: 'Programming' },
      { id: 2, name: 'Python', category: 'Programming' },
      { id: 3, name: 'Project Management', category: 'Management' },
      { id: 4, name: 'Sales', category: 'Business' }
    ]);
    
    await knex('project_assignments').insert([
      { project_id: 1, employee_id: 1, role: 'Lead Developer', hours_allocated: 160 },
      { project_id: 1, employee_id: 2, role: 'Developer', hours_allocated: 160 },
      { project_id: 3, employee_id: 3, role: 'Project Manager', hours_allocated: 80 }
    ]);
    
    await knex('employee_skills').insert([
      { employee_id: 1, skill_id: 1, level: 5 },
      { employee_id: 1, skill_id: 3, level: 3 },
      { employee_id: 2, skill_id: 1, level: 3 },
      { employee_id: 3, skill_id: 4, level: 5 }
    ]);
    
    // Create API instance
    api = new Api({
      name: 'test-api',
      version: '1.0.0'
    });
    
    // Install plugins
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      returnFullRecord: {
        post: true,
        put: true,
        patch: true
      }
    });
    
    await api.use(RestApiKnexPlugin, {
      knex: knex
    });
    
    // Define resources
    api.addResource('organizations', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        type: { type: 'string' }
      },
      relationships: {
        departments: {
          hasMany: 'departments',
          foreignKey: 'organization_id'
        }
      }
    });
    
    api.addResource('departments', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        organization_id: {
          type: 'number',
          belongsTo: 'organizations',
          as: 'organization'
        },
        budget: { type: 'number' }
      },
      relationships: {
        employees: {
          hasMany: 'employees',
          foreignKey: 'department_id'
        },
        projects: {
          hasMany: 'projects',
          foreignKey: 'department_id'
        }
      }
    });
    
    api.addResource('employees', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        department_id: {
          type: 'number',
          belongsTo: 'departments',
          as: 'department'
        },
        salary: { type: 'number' },
        position: { type: 'string' }
      },
      relationships: {
        projects: {
          manyToMany: {
            through: 'project_assignments',
            foreignKey: 'employee_id',
            otherKey: 'project_id'
          }
        },
        skills: {
          manyToMany: {
            through: 'employee_skills',
            foreignKey: 'employee_id',
            otherKey: 'skill_id'
          }
        }
      }
    });
    
    api.addResource('projects', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        status: { type: 'string' },
        department_id: {
          type: 'number',
          belongsTo: 'departments',
          as: 'department'
        },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        budget: { type: 'number' }
      },
      relationships: {
        employees: {
          manyToMany: {
            through: 'project_assignments',
            foreignKey: 'project_id',
            otherKey: 'employee_id'
          }
        }
      }
    });
    
    api.addResource('skills', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        category: { type: 'string' }
      }
    });
    
    api.addResource('audit_logs', {
      schema: {
        id: { type: 'id' },
        action: { type: 'string', required: true },
        resource_type: { type: 'string', required: true },
        resource_id: { type: 'number', required: true },
        details: { type: 'string' },
        created_at: { type: 'string' }
      }
    });
  });
  
  afterEach(async () => {
    await knex.destroy();
  });
  
  describe('Multi-Resource Transaction Scenarios', () => {
    test('should handle complex multi-resource creation in single transaction', async () => {
      const trx = await knex.transaction();
      
      try {
        // Create a new department
        const deptResult = await api.scopes.departments.post({
          inputRecord: {
            data: {
              type: 'departments',
              attributes: {
                name: 'Research',
                budget: 750000
              },
              relationships: {
                organization: {
                  data: { type: 'organizations', id: '1' }
                }
              }
            }
          },
          transaction: trx
        });
        
        const deptId = deptResult.data.id;
        
        // Create new employee in that department
        const empResult = await api.scopes.employees.post({
          inputRecord: {
            data: {
              type: 'employees',
              attributes: {
                name: 'Eve',
                email: 'eve@tech.com',
                salary: 95000,
                position: 'Researcher'
              },
              relationships: {
                department: {
                  data: { type: 'departments', id: deptId }
                },
                skills: {
                  data: [
                    { type: 'skills', id: '1' },
                    { type: 'skills', id: '2' }
                  ]
                }
              }
            }
          },
          transaction: trx
        });
        
        const empId = empResult.data.id;
        
        // Create new project and assign the employee
        const projResult = await api.scopes.projects.post({
          inputRecord: {
            data: {
              type: 'projects',
              attributes: {
                name: 'AI Research',
                status: 'planning',
                start_date: '2024-07-01',
                budget: 300000
              },
              relationships: {
                department: {
                  data: { type: 'departments', id: deptId }
                },
                employees: {
                  data: [
                    { type: 'employees', id: empId }
                  ]
                }
              }
            }
          },
          transaction: trx
        });
        
        // Log the operation
        await api.scopes.audit_logs.post({
          inputRecord: {
            data: {
              type: 'audit_logs',
              attributes: {
                action: 'created_research_department',
                resource_type: 'departments',
                resource_id: parseInt(deptId),
                details: 'Created Research department with employee and project'
              }
            }
          },
          transaction: trx
        });
        
        // Verify all creations succeeded within transaction
        const deptInTrx = await trx('departments').where('id', deptId).first();
        assert.ok(deptInTrx);
        assert.strictEqual(deptInTrx.name, 'Research');
        
        const empInTrx = await trx('employees').where('id', empId).first();
        assert.ok(empInTrx);
        assert.strictEqual(empInTrx.name, 'Eve');
        
        const projInTrx = await trx('projects').where('id', projResult.data.id).first();
        assert.ok(projInTrx);
        assert.strictEqual(projInTrx.name, 'AI Research');
        
        // But not visible outside transaction yet
        const deptOutside = await knex('departments').where('name', 'Research').first();
        assert.ok(!deptOutside);
        
        // Commit
        await trx.commit();
        
        // Now verify everything is persisted
        const deptAfter = await knex('departments').where('name', 'Research').first();
        assert.ok(deptAfter);
        
        const empAfter = await knex('employees').where('email', 'eve@tech.com').first();
        assert.ok(empAfter);
        
        const projAfter = await knex('projects').where('name', 'AI Research').first();
        assert.ok(projAfter);
        
        const auditLog = await knex('audit_logs').where('action', 'created_research_department').first();
        assert.ok(auditLog);
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
    
    test('should rollback entire transaction on any failure', async () => {
      const initialDeptCount = await knex('departments').count('* as count');
      const initialEmpCount = await knex('employees').count('* as count');
      const initialProjCount = await knex('projects').count('* as count');
      
      const trx = await knex.transaction();
      
      try {
        // Create department (should succeed)
        const deptResult = await api.scopes.departments.post({
          inputRecord: {
            data: {
              type: 'departments',
              attributes: {
                name: 'Temporary Dept',
                budget: 100000
              },
              relationships: {
                organization: {
                  data: { type: 'organizations', id: '1' }
                }
              }
            }
          },
          transaction: trx
        });
        
        // Create employee (should succeed)
        await api.scopes.employees.post({
          inputRecord: {
            data: {
              type: 'employees',
              attributes: {
                name: 'Temp Employee',
                email: 'temp@tech.com',
                salary: 50000,
                position: 'Temp'
              },
              relationships: {
                department: {
                  data: { type: 'departments', id: deptResult.data.id }
                }
              }
            }
          },
          transaction: trx
        });
        
        // Create project with invalid department (should fail)
        await api.scopes.projects.post({
          inputRecord: {
            data: {
              type: 'projects',
              attributes: {
                name: 'Failed Project',
                status: 'active',
                budget: 50000
              },
              relationships: {
                department: {
                  data: { type: 'departments', id: '999' } // Non-existent
                }
              }
            }
          },
          transaction: trx
        });
        
        await trx.commit();
        assert.fail('Should have thrown error');
      } catch (error) {
        await trx.rollback();
        // Expected to fail
      }
      
      // Verify nothing was created
      const finalDeptCount = await knex('departments').count('* as count');
      const finalEmpCount = await knex('employees').count('* as count');
      const finalProjCount = await knex('projects').count('* as count');
      
      assert.strictEqual(finalDeptCount[0].count, initialDeptCount[0].count);
      assert.strictEqual(finalEmpCount[0].count, initialEmpCount[0].count);
      assert.strictEqual(finalProjCount[0].count, initialProjCount[0].count);
    });
  });
  
  describe('Complex Update Transactions', () => {
    test('should handle cascading updates across multiple resources', async () => {
      const trx = await knex.transaction();
      
      try {
        // Update department budget
        await api.scopes.departments.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'departments',
              id: '1',
              attributes: {
                budget: 1500000 // Increase budget
              }
            }
          },
          transaction: trx
        });
        
        // Give raises to all employees in the department
        const employees = await trx('employees').where('department_id', 1);
        
        for (const emp of employees) {
          await api.scopes.employees.patch({
            id: emp.id.toString(),
            inputRecord: {
              data: {
                type: 'employees',
                id: emp.id.toString(),
                attributes: {
                  salary: Math.floor(emp.salary * 1.1) // 10% raise
                }
              }
            },
            transaction: trx
          });
        }
        
        // Update project budgets
        const projects = await trx('projects').where('department_id', 1);
        
        for (const proj of projects) {
          await api.scopes.projects.patch({
            id: proj.id.toString(),
            inputRecord: {
              data: {
                type: 'projects',
                id: proj.id.toString(),
                attributes: {
                  budget: Math.floor(proj.budget * 1.2) // 20% increase
                }
              }
            },
            transaction: trx
          });
        }
        
        // Add audit log
        await api.scopes.audit_logs.post({
          inputRecord: {
            data: {
              type: 'audit_logs',
              attributes: {
                action: 'budget_increase',
                resource_type: 'departments',
                resource_id: 1,
                details: 'Increased department budget and gave raises'
              }
            }
          },
          transaction: trx
        });
        
        // Verify changes in transaction
        const deptInTrx = await trx('departments').where('id', 1).first();
        assert.strictEqual(deptInTrx.budget, 1500000);
        
        const emp1InTrx = await trx('employees').where('id', 1).first();
        assert.strictEqual(emp1InTrx.salary, 110000); // 100000 * 1.1
        
        await trx.commit();
        
        // Verify all changes persisted
        const deptAfter = await knex('departments').where('id', 1).first();
        assert.strictEqual(deptAfter.budget, 1500000);
        
        const employeesAfter = await knex('employees').where('department_id', 1);
        assert.ok(employeesAfter.every(emp => emp.salary > 80000)); // All got raises
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
    
    test('should handle complex relationship updates in transaction', async () => {
      const trx = await knex.transaction();
      
      try {
        // Move employee to different department
        await api.scopes.employees.patch({
          id: '2',
          inputRecord: {
            data: {
              type: 'employees',
              id: '2',
              relationships: {
                department: {
                  data: { type: 'departments', id: '2' } // Move Bob to Sales
                }
              }
            }
          },
          transaction: trx
        });
        
        // Remove Bob from current project
        await api.scopes.projects.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'projects',
              id: '1',
              relationships: {
                employees: {
                  data: [
                    { type: 'employees', id: '1' } // Only Alice remains
                  ]
                }
              }
            }
          },
          transaction: trx
        });
        
        // Add Bob to sales project
        await api.scopes.projects.patch({
          id: '3',
          inputRecord: {
            data: {
              type: 'projects',
              id: '3',
              relationships: {
                employees: {
                  data: [
                    { type: 'employees', id: '3' }, // Carol
                    { type: 'employees', id: '2' }  // Bob (new)
                  ]
                }
              }
            }
          },
          transaction: trx
        });
        
        // Update Bob's skills for new role
        await api.scopes.employees.patch({
          id: '2',
          inputRecord: {
            data: {
              type: 'employees',
              id: '2',
              relationships: {
                skills: {
                  data: [
                    { type: 'skills', id: '4' } // Sales skill
                  ]
                }
              }
            }
          },
          transaction: trx
        });
        
        await trx.commit();
        
        // Verify all changes
        const bob = await knex('employees').where('id', 2).first();
        assert.strictEqual(bob.department_id, 2);
        
        const project1Employees = await knex('project_assignments').where('project_id', 1);
        assert.strictEqual(project1Employees.length, 1);
        assert.ok(!project1Employees.some(pa => pa.employee_id === 2));
        
        const project3Employees = await knex('project_assignments').where('project_id', 3);
        assert.ok(project3Employees.some(pa => pa.employee_id === 2));
        
        const bobSkills = await knex('employee_skills').where('employee_id', 2);
        assert.strictEqual(bobSkills.length, 1);
        assert.strictEqual(bobSkills[0].skill_id, 4);
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
  });
  
  describe('Bulk Operations in Transactions', () => {
    test('should handle bulk creates in single transaction', async () => {
      const trx = await knex.transaction();
      
      try {
        // Create multiple new employees
        const newEmployees = [];
        for (let i = 0; i < 5; i++) {
          const result = await api.scopes.employees.post({
            inputRecord: {
              data: {
                type: 'employees',
                attributes: {
                  name: `New Employee ${i}`,
                  email: `newemp${i}@tech.com`,
                  salary: 60000 + (i * 5000),
                  position: 'Junior Developer'
                },
                relationships: {
                  department: {
                    data: { type: 'departments', id: '1' }
                  },
                  skills: {
                    data: [
                      { type: 'skills', id: '1' } // All have JavaScript
                    ]
                  }
                }
              }
            },
            transaction: trx
          });
          newEmployees.push(result.data.id);
        }
        
        // Create a new project and assign all new employees
        const projResult = await api.scopes.projects.post({
          inputRecord: {
            data: {
              type: 'projects',
              attributes: {
                name: 'Onboarding Project',
                status: 'active',
                budget: 50000,
                start_date: '2024-03-01'
              },
              relationships: {
                department: {
                  data: { type: 'departments', id: '1' }
                },
                employees: {
                  data: newEmployees.map(id => ({ type: 'employees', id: id.toString() }))
                }
              }
            }
          },
          transaction: trx
        });
        
        // Verify in transaction
        const empCount = await trx('employees').where('position', 'Junior Developer').count('* as count');
        assert.strictEqual(empCount[0].count, 5);
        
        const assignments = await trx('project_assignments').where('project_id', projResult.data.id);
        assert.strictEqual(assignments.length, 5);
        
        await trx.commit();
        
        // Verify after commit
        const finalEmpCount = await knex('employees').where('position', 'Junior Developer').count('* as count');
        assert.strictEqual(finalEmpCount[0].count, 5);
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
    
    test('should handle bulk deletes in transaction with proper cascading', async () => {
      const trx = await knex.transaction();
      
      try {
        // Count initial state
        const initialProjects = await knex('projects').count('* as count');
        const initialAssignments = await knex('project_assignments').count('* as count');
        
        // Delete entire department (should cascade)
        await api.scopes.departments.delete({
          id: '2',
          transaction: trx
        });
        
        // In transaction, department and related data should be gone
        const deptInTrx = await trx('departments').where('id', 2).first();
        assert.ok(!deptInTrx);
        
        // Employees should have null department_id (SET NULL)
        const carol = await trx('employees').where('id', 3).first();
        assert.strictEqual(carol.department_id, null);
        
        // Projects should be deleted (CASCADE)
        const salesProjects = await trx('projects').where('department_id', 2);
        assert.strictEqual(salesProjects.length, 0);
        
        // But outside transaction, everything still exists
        const deptOutside = await knex('departments').where('id', 2).first();
        assert.ok(deptOutside);
        
        await trx.commit();
        
        // Verify cascading worked
        const finalDept = await knex('departments').where('id', 2).first();
        assert.ok(!finalDept);
        
        const finalCarol = await knex('employees').where('id', 3).first();
        assert.strictEqual(finalCarol.department_id, null);
        
        const finalProjects = await knex('projects').count('* as count');
        assert.ok(finalProjects[0].count < initialProjects[0].count);
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
  });
  
  describe('Transaction Isolation and Concurrency', () => {
    test('should handle concurrent transactions independently', async () => {
      const trx1 = await knex.transaction();
      const trx2 = await knex.transaction();
      
      try {
        // Transaction 1: Update employee salary
        await api.scopes.employees.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'employees',
              id: '1',
              attributes: {
                salary: 120000
              }
            }
          },
          transaction: trx1
        });
        
        // Transaction 2: Update same employee's position
        await api.scopes.employees.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'employees',
              id: '1',
              attributes: {
                position: 'Principal Engineer'
              }
            }
          },
          transaction: trx2
        });
        
        // Check isolation - each transaction sees its own changes
        const emp1InTrx1 = await trx1('employees').where('id', 1).first();
        assert.strictEqual(emp1InTrx1.salary, 120000);
        assert.strictEqual(emp1InTrx1.position, 'Senior Engineer'); // Original position
        
        const emp1InTrx2 = await trx2('employees').where('id', 1).first();
        assert.strictEqual(emp1InTrx2.salary, 100000); // Original salary
        assert.strictEqual(emp1InTrx2.position, 'Principal Engineer');
        
        // Commit transaction 1
        await trx1.commit();
        
        // Transaction 2 still sees original data
        const emp1StillInTrx2 = await trx2('employees').where('id', 1).first();
        assert.strictEqual(emp1StillInTrx2.salary, 100000);
        
        // Rollback transaction 2
        await trx2.rollback();
        
        // Final state: only transaction 1's changes persist
        const finalEmp = await knex('employees').where('id', 1).first();
        assert.strictEqual(finalEmp.salary, 120000);
        assert.strictEqual(finalEmp.position, 'Senior Engineer');
      } catch (error) {
        await trx1.rollback().catch(() => {});
        await trx2.rollback().catch(() => {});
        throw error;
      }
    });
  });
  
  describe('Error Recovery and Partial Rollback', () => {
    test('should handle savepoints for partial rollback (if supported)', async () => {
      // Note: SQLite doesn't support savepoints in the same way as PostgreSQL
      // This test demonstrates the pattern for databases that do support them
      
      const trx = await knex.transaction();
      
      try {
        // First operation
        await api.scopes.departments.post({
          inputRecord: {
            data: {
              type: 'departments',
              attributes: {
                name: 'Operations',
                budget: 300000
              },
              relationships: {
                organization: {
                  data: { type: 'organizations', id: '1' }
                }
              }
            }
          },
          transaction: trx
        });
        
        // Would create savepoint here in PostgreSQL
        // await trx.raw('SAVEPOINT before_employee_ops');
        
        try {
          // Try to create employee with duplicate email (should fail)
          await api.scopes.employees.post({
            inputRecord: {
              data: {
                type: 'employees',
                attributes: {
                  name: 'Duplicate Dave',
                  email: 'alice@tech.com', // Duplicate email
                  salary: 70000,
                  position: 'Operator'
                }
              }
            },
            transaction: trx
          });
        } catch (error) {
          // Would rollback to savepoint in PostgreSQL
          // await trx.raw('ROLLBACK TO SAVEPOINT before_employee_ops');
          
          // For SQLite, we just continue since the failed operation doesn't affect the transaction
        }
        
        // Continue with other operations
        await api.scopes.audit_logs.post({
          inputRecord: {
            data: {
              type: 'audit_logs',
              attributes: {
                action: 'created_operations_dept',
                resource_type: 'departments',
                resource_id: 4,
                details: 'Created new Operations department'
              }
            }
          },
          transaction: trx
        });
        
        await trx.commit();
        
        // Verify department was created but not the duplicate employee
        const dept = await knex('departments').where('name', 'Operations').first();
        assert.ok(dept);
        
        const duplicateEmp = await knex('employees').where('name', 'Duplicate Dave').first();
        assert.ok(!duplicateEmp);
        
        const auditLog = await knex('audit_logs').where('action', 'created_operations_dept').first();
        assert.ok(auditLog);
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
  });
  
  describe('Transaction with Complex Business Logic', () => {
    test('should handle employee transfer with all implications', async () => {
      const trx = await knex.transaction();
      
      try {
        const employeeId = '1'; // Alice
        const fromDeptId = '1'; // Engineering
        const toDeptId = '3'; // Trading
        
        // Get employee's current projects
        const currentProjects = await trx('project_assignments')
          .where('employee_id', employeeId)
          .pluck('project_id');
        
        // Remove from all current projects
        for (const projectId of currentProjects) {
          const currentAssignments = await trx('project_assignments')
            .where('project_id', projectId)
            .whereNot('employee_id', employeeId)
            .pluck('employee_id');
          
          await api.scopes.projects.patch({
            id: projectId.toString(),
            inputRecord: {
              data: {
                type: 'projects',
                id: projectId.toString(),
                relationships: {
                  employees: {
                    data: currentAssignments.map(empId => ({
                      type: 'employees',
                      id: empId.toString()
                    }))
                  }
                }
              }
            },
            transaction: trx
          });
        }
        
        // Update employee department and give raise for transfer
        await api.scopes.employees.patch({
          id: employeeId,
          inputRecord: {
            data: {
              type: 'employees',
              id: employeeId,
              attributes: {
                salary: 130000, // Raise from 100000
                position: 'Senior Trader'
              },
              relationships: {
                department: {
                  data: { type: 'departments', id: toDeptId }
                }
              }
            }
          },
          transaction: trx
        });
        
        // Update employee skills for new role
        await api.scopes.employees.patch({
          id: employeeId,
          inputRecord: {
            data: {
              type: 'employees',
              id: employeeId,
              relationships: {
                skills: {
                  data: [
                    { type: 'skills', id: '2' }, // Keep Python
                    { type: 'skills', id: '3' }  // Keep Project Management
                    // Remove JavaScript skill
                  ]
                }
              }
            }
          },
          transaction: trx
        });
        
        // Create audit log
        await api.scopes.audit_logs.post({
          inputRecord: {
            data: {
              type: 'audit_logs',
              attributes: {
                action: 'employee_transfer',
                resource_type: 'employees',
                resource_id: parseInt(employeeId),
                details: `Transferred from dept ${fromDeptId} to dept ${toDeptId} with promotion`
              }
            }
          },
          transaction: trx
        });
        
        await trx.commit();
        
        // Verify all changes
        const alice = await knex('employees').where('id', 1).first();
        assert.strictEqual(alice.department_id, 3);
        assert.strictEqual(alice.salary, 130000);
        assert.strictEqual(alice.position, 'Senior Trader');
        
        const aliceProjects = await knex('project_assignments').where('employee_id', 1);
        assert.strictEqual(aliceProjects.length, 0);
        
        const aliceSkills = await knex('employee_skills').where('employee_id', 1);
        assert.strictEqual(aliceSkills.length, 2);
        assert.ok(!aliceSkills.some(es => es.skill_id === 1)); // No JavaScript
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    });
  });
});