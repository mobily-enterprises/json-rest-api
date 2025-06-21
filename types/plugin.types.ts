import { HookContext, QueryResult } from './api.types.js';

export interface Plugin<TOptions = any> {
  name: string;
  install(api: any, options?: TOptions): void | Promise<void>;
}

export interface StorageAdapter {
  get(context: StorageContext): Promise<any>;
  query(context: StorageContext): Promise<QueryResult>;
  insert(context: StorageContext): Promise<any>;
  update(context: StorageContext): Promise<any>;
  delete(context: StorageContext): Promise<void>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
}

export interface StorageContext extends HookContext {
  schema: any; // Will be Schema type once converted
  joins?: JoinDefinition[];
  transaction?: any;
  skipHooks?: boolean;
}

export interface JoinDefinition {
  resource: string;
  localField: string;
  foreignField: string;
  type: 'inner' | 'left' | 'right';
  alias: string;
  fields?: string[];
  where?: Record<string, any>;
}

// Queue Plugin Types
export interface QueueJob<T = any> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  result?: any;
  progress?: number;
}

export interface QueueOptions {
  name: string;
  concurrency?: number;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface JobOptions {
  delay?: number;
  priority?: number;
  attempts?: number;
  backoff?: {
    type: 'fixed' | 'exponential';
    delay: number;
  };
}

export interface Queue<T = any> {
  add(name: string, data: T, options?: JobOptions): Promise<QueueJob<T>>;
  process(name: string, concurrency: number, handler: (job: QueueJob<T>) => Promise<void>): void;
  process(name: string, handler: (job: QueueJob<T>) => Promise<void>): void;
  on(event: 'completed' | 'failed' | 'progress' | 'stalled', listener: (job: QueueJob<T>) => void): void;
  getJob(id: string): Promise<QueueJob<T> | null>;
  getJobs(types: Array<'waiting' | 'active' | 'completed' | 'failed' | 'delayed'>): Promise<QueueJob<T>[]>;
  clean(grace: number, type?: 'completed' | 'failed'): Promise<number>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

// Scheduler Plugin Types
export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  handler: () => Promise<void>;
  lastRun?: Date;
  nextRun: Date;
  enabled: boolean;
  running: boolean;
  error?: string;
}

export interface SchedulerOptions {
  timezone?: string;
  runOnInit?: boolean;
}

export interface Scheduler {
  schedule(name: string, cron: string, handler: () => Promise<void>, options?: SchedulerOptions): ScheduledJob;
  unschedule(nameOrId: string): void;
  start(): void;
  stop(): void;
  getJobs(): ScheduledJob[];
  getJob(nameOrId: string): ScheduledJob | undefined;
  trigger(nameOrId: string): Promise<void>;
}