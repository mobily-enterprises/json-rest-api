import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api } from '../../../lib/api.js';
import { Schema } from '../../../lib/schema.js';
import { MemoryPlugin } from '../../memory.js';
import { CachePlugin } from './index.js';

describe('CachePlugin Simple Tests', () => {
  let api;

  beforeEach(async () => {
    api = new Api();
    api.use(MemoryPlugin);
    api.use(CachePlugin, {
      store: 'memory',
      ttl: 60
    });

    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string' }
    }));

    await api.connect();
  });

  afterEach(async () => {
    if (api && api.disconnect) {
      await api.disconnect();
    }
  });

  it('should cache GET requests', async () => {
    // Create a user
    const createResult = await api.resources.users.create({
      name: 'John Doe',
      email: 'john@example.com'
    });

    const userId = createResult.data.id;

    // First request - cache miss
    const stats1 = api.cache.stats();
    const result1 = await api.resources.users.get(userId);
    const stats2 = api.cache.stats();
    
    assert.equal(stats2.misses - stats1.misses, 1);
    assert.equal(stats2.sets - stats1.sets, 1);

    // Second request - cache hit
    const result2 = await api.resources.users.get(userId);
    const stats3 = api.cache.stats();
    
    assert.equal(stats3.hits - stats2.hits, 1);
    assert.deepEqual(result1, result2);
  });

  it('should invalidate cache on update', async () => {
    const createResult = await api.resources.users.create({
      name: 'Test User',
      email: 'test@example.com'
    });

    const userId = createResult.data.id;

    // Cache the GET
    await api.resources.users.get(userId);
    const stats1 = api.cache.stats();

    // Update should invalidate
    await api.resources.users.update(userId, { name: 'Updated User' });

    // Next GET should be a miss
    await api.resources.users.get(userId);
    const stats2 = api.cache.stats();
    
    assert.equal(stats2.misses - stats1.misses, 1);
  });
});