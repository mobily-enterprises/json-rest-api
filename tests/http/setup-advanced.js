import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let serverProcess = null;
const SERVER_PORT = 3738;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

// Start the test server
export async function setupServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [join(__dirname, 'test-server-advanced.js')], {
      env: { ...process.env, PORT: SERVER_PORT }
    });
    
    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data}`);
      if (data.toString().includes('running on port')) {
        // Give server a moment to fully initialize (including api.connect())
        setTimeout(() => resolve({ close: () => stopServer() }), 1000);
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data}`);
    });
    
    serverProcess.on('error', (error) => {
      reject(error);
    });
    
    // Timeout if server doesn't start
    setTimeout(() => {
      reject(new Error('Server failed to start within timeout'));
    }, 5000);
  });
}

// Stop the test server
function stopServer() {
  return new Promise((resolve) => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess.on('exit', () => {
        serverProcess = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Make HTTP request
export async function makeRequest(method, path, body = null, options = {}) {
  const url = `${BASE_URL}/api${path}`;
  
  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };
  
  if (body && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json().catch(() => null);
    
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: data
    };
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

// Create test data
export async function createTestData() {
  // Create some users
  const users = [];
  for (let i = 0; i < 3; i++) {
    const res = await makeRequest('POST', '/users', {
      data: {
        type: 'users',
        attributes: {
          name: `User ${i + 1}`,
          email: `user${i + 1}@example.com`
        }
      }
    });
    users.push(res.body.data);
  }
  
  // Create some products
  const products = [];
  for (let i = 0; i < 5; i++) {
    const res = await makeRequest('POST', '/products', {
      data: {
        type: 'products',
        attributes: {
          name: `Product ${i + 1}`,
          price: (i + 1) * 10,
          category: i % 2 === 0 ? 'Electronics' : 'Books'
        }
      }
    });
    products.push(res.body.data);
  }
  
  return { users, products };
}