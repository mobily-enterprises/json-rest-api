import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

function parseCron(cron) {
  const parts = cron.split(' ');
  if (parts.length !== 5) {
    throw new Error('Invalid cron expression');
  }
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map(part => {
    if (part === '*') return null;
    if (part.includes(',')) return part.split(',').map(Number);
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      const range = [];
      for (let i = start; i <= end; i++) range.push(i);
      return range;
    }
    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const start = range === '*' ? 0 : Number(range);
      return { start, step: Number(step) };
    }
    return Number(part);
  });

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function getNextRun(cron, from = new Date()) {
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  const { minute, hour, dayOfMonth, month, dayOfWeek } = parseCron(cron);
  
  for (let attempts = 0; attempts < 366 * 24 * 60; attempts++) {
    next.setMinutes(next.getMinutes() + 1);
    
    if (month !== null && !matchValue(next.getMonth() + 1, month)) continue;
    if (dayOfMonth !== null && !matchValue(next.getDate(), dayOfMonth)) continue;
    if (dayOfWeek !== null && !matchValue(next.getDay(), dayOfWeek)) continue;
    if (hour !== null && !matchValue(next.getHours(), hour)) continue;
    if (minute !== null && !matchValue(next.getMinutes(), minute)) continue;
    
    return next;
  }
  
  throw new Error('Could not find next run time');
}

function matchValue(value, pattern) {
  if (pattern === null) return true;
  if (typeof pattern === 'number') return value === pattern;
  if (Array.isArray(pattern)) return pattern.includes(value);
  if (pattern.step) {
    return (value - pattern.start) % pattern.step === 0;
  }
  return false;
}

class ScheduledJob extends EventEmitter {
  constructor(id, name, cron, handler, options = {}) {
    super();
    this.id = id;
    this.name = name;
    this.cron = cron;
    this.handler = handler;
    this.options = options;
    this.enabled = true;
    this.running = false;
    this.lastRun = null;
    this.nextRun = getNextRun(cron);
    this.error = null;
    this.timer = null;
  }

  async run() {
    if (!this.enabled || this.running) return;
    
    this.running = true;
    this.lastRun = new Date();
    this.error = null;
    
    try {
      await this.handler();
      this.emit('success', this);
    } catch (error) {
      this.error = error.message;
      this.emit('error', this, error);
    } finally {
      this.running = false;
      this.nextRun = getNextRun(this.cron);
      this.emit('complete', this);
    }
  }

  schedule() {
    this.cancel();
    
    if (!this.enabled) return;
    
    const delay = this.nextRun - Date.now();
    if (delay <= 0) {
      this.run().then(() => this.schedule());
    } else {
      this.timer = setTimeout(() => {
        this.run().then(() => this.schedule());
      }, delay);
    }
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  enable() {
    this.enabled = true;
    this.schedule();
  }

  disable() {
    this.enabled = false;
    this.cancel();
  }
}

class Scheduler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      timezone: 'UTC',
      runOnInit: false,
      ...options
    };
    this.jobs = new Map();
    this.started = false;
  }

  schedule(name, cron, handler, options = {}) {
    const id = randomUUID();
    const job = new ScheduledJob(id, name, cron, handler, { ...this.options, ...options });
    
    job.on('error', (job, error) => this.emit('error', job, error));
    job.on('success', (job) => this.emit('success', job));
    job.on('complete', (job) => this.emit('complete', job));
    
    this.jobs.set(id, job);
    
    if (this.started) {
      job.schedule();
      if (options.runOnInit) {
        job.run();
      }
    }
    
    return job;
  }

  unschedule(nameOrId) {
    let job;
    
    if (this.jobs.has(nameOrId)) {
      job = this.jobs.get(nameOrId);
    } else {
      for (const j of this.jobs.values()) {
        if (j.name === nameOrId) {
          job = j;
          break;
        }
      }
    }
    
    if (job) {
      job.cancel();
      job.removeAllListeners();
      this.jobs.delete(job.id);
    }
  }

  start() {
    if (this.started) return;
    
    this.started = true;
    for (const job of this.jobs.values()) {
      job.schedule();
      if (this.options.runOnInit) {
        job.run();
      }
    }
  }

  stop() {
    if (!this.started) return;
    
    this.started = false;
    for (const job of this.jobs.values()) {
      job.cancel();
    }
  }

  getJobs() {
    return Array.from(this.jobs.values());
  }

  getJob(nameOrId) {
    if (this.jobs.has(nameOrId)) {
      return this.jobs.get(nameOrId);
    }
    
    for (const job of this.jobs.values()) {
      if (job.name === nameOrId) {
        return job;
      }
    }
    
    return undefined;
  }

  async trigger(nameOrId) {
    const job = this.getJob(nameOrId);
    if (!job) {
      throw new Error('Job not found');
    }
    
    await job.run();
  }

  destroy() {
    this.stop();
    for (const job of this.jobs.values()) {
      job.removeAllListeners();
    }
    this.jobs.clear();
    this.removeAllListeners();
  }
}

export const SchedulerPlugin = {
  name: 'scheduler',
  
  install(api, options = {}) {
    const scheduler = new Scheduler(options);
    api.scheduler = scheduler;

    api.addResource('scheduled_jobs', {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      cron: { type: 'string', required: true },
      enabled: { type: 'boolean', defaultValue: true },
      lastRun: { type: 'timestamp' },
      nextRun: { type: 'timestamp' },
      error: { type: 'string' },
      metadata: { type: 'serialize' }
    });

    api.hook('afterInsert', async (context) => {
      if (context.resource === 'scheduled_jobs') {
        const job = scheduler.schedule(
          context.data.name,
          context.data.cron,
          async () => {
            await api.resources.scheduled_jobs.update(context.data.id, {
              lastRun: new Date(),
              nextRun: getNextRun(context.data.cron),
              error: null
            });
          }
        );
        
        job.on('error', async (job, error) => {
          await api.resources.scheduled_jobs.update(context.data.id, {
            error: error.message
          });
        });
      }
    });

    api.hook('afterUpdate', async (context) => {
      if (context.resource === 'scheduled_jobs') {
        const existing = scheduler.getJob(context.data.name);
        if (existing) {
          if (context.data.enabled === false) {
            existing.disable();
          } else if (context.data.enabled === true) {
            existing.enable();
          }
          
          if (context.data.cron && context.data.cron !== existing.cron) {
            scheduler.unschedule(context.data.name);
            const job = scheduler.schedule(
              context.data.name,
              context.data.cron,
              existing.handler
            );
          }
        }
      }
    });

    api.hook('afterDelete', async (context) => {
      if (context.resource === 'scheduled_jobs' && context.data?.name) {
        scheduler.unschedule(context.data.name);
      }
    });

    process.on('SIGINT', () => scheduler.destroy());
    process.on('SIGTERM', () => scheduler.destroy());
  }
};