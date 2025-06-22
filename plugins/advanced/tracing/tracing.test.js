import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api } from '../../../lib/api.js';
import { Schema } from '../../../lib/schema.js';
import { MemoryPlugin } from '../../memory.js';
import { ValidationPlugin } from '../../validation.js';
import { TracingPlugin } from './index.js';
import { HTTPPlugin } from '../../http.js';
import express from 'express';
import request from 'supertest';

describe('TracingPlugin', () => {
  let api, app, server;

  beforeEach(async () => {
    api = new Api();
    app = express();
    
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    api.use(TracingPlugin, {
      serviceName: 'test-service',
      samplingRate: 1.0, // Sample all spans for testing
      exporters: ['console']
    });
    
    // Install tracing middleware before HTTPPlugin
    if (api.httpTracingMiddleware) {
      app.use(api.httpTracingMiddleware);
    }
    
    // Set up tracing endpoints directly on app
    app.get('/api/tracing/export', (req, res) => {
      const traces = api.tracer.export();
      res.json(traces);
    });

    app.get('/api/tracing/stats', (req, res) => {
      const stats = api.tracer.getStats();
      res.json(stats);
    });
    
    api.use(HTTPPlugin, { app });

    api.addResource('traces', new Schema({
      name: { type: 'string', required: true },
      value: { type: 'number' }
    }));

    server = app.listen(0);
  });

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Auto Instrumentation', () => {
    it('should create spans for hooks', async () => {
      let spans = [];
      
      // Capture spans
      api.hook('afterInsert', () => {
        const exported = api.tracer.export();
        spans = spans.concat(exported);
      });

      await api.resources.traces.insert({
        name: 'Test Trace',
        value: 100
      });

      // Should have spans for various hooks
      const hookSpans = spans.filter(s => s.name.includes(':'));
      assert.ok(hookSpans.length > 0);
      
      // Check for specific hooks
      const insertSpan = spans.find(s => s.name.includes('beforeInsert'));
      assert.ok(insertSpan);
      assert.equal(insertSpan.attributes['resource.type'], 'traces');
      assert.equal(insertSpan.attributes['operation.type'], 'insert');
    });

    it('should record exceptions in spans', async () => {
      api.hook('beforeInsert', () => {
        throw new Error('Test error');
      });

      try {
        await api.resources.traces.insert({
          name: 'Error Test'
        });
      } catch (e) {
        // Expected - error should be thrown
        assert.equal(e.message, 'Test error');
      }

      // Get the spans that were created
      const spans = api.tracer.export();
      const errorSpan = spans.find(s => s.events.some(e => e.name === 'exception'));
      
      assert.ok(errorSpan);
      assert.equal(errorSpan.status.code, 'ERROR');
      
      const exceptionEvent = errorSpan.events.find(e => e.name === 'exception');
      assert.equal(exceptionEvent.attributes['exception.message'], 'Test error');
    });
  });

  describe('HTTP Tracing', () => {
    it('should trace HTTP requests', async () => {
      const res = await request(app)
        .post('/api/traces')
        .send({ name: 'HTTP Test', value: 200 })
        .expect(201);

      // Get the spans that were created
      const spans = api.tracer.export();
      const httpSpan = spans.find(s => s.name === 'http.request');
      
      assert.ok(httpSpan);
      assert.equal(httpSpan.attributes['http.method'], 'POST');
      assert.equal(httpSpan.attributes['http.target'], '/api/traces');
      assert.equal(httpSpan.attributes['http.status_code'], 201);
      assert.equal(httpSpan.status.code, 'OK');
    });

    it('should inject trace headers in response', async () => {
      const res = await request(app)
        .get('/api/traces')
        .expect(200);

      assert.ok(res.headers.traceparent);
      assert.match(res.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    });

    it('should extract parent context from request headers', async () => {
      const parentTraceId = 'abcdef0123456789abcdef0123456789';
      const parentSpanId = '0123456789abcdef';

      await request(app)
        .get('/api/traces')
        .set('traceparent', `00-${parentTraceId}-${parentSpanId}-01`)
        .expect(200);

      // The span should have the parent trace ID
      const spans = api.tracer.export();
      const httpSpan = spans.find(s => s.name === 'http.request');
      assert.equal(httpSpan.traceId, parentTraceId);
      assert.equal(httpSpan.parentSpanId, parentSpanId);
    });

    it('should trace failed HTTP requests', async () => {
      await request(app)
        .post('/api/traces')
        .send({ value: 123 }) // Missing required 'name' field
        .expect(422); // 422 is the correct status for validation errors

      const spans = api.tracer.export();
      const errorSpan = spans.find(s => s.name === 'http.request' && s.status?.code === 'ERROR');
      
      assert.ok(errorSpan);
      assert.equal(errorSpan.attributes['http.status_code'], 422);
      assert.equal(errorSpan.status.code, 'ERROR');
    });
  });

  describe('Database Tracing', () => {
    it('should trace query operations', async () => {
      // Insert items one by one
      await api.resources.traces.insert({ name: 'Item 1', value: 1 });
      await api.resources.traces.insert({ name: 'Item 2', value: 2 });

      // Clear previous spans
      api.tracer.export();

      await api.resources.traces.query({ sort: 'name' });

      const spans = api.tracer.export();
      const querySpan = spans.find(s => s.name === 'db.query');
      
      // Debug: log all span names if query span not found
      if (!querySpan) {
        console.log('Available spans:', spans.map(s => s.name));
      }
      
      assert.ok(querySpan, 'Query span should exist');
      assert.equal(querySpan.attributes['db.operation'], 'query');
      assert.equal(querySpan.attributes['db.table'], 'traces');
      // The rows_affected might be in the result, not the span
      assert.ok(querySpan.attributes['db.rows_affected'] >= 0);
    });

    it('should trace insert operations', async () => {
      await api.resources.traces.insert({
        name: 'Insert Test',
        value: 300
      });

      const spans = api.tracer.export();
      const insertSpan = spans.find(s => s.name === 'db.insert');
      
      assert.ok(insertSpan);
      assert.equal(insertSpan.attributes['db.operation'], 'insert');
      assert.equal(insertSpan.attributes['db.table'], 'traces');
      assert.equal(insertSpan.attributes['db.rows_affected'], 1);
    });

    it('should trace update operations', async () => {
      const result = await api.resources.traces.insert({
        name: 'Update Test',
        value: 400
      });

      api.tracer.export(); // Clear spans

      await api.resources.traces.update(result.data.id, { value: 500 });

      const spans = api.tracer.export();
      const updateSpan = spans.find(s => s.name === 'db.update');
      
      assert.ok(updateSpan);
      assert.equal(updateSpan.attributes['db.operation'], 'update');
      assert.equal(updateSpan.attributes['db.rows_affected'], 1);
    });

    it('should trace delete operations', async () => {
      const result = await api.resources.traces.insert({
        name: 'Delete Test',
        value: 600
      });

      api.tracer.export(); // Clear spans

      await api.resources.traces.delete(result.data.id);

      const spans = api.tracer.export();
      const deleteSpan = spans.find(s => s.name === 'db.delete');
      
      assert.ok(deleteSpan);
      assert.equal(deleteSpan.attributes['db.operation'], 'delete');
      assert.equal(deleteSpan.attributes['db.rows_affected'], 1);
    });

    it('should trace get operations', async () => {
      const result = await api.resources.traces.insert({
        name: 'Get Test',
        value: 700
      });

      api.tracer.export(); // Clear spans

      await api.resources.traces.get(result.data.id);

      const spans = api.tracer.export();
      const getSpan = spans.find(s => s.name === 'db.get');
      
      assert.ok(getSpan);
      assert.equal(getSpan.attributes['db.operation'], 'get');
      assert.equal(getSpan.attributes['db.table'], 'traces');
    });

    it('should trace database errors', async () => {
      api.hook('beforeQuery', () => {
        throw new Error('Database connection failed');
      });

      try {
        await api.resources.traces.query();
      } catch (e) {
        // Expected
      }

      const spans = api.tracer.export();
      // The error will be recorded in the hook span, not the db.query span
      const errorSpan = spans.find(s => s.status?.code === 'ERROR' && s.events.some(e => 
        e.name === 'exception' && 
        e.attributes['exception.message'] === 'Database connection failed'
      ));
      
      assert.ok(errorSpan, 'Error span should exist');
      assert.equal(errorSpan.status.code, 'ERROR');
      
      // Verify the exception was recorded
      const exceptionEvent = errorSpan.events.find(e => e.name === 'exception');
      assert.ok(exceptionEvent, 'Exception event should exist');
      assert.equal(exceptionEvent.attributes['exception.message'], 'Database connection failed');
    });
  });

  describe('Custom Spans', () => {
    it('should create custom spans with api.span', async () => {
      let customSpan;

      const result = await api.span('custom.operation', (span) => {
        span.setAttribute('custom.attribute', 'value');
        span.addEvent('custom.event', { detail: 'something happened' });
        customSpan = span;
        return 'result';
      });

      assert.equal(result, 'result');
      assert.ok(customSpan);
      assert.equal(customSpan.attributes['custom.attribute'], 'value');
      assert.ok(customSpan.events.some(e => e.name === 'custom.event'));
    });

    it('should handle async custom spans', async () => {
      const result = await api.span('async.operation', async (span) => {
        span.setAttribute('async', true);
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async result';
      });

      assert.equal(result, 'async result');

      const spans = api.tracer.export();
      const asyncSpan = spans.find(s => s.name === 'async.operation');
      assert.ok(asyncSpan);
      assert.ok(asyncSpan.duration >= 10);
    });

    it('should handle errors in custom spans', async () => {
      await assert.rejects(
        async () => api.span('error.operation', () => {
          throw new Error('Custom span error');
        }),
        /Custom span error/
      );

      const spans = api.tracer.export();
      const errorSpan = spans.find(s => s.name === 'error.operation');
      assert.ok(errorSpan);
      assert.equal(errorSpan.status.code, 'ERROR');
      const exceptionEvent = errorSpan.events.find(e => e.name === 'exception');
      assert.ok(exceptionEvent);
      assert.equal(exceptionEvent.attributes['exception.message'], 'Custom span error');
    });

    it('should support manual span management', async () => {
      const span = api.startSpan('manual.span', {
        attributes: { manual: true }
      });

      span.setAttribute('step', 1);
      await new Promise(resolve => setTimeout(resolve, 5));
      
      span.setAttribute('step', 2);
      span.addEvent('checkpoint', { progress: 50 });
      
      span.setStatus({ code: 'OK' });
      span.end();

      const spans = api.tracer.export();
      const manualSpan = spans.find(s => s.name === 'manual.span');
      assert.ok(manualSpan);
      assert.equal(manualSpan.attributes.manual, true);
      assert.equal(manualSpan.attributes.step, 2);
      assert.ok(manualSpan.duration >= 5);
    });
  });

  describe('Context Propagation', () => {
    it('should propagate baggage items', async () => {
      // Test baggage within a single span
      await api.span('baggage.test', (span) => {
        // Set baggage on the span
        span.setBaggage('user.id', '12345');
        span.setBaggage('session.id', 'abc-def');
        
        // Verify baggage is stored
        assert.equal(span.getBaggage('user.id'), '12345');
        assert.equal(span.getBaggage('session.id'), 'abc-def');
        
        // Verify baggage is included in context
        const context = span.context();
        assert.equal(context.baggage['user.id'], '12345');
        assert.equal(context.baggage['session.id'], 'abc-def');
      });
    });

    it('should support sampling decisions', async () => {
      // Create API with low sampling rate
      const sampledApi = new Api();
      sampledApi.use(MemoryPlugin);
      sampledApi.use(TracingPlugin, {
        samplingRate: 0.5
      });

      sampledApi.addResource('samples', new Schema({
        name: { type: 'string' }
      }));

      // No need to start API - it's ready to use

      // Create many spans
      for (let i = 0; i < 100; i++) {
        await sampledApi.resources.samples.insert({
          name: `Sample ${i}`
        });
      }

      const stats = sampledApi.tracer.getStats();
      
      // Should have created 100+ spans (including hooks)
      assert.ok(stats.spansCreated > 100);
      
      // But only sampled approximately 50%
      const samplingRate = stats.spansSampled / stats.spansCreated;
      assert.ok(samplingRate > 0.3 && samplingRate < 0.7);

      // Cleanup
      if (sampledApi.tracer) {
        await sampledApi.tracer.shutdown();
      }
    });

    it('should set sampling priority', async () => {
      // Test sampling priority within a custom span
      const span = api.startSpan('priority.test');
      
      // Set sampling priority
      span.setSamplingPriority(1); // Force sampling
      
      // Verify it was set
      assert.equal(span.samplingPriority, 1);
      
      span.end();
      
      // Export and verify
      const spans = api.tracer.export();
      const prioritySpan = spans.find(s => s.name === 'priority.test');
      assert.equal(prioritySpan.samplingPriority, 1);
    });
  });

  describe('Metrics Integration', () => {
    it('should record HTTP metrics', async () => {
      // Make several requests
      await request(app).get('/api/traces').expect(200);
      await request(app).post('/api/traces').send({ value: 123 }).expect(422); // Missing required name
      await request(app).post('/api/traces').send({ name: 'Test', value: 1 }).expect(201);

      const stats = api.tracer.getStats();
      const httpMetrics = stats.metrics.filter(m => m.name === 'http.request.duration');
      
      assert.ok(httpMetrics.length > 0);
      
      // Check we have metrics for different status codes
      const statusCodes = httpMetrics.map(m => m.labels.status);
      assert.ok(statusCodes.includes(200));
      assert.ok(statusCodes.includes(201));
      assert.ok(statusCodes.includes(422));
    });

    it('should export trace data via endpoint', async () => {
      await api.resources.traces.insert({
        name: 'Export Test'
      });

      const res = await request(app)
        .get('/api/tracing/export')
        .expect(200);

      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length > 0);
      
      const span = res.body[0];
      assert.ok(span.traceId);
      assert.ok(span.spanId);
      assert.ok(span.name);
      assert.ok(span.startTime);
    });

    it('should provide tracing statistics', async () => {
      await api.resources.traces.insert({
        name: 'Stats Test'
      });

      const res = await request(app)
        .get('/api/tracing/stats')
        .expect(200);

      assert.ok(res.body.spansCreated > 0);
      assert.ok(res.body.spansSampled > 0);
      assert.ok(res.body.activeSpans >= 0);
      assert.ok(Array.isArray(res.body.metrics));
    });
  });

  describe('Shutdown', () => {
    it('should export remaining spans on shutdown', async () => {
      let exportedBeforeShutdown = 0;
      let exportedAfterShutdown = 0;

      // Create some spans
      await api.resources.traces.insert({ name: 'Shutdown Test 1' });
      await api.resources.traces.insert({ name: 'Shutdown Test 2' });

      exportedBeforeShutdown = api.tracer.stats.spansExported;

      // Manually trigger span export since api.stop() doesn't exist
      await api.tracer.shutdown();

      // Spans should have been exported
      exportedAfterShutdown = api.tracer.stats.spansExported;
      assert.ok(exportedAfterShutdown > exportedBeforeShutdown);
    });
  });

  describe('Edge Cases', () => {
    it('should handle spans without parent context', async () => {
      const span = api.startSpan('orphan.span');
      span.end();

      const spans = api.tracer.export();
      const orphanSpan = spans.find(s => s.name === 'orphan.span');
      
      assert.ok(orphanSpan);
      assert.ok(orphanSpan.traceId);
      assert.equal(orphanSpan.parentSpanId, undefined);
    });

    it('should handle concurrent spans', async () => {
      const results = await Promise.all([
        api.span('concurrent.1', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 1;
        }),
        api.span('concurrent.2', async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return 2;
        }),
        api.span('concurrent.3', () => 3)
      ]);

      assert.deepEqual(results, [1, 2, 3]);

      const spans = api.tracer.export();
      const concurrentSpans = spans.filter(s => s.name.startsWith('concurrent.'));
      assert.equal(concurrentSpans.length, 3);
    });

    it('should handle very long attribute values', async () => {
      const longValue = 'x'.repeat(10000);
      
      const span = api.startSpan('long.span');
      span.setAttribute('long.attribute', longValue);
      span.end();

      const spans = api.tracer.export();
      const longSpan = spans.find(s => s.name === 'long.span');
      assert.equal(longSpan.attributes['long.attribute'].length, 10000);
    });
  });
});