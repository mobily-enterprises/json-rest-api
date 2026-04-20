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
export { RestApiPlugin } from './plugins/core/rest-api-plugin.js'
export { AccessPlugin } from './plugins/core/rest-api-access.js'
export { LabelPlugin } from './plugins/core/rest-api-label-plugin.js'

// Database plugins
export { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js'
export { RestApiAnyapiKnexPlugin } from './plugins/core/rest-api-anyapi-knex-plugin.js'

// Connector plugins
export { ExpressPlugin } from './plugins/core/connectors/express-plugin.js'
// Future: export { FastifyPlugin } from './plugins/core/connectors/fastify-plugin.js';
// Future: export { KoaPlugin } from './plugins/core/connectors/koa-plugin.js';

// Error classes for consumers who need them
export {
  RestApiValidationError,
  RestApiResourceError,
  RestApiPayloadError
} from './lib/rest-api-errors.js'

// Re-export everything for backward compatibility
export * from './lib/rest-api-errors.js'
