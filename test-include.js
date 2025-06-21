import { setupServer, robustTeardown, curlCmd } from './tests/http/setup.js';
import { Schema } from './lib/schema.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function test() {
  const { app, api, baseUrl } = await setupServer({ storage: 'memory' });
  
  const authorSchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    role: { type: 'string' },
    isActive: { type: 'boolean', default: true }
  });
  
  const categorySchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    parentId: { 
      type: 'id', 
      refs: { 
        resource: 'categories',
        join: { eager: true }
      }
    }
  });
  
  const postSchema = new Schema({
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'string' },
    authorId: {
      type: 'id',
      refs: {
        resource: 'authors',
        join: {
          eager: true,
          fields: ['id', 'name', 'email']
        }
      }
    },
    categoryId: {
      type: 'id',
      refs: {
        resource: 'categories'
      }
    }
  });
  
  api.addResource('authors', authorSchema);
  api.addResource('categories', categorySchema);
  api.addResource('posts', postSchema);
  
  // Create test data
  const author = await api.resources.authors.create({ 
    name: 'Test Author', 
    email: 'test@example.com' 
  });
  
  const category = await api.resources.categories.create({ 
    name: 'Test Category' 
  });
  
  const post = await api.resources.posts.create({
    title: 'Test Post',
    content: 'Content',
    authorId: author.data.id,
    categoryId: category.data.id
  });
  
  // Test include parameter
  const url = `${baseUrl}/api/posts?include=categoryId`;
  console.log('Testing URL:', url);
  console.log('Debug mode:', api.options.debug);
  
  // Enable debug
  api.options.debug = true;
  
  try {
    const { stdout } = await execAsync(`curl -s ${url}`);
    const response = JSON.parse(stdout);
    console.log('Response:', JSON.stringify(response, null, 2));
    
    // Check result
    const postData = response.data[0];
    if (postData) {
      console.log('Post attributes:', postData.attributes);
      console.log('Has category?', !!postData.attributes.category);
      console.log('Category type:', typeof postData.attributes.category);
    }
  } catch (err) {
    console.error('Error:', err);
  }
  
  await robustTeardown({ api });
  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});