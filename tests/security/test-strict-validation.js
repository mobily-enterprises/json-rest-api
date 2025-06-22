import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../lib/api.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';
import { ValidationPlugin } from '../../plugins/core/validation.js';
import { Schema } from '../../lib/schema.js';

test('Strict validation: number type coercion blocked by default', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('products', new Schema({
    price: { type: 'number' },
    quantity: { type: 'number' }
  }));
  
  // String numbers should be rejected in strict mode
  await assert.rejects(
    api.insert({
      price: "19.99", // String instead of number
      quantity: 10
    }, { type: 'products' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be a number');
      return true;
    }
  );
  
  // Actual numbers should work
  const product = await api.insert({
    price: 19.99,
    quantity: 10
  }, { type: 'products' });
  
  assert.equal(product.data.attributes.price, 19.99);
  assert.equal(product.data.attributes.quantity, 10);
});

test('Strict validation: boolean type coercion blocked by default', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('settings', new Schema({
    enabled: { type: 'boolean' },
    visible: { type: 'boolean' }
  }));
  
  // String booleans should be rejected
  await assert.rejects(
    api.insert({
      enabled: "true", // String instead of boolean
      visible: true
    }, { type: 'settings' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be a boolean');
      return true;
    }
  );
  
  // Numbers should be rejected
  await assert.rejects(
    api.insert({
      enabled: 1, // Number instead of boolean
      visible: true
    }, { type: 'settings' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be a boolean');
      return true;
    }
  );
  
  // Actual booleans should work
  const setting = await api.insert({
    enabled: true,
    visible: false
  }, { type: 'settings' });
  
  assert.equal(setting.data.attributes.enabled, true);
  assert.equal(setting.data.attributes.visible, false);
});

test('Strict validation: array type coercion blocked by default', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('posts', new Schema({
    tags: { type: 'array' }
  }));
  
  // Non-arrays should be rejected
  await assert.rejects(
    api.insert({
      tags: "single-tag" // String instead of array
    }, { type: 'posts' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be an array');
      return true;
    }
  );
  
  // Actual arrays should work
  const post = await api.insert({
    tags: ['tag1', 'tag2']
  }, { type: 'posts' });
  
  assert.deepEqual(post.data.attributes.tags, ['tag1', 'tag2']);
});

test('Strict validation: object type validation', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('configs', new Schema({
    settings: { type: 'object' }
  }));
  
  // Arrays should be rejected for object type
  await assert.rejects(
    api.insert({
      settings: ['not', 'an', 'object']
    }, { type: 'configs' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be an object');
      return true;
    }
  );
  
  // Strings should be rejected
  await assert.rejects(
    api.insert({
      settings: "{ invalid: json }"
    }, { type: 'configs' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be an object');
      return true;
    }
  );
  
  // Actual objects should work
  const config = await api.insert({
    settings: { theme: 'dark', language: 'en' }
  }, { type: 'configs' });
  
  assert.deepEqual(config.data.attributes.settings, { theme: 'dark', language: 'en' });
});

test('Strict validation: can disable strict mode globally', async () => {
  const schema = new Schema({
    price: { type: 'number' },
    enabled: { type: 'boolean' },
    tags: { type: 'array' }
  }, {
    strictMode: false // Disable strict mode
  });
  
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  api.addResource('items', schema);
  
  // With strict mode off, coercion should work
  const item = await api.insert({
    price: "29.99",     // String -> number
    enabled: "true",    // String -> boolean
    tags: "single"      // String -> array
  }, { type: 'items' });
  
  assert.equal(item.data.attributes.price, 29.99);
  assert.equal(item.data.attributes.enabled, true);
  assert.deepEqual(item.data.attributes.tags, ['single']);
});

test('Strict validation: can override per field', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('mixed', new Schema({
    strictPrice: { type: 'number', strictNumber: true },
    loosePrice: { type: 'number', strictNumber: false },
    strictBool: { type: 'boolean', strictBoolean: true },
    looseBool: { type: 'boolean', strictBoolean: false }
  }));
  
  // Test mixed strict/loose fields
  const result = await api.insert({
    strictPrice: 10,      // Must be number
    loosePrice: "20",     // Can be string
    strictBool: true,     // Must be boolean
    looseBool: "yes"      // Can be string
  }, { type: 'mixed' });
  
  assert.equal(result.data.attributes.strictPrice, 10);
  assert.equal(result.data.attributes.loosePrice, 20);
  assert.equal(result.data.attributes.strictBool, true);
  assert.equal(result.data.attributes.looseBool, true);
  
  // Strict fields should still reject wrong types
  await assert.rejects(
    api.insert({
      strictPrice: "not-allowed",
      loosePrice: "20",
      strictBool: true,
      looseBool: "yes"
    }, { type: 'mixed' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be a number');
      return true;
    }
  );
});

test('Strict validation: null and undefined handling', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('nullable', new Schema({
    optionalNumber: { type: 'number', canBeNull: true },
    optionalBool: { type: 'boolean', canBeNull: true },
    optionalArray: { type: 'array', canBeNull: true },
    optionalObject: { type: 'object', canBeNull: true }
  }));
  
  // Null and undefined should be allowed for optional fields
  const result = await api.insert({
    optionalNumber: null,
    optionalBool: undefined,
    // optionalArray omitted
    optionalObject: null
  }, { type: 'nullable' });
  
  assert.equal(result.data.attributes.optionalNumber, null);
  // undefined fields are typically omitted in JSON
  assert.equal(result.data.attributes.optionalObject, null);
});

test('Strict validation: required fields with strict types', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('strict-required', new Schema({
    userId: { type: 'number', required: true },
    active: { type: 'boolean', required: true },
    tags: { type: 'array', required: true }
  }));
  
  // All fields must be present and correct type
  await assert.rejects(
    api.insert({
      userId: "123", // Wrong type
      active: true,
      tags: []
    }, { type: 'strict-required' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be a number');
      return true;
    }
  );
  
  // Correct types should work
  const result = await api.insert({
    userId: 123,
    active: true,
    tags: ['test']
  }, { type: 'strict-required' });
  
  assert.equal(result.data.attributes.userId, 123);
  assert.equal(result.data.attributes.active, true);
  assert.deepEqual(result.data.attributes.tags, ['test']);
});

test('Strict validation: complex nested structures', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('complex', new Schema({
    metadata: {
      type: 'object',
      strictObject: true
    },
    scores: {
      type: 'array',
      strictArray: true
    }
  }));
  
  // Should validate nested structures
  const result = await api.insert({
    metadata: {
      nested: {
        deep: {
          value: 123 // Numbers in nested objects are fine
        }
      }
    },
    scores: [1, 2, 3, 4, 5]
  }, { type: 'complex' });
  
  assert.equal(result.data.attributes.metadata.nested.deep.value, 123);
  assert.deepEqual(result.data.attributes.scores, [1, 2, 3, 4, 5]);
});

test('Strict validation: update operations', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  
  api.addResource('updates', new Schema({
    count: { type: 'number' },
    active: { type: 'boolean' }
  }));
  
  // Create with correct types
  const item = await api.insert({
    count: 0,
    active: false
  }, { type: 'updates' });
  
  // Update with wrong type should fail
  await assert.rejects(
    api.update(item.data.id, {
      count: "5" // String instead of number
    }, { type: 'updates' }),
    (err) => {
      assert.equal(err.name, 'ValidationError');
      assert.equal(err.validationErrors[0].message, 'Value must be a number');
      return true;
    }
  );
  
  // Update with correct type should work
  const updated = await api.update(item.data.id, {
    count: 5,
    active: true
  }, { type: 'updates' });
  
  assert.equal(updated.data.attributes.count, 5);
  assert.equal(updated.data.attributes.active, true);
});