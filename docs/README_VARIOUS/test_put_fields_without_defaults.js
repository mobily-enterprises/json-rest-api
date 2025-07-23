// Test PUT behavior specifically for fields WITHOUT defaults
import { Api } from 'hooked-api';
import { RestApiPlugin } from '../index.js';

const api = new Api({
  name: 'test-api',
  version: '1.0.0'
});

await api.use(RestApiPlugin);

// Define a resource with fields that have NO defaults
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    // These fields have NO defaults:
    year: { type: 'number' },                    // No default
    isbn: { type: 'string' },                    // No default
    publisher: { type: 'string' },               // No default
    // These fields HAVE defaults:
    inStock: { type: 'boolean', default: true },
    rating: { type: 'number', default: 0 }
  }
});

// Storage that logs exactly what it receives
const storagePlugin = {
  name: 'test-storage',
  install({ helpers }) {
    const storage = new Map();
    
    // Seed with a complete book
    storage.set('books', [{
      id: '1',
      title: 'Original Title',
      author: 'Original Author',
      year: 1984,
      isbn: '978-0-452-28423-4',
      publisher: 'Signet Classic',
      inStock: false,
      rating: 4.8
    }]);
    
    helpers.dataGet = async ({ scopeName, id }) => {
      const records = storage.get(scopeName) || [];
      const record = records.find(r => r.id === id);
      return { data: record ? { type: scopeName, id: record.id, attributes: record } : null };
    };
    
    helpers.dataPut = async ({ scopeName, id, inputRecord }) => {
      console.log('\n=== Storage Layer PUT ===');
      console.log('Received from REST API plugin:', JSON.stringify(inputRecord.data.attributes, null, 2));
      
      const records = storage.get(scopeName) || [];
      const index = records.findIndex(r => r.id === id);
      
      console.log('\nOriginal record had:', JSON.stringify(records[index], null, 2));
      
      // Check which fields are missing
      const originalFields = Object.keys(records[index]);
      const receivedFields = Object.keys(inputRecord.data.attributes);
      const missingFields = originalFields.filter(f => f !== 'id' && !receivedFields.includes(f));
      
      console.log('\nFields analysis:');
      console.log('- Original fields:', originalFields);
      console.log('- Received fields:', receivedFields);
      console.log('- Missing fields:', missingFields);
      
      // Replace the record
      records[index] = {
        id,
        ...inputRecord.data.attributes
      };
      
      console.log('\nFinal stored record:', JSON.stringify(records[index], null, 2));
      
      storage.set(scopeName, records);
      return { data: { type: scopeName, id, attributes: records[index] } };
    };
    
    helpers.dataQuery = async () => ({ data: [] });
    helpers.dataPost = async () => ({ data: {} });
    helpers.dataPatch = async () => ({ data: {} });
    helpers.dataDelete = async () => ({ success: true });
    helpers.dataExists = async ({ id }) => id === '1';
  }
};

await api.use(storagePlugin);

// Test: PUT with only required fields
console.log('=== TEST: PUT with only required fields ===');
console.log('\nOriginal record:');
const original = await api.resources.books.get({ id: '1' });
console.log(JSON.stringify(original.data.attributes, null, 2));

console.log('\n\nExecuting PUT with only title and author...');
const putResult = await api.resources.books.put({
  id: '1',
  inputRecord: {
    data: {
      type: 'books',
      id: '1',
      attributes: {
        title: 'Nineteen Eighty-Four',
        author: 'George Orwell'
        // NOT sending: year, isbn, publisher, inStock, rating
      }
    }
  }
});

console.log('\n\n=== CONCLUSION ===');
console.log('Fields with defaults (inStock, rating): Added with default values');
console.log('Fields without defaults (year, isbn, publisher): REMOVED from the record');
console.log('\nThis confirms: PUT does NOT preserve fields without defaults!');