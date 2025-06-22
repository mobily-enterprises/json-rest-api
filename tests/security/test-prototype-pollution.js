import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../lib/api.js';
import { Schema } from '../../lib/schema.js';
import { MemoryPlugin } from '../../plugins/memory.js';

test.beforeEach(async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  
  api.addResource('items', new Schema({
    name: { type: 'string', required: true },
    data: { type: 'object' }
  }));
  
  globalThis.api = api;
});

test('Prototype pollution: blocks __proto__ at top level', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    __proto__: { isAdmin: true }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // __proto__ should be stripped
  assert.equal(result.__proto__, Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
  assert.equal(result.name, 'Test item');
});

test('Prototype pollution: blocks constructor at top level', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    constructor: { prototype: { isAdmin: true } }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // constructor should be stripped
  assert.notEqual(result.constructor, maliciousData.constructor);
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: blocks prototype at top level', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    prototype: { isAdmin: true }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // prototype should be stripped
  assert.equal(result.prototype, undefined);
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: blocks nested __proto__ chains', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    data: {
      constructor: {
        prototype: {
          isAdmin: true
        }
      }
    }
  };
  
  await assert.rejects(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  // Verify no pollution occurred
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: blocks __proto__.__proto__', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    data: {
      __proto__: {
        __proto__: {
          isAdmin: true
        }
      }
    }
  };
  
  await assert.rejects(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: blocks __proto__.constructor', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    data: {
      __proto__: {
        constructor: {
          isAdmin: true
        }
      }
    }
  };
  
  await assert.rejects(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: blocks constructor.__proto__', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    data: {
      constructor: {
        __proto__: {
          isAdmin: true
        }
      }
    }
  };
  
  await assert.rejects(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: allows safe nested objects', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const safeData = {
    name: 'Test item',
    data: {
      nested: {
        deeply: {
          value: 'safe'
        }
      },
      array: [
        { item: 'safe1' },
        { item: 'safe2' }
      ]
    }
  };
  
  const result = await api.insert(safeData, { type: 'items' });
  
  assert.equal(result.data.nested.deeply.value, 'safe');
  assert.equal(result.data.array[0].item, 'safe1');
  assert.equal(result.data.array[1].item, 'safe2');
});

test('Prototype pollution: blocks valueOf override with non-function', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    valueOf: 'not a function'
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // valueOf should not be overridden with non-function
  assert.equal(typeof result.valueOf, 'function');
});

test('Prototype pollution: blocks toString override with non-function', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    toString: { malicious: true }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // toString should not be overridden with non-function
  assert.equal(typeof result.toString, 'function');
});

test('Prototype pollution: handles arrays with dangerous keys', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    data: {
      items: [
        { __proto__: { isAdmin: true } },
        { constructor: { prototype: { isAdmin: true } } }
      ]
    }
  };
  
  await assert.rejects(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: deep path detection', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    name: 'Test item',
    data: {
      level1: {
        level2: {
          constructor: {
            level3: {
              prototype: {
                isAdmin: true
              }
            }
          }
        }
      }
    }
  };
  
  await assert.rejects(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});

test('Prototype pollution: mixed attack vectors', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const attacks = [
    {
      name: 'Attack 1',
      data: { '__proto__': { 'polluted': true } }
    },
    {
      name: 'Attack 2',
      data: { 'constructor': { 'prototype': { 'polluted': true } } }
    },
    {
      name: 'Attack 3',
      data: { 'prototype': { 'constructor': { 'polluted': true } } }
    }
  ];
  
  for (const attack of attacks) {
    await assert.rejects(
      api.insert(attack, { type: 'items' }),
      { message: /prototype pollution/i }
    );
  }
  
  // Verify no pollution occurred
  assert.equal(Object.prototype.hasOwnProperty('polluted'));
  assert.equal(Object.constructor.prototype.hasOwnProperty('polluted'), false);
});

test('Prototype pollution: update operations', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Create a safe item first
  const item = await api.insert({ name: 'Safe item' }, { type: 'items' });
  
  // Try to update with prototype pollution
  const maliciousUpdate = {
    data: {
      constructor: {
        prototype: {
          isAdmin: true
        }
      }
    }
  };
  
  await assert.rejects(
    api.update(item.id, maliciousUpdate, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  assert.equal(Object.prototype.hasOwnProperty('isAdmin'), false);
});