import express from 'express';
import { Api } from 'hooked-api';
import { RestApiPlugin, ExpressPlugin } from 'jsonrestapi';

// Create an Express app
const app = express();

// Create API instance
const api = new Api({
  name: 'blog-api',
  version: '1.0.0'
});

// Install plugins
api.use(RestApiPlugin, {
  idProperty: 'id',
  pageSize: 10,
  sortableFields: ['title', 'created_at']
});

api.use(ExpressPlugin, {
  basePath: '/api',
  strictContentType: false, // Make testing easier
  requestSizeLimit: '5mb'
});

// Define a simple articles scope
api.addScope('articles', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 200 },
    body: { type: 'string', required: true },
    author_id: { belongsTo: 'users', as: 'author' },
    created_at: { type: 'dateTime', default: () => new Date().toISOString() }
  },
  relationships: {
    comments: { hasMany: 'comments' },
    tags: { hasMany: 'tags', through: 'article_tags' }
  }
});

// Define users scope
api.addScope('users', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true }
  },
  relationships: {
    articles: { hasMany: 'articles', foreignKey: 'author_id' }
  }
});

// Mock storage plugin for demonstration
const MockStoragePlugin = {
  name: 'mock-storage',
  install({ helpers }) {
    // Mock data
    const articles = [
      { 
        id: 1, 
        title: 'First Article', 
        body: 'This is the first article', 
        author_id: 1,
        created_at: '2024-01-01T10:00:00Z'
      },
      { 
        id: 2, 
        title: 'Second Article', 
        body: 'This is the second article', 
        author_id: 2,
        created_at: '2024-01-02T10:00:00Z'
      }
    ];
    
    const users = [
      { id: 1, name: 'John Doe', email: 'john@example.com' },
      { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
    ];
    
    // Implement storage helpers
    helpers.dataExists = async function({ scopeName, id }) {
      if (scopeName === 'articles') {
        return articles.some(a => a.id == id);
      }
      if (scopeName === 'users') {
        return users.some(u => u.id == id);
      }
      return false;
    };
    
    helpers.dataGet = async function({ scopeName, id }) {
      let record;
      if (scopeName === 'articles') {
        record = articles.find(a => a.id == id);
      } else if (scopeName === 'users') {
        record = users.find(u => u.id == id);
      }
      
      if (!record) {
        const { RestApiResourceError } = await import('jsonrestapi');
        throw new RestApiResourceError(`${scopeName} with id ${id} not found`, {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: id
        });
      }
      
      return {
        data: {
          type: scopeName,
          id: String(record.id),
          attributes: { ...record, id: undefined }
        }
      };
    };
    
    helpers.dataQuery = async function({ scopeName, queryParams }) {
      let records = [];
      if (scopeName === 'articles') {
        records = [...articles];
      } else if (scopeName === 'users') {
        records = [...users];
      }
      
      // Simple sorting
      if (queryParams.sort && queryParams.sort.length > 0) {
        records.sort((a, b) => {
          for (const sortField of queryParams.sort) {
            const desc = sortField.startsWith('-');
            const field = desc ? sortField.substring(1) : sortField;
            const aVal = a[field];
            const bVal = b[field];
            if (aVal < bVal) return desc ? 1 : -1;
            if (aVal > bVal) return desc ? -1 : 1;
          }
          return 0;
        });
      }
      
      return {
        data: records.map(record => ({
          type: scopeName,
          id: String(record.id),
          attributes: { ...record, id: undefined }
        }))
      };
    };
    
    helpers.dataPost = async function({ scopeName, inputRecord }) {
      const newRecord = {
        ...inputRecord.data.attributes,
        id: Date.now() // Simple ID generation
      };
      
      if (scopeName === 'articles') {
        articles.push(newRecord);
      } else if (scopeName === 'users') {
        users.push(newRecord);
      }
      
      return {
        data: {
          type: scopeName,
          id: String(newRecord.id),
          attributes: { ...newRecord, id: undefined }
        }
      };
    };
    
    helpers.dataPatch = async function({ scopeName, id, inputRecord }) {
      let record;
      if (scopeName === 'articles') {
        record = articles.find(a => a.id == id);
      } else if (scopeName === 'users') {
        record = users.find(u => u.id == id);
      }
      
      if (!record) {
        const { RestApiResourceError } = await import('jsonrestapi');
        throw new RestApiResourceError(`${scopeName} with id ${id} not found`, {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: id
        });
      }
      
      // Update attributes
      Object.assign(record, inputRecord.data.attributes);
      
      return {
        data: {
          type: scopeName,
          id: String(record.id),
          attributes: { ...record, id: undefined }
        }
      };
    };
    
    helpers.dataPut = async function({ scopeName, id, inputRecord, isCreate }) {
      if (isCreate) {
        return this.dataPost({ scopeName, inputRecord });
      } else {
        // For update, replace all attributes
        let record;
        if (scopeName === 'articles') {
          const index = articles.findIndex(a => a.id == id);
          if (index !== -1) {
            articles[index] = {
              ...inputRecord.data.attributes,
              id: Number(id)
            };
            record = articles[index];
          }
        }
        
        return {
          data: {
            type: scopeName,
            id: String(record.id),
            attributes: { ...record, id: undefined }
          }
        };
      }
    };
    
    helpers.dataDelete = async function({ scopeName, id }) {
      if (scopeName === 'articles') {
        const index = articles.findIndex(a => a.id == id);
        if (index === -1) {
          const { RestApiResourceError } = await import('jsonrestapi');
          throw new RestApiResourceError(`${scopeName} with id ${id} not found`, {
            subtype: 'not_found',
            resourceType: scopeName,
            resourceId: id
          });
        }
        articles.splice(index, 1);
      }
    };
  }
};

// Install the mock storage plugin
api.use(MockStoragePlugin);

// Mount the API routes
app.use(api.vars.expressRouter);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('\nTry these commands:');
  console.log('  curl http://localhost:3000/api/articles');
  console.log('  curl http://localhost:3000/api/articles/1');
  console.log('  curl http://localhost:3000/api/articles?sort=-created_at');
  console.log('  curl -X POST http://localhost:3000/api/articles \\');
  console.log('    -H "Content-Type: application/vnd.api+json" \\');
  console.log('    -d \'{"data":{"type":"articles","attributes":{"title":"New Article","body":"Content here","author_id":1}}}\'');
});