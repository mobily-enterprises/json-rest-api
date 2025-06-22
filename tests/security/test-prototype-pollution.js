import test from 'ava';
import { Api } from '../../lib/api.js';
import { MemoryPlugin } from '../../plugins/memory.js';

test.beforeEach(t => {
  const api = new Api();
  api.use(MemoryPlugin);
  
  api.addResource('items', {
    name: { type: 'string', required: true },
    data: { type: 'object' }
  });
  
  t.context.api = api;
});

test('Prototype pollution: blocks __proto__ at top level', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    name: 'Test item',
    __proto__: { isAdmin: true }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // __proto__ should be stripped
  t.is(result.__proto__, Object.prototype);
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
  t.is(result.name, 'Test item');
});

test('Prototype pollution: blocks constructor at top level', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    name: 'Test item',
    constructor: { prototype: { isAdmin: true } }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // constructor should be stripped
  t.not(result.constructor, maliciousData.constructor);
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: blocks prototype at top level', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    name: 'Test item',
    prototype: { isAdmin: true }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // prototype should be stripped
  t.is(result.prototype, undefined);
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: blocks nested __proto__ chains', async t => {
  const { api } = t.context;
  
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
  
  await t.throwsAsync(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  // Verify no pollution occurred
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: blocks __proto__.__proto__', async t => {
  const { api } = t.context;
  
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
  
  await t.throwsAsync(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: blocks __proto__.constructor', async t => {
  const { api } = t.context;
  
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
  
  await t.throwsAsync(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: blocks constructor.__proto__', async t => {
  const { api } = t.context;
  
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
  
  await t.throwsAsync(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: allows safe nested objects', async t => {
  const { api } = t.context;
  
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
  
  t.is(result.data.nested.deeply.value, 'safe');
  t.is(result.data.array[0].item, 'safe1');
  t.is(result.data.array[1].item, 'safe2');
});

test('Prototype pollution: blocks valueOf override with non-function', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    name: 'Test item',
    valueOf: 'not a function'
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // valueOf should not be overridden with non-function
  t.is(typeof result.valueOf, 'function');
});

test('Prototype pollution: blocks toString override with non-function', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    name: 'Test item',
    toString: { malicious: true }
  };
  
  const result = await api.insert(maliciousData, { type: 'items' });
  
  // toString should not be overridden with non-function
  t.is(typeof result.toString, 'function');
});

test('Prototype pollution: handles arrays with dangerous keys', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    name: 'Test item',
    data: {
      items: [
        { __proto__: { isAdmin: true } },
        { constructor: { prototype: { isAdmin: true } } }
      ]
    }
  };
  
  await t.throwsAsync(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: deep path detection', async t => {
  const { api } = t.context;
  
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
  
  await t.throwsAsync(
    api.insert(maliciousData, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});

test('Prototype pollution: mixed attack vectors', async t => {
  const { api } = t.context;
  
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
    await t.throwsAsync(
      api.insert(attack, { type: 'items' }),
      { message: /prototype pollution/i }
    );
  }
  
  // Verify no pollution occurred
  t.false(Object.prototype.hasOwnProperty('polluted'));
  t.false(Object.constructor.prototype.hasOwnProperty('polluted'));
});

test('Prototype pollution: update operations', async t => {
  const { api } = t.context;
  
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
  
  await t.throwsAsync(
    api.update(item.id, maliciousUpdate, { type: 'items' }),
    { message: /prototype pollution/i }
  );
  
  t.false(Object.prototype.hasOwnProperty('isAdmin'));
});