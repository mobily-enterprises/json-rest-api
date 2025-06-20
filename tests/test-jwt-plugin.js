import { test } from 'node:test';
import assert from 'node:assert';
import { Api } from '../index.js';
import { JwtPlugin } from '../plugins/jwt.js';
import jwt from 'jsonwebtoken';

test('JWT Plugin Tests', async (t) => {
  
  await t.test('requires secret or private key', async () => {
    const api = new Api();
    
    assert.throws(
      () => JwtPlugin.install(api, {}),
      /JWT configuration error: Either "secret" or "privateKey" must be provided/
    );
  });
  
  await t.test('generates valid JWT tokens', async () => {
    const api = new Api();
    const secret = 'test-secret-key';
    
    JwtPlugin.install(api, { secret });
    
    const payload = {
      userId: 123,
      email: 'test@example.com',
      roles: ['user']
    };
    
    const token = await api.generateToken(payload);
    
    assert.ok(token);
    assert.strictEqual(typeof token, 'string');
    
    // Verify token structure (should have 3 parts)
    const parts = token.split('.');
    assert.strictEqual(parts.length, 3);
    
    // Decode and verify
    const decoded = jwt.verify(token, secret);
    assert.strictEqual(decoded.userId, 123);
    assert.strictEqual(decoded.email, 'test@example.com');
    assert.deepStrictEqual(decoded.roles, ['user']);
    assert.ok(decoded.iat);
    assert.ok(decoded.exp);
  });
  
  await t.test('removes sensitive fields from payload', async () => {
    const api = new Api();
    const secret = 'test-secret-key';
    
    JwtPlugin.install(api, { secret });
    
    const payload = {
      userId: 123,
      password: 'secret123',
      salt: 'salt123',
      hash: 'hash123',
      email: 'test@example.com'
    };
    
    const token = await api.generateToken(payload);
    const decoded = jwt.verify(token, secret);
    
    assert.strictEqual(decoded.userId, 123);
    assert.strictEqual(decoded.email, 'test@example.com');
    assert.strictEqual(decoded.password, undefined);
    assert.strictEqual(decoded.salt, undefined);
    assert.strictEqual(decoded.hash, undefined);
  });
  
  await t.test('verifies valid tokens', async () => {
    const api = new Api();
    const secret = 'test-secret-key';
    
    JwtPlugin.install(api, { secret });
    
    const payload = { userId: 123, role: 'admin' };
    const token = await api.generateToken(payload);
    
    const verified = await api.verifyToken(token);
    
    assert.strictEqual(verified.userId, 123);
    assert.strictEqual(verified.role, 'admin');
  });
  
  await t.test('rejects expired tokens', async () => {
    const api = new Api();
    const secret = 'test-secret-key';
    
    JwtPlugin.install(api, { secret });
    
    // Manually create an expired token
    const expiredToken = jwt.sign(
      { userId: 123 },
      secret,
      { expiresIn: '-1h' } // Already expired
    );
    
    await assert.rejects(
      api.verifyToken(expiredToken),
      /Token expired/
    );
  });
  
  await t.test('rejects tampered tokens', async () => {
    const api = new Api();
    const secret = 'test-secret-key';
    
    JwtPlugin.install(api, { secret });
    
    const token = await api.generateToken({ userId: 123 });
    
    // Tamper with token
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    payload.userId = 999;  // Change user ID
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64');
    const tamperedToken = parts.join('.');
    
    await assert.rejects(
      api.verifyToken(tamperedToken),
      /Invalid token/
    );
  });
  
  await t.test('supports RS256 with key pair', async () => {
    const api = new Api();
    
    // Generate test key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    JwtPlugin.install(api, { privateKey, publicKey });
    
    const payload = { userId: 123 };
    const token = await api.generateToken(payload);
    
    // Verify with public key
    const verified = await api.verifyToken(token);
    assert.strictEqual(verified.userId, 123);
    
    // Should not be able to verify with wrong key
    const api2 = new Api();
    JwtPlugin.install(api2, { secret: 'wrong-key' });
    
    await assert.rejects(
      api2.verifyToken(token),
      /Invalid token/
    );
  });
  
  await t.test('generates and verifies refresh tokens', async () => {
    const api = new Api();
    const secret = 'test-secret-key';
    
    JwtPlugin.install(api, { secret });
    
    const userId = 123;
    const metadata = { deviceId: 'device-123' };
    
    const refreshToken = await api.generateRefreshToken(userId, metadata);
    
    assert.ok(refreshToken);
    assert.strictEqual(typeof refreshToken, 'string');
    assert.strictEqual(refreshToken.length, 64);  // 32 bytes = 64 hex chars
    
    // Use refresh token to get new access token
    const result = await api.refreshAccessToken(refreshToken);
    
    assert.ok(result.accessToken);
    assert.strictEqual(result.refreshToken, refreshToken);
    assert.strictEqual(result.expiresIn, '24h');
    
    // Verify the new access token
    const verified = await api.verifyToken(result.accessToken);
    assert.strictEqual(verified.userId, userId);
    assert.strictEqual(verified.deviceId, 'device-123');
  });
  
  await t.test('rejects invalid refresh tokens', async () => {
    const api = new Api();
    JwtPlugin.install(api, { secret: 'test-secret' });
    
    await assert.rejects(
      api.refreshAccessToken('invalid-token'),
      /Invalid refresh token/
    );
  });
  
  await t.test('revokes refresh tokens', async () => {
    const api = new Api();
    JwtPlugin.install(api, { secret: 'test-secret' });
    
    const refreshToken = await api.generateRefreshToken(123);
    
    // Should work before revocation
    await api.refreshAccessToken(refreshToken);
    
    // Revoke it
    await api.revokeRefreshToken(refreshToken);
    
    // Should fail after revocation
    await assert.rejects(
      api.refreshAccessToken(refreshToken),
      /Invalid refresh token/
    );
  });
  
  await t.test('supports legacy Base64 tokens during migration', async () => {
    const api = new Api();
    
    JwtPlugin.install(api, { 
      secret: 'test-secret',
      supportLegacyTokens: true
    });
    
    // Create a legacy token
    const legacyPayload = {
      userId: 123,
      exp: Date.now() + 86400000  // 24 hours
    };
    const legacyToken = Buffer.from(JSON.stringify(legacyPayload)).toString('base64');
    
    // Should be able to verify legacy token
    const verified = await api.verifyToken(legacyToken);
    assert.strictEqual(verified.userId, 123);
  });
  
  await t.test('rejects expired legacy tokens', async () => {
    const api = new Api();
    
    JwtPlugin.install(api, { 
      secret: 'test-secret',
      supportLegacyTokens: true
    });
    
    // Create an expired legacy token
    const legacyPayload = {
      userId: 123,
      exp: Date.now() - 1000  // Expired
    };
    const legacyToken = Buffer.from(JSON.stringify(legacyPayload)).toString('base64');
    
    await assert.rejects(
      api.verifyToken(legacyToken),
      /Token expired/
    );
  });
  
  await t.test('extracts token from Authorization header', async () => {
    const api = new Api();
    JwtPlugin.install(api, { secret: 'test-secret' });
    
    const token = await api.generateToken({ userId: 123 });
    
    const context = {
      options: {
        request: {
          headers: {
            authorization: `Bearer ${token}`
          }
        }
      }
    };
    
    // Simulate the hook
    await JwtPlugin.install(api, { secret: 'test-secret' });
    const hooks = api.hooks.get('beforeOperation') || [];
    for (const { handler } of hooks) {
      await handler(context);
    }
    
    assert.strictEqual(context.options.user.userId, 123);
    assert.strictEqual(context.options.authenticated, true);
    assert.strictEqual(context.options.authMethod, 'jwt');
  });
  
  await t.test('supports custom token headers', async () => {
    const api = new Api();
    JwtPlugin.install(api, { 
      secret: 'test-secret',
      tokenHeader: 'X-Auth-Token'
    });
    
    const token = await api.generateToken({ userId: 123 });
    
    const context = {
      options: {
        request: {
          headers: {
            'x-auth-token': token  // Note: lowercase
          }
        }
      }
    };
    
    // Re-install to trigger hook
    JwtPlugin.install(api, { 
      secret: 'test-secret',
      tokenHeader: 'X-Auth-Token'
    });
    
    const hooks = api.hooks.get('beforeOperation') || [];
    for (const { handler } of hooks) {
      await handler(context);
    }
    
    assert.strictEqual(context.options.user.userId, 123);
  });
  
  await t.test('supports beforeSign and afterVerify hooks', async () => {
    const api = new Api();
    let beforeSignCalled = false;
    let afterVerifyCalled = false;
    
    JwtPlugin.install(api, {
      secret: 'test-secret',
      beforeSign: async (payload, options) => {
        beforeSignCalled = true;
        payload.customField = 'added-in-hook';
      },
      afterVerify: async (decoded) => {
        afterVerifyCalled = true;
        assert.strictEqual(decoded.customField, 'added-in-hook');
      }
    });
    
    const token = await api.generateToken({ userId: 123 });
    assert.ok(beforeSignCalled);
    
    await api.verifyToken(token);
    assert.ok(afterVerifyCalled);
  });
  
  await t.test('decodes token without verification', async () => {
    const api = new Api();
    JwtPlugin.install(api, { secret: 'test-secret' });
    
    const token = await api.generateToken({ 
      userId: 123,
      email: 'test@example.com' 
    });
    
    const decoded = api.decodeToken(token);
    
    assert.ok(decoded);
    assert.ok(decoded.header);
    assert.ok(decoded.payload);
    assert.ok(decoded.signature);
    assert.strictEqual(decoded.payload.userId, 123);
    assert.strictEqual(decoded.payload.email, 'test@example.com');
  });
  
  await t.test('handles various error scenarios gracefully', async () => {
    const api = new Api();
    JwtPlugin.install(api, { secret: 'test-secret' });
    
    // No token
    await assert.rejects(
      api.verifyToken(null),
      /No token provided/
    );
    
    // Invalid format
    await assert.rejects(
      api.verifyToken('not-a-jwt'),
      /Invalid token/
    );
    
    // Wrong algorithm
    const wrongAlgoToken = jwt.sign({ userId: 123 }, 'test-secret', { algorithm: 'HS512' });
    await assert.rejects(
      api.verifyToken(wrongAlgoToken),
      /Invalid token/
    );
  });
  
  await t.test('sets auth error but does not throw on invalid token in hook', async () => {
    const api = new Api();
    JwtPlugin.install(api, { secret: 'test-secret' });
    
    const context = {
      options: {
        request: {
          headers: {
            authorization: 'Bearer invalid-token'
          }
        }
      }
    };
    
    // Re-install to get fresh hooks
    JwtPlugin.install(api, { secret: 'test-secret' });
    const hooks = api.hooks.get('beforeOperation') || [];
    
    // Should not throw
    await assert.doesNotReject(async () => {
      for (const { handler } of hooks) {
        await handler(context);
      }
    });
    
    // But should set error
    assert.ok(context.options.authError);
    assert.ok(context.options.authError.includes('Invalid token'));
    assert.strictEqual(context.options.authenticated, undefined);
  });
  
});

// Import crypto for key generation test
import crypto from 'crypto';