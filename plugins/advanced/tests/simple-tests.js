import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api } from '../../../lib/api.js';
import { Schema } from '../../../lib/schema.js';
import { MemoryPlugin } from '../../memory.js';
import { CachePlugin } from '../cache/index.js';
import { ConfigPlugin } from '../config/index.js';
import { VersioningPlugin } from '../versioning/index.js';
import { ContextPlugin } from '../context/index.js';
import { InterceptorsPlugin } from '../interceptors/index.js';
import { TracingPlugin } from '../tracing/index.js';

describe('Advanced Plugins Simple Tests', () => {
  let api;

  beforeEach(async () => {
    api = new Api();
    api.use(MemoryPlugin);
    await api.connect();
  });

  afterEach(async () => {
    if (api && api.disconnect) {
      await api.disconnect();
    }
  });

  describe('CachePlugin', () => {
    it('should cache GET requests', async () => {
      api.use(CachePlugin, { store: 'memory', ttl: 60 });
      
      api.addResource('users', new Schema({
        name: { type: 'string', required: true }
      }));

      // Create a user
      const createResult = await api.resources.users.create({ name: 'John' });
      const userId = createResult.data.id;

      // First GET - cache miss
      const stats1 = api.cache.stats();
      await api.resources.users.get(userId);
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1, 'Should have 1 cache miss');

      // Second GET - cache hit
      await api.resources.users.get(userId);
      const stats3 = api.cache.stats();
      
      assert.equal(stats3.hits - stats2.hits, 1, 'Should have 1 cache hit');
    });
  });

  describe('ConfigPlugin', () => {
    it('should load and access configuration', async () => {
      api.use(ConfigPlugin, {
        defaults: {
          appName: 'TestApp',
          version: '1.0.0'
        }
      });

      // ConfigPlugin.get() with no args returns all config
      const config = api.config.getAll();
      assert.equal(config.appName, 'TestApp');
      assert.equal(config.version, '1.0.0');
    });

    it('should get specific config values', async () => {
      api.use(ConfigPlugin, {
        defaults: {
          database: { host: 'localhost', port: 3306 }
        }
      });

      const dbHost = api.config.get('database.host');
      assert.equal(dbHost, 'localhost');
    });
  });

  describe('VersioningPlugin', () => {
    it('should handle API versioning', async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        header: 'api-version',
        defaultVersion: '1.0',
        versions: {
          '1.0': { deprecated: false },
          '2.0': { deprecated: false }
        }
      });

      api.addResource('users', new Schema({
        name: { type: 'string', required: true }
      }));

      // Version info should be available
      assert(api.versioning);
      assert.equal(api.versioning.options.defaultVersion, '1.0');
    });
  });

  describe('ContextPlugin', () => {
    it('should provide async context storage', async () => {
      api.use(ContextPlugin);

      api.addResource('users', new Schema({
        name: { type: 'string', required: true }
      }));

      // Context plugin works within async contexts
      let contextWorked = false;
      
      await api.context.run({ requestId: '123' }, async () => {
        api.context.set('testKey', 'testValue');
        const value = api.context.get('testKey');
        contextWorked = (value === 'testValue');
      });

      assert(contextWorked, 'Context should preserve values within async context');
    });
  });

  describe('InterceptorsPlugin', () => {
    it('should register interceptors', async () => {
      api.use(InterceptorsPlugin);

      // Check that interceptor API is available
      assert(api.interceptors, 'Interceptors API should be available');
      assert(api.interceptors.request, 'Request interceptors should be available');
      assert(api.interceptors.response, 'Response interceptors should be available');
      
      // Register interceptors
      api.interceptors.request.use(async (context) => {
        context.modified = true;
        return context;
      });
      
      api.interceptors.response.use(async (response) => {
        response.intercepted = true;
        return response;
      });
      
      // Check interceptor stats
      const stats = api.interceptors.stats();
      assert.equal(stats.request, 1, 'Should have 1 request interceptor');
      assert.equal(stats.response, 1, 'Should have 1 response interceptor');
      
      // Test clear
      api.interceptors.clear();
      const clearedStats = api.interceptors.stats();
      assert.equal(clearedStats.request, 0, 'Should have no request interceptors after clear');
      assert.equal(clearedStats.response, 0, 'Should have no response interceptors after clear');
    });
  });

  describe('TracingPlugin', () => {
    it('should create spans for operations', async () => {
      api.use(TracingPlugin, {
        serviceName: 'test-api'
      });

      api.addResource('users', new Schema({
        name: { type: 'string', required: true }
      }));

      // Check that tracing is initialized
      assert(api.tracing, 'Tracing should be available');
      assert(typeof api.tracing.extract === 'function', 'extract should be available');
      assert(typeof api.tracing.inject === 'function', 'inject should be available');
      
      // Check that span methods are available on api directly
      assert(typeof api.startSpan === 'function', 'api.startSpan should be available');
      
      // Manually create a span
      const span = api.startSpan('test-operation');
      assert(span, 'Should create a span');
      span.end();
      
      // The plugin automatically creates spans for operations
      const result = await api.resources.users.create({ name: 'Test' });
      assert(result.data.id, 'Should create user successfully with tracing enabled');
    });
  });
});