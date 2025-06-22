import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { Api, Schema, ValidationPlugin } from '../index.js';
import { GRPCPlugin } from '../plugins/grpc/index.js';
import { setupTestApi, robustTeardown } from './lib/test-db-helper.js';
import fs from 'fs/promises';
import path from 'path';

describe('gRPC Plugin Tests', () => {
  let api;
  let grpcClient;
  const protoPath = './test-protos';
  const port = 50051;

  beforeEach(async () => {
    api = await setupTestApi();
    api.use(ValidationPlugin);
    
    // Clean up proto directory
    try {
      await fs.rm(protoPath, { recursive: true });
    } catch (e) {
      // Directory might not exist
    }
    
    await api.connect();
  });

  afterEach(async () => {
    if (api.grpc && api.grpc.server) {
      await api.grpc.stop();
    }
    
    await robustTeardown({ api });
    
    // Clean up proto directory
    try {
      await fs.rm(protoPath, { recursive: true });
    } catch (e) {
      // Ignore
    }
  });

  describe('Basic gRPC Setup', () => {
    it('should install plugin and generate protos', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      assert(api.grpc);
      assert(typeof api.grpc.generateProto === 'function');
      assert(typeof api.grpc.start === 'function');
    });

    it('should generate proto files for resources', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('users', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean' }
      }));

      const proto = await api.grpc.generateProto('users', api.schemas.get('users'));
      
      assert(proto.content.includes('message Users'));
      assert(proto.content.includes('string name'));
      assert(proto.content.includes('string email'));
      assert(proto.content.includes('double age'));
      assert(proto.content.includes('bool active'));
      
      // Check file was written
      const fileContent = await fs.readFile(proto.filePath, 'utf8');
      assert(fileContent.includes('message Users'));
    });

    it('should generate service proto with all resources', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('posts', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true },
        content: { type: 'string' }
      }));

      api.addResource('comments', new Schema({
        id: { type: 'id' },
        text: { type: 'string', required: true },
        postId: { type: 'id' }
      }));

      const protos = await api.grpc.generateAllProtos();
      
      // Should have individual protos plus service proto
      assert(protos.length === 3);
      
      const serviceProto = protos.find(p => p.fileName === 'service.proto');
      assert(serviceProto);
      assert(serviceProto.content.includes('service ApiService'));
      assert(serviceProto.content.includes('rpc GetPosts'));
      assert(serviceProto.content.includes('rpc CreateComments'));
    });

    it('should start gRPC server', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('items', new Schema({
        id: { type: 'id' },
        name: { type: 'string' }
      }));

      const boundPort = await api.grpc.start();
      assert.equal(boundPort, port);
      assert(api.grpc.server);
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('products', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        price: { type: 'number' },
        inStock: { type: 'boolean', default: true }
      }));

      await api.grpc.start();
      
      // Create client
      grpcClient = api.grpc.createClient('ApiService');
    });

    it('should create resource via gRPC', async () => {
      const response = await new Promise((resolve, reject) => {
        grpcClient.CreateProducts({
          data: {
            name: 'Test Product',
            price: 99.99,
            in_stock: true
          }
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert(response.id);
      assert.equal(response.name, 'Test Product');
      assert.equal(response.price, 99.99);
      assert.equal(response.in_stock, true);
    });

    it('should get resource via gRPC', async () => {
      // Create via API first
      const created = await api.resources.products.create({
        name: 'Get Test',
        price: 50
      });

      const response = await new Promise((resolve, reject) => {
        grpcClient.GetProducts({
          id: created.data.id
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert.equal(response.id, created.data.id);
      assert.equal(response.name, 'Get Test');
      assert.equal(response.price, 50);
    });

    it('should update resource via gRPC', async () => {
      const created = await api.resources.products.create({
        name: 'Update Test',
        price: 100
      });

      const response = await new Promise((resolve, reject) => {
        grpcClient.UpdateProducts({
          id: created.data.id,
          data: {
            name: 'Updated Product',
            price: 150
          }
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert.equal(response.name, 'Updated Product');
      assert.equal(response.price, 150);
    });

    it('should delete resource via gRPC', async () => {
      const created = await api.resources.products.create({
        name: 'Delete Test'
      });

      const response = await new Promise((resolve, reject) => {
        grpcClient.DeleteProducts({
          id: created.data.id
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert.equal(response.success, true);
      assert(response.message.includes('deleted'));

      // Verify deletion
      const checkResult = await api.resources.products.get(created.data.id, {
        allowNotFound: true
      });
      assert.equal(checkResult.data, null);
    });

    it('should query resources via gRPC', async () => {
      // Create test data
      await api.resources.products.create({ name: 'Product 1', price: 10 });
      await api.resources.products.create({ name: 'Product 2', price: 20 });
      await api.resources.products.create({ name: 'Product 3', price: 30 });

      const response = await new Promise((resolve, reject) => {
        grpcClient.QueryProducts({
          sort: 'price',
          page: 1,
          page_size: 2
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert.equal(response.items.length, 2);
      assert.equal(response.total, 3);
      assert.equal(response.page, 1);
      assert.equal(response.page_size, 2);
      assert.equal(response.items[0].price, 10);
      assert.equal(response.items[1].price, 20);
    });

    it('should handle validation errors', async () => {
      const error = await new Promise((resolve) => {
        grpcClient.CreateProducts({
          data: {
            price: 50 // Missing required name
          }
        }, (error) => {
          resolve(error);
        });
      });

      assert(error);
      assert.equal(error.code, grpc.status.INVALID_ARGUMENT);
      assert(error.message.includes('Validation'));
    });

    it('should handle not found errors', async () => {
      const error = await new Promise((resolve) => {
        grpcClient.GetProducts({
          id: 'non-existent'
        }, (error) => {
          resolve(error);
        });
      });

      assert(error);
      assert.equal(error.code, grpc.status.NOT_FOUND);
    });
  });

  describe('Streaming Operations', () => {
    beforeEach(async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('events', new Schema({
        id: { type: 'id' },
        type: { type: 'string', required: true },
        data: { type: 'object' }
      }));

      await api.grpc.start();
      grpcClient = api.grpc.createClient('ApiService');
    });

    it('should stream query results', async () => {
      // Create test data
      for (let i = 1; i <= 5; i++) {
        await api.resources.events.create({
          type: 'test',
          data: { index: i }
        });
      }

      const items = [];
      const stream = grpcClient.StreamEvents({ filter: { type: 'test' } });

      await new Promise((resolve, reject) => {
        stream.on('data', (item) => {
          items.push(item);
        });

        stream.on('end', () => {
          resolve();
        });

        stream.on('error', reject);
      });

      assert.equal(items.length, 5);
      assert(items.every(item => item.type === 'test'));
    });

    it('should handle client streaming for batch create', async () => {
      const stream = grpcClient.StreamCreateEvents((error, response) => {
        if (error) {
          assert.fail(error.message);
        } else {
          assert.equal(response.items.length, 3);
          assert.equal(response.total, 3);
        }
      });

      // Send items
      for (let i = 1; i <= 3; i++) {
        stream.write({
          data: {
            type: `event-${i}`,
            data: { index: i }
          }
        });
      }

      stream.end();
    });
  });

  describe('Type Mapping', () => {
    beforeEach(async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('complex', new Schema({
        id: { type: 'id' },
        name: { type: 'string' },
        count: { type: 'integer' },
        price: { type: 'number' },
        active: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
        createdAt: { type: 'timestamp' }
      }));

      await api.grpc.start();
      grpcClient = api.grpc.createClient('ApiService');
    });

    it('should handle all field types', async () => {
      const now = new Date();
      
      const response = await new Promise((resolve, reject) => {
        grpcClient.CreateComplex({
          data: {
            name: 'Complex Item',
            count: 42,
            price: 123.45,
            active: true,
            tags: ['tag1', 'tag2'],
            metadata: {
              fields: {
                key1: { string_value: 'value1' },
                key2: { number_value: 100 }
              }
            },
            created_at: {
              seconds: Math.floor(now.getTime() / 1000),
              nanos: (now.getTime() % 1000) * 1000000
            }
          }
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert.equal(response.name, 'Complex Item');
      assert.equal(response.count, 42);
      assert.equal(response.price, 123.45);
      assert.equal(response.active, true);
      assert.deepEqual(response.tags, ['tag1', 'tag2']);
      assert(response.metadata);
      assert(response.created_at);
    });

    it('should handle arrays correctly', async () => {
      api.addResource('arrays', new Schema({
        id: { type: 'id' },
        strings: { type: 'array', items: { type: 'string' } },
        numbers: { type: 'array', items: { type: 'number' } },
        mixed: { type: 'array' }
      }));

      await api.grpc.generateProto('arrays', api.schemas.get('arrays'));
      
      // Verify proto contains repeated fields
      const protoPath = path.join('./test-protos', 'arrays.proto');
      const content = await fs.readFile(protoPath, 'utf8');
      
      assert(content.includes('repeated string strings'));
      assert(content.includes('repeated double numbers'));
      assert(content.includes('repeated google.protobuf.Value mixed'));
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('items', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        value: { type: 'number', min: 0 }
      }));

      await api.grpc.start();
      grpcClient = api.grpc.createClient('ApiService');
    });

    it('should map validation errors correctly', async () => {
      const error = await new Promise((resolve) => {
        grpcClient.CreateItems({
          data: {
            value: -10 // Violates min constraint
          }
        }, (error) => {
          resolve(error);
        });
      });

      assert(error);
      assert.equal(error.code, grpc.status.INVALID_ARGUMENT);
      assert(error.details || error.message.includes('Validation'));
    });

    it('should handle internal errors', async () => {
      // Force an internal error by breaking something
      api.resources.items = null;

      const error = await new Promise((resolve) => {
        grpcClient.GetItems({ id: 'test' }, (error) => {
          resolve(error);
        });
      });

      assert(error);
      assert.equal(error.code, grpc.status.INTERNAL);
    });
  });

  describe('Advanced Features', () => {
    it('should support strict type mode', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false,
        strictTypes: true
      });

      api.addResource('strict', new Schema({
        id: { type: 'id' },
        name: { type: 'string' },
        data: { type: 'object' } // This should cause issues in strict mode
      }));

      const proto = await api.grpc.generateProto('strict', api.schemas.get('strict'));
      
      // In strict mode, unsupported types might be omitted or handled differently
      assert(proto.content);
    });

    it('should handle relationships', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('authors', new Schema({
        id: { type: 'id' },
        name: { type: 'string' }
      }));

      api.addResource('books', new Schema({
        id: { type: 'id' },
        title: { type: 'string' },
        authorId: {
          type: 'id',
          refs: { resource: 'authors' }
        }
      }));

      await api.grpc.start();
      grpcClient = api.grpc.createClient('ApiService');

      const author = await api.resources.authors.create({ name: 'Test Author' });
      
      const response = await new Promise((resolve, reject) => {
        grpcClient.CreateBooks({
          data: {
            title: 'Test Book',
            author_id: author.data.id
          }
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert.equal(response.title, 'Test Book');
      assert.equal(response.author_id, author.data.id);
    });

    it('should support batch operations', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('batch', new Schema({
        id: { type: 'id' },
        name: { type: 'string' }
      }));

      await api.grpc.start();
      grpcClient = api.grpc.createClient('ApiService');

      const response = await new Promise((resolve, reject) => {
        grpcClient.BatchCreateBatch({
          items: [
            { name: 'Item 1' },
            { name: 'Item 2' },
            { name: 'Item 3' }
          ]
        }, (error, response) => {
          if (error) reject(error);
          else resolve(response);
        });
      });

      assert.equal(response.items.length, 3);
      assert.equal(response.total, 3);
      assert(response.items.every(item => item.id));
    });
  });

  describe('Proto Generation Edge Cases', () => {
    it('should handle field name conversions', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false
      });

      api.addResource('naming', new Schema({
        id: { type: 'id' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        isActive: { type: 'boolean' },
        createdAt: { type: 'timestamp' }
      }));

      const proto = await api.grpc.generateProto('naming', api.schemas.get('naming'));
      
      // Should convert to snake_case
      assert(proto.content.includes('string first_name'));
      assert(proto.content.includes('string last_name'));
      assert(proto.content.includes('bool is_active'));
      assert(proto.content.includes('google.protobuf.Timestamp created_at'));
    });

    it('should handle special characters in resource names', async () => {
      api.use(GRPCPlugin, {
        port,
        protoPath,
        autoStart: false,
        packageName: 'testapi'
      });

      api.addResource('user_profiles', new Schema({
        id: { type: 'id' },
        bio: { type: 'string' }
      }));

      const proto = await api.grpc.generateProto('user_profiles', api.schemas.get('user_profiles'));
      
      assert(proto.content.includes('message User_profiles'));
      assert(proto.fileName === 'user_profiles.proto');
    });
  });
});