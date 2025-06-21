import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Schema } from '../lib/schema.js';

describe('Input Size Validation', () => {
  describe('Array maxItems', () => {
    test('should accept arrays within limit', async () => {
      const schema = new Schema({
        tags: { type: 'array', maxItems: 5 }
      });
      
      const result = await schema.validate({
        tags: ['tag1', 'tag2', 'tag3']
      });
      
      assert.equal(result.errors.length, 0);
      assert.deepEqual(result.validatedObject.tags, ['tag1', 'tag2', 'tag3']);
    });
    
    test('should reject arrays exceeding limit', async () => {
      const schema = new Schema({
        tags: { type: 'array', maxItems: 3 }
      });
      
      const result = await schema.validate({
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5']
      });
      
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].field, 'tags');
      assert.match(result.errors[0].message, /cannot have more than 3 items/);
    });
    
    test('should use custom error message', async () => {
      const schema = new Schema({
        tags: { 
          type: 'array', 
          maxItems: 2,
          maxItemsErrorMessage: 'Too many tags!'
        }
      });
      
      const result = await schema.validate({
        tags: ['tag1', 'tag2', 'tag3']
      });
      
      assert.equal(result.errors[0].message, 'Too many tags!');
    });
  });
  
  describe('Object maxKeys', () => {
    test('should accept objects within key limit', async () => {
      const schema = new Schema({
        metadata: { type: 'object', maxKeys: 5 }
      });
      
      const result = await schema.validate({
        metadata: { a: 1, b: 2, c: 3 }
      });
      
      assert.equal(result.errors.length, 0);
    });
    
    test('should reject objects exceeding key limit', async () => {
      const schema = new Schema({
        metadata: { type: 'object', maxKeys: 2 }
      });
      
      const result = await schema.validate({
        metadata: { a: 1, b: 2, c: 3, d: 4 }
      });
      
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].message, /cannot have more than 2 keys/);
    });
  });
  
  describe('Object maxDepth', () => {
    test('should accept objects within depth limit', async () => {
      const schema = new Schema({
        config: { type: 'object', maxDepth: 3 }
      });
      
      const result = await schema.validate({
        config: {
          level1: {
            level2: {
              level3: 'value'
            }
          }
        }
      });
      
      assert.equal(result.errors.length, 0);
    });
    
    test('should reject objects exceeding depth limit', async () => {
      const schema = new Schema({
        config: { type: 'object', maxDepth: 2 }
      });
      
      const result = await schema.validate({
        config: {
          level1: {
            level2: {
              level3: {
                level4: 'too deep'
              }
            }
          }
        }
      });
      
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].message, /cannot be nested deeper than 2 levels/);
    });
    
    test('should handle arrays within objects for depth calculation', async () => {
      const schema = new Schema({
        data: { type: 'object', maxDepth: 3 }
      });
      
      const result = await schema.validate({
        data: {
          items: [
            { nested: { value: 1 } },
            { nested: { value: 2 } }
          ]
        }
      });
      
      assert.equal(result.errors.length, 0);
    });
  });
  
  describe('Combined limits', () => {
    test('should enforce multiple limits on same field', async () => {
      const schema = new Schema({
        data: { type: 'object', maxKeys: 3, maxDepth: 2 }
      });
      
      // Should pass both limits
      let result = await schema.validate({
        data: { a: 1, b: { nested: 2 } }
      });
      assert.equal(result.errors.length, 0);
      
      // Should fail key limit
      result = await schema.validate({
        data: { a: 1, b: 2, c: 3, d: 4 }
      });
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].message, /cannot have more than 3 keys/);
      
      // Should fail depth limit
      result = await schema.validate({
        data: { a: { b: { c: 'too deep' } } }
      });
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].message, /cannot be nested deeper than 2 levels/);
    });
  });
  
  describe('Warning system', () => {
    test('should warn about unlimited objects and arrays', () => {
      // Capture console.warn calls
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (msg) => warnings.push(msg);
      
      try {
        new Schema({
          unlimited_obj: { type: 'object' },
          limited_obj: { type: 'object', maxKeys: 100 },
          unlimited_arr: { type: 'array' },
          limited_arr: { type: 'array', maxItems: 50 }
        });
        
        // Should have 2 warnings
        assert.equal(warnings.length, 2);
        assert(warnings.some(w => w.includes("'unlimited_obj'")));
        assert(warnings.some(w => w.includes("'unlimited_arr'")));
        assert(!warnings.some(w => w.includes("'limited_obj'")));
        assert(!warnings.some(w => w.includes("'limited_arr'")));
      } finally {
        console.warn = originalWarn;
      }
    });
  });
});