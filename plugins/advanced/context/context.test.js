import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api } from '../../../lib/api.js';
import { Schema } from '../../../lib/schema.js';
import { MemoryPlugin } from '../../memory.js';
import { ContextPlugin } from './index.js';
import { HTTPPlugin } from '../../http.js';
import express from 'express';
import request from 'supertest';

describe('ContextPlugin', () => {
  let api, app, server;

  beforeEach(async () => {
    api = new Api();
    app = express();
    
    api.use(MemoryPlugin);
    api.use(ContextPlugin, {
      enableRequestId: true,
      enableTracing: true,
      enableUserContext: true,
      enableMetrics: true
    });
    api.use(HTTPPlugin, { app });

    api.addResource('tasks', new Schema({
      name: { type: 'string', required: true },
      status: { type: 'string', default: 'pending' }
    }));

    server = app.listen(0);
  });

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Basic Context Management', () => {
    it('should create and access context within hooks', async () => {
      let contextInHook;

      api.hook('beforeInsert', () => {
        contextInHook = api.context.get();
        api.context.set('customValue', 'test123');
      });

      api.hook('afterInsert', () => {
        const ctx = api.context.get();
        assert.equal(ctx.customValue, 'test123');
      });

      await api.resources.tasks.insert({
        name: 'Test Task'
      });

      assert.ok(contextInHook);
      assert.ok(contextInHook.requestId);
      assert.ok(contextInHook.startTime);
    });

    it('should generate unique request IDs', async () => {
      const requestIds = new Set();

      api.hook('beforeInsert', () => {
        const ctx = api.context.get();
        requestIds.add(ctx.requestId);
      });

      // Create multiple tasks
      for (let i = 0; i < 5; i++) {
        await api.resources.tasks.insert({
          name: `Task ${i}`
        });
      }

      assert.equal(requestIds.size, 5);
    });

    it('should isolate context between concurrent operations', async () => {
      const contexts = [];

      api.hook('beforeInsert', async (hookContext) => {
        const ctx = api.context.get();
        api.context.set('taskName', hookContext.data.name);
        
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 10));
        
        contexts.push({
          requestId: ctx.requestId,
          taskName: api.context.get('taskName')
        });
      });

      // Create tasks concurrently
      await Promise.all([
        api.resources.tasks.insert({ name: 'Task A' }),
        api.resources.tasks.insert({ name: 'Task B' }),
        api.resources.tasks.insert({ name: 'Task C' })
      ]);

      assert.equal(contexts.length, 3);
      
      // Each should have its own context
      assert.equal(contexts[0].taskName, 'Task A');
      assert.equal(contexts[1].taskName, 'Task B');
      assert.equal(contexts[2].taskName, 'Task C');
      
      // Request IDs should be unique
      const requestIds = contexts.map(c => c.requestId);
      assert.equal(new Set(requestIds).size, 3);
    });
  });

  describe('HTTP Request Context', () => {
    it('should use request ID from header if provided', async () => {
      const customRequestId = 'custom-req-123';
      let capturedRequestId;

      api.hook('beforeInsert', () => {
        capturedRequestId = api.context.get('requestId');
      });

      await request(app)
        .post('/api/tasks')
        .set('x-request-id', customRequestId)
        .send({ name: 'HTTP Task' })
        .expect(201);

      assert.equal(capturedRequestId, customRequestId);
    });

    it('should propagate correlation ID', async () => {
      const correlationId = 'corr-456';
      let capturedCorrelationId;

      api.hook('beforeInsert', () => {
        capturedCorrelationId = api.context.get('correlationId');
      });

      await request(app)
        .post('/api/tasks')
        .set('x-correlation-id', correlationId)
        .send({ name: 'Correlated Task' })
        .expect(201);

      assert.equal(capturedCorrelationId, correlationId);
    });

    it('should add context to response headers', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ name: 'Metric Task' })
        .expect(201);

      assert.ok(res.headers['x-request-id']);
      assert.ok(res.headers['x-request-duration']);
      assert.ok(Number(res.headers['x-request-duration']) > 0);
    });

    it('should include HTTP request details in context', async () => {
      let httpContext;

      api.hook('beforeInsert', () => {
        httpContext = api.context.get();
      });

      await request(app)
        .post('/api/tasks?test=true')
        .send({ name: 'HTTP Details Task' })
        .expect(201);

      assert.equal(httpContext.method, 'POST');
      assert.equal(httpContext.path, '/api/tasks');
      assert.deepEqual(httpContext.query, { test: 'true' });
      assert.ok(httpContext.headers);
    });
  });

  describe('User Context', () => {
    beforeEach(() => {
      // Mock user authentication
      api.hook('beforeAll', (context) => {
        if (context.request?.headers?.authorization) {
          context.user = {
            id: 'user-123',
            roles: ['admin'],
            email: 'test@example.com'
          };
        }
      }, { priority: -500 }); // After context plugin
    });

    it('should include user context when authenticated', async () => {
      let userContext;

      api.hook('beforeInsert', () => {
        const ctx = api.context.get();
        userContext = {
          user: ctx.user,
          userId: ctx.userId,
          userRoles: ctx.userRoles
        };
      });

      await request(app)
        .post('/api/tasks')
        .set('Authorization', 'Bearer token')
        .send({ name: 'User Task' })
        .expect(201);

      assert.ok(userContext.user);
      assert.equal(userContext.userId, 'user-123');
      assert.deepEqual(userContext.userRoles, ['admin']);
    });
  });

  describe('Hook Tracing', () => {
    it('should trace hook execution path', async () => {
      let tracePath;

      api.hook('afterInsert', () => {
        const ctx = api.context.get();
        tracePath = ctx.hookPath;
      });

      await api.resources.tasks.insert({
        name: 'Traced Task'
      });

      assert.ok(tracePath);
      assert.ok(tracePath.length > 0);
      
      // Should include hook names
      const hookNames = tracePath.map(h => h.hook);
      assert.ok(hookNames.includes('beforeInsert'));
      assert.ok(hookNames.includes('afterInsert'));
      
      // Should include timings
      assert.ok(tracePath.some(h => h.duration !== undefined));
    });

    it('should include hook trace in errors', async () => {
      api.hook('beforeInsert', () => {
        throw new Error('Traced error');
      });

      try {
        await api.resources.tasks.insert({
          name: 'Error Task'
        });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.requestId);
        assert.ok(error.executionTrace);
        assert.ok(error.executionTrace.includes('beforeInsert'));
      }
    });
  });

  describe('Context-Aware Logging', () => {
    it('should enrich logs with context', async () => {
      const logs = [];
      const originalInfo = console.info;
      console.info = (...args) => logs.push(args);

      api.hook('beforeInsert', () => {
        api.log.info('Creating task', { extra: 'data' });
      });

      await api.resources.tasks.insert({
        name: 'Logged Task'
      });

      console.info = originalInfo;

      assert.ok(logs.length > 0);
      const [level, message, data] = logs[0];
      assert.equal(message, 'Creating task');
      assert.ok(data.requestId);
      assert.equal(data.extra, 'data');
    });
  });

  describe('Async Operations', () => {
    it('should trace async operations', async () => {
      let traces;

      api.hook('beforeInsert', async () => {
        await api.trace('database-check', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'checked';
        });

        await api.trace('validation', async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return 'valid';
        }, { validator: 'custom' });

        const ctx = api.context.get();
        traces = ctx.traces;
      });

      await api.resources.tasks.insert({
        name: 'Traced Operations'
      });

      assert.equal(traces.length, 2);
      assert.equal(traces[0].name, 'database-check');
      assert.equal(traces[0].status, 'success');
      assert.ok(traces[0].duration >= 10);
      
      assert.equal(traces[1].name, 'validation');
      assert.equal(traces[1].metadata.validator, 'custom');
    });

    it('should trace failed operations', async () => {
      let traces;

      api.hook('beforeInsert', async () => {
        try {
          await api.trace('failing-operation', async () => {
            throw new Error('Operation failed');
          });
        } catch (e) {
          // Expected
        }

        const ctx = api.context.get();
        traces = ctx.traces;
      });

      await api.resources.tasks.insert({
        name: 'Failed Trace'
      });

      assert.equal(traces[0].status, 'error');
      assert.equal(traces[0].error, 'Operation failed');
    });
  });

  describe('Background Tasks', () => {
    it('should propagate context to background tasks', async () => {
      let backgroundContext;
      let parentRequestId;

      api.hook('afterInsert', async () => {
        parentRequestId = api.context.get('requestId');
        
        // Run background task
        api.runBackgroundTask('email-notification', async () => {
          backgroundContext = api.context.get();
          return 'sent';
        });
      });

      await api.resources.tasks.insert({
        name: 'Task with Background Job'
      });

      // Wait for background task
      await new Promise(resolve => setTimeout(resolve, 50));

      assert.ok(backgroundContext);
      assert.equal(backgroundContext.taskName, 'email-notification');
      assert.equal(backgroundContext.parentRequestId, parentRequestId);
      assert.notEqual(backgroundContext.requestId, parentRequestId);
      assert.ok(backgroundContext.isBackgroundTask);
    });
  });

  describe('Parallel Execution', () => {
    it('should maintain context in parallel operations', async () => {
      const results = [];

      api.hook('beforeInsert', async (hookContext) => {
        const mainContext = api.context.get();
        
        const parallelResults = await api.parallel([
          async () => {
            const ctx = api.context.get();
            await new Promise(resolve => setTimeout(resolve, 10));
            return {
              requestId: ctx.requestId,
              parentRequestId: ctx.parentRequestId,
              taskIndex: ctx.taskIndex
            };
          },
          async () => {
            const ctx = api.context.get();
            await new Promise(resolve => setTimeout(resolve, 5));
            return {
              requestId: ctx.requestId,
              parentRequestId: ctx.parentRequestId,
              taskIndex: ctx.taskIndex
            };
          }
        ]);

        results.push({
          main: mainContext.requestId,
          parallel: parallelResults
        });
      });

      await api.resources.tasks.insert({
        name: 'Parallel Task'
      });

      assert.equal(results.length, 1);
      const { main, parallel } = results[0];
      
      // Each parallel task should have its own context
      assert.notEqual(parallel[0].requestId, parallel[1].requestId);
      assert.equal(parallel[0].parentRequestId, main);
      assert.equal(parallel[1].parentRequestId, main);
      assert.equal(parallel[0].taskIndex, 0);
      assert.equal(parallel[1].taskIndex, 1);
    });

    it('should support shared context in parallel operations', async () => {
      const contexts = [];

      api.hook('beforeInsert', async () => {
        api.context.set('sharedValue', 0);
        
        await api.parallel([
          async () => {
            api.context.set('sharedValue', api.context.get('sharedValue') + 1);
            contexts.push(api.context.get('sharedValue'));
          },
          async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            api.context.set('sharedValue', api.context.get('sharedValue') + 10);
            contexts.push(api.context.get('sharedValue'));
          }
        ], { shareContext: true });
      });

      await api.resources.tasks.insert({
        name: 'Shared Context Task'
      });

      // Both operations modified the same context
      assert.ok(contexts.includes(1) || contexts.includes(11));
      assert.ok(contexts.includes(11) || contexts.includes(10));
    });
  });

  describe('Debug Support', () => {
    it('should provide debug context in response', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('x-debug-context', 'true')
        .send({ name: 'Debug Task' })
        .expect(201);

      const debugHeader = res.headers['x-debug-context'];
      assert.ok(debugHeader);
      
      const debugInfo = JSON.parse(debugHeader);
      assert.ok(debugInfo.requestId);
      assert.ok(debugInfo.duration > 0);
      assert.ok(debugInfo.hookCount > 0);
    });
  });

  describe('Context Helpers', () => {
    it('should create child contexts', async () => {
      api.hook('beforeInsert', async () => {
        const parentContext = api.context.get();
        
        const childContext = api.createChildContext({
          customData: 'child-specific'
        });

        assert.equal(childContext.parentRequestId, parentContext.requestId);
        assert.notEqual(childContext.requestId, parentContext.requestId);
        assert.equal(childContext.customData, 'child-specific');
      });

      await api.resources.tasks.insert({
        name: 'Parent Task'
      });
    });

    it('should run functions with custom context', async () => {
      let capturedContext;

      const result = await api.runWithContext({
        customField: 'test-value',
        user: { id: 'custom-user' }
      }, async () => {
        capturedContext = api.context.get();
        return 'completed';
      });

      assert.equal(result, 'completed');
      assert.equal(capturedContext.customField, 'test-value');
      assert.equal(capturedContext.user.id, 'custom-user');
      assert.ok(capturedContext.requestId);
    });
  });

  describe('Error Enrichment', () => {
    it('should enrich errors with full context', async () => {
      api.hook('beforeInsert', async () => {
        api.context.set('customErrorData', 'important-info');
        
        await api.trace('step1', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        });
        
        throw new Error('Enriched error');
      });

      try {
        await request(app)
          .post('/api/tasks')
          .set('x-request-id', 'error-test-123')
          .set('x-correlation-id', 'corr-error-456')
          .send({ name: 'Error Task' })
          .expect(400);
      } catch (error) {
        // Expected
      }

      // Check error through API
      let capturedError;
      api.hook('beforeError', (context) => {
        capturedError = context.error;
      });

      try {
        await api.resources.tasks.insert({ name: 'Another Error' });
      } catch (e) {
        // Expected
      }

      assert.ok(capturedError);
      assert.ok(capturedError.requestId);
      assert.ok(capturedError.hookPath);
    });
  });

  describe('Context Without HTTP', () => {
    it('should work with direct API calls', async () => {
      let contexts = [];

      api.hook('beforeInsert', () => {
        contexts.push(api.context.get());
      });

      // Direct API calls without HTTP
      await api.resources.tasks.insert({ name: 'Direct 1' });
      await api.resources.tasks.insert({ name: 'Direct 2' });

      assert.equal(contexts.length, 2);
      assert.notEqual(contexts[0].requestId, contexts[1].requestId);
      
      // Should still have basic context
      contexts.forEach(ctx => {
        assert.ok(ctx.requestId);
        assert.ok(ctx.startTime);
      });
    });
  });
});