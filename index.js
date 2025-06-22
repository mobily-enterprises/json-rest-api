// Core exports
export { Api } from './lib/api.js';
export { Schema } from './lib/schema.js';
export { QueryBuilder, schemaFields } from './lib/query-builder.js';

// Error exports
export { 
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError,
  ErrorCodes,
  normalizeError,
  formatErrorResponse
} from './lib/errors.js';

// Core plugins
export { MemoryPlugin } from './plugins/core/memory.js';
export { MySQLPlugin } from './plugins/core/mysql.js';
export { HTTPPlugin } from './plugins/core/http.js';
export { ValidationPlugin } from './plugins/core/validation.js';
export { PositioningPlugin } from './plugins/core/positioning.js';
export { VersioningPlugin } from './plugins/core-extra/versioning.js';
export { SecurityPlugin } from './plugins/core-extra/security.js';
export { LoggingPlugin } from './plugins/core-extra/logging.js';
export { TimestampsPlugin } from './plugins/core/timestamps.js';

// Core-extra plugins
export { AuthorizationPlugin } from './plugins/core-extra/authorization.js';
export { CorsPlugin } from './plugins/core-extra/cors.js';
export { JwtPlugin } from './plugins/core-extra/jwt.js';
export { QueryLimitsPlugin } from './plugins/core-extra/query-limits.js';
export { ViewsPlugin } from './plugins/core-extra/views.js';
export { MigrationPlugin } from './plugins/core-extra/migration-plugin.js';

// Protocol plugins
export { GraphQLPlugin } from './plugins/protocols/graphql/index.js';
export { WebSocketPlugin } from './plugins/protocols/websocket/index.js';
export { GRPCPlugin } from './plugins/protocols/grpc/index.js';
export { SimplifiedRecordsPlugin } from './plugins/protocols/simplified-records.js';
export { DiscoveryPlugin } from './plugins/protocols/schema-export/index.js';

// Infrastructure plugins
export { ServiceDiscoveryPlugin } from './plugins/infrastructure/service-discovery/index.js';
export { ApiGatewayPlugin } from './plugins/infrastructure/api-gateway.js';
export { CLIPlugin } from './plugins/infrastructure/cli.js';

// Enterprise plugins
export { MicroservicesPlugin } from './plugins/enterprise/microservices.js';
export { CQRSPlugin, Command, Query, Event } from './plugins/enterprise/cqrs.js';
export { DDDPlugin, ValueObject, Entity, Aggregate, Repository, DomainService, Specification } from './plugins/enterprise/ddd.js';
export { BoundedContextPlugin } from './plugins/enterprise/bounded-context.js';
export { ArchitectureEnforcementPlugin } from './plugins/enterprise/architecture-enforcement.js';
export { DependencyGraphPlugin } from './plugins/enterprise/dependency-graph.js';

// Import for internal use
import { Api } from './lib/api.js';
import { MemoryPlugin } from './plugins/core/memory.js';
import { MySQLPlugin } from './plugins/core/mysql.js';
import { HTTPPlugin } from './plugins/core/http.js';
import { ValidationPlugin } from './plugins/core/validation.js';
import { PositioningPlugin } from './plugins/core/positioning.js';
import { VersioningPlugin } from './plugins/core-extra/versioning.js';
import { TimestampsPlugin } from './plugins/core/timestamps.js';

// Convenience function to create a fully configured API
export function createApi(options = {}) {
  const api = new Api(options);
  
  // Add default plugins based on options
  if (options.validation !== false) {
    api.use(ValidationPlugin, options.validation);
  }
  
  if (options.storage === 'memory') {
    api.use(MemoryPlugin, options.memory);
  } else if (options.storage === 'mysql') {
    api.use(MySQLPlugin, options.mysql);
  }
  
  // Auto-add HTTP plugin if http options are provided
  if (options.http) {
    api.use(HTTPPlugin, options.http);
  }
  
  if (options.positioning) {
    api.use(PositioningPlugin, options.positioning);
  }
  
  if (options.versioning) {
    api.use(VersioningPlugin, options.versioning);
  }
  
  if (options.timestamps) {
    api.use(TimestampsPlugin, options.timestamps);
  }
  
  return api;
}

// Re-export circular-json-es6 for convenience
export { stringify as serialize, parse as deserialize } from 'circular-json-es6';

// Export version
export const VERSION = '1.0.0';