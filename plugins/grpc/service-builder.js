import { Readable, Writable, Duplex } from 'stream';

export class ServiceBuilder {
  constructor(api, typeMapper) {
    this.api = api;
    this.typeMapper = typeMapper;
  }

  buildService(schemas) {
    const service = {};
    
    for (const [resourceName, schema] of schemas) {
      const capitalized = this.capitalize(resourceName);
      
      // Get single resource
      service[`Get${capitalized}`] = this.createUnaryHandler(
        resourceName,
        async (call, callback) => {
          try {
            const { id, include } = call.request;
            
            const options = {
              user: call.metadata.user,
              include: include ? include.join(',') : undefined
            };
            
            const result = await this.api.resources[resourceName].get(id, options);
            
            if (!result || !result.data) {
              const error = new Error(`${resourceName} not found`);
              error.code = grpc.status.NOT_FOUND;
              callback(error);
              return;
            }
            
            const response = this.typeMapper.jsonApiToGrpc(result.data, schema);
            callback(null, response);
          } catch (error) {
            callback(this.handleError(error));
          }
        }
      );
      
      // Create resource
      service[`Create${capitalized}`] = this.createUnaryHandler(
        resourceName,
        async (call, callback) => {
          try {
            const { data } = call.request;
            const jsonData = this.typeMapper.grpcToJsonApi(data, schema);
            
            const options = {
              user: call.metadata.user
            };
            
            const result = await this.api.resources[resourceName].create(jsonData, options);
            const response = this.typeMapper.jsonApiToGrpc(result.data, schema);
            callback(null, response);
          } catch (error) {
            callback(this.handleError(error));
          }
        }
      );
      
      // Update resource
      service[`Update${capitalized}`] = this.createUnaryHandler(
        resourceName,
        async (call, callback) => {
          try {
            const { id, data } = call.request;
            const jsonData = this.typeMapper.grpcToJsonApi(data, schema);
            
            const options = {
              user: call.metadata.user
            };
            
            const result = await this.api.resources[resourceName].update(id, jsonData, options);
            const response = this.typeMapper.jsonApiToGrpc(result.data, schema);
            callback(null, response);
          } catch (error) {
            callback(this.handleError(error));
          }
        }
      );
      
      // Delete resource
      service[`Delete${capitalized}`] = this.createUnaryHandler(
        resourceName,
        async (call, callback) => {
          try {
            const { id } = call.request;
            
            const options = {
              user: call.metadata.user
            };
            
            await this.api.resources[resourceName].delete(id, options);
            callback(null, {
              success: true,
              message: `${resourceName} deleted successfully`,
              id
            });
          } catch (error) {
            callback(this.handleError(error));
          }
        }
      );
      
      // Query resources
      service[`Query${capitalized}`] = this.createUnaryHandler(
        resourceName,
        async (call, callback) => {
          try {
            const { filter, sort, page, page_size, include } = call.request;
            
            const query = {
              filter: filter || {},
              sort,
              page: page && page_size ? { number: page, size: page_size } : undefined,
              include: include ? include.join(',') : undefined
            };
            
            const options = {
              user: call.metadata.user
            };
            
            const result = await this.api.resources[resourceName].query(query, options);
            
            const response = {
              items: result.data.map(item => this.typeMapper.jsonApiToGrpc(item, schema)),
              total: result.meta?.total || result.data.length,
              page: result.meta?.pageNumber || 1,
              page_size: result.meta?.pageSize || result.data.length
            };
            
            callback(null, response);
          } catch (error) {
            callback(this.handleError(error));
          }
        }
      );
      
      // Batch create
      service[`BatchCreate${capitalized}`] = this.createUnaryHandler(
        resourceName,
        async (call, callback) => {
          try {
            const { items } = call.request;
            const options = { user: call.metadata.user };
            
            const results = await Promise.all(
              items.map(item => {
                const jsonData = this.typeMapper.grpcToJsonApi(item, schema);
                return this.api.resources[resourceName].create(jsonData, options);
              })
            );
            
            const response = {
              items: results.map(r => this.typeMapper.jsonApiToGrpc(r.data, schema)),
              total: results.length,
              page: 1,
              page_size: results.length
            };
            
            callback(null, response);
          } catch (error) {
            callback(this.handleError(error));
          }
        }
      );
      
      // Stream query results
      service[`Stream${capitalized}`] = this.createServerStreamHandler(
        resourceName,
        async (call) => {
          try {
            const { filter, sort, include } = call.request;
            
            const query = {
              filter: filter || {},
              sort,
              include: include ? include.join(',') : undefined
            };
            
            const options = {
              user: call.metadata.user
            };
            
            // Execute query
            const result = await this.api.resources[resourceName].query(query, options);
            
            // Stream each result
            for (const item of result.data) {
              const grpcItem = this.typeMapper.jsonApiToGrpc(item, schema);
              call.write(grpcItem);
            }
            
            call.end();
          } catch (error) {
            call.emit('error', this.handleError(error));
          }
        }
      );
      
      // Watch for changes (real-time updates)
      service[`Watch${capitalized}`] = this.createServerStreamHandler(
        resourceName,
        async (call) => {
          try {
            const { filter } = call.request;
            
            // Send initial data
            const query = { filter: filter || {} };
            const options = { user: call.metadata.user };
            const result = await this.api.resources[resourceName].query(query, options);
            
            for (const item of result.data) {
              const grpcItem = this.typeMapper.jsonApiToGrpc(item, schema);
              call.write(grpcItem);
            }
            
            // Set up listeners for changes
            const listeners = {
              insert: async (context) => {
                if (context.resource === resourceName) {
                  const grpcItem = this.typeMapper.jsonApiToGrpc(context.result.data, schema);
                  call.write(grpcItem);
                }
              },
              update: async (context) => {
                if (context.resource === resourceName) {
                  const grpcItem = this.typeMapper.jsonApiToGrpc(context.result.data, schema);
                  call.write(grpcItem);
                }
              }
            };
            
            // Register listeners
            this.api.on('afterInsert', listeners.insert);
            this.api.on('afterUpdate', listeners.update);
            
            // Clean up on end
            call.on('cancelled', () => {
              this.api.off('afterInsert', listeners.insert);
              this.api.off('afterUpdate', listeners.update);
              call.end();
            });
          } catch (error) {
            call.emit('error', this.handleError(error));
          }
        }
      );
      
      // Client streaming for batch operations
      service[`StreamCreate${capitalized}`] = this.createClientStreamHandler(
        resourceName,
        async (call, callback) => {
          const results = [];
          const options = { user: call.metadata.user };
          
          call.on('data', async (request) => {
            try {
              const { data } = request;
              const jsonData = this.typeMapper.grpcToJsonApi(data, schema);
              const result = await this.api.resources[resourceName].create(jsonData, options);
              results.push(this.typeMapper.jsonApiToGrpc(result.data, schema));
            } catch (error) {
              call.emit('error', this.handleError(error));
            }
          });
          
          call.on('end', () => {
            callback(null, {
              items: results,
              total: results.length,
              page: 1,
              page_size: results.length
            });
          });
          
          call.on('error', (error) => {
            callback(this.handleError(error));
          });
        }
      );
    }
    
    return service;
  }

  createUnaryHandler(resourceName, handler) {
    return async (call, callback) => {
      try {
        await handler(call, callback);
      } catch (error) {
        console.error(`gRPC error in ${resourceName}:`, error);
        callback(this.handleError(error));
      }
    };
  }

  createServerStreamHandler(resourceName, handler) {
    return async (call) => {
      try {
        await handler(call);
      } catch (error) {
        console.error(`gRPC stream error in ${resourceName}:`, error);
        call.emit('error', this.handleError(error));
      }
    };
  }

  createClientStreamHandler(resourceName, handler) {
    return async (call, callback) => {
      try {
        await handler(call, callback);
      } catch (error) {
        console.error(`gRPC client stream error in ${resourceName}:`, error);
        callback(this.handleError(error));
      }
    };
  }

  handleError(error) {
    const grpcError = new Error(error.message);
    
    // Map error types to gRPC status codes
    if (error.name === 'NotFoundError') {
      grpcError.code = grpc.status.NOT_FOUND;
    } else if (error.name === 'ValidationError') {
      grpcError.code = grpc.status.INVALID_ARGUMENT;
      grpcError.details = error.validationErrors;
    } else if (error.name === 'ConflictError') {
      grpcError.code = grpc.status.ALREADY_EXISTS;
    } else if (error.name === 'UnauthorizedError') {
      grpcError.code = grpc.status.UNAUTHENTICATED;
    } else if (error.name === 'ForbiddenError') {
      grpcError.code = grpc.status.PERMISSION_DENIED;
    } else {
      grpcError.code = grpc.status.INTERNAL;
    }
    
    return grpcError;
  }

  // Stream helpers
  createReadStream(resource, query = {}) {
    const stream = new Readable({
      objectMode: true,
      async read() {
        try {
          const result = await this.api.resources[resource].query(query);
          for (const item of result.data) {
            this.push(item);
          }
          this.push(null);
        } catch (error) {
          this.destroy(error);
        }
      }
    });
    
    return stream;
  }

  createWriteStream(resource) {
    const stream = new Writable({
      objectMode: true,
      async write(chunk, encoding, callback) {
        try {
          await this.api.resources[resource].create(chunk);
          callback();
        } catch (error) {
          callback(error);
        }
      }
    });
    
    return stream;
  }

  createDuplexStream(resource) {
    const stream = new Duplex({
      objectMode: true,
      async read() {
        // Implement read logic
      },
      async write(chunk, encoding, callback) {
        try {
          const result = await this.api.resources[resource].create(chunk);
          this.push(result.data);
          callback();
        } catch (error) {
          callback(error);
        }
      }
    });
    
    return stream;
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// Import grpc at the top
import grpc from '@grpc/grpc-js';