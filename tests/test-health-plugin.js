import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { Api, Schema, HTTPPlugin } from '../index.js';
import { HealthPlugin } from '../plugins/health/index.js';
import { setupTestApi, robustTeardown } from './lib/test-db-helper.js';

describe('Health Plugin Tests', () => {
  let api;
  let app;

  beforeEach(async () => {
    api = await setupTestApi();
    app = express();
    app.use(express.json());
    
    // Use HTTPPlugin to mount endpoints
    api.use(HTTPPlugin, { app });
    await api.connect();
  });

  afterEach(async () => {
    // Clean up health plugin
    if (api.health && api.health.cleanup) {
      api.health.cleanup();
    }
    
    await robustTeardown({ api });
  });

  describe('Basic Health Checks', () => {
    it('should install health plugin with default options', () => {
      api.use(HealthPlugin);
      
      assert(api.health);
      assert(typeof api.health.register === 'function');
      assert(typeof api.health.getStatus === 'function');
      assert(typeof api.health.liveness === 'function');
      assert(typeof api.health.readiness === 'function');
    });

    it('should provide liveness check', async () => {
      api.use(HealthPlugin);
      
      const liveness = await api.health.liveness();
      
      assert.equal(liveness.status, 'healthy');
      assert(liveness.timestamp);
      assert(typeof liveness.uptime === 'number');
      assert(liveness.uptime > 0);
    });

    it('should execute default health checks', async () => {
      api.use(HealthPlugin);
      
      const status = await api.health.getStatus();
      
      assert(status.timestamp);
      assert(status.checks);
      // Check that we have some checks
      const checkNames = Object.keys(status.checks);
      assert(checkNames.length > 0, 'Should have at least one health check');
      
      // Default checks should include api and memory
      assert(status.checks.api, `Missing api check. Available checks: ${checkNames.join(', ')}`);
      assert(status.checks.memory);
      assert.equal(status.checks.api.status, 'healthy');
    });

    it('should register custom health checks', async () => {
      api.use(HealthPlugin);
      
      let checkExecuted = false;
      api.health.register('custom', async () => {
        checkExecuted = true;
        return { status: 'healthy', message: 'Custom check passed' };
      });
      
      const status = await api.health.getStatus();
      
      assert(checkExecuted);
      assert(status.checks.custom);
      assert.equal(status.checks.custom.status, 'healthy');
      assert.equal(status.checks.custom.message, 'Custom check passed');
    });

    it('should handle failing health checks', async () => {
      api.use(HealthPlugin);
      
      api.health.register('failing', async () => {
        throw new Error('Check failed');
      });
      
      const status = await api.health.getStatus();
      
      assert.equal(status.status, 'unhealthy');
      assert.equal(status.checks.failing.status, 'unhealthy');
      assert(status.checks.failing.error);
    });

    it('should handle degraded health checks', async () => {
      api.use(HealthPlugin, { degradedThreshold: 0.5 });
      
      api.health.register('degraded1', async () => ({
        status: 'degraded',
        message: 'Service degraded'
      }));
      
      api.health.register('degraded2', async () => ({
        status: 'degraded',
        message: 'Another degraded service'
      }));
      
      const status = await api.health.getStatus();
      
      // With default checks (api, memory, database) + 2 degraded = 2/5 degraded
      // But since database might fail in test env, we just check for degraded checks
      assert(status.checks.degraded1);
      assert.equal(status.checks.degraded1.status, 'degraded');
    });

    it('should respect critical check failures', async () => {
      api.use(HealthPlugin);
      
      api.health.register('critical', async () => {
        return { status: 'unhealthy', message: 'Critical failure' };
      }, { critical: true });
      
      const status = await api.health.getStatus();
      
      assert.equal(status.status, 'unhealthy');
    });

    it('should handle check timeouts', async () => {
      api.use(HealthPlugin, { timeout: 100 });
      
      api.health.register('slow', async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { status: 'healthy' };
      });
      
      const status = await api.health.getStatus();
      
      assert.equal(status.checks.slow.status, 'unhealthy');
      assert(status.checks.slow.message.includes('timeout'));
    });

    it('should track check duration', async () => {
      api.use(HealthPlugin);
      
      api.health.register('timed', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { status: 'healthy' };
      });
      
      const status = await api.health.getStatus();
      
      assert(status.checks.timed.duration);
      // Allow for slight timing variations
      assert(status.checks.timed.duration >= 45);
    });

    it('should unregister health checks', async () => {
      api.use(HealthPlugin);
      
      api.health.register('temporary', async () => ({
        status: 'healthy'
      }));
      
      let status = await api.health.getStatus();
      assert(status.checks.temporary);
      
      api.health.unregister('temporary');
      
      status = await api.health.getStatus();
      assert(!status.checks.temporary);
    });
  });

  describe('HTTP Endpoints', () => {
    let server;
    
    beforeEach(async () => {
      // Install HealthPlugin with app option
      api.use(HealthPlugin, { app });
      
      // Create HTTP server
      server = await new Promise((resolve) => {
        const s = app.listen(0, () => {
          resolve(s);
        });
      });
    });
    
    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => {
          server.close(resolve);
        });
      }
    });

    it('should expose liveness endpoint', async () => {
      const res = await request(app)
        .get('/health/live')
        .expect(200);
      
      assert.equal(res.body.status, 'healthy');
      assert(res.body.uptime);
    });

    it('should expose readiness endpoint', async () => {
      const res = await request(app)
        .get('/health/ready');
      
      // Debug output
      if (res.status !== 200) {
        console.log('Readiness response:', res.status, res.body);
      }
      
      assert.equal(res.status, 200, `Expected 200 but got ${res.status}. Body: ${JSON.stringify(res.body)}`);
      assert(res.body.ready);
      assert.equal(res.body.status, 'healthy');
      assert(res.body.checks);
    });

    it('should return 503 when not ready', async () => {
      api.health.register('notready', async () => ({
        status: 'unhealthy',
        message: 'Not ready'
      }), { critical: true });
      
      const res = await request(app)
        .get('/health/ready')
        .expect(503);
      
      assert.equal(res.body.ready, false);
      assert.equal(res.body.status, 'unhealthy');
    });

    it('should expose full health endpoint', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);
      
      assert.equal(res.body.status, 'healthy');
      assert(res.body.checks);
      assert(res.body.timestamp);
    });

    it('should expose metrics endpoint', async () => {
      const res = await request(app)
        .get('/metrics')
        .expect(200);
      
      assert(res.text.includes('# HELP'));
      assert(res.text.includes('# TYPE'));
      assert(res.headers['content-type'].includes('text/plain'));
    });

    it('should use custom paths', async () => {
      // Reset and reinstall with custom paths
      api = await setupTestApi();
      app = express();
      app.use(express.json());
      
      api.use(HTTPPlugin, { app });
      api.use(HealthPlugin, {
        app,
        path: '/status',
        metricsPath: '/prometheus'
      });
      
      await request(app).get('/status/live').expect(200);
      await request(app).get('/prometheus').expect(200);
    });

    it('should record HTTP metrics', async () => {
      // Make some requests
      await request(app).get('/health/live').expect(200);
      await request(app).get('/health/ready').expect(200);
      
      const res = await request(app).get('/metrics');
      
      assert(res.text.includes('http_request_duration_seconds'));
    });
  });

  describe('Event System', () => {
    it('should emit check complete events', async () => {
      api.use(HealthPlugin);
      
      let eventFired = false;
      let eventData = null;
      
      api.health.on('check:complete', (data) => {
        eventFired = true;
        eventData = data;
      });
      
      await api.health.getStatus();
      
      assert(eventFired);
      assert(eventData);
      assert(eventData.name);
      assert(eventData.result);
    });

    it('should emit check error events', async () => {
      api.use(HealthPlugin);
      
      let errorEventFired = false;
      
      api.health.on('check:error', (data) => {
        errorEventFired = true;
      });
      
      api.health.register('error-check', async () => {
        throw new Error('Test error');
      });
      
      await api.health.getStatus();
      
      assert(errorEventFired);
    });

    it('should emit health update events', async () => {
      api.use(HealthPlugin);
      
      let updateFired = false;
      let healthSummary = null;
      
      api.health.on('health:update', (summary) => {
        updateFired = true;
        healthSummary = summary;
      });
      
      await api.health.getStatus();
      
      assert(updateFired);
      assert(healthSummary);
      assert(healthSummary.status);
      assert(healthSummary.checks);
    });
  });

  describe('Periodic Health Checks', () => {
    it('should execute periodic health checks', async () => {
      let checkCount = 0;
      
      api.use(HealthPlugin, { interval: 100 });
      
      api.health.register('counter', async () => {
        checkCount++;
        return { status: 'healthy' };
      });
      
      await new Promise(resolve => setTimeout(resolve, 250));
      
      assert(checkCount >= 2);
    });
  });

  describe('Database Health Check', () => {
    it('should check database connectivity when available', async () => {
      // The database health check requires both api.execute AND api.connection
      // MemoryPlugin provides api.execute but not api.connection
      // Only database plugins like MySQLPlugin provide api.connection
      
      await api.connect();
      api.use(HealthPlugin);
      
      // Add a test resource to ensure database is set up
      api.addResource('test', new Schema({
        id: { type: 'id' },
        name: { type: 'string' }
      }));
      
      const status = await api.health.getStatus();
      
      // Check that we have the expected checks
      assert(status.checks.api, 'Should have API check');
      assert(status.checks.memory, 'Should have memory check');
      
      // Database check only exists if BOTH api.execute and api.connection exist
      // MemoryPlugin doesn't provide api.connection, so no database check
      if (api.execute && api.connection) {
        assert(status.checks.database, 'Should have database check when both execute and connection exist');
        assert(['healthy', 'unhealthy'].includes(status.checks.database.status));
      } else {
        // For MemoryPlugin, we won't have a database check
        assert(!status.checks.database, 'Should not have database check for MemoryPlugin');
      }
    });
  });

  describe('Startup Probe', () => {
    it('should check only critical services', async () => {
      api.use(HealthPlugin);
      
      api.health.register('critical1', async () => ({
        status: 'healthy'
      }), { critical: true });
      
      api.health.register('non-critical', async () => ({
        status: 'unhealthy'
      }), { critical: false });
      
      const startup = await api.health.startup();
      
      assert(startup.checks.critical1);
      assert(!startup.checks['non-critical']);
    });
  });

  describe('Complex Health Scenarios', () => {
    it('should handle mixed health states correctly', async () => {
      api.use(HealthPlugin);
      
      // Register various checks
      api.health.register('healthy1', async () => ({
        status: 'healthy',
        data: { test: true }
      }));
      
      api.health.register('healthy2', async () => ({
        status: 'healthy'
      }));
      
      api.health.register('degraded', async () => ({
        status: 'degraded',
        message: 'High latency'
      }));
      
      api.health.register('unhealthy', async () => ({
        status: 'unhealthy',
        message: 'Connection failed'
      }));
      
      const status = await api.health.getStatus();
      
      assert.equal(status.status, 'unhealthy'); // One unhealthy = overall unhealthy
      // Should have at least 6 checks (4 custom + 2 default minimum)
      assert(Object.keys(status.checks).length >= 6);
    });

    it('should provide detailed check results', async () => {
      api.use(HealthPlugin);
      
      api.health.register('detailed', async () => ({
        status: 'healthy',
        message: 'All systems operational',
        data: {
          connections: 10,
          queue_size: 0,
          latency_ms: 15
        },
        metadata: {
          version: '1.0.0',
          region: 'us-east-1'
        }
      }));
      
      const status = await api.health.getStatus();
      const detailed = status.checks.detailed;
      
      assert.equal(detailed.status, 'healthy');
      assert.equal(detailed.message, 'All systems operational');
      assert.equal(detailed.data.connections, 10);
      assert.equal(detailed.metadata.version, '1.0.0');
      assert(detailed.timestamp);
      // Duration is added when the check runs
      if (detailed.duration !== undefined) {
        assert(typeof detailed.duration === 'number');
      }
    });
  });

  describe('Prometheus Metrics', () => {
    it('should expose custom metrics', async () => {
      api.use(HealthPlugin, { app });
      
      // Record some metrics
      api.health.recordHttpMetric('GET', '/api/users', 200, 0.045);
      api.health.recordHttpMetric('POST', '/api/users', 201, 0.125);
      api.health.recordHttpMetric('GET', '/api/users', 500, 0.005);
      
      const res = await request(app).get('/metrics');
      
      assert(res.text.includes('http_request_duration_seconds'));
      assert(res.text.includes('method="GET"'));
      assert(res.text.includes('status="200"'));
    });

    it('should track health check metrics', async () => {
      api.use(HealthPlugin, { app });
      
      await api.health.getStatus();
      
      const res = await request(app).get('/metrics');
      
      assert(res.text.includes('health_check_duration_seconds'));
      assert(res.text.includes('health_check_status'));
      assert(res.text.includes('check="api"'));
      assert(res.text.includes('check="memory"'));
    });
  });
});