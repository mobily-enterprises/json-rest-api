import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api';
import { LocalStorage } from 'json-rest-api';
import express from 'express';

// Create API
const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Create storage for different file types
const coverStorage = new LocalStorage({
  directory: './uploads/covers',
  baseUrl: 'http://localhost:3000/uploads/covers',
  nameStrategy: 'hash',
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif']
});

const pdfStorage = new LocalStorage({
  directory: './uploads/pdfs',
  baseUrl: 'http://localhost:3000/uploads/pdfs',
  nameStrategy: 'timestamp'
});

// Use plugins
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);
api.use(ExpressPlugin);  // File parser configuration shown in connector plugins section

// Define schema with multiple file fields
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    cover: {
      type: 'file',
      storage: coverStorage,
      accepts: ['image/*'],
      maxSize: '5mb'
    },
    sample: {
      type: 'file',
      storage: pdfStorage,
      accepts: ['application/pdf'],
      maxSize: '10mb',
      required: false
    }
  }
});

// Simple data helpers
api.customize({
  vars: {
    helpers: {
      dataPost: async ({ scopeName, inputRecord }) => {
        const newBook = {
          id: String(Date.now()),
          ...inputRecord.data.attributes
        };
        
        console.log('Created book:', newBook);
        
        return {
          data: {
            type: 'books',
            id: newBook.id,
            attributes: newBook
          }
        };
      },
      
      dataQuery: async () => {
        return { data: [] };
      }
    }
  }
});

// Wait for async plugin initialization
await new Promise(resolve => setTimeout(resolve, 100));

// Express setup
const app = express();
app.use('/uploads', express.static('./uploads'));

// Test form
app.get('/', (req, res) => {
  res.send(`
    <form action="/api/books" method="POST" enctype="multipart/form-data">
      <h2>Add a Book</h2>
      <p>Title: <input name="title" required></p>
      <p>Author: <input name="author" required></p>
      <p>Year: <input name="year" type="number"></p>
      <p>Cover: <input name="cover" type="file" accept="image/*"></p>
      <p>Sample PDF: <input name="sample" type="file" accept=".pdf"></p>
      <button type="submit">Add Book</button>
    </form>
  `);
});

app.use(api.http.express.router);

const server = app.listen(3000, () => {
  console.log('Library API running at http://localhost:3000');
  console.log('Test form at http://localhost:3000');
  console.log('API endpoints at http://localhost:3000/api/books');
  
  // Test with a simple POST
  console.log('\nTesting JSON POST (without files)...');
  fetch('http://localhost:3000/api/books', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: {
        type: 'books',
        attributes: {
          title: 'Test Book',
          author: 'Test Author',
          year: 2024
        }
      }
    })
  })
  .then(res => res.json())
  .then(result => {
    console.log('JSON POST result:', JSON.stringify(result, null, 2));
    
    // Keep server running for manual testing
    console.log('\nServer is running. Visit http://localhost:3000 to test file uploads.');
    console.log('Press Ctrl+C to stop.');
  })
  .catch(err => {
    console.error('Test failed:', err);
    server.close();
  });
});