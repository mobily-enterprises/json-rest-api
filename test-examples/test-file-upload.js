import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'jsonrestapi';
import { LocalStorage } from 'jsonrestapi';
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Create a storage adapter
const coverStorage = new LocalStorage({
  directory: './uploads/covers',
  baseUrl: 'http://localhost:3000/uploads/covers'
});

// Add plugins (ORDER MATTERS!)
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);  // Must come after RestApiPlugin
api.use(ExpressPlugin);       // Must come after FileHandlingPlugin

// Update the books schema to include a cover image
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    isbn: { type: 'string' },
    cover: {
      type: 'file',
      storage: coverStorage,
      accepts: ['image/jpeg', 'image/png', 'image/gif'],
      maxSize: '5mb'
    }
  }
});

// Add dataPost helper to handle the cover URL
api.customize({
  vars: {
    helpers: {
      dataPost: async ({ scopeName, inputRecord }) => {
        const newBook = {
          id: String(Date.now()),
          ...inputRecord.data.attributes
        };
        
        // The file has already been uploaded and replaced with a URL
        console.log('Book cover URL:', newBook.cover);
        
        return {
          data: {
            type: 'books',
            id: newBook.id,
            attributes: {
              title: newBook.title,
              author: newBook.author,
              year: newBook.year,
              cover: newBook.cover  // This is now a URL!
            }
          }
        };
      },
      
      dataQuery: async () => ({ data: [] })
    }
  }
});

// Wait for async plugin initialization
await new Promise(resolve => setTimeout(resolve, 100));

// Create Express app
const app = express();

// Serve uploaded files
app.use('/uploads', express.static('./uploads'));

// Mount the API
app.use(api.http.express.router);

const server = app.listen(3000, async () => {
  console.log('✓ File upload API running at http://localhost:3000/api');
  
  // Create a test image file
  const testImagePath = './test-cover.png';
  await fs.writeFile(testImagePath, Buffer.from('PNG_TEST_DATA'));
  
  try {
    // Test file upload with curl
    console.log('\nTesting file upload with multipart/form-data...\n');
    
    const { stdout, stderr } = await execAsync(`curl -s -X POST http://localhost:3000/api/books \
      -F "title=The Hobbit" \
      -F "author=J.R.R. Tolkien" \
      -F "year=1937" \
      -F "cover=@${testImagePath}"`);
    
    if (stderr) {
      console.error('Curl error:', stderr);
    } else {
      console.log('Response:', stdout);
      
      // Parse response to check if it worked
      try {
        const response = JSON.parse(stdout);
        if (response.data && response.data.attributes && response.data.attributes.cover) {
          console.log('\n✓ File upload successful!');
          console.log('  Book ID:', response.data.id);
          console.log('  Cover URL:', response.data.attributes.cover);
        } else if (response.errors) {
          console.log('\n✗ File upload failed with errors:', response.errors);
        }
      } catch (e) {
        console.log('\n✗ Could not parse response');
      }
    }
  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    // Cleanup
    await fs.unlink(testImagePath).catch(() => {});
    server.close();
    process.exit(0);
  }
});