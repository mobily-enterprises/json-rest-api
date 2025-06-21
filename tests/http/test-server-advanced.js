import express from 'express';
import { Api, Schema, MemoryPlugin, HTTPPlugin } from '../../index.js';

const app = express();
const api = new Api();

// Use memory storage for tests
api.use(MemoryPlugin);

// User schema
const userSchema = new Schema({
  name: { 
    type: 'string', 
    required: true, 
    searchable: true 
  },
  email: { 
    type: 'string', 
    required: true, 
    searchable: true 
  },
  active: { 
    type: 'boolean', 
    default: true, 
    searchable: true 
  }
});

// Product schema
const productSchema = new Schema({
  name: { 
    type: 'string', 
    required: true, 
    searchable: true 
  },
  price: { 
    type: 'number', 
    required: true, 
    searchable: true 
  },
  category: { 
    type: 'string', 
    searchable: true 
  },
  discounted: {
    type: 'boolean',
    default: false,
    searchable: true
  }
});

// Account schema for transaction tests
const accountSchema = new Schema({
  name: { 
    type: 'string', 
    required: true 
  },
  balance: { 
    type: 'number', 
    required: true,
    searchable: true
  }
});

// Post schema
const postSchema = new Schema({
  title: { 
    type: 'string', 
    required: true,
    searchable: true
  },
  content: { 
    type: 'string' 
  },
  authorId: { 
    type: 'id', 
    refs: { resource: 'users' },
    searchable: true
  },
  published: {
    type: 'boolean',
    default: false,
    searchable: true
  }
});

// Add resources
api.addResource('users', userSchema);
api.addResource('products', productSchema);
api.addResource('accounts', accountSchema);
api.addResource('posts', postSchema);

// Enable HTTP endpoints
api.use(HTTPPlugin, { app });

// Connect to initialize batch operations
api.connect().then(() => {
  const PORT = process.env.PORT || 3738;
  
  app.listen(PORT, () => {
    console.log(`Advanced test server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect:', err);
  process.exit(1);
});