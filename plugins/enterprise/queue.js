import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

class MemoryQueue extends EventEmitter {
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.options = {
      concurrency: 1,
      retries: 3,
      retryDelay: 1000,
      timeout: 30000,
      ...options
    };
    
    this.jobs = new Map();
    this.waiting = [];
    this.active = [];
    this.completed = [];
    this.failed = [];
    this.delayed = [];
    
    this.processors = new Map();
    this.running = false;
    this.paused = false;
    this.timers = new Map();
  }

  async add(name, data, options = {}) {
    const job = {
      id: randomUUID(),
      name,
      data,
      attempts: 0,
      createdAt: new Date(),
      processedAt: null,
      completedAt: null,
      failedAt: null,
      error: null,
      result: null,
      progress: 0,
      options: {
        delay: 0,
        priority: 0,
        attempts: this.options.retries,
        ...options
      }
    };

    this.jobs.set(job.id, job);

    if (job.options.delay > 0) {
      job.delayedUntil = new Date(Date.now() + job.options.delay);
      this.delayed.push(job.id);
      this._scheduleDelayed(job);
    } else {
      this._addToWaiting(job.id);
    }

    this._processNext();
    return job;
  }

  process(name, concurrencyOrHandler, handler) {
    const concurrency = typeof concurrencyOrHandler === 'number' ? concurrencyOrHandler : 1;
    const processor = handler || concurrencyOrHandler;
    
    this.processors.set(name, { concurrency, handler: processor });
    this.running = true;
    this._processNext();
  }

  async _processNext() {
    if (this.paused || !this.running) return;
    
    const availableSlots = this._getAvailableSlots();
    if (availableSlots <= 0) return;

    const jobId = this._getNextJob();
    if (!jobId) return;

    const job = this.jobs.get(jobId);
    if (!job) return;

    const processor = this.processors.get(job.name);
    if (!processor) {
      this.waiting.push(jobId);
      return;
    }

    this.active.push(jobId);
    job.processedAt = new Date();
    job.attempts++;

    try {
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), this.options.timeout);
      });

      const result = await Promise.race([
        processor.handler(job),
        timeout
      ]);

      job.result = result;
      job.completedAt = new Date();
      this._moveToCompleted(jobId);
      this.emit('completed', job);
    } catch (error) {
      job.error = error.message;
      
      if (job.attempts < job.options.attempts) {
        this._retry(job);
      } else {
        job.failedAt = new Date();
        this._moveToFailed(jobId);
        this.emit('failed', job);
      }
    }

    this._processNext();
  }

  _getAvailableSlots() {
    const totalConcurrency = Array.from(this.processors.values())
      .reduce((sum, p) => sum + p.concurrency, 0);
    return Math.min(this.options.concurrency, totalConcurrency) - this.active.length;
  }

  _getNextJob() {
    this.waiting.sort((a, b) => {
      const jobA = this.jobs.get(a);
      const jobB = this.jobs.get(b);
      return (jobB.options.priority || 0) - (jobA.options.priority || 0);
    });
    
    return this.waiting.shift();
  }

  _addToWaiting(jobId) {
    this.waiting.push(jobId);
  }

  _moveToCompleted(jobId) {
    this.active = this.active.filter(id => id !== jobId);
    this.completed.push(jobId);
  }

  _moveToFailed(jobId) {
    this.active = this.active.filter(id => id !== jobId);
    this.failed.push(jobId);
  }

  _retry(job) {
    const delay = job.options.backoff 
      ? this._calculateBackoff(job)
      : this.options.retryDelay;
    
    job.delayedUntil = new Date(Date.now() + delay);
    this.active = this.active.filter(id => id !== job.id);
    this.delayed.push(job.id);
    this._scheduleDelayed(job);
  }

  _calculateBackoff(job) {
    const { type = 'fixed', delay } = job.options.backoff;
    if (type === 'exponential') {
      return delay * Math.pow(2, job.attempts - 1);
    }
    return delay;
  }

  _scheduleDelayed(job) {
    const delay = job.delayedUntil - Date.now();
    const timer = setTimeout(() => {
      this.delayed = this.delayed.filter(id => id !== job.id);
      this._addToWaiting(job.id);
      this._processNext();
      this.timers.delete(job.id);
    }, delay);
    
    this.timers.set(job.id, timer);
  }

  async getJob(id) {
    return this.jobs.get(id) || null;
  }

  async getJobs(types = ['waiting', 'active', 'completed', 'failed', 'delayed']) {
    const jobs = [];
    
    for (const type of types) {
      const ids = this[type] || [];
      jobs.push(...ids.map(id => this.jobs.get(id)).filter(Boolean));
    }
    
    return jobs;
  }

  async clean(grace, type = 'completed') {
    const cutoff = Date.now() - grace;
    const list = type === 'completed' ? this.completed : this.failed;
    let cleaned = 0;

    this[type] = list.filter(id => {
      const job = this.jobs.get(id);
      if (job && job[`${type}At`] < cutoff) {
        this.jobs.delete(id);
        cleaned++;
        return false;
      }
      return true;
    });

    return cleaned;
  }

  async pause() {
    this.paused = true;
  }

  async resume() {
    this.paused = false;
    this._processNext();
  }

  async close() {
    this.running = false;
    this.paused = true;
    
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    
    this.removeAllListeners();
  }

  updateProgress(jobId, progress) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = progress;
      this.emit('progress', job);
    }
  }
}

class QueueManager {
  constructor() {
    this.queues = new Map();
  }

  createQueue(name, options) {
    if (this.queues.has(name)) {
      return this.queues.get(name);
    }
    
    const queue = new MemoryQueue(name, options);
    this.queues.set(name, queue);
    return queue;
  }

  getQueue(name) {
    return this.queues.get(name);
  }

  async closeAll() {
    const promises = [];
    for (const queue of this.queues.values()) {
      promises.push(queue.close());
    }
    await Promise.all(promises);
    this.queues.clear();
  }
}

export const QueuePlugin = {
  name: 'queue',
  
  install(api, options = {}) {
    const manager = new QueueManager();
    
    api.queue = {
      create(name, queueOptions) {
        return manager.createQueue(name, { ...options, ...queueOptions });
      },
      
      get(name) {
        return manager.getQueue(name);
      },
      
      async closeAll() {
        return manager.closeAll();
      }
    };

    api.hook('afterInsert', async (context) => {
      if (context.resource === 'jobs' && context.data.type === 'queue') {
        const queue = api.queue.get(context.data.queue) || api.queue.create(context.data.queue);
        await queue.add(context.data.name, context.data.data, context.data.options);
      }
    });

    api.hook('beforeDelete', async (context) => {
      if (context.resource === 'jobs' && context.data?.type === 'queue') {
        const queue = api.queue.get(context.data.queue);
        if (queue) {
          const job = await queue.getJob(context.id);
          if (job && job.status === 'active') {
            throw new Error('Cannot delete active job');
          }
        }
      }
    });

    api.addResource('jobs', {
      id: { type: 'id' },
      type: { type: 'string', required: true, enum: ['queue', 'scheduled'] },
      queue: { type: 'string' },
      name: { type: 'string', required: true },
      data: { type: 'serialize' },
      options: { type: 'serialize' },
      status: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed'] },
      attempts: { type: 'number', defaultValue: 0 },
      error: { type: 'string' },
      result: { type: 'serialize' },
      progress: { type: 'number', defaultValue: 0 },
      createdAt: { type: 'timestamp' },
      processedAt: { type: 'timestamp' },
      completedAt: { type: 'timestamp' },
      failedAt: { type: 'timestamp' }
    });
  }
};