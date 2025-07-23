// Test PUT behavior with schema defaults
import { Api } from 'hooked-api';
import { RestApiPlugin } from '../index.js';

const api = new Api({
  name: 'test-api',
  version: '1.0.0'
});

await api.use(RestApiPlugin);

// Define a resource with various field types
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    isbn: { type: 'string' },
    inStock: { type: 'boolean', default: true },
    rating: { type: 'number', default: 0 },
    tags: { type: 'array', default: [] },
    metadata: { type: 'object', default: {} }
  }
});

// In-memory storage that shows exactly what's passed
const storagePlugin = {
  name: 'test-storage',
  install({ helpers }) {
    const storage = new Map();
    
    // Seed with a complete book
    storage.set('books', [{
      id: '1',
      title: 'Original Title',
      author: 'Original Author',
      year: 2020,
      isbn: '123-456',
      inStock: false,
      rating: 4.5,
      tags: ['fiction', 'bestseller'],
      metadata: { pages: 300, language: 'en' }
    }]);
    
    helpers.dataGet = async ({ scopeName, id }) => {
      const records = storage.get(scopeName) || [];
      const record = records.find(r => r.id === id);
      return { data: record ? { type: scopeName, id: record.id, attributes: record } : null };
    };
    
    helpers.dataPut = async ({ scopeName, id, inputRecord }) => {
      console.log('\n=== PUT Handler Received ===');
      console.log('Input attributes:', JSON.stringify(inputRecord.data.attributes, null, 2));
      
      const records = storage.get(scopeName) || [];
      const index = records.findIndex(r => r.id === id);
      
      // Replace entire record with what was provided
      records[index] = {
        id,
        ...inputRecord.data.attributes
      };
      
      console.log('\n=== Stored Record ===');
      console.log(JSON.stringify(records[index], null, 2));
      
      storage.set(scopeName, records);
      return { data: { type: scopeName, id, attributes: records[index] } };
    };
    
    helpers.dataPatch = async ({ scopeName, id, inputRecord }) => {
      console.log('\n=== PATCH Handler Received ===');
      console.log('Input attributes:', JSON.stringify(inputRecord.data.attributes, null, 2));
      
      const records = storage.get(scopeName) || [];
      const index = records.findIndex(r => r.id === id);
      
      // Merge with existing
      records[index] = {
        ...records[index],
        ...inputRecord.data.attributes
      };
      
      console.log('\n=== Stored Record ===');
      console.log(JSON.stringify(records[index], null, 2));
      
      storage.set(scopeName, records);
      return { data: { type: scopeName, id, attributes: records[index] } };
    };
    
    // Minimal implementations for other methods
    helpers.dataQuery = async () => ({ data: [] });
    helpers.dataPost = async () => ({ data: {} });
    helpers.dataDelete = async () => ({ success: true });
    helpers.dataExists = async ({ id }) => id === '1';
  }
};

await api.use(storagePlugin);

// Test 1: GET original record
console.log('\n=== TEST 1: Original Record ===');
const original = await api.resources.books.get({ id: '1' });
console.log('Original:', JSON.stringify(original.data.attributes, null, 2));

// Test 2: PUT with only required fields
console.log('\n\n=== TEST 2: PUT with only required fields ===');
const putResult = await api.resources.books.put({
  id: '1',
  inputRecord: {
    data: {
      type: 'books',
      id: '1',
      attributes: {
        title: 'New Title',
        author: 'New Author'
        // Notice: year, isbn, inStock, rating, tags, metadata are NOT provided
      }
    }
  }
});

console.log('\n=== PUT Response ===');
console.log(JSON.stringify(putResult.data.attributes, null, 2));

// Test 3: GET after PUT to see what's stored
console.log('\n\n=== TEST 3: GET after PUT ===');
const afterPut = await api.resources.books.get({ id: '1' });
console.log('After PUT:', JSON.stringify(afterPut.data.attributes, null, 2));

// Test 4: PATCH for comparison
console.log('\n\n=== TEST 4: PATCH for comparison ===');
const patchResult = await api.resources.books.patch({
  id: '1',
  inputRecord: {
    data: {
      type: 'books',
      id: '1',
      attributes: {
        year: 2024
        // Only updating year
      }
    }
  }
});

console.log('\n=== PATCH Response ===');
console.log(JSON.stringify(patchResult.data.attributes, null, 2));

// Test 5: PUT with empty object
console.log('\n\n=== TEST 5: PUT with empty attributes (should fail validation) ===');
try {
  await api.resources.books.put({
    id: '1',
    inputRecord: {
      data: {
        type: 'books',
        id: '1',
        attributes: {}
      }
    }
  });
} catch (error) {
  console.log('Expected validation error:', error.message);
}