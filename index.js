/**
 * JSON REST API - REST API plugin for hooked-api with JSON:API compliance
 * 
 * This package provides:
 * - REST API plugin that adds query, get, post, put, patch, delete methods to scopes
 * - Connector plugins for various HTTP frameworks (Express, etc.)
 * - JSON:API compliant request/response handling
 * - Comprehensive error handling and validation
 */

// Main REST API plugin
export { RestApiPlugin } from './plugins/rest-api-plugin.js';

// File handling plugin
export { FileHandlingPlugin } from './plugins/file-handling-plugin.js';

// Connector plugins
export { ExpressPlugin } from './plugins/connectors/express-plugin.js';
export { HttpPlugin } from './plugins/connectors/http-plugin.js';
// Future: export { FastifyPlugin } from './plugins/connectors/fastify-plugin.js';
// Future: export { KoaPlugin } from './plugins/connectors/koa-plugin.js';

// Error classes for consumers who need them
export {
  RestApiValidationError,
  RestApiResourceError,
  RestApiPayloadError
} from './lib/rest-api-errors.js';

// Re-export everything for backward compatibility
export * from './lib/rest-api-errors.js';