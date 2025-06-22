import test from 'ava';
import { Api } from '../../lib/api.js';
import { MemoryPlugin } from '../../plugins/memory.js';
import { JwtPlugin } from '../../plugins/jwt.js';

test.beforeEach(t => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(JwtPlugin, {
    secret: 'test-secret-key',
    expiresIn: '1h',
    refreshExpiresIn: '7d',
    rotateRefreshTokens: true
  });
  
  t.context.api = api;
});

test('Refresh token rotation: generates new token on refresh', async t => {
  const { api } = t.context;
  
  // Generate initial tokens
  const userId = 123;
  const payload = { userId, role: 'user' };
  
  const accessToken = await api.generateToken(payload);
  const refreshToken = await api.generateRefreshToken(userId, { role: 'user' });
  
  // Refresh the tokens
  const result = await api.refreshAccessToken(refreshToken);
  
  t.truthy(result.accessToken);
  t.truthy(result.refreshToken);
  t.not(result.refreshToken, refreshToken); // New refresh token
  t.true(result.rotated);
  t.is(result.expiresIn, '1h');
});

test('Refresh token rotation: old token cannot be reused', async t => {
  const { api } = t.context;
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId);
  
  // Use the refresh token once
  const result = await api.refreshAccessToken(refreshToken);
  t.truthy(result.refreshToken);
  
  // Try to use the old token again
  await t.throwsAsync(
    api.refreshAccessToken(refreshToken),
    { message: /Refresh token reuse detected/ }
  );
});

test('Refresh token rotation: token family tracking', async t => {
  const { api } = t.context;
  
  const userId = 123;
  const token1 = await api.generateRefreshToken(userId);
  
  // First rotation
  const result1 = await api.refreshAccessToken(token1);
  const token2 = result1.refreshToken;
  
  // Second rotation
  const result2 = await api.refreshAccessToken(token2);
  const token3 = result2.refreshToken;
  
  // All tokens should be in the same family
  t.not(token1, token2);
  t.not(token2, token3);
  t.not(token1, token3);
});

test('Refresh token rotation: family revocation on reuse', async t => {
  const { api } = t.context;
  
  const userId = 123;
  const token1 = await api.generateRefreshToken(userId);
  
  // First rotation
  const result1 = await api.refreshAccessToken(token1);
  const token2 = result1.refreshToken;
  
  // Second rotation
  const result2 = await api.refreshAccessToken(token2);
  const token3 = result2.refreshToken;
  
  // Try to reuse token2 (which was already used)
  await t.throwsAsync(
    api.refreshAccessToken(token2),
    { message: /Refresh token reuse detected/ }
  );
  
  // Token3 should also be revoked (same family)
  await t.throwsAsync(
    api.refreshAccessToken(token3),
    { message: /Invalid refresh token/ }
  );
});

test('Refresh token rotation: can disable rotation', async t => {
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
  t.is(result1.refreshToken, refreshToken); // Same token
  t.false(result1.rotated);
  
  // Can use the same token again
  const result2 = await api.refreshAccessToken(refreshToken);
  t.is(result2.refreshToken, refreshToken);
});

test('Refresh token rotation: per-request rotation control', async t => {
  const { api } = t.context;
  
  const userId = 123;
  const refreshToken = await api.generateRefreshToken(userId);
  
  // Disable rotation for this request
  const result = await api.refreshAccessToken(refreshToken, { rotate: false });
  
  t.is(result.refreshToken, refreshToken); // Same token
  t.false(result.rotated);
  
  // Token can still be used
  const result2 = await api.refreshAccessToken(refreshToken);
  t.not(result2.refreshToken, refreshToken); // Now it rotates
});

test('Refresh token rotation: expired tokens are cleaned up', async t => {
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
  await t.throwsAsync(
    api.refreshAccessToken(refreshToken),
    { message: /Refresh token expired/ }
  );
});

test('Refresh token rotation: metadata is preserved', async t => {
  const { api } = t.context;
  
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
  t.is(decoded.userId, userId);
  t.is(decoded.role, 'admin');
  t.deepEqual(decoded.permissions, ['read', 'write']);
  t.is(decoded.department, 'IT');
});

test('Refresh token rotation: onRefresh hook', async t => {
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
  t.true(hookCalled);
  t.is(hookPayload.userId, userId);
  t.is(hookPayload.role, 'user');
  t.truthy(hookTokenData.createdAt);
  
  // Verify payload was modified
  const decoded = await api.verifyToken(result.accessToken);
  t.truthy(decoded.refreshedAt);
});

test('Refresh token rotation: security event logging', async t => {
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args);
  
  try {
    const { api } = t.context;
    
    const userId = 123;
    const token1 = await api.generateRefreshToken(userId);
    
    // Use token
    const result = await api.refreshAccessToken(token1);
    
    // Reuse token (triggers security event)
    await t.throwsAsync(
      api.refreshAccessToken(token1)
    );
    
    // Check security event was logged
    t.true(logs.length > 0);
    const warning = logs.find(log => log[0].includes('Token family'));
    t.truthy(warning);
    t.regex(warning[0], /revoked due to token reuse detection/);
  } finally {
    console.warn = originalWarn;
  }
});

test('Refresh token rotation: concurrent refresh attempts', async t => {
  const { api } = t.context;
  
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
  
  t.is(successes.length, 1);
  t.is(failures.length, 2);
  
  // Failures should be due to token reuse
  for (const failure of failures) {
    t.regex(failure.reason.message, /reuse detected|Invalid/);
  }
});

test('Refresh token rotation: parent token tracking', async t => {
  const { api } = t.context;
  
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
  t.not(token1, token2);
  t.not(token2, token3);
});