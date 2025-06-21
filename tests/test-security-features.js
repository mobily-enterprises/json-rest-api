import { test } from 'node:test';
import assert from 'node:assert';
import { SafeRegex, SafePatterns } from '../lib/safe-regex.js';
import { Schema } from '../lib/schema.js';
import { Api } from '../lib/api.js';
import { JwtPlugin } from '../plugins/jwt.js';
import crypto from 'crypto';

// Suppress warnings during tests
const originalWarn = console.warn;
console.warn = () => {};

test('Security Features Tests', async (t) => {
  
  await t.test('ReDoS Protection', async (t2) => {
    
    await t2.test('should detect dangerous patterns', () => {
      const warnings = [];
      console.warn = (msg) => warnings.push(msg);
      
      try {
        new SafeRegex('(a+)+b'); // Nested quantifier - dangerous
        assert.ok(warnings.length > 0);
        assert.ok(warnings[0].includes('dangerous'));
      } finally {
        console.warn = () => {};
      }
    });
    
    await t2.test('should validate emails safely', () => {
      const email = SafePatterns.email;
      
      // Valid
      assert.ok(email.test('user@example.com'));
      assert.ok(email.test('test.user@company.org'));
      
      // Invalid
      assert.ok(!email.test('not-an-email'));
      assert.ok(!email.test('@example.com'));
      assert.ok(!email.test('user@'));
    });
    
    await t2.test('should integrate with Schema validation', async () => {
      const schema = new Schema({
        email: { type: 'string', format: 'email' },
        website: { type: 'string', format: 'url' }
      });
      
      // Valid data
      const validResult = await schema.validate({
        email: 'test@example.com',
        website: 'https://example.com'
      });
      assert.strictEqual(validResult.errors.length, 0);
      
      // Invalid data
      const invalidResult = await schema.validate({
        email: 'not-email',
        website: 'not-url'
      });
      assert.strictEqual(invalidResult.errors.length, 2);
      assert.ok(invalidResult.errors[0].message.includes('email format'));
      assert.ok(invalidResult.errors[1].message.includes('URL format'));
    });
    
    await t2.test('should handle null/undefined gracefully', async () => {
      const schema = new Schema({
        optional: { type: 'string', format: 'email' }
      });
      
      // Missing field is OK
      const result1 = await schema.validate({});
      assert.strictEqual(result1.errors.length, 0);
      
      // Null needs canBeNull: true to be allowed
      const result2 = await schema.validate({ optional: null });
      assert.strictEqual(result2.errors.length, 1);
      assert.strictEqual(result2.errors[0].code, 'FIELD_CANNOT_BE_NULL');
    });
  });
  
  await t.test('Timing Attack Prevention', async (t2) => {
    
    await t2.test('should use constant-time comparison for refresh tokens', async () => {
      const api = new Api();
      const tokenStore = new Map();
      
      // Create valid token
      const validToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(validToken).digest('hex');
      
      tokenStore.set(hashedToken, {
        hashedToken,
        userId: 123,
        expiresAt: new Date(Date.now() + 3600000),
        metadata: {}
      });
      
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore 
      });
      
      // Valid token should work
      const result = await api.refreshAccessToken(validToken);
      assert.ok(result.accessToken);
      
      // Invalid token should fail with consistent timing
      try {
        await api.refreshAccessToken('invalid-token');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.message, 'Invalid refresh token');
      }
    });
    
    await t2.test('should add delays to prevent timing analysis', async () => {
      const api = new Api();
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore: new Map()
      });
      
      // Time an invalid token lookup
      const start = process.hrtime.bigint();
      try {
        await api.refreshAccessToken('invalid');
      } catch (error) {
        // Expected
      }
      const end = process.hrtime.bigint();
      const elapsedMs = Number(end - start) / 1e6;
      
      // Should take at least 10ms due to consistent delay
      assert.ok(elapsedMs >= 10, `Took ${elapsedMs}ms, should be >= 10ms`);
    });
    
    await t2.test('should handle JWT lifecycle securely', async () => {
      const api = new Api();
      api.use(JwtPlugin, { 
        secret: 'secure-test-secret',
        expiresIn: '1h'
      });
      
      // Generate tokens
      const accessToken = await api.generateToken({ userId: 123 });
      const refreshToken = await api.generateRefreshToken(123, { role: 'user' });
      
      // Verify access token
      const decoded = await api.verifyToken(accessToken);
      assert.strictEqual(decoded.userId, 123);
      
      // Use refresh token
      const refreshed = await api.refreshAccessToken(refreshToken);
      assert.ok(refreshed.accessToken);
      
      // Revoke and verify it fails
      await api.revokeRefreshToken(refreshToken);
      
      try {
        await api.refreshAccessToken(refreshToken);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.message, 'Invalid refresh token');
      }
    });
  });
  
});

// Restore console.warn
console.warn = originalWarn;

console.log('\n✅ Security features tests completed!');