import { RestApiResourceError } from '../../../lib/rest-api-errors.js';
import { parseJsonApiQuery } from '../lib/querying-writing/connectors-query-parser.js';

export default async function registerScopeRoutes({ context, api, vars, log }) {
  const { scopeName } = context;
  const basePath = vars.transport?.mountPath || '';
  
  // Helper to create route handlers
  const createRouteHandler = (scopeName, methodName) => {
    return async ({ queryString, headers, params, body, context }) => {
      const scope = api.scopes[scopeName];
      if (!scope) {
        throw new RestApiResourceError(
          `Scope '${scopeName}' not found`,
          { 
            subtype: 'not_found',
            resourceType: 'scope',
            resourceId: scopeName
          }
        );
      }
      
      // Build parameters for the scope method
      const methodParams = {};
      
      // Add ID for single-resource operations
      if (['get', 'put', 'patch', 'delete'].includes(methodName)) {
        methodParams.id = params.id;
      }
      
      // Parse query parameters for read operations
      if (['query', 'get'].includes(methodName)) {
        methodParams.queryParams = parseJsonApiQuery(queryString);
        methodParams.isTransport = true;
      }
      
      // Add body for write operations
      if (['post', 'put', 'patch'].includes(methodName)) {
        methodParams.inputRecord = body;
        methodParams.isTransport = true;
        
        // Add query params for includes/fields on write operations
        if (queryString) {
          methodParams.queryParams = parseJsonApiQuery(queryString);
        }
      }
      
      // Call the scope method
      const result = await scope[methodName](methodParams, context);
      
      // Return the result (transport plugin handles response formatting)
      return result;
    };
  };
  
  const scopePath = `${basePath}/${scopeName}`;
  
  // Register routes for each HTTP method
  // GET /api/{scope} - Query collection
  await api.addRoute({
    method: 'GET',
    path: scopePath,
    handler: createRouteHandler(scopeName, 'query')
  });
  
  // GET /api/{scope}/{id} - Get single resource
  await api.addRoute({
    method: 'GET',
    path: `${scopePath}/:id`,
    handler: createRouteHandler(scopeName, 'get')
  });
  
  // POST /api/{scope} - Create resource
  await api.addRoute({
    method: 'POST',
    path: scopePath,
    handler: createRouteHandler(scopeName, 'post')
  });
  
  // PUT /api/{scope}/{id} - Replace resource
  await api.addRoute({
    method: 'PUT',
    path: `${scopePath}/:id`,
    handler: createRouteHandler(scopeName, 'put')
  });
  
  // PATCH /api/{scope}/{id} - Update resource
  await api.addRoute({
    method: 'PATCH',
    path: `${scopePath}/:id`,
    handler: createRouteHandler(scopeName, 'patch')
  });
  
  // DELETE /api/{scope}/{id} - Delete resource
  await api.addRoute({
    method: 'DELETE',
    path: `${scopePath}/:id`,
    handler: createRouteHandler(scopeName, 'delete')
  });
  
  log.info(`Routes registered for scope '${scopeName}'`);
}