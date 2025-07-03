import { Api } from 'hooked-api';
import { RestApiPlugin } from 'jsonrestapi';

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

// Test programmatic API usage
console.log('Testing programmatic API usage...\n');

// First check what methods are available
console.log('Available methods on api.resources.books:');
if (api.resources && api.resources.books) {
  const methods = Object.keys(api.resources.books).filter(k => typeof api.resources.books[k] === 'function');
  console.log('  Methods:', methods.join(', '));
} else {
  console.log('  ERROR: api.resources.books is not available');
}

try {
  // Query all books
  console.log('\n1. Testing query():');
  const allBooks = await api.resources.books.query({});
  console.log('✓ Query successful:', JSON.stringify(allBooks, null, 2));
  
  // Get a single book
  console.log('\n2. Testing get():');
  const book = await api.resources.books.get({ id: '1' });
  console.log('✓ Get successful:', JSON.stringify(book, null, 2));
  
  // Create a new book
  console.log('\n3. Testing post():');
  const newBook = await api.resources.books.post({
    inputRecord: {
      data: {
        type: 'books',
        attributes: {
          title: 'New Book',
          author: 'New Author',
          year: 2024
        }
      }
    }
  });
  console.log('✓ Post successful:', JSON.stringify(newBook, null, 2));
  
  // Update a book (replace all fields)
  console.log('\n4. Testing put():');
  const updatedBook = await api.resources.books.put({
    id: '1',
    inputRecord: {
      data: {
        type: 'books',
        attributes: {
          title: 'Updated Title',
          author: 'Updated Author',
          year: 2024
        }
      }
    }
  });
  console.log('✓ Put successful:', JSON.stringify(updatedBook, null, 2));
  
  // Partially update a book
  console.log('\n5. Testing patch():');
  const patchedBook = await api.resources.books.patch({
    id: '1',
    inputRecord: {
      data: {
        type: 'books',
        attributes: {
          title: 'New Title Only'
        }
      }
    }
  });
  console.log('✓ Patch successful:', JSON.stringify(patchedBook, null, 2));
  
  // Delete a book
  console.log('\n6. Testing delete():');
  const deleteResult = await api.resources.books.delete({ id: '1' });
  console.log('✓ Delete successful:', JSON.stringify(deleteResult, null, 2));
  
  console.log('\n✅ All programmatic API tests passed!');
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
}