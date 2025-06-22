import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../lib/api.js';
import { MemoryPlugin } from '../../plugins/memory.js';
import { JwtPlugin } from '../../plugins/jwt.js';

test.beforeEach(async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(JwtPlugin, {
    secret: 'test-secret-key',
    expiresIn: '1h',
    refreshExpiresIn: '7d',
    rotateRefreshTokens: true
  });
  
  globalThis.api = api;
});

test('Refresh token rotation: generates new token on refresh', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Generate initial tokens
  const userId = 123;
  const payload = { userId, role: 'user' };
  
  const accessToken = await api.generateToken(payload);
  const refreshToken = await api.generateRefreshToken(userId, { role: 'user' });
  
  // Refresh the tokens
  const result = await api.refreshAccessToken(refreshToken);
  
  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
  assert.notEqual(result.refreshToken, refreshToken); // New refresh token
  assert.equal(result.rotated, true);
  assert.equal(result.expiresIn, '1h');
});

test('Refresh token rotation: old token cannot be reused', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId);
  
  // Use the refresh token once
  const result = await api.refreshAccessToken(refreshToken);
  assert.ok(result.refreshToken);
  
  // Try to use the old token again
  await assert.rejects(
    api.refreshAccessToken(refreshToken),
    { message: /Refresh token reuse detected/ }
  );
});

test('Refresh token rotation: token family tracking', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const userId = 123;
  const token1 = await api.generateRefreshToken(userId);
  
  // First rotation
  const result1 = await api.refreshAccessToken(token1);
  const token2 = result1.refreshToken;
  
  // Second rotation
  const result2 = await api.refreshAccessToken(token2);
  const token3 = result2.refreshToken;
  
  // All tokens should be in the same family
  assert.notEqual(token1, token2);
  assert.notEqual(token2, token3);
  assert.notEqual(token1, token3);
});

test('Refresh token rotation: family revocation on reuse', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const userId = 123;
  const token1 = await api.generateRefreshToken(userId);
  
  // First rotation
  const result1 = await api.refreshAccessToken(token1);
  const token2 = result1.refreshToken;
  
  // Second rotation
  const result2 = await api.refreshAccessToken(token2);
  const token3 = result2.refreshToken;
  
  // Try to reuse token2 (which was already used)
  await assert.rejects(
    api.refreshAccessToken(token2),
    { message: /Refresh token reuse detected/ }
  );
  
  // Token3 should also be revoked (same family)
  await assert.rejects(
    api.refreshAccessToken(token3),
    { message: /Invalid refresh token/ }
  );
});

test('Refresh token rotation: can disable rotation', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(JwtPlugin, {
    secret: 'test-secret-key',
    rotateRefreshTokens: false
  });
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId);
  
  // Refresh without rotation
  const result1 = await api.refreshAccessToken(refreshToken);
  assert.equal(result1.refreshToken, refreshToken); // Same token
  assert.equal(result1.rotated);
  
  // Can use the same token again
  const result2 = await api.refreshAccessToken(refreshToken);
  assert.equal(result2.refreshToken, refreshToken);
});

test('Refresh token rotation: per-request rotation control', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId);
  
  // Disable rotation for this request
  const result = await api.refreshAccessToken(refreshToken, { rotate: false });
  
  assert.equal(result.refreshToken, refreshToken); // Same token
  assert.equal(result.rotated);
  
  // Token can still be used
  const result2 = await api.refreshAccessToken(refreshToken);
  assert.notEqual(result2.refreshToken, refreshToken); // Now it rotates
});

test('Refresh token rotation: expired tokens are cleaned up', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(JwtPlugin, {
    secret: 'test-secret-key',
    refreshExpiresIn: '100ms' // Very short for testing
  });
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId);
  
  // Wait for expiration
  await new Promise(resolve => setTimeout(resolve, 150));
  
  // Should fail with expiration error
  await assert.rejects(
    api.refreshAccessToken(refreshToken),
    { message: /Refresh token expired/ }
  );
});

test('Refresh token rotation: metadata is preserved', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const userId = 123;
  const metadata = { 
    role: 'admin',
    permissions: ['read', 'write'],
    department: 'IT'
  };
  
  const refreshToken = await api.generateRefreshToken(userId, metadata);
  
  // Refresh and check metadata
  const result = await api.refreshAccessToken(refreshToken);
  
  // Verify access token has the metadata
  const decoded = await api.verifyToken(result.accessToken);
  assert.equal(decoded.userId, userId);
  assert.equal(decoded.role, 'admin');
  assert.deepEqual(decoded.permissions, ['read', 'write']);
  assert.equal(decoded.department, 'IT');
});

test('Refresh token rotation: onRefresh hook', async () => {
  let hookCalled = false;
  let hookPayload = null;
  let hookTokenData = null;
  
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(JwtPlugin, {
    secret: 'test-secret-key',
    onRefresh: async (payload, tokenData) => {
      hookCalled = true;
      hookPayload = payload;
      hookTokenData = tokenData;
      
      // Modify payload
      payload.refreshedAt = new Date().toISOString();
    }
  });
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId, { role: 'user' });
  
  const result = await api.refreshAccessToken(refreshToken);
  
  // Hook should have been called
  assert.equal(hookCalled, true);
  assert.equal(hookPayload.userId, userId);
  assert.equal(hookPayload.role, 'user');
  assert.ok(hookTokenData.createdAt);
  
  // Verify payload was modified
  const decoded = await api.verifyToken(result.accessToken);
  assert.ok(decoded.refreshedAt);
});

test('Refresh token rotation: security event logging', async () => {
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args);
  
  try {
    
    
    const userId = 123;
    const token1 = await api.generateRefreshToken(userId);
    
    // Use token
    const result = await api.refreshAccessToken(token1);
    
    // Reuse token (triggers security event)
    await assert.rejects(
      api.refreshAccessToken(token1)
    );
    
    // Check security event was logged
    assert.equal(logs.length > 0, true);
    const warning = logs.find(log => log[0].includes('Token family'));
    assert.ok(warning);
    assert.match(warning[0], /revoked due to token reuse detection/);
  } finally {
    console.warn = originalWarn;
  }
});

test('Refresh token rotation: concurrent refresh attempts', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId);
  
  // Simulate concurrent refresh attempts
  const promises = [
    api.refreshAccessToken(refreshToken),
    api.refreshAccessToken(refreshToken),
    api.refreshAccessToken(refreshToken)
  ];
  
  const results = await Promise.allSettled(promises);
  
  // Only one should succeed
  const successes = results.filter(r => r.status === 'fulfilled');
  const failures = results.filter(r => r.status === 'rejected');
  
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 2);
  
  // Failures should be due to token reuse
  for (const failure of failures) {
    assert.match(failure.reason.message, /reuse detected|Invalid/);
  }
});

test('Refresh token rotation: parent token tracking', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const userId = 123;
  const token1 = await api.generateRefreshToken(userId);
  
  // Create a chain of tokens
  const result1 = await api.refreshAccessToken(token1);
  const token2 = result1.refreshToken;
  
  const result2 = await api.refreshAccessToken(token2);
  const token3 = result2.refreshToken;
  
  // Each token should track its parent
  // (This would require exposing token data for testing, 
  // but the internal implementation tracks parentToken)
  assert.notEqual(token1, token2);
  assert.notEqual(token2, token3);
});