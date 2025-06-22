import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api } from '../../../lib/api.js';
import { Schema } from '../../../lib/schema.js';
import { MemoryPlugin } from '../../memory.js';
import { InterceptorsPlugin } from './index.js';
import { HTTPPlugin } from '../../http.js';
import express from 'express';
import request from 'supertest';

describe('InterceptorsPlugin', () => {
  let api, app, server;

  beforeEach(async () => {
    api = new Api();
    app = express();
    
    api.use(MemoryPlugin);
    api.use(InterceptorsPlugin);
    api.use(HTTPPlugin, { app });

    api.addResource('items', new Schema({
      name: { type: 'string', required: true },
      value: { type: 'number' },
      status: { type: 'string' }
    }));

    server = app.listen(0);
  });

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    api.interceptors.clear();
  });

  describe('Request Interceptors', () => {
    it('should modify request data', async () => {
      let interceptedData;

      api.interceptors.request.use({
        name: 'test-modifier',
        async process(context) {
          interceptedData = { ...context.data };
          
          // Add timestamp to all requests
          if (context.data) {
            context.data.timestamp = '2024-01-01';
          }
          
          return context;
        }
      });

      const result = await api.resources.items.insert({
        name: 'Test Item',
        value: 100
      });

      assert.equal(interceptedData.name, 'Test Item');
      assert.equal(interceptedData.value, 100);
      assert.equal(result.timestamp, '2024-01-01');
    });

    it('should handle multiple request interceptors in priority order', async () => {
      const order = [];

      api.interceptors.request.use({
        name: 'first',
        async process(context) {
          order.push('first');
          context.data.order = [...(context.data.order || []), 'first'];
          return context;
        }
      }, { priority: 20 });

      api.interceptors.request.use({
        name: 'second',
        async process(context) {
          order.push('second');
          context.data.order = [...(context.data.order || []), 'second'];
          return context;
        }
      }, { priority: 10 }); // Lower priority runs first

      const result = await api.resources.items.insert({
        name: 'Priority Test'
      });

      assert.deepEqual(order, ['second', 'first']);
      assert.deepEqual(result.order, ['second', 'first']);
    });

    it('should abort request on interceptor error', async () => {
      api.interceptors.request.use({
        name: 'error-interceptor',
        async process(context) {
          if (context.data?.forbidden) {
            throw new Error('Forbidden action');
          }
          return context;
        }
      });

      await assert.rejects(
        () => api.resources.items.insert({
          name: 'Forbidden Item',
          forbidden: true
        }),
        /Forbidden action/
      );
    });

    it('should timeout long-running interceptors', async () => {
      api.interceptors.request.use({
        name: 'slow-interceptor',
        async process(context) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return context;
        }
      }, { timeout: 100 });

      await assert.rejects(
        () => api.resources.items.insert({ name: 'Timeout Test' }),
        /timed out/
      );
    });
  });

  describe('Response Interceptors', () => {
    it('should modify response data', async () => {
      api.interceptors.response.use({
        name: 'response-enricher',
        async process(context) {
          // Add metadata to all responses
          context.data = {
            ...context.data,
            _meta: {
              processed: true,
              timestamp: new Date().toISOString()
            }
          };
          return context;
        }
      });

      const result = await api.resources.items.insert({
        name: 'Response Test',
        value: 200
      });

      assert.equal(result.data.name, 'Response Test');
      assert.ok(result._meta);
      assert.equal(result._meta.processed, true);
      assert.ok(result._meta.timestamp);
    });

    it('should modify response headers', async () => {
      api.interceptors.response.use({
        name: 'header-modifier',
        async process(context) {
          context.headers = {
            ...context.headers,
            'x-custom-header': 'custom-value',
            'x-response-time': '123ms'
          };
          return context;
        }
      });

      const res = await request(app)
        .post('/api/items')
        .send({ name: 'Header Test' })
        .expect(201);

      assert.equal(res.headers['x-custom-header'], 'custom-value');
      assert.equal(res.headers['x-response-time'], '123ms');
    });

    it('should access request context in response interceptor', async () => {
      let requestData;

      api.interceptors.response.use({
        name: 'context-aware',
        async process(context) {
          requestData = context.request?.data;
          
          // Echo request in response meta
          context.data = {
            ...context.data,
            _echo: context.request?.data
          };
          return context;
        }
      });

      const result = await api.resources.items.insert({
        name: 'Echo Test',
        value: 300
      });

      assert.deepEqual(requestData, { name: 'Echo Test', value: 300 });
      assert.deepEqual(result._echo, { name: 'Echo Test', value: 300 });
    });
  });

  describe('Error Interceptors', () => {
    it('should intercept and modify errors', async () => {
      api.interceptors.error.use({
        name: 'error-transformer',
        async process(context) {
          // Add request context to error
          context.error.requestData = context.request?.data;
          context.error.customMessage = 'Enhanced: ' + context.error.message;
          return context;
        }
      });

      try {
        await api.resources.items.insert({
          // Missing required field 'name'
          value: 400
        });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.customMessage);
        assert.ok(error.customMessage.includes('Enhanced:'));
        assert.deepEqual(error.requestData, { value: 400 });
      }
    });

    it('should allow error recovery', async () => {
      api.interceptors.error.use({
        name: 'error-recovery',
        async process(context) {
          if (context.error.message.includes('required')) {
            // Recover by providing default data
            context.recover = true;
            context.result = {
              id: 'recovered-1',
              name: 'Recovered Item',
              recovered: true
            };
          }
          return context;
        }
      });

      const result = await api.resources.items.insert({
        // Missing required field, but will be recovered
        value: 500
      });

      assert.equal(result.data.id, 'recovered-1');
      assert.equal(result.data.name, 'Recovered Item');
      assert.equal(result.data.recovered, true);
    });

    it('should handle error interceptor failures', async () => {
      api.interceptors.error.use({
        name: 'failing-error-interceptor',
        async process() {
          throw new Error('Error interceptor failed');
        }
      });

      try {
        await api.resources.items.insert({
          // Missing required field
          value: 600
        });
        assert.fail('Should have thrown');
      } catch (error) {
        // Should get the interceptor error instead
        assert.equal(error.message, 'Error interceptor failed');
      }
    });
  });

  describe('Timing Interceptors', () => {
    it('should track operation timing', async () => {
      let timingData;

      api.interceptors.timing.use({
        name: 'timing-tracker',
        async process(context) {
          timingData = context;
          return context;
        }
      });

      await api.resources.items.insert({
        name: 'Timing Test'
      });

      assert.ok(timingData);
      assert.ok(timingData.duration > 0);
      assert.equal(timingData.resource, 'items');
      assert.equal(timingData.method, 'insert');
      assert.equal(timingData.status, 'success');
    });

    it('should include timing marks', async () => {
      let marks;

      api.interceptors.timing.use({
        name: 'mark-tracker',
        async process(context) {
          marks = context.marks;
          return context;
        }
      });

      // Add custom hook with marks
      api.hook('beforeInsert', async () => {
        api.mark('validation-start');
        await new Promise(resolve => setTimeout(resolve, 10));
        api.mark('validation-end');
      });

      await api.resources.items.insert({
        name: 'Marks Test'
      });

      assert.ok(marks);
      assert.ok(marks.some(m => m.name === 'validation-start'));
      assert.ok(marks.some(m => m.name === 'validation-end'));
      
      const validationStart = marks.find(m => m.name === 'validation-start');
      const validationEnd = marks.find(m => m.name === 'validation-end');
      assert.ok(validationEnd.time > validationStart.time);
    });
  });

  describe('Interceptor Management', () => {
    it('should remove interceptors', async () => {
      const remove = api.interceptors.request.use({
        name: 'removable',
        async process(context) {
          context.data.intercepted = true;
          return context;
        }
      });

      // With interceptor
      let result = await api.resources.items.insert({
        name: 'Before Remove'
      });
      assert.equal(result.intercepted, true);

      // Remove interceptor
      remove();

      // Without interceptor
      result = await api.resources.items.insert({
        name: 'After Remove'
      });
      assert.equal(result.intercepted, undefined);
    });

    it('should enable/disable interceptors', async () => {
      let callCount = 0;

      const interceptor = {
        name: 'toggleable',
        async process(context) {
          callCount++;
          return context;
        }
      };

      api.interceptors.request.use(interceptor);
      const id = api.interceptors.request.list()[0].id;

      // Enabled by default
      await api.resources.items.insert({ name: 'Test 1' });
      assert.equal(callCount, 1);

      // Disable
      api.interceptors.request.disable(id);
      await api.resources.items.insert({ name: 'Test 2' });
      assert.equal(callCount, 1); // Not called

      // Re-enable
      api.interceptors.request.enable(id);
      await api.resources.items.insert({ name: 'Test 3' });
      assert.equal(callCount, 2);
    });

    it('should list interceptors', () => {
      api.interceptors.request.use({ name: 'first' }, { priority: 10 });
      api.interceptors.request.use({ name: 'second' }, { priority: 20 });
      api.interceptors.response.use({ name: 'response-1' });

      const requestList = api.interceptors.request.list();
      const responseList = api.interceptors.response.list();

      assert.equal(requestList.length, 2);
      assert.equal(requestList[0].name, 'first');
      assert.equal(requestList[0].priority, 10);
      assert.equal(requestList[1].name, 'second');
      assert.equal(requestList[1].priority, 20);

      assert.equal(responseList.length, 1);
      assert.equal(responseList[0].name, 'response-1');
    });

    it('should enforce max interceptor limit', async () => {
      const api2 = new Api();
      api2.use(MemoryPlugin);
      api2.use(InterceptorsPlugin, { maxInterceptors: 2 });
      await api2.start();

      api2.interceptors.request.use({ name: 'first' });
      api2.interceptors.request.use({ name: 'second' });

      assert.throws(
        () => api2.interceptors.request.use({ name: 'third' }),
        /Maximum number of request interceptors/
      );

      await api2.stop();
    });

    it('should get interceptor stats', () => {
      api.interceptors.request.use({ name: 'req1' });
      api.interceptors.request.use({ name: 'req2' });
      api.interceptors.response.use({ name: 'res1' });
      api.interceptors.error.use({ name: 'err1' });

      const stats = api.interceptors.stats();
      
      assert.equal(stats.request, 2);
      assert.equal(stats.response, 1);
      assert.equal(stats.error, 1);
      assert.equal(stats.timing, 0);
    });
  });

  describe('Common Interceptor Patterns', () => {
    it('should use auth interceptor', async () => {
      const users = {
        'token-123': { id: 'user-1', name: 'John' }
      };

      api.interceptors.request.use(
        api.interceptors.common.auth({
          required: true,
          validate: async (token) => {
            const user = users[token.replace('Bearer ', '')];
            if (!user) throw new Error('Invalid token');
            return user;
          }
        })
      );

      // Without auth
      await assert.rejects(
        () => api.resources.items.insert({ name: 'No Auth' }),
        /Authentication required/
      );

      // With invalid auth
      let error;
      api.hook('beforeHTTP', (context) => {
        context.request.headers = { authorization: 'Bearer invalid' };
      });

      try {
        await api.resources.items.insert({ name: 'Bad Auth' });
      } catch (e) {
        error = e;
      }

      assert.ok(error);

      // With valid auth
      let capturedUser;
      api.hook('beforeInsert', (context) => {
        capturedUser = context.user;
      });

      api.hook('beforeHTTP', (context) => {
        context.request.headers = { authorization: 'Bearer token-123' };
      });

      await api.resources.items.insert({ name: 'Good Auth' });
      assert.equal(capturedUser.id, 'user-1');
    });

    it('should use rate limit interceptor', async () => {
      api.interceptors.request.use(
        api.interceptors.common.rateLimit({
          max: 2,
          window: 1000
        })
      );

      // Should allow first 2 requests
      await api.resources.items.insert({ name: 'Request 1' });
      await api.resources.items.insert({ name: 'Request 2' });

      // Third should fail
      try {
        await api.resources.items.insert({ name: 'Request 3' });
        assert.fail('Should have been rate limited');
      } catch (error) {
        assert.equal(error.status, 429);
        assert.ok(error.retryAfter > 0);
      }

      // Wait for window to pass
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should work again
      await api.resources.items.insert({ name: 'Request 4' });
    });

    it('should use transform interceptor', async () => {
      api.interceptors.request.use(
        api.interceptors.common.transform({
          request: (data) => ({
            ...data,
            name: data.name?.toUpperCase()
          }),
          response: (data) => ({
            ...data,
            name: data.name?.toLowerCase()
          })
        })
      );

      const result = await api.resources.items.insert({
        name: 'Transform Test'
      });

      // Stored as uppercase, returned as lowercase
      assert.equal(result.data.name, 'transform test');

      // Check actual stored value
      const stored = await api.resources.items.get(result.data.id);
      assert.equal(stored.name, 'transform test'); // Response transform applied
    });

    it('should use validation interceptor', async () => {
      api.interceptors.request.use(
        api.interceptors.common.validate({
          name: {
            required: true,
            type: 'string',
            min: 3,
            max: 50
          },
          value: {
            type: 'number',
            min: 0,
            max: 1000
          }
        })
      );

      // Valid data
      await api.resources.items.insert({
        name: 'Valid Item',
        value: 500
      });

      // Invalid data - name too short
      try {
        await api.resources.items.insert({
          name: 'Hi',
          value: 500
        });
        assert.fail('Should have failed validation');
      } catch (error) {
        assert.equal(error.status, 400);
        assert.ok(error.errors.some(e => e.includes('name')));
      }

      // Invalid data - value out of range
      try {
        await api.resources.items.insert({
          name: 'Out of Range',
          value: 2000
        });
        assert.fail('Should have failed validation');
      } catch (error) {
        assert.ok(error.errors.some(e => e.includes('value')));
      }
    });

    it('should use logger interceptor', async () => {
      const logs = [];
      const originalInfo = console.info;
      console.info = (...args) => logs.push(args);

      api.interceptors.request.use(
        api.interceptors.common.logger({ includeData: true })
      );
      api.interceptors.response.use(
        api.interceptors.common.logger({ includeData: true })
      );

      await api.resources.items.insert({
        name: 'Logged Item'
      });

      console.info = originalInfo;

      assert.ok(logs.length >= 2);
      
      // Check request log
      const requestLog = logs.find(l => l[0] === '[REQUEST]');
      assert.ok(requestLog);
      const reqData = JSON.parse(requestLog[1]);
      assert.equal(reqData.type, 'request');
      assert.equal(reqData.resource, 'items');
      assert.equal(reqData.data.name, 'Logged Item');

      // Check response log
      const responseLog = logs.find(l => l[0] === '[RESPONSE]');
      assert.ok(responseLog);
      const resData = JSON.parse(responseLog[1]);
      assert.equal(resData.type, 'response');
      assert.ok(resData.data.data.id);
    });
  });

  describe('HTTP Integration', () => {
    it('should work with HTTP requests', async () => {
      api.interceptors.request.use({
        name: 'http-modifier',
        async process(context) {
          if (context.headers?.['x-test-header'] === 'modify') {
            context.data.modified = true;
          }
          return context;
        }
      });

      api.interceptors.response.use({
        name: 'http-response',
        async process(context) {
          context.headers['x-processed'] = 'true';
          return context;
        }
      });

      const res = await request(app)
        .post('/api/items')
        .set('x-test-header', 'modify')
        .send({ name: 'HTTP Test' })
        .expect(201);

      assert.equal(res.body.modified, true);
      assert.equal(res.headers['x-processed'], 'true');
    });
  });

  describe('Error Handling', () => {
    it('should handle interceptor with onError handler', async () => {
      let errorHandled = false;

      api.interceptors.request.use({
        name: 'error-handler',
        async process(context) {
          if (context.data?.fail) {
            throw new Error('Intentional failure');
          }
          return context;
        },
        async onError(error, context) {
          errorHandled = true;
          // Modify data and continue
          context.data.fail = false;
          context.data.recovered = true;
          return context;
        }
      });

      const result = await api.resources.items.insert({
        name: 'Error Recovery',
        fail: true
      });

      assert.ok(errorHandled);
      assert.equal(result.data.fail, false);
      assert.equal(result.data.recovered, true);
    });
  });

  describe('Cache Interceptor Pattern', () => {
    it('should cache GET requests', async () => {
      let dbCalls = 0;

      api.hook('beforeGet', () => {
        dbCalls++;
      });

      // Add cache interceptor
      const cacheInterceptor = api.interceptors.common.cache({ ttl: 1000 });
      api.interceptors.request.use(cacheInterceptor);
      api.interceptors.response.use(cacheInterceptor);

      // Create item
      const item = await api.resources.items.insert({
        name: 'Cacheable Item'
      });

      // First GET - hits database
      const result1 = await api.resources.items.get(item.data.id);
      assert.equal(dbCalls, 1);

      // Second GET - should be cached
      const result2 = await api.resources.items.get(item.data.id);
      assert.equal(dbCalls, 1); // No additional DB call

      assert.deepEqual(result1, result2);
    });
  });
});