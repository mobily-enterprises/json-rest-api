/**
 * JSON REST API - REST API plugin for hooked-api with JSON:API compliance
 * 
 * This package provides:
 * - REST API plugin that adds query, get, post, put, patch, delete methods to scopes
 * - Connector plugins for various HTTP frameworks (Express, etc.)
 * - JSON:API compliant request/response handling
 * - Comprehensive error handling and validation
 */

// Core plugins
export { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
export { FileHandlingPlugin } from './plugins/core/file-handling-plugin.js';
export { CorsPlugin } from './plugins/core/rest-api-cors-plugin.js';

// Database plugins
export { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';

// Connector plugins
export { ExpressPlugin } from './plugins/core/connectors/express-plugin.js';
// Future: export { FastifyPlugin } from './plugins/core/connectors/fastify-plugin.js';
// Future: export { KoaPlugin } from './plugins/core/connectors/koa-plugin.js';

// Storage plugins for file handling
export { LocalStorage } from './plugins/storage/local-storage.js';
export { S3Storage } from './plugins/storage/s3-storage.js';

// Error classes for consumers who need them
export {
  RestApiValidationError,
  RestApiResourceError,
  RestApiPayloadError
} from './lib/rest-api-errors.js';

// Re-export everything for backward compatibility
export * from './lib/rest-api-errors.js';

// URL helper function for generating API URL prefix
export { getUrlPrefix } from './plugins/core/lib/querying/url-helpers.js';
