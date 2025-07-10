/**
 * @module http-helpers
 * @description HTTP-related helper utilities for REST API plugin
 * 
 * This module provides utilities for handling HTTP request/response objects
 * in a clean, maintainable way that keeps transport-layer concerns separate
 * from business logic. The primary goal is to prevent HTTP-specific objects
 * from polluting the params object that flows through the API methods.
 * 
 * Why this is useful upstream:
 * - Maintains clean separation between transport layer (HTTP) and business logic
 * - Supports multiple HTTP adapters (Express, raw HTTP, WebSocket) uniformly
 * - Enables file upload handling without polluting method signatures
 * - Allows access to authentication headers while keeping params clean
 * - Facilitates testing by isolating HTTP concerns in context
 */

/**
 * Moves HTTP request/response objects from params to context for cleaner method signatures.
 * 
 * This helper function is essential for maintaining clean separation between business logic
 * parameters and transport-layer concerns. HTTP plugins (Express, HTTP, WebSocket) need to
 * pass request/response objects through the API methods for things like:
 * - File upload handling
 * - Custom headers access
 * - Real-time response streaming
 * - Authentication tokens
 * 
 * However, these HTTP objects shouldn't pollute the params object that contains business
 * data. This function extracts them from params and places them in the context where
 * they belong, supporting both the modern WeakMap approach and legacy direct passing.
 * 
 * The function handles three scenarios:
 * 1. Modern approach: HTTP objects stored in WeakMap with _requestId reference
 * 2. Legacy Express: _expressReq/_expressRes passed directly in params  
 * 3. Legacy HTTP: _httpReq/_httpRes passed directly in params
 * 
 * @param {Object} params - The method parameters that may contain HTTP objects
 * @param {Object} context - The context object to receive the HTTP objects
 * @param {Object} api - The API instance containing _httpRequests WeakMap
 * 
 * @example
 * // Modern approach using WeakMap (preferred):
 * // In Express plugin:
 * const requestId = Symbol('request');
 * api._httpRequests.set(requestId, { req, res });
 * const result = await scope.post({ 
 *   inputRecord: data,
 *   _requestId: requestId  // Clean reference
 * });
 * 
 * // In REST API method:
 * moveHttpObjectsToContext(params, context, api);
 * // Now context.expressReq and context.expressRes are available
 * // But params is clean of HTTP concerns
 * 
 * @example
 * // What gets moved:
 * // Before:
 * params = {
 *   inputRecord: { data: {...} },
 *   _requestId: Symbol(request),
 *   transaction: dbTransaction  // Preserved
 * }
 * context = {}
 * 
 * // After moveHttpObjectsToContext:
 * params = {
 *   inputRecord: { data: {...} },
 *   transaction: dbTransaction  // Still there
 * }
 * context = {
 *   expressReq: [Express Request],
 *   expressRes: [Express Response],
 *   transaction: dbTransaction  // Also copied here
 * }
 * 
 * @example
 * // Legacy support (still works but not recommended):
 * const result = await scope.post({
 *   inputRecord: data,
 *   _expressReq: req,  // Direct passing
 *   _expressRes: res
 * });
 * // These get moved to context.expressReq/expressRes
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Keep params object focused on business data (inputRecord, queryParams, etc.)
 * // 2. Enable HTTP plugins to pass request/response without polluting the API
 * // 3. Support file uploads via multipart forms (accessed through context.expressReq)
 * // 4. Allow custom authentication headers inspection (context.expressReq.headers)
 * // 5. Enable response streaming for large datasets (context.expressRes.write)
 * // 6. Maintain backward compatibility with legacy direct passing approach
 * // 7. Clean up WeakMap entries to prevent memory leaks
 */
export const moveHttpObjectsToContext = (params, context, api) => {
  // Check for request ID from Express/HTTP plugins
  if (params._requestId && api._httpRequests) {
    const httpData = api._httpRequests.get(params._requestId);
    if (httpData) {
      if (httpData.req && httpData.res) {
        // Express request
        context.expressReq = httpData.req;
        context.expressRes = httpData.res;
      } else if (httpData.httpReq && httpData.httpRes) {
        // HTTP request
        context.httpReq = httpData.httpReq;
        context.httpRes = httpData.httpRes;
      }
      // Clean up the WeakMap entry
      api._httpRequests.delete(params._requestId);
    }
    delete params._requestId;
  }
  
  // Legacy support - remove if present
  if (params._expressReq) {
    context.expressReq = params._expressReq;
    context.expressRes = params._expressRes;
    delete params._expressReq;
    delete params._expressRes;
  }
  if (params._httpReq) {
    context.httpReq = params._httpReq;
    context.httpRes = params._httpRes;
    delete params._httpReq;
    delete params._httpRes;
  }
  
  // Preserve transaction if present
  if (params.transaction) {
    context.transaction = params.transaction;
  }
};