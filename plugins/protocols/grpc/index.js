import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { ProtoGenerator } from './proto-generator.js';
import { ServiceBuilder } from './service-builder.js';
import { TypeMapper } from './type-mapper.js';
import path from 'path';
import fs from 'fs/promises';

export const GRPCPlugin = {
  install(api, options = {}) {
    const {
      port = 50051,
      host = '0.0.0.0',
      protoPath = './protos',
      packageName = 'api',
      serviceName = 'ApiService',
      credentials = grpc.ServerCredentials.createInsecure(),
      options: serverOptions = {
        'grpc.max_receive_message_length': 4 * 1024 * 1024, // 4MB
        'grpc.max_send_message_length': 4 * 1024 * 1024    // 4MB
      },
      interceptors = [],
      reflection = true,
      strictTypes = false
    } = options;

    // Initialize components
    const protoGenerator = new ProtoGenerator({ packageName, serviceName, strictTypes });
    const typeMapper = new TypeMapper({ strictTypes });
    const serviceBuilder = new ServiceBuilder(api, typeMapper);

    // gRPC server instance
    let server = null;
    const services = new Map();
    const protoDefinitions = new Map();

    api.grpc = {
      server: null,
      services,
      protoDefinitions,
      typeMapper,

      // Generate proto file for a resource
      async generateProto(resourceName, schema) {
        const protoContent = protoGenerator.generateResourceProto(resourceName, schema);
        const fileName = `${resourceName}.proto`;
        const filePath = path.join(protoPath, fileName);
        
        // Ensure directory exists
        await fs.mkdir(protoPath, { recursive: true });
        
        // Write proto file
        await fs.writeFile(filePath, protoContent);
        
        return { fileName, filePath, content: protoContent };
      },

      // Generate proto for all resources
      async generateAllProtos() {
        const protos = [];
        
        for (const [resourceName, schema] of api.schemas) {
          const proto = await this.generateProto(resourceName, schema);
          protos.push(proto);
        }
        
        // Generate main service proto
        const mainProto = protoGenerator.generateMainProto(api.schemas);
        const mainPath = path.join(protoPath, 'service.proto');
        await fs.writeFile(mainPath, mainProto);
        
        protos.push({
          fileName: 'service.proto',
          filePath: mainPath,
          content: mainProto
        });
        
        return protos;
      },

      // Load proto and create service
      async loadService(protoFile) {
        const packageDefinition = protoLoader.loadSync(protoFile, {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true
        });

        const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        return protoDescriptor;
      },

      // Start gRPC server
      async start() {
        if (server) {
          throw new Error('gRPC server already started');
        }

        server = new grpc.Server(serverOptions);

        // Generate and load protos
        const protos = await this.generateAllProtos();
        const mainProtoPath = path.join(protoPath, 'service.proto');
        const protoDescriptor = await this.loadService(mainProtoPath);

        // Get service definition
        const servicePackage = protoDescriptor[packageName];
        const ServiceConstructor = servicePackage[serviceName];

        // Build service implementation
        const serviceImpl = serviceBuilder.buildService(api.schemas);

        // Add service to server
        server.addService(ServiceConstructor.service, serviceImpl);

        // Add reflection if enabled
        if (reflection) {
          await this.addReflection(server, mainProtoPath);
        }

        // Start server
        return new Promise((resolve, reject) => {
          server.bindAsync(`${host}:${port}`, credentials, (err, boundPort) => {
            if (err) {
              reject(err);
              return;
            }

            server.start();
            api.grpc.server = server;
            console.log(`gRPC server listening on ${host}:${boundPort}`);
            resolve(boundPort);
          });
        });
      },

      // Stop gRPC server
      async stop() {
        if (!server) {
          return;
        }

        return new Promise((resolve) => {
          server.tryShutdown(() => {
            server = null;
            api.grpc.server = null;
            resolve();
          });
        });
      },

      // Add reflection service
      async addReflection(server, protoPath) {
        try {
          const { ReflectionService } = await import('@grpc/reflection');
          const reflectionService = new ReflectionService(protoPath);
          reflectionService.addToServer(server);
        } catch (error) {
          console.warn('gRPC reflection not available:', error.message);
        }
      },

      // Create client for testing
      createClient(serviceName, options = {}) {
        const {
          address = `localhost:${port}`,
          credentials: clientCreds = grpc.credentials.createInsecure()
        } = options;

        const mainProtoPath = path.join(protoPath, 'service.proto');
        const packageDefinition = protoLoader.loadSync(mainProtoPath, {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true
        });

        const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        const ServiceConstructor = protoDescriptor[packageName][serviceName];

        return new ServiceConstructor(address, clientCreds);
      },

      // Add custom method
      addMethod(name, handler, options = {}) {
        services.set(name, {
          handler,
          requestStream: options.requestStream || false,
          responseStream: options.responseStream || false,
          options
        });
      },

      // Interceptor support
      addInterceptor(interceptor) {
        interceptors.push(interceptor);
      },

      // Get service definition
      getServiceDefinition() {
        return protoGenerator.getServiceDefinition(api.schemas);
      },

      // Streaming helpers
      createReadStream(resource, query = {}) {
        return serviceBuilder.createReadStream(resource, query);
      },

      createWriteStream(resource) {
        return serviceBuilder.createWriteStream(resource);
      },

      createDuplexStream(resource) {
        return serviceBuilder.createDuplexStream(resource);
      }
    };

    // Hook into resource addition
    api.hook('afterAddResource', async (context) => {
      const { name, schema } = context;
      
      // Generate proto for new resource
      try {
        await api.grpc.generateProto(name, schema);
      } catch (error) {
        console.error(`Failed to generate proto for ${name}:`, error);
      }
    });

    // Auto-start server if port is specified
    if (options.autoStart !== false) {
      process.nextTick(() => {
        api.grpc.start().catch(error => {
          console.error('Failed to start gRPC server:', error);
        });
      });
    }

    // Graceful shutdown
    const shutdown = async () => {
      try {
        await api.grpc.stop();
        console.log('gRPC server stopped');
      } catch (error) {
        console.error('Error stopping gRPC server:', error);
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Extend API with gRPC-specific methods
    api.grpc.call = async (method, request, metadata = {}) => {
      // Internal gRPC call helper
      const client = api.grpc.createClient(serviceName);
      
      return new Promise((resolve, reject) => {
        const call = client[method](request, metadata, (error, response) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        });
      });
    };

    // Stream helpers
    api.grpc.streamCall = (method, metadata = {}) => {
      const client = api.grpc.createClient(serviceName);
      return client[method](metadata);
    };

    // Bidirectional stream
    api.grpc.duplexCall = (method, metadata = {}) => {
      const client = api.grpc.createClient(serviceName);
      return client[method](metadata);
    };
  }
};

// Export components for advanced usage
export { ProtoGenerator } from './proto-generator.js';
export { ServiceBuilder } from './service-builder.js';
export { TypeMapper } from './type-mapper.js';