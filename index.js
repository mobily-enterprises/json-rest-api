// Core exports
export { Api } from './api.js';
export { Schema } from './schema.js';

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
} from './errors.js';

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
export { ApiRegistryPlugin } from './plugins/api-registry.js';
export { TimestampsPlugin } from './plugins/timestamps.js';

// Import for internal use
import { Api } from './api.js';
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