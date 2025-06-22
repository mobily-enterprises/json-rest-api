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

// Plugin exports
export { MemoryPlugin } from './plugins/memory.js';
export { MySQLPlugin } from './plugins/mysql.js';
export { HTTPPlugin } from './plugins/http.js';
export { ValidationPlugin } from './plugins/validation.js';
export { PositioningPlugin } from './plugins/positioning.js';
export { VersioningPlugin } from './plugins/versioning.js';
export { SecurityPlugin } from './plugins/security.js';
export { LoggingPlugin } from './plugins/logging.js';
export { OpenAPIPlugin } from './plugins/openapi.js';
export { TimestampsPlugin } from './plugins/timestamps.js';
export { AuthorizationPlugin } from './plugins/authorization.js';
export { CorsPlugin } from './plugins/cors.js';
export { JwtPlugin } from './plugins/jwt.js';
export { QueryLimitsPlugin } from './plugins/query-limits.js';
export { ViewsPlugin } from './plugins/views.js';
export { SimplifiedRecordsPlugin } from './plugins/simplified-records.js';
export { ApiGatewayPlugin } from './plugins/api-gateway.js';
export { CLIPlugin } from './plugins/cli.js';
export { DiscoveryPlugin } from './plugins/discovery/index.js';
export { MigrationPlugin } from './plugins/migration-plugin.js';

// Enterprise plugins
export { MicroservicesPlugin } from './plugins/enterprise/microservices.js';
export { CQRSPlugin, Command, Query, Event } from './plugins/enterprise/cqrs.js';
export { DDDPlugin, ValueObject, Entity, Aggregate, Repository, DomainService, Specification } from './plugins/enterprise/ddd.js';
export { BoundedContextPlugin } from './plugins/enterprise/bounded-context.js';
export { ArchitectureEnforcementPlugin } from './plugins/enterprise/architecture-enforcement.js';
export { DependencyGraphPlugin } from './plugins/enterprise/dependency-graph.js';

// Import for internal use
import { Api } from './lib/api.js';
import { MemoryPlugin } from './plugins/memory.js';
import { MySQLPlugin } from './plugins/mysql.js';
import { HTTPPlugin } from './plugins/http.js';
import { ValidationPlugin } from './plugins/validation.js';
import { PositioningPlugin } from './plugins/positioning.js';
import { VersioningPlugin } from './plugins/versioning.js';
import { TimestampsPlugin } from './plugins/timestamps.js';

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