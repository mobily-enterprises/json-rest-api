import { parseJsonApiQuery } from '../lib/querying-writing/connectors-query-parser.js'

export default async function registerRelationshipRoutes ({ context, api, log }) {
  const { scopeName } = context
  const basePath = api.scopes[scopeName].vars.transport?.mountPath || ''
  const scopePath = `${basePath}/${scopeName}`

  // Helper to create route handlers
  const createRouteHandler = (methodName) => {
    return async ({ params, body, queryString }) => {
      const scope = api.scopes[scopeName]

      const methodParams = {
        id: params.id,
        relationshipName: params.relationshipName,
        isTransport: true
      }

      // Add query params for getRelated
      if (methodName === 'getRelated' && queryString) {
        methodParams.queryParams = parseJsonApiQuery(queryString)
      }

      // Add body data for write operations
      if (body && body.data !== undefined) {
        methodParams.relationshipData = body.data
      }

      return await scope[methodName](methodParams)
    }
  }

  // Register relationship routes

  // GET /api/{scope}/{id}/relationships/{relationshipName}
  await api.addRoute({
    method: 'GET',
    path: `${scopePath}/:id/relationships/:relationshipName`,
    handler: createRouteHandler('getRelationship'),
    routeMeta: { kind: 'relationship', scopeName, operation: 'getRelationship' }
  })

  // GET /api/{scope}/{id}/{relationshipName}
  await api.addRoute({
    method: 'GET',
    path: `${scopePath}/:id/:relationshipName`,
    handler: createRouteHandler('getRelated'),
    routeMeta: { kind: 'relationship', scopeName, operation: 'getRelated' }
  })

  // POST /api/{scope}/{id}/relationships/{relationshipName}
  await api.addRoute({
    method: 'POST',
    path: `${scopePath}/:id/relationships/:relationshipName`,
    handler: createRouteHandler('postRelationship'),
    routeMeta: { kind: 'relationship', scopeName, operation: 'postRelationship' }
  })

  // PATCH /api/{scope}/{id}/relationships/{relationshipName}
  await api.addRoute({
    method: 'PATCH',
    path: `${scopePath}/:id/relationships/:relationshipName`,
    handler: createRouteHandler('patchRelationship'),
    routeMeta: { kind: 'relationship', scopeName, operation: 'patchRelationship' }
  })

  // DELETE /api/{scope}/{id}/relationships/{relationshipName}
  await api.addRoute({
    method: 'DELETE',
    path: `${scopePath}/:id/relationships/:relationshipName`,
    handler: createRouteHandler('deleteRelationship'),
    routeMeta: { kind: 'relationship', scopeName, operation: 'deleteRelationship' }
  })

  log.trace(`Registered relationship routes for scope: ${scopeName}`)
}
