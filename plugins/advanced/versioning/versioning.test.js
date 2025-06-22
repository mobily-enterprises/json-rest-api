import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api } from '../../../lib/api.js';
import { Schema } from '../../../lib/schema.js';
import { MemoryPlugin } from '../../memory.js';
import { VersioningPlugin } from './index.js';
import { HTTPPlugin } from '../../http.js';
import express from 'express';
import request from 'supertest';

describe('VersioningPlugin', () => {
  let api, app, server;

  beforeEach(async () => {
    api = new Api();
    app = express();
    
    api.use(MemoryPlugin);
    api.use(HTTPPlugin, { app });
  });

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Header-based Versioning', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        header: 'x-api-version',
        defaultVersion: '1',
        versions: {
          '1': { stable: true },
          '2': { stable: true },
          '3': { experimental: true }
        }
      });

      // Add versioned resources
      api.addVersionedResource('users', {
        '1': {
          schema: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true }
          }
        },
        '2': {
          schema: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true },
            username: { type: 'string', required: true } // New in v2
          }
        }
      });

      server = app.listen(0);
    });

    it('should use default version when no header provided', async () => {
      const res = await request(app)
        .get('/api/users')
        .expect(200);

      assert.equal(res.headers['x-api-version'], '1');
    });

    it('should use version from header', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('x-api-version', '2')
        .expect(200);

      assert.equal(res.headers['x-api-version'], '2');
    });

    it('should handle different schemas per version', async () => {
      // Create user in v2 (requires username)
      const createRes = await request(app)
        .post('/api/users')
        .set('x-api-version', '2')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          username: 'johndoe'
        })
        .expect(201);

      const userId = createRes.body.data.id;

      // Get user in v1 (no username field)
      const v1Res = await request(app)
        .get(`/api/users/${userId}`)
        .set('x-api-version', '1')
        .expect(200);

      assert.equal(v1Res.body.name, 'John Doe');
      assert.equal(v1Res.body.username, undefined); // Not in v1 schema

      // Get user in v2 (has username field)
      const v2Res = await request(app)
        .get(`/api/users/${userId}`)
        .set('x-api-version', '2')
        .expect(200);

      assert.equal(v2Res.body.username, 'johndoe');
    });

    it('should fail validation for v2 without required fields', async () => {
      await request(app)
        .post('/api/users')
        .set('x-api-version', '2')
        .send({
          name: 'John Doe',
          email: 'john@example.com'
          // Missing required username
        })
        .expect(400);
    });
  });

  describe('Path-based Versioning', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'path',
        defaultVersion: '1'
      });

      api.addResource('posts', new Schema({
        title: { type: 'string', required: true },
        content: { type: 'string' }
      }));

      server = app.listen(0);
    });

    it('should extract version from path', async () => {
      // Mock path versioning by setting up route
      app.get('/api/v2/test', (req, res) => {
        req.path = '/api/v2/test'; // Ensure path is set
        const version = api.versioning.extractVersion(req);
        res.json({ version });
      });

      const res = await request(app)
        .get('/api/v2/test')
        .expect(200);

      assert.equal(res.body.version, '2');
    });
  });

  describe('Query Parameter Versioning', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'query',
        queryParam: 'version',
        defaultVersion: '1.0'
      });

      api.addResource('products', new Schema({
        name: { type: 'string', required: true },
        price: { type: 'number', required: true }
      }));

      server = app.listen(0);
    });

    it('should extract version from query parameter', async () => {
      await request(app)
        .post('/api/products?version=1.0')
        .send({
          name: 'Widget',
          price: 9.99
        })
        .expect(201);
    });

    it('should use default version when query param missing', async () => {
      const res = await request(app)
        .get('/api/products')
        .expect(200);

      assert.equal(res.headers['x-api-version'], '1.0');
    });
  });

  describe('Accept Header Versioning', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'accept',
        defaultVersion: '1'
      });

      api.addResource('orders', new Schema({
        total: { type: 'number', required: true }
      }));

      server = app.listen(0);
    });

    it('should extract version from Accept header', async () => {
      // Test version extraction
      const req = {
        headers: {
          accept: 'application/vnd.myapi.v2+json'
        }
      };

      const version = api.versioning.extractVersion(req);
      assert.equal(version, '2');
    });
  });

  describe('Version Deprecation', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        defaultVersion: '2',
        deprecationWarnings: true
      });

      // Deprecate version 1
      api.deprecateVersion('1', {
        date: '2024-01-01',
        sunset: '2024-06-01',
        message: 'Version 1 is deprecated, please use version 2',
        successor: '2'
      });

      api.addResource('items', new Schema({
        name: { type: 'string' }
      }));

      server = app.listen(0);
    });

    it('should add deprecation headers for deprecated versions', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('x-api-version', '1')
        .expect(200);

      assert.equal(res.headers['x-api-deprecated'], 'true');
      assert.equal(res.headers['x-api-deprecation-date'], '2024-01-01');
      assert.equal(res.headers['x-api-sunset-date'], '2024-06-01');
      assert.equal(res.headers['x-api-successor-version'], '2');
    });

    it('should not add deprecation headers for current versions', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('x-api-version', '2')
        .expect(200);

      assert.equal(res.headers['x-api-deprecated'], undefined);
    });
  });

  describe('Version Discovery', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        defaultVersion: '2',
        versions: {
          '1': { stable: true },
          '2': { stable: true },
          '3': { experimental: true }
        }
      });

      api.deprecateVersion('1', {
        successor: '2'
      });

      api.addVersionedResource('books', {
        '1': { schema: { title: { type: 'string' } } },
        '2': { schema: { title: { type: 'string' }, isbn: { type: 'string' } } },
        '3': { schema: { title: { type: 'string' }, isbn: { type: 'string' }, rating: { type: 'number' } } }
      });

      server = app.listen(0);
    });

    it('should provide version discovery endpoint', async () => {
      const res = await request(app)
        .get('/api/versions')
        .expect(200);

      assert.equal(res.body.current, '2');
      assert.deepEqual(res.body.available, ['1', '2', '3']);
      assert.equal(res.body.deprecated.length, 1);
      assert.equal(res.body.deprecated[0].version, '1');
      assert.deepEqual(res.body.experimental, ['3']);
      assert.deepEqual(res.body.stable, ['2']);
    });

    it('should show feature availability per version', async () => {
      const res = await request(app)
        .get('/api/versions')
        .expect(200);

      assert.ok(res.body.features.books);
      assert.deepEqual(res.body.features.books.availableIn, ['1', '2', '3']);
    });
  });

  describe('Schema Versioning', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        defaultVersion: '1'
      });

      // Add resource with field-level versioning
      api.addResource('accounts', new Schema({
        id: { type: 'id', auto: true },
        email: { type: 'string', required: true },
        password: { 
          type: 'string', 
          required: true,
          _versions: {
            '1': { silent: true }, // Hidden in v1
            '2': { silent: false } // Visible in v2
          }
        },
        profile: {
          type: 'object',
          _versions: {
            '1': null, // Doesn't exist in v1
            '2': { required: false }
          }
        }
      }));

      server = app.listen(0);
    });

    it('should handle field-level versioning', async () => {
      // Create account
      const createRes = await request(app)
        .post('/api/accounts')
        .set('x-api-version', '2')
        .send({
          email: 'test@example.com',
          password: 'secret123',
          profile: { bio: 'Test user' }
        })
        .expect(201);

      const accountId = createRes.body.data.id;

      // Get in v1 - password hidden, no profile
      const v1Res = await request(app)
        .get(`/api/accounts/${accountId}`)
        .set('x-api-version', '1')
        .expect(200);

      assert.equal(v1Res.body.email, 'test@example.com');
      assert.equal(v1Res.body.password, undefined); // Silent in v1
      assert.equal(v1Res.body.profile, undefined); // Doesn't exist in v1

      // Get in v2 - all fields visible
      const v2Res = await request(app)
        .get(`/api/accounts/${accountId}`)
        .set('x-api-version', '2')
        .expect(200);

      assert.equal(v2Res.body.password, 'secret123'); // Visible in v2
      assert.deepEqual(v2Res.body.profile, { bio: 'Test user' });
    });
  });

  describe('Version Transforms', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        defaultVersion: '2'
      });

      // Add transform from v1 to v2
      api.addVersionTransform('1', '2', (data, direction) => {
        if (direction === 'request') {
          // Transform v1 request to v2 format
          if (data.fullName) {
            const [firstName, ...lastParts] = data.fullName.split(' ');
            data.firstName = firstName;
            data.lastName = lastParts.join(' ');
            delete data.fullName;
          }
        } else {
          // Transform v2 response to v1 format
          if (data.firstName || data.lastName) {
            data.fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
            delete data.firstName;
            delete data.lastName;
          }
        }
        return data;
      });

      api.addResource('contacts', new Schema({
        firstName: { type: 'string' },
        lastName: { type: 'string' }
      }));

      server = app.listen(0);
    });

    it('should transform requests between versions', async () => {
      // Create contact using v1 format
      const createRes = await request(app)
        .post('/api/contacts')
        .set('x-api-version', '1')
        .send({
          fullName: 'John Smith'
        })
        .expect(201);

      // Response should be in v1 format
      assert.equal(createRes.body.fullName, 'John Smith');
      assert.equal(createRes.body.firstName, undefined);
      assert.equal(createRes.body.lastName, undefined);

      // Get using v2 should show split names
      const v2Res = await request(app)
        .get(`/api/contacts/${createRes.body.id}`)
        .set('x-api-version', '2')
        .expect(200);

      assert.equal(v2Res.body.firstName, 'John');
      assert.equal(v2Res.body.lastName, 'Smith');
      assert.equal(v2Res.body.fullName, undefined);
    });
  });

  describe('Strict Mode', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        defaultVersion: '1',
        strict: true,
        versions: {
          '1': {},
          '2': {}
        }
      });

      // Only add resource for v2
      api.addVersionedResource('features', {
        '2': {
          schema: {
            name: { type: 'string' }
          }
        }
      });

      server = app.listen(0);
    });

    it('should return 404 with available versions in strict mode', async () => {
      const res = await request(app)
        .get('/api/features')
        .set('x-api-version', '1')
        .expect(404);

      assert.ok(res.body.error.includes('not available in version 1'));
      assert.ok(res.body.availableVersions);
      assert.ok(res.body.availableVersions.includes('2'));
    });
  });

  describe('Custom Version Extractor', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        defaultVersion: '1.0',
        versionExtractor: (request) => {
          // Custom logic: check multiple sources
          return request.headers['api-version'] || 
                 request.query?.v || 
                 request.headers['x-custom-version'] ||
                 null;
        }
      });

      api.addResource('data', new Schema({
        value: { type: 'string' }
      }));

      server = app.listen(0);
    });

    it('should use custom version extractor', async () => {
      const res1 = await request(app)
        .get('/api/data')
        .set('api-version', '2.0')
        .expect(200);

      assert.equal(res1.headers['x-api-version'], '2.0');

      const res2 = await request(app)
        .get('/api/data?v=3.0')
        .expect(200);

      assert.equal(res2.headers['x-api-version'], '3.0');

      const res3 = await request(app)
        .get('/api/data')
        .set('x-custom-version', '4.0')
        .expect(200);

      assert.equal(res3.headers['x-api-version'], '4.0');
    });
  });

  describe('Version-specific Migrations', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        defaultVersion: '2'
      });

      api.addVersionedResource('migrations', {
        '1': {
          schema: {
            status: { type: 'boolean' } // true/false
          }
        },
        '2': {
          schema: {
            status: { type: 'string' } // 'active'/'inactive'
          },
          migrateFrom: '1',
          migration: (data) => {
            // Migrate boolean to string
            if (typeof data.status === 'boolean') {
              data.status = data.status ? 'active' : 'inactive';
            }
            return data;
          }
        }
      });

      server = app.listen(0);
    });

    it('should handle data migration between versions', async () => {
      // Create in v1 format
      const createRes = await request(app)
        .post('/api/migrations')
        .set('x-api-version', '1')
        .send({
          status: true
        })
        .expect(201);

      assert.equal(createRes.body.status, true);

      // Get in v2 format - should be migrated
      const v2Res = await request(app)
        .get(`/api/migrations/${createRes.body.id}`)
        .set('x-api-version', '2')
        .expect(200);

      assert.equal(v2Res.body.status, 'active');
    });
  });

  describe('OpenAPI Generation per Version', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        defaultVersion: '1',
        versions: {
          '1': { stable: true },
          '2': { stable: true }
        }
      });

      // Mock OpenAPI generation
      api.generateOpenAPI = (version) => ({
        openapi: '3.0.0',
        info: {
          title: 'Test API',
          version: version
        },
        paths: {}
      });

      server = app.listen(0);
    });

    it('should generate version-specific OpenAPI', async () => {
      const res = await request(app)
        .get('/api/versions/2/openapi')
        .expect(200);

      assert.equal(res.body.info.version, '2');
    });

    it('should return 404 for invalid version OpenAPI', async () => {
      await request(app)
        .get('/api/versions/99/openapi')
        .expect(404);
    });
  });

  describe('Complex Version Scenarios', () => {
    beforeEach(async () => {
      api.use(VersioningPlugin, {
        type: 'header',
        defaultVersion: '2'
      });

      // Simulate a real-world API evolution
      api.addVersionedResource('customers', {
        '1': {
          schema: {
            name: { type: 'string', required: true },
            phone: { type: 'string' }
          }
        },
        '2': {
          schema: {
            firstName: { type: 'string', required: true },
            lastName: { type: 'string', required: true },
            phone: { type: 'string' },
            mobile: { type: 'string' } // New field
          }
        },
        '3': {
          schema: {
            firstName: { type: 'string', required: true },
            lastName: { type: 'string', required: true },
            contacts: { // Nested structure
              type: 'object',
              properties: {
                phone: { type: 'string' },
                mobile: { type: 'string' },
                email: { type: 'string' }
              }
            }
          }
        }
      });

      server = app.listen(0);
    });

    it('should handle complex schema evolution', async () => {
      // Create in v1
      const v1Create = await request(app)
        .post('/api/customers')
        .set('x-api-version', '1')
        .send({
          name: 'John Doe',
          phone: '+1234567890'
        })
        .expect(201);

      const customerId = v1Create.body.data.id;

      // Update in v2
      await request(app)
        .put(`/api/customers/${customerId}`)
        .set('x-api-version', '2')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          mobile: '+0987654321'
        })
        .expect(200);

      // Get in v3 - should see nested structure
      const v3Res = await request(app)
        .get(`/api/customers/${customerId}`)
        .set('x-api-version', '3')
        .expect(200);

      // Data should be accessible even though schema structure changed
      assert.equal(v3Res.body.firstName, 'John');
      assert.equal(v3Res.body.lastName, 'Doe');
    });
  });
});