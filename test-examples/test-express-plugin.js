import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'jsonrestapi';
import express from 'express';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Add plugins (ORDER MATTERS!)
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);  // Must come after RestApiPlugin
api.use(ExpressPlugin, {       // Must come after FileHandlingPlugin
  basePath: '/api',  // Optional, defaults to '/api'
});

// Add books resource
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

// Wait a bit for async plugin installation to complete
await new Promise(resolve => setTimeout(resolve, 100));

// Create Express app
const app = express();

// Debug: Check what's available
console.log('api.http exists?', !!api.http);
console.log('api.http.express exists?', !!api.http?.express);
console.log('api.http.express.router exists?', !!api.http?.express?.router);

// Mount the API routes - both approaches work:
// Approach 1: Direct router usage (standard Express pattern)
app.use(api.http.express.router);

// Start the server
const server = app.listen(3000, () => {
  console.log('✓ Express server started successfully!');
  console.log('  API running at http://localhost:3000/api');
  console.log('\nTesting endpoints with curl...\n');
  
  // Close server after tests
  setTimeout(() => {
    console.log('\nClosing server...');
    server.close();
    process.exit(0);
  }, 2000);
});

// Test with curl commands
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

setTimeout(async () => {
  try {
    // Test GET all books
    console.log('1. Testing GET /api/books:');
    const { stdout: getAll } = await execAsync('curl -s http://localhost:3000/api/books');
    console.log('✓ Response:', getAll.substring(0, 100) + '...');
    
    // Test GET single book
    console.log('\n2. Testing GET /api/books/1:');
    const { stdout: getOne } = await execAsync('curl -s http://localhost:3000/api/books/1');
    console.log('✓ Response:', getOne.substring(0, 100) + '...');
    
    // Test POST
    console.log('\n3. Testing POST /api/books:');
    const postData = JSON.stringify({
      data: {
        type: 'books',
        attributes: {
          title: 'New Book',
          author: 'New Author',
          year: 2024
        }
      }
    });
    const { stdout: postRes } = await execAsync(`curl -s -X POST http://localhost:3000/api/books -H "Content-Type: application/json" -d '${postData}'`);
    console.log('✓ Response:', postRes.substring(0, 100) + '...');
    
  } catch (error) {
    console.error('Test error:', error.message);
  }
}, 500);