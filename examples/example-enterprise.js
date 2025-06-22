import { Api, Schema } from '../lib/api.js';
import { MySQLPlugin } from '../plugins/core/mysql.js';
import { HTTPPlugin } from '../plugins/core/http.js';
import { ValidationPlugin } from '../plugins/core/validation.js';
import { QueuePlugin } from '../plugins/enterprise/queue.js';
import { SchedulerPlugin } from '../plugins/enterprise/scheduler.js';
import {
  Resource,
  BeforeInsert,
  AfterInsert,
  BeforeUpdate,
  AfterQuery,
  Validate,
  Transform,
  Queue,
  Scheduled,
  Transaction,
  Cache,
  RateLimit,
  ResourceController,
  createResourceFromClass
} from '../lib/decorators.js';
import bcrypt from 'bcrypt';
import express from 'express';

// Define schemas with TypeScript-ready structure
const UserSchema = new Schema({
  id: { type: 'id' },
  email: { 
    type: 'string', 
    required: true, 
    format: /^[\w\.-]+@[\w\.-]+\.\w+$/,
    searchable: true,
    transform: (value) => value.toLowerCase()
  },
  password: { 
    type: 'string', 
    required: true, 
    min: 8,
    silent: true 
  },
  name: { 
    type: 'string', 
    required: true,
    searchable: true 
  },
  role: { 
    type: 'string',
    enum: ['user', 'admin', 'moderator'],
    defaultValue: 'user',
    searchable: true
  },
  status: {
    type: 'string',
    enum: ['active', 'inactive', 'banned'],
    defaultValue: 'active',
    searchable: true
  },
  metadata: { 
    type: 'object',
    defaultValue: {}
  },
  lastLoginAt: { type: 'timestamp' },
  createdAt: { type: 'timestamp' },
  updatedAt: { type: 'timestamp' }
});

const PostSchema = new Schema({
  id: { type: 'id' },
  title: { 
    type: 'string', 
    required: true,
    searchable: true 
  },
  content: { 
    type: 'string', 
    required: true 
  },
  status: {
    type: 'string',
    enum: ['draft', 'published', 'archived'],
    defaultValue: 'draft',
    searchable: true
  },
  authorId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'users',
      join: {
        eager: true,
        fields: ['id', 'name', 'email']
      }
    }
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    defaultValue: []
  },
  viewCount: {
    type: 'number',
    defaultValue: 0
  },
  publishedAt: { type: 'timestamp' },
  createdAt: { type: 'timestamp' },
  updatedAt: { type: 'timestamp' }
});

// Decorator-based User Resource Controller
@Resource('users', UserSchema)
class UserController extends ResourceController {
  @BeforeInsert()
  async validateUniqueEmail(context) {
    const existing = await this.api.resources.users.query({
      filter: { email: context.data.email }
    });
    
    if (existing.data.length > 0) {
      throw new Error('Email already exists');
    }
  }

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword(context) {
    if (context.data.password) {
      context.data.password = await bcrypt.hash(context.data.password, 10);
    }
  }

  @Transform('email', 'input')
  normalizeEmail(email) {
    return email.toLowerCase().trim();
  }

  @Validate('password')
  async validatePassword(password) {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    if (!/\d/.test(password)) {
      throw new Error('Password must contain at least one number');
    }
    if (!/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter');
    }
  }

  @AfterInsert()
  @Queue('email', 'welcome-email')
  async sendWelcomeEmail(context) {
    return {
      to: context.data.email,
      subject: 'Welcome to our platform!',
      template: 'welcome',
      data: {
        name: context.data.name
      }
    };
  }

  @Transaction()
  async bulkUpdateStatus(userIds, status) {
    const results = [];
    for (const id of userIds) {
      const result = await this.api.resources.users.update(id, { status });
      results.push(result);
    }
    return results;
  }

  @Cache(300000) // 5 minutes
  @RateLimit(100, 60000) // 100 calls per minute
  async getActiveUsers() {
    const result = await this.api.resources.users.query({
      filter: { status: 'active' },
      sort: '-lastLoginAt',
      page: { size: 100 }
    });
    return result.data;
  }

  @Scheduled('0 0 * * *') // Daily at midnight
  async cleanupInactiveUsers() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const inactive = await this.api.resources.users.query({
      filter: {
        status: 'inactive',
        lastLoginAt: { lte: thirtyDaysAgo }
      }
    });
    
    console.log(`Found ${inactive.meta.total} inactive users to clean up`);
    
    for (const user of inactive.data) {
      await this.api.resources.users.update(user.id, {
        status: 'archived',
        metadata: {
          ...user.metadata,
          archivedAt: new Date(),
          archivedReason: 'inactive-30-days'
        }
      });
    }
  }
}

// Decorator-based Post Resource Controller
@Resource('posts', PostSchema)
class PostController extends ResourceController {
  @BeforeInsert()
  async setAuthor(context) {
    if (!context.user) {
      throw new Error('Authentication required');
    }
    context.data.authorId = context.user.id;
  }

  @BeforeUpdate()
  async checkOwnership(context) {
    const post = await this.api.resources.posts.get(context.id);
    if (post.authorId !== context.user.id && context.user.role !== 'admin') {
      throw new Error('Unauthorized');
    }
  }

  @AfterQuery()
  async enrichPosts(context) {
    // Add computed fields
    for (const post of context.result.data) {
      post.readTime = Math.ceil(post.content.split(' ').length / 200);
      post.excerpt = post.content.substring(0, 150) + '...';
    }
  }

  @Queue('analytics', 'track-view')
  async trackView(postId, userId) {
    const post = await this.api.resources.posts.get(postId);
    await this.api.resources.posts.update(postId, {
      viewCount: post.viewCount + 1
    });
    
    return {
      postId,
      userId,
      timestamp: new Date()
    };
  }

  @Transaction()
  async publishPost(postId) {
    const post = await this.api.resources.posts.get(postId);
    
    if (post.status !== 'draft') {
      throw new Error('Only draft posts can be published');
    }
    
    const updated = await this.api.resources.posts.update(postId, {
      status: 'published',
      publishedAt: new Date()
    });
    
    // Queue notification
    if (this.api.queue) {
      const queue = this.api.queue.get('notifications') || this.api.queue.create('notifications');
      await queue.add('new-post', {
        postId,
        authorId: post.authorId,
        title: post.title
      });
    }
    
    return updated;
  }

  @Scheduled('0 * * * *') // Every hour
  async generateTrendingPosts() {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const trending = await this.api.resources.posts.query({
      filter: {
        status: 'published',
        publishedAt: { gte: oneDayAgo }
      },
      sort: '-viewCount',
      page: { size: 10 }
    });
    
    // Store in cache or separate trending resource
    console.log(`Generated ${trending.data.length} trending posts`);
  }
}

// Initialize API with enterprise plugins
async function setupEnterpriseApi() {
  const api = new Api({
    debug: true,
    pageSize: 20,
    maxPageSize: 100
  });

  // Core plugins
  api.use(ValidationPlugin);
  
  // Storage plugin (use MySQL for production)
  if (process.env.NODE_ENV === 'production') {
    api.use(MySQLPlugin, {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'enterprise_api'
    });
  }

  // Queue plugin
  api.use(QueuePlugin, {
    concurrency: 5,
    retries: 3,
    retryDelay: 5000
  });

  // Scheduler plugin
  api.use(SchedulerPlugin, {
    timezone: 'UTC',
    runOnInit: false
  });

  // Register decorator-based controllers
  const userController = createResourceFromClass(UserController, api);
  const postController = createResourceFromClass(PostController, api);

  // Setup queue processors
  if (api.queue) {
    const emailQueue = api.queue.get('email') || api.queue.create('email');
    
    emailQueue.process('welcome-email', async (job) => {
      console.log('Sending welcome email:', job.data);
      // Integrate with email service
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    const analyticsQueue = api.queue.get('analytics') || api.queue.create('analytics');
    
    analyticsQueue.process('track-view', 5, async (job) => {
      console.log('Tracking view:', job.data);
      // Send to analytics service
    });

    const notificationQueue = api.queue.get('notifications') || api.queue.create('notifications');
    
    notificationQueue.process('new-post', async (job) => {
      console.log('Sending new post notification:', job.data);
      // Send push notifications
    });
  }

  // HTTP plugin for REST API
  const app = express();
  api.use(HTTPPlugin, { 
    app,
    prefix: '/api',
    middleware: [
      // Add authentication middleware
      async (req, res, next) => {
        // Mock authentication
        req.user = { id: 1, role: 'admin' };
        next();
      }
    ]
  });

  // Additional enterprise endpoints
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date(),
      uptime: process.uptime()
    });
  });

  app.get('/api/metrics', async (req, res) => {
    const metrics = {
      users: await api.resources.users.count(),
      posts: await api.resources.posts.count(),
      queues: api.queue ? Object.keys(api.queue.queues).length : 0,
      scheduledJobs: api.scheduler ? api.scheduler.getJobs().length : 0
    };
    res.json(metrics);
  });

  // Start scheduler
  if (api.scheduler) {
    api.scheduler.start();
  }

  return { api, app, userController, postController };
}

// Example usage
async function main() {
  const { api, app } = await setupEnterpriseApi();

  // Create sample data
  const user = await api.resources.users.create({
    email: 'john@example.com',
    password: 'SecurePass123',
    name: 'John Doe',
    role: 'admin'
  });

  console.log('Created user:', user);

  const post = await api.resources.posts.create({
    title: 'Enterprise Features in JSON REST API',
    content: 'This post demonstrates advanced enterprise features...',
    authorId: user.id,
    tags: ['enterprise', 'typescript', 'queues', 'scheduling']
  });

  console.log('Created post:', post);

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Enterprise API server running on http://localhost:${PORT}`);
    console.log(`API endpoints available at http://localhost:${PORT}/api`);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { setupEnterpriseApi, UserController, PostController };