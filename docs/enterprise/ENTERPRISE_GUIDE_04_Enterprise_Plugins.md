# Enterprise Plugins Guide

This guide covers the enterprise-grade plugins available for json-rest-api that enable advanced features like queue management, job scheduling, caching, and more.

## Table of Contents
- [Overview](#overview)
- [Queue Plugin](#queue-plugin)
- [Scheduler Plugin](#scheduler-plugin)
- [Caching Strategies](#caching-strategies)
- [Monitoring & Metrics](#monitoring--metrics)
- [Integration Examples](#integration-examples)

## Overview

Enterprise plugins extend json-rest-api with production-ready features essential for large-scale applications:

- **Queue Management**: Background job processing with retries and priorities
- **Job Scheduling**: Cron-based task execution
- **Caching**: Multi-layer caching strategies
- **Monitoring**: Metrics, health checks, and observability
- **Rate Limiting**: API throttling and quota management

## Queue Plugin

The Queue Plugin provides robust background job processing capabilities.

### Installation

```javascript
import { QueuePlugin } from 'json-rest-api/plugins/enterprise/queue';

api.use(QueuePlugin, {
  concurrency: 5,      // Max concurrent jobs
  retries: 3,          // Default retry attempts
  retryDelay: 5000,    // Delay between retries (ms)
  timeout: 30000       // Job timeout (ms)
});
```

### Basic Usage

```javascript
// Create a queue
const emailQueue = api.queue.create('email', {
  concurrency: 2,
  retries: 5
});

// Add job processor
emailQueue.process('welcome-email', async (job) => {
  const { to, subject, template, data } = job.data;
  
  // Update progress
  job.updateProgress(25);
  
  // Send email
  await emailService.send({
    to,
    subject,
    template,
    variables: data
  });
  
  job.updateProgress(100);
  return { sentAt: new Date() };
});

// Add a job
const job = await emailQueue.add('welcome-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  template: 'welcome',
  data: { name: 'John' }
}, {
  priority: 10,        // Higher priority
  delay: 5000,         // Delay 5 seconds
  attempts: 3,         // Override retries
  backoff: {
    type: 'exponential',
    delay: 2000
  }
});

// Listen to events
emailQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

emailQueue.on('failed', (job) => {
  console.error(`Job ${job.id} failed: ${job.error}`);
});
```

### Advanced Features

#### Batch Processing

```javascript
const analyticsQueue = api.queue.create('analytics');

// Process multiple jobs concurrently
analyticsQueue.process('batch-events', 5, async (job) => {
  const { events } = job.data;
  
  for (let i = 0; i < events.length; i++) {
    await processEvent(events[i]);
    job.updateProgress((i + 1) / events.length * 100);
  }
});
```

#### Job Management

```javascript
// Get job status
const job = await emailQueue.getJob(jobId);
console.log(job.status); // 'waiting', 'active', 'completed', 'failed'

// Get jobs by type
const waitingJobs = await emailQueue.getJobs(['waiting', 'delayed']);
const failedJobs = await emailQueue.getJobs(['failed']);

// Clean old jobs
const removed = await emailQueue.clean(
  7 * 24 * 60 * 60 * 1000, // 7 days
  'completed'
);

// Pause/resume queue
await emailQueue.pause();
await emailQueue.resume();
```

#### Priority Queues

```javascript
// High priority notifications
await notificationQueue.add('urgent-alert', data, {
  priority: 100
});

// Normal priority
await notificationQueue.add('daily-digest', data, {
  priority: 50
});

// Low priority
await notificationQueue.add('analytics-report', data, {
  priority: 10
});
```

### Database Integration

The Queue Plugin automatically creates a `jobs` resource:

```javascript
// Query job history
const recentJobs = await api.resources.jobs.query({
  filter: {
    type: 'queue',
    queue: 'email',
    status: 'completed'
  },
  sort: '-completedAt',
  page: { size: 50 }
});

// Get job metrics
const metrics = await api.resources.jobs.query({
  filter: { 
    createdAt: { gte: new Date(Date.now() - 86400000) } // Last 24h
  },
  aggregate: {
    count: { by: ['queue', 'status'] },
    avg: { fields: ['attempts', 'progress'] }
  }
});
```

## Scheduler Plugin

The Scheduler Plugin enables cron-based job scheduling.

### Installation

```javascript
import { SchedulerPlugin } from 'json-rest-api/plugins/enterprise/scheduler';

api.use(SchedulerPlugin, {
  timezone: 'UTC',        // Default timezone
  runOnInit: false       // Don't run jobs on startup
});
```

### Basic Usage

```javascript
// Schedule a job
const job = api.scheduler.schedule(
  'daily-report',
  '0 9 * * *',  // Every day at 9 AM
  async () => {
    const report = await generateDailyReport();
    await emailReport(report);
  }
);

// Schedule with options
api.scheduler.schedule(
  'cleanup-temp-files',
  '0 */6 * * *',  // Every 6 hours
  async () => {
    await cleanupTempFiles();
  },
  {
    timezone: 'America/New_York',
    runOnInit: true  // Run immediately on startup
  }
);
```

### Cron Syntax

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

Examples:
- `*/15 * * * *` - Every 15 minutes
- `0 */2 * * *` - Every 2 hours
- `0 9-17 * * 1-5` - Every hour from 9 AM to 5 PM on weekdays
- `0 0 1 * *` - First day of every month at midnight

### Managing Scheduled Jobs

```javascript
// Get all jobs
const jobs = api.scheduler.getJobs();
jobs.forEach(job => {
  console.log(`${job.name}: Next run at ${job.nextRun}`);
});

// Get specific job
const job = api.scheduler.getJob('daily-report');

// Manually trigger
await api.scheduler.trigger('daily-report');

// Enable/disable
job.disable();  // Stop scheduling
job.enable();   // Resume scheduling

// Remove job
api.scheduler.unschedule('daily-report');

// Start/stop scheduler
api.scheduler.stop();   // Stop all jobs
api.scheduler.start();  // Resume all jobs
```

### Database Integration

Scheduled jobs are stored in the `scheduled_jobs` resource:

```javascript
// Create persistent scheduled job
await api.resources.scheduled_jobs.create({
  name: 'weekly-newsletter',
  cron: '0 10 * * 1',  // Monday at 10 AM
  enabled: true,
  metadata: {
    template: 'newsletter',
    recipients: ['subscribers']
  }
});

// Update schedule
await api.resources.scheduled_jobs.update(jobId, {
  cron: '0 10 * * 5',  // Change to Friday
  enabled: false       // Temporarily disable
});

// Query job history
const jobRuns = await api.resources.scheduled_jobs.query({
  filter: { lastRun: { gte: new Date(Date.now() - 86400000) } },
  sort: '-lastRun'
});
```

### Error Handling

```javascript
// Listen to scheduler events
api.scheduler.on('error', (job, error) => {
  console.error(`Job ${job.name} failed:`, error);
  // Send alert
  notifyOps(`Scheduled job failed: ${job.name}`, error);
});

api.scheduler.on('success', (job) => {
  console.log(`Job ${job.name} completed successfully`);
});

// Job with error handling
api.scheduler.schedule('risky-job', '0 * * * *', async () => {
  try {
    await riskyOperation();
  } catch (error) {
    // Log to jobs table
    await api.resources.scheduled_jobs.update(job.id, {
      error: error.message,
      lastError: new Date()
    });
    throw error; // Re-throw to trigger error event
  }
});
```

## Caching Strategies

### Response Caching

```javascript
import { CachePlugin } from 'json-rest-api/plugins/enterprise/cache';

api.use(CachePlugin, {
  store: 'memory',     // or 'redis'
  ttl: 300,           // 5 minutes default
  max: 1000,          // Max items in memory
  checkPeriod: 600    // Cleanup interval
});

// Cache specific endpoints
api.hook('afterQuery', async (context) => {
  if (context.resource === 'products' && !context.query.filter) {
    context.cache = {
      ttl: 3600,  // 1 hour for product catalog
      key: 'products:all'
    };
  }
});

// Invalidate cache
api.hook('afterInsert', async (context) => {
  if (context.resource === 'products') {
    await api.cache.invalidate('products:*');
  }
});
```

### Query Result Caching

```javascript
// Decorator for caching
import { Cache } from 'json-rest-api/decorators';

class ProductController {
  @Cache(3600) // 1 hour
  async getPopularProducts() {
    return await api.resources.products.query({
      filter: { featured: true },
      sort: '-sales',
      page: { size: 20 }
    });
  }
  
  @Cache(300, { key: (userId) => `user:${userId}:recommendations` })
  async getRecommendations(userId) {
    // Expensive recommendation algorithm
    return await calculateRecommendations(userId);
  }
}
```

## Monitoring & Metrics

### Health Checks

```javascript
import { HealthPlugin } from 'json-rest-api/plugins/enterprise/health';

api.use(HealthPlugin, {
  checks: {
    database: async () => {
      await api.resources.users.count();
      return { status: 'healthy' };
    },
    queue: async () => {
      const queues = api.queue.getQueues();
      const stats = await Promise.all(
        queues.map(q => q.getJobCounts())
      );
      return { status: 'healthy', queues: stats };
    },
    external: async () => {
      const response = await fetch('https://api.external.com/health');
      return { status: response.ok ? 'healthy' : 'unhealthy' };
    }
  }
});

// Health endpoint: GET /health
// Returns: { status: 'healthy', checks: { ... }, timestamp: ... }
```

### Metrics Collection

```javascript
import { MetricsPlugin } from 'json-rest-api/plugins/enterprise/metrics';

api.use(MetricsPlugin, {
  prometheus: true,    // Enable Prometheus endpoint
  statsd: {           // StatsD integration
    host: 'localhost',
    port: 8125
  }
});

// Automatic metrics
// - Request duration by resource/operation
// - Queue job metrics
// - Database query performance
// - Cache hit/miss rates

// Custom metrics
api.metrics.increment('custom.counter');
api.metrics.gauge('queue.size', queue.length);
api.metrics.histogram('processing.time', duration);
```

## Integration Examples

### Complete Enterprise Setup

```javascript
import { Api } from 'json-rest-api';
import { MySQLPlugin } from 'json-rest-api/plugins/mysql';
import { QueuePlugin } from 'json-rest-api/plugins/enterprise/queue';
import { SchedulerPlugin } from 'json-rest-api/plugins/enterprise/scheduler';
import { CachePlugin } from 'json-rest-api/plugins/enterprise/cache';
import { HealthPlugin } from 'json-rest-api/plugins/enterprise/health';
import { MetricsPlugin } from 'json-rest-api/plugins/enterprise/metrics';

async function setupEnterpriseApi() {
  const api = new Api({
    debug: process.env.NODE_ENV !== 'production',
    pageSize: 50
  });

  // Core plugins
  api.use(MySQLPlugin, {
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    pool: { min: 5, max: 20 }
  });

  // Enterprise plugins
  api.use(QueuePlugin, {
    concurrency: 10,
    redis: {  // Use Redis in production
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT
    }
  });

  api.use(SchedulerPlugin, {
    timezone: process.env.TZ || 'UTC'
  });

  api.use(CachePlugin, {
    store: process.env.NODE_ENV === 'production' ? 'redis' : 'memory',
    redis: {
      host: process.env.REDIS_HOST
    }
  });

  api.use(HealthPlugin);
  api.use(MetricsPlugin);

  return api;
}
```

### Microservices Communication

```javascript
// Order service using queues for async communication
class OrderService {
  async createOrder(orderData) {
    // Create order
    const order = await api.resources.orders.create(orderData);
    
    // Queue async tasks
    await api.queue.get('inventory').add('reserve-items', {
      orderId: order.id,
      items: order.items
    });
    
    await api.queue.get('notifications').add('order-confirmation', {
      orderId: order.id,
      userId: order.userId,
      email: order.email
    });
    
    await api.queue.get('analytics').add('track-order', {
      orderId: order.id,
      value: order.total,
      items: order.items.length
    });
    
    return order;
  }
}

// Inventory service processing queue
const inventoryQueue = api.queue.get('inventory');
inventoryQueue.process('reserve-items', async (job) => {
  const { orderId, items } = job.data;
  
  try {
    for (const item of items) {
      await reserveInventory(item.sku, item.quantity);
    }
    
    // Notify order service
    await api.queue.get('orders').add('inventory-reserved', {
      orderId,
      status: 'reserved'
    });
  } catch (error) {
    // Notify failure
    await api.queue.get('orders').add('inventory-failed', {
      orderId,
      error: error.message
    });
    throw error;
  }
});
```

### Scheduled Maintenance Tasks

```javascript
// Database maintenance
api.scheduler.schedule('optimize-tables', '0 3 * * 0', async () => {
  const tables = ['orders', 'order_items', 'inventory_logs'];
  
  for (const table of tables) {
    await api.database.query(`OPTIMIZE TABLE ${table}`);
  }
  
  // Clean old logs
  const deleted = await api.resources.logs.delete({
    filter: {
      createdAt: { lt: new Date(Date.now() - 90 * 86400000) } // 90 days
    }
  });
  
  console.log(`Cleaned ${deleted} old log entries`);
});

// Report generation
api.scheduler.schedule('weekly-reports', '0 8 * * 1', async () => {
  const reports = [
    { type: 'sales', recipients: ['sales@company.com'] },
    { type: 'inventory', recipients: ['ops@company.com'] },
    { type: 'performance', recipients: ['tech@company.com'] }
  ];
  
  for (const report of reports) {
    await api.queue.get('reports').add('generate', report, {
      priority: 50
    });
  }
});
```

## Best Practices

1. **Queue Design**
   - Use separate queues for different priorities
   - Set appropriate concurrency limits
   - Implement proper error handling and retries
   - Monitor queue depths and processing times

2. **Scheduler Reliability**
   - Store job state in database
   - Handle overlapping executions
   - Log all job runs for audit
   - Set up alerts for failed jobs

3. **Caching Strategy**
   - Cache at multiple levels (API, database, CDN)
   - Use cache warming for critical data
   - Implement cache invalidation patterns
   - Monitor cache effectiveness

4. **Monitoring**
   - Track queue depths and processing times
   - Monitor job success/failure rates
   - Set up alerts for anomalies
   - Use distributed tracing for complex flows

5. **Scalability**
   - Use Redis for distributed queues
   - Implement job partitioning
   - Scale workers independently
   - Use connection pooling

## Summary

Enterprise plugins provide essential features for production-grade applications:

- **Queue Plugin**: Robust background job processing
- **Scheduler Plugin**: Reliable cron-based scheduling  
- **Cache Plugin**: Multi-layer caching strategies
- **Health Plugin**: Service health monitoring
- **Metrics Plugin**: Performance and business metrics

These plugins integrate seamlessly with the core json-rest-api functionality while adding enterprise-grade reliability, scalability, and observability.