/**
 * Real-World API Example: Companies with Offices
 * 
 * Schema:
 * - continents: Basic lookup table
 * - countries: Belong to continents
 * - companies: Headquartered in a country, have sensitive data
 * - offices: Companies have multiple offices in different countries
 * 
 * Features demonstrated:
 * - Nested relationships (company -> offices -> country -> continent)
 * - Field-level permissions (hide revenue from non-admin users)
 * - Automatic relationship loading
 * - Searchable fields for filtering
 * - Validation rules
 */

import { createApi, Schema } from '../index.js';
import express from 'express';

const app = express();
const api = createApi({ 
  storage: 'memory',
  http: { app }
});

// 1. CONTINENTS - Simple lookup table
api.addResource('continents', new Schema({
  name: { type: 'string', required: true },
  code: { type: 'string', required: true, length: 2 }
}));

// 2. COUNTRIES - Belong to continents
api.addResource('countries', new Schema({
  name: { type: 'string', required: true, searchable: true },
  code: { type: 'string', required: true, length: 3 },
  continentId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'continents',
      join: {
        eager: true,  // Always include continent info
        fields: ['id', 'name', 'code']
      }
    }
  },
  population: { type: 'number' },
  currency: { type: 'string' }
}));

// 3. COMPANIES - Main entity with sensitive data
api.addResource('companies', new Schema({
  name: { type: 'string', required: true, searchable: true },
  industry: { type: 'string', required: true, searchable: true },
  founded: { type: 'number', required: true },
  website: { type: 'string', format: 'url' },
  countryId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'countries',
      join: {
        eager: true,  // Include country (and nested continent)
        fields: ['id', 'name', 'code', 'continentId']
      }
    }
  },
  // Sensitive fields with permissions
  revenue: { 
    type: 'number',
    permissions: {
      read: ['admin', 'executive'],  // Only these roles can see
      write: 'admin'
    }
  },
  employeeCount: {
    type: 'number',
    permissions: {
      read: ['admin', 'executive', 'manager'],
      write: ['admin', 'hr']
    }
  },
  // Virtual field - list of offices
  offices: {
    type: 'list',
    virtual: true,
    foreignResource: 'offices',
    foreignKey: 'companyId',
    join: {
      eager: true,  // Auto-load offices
      include: ['countryId']  // Include country for each office
    }
  }
}));

// 4. OFFICES - Companies have multiple offices
api.addResource('offices', new Schema({
  name: { type: 'string', required: true },
  type: { 
    type: 'string', 
    required: true,
    enum: ['headquarters', 'regional', 'branch', 'r&d'],
    searchable: true
  },
  companyId: {
    type: 'id',
    required: true,
    searchable: true,  // Required for to-many relationships
    refs: {
      resource: 'companies',
      join: {
        fields: ['id', 'name']
      }
    }
  },
  countryId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'countries',
      join: {
        eager: true,  // Include country info
        fields: ['id', 'name', 'code', 'currency']
      }
    }
  },
  address: { type: 'string', required: true },
  phone: { type: 'string', format: 'phone' },
  employeeCount: { 
    type: 'number',
    permissions: {
      read: ['admin', 'executive', 'manager'],
      write: ['admin', 'hr']
    }
  }
}));

// Start server and create test data
app.listen(3000, async () => {
  console.log('🚀 Company API running on http://localhost:3000');
  
  // Create test data
  console.log('\n📝 Creating test data...');
  
  // Continents
  const europe = await api.resources.continents.create({
    name: 'Europe',
    code: 'EU'
  });
  
  const northAmerica = await api.resources.continents.create({
    name: 'North America',
    code: 'NA'
  });
  
  const asia = await api.resources.continents.create({
    name: 'Asia',
    code: 'AS'
  });
  
  // Countries
  const usa = await api.resources.countries.create({
    name: 'United States',
    code: 'USA',
    continentId: northAmerica.data.id,
    population: 331900000,
    currency: 'USD'
  });
  
  const uk = await api.resources.countries.create({
    name: 'United Kingdom',
    code: 'GBR',
    continentId: europe.data.id,
    population: 67500000,
    currency: 'GBP'
  });
  
  const germany = await api.resources.countries.create({
    name: 'Germany',
    code: 'DEU',
    continentId: europe.data.id,
    population: 83200000,
    currency: 'EUR'
  });
  
  const japan = await api.resources.countries.create({
    name: 'Japan',
    code: 'JPN',
    continentId: asia.data.id,
    population: 125800000,
    currency: 'JPY'
  });
  
  // Companies
  const techCorp = await api.resources.companies.create({
    name: 'TechCorp Global',
    industry: 'Technology',
    founded: 2010,
    website: 'https://techcorp.example.com',
    countryId: usa.data.id,
    revenue: 5000000000,  // Hidden from regular users
    employeeCount: 25000
  });
  
  const financeInc = await api.resources.companies.create({
    name: 'Finance Industries',
    industry: 'Financial Services',
    founded: 1985,
    website: 'https://financeinc.example.com',
    countryId: uk.data.id,
    revenue: 3000000000,
    employeeCount: 15000
  });
  
  // Offices for TechCorp
  await api.resources.offices.create({
    name: 'TechCorp HQ',
    type: 'headquarters',
    companyId: techCorp.data.id,
    countryId: usa.data.id,
    address: '123 Silicon Valley Blvd, CA 94025',
    phone: '+1-650-555-0100',
    employeeCount: 5000
  });
  
  await api.resources.offices.create({
    name: 'TechCorp Europe',
    type: 'regional',
    companyId: techCorp.data.id,
    countryId: uk.data.id,
    address: '456 Tech Street, London EC2A 1AE',
    phone: '+44-20-7555-0100',
    employeeCount: 2000
  });
  
  await api.resources.offices.create({
    name: 'TechCorp R&D Center',
    type: 'r&d',
    companyId: techCorp.data.id,
    countryId: japan.data.id,
    address: '789 Innovation Ave, Tokyo 100-0001',
    phone: '+81-3-5555-0100',
    employeeCount: 1500
  });
  
  await api.resources.offices.create({
    name: 'TechCorp Germany',
    type: 'branch',
    companyId: techCorp.data.id,
    countryId: germany.data.id,
    address: '321 Technik Str, Berlin 10115',
    phone: '+49-30-5555-0100',
    employeeCount: 800
  });
  
  // Offices for Finance Industries
  await api.resources.offices.create({
    name: 'Finance Industries HQ',
    type: 'headquarters',
    companyId: financeInc.data.id,
    countryId: uk.data.id,
    address: '100 Financial District, London EC3N 4SG',
    phone: '+44-20-7555-0200',
    employeeCount: 8000
  });
  
  await api.resources.offices.create({
    name: 'Finance Industries USA',
    type: 'regional',
    companyId: financeInc.data.id,
    countryId: usa.data.id,
    address: '200 Wall Street, NY 10005',
    phone: '+1-212-555-0200',
    employeeCount: 3000
  });
  
  console.log('\n✅ Test data created!');
  console.log('\n📍 Try these requests:');
  console.log('\n1. Get a company with all offices and nested country info:');
  console.log('   GET http://localhost:3000/companies/1');
  console.log('   → Returns company with offices array, each office includes country');
  console.log('\n2. Test permissions (revenue hidden without admin role):');
  console.log('   GET http://localhost:3000/companies/1');
  console.log('   GET http://localhost:3000/companies/1 (with Header: X-User-Role: admin)');
  console.log('\n3. Filter companies by industry:');
  console.log('   GET http://localhost:3000/companies?filter[industry]=Technology');
  console.log('\n4. Filter offices by type:');
  console.log('   GET http://localhost:3000/offices?filter[type]=headquarters');
  console.log('\n5. Search countries:');
  console.log('   GET http://localhost:3000/countries?filter[name]=United');
  
  // Demonstrate permissions
  console.log('\n🔐 Permission Example:');
  
  // Query as regular user (no revenue field)
  const regularUserResult = await api.resources.companies.get(techCorp.data.id, {
    user: { roles: ['user'] }
  });
  
  // Query as admin (includes revenue)
  const adminResult = await api.resources.companies.get(techCorp.data.id, {
    user: { roles: ['admin'] }
  });
  
  console.log('\nRegular user sees:', Object.keys(regularUserResult.data.attributes));
  console.log('Admin user sees:', Object.keys(adminResult.data.attributes));
  console.log('\n(Notice admin can see "revenue" field)');
});