import express from 'express';
import { Api, Schema, MemoryPlugin, HTTPPlugin } from '../../index.js';

const app = express();
const api = new Api();

// Use memory storage
api.use(MemoryPlugin);

// Product schema with searchable fields for operator testing
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
  stock: { 
    type: 'number', 
    default: 0, 
    searchable: true 
  },
  category: { 
    type: 'string', 
    searchable: true 
  },
  tags: { 
    type: 'array', 
    searchable: true 
  },
  active: { 
    type: 'boolean', 
    default: true, 
    searchable: true 
  }
});

// Add products resource
api.addResource('products', productSchema);

// Enable HTTP endpoints
api.use(HTTPPlugin, { app });

const PORT = process.env.PORT || 3737;

app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});