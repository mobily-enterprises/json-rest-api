import { createApi, Schema } from '../index.js';

// Create API with memory storage
const api = createApi({ 
  storage: 'memory',
  debug: true 
});

// Define schemas with field permissions

// Countries - public data
api.addResource('countries', new Schema({
  name: { type: 'string', required: true },
  code: { type: 'string', required: true },
  gdp: { 
    type: 'number',
    permissions: { read: 'analyst' } // Only analysts can see GDP
  }
}));

// Users with field-level permissions
api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { 
    type: 'string', 
    required: true,
    permissions: { read: 'authenticated' } // Must be logged in to see email
  },
  salary: {
    type: 'number',
    permissions: { 
      read: ['hr', 'manager', 'self'] // HR, managers, or the user themselves
    }
  },
  internalNotes: {
    type: 'string',
    permissions: { read: false } // Never exposed in API
  },
  countryId: {
    type: 'id',
    refs: { resource: 'countries' },
    permissions: {
      read: true,              // Anyone can see the country ID
      include: 'authenticated' // Must be logged in to include country data
    }
  }
}));

// Posts with author relationship
api.addResource('posts', new Schema({
  title: { type: 'string', required: true, searchable: true },
  content: { type: 'string' },
  draft: {
    type: 'boolean',
    default: false,
    searchable: true
  },
  authorId: {
    type: 'id',
    refs: { 
      resource: 'users',
      join: {
        eager: false, // Don't auto-include
        fields: ['id', 'name'] // When included, only show these fields
      }
    }
  },
  publishedAt: { type: 'timestamp' }
}));

// Connect and seed data
await api.connect();

// Create test data
const usa = await api.insert({
  name: 'United States',
  code: 'US',
  gdp: 21000000000000
}, { type: 'countries' });

const uk = await api.insert({
  name: 'United Kingdom', 
  code: 'UK',
  gdp: 2800000000000
}, { type: 'countries' });

const alice = await api.insert({
  name: 'Alice Johnson',
  email: 'alice@example.com',
  salary: 95000,
  internalNotes: 'Great team player',
  countryId: usa.data.id
}, { type: 'users' });

const bob = await api.insert({
  name: 'Bob Smith',
  email: 'bob@example.com', 
  salary: 105000,
  internalNotes: 'Needs leadership training',
  countryId: uk.data.id
}, { type: 'users' });

const post1 = await api.insert({
  title: 'Introduction to Field Permissions',
  content: 'Learn how to secure your API with field-level permissions...',
  authorId: alice.data.id,
  publishedAt: Date.now()
}, { type: 'posts' });

const post2 = await api.insert({
  title: 'Nested Includes Guide',
  content: 'Deep dive into nested relationship includes...',
  authorId: bob.data.id,
  draft: true
}, { type: 'posts' });

console.log('\n=== EXAMPLE 1: Anonymous User ===');
console.log('Fetching users without authentication...\n');

// Query as anonymous user - limited field visibility
const anonUsers = await api.query({}, { type: 'users' });
console.log('Anonymous user sees:');
console.log(JSON.stringify(anonUsers.data[0].attributes, null, 2));
// Should see: name, countryId
// Should NOT see: email, salary, internalNotes

console.log('\n=== EXAMPLE 2: Authenticated User ===');
console.log('Fetching users with basic authentication...\n');

// Query as authenticated user
const authUsers = await api.query({}, { 
  type: 'users',
  user: { id: 1, roles: ['authenticated'] }
});
console.log('Authenticated user sees:');
console.log(JSON.stringify(authUsers.data[0].attributes, null, 2));
// Should see: name, email, countryId
// Should NOT see: salary, internalNotes

console.log('\n=== EXAMPLE 3: HR User ===');
console.log('Fetching users as HR...\n');

// Query as HR user
const hrUsers = await api.query({}, {
  type: 'users',
  user: { roles: ['hr'] }
});
console.log('HR user sees:');
console.log(JSON.stringify(hrUsers.data[0].attributes, null, 2));
// Should see: name, countryId, salary
// Should NOT see: email (not authenticated), internalNotes

console.log('\n=== EXAMPLE 4: Include Permissions ===');
console.log('Testing include permissions...\n');

// Anonymous user tries to include country
const anonWithInclude = await api.get(alice.data.id, {
  type: 'users',
  include: 'countryId'
});
console.log('Anonymous user with include:');
console.log('- Has countryId:', anonWithInclude.data.attributes.countryId);
console.log('- Has country relationship:', !!anonWithInclude.data.relationships?.country);
console.log('- Has included data:', !!anonWithInclude.included);
// Should have countryId but NO included country data

// Authenticated user includes country
const authWithInclude = await api.get(alice.data.id, {
  type: 'users',
  include: 'countryId',
  user: { id: 1, roles: ['authenticated'] }
});
console.log('\nAuthenticated user with include:');
console.log('- Has countryId:', authWithInclude.data.attributes.countryId);
console.log('- Has country relationship:', !!authWithInclude.data.relationships?.country);
console.log('- Included countries:', authWithInclude.included?.length || 0);
// Should have countryId AND included country data

console.log('\n=== EXAMPLE 5: Two-Level Nested Includes ===');
console.log('Including author and their country (two levels deep)...\n');

// Query posts with nested includes
const postsWithNested = await api.query({
  filter: { draft: false }
}, {
  type: 'posts',
  include: 'authorId.countryId',
  user: { id: 1, roles: ['authenticated'] }
});

console.log('Posts with nested includes:');
const post = postsWithNested.data[0];
console.log('Post:', post.attributes.title);
console.log('Author relationship:', post.relationships?.author);

// Find included author
const author = postsWithNested.included?.find(
  i => i.type === 'users' && i.id === post.relationships?.author?.data?.id
);
console.log('\nIncluded author:', author?.attributes?.name);
console.log('Author has country relationship:', !!author?.relationships?.country);

// Find included country
const country = postsWithNested.included?.find(
  i => i.type === 'countries' && i.id === author?.relationships?.country?.data?.id
);
console.log('Included country:', country?.attributes?.name);

console.log('\n=== EXAMPLE 6: Analyst Viewing GDP ===');
console.log('Fetching countries with GDP field...\n');

// Regular user can't see GDP
const regularCountries = await api.query({}, {
  type: 'countries',
  user: { roles: ['user'] }
});
console.log('Regular user sees:', Object.keys(regularCountries.data[0].attributes));

// Analyst can see GDP
const analystCountries = await api.query({}, {
  type: 'countries',
  user: { roles: ['analyst'] }
});
console.log('Analyst sees:', Object.keys(analystCountries.data[0].attributes));
console.log('USA GDP:', analystCountries.data[0].attributes.gdp);

console.log('\n✅ Examples complete!');
console.log('\nKey takeaways:');
console.log('1. Field permissions control what data users can see');
console.log('2. Include permissions control relationship loading');  
console.log('3. Permissions are checked at each level of nested includes');
console.log('4. The internalNotes field is never exposed (read: false)');
console.log('5. JSON:API format keeps related data in the included array');