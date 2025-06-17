import express from 'express';
import { createApi, Schema } from './index.js';

// Create Express app
const app = express();

// Create your API with a name and version
const api = createApi({
  name: 'taskmanager',
  version: '1.0.0',
  storage: 'memory',  // We'll use memory for now
  http: { basePath: '/api' }  // This automatically adds HTTPPlugin!
});

// Define a schema for tasks
const taskSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  completed: { type: 'boolean', default: false },
  priority: { type: 'string', default: 'medium' },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

// Register the schema
api.addResource('tasks', taskSchema);

// Mount the API on Express
api.mount(app);

// Start the server
app.listen(3000, () => {
  console.log('🚀 API running at http://localhost:3000');
  console.log('📝 Try: GET http://localhost:3000/api/1.0.0/tasks');
});
