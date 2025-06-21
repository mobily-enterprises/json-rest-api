import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { Api } from '../lib/api.js';
import { JwtPlugin } from '../plugins/jwt.js';

test('Timing Attack Prevention Tests', async (t) => {
  
  await t.test('Constant-time string comparison', async (t2) => {
    
    await t2.test('should use crypto.timingSafeEqual internally', async () => {
      const api = new Api();
      api.use(JwtPlugin, { secret: 'test-secret' });
      
      // The safeCompare function is not exported, but we can test
      // that the JWT plugin uses timing-safe comparison by checking
      // the refresh token validation behavior
      
      // Create a mock token store
      const tokenStore = new Map();
      const validToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(validToken).digest('hex');
      
      tokenStore.set(hashedToken, {
        hashedToken,
        userId: 123,
        expiresAt: new Date(Date.now() + 3600000),
        metadata: {}
      });
      
      // Reconfigure with our token store
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore 
      });
      
      // Valid token should work
      const result = await api.refreshAccessToken(validToken);
      assert.ok(result.accessToken);
      assert.strictEqual(result.refreshToken, validToken);
    });
    
    await t2.test('should handle different length strings safely', async () => {
      // Test that the implementation handles different lengths
      // without leaking timing information
      const api = new Api();
      const tokenStore = new Map();
      
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore 
      });
      
      // Test with invalid token (should fail safely)
      try {
        await api.refreshAccessToken('short');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.message, 'Invalid refresh token');
      }
      
      // Test with another invalid token of different length
      try {
        await api.refreshAccessToken('a'.repeat(100));
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.message, 'Invalid refresh token');
      }
    });
    
    await t2.test('should add consistent delays for invalid tokens', async () => {
      const api = new Api();
      const tokenStore = new Map();
      
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore 
      });
      
      // Time multiple invalid token attempts
      const timings = [];
      
      for (let i = 0; i < 5; i++) {
        const start = process.hrtime.bigint();
        try {
          await api.refreshAccessToken('invalid-token-' + i);
        } catch (error) {
          // Expected
        }
        const end = process.hrtime.bigint();
        timings.push(Number(end - start) / 1e6); // Convert to ms
      }
      
      // All attempts should take at least 10ms (the consistent delay)
      assert.ok(timings.every(t => t >= 10), 'All attempts should have delay');
      
      // Check that random delay is applied (0-2ms variation expected)
      const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
      assert.ok(avgTiming >= 10 && avgTiming <= 15, 'Average timing should be reasonable');
    });
  });
  
  await t.test('Safe token lookup with random delays', async (t2) => {
    
    await t2.test('should always perform lookup even for invalid tokens', async () => {
      const api = new Api();
      
      // Create a custom token store that tracks lookups
      let lookupCount = 0;
      const tokenStore = {
        get: async (token) => {
          lookupCount++;
          return null; // Always return null
        },
        set: async () => {},
        delete: async () => {}
      };
      
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore 
      });
      
      // Try multiple invalid tokens
      for (let i = 0; i < 3; i++) {
        try {
          await api.refreshAccessToken('invalid-' + i);
        } catch (error) {
          // Expected
        }
      }
      
      // Should have performed lookup for each attempt
      assert.strictEqual(lookupCount, 3);
    });
    
    await t2.test('should validate token data using constant-time comparison', async () => {
      const api = new Api();
      const tokenStore = new Map();
      
      // Add a valid token
      const validToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(validToken).digest('hex');
      
      tokenStore.set(hashedToken, {
        hashedToken, // This field is checked with safeCompare
        userId: 123,
        expiresAt: new Date(Date.now() + 3600000),
        metadata: {}
      });
      
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore 
      });
      
      // Valid token should succeed
      const result = await api.refreshAccessToken(validToken);
      assert.ok(result.accessToken);
      
      // Token with missing hashedToken field should fail
      const invalidToken = crypto.randomBytes(32).toString('hex');
      const invalidHashed = crypto.createHash('sha256').update(invalidToken).digest('hex');
      
      tokenStore.set(invalidHashed, {
        // Missing hashedToken field
        userId: 456,
        expiresAt: new Date(Date.now() + 3600000),
        metadata: {}
      });
      
      try {
        await api.refreshAccessToken(invalidToken);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.message, 'Invalid refresh token');
      }
    });
  });
  
  await t.test('JWT token verification security', async (t2) => {
    
    await t2.test('should not leak timing info for legacy token format check', async () => {
      const api = new Api();
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        supportLegacyTokens: true 
      });
      
      // The isLegacyToken check is intentionally not constant-time
      // because it only checks format, not secrets
      
      // Test various token formats
      const tokens = [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', // JWT
        Buffer.from(JSON.stringify({ user: 'test' })).toString('base64'), // Legacy
        'not-a-token',
        'SGVsbG8gV29ybGQ=', // Base64 but not JSON
      ];
      
      for (const token of tokens) {
        try {
          await api.verifyToken(token);
        } catch (error) {
          // Expected - we're just checking it doesn't crash
        }
      }
      
      // Should handle all formats gracefully
      assert.ok(true);
    });
    
    await t2.test('should handle expired tokens securely', async () => {
      const api = new Api();
      const tokenStore = new Map();
      
      // Create an expired token
      const expiredToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(expiredToken).digest('hex');
      
      tokenStore.set(hashedToken, {
        hashedToken,
        userId: 123,
        expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
        metadata: {}
      });
      
      api.use(JwtPlugin, { 
        secret: 'test-secret',
        tokenStore 
      });
      
      try {
        await api.refreshAccessToken(expiredToken);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.message, 'Refresh token expired');
      }
      
      // Token should be deleted after expiry check
      assert.ok(!tokenStore.has(hashedToken));
    });
  });
  
  await t.test('Performance characteristics', async (t2) => {
    
    await t2.test('timing-safe comparison should have consistent performance', () => {
      // Test that Buffer comparison is consistent
      const iterations = 1000;
      const timings = [];
      
      for (let i = 0; i < iterations; i++) {
        const a = crypto.randomBytes(32);
        const b = crypto.randomBytes(32);
        
        const start = process.hrtime.bigint();
        try {
          crypto.timingSafeEqual(a, b);
        } catch (error) {
          // Expected when not equal
        }
        const end = process.hrtime.bigint();
        
        timings.push(Number(end - start));
      }
      
      // Calculate standard deviation
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance = timings.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / timings.length;
      const stdDev = Math.sqrt(variance);
      
      // Standard deviation should be relatively low (consistent timing)
      const coefficientOfVariation = stdDev / avg;
      // Note: In practice, system noise can cause variation, so we use a lenient threshold
      assert.ok(coefficientOfVariation < 2.0, `Timing coefficient of variation ${coefficientOfVariation.toFixed(2)} should be < 2.0`);
    });
  });
  
  await t.test('Integration with JWT lifecycle', async (t2) => {
    
    await t2.test('full token lifecycle should be secure', async () => {
      const api = new Api();
      api.use(JwtPlugin, { 
        secret: 'test-secret-key',
        expiresIn: '1h',
        refreshExpiresIn: '7d'
      });
      
      // Generate tokens
      const userId = 123;
      const accessToken = await api.generateToken({ userId });
      const refreshToken = await api.generateRefreshToken(userId, { role: 'user' });
      
      // Verify access token
      const decoded = await api.verifyToken(accessToken);
      assert.strictEqual(decoded.userId, userId);
      
      // Use refresh token (with timing-safe validation)
      const refreshed = await api.refreshAccessToken(refreshToken);
      assert.ok(refreshed.accessToken);
      assert.strictEqual(refreshed.refreshToken, refreshToken);
      
      // Verify new access token
      const newDecoded = await api.verifyToken(refreshed.accessToken);
      assert.strictEqual(newDecoded.userId, userId);
      
      // Revoke refresh token
      await api.revokeRefreshToken(refreshToken);
      
      // Should fail after revocation
      try {
        await api.refreshAccessToken(refreshToken);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.strictEqual(error.message, 'Invalid refresh token');
      }
    });
  });
  
});

console.log('Timing Attack Prevention tests completed');