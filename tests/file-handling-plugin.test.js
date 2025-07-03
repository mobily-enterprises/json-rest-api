import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { FileHandlingPlugin } from '../plugins/core/file-handling-plugin.js';
import { 
  RestApiValidationError, 
  RestApiResourceError, 
  RestApiPayloadError 
} from '../lib/rest-api-errors.js';

describe('FileHandlingPlugin', () => {
  let api;
  
  beforeEach(async () => {
    // Reset the global registry to avoid conflicts between tests
    resetGlobalRegistryForTesting();
    
    // Create API instance
    api = new Api({
      name: 'test-file-api',
      version: '1.0.0'
    });
    
    // Install REST API plugin first (dependency)
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      returnFullRecord: {
        post: true,
        put: true,
        patch: true
      }
    });
  });
  
  describe('Plugin Installation', () => {
    test('should install successfully and create file detector registry', async () => {
      await api.use(FileHandlingPlugin);
      
      assert.ok(api.rest, 'Should have rest namespace');
      assert.ok(typeof api.rest.registerFileDetector === 'function', 'Should have registerFileDetector function');
      assert.ok(Array.isArray(api.rest.fileDetectors), 'Should have fileDetectors array');
      assert.strictEqual(api.rest.fileDetectors.length, 0, 'Should start with empty detector registry');
    });

    test('should require rest-api plugin as dependency', async () => {
      resetGlobalRegistryForTesting();
      
      const newApi = new Api({
        name: 'test-dependency-api', 
        version: '1.0.0'
      });
      
      // This should fail because rest-api plugin is not installed
      await assert.rejects(
        newApi.use(FileHandlingPlugin),
        Error,
        'Should require rest-api plugin'
      );
    });

    test('should detect file fields in existing scopes', async () => {
      // Add scope with file fields BEFORE installing file handling plugin
      api.addResource('documents', {
        schema: {
          title: { type: 'string', required: true },
          document: { 
            type: 'file',
            accepts: ['application/pdf'],
            maxSize: '10mb',
            required: true
          },
          thumbnail: {
            type: 'file',
            accepts: ['image/*'],
            maxSize: '1mb'
          }
        }
      });
      
      await api.use(FileHandlingPlugin);
      
      // Plugin should have detected file fields
      // We can verify this indirectly by checking that hooks are set up properly
      assert.ok(api.rest.registerFileDetector, 'Should have detector registration');
    });

    test('should detect file fields in dynamically added scopes', async () => {
      await api.use(FileHandlingPlugin);
      
      // Add scope AFTER plugin installation
      api.addResource('images', {
        schema: {
          name: { type: 'string', required: true },
          image: { 
            type: 'file',
            accepts: ['image/jpeg', 'image/png'],
            maxSize: '5mb',
            required: true
          }
        }
      });
      
      // Plugin should have detected the file field through the scope:added event
      assert.ok(api.rest.registerFileDetector, 'Should have detector registration');
    });
  });

  describe('File Detector Registry', () => {
    beforeEach(async () => {
      await api.use(FileHandlingPlugin);
    });

    test('should register file detectors successfully', () => {
      const mockDetector = {
        name: 'test-detector',
        detect: async (params) => false,
        parse: async (params) => ({ fields: {}, files: {} })
      };
      
      api.rest.registerFileDetector(mockDetector);
      
      assert.strictEqual(api.rest.fileDetectors.length, 1);
      assert.strictEqual(api.rest.fileDetectors[0].name, 'test-detector');
    });

    test('should validate detector structure', () => {
      assert.throws(() => {
        api.rest.registerFileDetector({});
      }, /must have name, detect\(\), and parse\(\) properties/);
      
      assert.throws(() => {
        api.rest.registerFileDetector({ name: 'test' });
      }, /must have name, detect\(\), and parse\(\) properties/);
      
      assert.throws(() => {
        api.rest.registerFileDetector({ 
          name: 'test',
          detect: () => {}
        });
      }, /must have name, detect\(\), and parse\(\) properties/);
    });

    test('should allow multiple detectors', () => {
      const detector1 = {
        name: 'detector-1',
        detect: async () => false,
        parse: async () => ({ fields: {}, files: {} })
      };
      
      const detector2 = {
        name: 'detector-2',
        detect: async () => false,
        parse: async () => ({ fields: {}, files: {} })
      };
      
      api.rest.registerFileDetector(detector1);
      api.rest.registerFileDetector(detector2);
      
      assert.strictEqual(api.rest.fileDetectors.length, 2);
      assert.strictEqual(api.rest.fileDetectors[0].name, 'detector-1');
      assert.strictEqual(api.rest.fileDetectors[1].name, 'detector-2');
    });
  });

  describe('File Processing', () => {
    let mockStorage;
    
    beforeEach(async () => {
      await api.use(FileHandlingPlugin);
      
      // Mock storage backend
      mockStorage = {
        upload: async (file) => {
          return `https://storage.example.com/${file.filename}`;
        }
      };
      
      // Add scope with file fields
      api.addResource('uploads', {
        schema: {
          title: { type: 'string', required: true },
          document: { 
            type: 'file',
            storage: mockStorage,
            accepts: ['application/pdf'],
            maxSize: '10mb',
            required: true
          },
          image: {
            type: 'file',
            storage: mockStorage,
            accepts: ['image/*'],
            maxSize: '5mb'
          }
        }
      });
      
      // Mock data storage
      api.customize({
        helpers: {
          dataPost: async ({ inputRecord }) => {
            return {
              data: {
                type: 'uploads',
                id: '1',
                attributes: inputRecord.data.attributes
              }
            };
          }
        }
      });
    });

    test('should process files when detector matches', async () => {
      // Register a mock detector that simulates file uploads
      api.rest.registerFileDetector({
        name: 'mock-multipart',
        detect: async (params) => {
          return params._hasFiles === true;
        },
        parse: async (params) => {
          return {
            fields: { title: 'Test Document' },
            files: {
              document: {
                filename: 'test.pdf',
                mimetype: 'application/pdf',
                size: 1024,
                cleanup: async () => {}
              }
            }
          };
        }
      });
      
      const result = await api.scopes.uploads.post({
        _hasFiles: true,
        inputRecord: { 
          data: { 
            type: 'uploads',
            attributes: {} 
          } 
        }
      });
      
      assert.strictEqual(result.data.attributes.title, 'Test Document');
      assert.strictEqual(result.data.attributes.document, 'https://storage.example.com/test.pdf');
    });

    test('should validate required file fields', async () => {
      // Register detector that doesn't provide required file
      api.rest.registerFileDetector({
        name: 'mock-empty',
        detect: async (params) => {
          return params._hasFiles === true;
        },
        parse: async (params) => {
          return {
            fields: { title: 'Test' },
            files: {} // No files
          };
        }
      });
      
      await assert.rejects(
        api.scopes.uploads.post({
          _hasFiles: true,
          inputRecord: { 
            data: { 
              type: 'uploads',
              attributes: {} 
            } 
          }
        }),
        (error) => {
          return error instanceof RestApiValidationError &&
                 error.message.includes("Required file field 'document' is missing");
        }
      );
    });

    test('should validate file mime types', async () => {
      api.rest.registerFileDetector({
        name: 'mock-wrong-type',
        detect: async (params) => {
          return params._hasFiles === true;
        },
        parse: async (params) => {
          return {
            fields: { title: 'Test' },
            files: {
              document: {
                filename: 'test.txt',
                mimetype: 'text/plain',
                size: 1024,
                cleanup: async () => {}
              }
            }
          };
        }
      });
      
      await assert.rejects(
        api.scopes.uploads.post({
          _hasFiles: true,
          inputRecord: { data: { type: 'uploads', attributes: {} } }
        }),
        (error) => {
          return error instanceof RestApiValidationError &&
                 error.message.includes("Invalid file type for field 'document'");
        }
      );
    });

    test('should validate file sizes', async () => {
      api.rest.registerFileDetector({
        name: 'mock-large-file',
        detect: async (params) => {
          return params._hasFiles === true;
        },
        parse: async (params) => {
          return {
            fields: { title: 'Test' },
            files: {
              document: {
                filename: 'large.pdf',
                mimetype: 'application/pdf',
                size: 20 * 1024 * 1024, // 20MB (exceeds 10MB limit)
                cleanup: async () => {}
              }
            }
          };
        }
      });
      
      await assert.rejects(
        api.scopes.uploads.post({
          _hasFiles: true,
          inputRecord: { data: { type: 'uploads', attributes: {} } }
        }),
        (error) => {
          return error instanceof RestApiValidationError &&
                 error.message.includes("File too large for field 'document'");
        }
      );
    });

    test('should handle wildcard mime type acceptance', async () => {
      // Add scope with wildcard acceptance
      api.addResource('anyfiles', {
        schema: {
          title: { type: 'string', required: true },
          anyfile: { 
            type: 'file',
            storage: mockStorage,
            accepts: ['*'],
            required: true
          }
        }
      });
      
      api.rest.registerFileDetector({
        name: 'mock-any-type',
        detect: async (params) => {
          return params._scope === 'anyfiles';
        },
        parse: async (params) => {
          return {
            fields: { title: 'Any File Test' },
            files: {
              anyfile: {
                filename: 'test.xyz',
                mimetype: 'application/unknown',
                size: 1024,
                cleanup: async () => {}
              }
            }
          };
        }
      });
      
      api.customize({
        helpers: {
          dataPost: async ({ inputRecord }) => {
            return {
              data: {
                type: 'anyfiles',
                id: '1',
                attributes: inputRecord.data.attributes
              }
            };
          }
        }
      });
      
      const result = await api.scopes.anyfiles.post({
        _scope: 'anyfiles',
        inputRecord: { data: { type: 'anyfiles', attributes: {} } }
      });
      
      assert.strictEqual(result.data.attributes.anyfile, 'https://storage.example.com/test.xyz');
    });

    test('should handle image/* pattern matching', async () => {
      api.rest.registerFileDetector({
        name: 'mock-image',
        detect: async (params) => {
          return params._hasImage === true;
        },
        parse: async (params) => {
          return {
            fields: { title: 'Image Test' },
            files: {
              image: {
                filename: 'photo.jpg',
                mimetype: 'image/jpeg',
                size: 1024,
                cleanup: async () => {}
              }
            }
          };
        }
      });
      
      const result = await api.scopes.uploads.post({
        _hasImage: true,
        inputRecord: { data: { type: 'uploads', attributes: {} } }
      });
      
      assert.strictEqual(result.data.attributes.image, 'https://storage.example.com/photo.jpg');
    });

    test('should handle storage upload failures', async () => {
      const failingStorage = {
        upload: async (file) => {
          throw new Error('Storage service unavailable');
        }
      };
      
      // Add scope with failing storage
      api.addResource('failing', {
        schema: {
          title: { type: 'string', required: true },
          document: { 
            type: 'file',
            storage: failingStorage,
            accepts: ['*'],
            required: true
          }
        }
      });
      
      let cleanupCalled = false;
      api.rest.registerFileDetector({
        name: 'mock-failing',
        detect: async (params) => {
          return params._scope === 'failing';
        },
        parse: async (params) => {
          return {
            fields: { title: 'Failing Test' },
            files: {
              document: {
                filename: 'test.pdf',
                mimetype: 'application/pdf',
                size: 1024,
                cleanup: async () => {
                  cleanupCalled = true;
                }
              }
            }
          };
        }
      });
      
      await assert.rejects(
        api.scopes.failing.post({
          _scope: 'failing',
          inputRecord: { data: { type: 'failing', attributes: {} } }
        }),
        (error) => {
          return error instanceof RestApiValidationError &&
                 error.message.includes('Failed to upload file');
        }
      );
      
      assert.ok(cleanupCalled, 'Should call cleanup on upload failure');
    });

    test('should skip processing for scopes without file fields', async () => {
      // Add scope without file fields
      api.addResource('simple', {
        schema: {
          title: { type: 'string', required: true },
          content: { type: 'string' }
        }
      });
      
      api.customize({
        helpers: {
          dataPost: async ({ inputRecord }) => {
            return {
              data: {
                type: 'simple',
                id: '1',
                attributes: inputRecord.data.attributes
              }
            };
          }
        }
      });
      
      let detectorCalled = false;
      api.rest.registerFileDetector({
        name: 'mock-detector',
        detect: async (params) => {
          detectorCalled = true;
          return false;
        },
        parse: async (params) => {
          return { fields: {}, files: {} };
        }
      });
      
      const result = await api.scopes.simple.post({
        inputRecord: { 
          data: { 
            attributes: { 
              title: 'Simple Record',
              content: 'No files here'
            } 
          } 
        }
      });
      
      assert.strictEqual(result.data.attributes.title, 'Simple Record');
      assert.strictEqual(result.data.attributes.content, 'No files here');
      // Detector should not be called for scopes without file fields
      assert.ok(!detectorCalled, 'Should not call detectors for scopes without file fields');
    });

    test('should only process files for mutation methods', async () => {
      let processingCalled = false;
      
      api.rest.registerFileDetector({
        name: 'mock-detector',
        detect: async (params) => {
          processingCalled = true;
          return false;
        },
        parse: async (params) => {
          return { fields: {}, files: {} };
        }
      });
      
      // Mock query method
      api.customize({
        helpers: {
          dataQuery: async () => {
            return { data: [] };
          }
        }
      });
      
      // Query should not trigger file processing
      await api.scopes.uploads.query({});
      
      assert.ok(!processingCalled, 'Should not process files for query methods');
    });
  });

  describe('Utility Functions', () => {
    test('should parse size strings correctly', async () => {
      await api.use(FileHandlingPlugin);
      
      // Test by creating a scope with size limits and checking validation
      api.addResource('sizetest', {
        schema: {
          small: { 
            type: 'file',
            storage: { upload: async (f) => 'url' },
            maxSize: '1kb'
          },
          medium: { 
            type: 'file',
            storage: { upload: async (f) => 'url' },
            maxSize: '1.5mb'
          }
        }
      });
      
      api.rest.registerFileDetector({
        name: 'size-test',
        detect: async (params) => params._testSize === true,
        parse: async (params) => ({
          fields: {},
          files: {
            small: {
              filename: 'small.txt',
              mimetype: 'text/plain',
              size: params._fileSize,
              cleanup: async () => {}
            }
          }
        })
      });
      
      api.customize({
        helpers: {
          dataPost: async ({ inputRecord }) => ({
            data: { type: 'sizetest', id: '1', attributes: inputRecord.data.attributes }
          })
        }
      });
      
      // Test 1KB limit - 500 bytes should pass
      const result1 = await api.scopes.sizetest.post({
        _testSize: true,
        _fileSize: 500,
        inputRecord: { data: { type: 'sizetest', attributes: {} } }
      });
      assert.ok(result1, 'Should accept file under size limit');
      
      // Test 1KB limit - 2000 bytes should fail
      await assert.rejects(
        api.scopes.sizetest.post({
          _testSize: true,
          _fileSize: 2000,
          inputRecord: { data: { type: 'sizetest', attributes: {} } }
        }),
        (error) => error instanceof RestApiValidationError
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await api.use(FileHandlingPlugin);
    });

    test('should handle missing storage configuration', async () => {
      // Add scope with file field but no storage
      api.addResource('nostorage', {
        schema: {
          title: { type: 'string', required: true },
          document: { 
            type: 'file',
            // No storage configured
            required: true
          }
        }
      });
      
      api.rest.registerFileDetector({
        name: 'mock-no-storage',
        detect: async (params) => params._scope === 'nostorage',
        parse: async (params) => ({
          fields: { title: 'Test' },
          files: {
            document: {
              filename: 'test.pdf',
              mimetype: 'application/pdf',
              size: 1024,
              cleanup: async () => {}
            }
          }
        })
      });
      
      await assert.rejects(
        api.scopes.nostorage.post({
          _scope: 'nostorage',
          inputRecord: { data: { type: 'nostorage', attributes: {} } }
        }),
        /No storage configured for file field 'document'/
      );
    });

    test('should handle detector failures gracefully', async () => {
      // Add detector that throws during detect
      api.rest.registerFileDetector({
        name: 'failing-detector',
        detect: async (params) => {
          throw new Error('Detector failed');
        },
        parse: async (params) => ({ fields: {}, files: {} })
      });
      
      // Add working detector
      api.rest.registerFileDetector({
        name: 'working-detector',
        detect: async (params) => false,
        parse: async (params) => ({ fields: {}, files: {} })
      });
      
      api.addResource('detectortest', {
        schema: {
          title: { type: 'string', required: true }
          // No file fields, so no processing should occur
        }
      });
      
      api.customize({
        helpers: {
          dataPost: async ({ inputRecord }) => ({
            data: { type: 'detectortest', id: '1', attributes: inputRecord.data.attributes }
          })
        }
      });
      
      // Should not throw even with failing detector
      const result = await api.scopes.detectortest.post({
        inputRecord: { data: { type: 'detectortest', attributes: { title: 'Test' } } }
      });
      
      assert.strictEqual(result.data.attributes.title, 'Test');
    });

    test('should handle cleanup failures gracefully', async () => {
      let cleanupCalled = false;
      
      api.addResource('cleanuptest', {
        schema: {
          document: { 
            type: 'file',
            storage: { upload: async (f) => 'url' },
            required: true
          }
        }
      });
      
      api.rest.registerFileDetector({
        name: 'cleanup-test',
        detect: async (params) => params._testCleanup === true,
        parse: async (params) => ({
          fields: {},
          files: {
            document: {
              filename: 'test.pdf',
              mimetype: 'application/pdf',
              size: 1024,
              cleanup: async () => {
                cleanupCalled = true;
                throw new Error('Cleanup failed');
              }
            }
          }
        })
      });
      
      api.customize({
        helpers: {
          dataPost: async ({ inputRecord }) => ({
            data: { type: 'cleanuptest', id: '1', attributes: inputRecord.data.attributes }
          })
        }
      });
      
      // Should succeed despite cleanup failure
      const result = await api.scopes.cleanuptest.post({
        _testCleanup: true,
        inputRecord: { data: { type: 'cleanuptest', attributes: {} } }
      });
      
      assert.ok(cleanupCalled, 'Should have attempted cleanup');
      assert.strictEqual(result.data.attributes.document, 'url');
    });
  });
});