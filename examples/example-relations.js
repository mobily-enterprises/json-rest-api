import { createApi, Schema } from '../index.js';
import express from 'express';

const app = express();
const api = createApi({ 
  storage: 'memory',
  http: { app }
});

// Define Countries resource
api.addResource('countries', new Schema({
  name: { type: 'string', required: true },
  code: { type: 'string', required: true, length: 2 }
}));

// Define Departments resource
api.addResource('departments', new Schema({
  name: { type: 'string', required: true },
  budget: { type: 'number' }
}));

// Define People resource
api.addResource('people', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  departmentId: {
    type: 'id',
    refs: {
      resource: 'departments',
      join: {
        eager: true,  // Auto-include department
        fields: ['id', 'name']
      }
    }
  },
  // Virtual field for projects (reverse relationship)
  projects: {
    type: 'list',
    virtual: true,
    foreignResource: 'projects',
    foreignKey: 'personId',
    join: {
      eager: true,  // Auto-include projects
      include: ['countryId']  // Include country for each project
    }
  }
}));

// Define Projects resource
api.addResource('projects', new Schema({
  name: { type: 'string', required: true },
  personId: {
    type: 'id',
    required: true,
    searchable: true,  // Required for to-many relationships
    refs: {
      resource: 'people',
      join: {
        fields: ['id', 'name']
      }
    }
  },
  countryId: {
    type: 'id',
    refs: {
      resource: 'countries',
      join: {
        eager: true,  // Auto-include country
        fields: ['id', 'name', 'code']
      }
    }
  },
  budget: { type: 'number' },
  status: { type: 'string', default: 'active' }
}));

app.listen(3000, async () => {
  console.log('API running on http://localhost:3000');
  
  // Create test data
  console.log('\nCreating test data...');
  
  // Create countries
  const usa = await api.resources.countries.create({
    name: 'United States',
    code: 'US'
  });
  
  const uk = await api.resources.countries.create({
    name: 'United Kingdom',
    code: 'UK'
  });
  
  const japan = await api.resources.countries.create({
    name: 'Japan',
    code: 'JP'
  });
  
  // Create departments
  const engineering = await api.resources.departments.create({
    name: 'Engineering',
    budget: 1000000
  });
  
  const marketing = await api.resources.departments.create({
    name: 'Marketing',
    budget: 500000
  });
  
  // Create people
  const alice = await api.resources.people.create({
    name: 'Alice Johnson',
    email: 'alice@example.com',
    departmentId: engineering.data.id
  });
  
  const bob = await api.resources.people.create({
    name: 'Bob Smith',
    email: 'bob@example.com',
    departmentId: marketing.data.id
  });
  
  // Create projects for Alice
  await api.resources.projects.create({
    name: 'Mobile App Development',
    personId: alice.data.id,
    countryId: usa.data.id,
    budget: 150000
  });
  
  await api.resources.projects.create({
    name: 'Web Platform Redesign',
    personId: alice.data.id,
    countryId: uk.data.id,
    budget: 200000
  });
  
  await api.resources.projects.create({
    name: 'API Integration',
    personId: alice.data.id,
    countryId: japan.data.id,
    budget: 100000
  });
  
  // Create projects for Bob
  await api.resources.projects.create({
    name: 'Marketing Campaign',
    personId: bob.data.id,
    countryId: usa.data.id,
    budget: 50000
  });
  
  console.log('\nTest data created!');
  console.log('\nTry these URLs:');
  console.log('GET http://localhost:3000/people/1');
  console.log('  -> Returns Alice with department info and all projects (with country info)');
  console.log('\nGET http://localhost:3000/people');
  console.log('  -> Returns all people with their projects and countries');
  console.log('\nGET http://localhost:3000/projects?filter[personId]=1');
  console.log('  -> Returns all projects for person 1');
});