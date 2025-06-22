/**
 * ComputedPlugin Example
 * 
 * This example demonstrates how to use the ComputedPlugin to create
 * API resources that generate data on-the-fly without database storage.
 * 
 * Key concepts demonstrated:
 * 1. Simple computed resources with generated data
 * 2. Computed resources that aggregate data from database resources
 * 3. External API proxy pattern
 * 4. Custom filtering/sorting optimization
 * 5. Mixing computed and database resources in the same API
 */

import express from 'express';
import { Api } from '../lib/api.js';
import { Schema } from '../lib/schema.js';
import { MemoryPlugin } from '../plugins/core/memory.js';
import { ComputedPlugin } from '../plugins/core-extra/computed.js';
import { HTTPPlugin } from '../plugins/core/http.js';
import { ValidationPlugin } from '../plugins/core/validation.js';
import { NotFoundError } from '../lib/errors.js';

const app = express();
app.use(express.json());

// Create API instance
const api = new Api();

// Install plugins - Order matters!
// 1. Storage plugin for database-backed resources
api.use(MemoryPlugin);
// 2. ComputedPlugin for on-the-fly generated resources
api.use(ComputedPlugin);
// 3. ValidationPlugin ensures all data matches schemas
api.use(ValidationPlugin);
// 4. HTTPPlugin exposes the API over HTTP
api.use(HTTPPlugin, { app });

// ============================================================
// 1. REGULAR DATABASE-BACKED RESOURCE
// ============================================================
// This is a standard resource that stores data in the database.
// We'll use this to demonstrate how computed resources can
// access and aggregate data from database resources.

const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  createdAt: { type: 'date', onCreate: () => new Date() }
});

api.addResource('users', userSchema);

// ============================================================
// 2. SIMPLE COMPUTED RESOURCE - RANDOM DATA GENERATOR
// ============================================================
// This computed resource generates random data on each request.
// Perfect for:
// - Mock data during development
// - Testing pagination, filtering, and sorting
// - Demonstrating dynamic data generation

const randomSchema = new Schema({
  value: { type: 'number' },
  category: { type: 'string', searchable: true }, // searchable: true enables filtering!
  timestamp: { type: 'date' }
});

api.addResource('random', randomSchema, {
  compute: {
    // query: Return array of items for GET /api/random
    query: async (params, context) => {
      // Generate 100 random records
      // The ComputedPlugin will automatically handle:
      // - Filtering: ?filter[category]=A
      // - Sorting: ?sort=-value
      // - Pagination: ?page[size]=10&page[number]=2
      
      const categories = ['A', 'B', 'C', 'D'];
      return Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        value: Math.random() * 1000,
        category: categories[i % categories.length],
        timestamp: new Date()
      }));
    },
    
    // get: Return single item for GET /api/random/123
    get: async (id, context) => {
      // For single items, we use the ID to determine the category
      // This ensures consistent results for the same ID
      return {
        id,
        value: Math.random() * 1000,
        category: ['A', 'B', 'C', 'D'][parseInt(id) % 4],
        timestamp: new Date()
      };
    }
  }
});

// ============================================================
// 3. COMPUTED RESOURCE THAT AGGREGATES DATABASE DATA
// ============================================================
// This demonstrates the power of computed resources:
// - Access multiple database resources
// - Perform calculations and aggregations
// - Return derived data that doesn't need storage
// - Perfect for dashboards, reports, and analytics

const userStatsSchema = new Schema({
  username: { type: 'string' },
  totalPosts: { type: 'number' },
  avgPostLength: { type: 'number' },
  lastActive: { type: 'date' },
  accountAgeDays: { type: 'number' }
});

api.addResource('user-stats', userStatsSchema, {
  compute: {
    // get: Calculate statistics for a single user
    get: async (userId, context) => {
      try {
        // ACCESS OTHER RESOURCES!
        // The context.api gives us access to all resources,
        // both database-backed and computed
        
        // 1. Get user from database
        const userResult = await context.api.resources.users.get(userId);
        const user = userResult.data;
        
        // 2. Get all posts for this user
        const postsResult = await context.api.resources.posts.query({ 
          filter: { userId: parseInt(userId) } 
        });
        const posts = postsResult.data || [];
        
        // 3. Calculate statistics
        const totalChars = posts.reduce((sum, post) => 
          sum + (post.attributes.content?.length || 0), 0
        );
        const avgLength = posts.length > 0 ? totalChars / posts.length : 0;
        
        // 4. Find most recent activity
        const lastPost = posts.sort((a, b) => 
          new Date(b.attributes.createdAt) - new Date(a.attributes.createdAt)
        )[0];
        
        // 5. Calculate account age
        const accountAge = Math.floor(
          (new Date() - new Date(user.attributes.createdAt)) / (1000 * 60 * 60 * 24)
        );
        
        // Return computed statistics
        return {
          id: userId,
          username: user.attributes.name,
          totalPosts: posts.length,
          avgPostLength: Math.round(avgLength),
          lastActive: lastPost?.attributes.createdAt || user.attributes.createdAt,
          accountAgeDays: accountAge
        };
      } catch (error) {
        // If user not found, return null to trigger NotFoundError
        throw new NotFoundError('user-stats', userId);
      }
    },
    
    // query: Calculate statistics for all users
    query: async (params, context) => {
      // Get all users
      const usersResult = await context.api.resources.users.query({});
      const users = usersResult.data || [];
      
      // Calculate stats for each user
      // Note: In production, consider pagination and performance
      const stats = [];
      for (const user of users) {
        const statsResult = await context.api.resources['user-stats'].get(user.id);
        stats.push(statsResult.data.attributes);
      }
      
      return stats;
    }
  }
});

// ============================================================
// 4. EXTERNAL API PROXY PATTERN
// ============================================================
// This pattern shows how to wrap external APIs with your schema
// and features. Benefits:
// - Apply your validation rules
// - Add authentication/authorization
// - Transform external data to your format
// - Cache external API responses
// - All standard API features work (filtering, sorting, etc.)

const weatherSchema = new Schema({
  city: { type: 'string', searchable: true },
  temperature: { type: 'number' },
  conditions: { type: 'string' },
  humidity: { type: 'number' },
  windSpeed: { type: 'number' }
});

api.addResource('weather', weatherSchema, {
  compute: {
    // get: Fetch weather for a single city
    get: async (city, context) => {
      // In a real application, you would:
      // 1. Call an external weather API
      // 2. Transform the response to match your schema
      // 3. Handle errors gracefully
      
      // Example with real API:
      // const response = await fetch(
      //   `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}`
      // );
      // const data = await response.json();
      // return {
      //   id: city,
      //   city: data.name,
      //   temperature: data.main.temp - 273.15, // Convert from Kelvin
      //   conditions: data.weather[0].main,
      //   humidity: data.main.humidity,
      //   windSpeed: data.wind.speed
      // };
      
      // Mock implementation for demo
      return {
        id: city,
        city: city,
        temperature: 20 + Math.random() * 15,
        conditions: ['Sunny', 'Cloudy', 'Rainy', 'Partly Cloudy'][Math.floor(Math.random() * 4)],
        humidity: 40 + Math.random() * 40,
        windSpeed: Math.random() * 30
      };
    },
    
    // query: Fetch weather for multiple cities
    query: async (params, context) => {
      // You could use params.filter to determine which cities to fetch
      // For example: ?filter[country]=US
      
      const cities = ['London', 'Paris', 'New York', 'Tokyo', 'Sydney', 'Berlin', 'Madrid', 'Rome'];
      
      // Fetch weather for each city
      // In production, consider parallel requests:
      // const promises = cities.map(city => context.api.resources.weather.get(city));
      // const results = await Promise.all(promises);
      
      let results = [];
      for (const city of cities) {
        const weather = await context.api.resources.weather.get(city);
        results.push(weather.data.attributes);
      }
      
      return results;
    }
  }
});

// ============================================================
// 5. PERFORMANCE OPTIMIZATION - CUSTOM FILTERING
// ============================================================
// When calling external APIs or working with large datasets,
// you may want to handle filtering/sorting/pagination yourself
// instead of letting the plugin do it. This example shows how.

const metricsSchema = new Schema({
  metric: { type: 'string', searchable: true },
  value: { type: 'number', searchable: true },
  unit: { type: 'string' },
  category: { type: 'string', searchable: true }
});

api.addResource('server-metrics', metricsSchema, {
  compute: {
    query: async (params, context) => {
      // Generate real-time server metrics
      const allMetrics = [
        { id: 'cpu', metric: 'CPU Usage', value: Math.random() * 100, unit: '%', category: 'performance' },
        { id: 'memory', metric: 'Memory Usage', value: Math.random() * 16384, unit: 'MB', category: 'performance' },
        { id: 'disk', metric: 'Disk Usage', value: Math.random() * 1000, unit: 'GB', category: 'storage' },
        { id: 'network-in', metric: 'Network In', value: Math.random() * 1000, unit: 'Mbps', category: 'network' },
        { id: 'network-out', metric: 'Network Out', value: Math.random() * 1000, unit: 'Mbps', category: 'network' },
        { id: 'requests', metric: 'Requests/sec', value: Math.random() * 10000, unit: 'req/s', category: 'performance' },
        { id: 'errors', metric: 'Error Rate', value: Math.random() * 5, unit: '%', category: 'reliability' },
        { id: 'uptime', metric: 'Uptime', value: 99.9 + Math.random() * 0.1, unit: '%', category: 'reliability' }
      ];
      
      // PERFORMANCE OPTIMIZATION:
      // We handle filtering ourselves to avoid generating
      // unnecessary data. This is especially useful when:
      // 1. Calling external APIs with filter parameters
      // 2. Querying large datasets
      // 3. Performing expensive computations
      
      let filtered = allMetrics;
      if (params.filter?.category) {
        // Apply filter before returning
        filtered = filtered.filter(m => m.category === params.filter.category);
      }
      
      // You could also handle sorting here:
      // if (params.sort === '-value') {
      //   filtered.sort((a, b) => b.value - a.value);
      // }
      
      return filtered;
    },
    
    // IMPORTANT: Tell the plugin we handle filtering
    // This prevents the plugin from filtering the results again
    handlesFiltering: true,
    
    // You can also set:
    // handlesSorting: true,
    // handlesPagination: true,
    
    get: async (id, context) => {
      const metrics = await context.api.resources['server-metrics'].query({});
      const metric = metrics.data.find(m => m.attributes.id === id);
      if (!metric) throw new NotFoundError('server-metrics', id);
      return metric.attributes;
    }
  }
});

// ============================================================
// ADDITIONAL DATABASE RESOURCE FOR TESTING
// ============================================================
// This resource is used by the user-stats computed resource
// to demonstrate cross-resource aggregation.

const postSchema = new Schema({
  userId: { type: 'id', searchable: true }, // Foreign key to users
  content: { type: 'string', required: true },
  createdAt: { type: 'date', onCreate: () => new Date() }
});

api.addResource('posts', postSchema);

// ============================================================
// START SERVER AND CREATE TEST DATA
// ============================================================

const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 Computed API Example running on http://localhost:${PORT}`);
  console.log('\n📚 Available Endpoints:');
  
  console.log('\n1️⃣  Database-backed Resources:');
  console.log('    POST   /api/users                     - Create a user');
  console.log('    GET    /api/users                     - List all users');
  console.log('    GET    /api/users/:id                 - Get specific user');
  console.log('    POST   /api/posts                     - Create a post');
  console.log('    GET    /api/posts                     - List all posts');
  console.log('    GET    /api/posts?filter[userId]=1    - Filter posts by user');
  
  console.log('\n2️⃣  Computed Resources:');
  console.log('\n    🎲 Random Data Generator:');
  console.log('    GET    /api/random                              - Get 100 random items');
  console.log('    GET    /api/random/42                           - Get specific random item');
  console.log('    GET    /api/random?filter[category]=A           - Filter by category');
  console.log('    GET    /api/random?filter[value][gte]=500       - Filter by value >= 500');
  console.log('    GET    /api/random?sort=-value                  - Sort by value descending');
  console.log('    GET    /api/random?page[size]=5&page[number]=2  - Pagination');
  
  console.log('\n    📊 User Statistics (Aggregation):');
  console.log('    GET    /api/user-stats/:userId        - Get stats for specific user');
  console.log('    GET    /api/user-stats                - Get stats for all users');
  
  console.log('\n    ☁️  Weather Data (External API Mock):');
  console.log('    GET    /api/weather/London            - Get weather for a city');
  console.log('    GET    /api/weather                   - Get weather for all cities');
  console.log('    GET    /api/weather?filter[city]=London - Filter by city');
  
  console.log('\n    📈 Server Metrics (Custom Filtering):');
  console.log('    GET    /api/server-metrics            - Get all metrics');
  console.log('    GET    /api/server-metrics?filter[category]=performance');
  console.log('    GET    /api/server-metrics/cpu        - Get specific metric');
  
  console.log('\n💡 Try combining filters, sorting, and pagination!');
  console.log('   Example: /api/random?filter[category]=A&filter[value][gte]=500&sort=-value&page[size]=5');
  
  // Create some test data
  console.log('\n📝 Creating test data...');
  
  const user1Result = await api.resources.users.create({
    name: 'Alice Johnson',
    email: 'alice@example.com'
  });
  const user1 = user1Result?.data;
  
  const user2Result = await api.resources.users.create({
    name: 'Bob Smith',
    email: 'bob@example.com'
  });
  const user2 = user2Result?.data;
  
  // Create some posts
  await api.resources.posts.create({
    userId: parseInt(user1?.id || 1),
    content: 'Hello world! This is my first post.'
  });
  
  await api.resources.posts.create({
    userId: parseInt(user1?.id || 1),
    content: 'Another day, another post. The weather is nice today.'
  });
  
  await api.resources.posts.create({
    userId: parseInt(user2?.id || 2),
    content: 'Bob here! Just joined this platform.'
  });
  
  console.log('Test data created!\n');
  console.log('Try: GET http://localhost:3000/user-stats/1');
});