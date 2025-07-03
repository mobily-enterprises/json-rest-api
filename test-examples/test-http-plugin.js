import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, HttpPlugin } from 'json-rest-api';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Add plugins
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);
api.use(HttpPlugin, {
  port: 3000,                // Server port (default: 3000)
  basePath: '/api',          // API base path (default: '/api')
  strictContentType: true,   // Enforce JSON content types (default: true)
  requestSizeLimit: '10mb'   // Max request body size (default: '1mb')
});

// Add your books resource
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    isbn: { type: 'string' }
  }
});

// Add simple data helpers
api.customize({
  vars: {
    helpers: {
      dataQuery: async ({ scopeName, queryParams }) => {
        const fakeBooks = [
          { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', year: 1925 },
          { id: '2', title: '1984', author: 'George Orwell', year: 1949 },
          { id: '3', title: 'To Kill a Mockingbird', author: 'Harper Lee', year: 1960 }
        ];
        
        return {
          data: fakeBooks.map(book => ({
            type: 'books',
            id: book.id,
            attributes: {
              title: book.title,
              author: book.author,
              year: book.year
            }
          }))
        };
      },
      
      dataGet: async ({ scopeName, id }) => {
        const book = { id, title: 'Example Book', author: 'Example Author', year: 2024 };
        
        return {
          data: {
            type: 'books',
            id: book.id,
            attributes: {
              title: book.title,
              author: book.author,
              year: book.year
            }
          }
        };
      },
      
      dataPost: async ({ scopeName, inputRecord }) => {
        const newBook = {
          id: String(Date.now()),
          ...inputRecord.data.attributes
        };
        
        return {
          data: {
            type: 'books',
            id: newBook.id,
            attributes: {
              title: newBook.title,
              author: newBook.author,
              year: newBook.year
            }
          }
        };
      },
      
      dataPut: async ({ scopeName, id, inputRecord }) => {
        return {
          data: {
            type: 'books',
            id: id,
            attributes: inputRecord.data.attributes
          }
        };
      },
      
      dataPatch: async ({ scopeName, id, inputRecord }) => {
        return {
          data: {
            type: 'books',
            id: id,
            attributes: inputRecord.data.attributes
          }
        };
      },
      
      dataDelete: async ({ scopeName, id }) => {
        return { success: true };
      }
    }
  }
});

// Wait for async plugin installation to complete
await new Promise(resolve => setTimeout(resolve, 100));

// Start the HTTP server - multiple options:
console.log('Testing HTTP plugin options...\n');

// Check if api.http namespace exists
console.log('api.http exists?', !!api.http);
console.log('api.http.startServer exists?', typeof api.http?.startServer);

// Option 1: Start on configured port (3000 by default)
api.http.startServer();

console.log('✓ HTTP server started successfully!');
console.log('  API running at http://localhost:3000/api');

// Test with curl commands after a short delay
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

setTimeout(async () => {
  try {
    console.log('\nTesting endpoints...\n');
    
    // Test GET all books
    console.log('1. Testing GET /api/books:');
    const { stdout: getAll } = await execAsync('curl -s http://localhost:3000/api/books');
    console.log('✓ Response:', getAll.substring(0, 100) + '...');
    
    // Test GET single book
    console.log('\n2. Testing GET /api/books/1:');
    const { stdout: getOne } = await execAsync('curl -s http://localhost:3000/api/books/1');
    console.log('✓ Response:', getOne.substring(0, 100) + '...');
    
    // Close server
    console.log('\nClosing server...');
    api.http.server.close();
    process.exit(0);
    
  } catch (error) {
    console.error('Test error:', error.message);
    process.exit(1);
  }
}, 500);