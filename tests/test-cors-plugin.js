import { test } from 'node:test';
import assert from 'node:assert';
import { Api } from '../index.js';
import { CorsPlugin } from '../plugins/cors.js';

// Mock request/response objects
function createMockReq(origin, method = 'GET') {
  return {
    headers: { origin },
    method,
    url: '/api/test'
  };
}

function createMockRes() {
  const headers = {};
  return {
    headers,
    setHeader: (key, value) => { headers[key] = value; },
    getHeader: (key) => headers[key],
    status: () => ({ end: () => {} })
  };
}

test('CORS Plugin Tests', async (t) => {
  
  await t.test('zero config works in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    try {
      const api = new Api();
      const plugin = CorsPlugin;
      
      // Apply plugin with no options
      plugin.install(api, {});
      
      const req = createMockReq('http://localhost:3000');
      const res = createMockRes();
      
      await plugin.applyCors(req, res, plugin.getCorsConfig({}));
      
      assert.strictEqual(res.headers['Access-Control-Allow-Origin'], 'http://localhost:3000');
      assert.strictEqual(res.headers['Access-Control-Allow-Credentials'], 'true');
      assert.ok(res.headers['Access-Control-Allow-Methods'].includes('GET'));
      assert.ok(res.headers['Access-Control-Allow-Headers'].includes('Content-Type'));
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
  
  await t.test('allows various localhost patterns in development', async () => {
    const plugin = CorsPlugin;
    const config = plugin.getCorsConfig({});
    
    const testOrigins = [
      'http://localhost:3000',
      'http://localhost:4200',
      'http://127.0.0.1:3000',
      'http://192.168.1.100:3000',
      'http://10.0.0.5:8080',
      'http://myapp.local:3000',
      'http://test.dev:5000',
      'https://myapp.ngrok.io',
      'capacitor://localhost',
      'ionic://localhost'
    ];
    
    for (const origin of testOrigins) {
      const req = createMockReq(origin);
      const res = createMockRes();
      
      await plugin.applyCors(req, res, config);
      
      assert.strictEqual(
        res.headers['Access-Control-Allow-Origin'], 
        origin,
        `Should allow ${origin}`
      );
    }
  });
  
  await t.test('blocks origins not matching patterns', async () => {
    const plugin = CorsPlugin;
    const config = plugin.getCorsConfig({});
    
    const blockedOrigins = [
      'http://evil.com',
      'https://malicious.site',
      'http://192.168.1.100.evil.com',
      'http://localhost.evil.com:3000'
    ];
    
    for (const origin of blockedOrigins) {
      const req = createMockReq(origin);
      const res = createMockRes();
      
      await plugin.applyCors(req, res, config);
      
      assert.strictEqual(
        res.headers['Access-Control-Allow-Origin'], 
        undefined,
        `Should block ${origin}`
      );
    }
  });
  
  await t.test('detects and configures for Vercel', async () => {
    const originalEnv = { ...process.env };
    
    try {
      process.env.VERCEL = '1';
      process.env.VERCEL_URL = 'my-app-git-abc123.vercel.app';
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'my-app.vercel.app';
      
      const plugin = CorsPlugin;
      const config = plugin.getCorsConfig({});
      
      assert.ok(Array.isArray(config.origin));
      assert.ok(config.origin.includes('https://my-app-git-abc123.vercel.app'));
      assert.ok(config.origin.includes('https://my-app.vercel.app'));
    } finally {
      Object.keys(process.env).forEach(key => {
        if (!(key in originalEnv)) delete process.env[key];
      });
      Object.assign(process.env, originalEnv);
    }
  });
  
  await t.test('detects and configures for Netlify', async () => {
    const originalEnv = { ...process.env };
    
    try {
      process.env.NETLIFY = 'true';
      process.env.URL = 'https://my-app.netlify.app';
      process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-123--my-app.netlify.app';
      
      const plugin = CorsPlugin;
      const config = plugin.getCorsConfig({});
      
      assert.ok(Array.isArray(config.origin));
      assert.ok(config.origin.includes('https://my-app.netlify.app'));
      assert.ok(config.origin.includes('https://deploy-preview-123--my-app.netlify.app'));
    } finally {
      Object.keys(process.env).forEach(key => {
        if (!(key in originalEnv)) delete process.env[key];
      });
      Object.assign(process.env, originalEnv);
    }
  });
  
  await t.test('uses environment variables for CORS origins', async () => {
    const originalEnv = process.env.CORS_ORIGINS;
    
    try {
      process.env.CORS_ORIGINS = 'https://app.example.com,https://www.example.com';
      
      const plugin = CorsPlugin;
      const config = plugin.getCorsConfig({});
      
      assert.deepStrictEqual(config.origin, [
        'https://app.example.com',
        'https://www.example.com'
      ]);
    } finally {
      if (originalEnv !== undefined) {
        process.env.CORS_ORIGINS = originalEnv;
      } else {
        delete process.env.CORS_ORIGINS;
      }
    }
  });
  
  await t.test('prevents credentials with wildcard origin', async () => {
    const api = new Api();
    const plugin = CorsPlugin;
    
    // Should auto-disable credentials
    plugin.install(api, {
      cors: {
        origin: '*',
        credentials: true  // This should be forced to false
      }
    });
    
    const config = plugin.getCorsConfig({
      cors: { origin: '*', credentials: true }
    });
    
    assert.strictEqual(config.credentials, false);
  });
  
  await t.test('supports dynamic origin function', async () => {
    const allowedOrigins = new Set([
      'https://app.example.com',
      'https://trusted.example.com'
    ]);
    
    const api = new Api();
    const plugin = CorsPlugin;
    
    const dynamicConfig = {
      cors: (origin, callback) => {
        callback(null, allowedOrigins.has(origin));
      }
    };
    
    plugin.install(api, dynamicConfig);
    const config = plugin.getCorsConfig(dynamicConfig);
    
    // Test allowed origin
    const req1 = createMockReq('https://app.example.com');
    const res1 = createMockRes();
    await plugin.applyCors(req1, res1, config);
    assert.strictEqual(res1.headers['Access-Control-Allow-Origin'], 'https://app.example.com');
    
    // Test blocked origin
    const req2 = createMockReq('https://evil.example.com');
    const res2 = createMockRes();
    await plugin.applyCors(req2, res2, config);
    assert.strictEqual(res2.headers['Access-Control-Allow-Origin'], undefined);
  });
  
  await t.test('supports regex patterns', async () => {
    const api = new Api();
    const plugin = CorsPlugin;
    
    plugin.install(api, {
      cors: {
        origin: /^https:\/\/[a-z]+\.example\.com$/
      }
    });
    
    const config = plugin.getCorsConfig({
      cors: { origin: /^https:\/\/[a-z]+\.example\.com$/ }
    });
    
    // Should match
    const req1 = createMockReq('https://app.example.com');
    const res1 = createMockRes();
    await plugin.applyCors(req1, res1, config);
    assert.strictEqual(res1.headers['Access-Control-Allow-Origin'], 'https://app.example.com');
    
    // Should not match
    const req2 = createMockReq('https://app123.example.com');
    const res2 = createMockRes();
    await plugin.applyCors(req2, res2, config);
    assert.strictEqual(res2.headers['Access-Control-Allow-Origin'], undefined);
  });
  
  await t.test('handles preflight requests', async () => {
    const api = new Api();
    api.router = {
      use: (middleware) => {
        // Test preflight handling
        const req = createMockReq('http://localhost:3000', 'OPTIONS');
        const res = createMockRes();
        let nextCalled = false;
        
        middleware(req, res, () => { nextCalled = true; });
        
        // Preflight should not call next
        assert.strictEqual(nextCalled, false);
      }
    };
    
    CorsPlugin.install(api, {});
  });
  
  await t.test('adds Vary header for caching', async () => {
    const plugin = CorsPlugin;
    const config = plugin.getCorsConfig({});
    
    const req = createMockReq('http://localhost:3000');
    const res = createMockRes();
    
    await plugin.applyCors(req, res, config);
    
    assert.strictEqual(res.headers['Vary'], 'Origin');
    
    // Test with existing Vary header
    const res2 = createMockRes();
    res2.setHeader('Vary', 'Accept-Encoding');
    
    await plugin.applyCors(req, res2, config);
    
    assert.strictEqual(res2.headers['Vary'], 'Accept-Encoding, Origin');
  });
  
  await t.test('respects explicit configuration over auto-detection', async () => {
    const originalEnv = { ...process.env };
    
    try {
      // Set platform env vars
      process.env.VERCEL = '1';
      process.env.VERCEL_URL = 'auto-detected.vercel.app';
      
      const plugin = CorsPlugin;
      
      // Explicit config should win
      const config = plugin.getCorsConfig({
        cors: {
          origin: 'https://explicit.example.com'
        }
      });
      
      assert.strictEqual(config.origin, 'https://explicit.example.com');
    } finally {
      Object.keys(process.env).forEach(key => {
        if (!(key in originalEnv)) delete process.env[key];
      });
      Object.assign(process.env, originalEnv);
    }
  });
  
  await t.test('handles production mode without configuration gracefully', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalCorsOrigins = process.env.CORS_ORIGINS;
    
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.CORS_ORIGINS;
      
      const plugin = CorsPlugin;
      const config = plugin.getCorsConfig({});
      
      // Should deny all cross-origin requests
      assert.strictEqual(config.origin, false);
      assert.strictEqual(config.credentials, false);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalCorsOrigins !== undefined) {
        process.env.CORS_ORIGINS = originalCorsOrigins;
      }
    }
  });
  
  await t.test('configures all standard CORS headers', async () => {
    const plugin = CorsPlugin;
    const config = plugin.getCorsConfig({
      cors: {
        origin: 'https://example.com',
        maxAge: 7200
      }
    });
    
    const req = createMockReq('https://example.com');
    const res = createMockRes();
    
    await plugin.applyCors(req, res, config);
    
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], 'https://example.com');
    assert.strictEqual(res.headers['Access-Control-Allow-Credentials'], 'true');
    assert.strictEqual(res.headers['Access-Control-Allow-Methods'], 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    assert.strictEqual(res.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization, X-Requested-With');
    assert.strictEqual(res.headers['Access-Control-Expose-Headers'], 'X-Total-Count, Link, X-Request-ID');
    assert.strictEqual(res.headers['Access-Control-Max-Age'], '7200');
  });
  
});