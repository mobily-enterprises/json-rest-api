# Complete File Upload Example with Multiple Files

This guide shows a complete example of implementing file uploads with jsonrestapi, including:
- Multiple file fields (images and PDFs)
- Different storage configurations for different file types
- HTML form for testing uploads
- Express static file serving

## Complete Example

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api';
import { LocalStorage } from 'json-rest-api/plugins/storage/local-storage.js';
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
api.vars.helpers.dataPost = async ({ scopeName, inputRecord }) => {
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
};

api.vars.helpers.dataQuery = async () => {
  return { data: [] };
};

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

api.express.mount(app);

app.listen(3000, () => {
  console.log('Library API running at http://localhost:3000');
  console.log('Test form at http://localhost:3000');
  console.log('API endpoints at http://localhost:3000/api/books');
});
```

Remember to install the required peer dependency:

```bash
npm install busboy
```

## Key Features Demonstrated

### Multiple Storage Configurations

The example shows how to create different storage configurations for different file types:
- **Cover images**: Use hash naming strategy and restrict to image files
- **PDF samples**: Use timestamp naming strategy for PDFs

### HTML Test Form

The example includes a simple HTML form for testing file uploads without needing external tools.

### Static File Serving

The Express app serves uploaded files directly:
```javascript
app.use('/uploads', express.static('./uploads'));
```

This allows uploaded files to be accessed via URLs like:
- `http://localhost:3000/uploads/covers/abc123.jpg`
- `http://localhost:3000/uploads/pdfs/1234567890.pdf`

## Testing the Example

1. Run the server
2. Open http://localhost:3000 in your browser
3. Fill out the form and select files
4. Submit to see the file upload in action
5. Check the console for the created book data
6. Access uploaded files via their URLs

## Next Steps

- Add validation for file types
- Implement file deletion when records are deleted
- Add image resizing for covers
- Generate thumbnails
- Add virus scanning for uploaded files
- Implement S3 storage for production