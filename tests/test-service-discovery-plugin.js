import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Api, Schema } from '../index.js';
import { ServiceDiscoveryPlugin } from '../plugins/service-discovery/index.js';
import { LoadBalancer } from '../plugins/service-discovery/load-balancer.js';
import { CircuitBreaker } from '../plugins/service-discovery/circuit-breaker.js';
import { setupTestApi, robustTeardown } from './lib/test-db-helper.js';
import Redis from 'ioredis';

describe('Service Discovery Plugin Tests', () => {
  let api;
  let redis;

  beforeEach(async () => {
    api = await setupTestApi();
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      retryStrategy: () => null // Don't retry in tests
    });
    
    // Clear any existing service data
    const keys = await redis.keys('service:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    await api.connect();
  });

  afterEach(async () => {
    await redis.quit();
    await robustTeardown({ api });
  });

  describe('Basic Service Discovery', () => {
    it('should install plugin with default options', () => {
      api.use(ServiceDiscoveryPlugin, {
        redis,
        service: {
          name: 'test-api',
          port: 3000
        }
      });
      
      assert(api.discovery);
      assert(typeof api.discovery.register === 'function');
      assert(typeof api.discovery.discover === 'function');
      assert(typeof api.discovery.getService === 'function');
    });

    it('should register a service', async () => {
      api.use(ServiceDiscoveryPlugin, {
        redis,
        service: {
          name: 'user-service',
          port: 3001,
          tags: ['api', 'v1']
        }
      });

      const registered = await api.discovery.register();
      
      assert.equal(registered.name, 'user-service');
      assert.equal(registered.port, 3001);
      assert.deepEqual(registered.tags, ['api', 'v1']);
      assert(registered.id);
      assert(registered.address);
    });

    it('should discover services', async () => {
      api.use(ServiceDiscoveryPlugin, {
        redis,
        service: { name: 'api-service', port: 3000 }
      });

      // Register multiple instances
      await api.discovery.register({
        id: 'api-1',
        name: 'api-service',
        address: '10.0.0.1',
        port: 3001
      });

      await api.discovery.register({
        id: 'api-2',
        name: 'api-service',
        address: '10.0.0.2',
        port: 3002
      });

      const services = await api.discovery.discover('api-service');
      
      assert.equal(services.length, 2);
      assert(services.find(s => s.id === 'api-1'));
      assert(services.find(s => s.id === 'api-2'));
    });

    it('should filter services by tags', async () => {
      api.use(ServiceDiscoveryPlugin, { redis });

      await api.discovery.register({
        id: 'api-v1',
        name: 'api',
        port: 3001,
        tags: ['v1', 'stable']
      });

      await api.discovery.register({
        id: 'api-v2',
        name: 'api',
        port: 3002,
        tags: ['v2', 'beta']
      });

      const v1Services = await api.discovery.discover('api', {
        tags: ['v1']
      });

      assert.equal(v1Services.length, 1);
      assert.equal(v1Services[0].id, 'api-v1');
    });

    it('should filter services by metadata', async () => {
      api.use(ServiceDiscoveryPlugin, { redis });

      await api.discovery.register({
        id: 'api-us',
        name: 'api',
        port: 3001,
        metadata: { region: 'us-east', env: 'prod' }
      });

      await api.discovery.register({
        id: 'api-eu',
        name: 'api',
        port: 3002,
        metadata: { region: 'eu-west', env: 'prod' }
      });

      const usServices = await api.discovery.discover('api', {
        metadata: { region: 'us-east' }
      });

      assert.equal(usServices.length, 1);
      assert.equal(usServices[0].id, 'api-us');
    });

    it('should deregister services', async () => {
      api.use(ServiceDiscoveryPlugin, { redis });

      const service = await api.discovery.register({
        id: 'temp-service',
        name: 'temp',
        port: 3003
      });

      let services = await api.discovery.discover('temp');
      assert.equal(services.length, 1);

      await api.discovery.deregister('temp-service');

      services = await api.discovery.discover('temp');
      assert.equal(services.length, 0);
    });

    it('should handle service health', async () => {
      api.use(ServiceDiscoveryPlugin, { redis });

      const service = await api.discovery.register({
        name: 'health-test',
        port: 3004
      });

      const health = await api.discovery.checkHealth(service);
      assert.equal(health.status, 'healthy');

      await api.discovery.updateHealth(service.id, {
        status: 'unhealthy',
        reason: 'High CPU usage'
      });

      // Unhealthy services should be filtered by default
      const healthyOnly = await api.discovery.discover('health-test');
      assert.equal(healthyOnly.length, 0);

      // But can be included if requested
      const allServices = await api.discovery.discover('health-test', {
        healthyOnly: false
      });
      assert.equal(allServices.length, 1);
    });
  });

  describe('Load Balancing', () => {
    let loadBalancer;

    beforeEach(() => {
      loadBalancer = new LoadBalancer();
    });

    it('should use round-robin by default', () => {
      const services = [
        { id: '1', address: '10.0.0.1', port: 3000 },
        { id: '2', address: '10.0.0.2', port: 3000 },
        { id: '3', address: '10.0.0.3', port: 3000 }
      ];

      const selections = [];
      for (let i = 0; i < 6; i++) {
        selections.push(loadBalancer.next('test', services).id);
      }

      assert.deepEqual(selections, ['1', '2', '3', '1', '2', '3']);
    });

    it('should support random strategy', () => {
      loadBalancer.setStrategy('random');
      
      const services = [
        { id: '1', address: '10.0.0.1', port: 3000 },
        { id: '2', address: '10.0.0.2', port: 3000 }
      ];

      const selections = new Set();
      for (let i = 0; i < 20; i++) {
        selections.add(loadBalancer.next('test', services).id);
      }

      // Should have selected both services at least once
      assert(selections.has('1'));
      assert(selections.has('2'));
    });

    it('should support weighted strategy', () => {
      loadBalancer.setStrategy('weighted');
      
      const services = [
        { id: '1', address: '10.0.0.1', port: 3000, weight: 3 },
        { id: '2', address: '10.0.0.2', port: 3000, weight: 1 }
      ];

      const counts = { '1': 0, '2': 0 };
      for (let i = 0; i < 40; i++) {
        const selected = loadBalancer.next('test', services);
        counts[selected.id]++;
      }

      // Service 1 should be selected approximately 3x more often
      assert(counts['1'] > counts['2'] * 2);
    });

    it('should support least-connections strategy', () => {
      loadBalancer.setStrategy('least-connections');
      
      const services = [
        { id: '1', address: '10.0.0.1', port: 3000 },
        { id: '2', address: '10.0.0.2', port: 3000 }
      ];

      // Simulate connections
      loadBalancer.recordConnection(services[0], 5);
      loadBalancer.recordConnection(services[1], 2);

      const selected = loadBalancer.next('test', services);
      assert.equal(selected.id, '2'); // Should select the one with fewer connections
    });

    it('should support IP hash strategy', () => {
      loadBalancer.setStrategy('ip-hash');
      
      const services = [
        { id: '1', address: '10.0.0.1', port: 3000 },
        { id: '2', address: '10.0.0.2', port: 3000 },
        { id: '3', address: '10.0.0.3', port: 3000 }
      ];

      const context1 = { clientIp: '192.168.1.100' };
      const context2 = { clientIp: '192.168.1.200' };

      // Same IP should always get same service
      const selected1a = loadBalancer.next('test', services, context1);
      const selected1b = loadBalancer.next('test', services, context1);
      assert.equal(selected1a.id, selected1b.id);

      // Different IP might get different service
      const selected2 = loadBalancer.next('test', services, context2);
      // Note: This might occasionally be the same due to hash collision
    });

    it('should track statistics', () => {
      const services = [
        { id: '1', address: '10.0.0.1', port: 3000 }
      ];

      loadBalancer.next('test', services);
      loadBalancer.recordLatency(services[0], 50);
      loadBalancer.recordConnection(services[0], 1);

      const stats = loadBalancer.getStats();
      assert(stats.services['10.0.0.1:3000']);
      assert.equal(stats.services['10.0.0.1:3000'].selections, 1);
      assert.equal(stats.services['10.0.0.1:3000'].latency, 50);
    });
  });

  describe('Circuit Breaker', () => {
    let breaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        threshold: 3,
        timeout: 1000,
        errorThresholdPercent: 50,
        volumeThreshold: 5
      });
    });

    afterEach(() => {
      breaker.destroy();
    });

    it('should start in closed state', () => {
      assert.equal(breaker.getState(), 'CLOSED');
      assert(breaker.isAvailable());
    });

    it('should open after threshold failures', async () => {
      const failingFn = async () => {
        throw new Error('Service unavailable');
      };

      // Record enough volume
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => 'success');
        } catch (e) {
          // Ignore
        }
      }

      // Now fail enough to trip
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failingFn);
        } catch (e) {
          // Expected
        }
      }

      assert.equal(breaker.getState(), 'OPEN');
      assert(!breaker.isAvailable());
    });

    it('should transition to half-open after timeout', async () => {
      breaker.forceOpen();
      assert.equal(breaker.getState(), 'OPEN');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      assert(breaker.isAvailable());
      assert.equal(breaker.getState(), 'HALF_OPEN');
    });

    it('should close on success in half-open state', async () => {
      breaker.forceOpen();
      await new Promise(resolve => setTimeout(resolve, 1100));

      await breaker.execute(async () => 'success');
      assert.equal(breaker.getState(), 'CLOSED');
    });

    it('should reopen on failure in half-open state', async () => {
      breaker.forceOpen();
      await new Promise(resolve => setTimeout(resolve, 1100));

      try {
        await breaker.execute(async () => {
          throw new Error('Still failing');
        });
      } catch (e) {
        // Expected
      }

      assert.equal(breaker.getState(), 'OPEN');
    });

    it('should calculate error rate correctly', async () => {
      // Mix of successes and failures
      for (let i = 0; i < 10; i++) {
        try {
          if (i % 2 === 0) {
            await breaker.execute(async () => 'success');
          } else {
            await breaker.execute(async () => {
              throw new Error('Failure');
            });
          }
        } catch (e) {
          // Expected
        }
      }

      const stats = breaker.getStats();
      assert.equal(stats.totalRequests, 10);
      assert.equal(stats.totalSuccesses, 5);
      assert.equal(stats.totalFailures, 5);
      assert.equal(stats.errorRate, 50);
    });

    it('should emit events', async () => {
      let stateChangeEvent = null;
      breaker.on('stateChange', (event) => {
        stateChangeEvent = event;
      });

      breaker.forceOpen();
      
      assert(stateChangeEvent);
      assert.equal(stateChangeEvent.from, 'CLOSED');
      assert.equal(stateChangeEvent.to, 'OPEN');
    });
  });

  describe('Service Discovery with Load Balancing', () => {
    it('should get service using load balancer', async () => {
      api.use(ServiceDiscoveryPlugin, {
        redis,
        loadBalancing: { strategy: 'round-robin' }
      });

      // Register multiple instances
      await api.discovery.register({
        id: 'api-1',
        name: 'api',
        address: '10.0.0.1',
        port: 3001
      });

      await api.discovery.register({
        id: 'api-2',
        name: 'api',
        address: '10.0.0.2',
        port: 3002
      });

      const selections = [];
      for (let i = 0; i < 4; i++) {
        const service = await api.discovery.getService('api');
        selections.push(service.id);
      }

      // Should alternate between services
      assert.equal(selections[0], 'api-1');
      assert.equal(selections[1], 'api-2');
      assert.equal(selections[2], 'api-1');
      assert.equal(selections[3], 'api-2');
    });

    it('should handle circuit breaker integration', async () => {
      api.use(ServiceDiscoveryPlugin, {
        redis,
        circuitBreaker: {
          enabled: true,
          threshold: 2,
          timeout: 1000
        }
      });

      await api.discovery.register({
        id: 'failing-service',
        name: 'api',
        address: '10.0.0.1',
        port: 3001
      });

      // Simulate failures
      for (let i = 0; i < 3; i++) {
        try {
          await api.discovery.request('api', async (service) => {
            throw new Error('Service error');
          });
        } catch (e) {
          // Expected
        }
      }

      // Circuit should be open
      try {
        await api.discovery.request('api', async () => 'success');
        assert.fail('Should have thrown circuit breaker error');
      } catch (error) {
        assert(error.message.includes('Circuit breaker'));
      }
    });

    it('should failover to healthy services', async () => {
      api.use(ServiceDiscoveryPlugin, { redis });

      await api.discovery.register({
        id: 'healthy-1',
        name: 'api',
        address: '10.0.0.1',
        port: 3001
      });

      await api.discovery.register({
        id: 'healthy-2',
        name: 'api',
        address: '10.0.0.2',
        port: 3002
      });

      let attempts = 0;
      const result = await api.discovery.request('api', async (service) => {
        attempts++;
        if (attempts === 1) {
          throw new Error('First attempt failed');
        }
        return { service: service.id, attempts };
      }, { failover: true });

      assert.equal(attempts, 2);
      assert(result.service);
    });
  });

  describe('Cache Management', () => {
    it('should cache discovery results', async () => {
      api.use(ServiceDiscoveryPlugin, {
        redis,
        cache: { ttl: 1000 }
      });

      await api.discovery.register({
        id: 'cached-service',
        name: 'api',
        port: 3001
      });

      // First call hits the provider
      const results1 = await api.discovery.discover('api');
      assert.equal(results1.length, 1);

      // Remove the service
      await api.discovery.deregister('cached-service');

      // Second call should use cache
      const results2 = await api.discovery.discover('api');
      assert.equal(results2.length, 1); // Still returns cached result

      // Clear cache
      api.discovery.clearCache('api');

      // Now should return empty
      const results3 = await api.discovery.discover('api');
      assert.equal(results3.length, 0);
    });
  });

  describe('Events and Monitoring', () => {
    it('should emit discovery events', async () => {
      api.use(ServiceDiscoveryPlugin, { redis });

      const events = [];
      api.discovery.on('service:registered', (e) => events.push({ type: 'registered', data: e }));
      api.discovery.on('service:discovered', (e) => events.push({ type: 'discovered', data: e }));
      api.discovery.on('service:deregistered', (e) => events.push({ type: 'deregistered', data: e }));

      const service = await api.discovery.register({
        id: 'event-test',
        name: 'api',
        port: 3001
      });

      await api.discovery.discover('api');
      await api.discovery.deregister('event-test');

      assert.equal(events.length, 3);
      assert.equal(events[0].type, 'registered');
      assert.equal(events[1].type, 'discovered');
      assert.equal(events[2].type, 'deregistered');
    });

    it('should provide statistics', async () => {
      api.use(ServiceDiscoveryPlugin, {
        redis,
        service: { name: 'stats-test' }
      });

      await api.discovery.register();
      await api.discovery.discover('stats-test');

      const stats = api.discovery.getStats();
      
      assert(stats.provider);
      assert(stats.localService);
      assert(stats.cache);
      assert(stats.circuitBreakers);
      assert(stats.loadBalancer);
    });
  });

  describe('Custom Providers', () => {
    it('should support custom provider implementation', async () => {
      const customProvider = {
        services: new Map(),
        
        async register(service) {
          this.services.set(service.id, service);
          return service;
        },
        
        async deregister(serviceId) {
          this.services.delete(serviceId);
        },
        
        async discover(serviceName) {
          return Array.from(this.services.values())
            .filter(s => s.name === serviceName);
        }
      };

      api.use(ServiceDiscoveryPlugin, {
        provider: customProvider,
        service: { name: 'custom-test' }
      });

      await api.discovery.register({
        id: 'custom-1',
        name: 'custom-api',
        port: 3001
      });

      const services = await api.discovery.discover('custom-api');
      assert.equal(services.length, 1);
      assert.equal(services[0].id, 'custom-1');
    });
  });
});

// Additional tests for other providers would go here
// For now, we're testing with Redis provider as it's the default
// Consul, Kubernetes, and DNS providers would need their respective services running