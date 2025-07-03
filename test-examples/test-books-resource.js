import { Api } from 'hooked-api';
import { RestApiPlugin } from 'json-rest-api';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Use the REST API plugin
api.use(RestApiPlugin);

// Define a books resource
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    isbn: { type: 'string' }
  }
});

// Add simple data helpers (in real apps, these would connect to a database)
api.customize({
  vars: {
    helpers: {
      dataQuery: async ({ scopeName, queryParams }) => {
        // For now, just return some fake books
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
        // Return a single fake book
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
        // Pretend to create a book and return it
        const newBook = {
          id: String(Date.now()), // Simple ID generation
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
        // Pretend to replace a book
        return {
          data: {
            type: 'books',
            id: id,
            attributes: inputRecord.data.attributes
          }
        };
      },
      
      dataPatch: async ({ scopeName, id, inputRecord }) => {
        // Pretend to update a book
        return {
          data: {
            type: 'books',
            id: id,
            attributes: inputRecord.data.attributes
          }
        };
      },
      
      dataDelete: async ({ scopeName, id }) => {
        // Just return success
        return { success: true };
      }
    }
  }
});

console.log('✓ Books resource created with all data helpers!');
console.log('  Resource:', api.resources.books ? 'books resource exists' : 'ERROR: books resource missing');
console.log('  Available methods:', api.resources.books ? Object.keys(api.resources.books).filter(k => typeof api.resources.books[k] === 'function').join(', ') : 'none');