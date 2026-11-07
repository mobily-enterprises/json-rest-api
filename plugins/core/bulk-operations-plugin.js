import { RestApiValidationError } from '../../lib/rest-api-errors.js'

const DEFAULT_MAX_BULK_OPERATIONS = 1000

/**
 * HTTP routes for many-row writes: POST, PATCH and DELETE /<type>/bulk run
 * postMany, patchMany and deleteMany, one statement per chunk and all or
 * nothing. Programs call those methods directly; this plugin only exposes them
 * over HTTP with a request size limit.
 */
export const BulkOperationsPlugin = {
  name: 'bulk-operations',
  dependencies: ['rest-api'],

  async install ({ api, log, addHook, pluginOptions }) {
    const bulkOptions = pluginOptions || {}
    const { maxBulkOperations = DEFAULT_MAX_BULK_OPERATIONS } = bulkOptions
    const unknown = Object.keys(bulkOptions).filter(name => name !== 'maxBulkOperations')
    if (unknown.length) {
      throw new RestApiValidationError(`Unsupported bulk options: ${unknown.join(', ')}. Bulk routes are all-or-nothing and take only maxBulkOperations.`, { fields: unknown })
    }
    if (!Number.isSafeInteger(maxBulkOperations) || maxBulkOperations < 1) {
      throw new RestApiValidationError('maxBulkOperations must be a positive safe integer', { fields: ['maxBulkOperations'] })
    }

    log.info('Installing Bulk Operations plugin', { maxBulkOperations })

    // The body's data array, checked against the limit before anything runs.
    const bodyRows = (body, queryString) => {
      const query = [...new URLSearchParams(queryString).keys()]
      if (query.length) {
        throw new RestApiValidationError(`Bulk routes take no query parameters: ${query.join(', ')}`, { fields: query })
      }
      const rows = body?.data
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new RestApiValidationError('A bulk request body is { data: [...] } with at least one entry', {
          fields: ['data'],
          violations: [{ field: 'data', rule: 'required_array', message: 'Must be a non-empty array' }]
        })
      }
      if (rows.length > maxBulkOperations) {
        throw new RestApiValidationError(`Bulk requests are limited to ${maxBulkOperations} entries`, {
          fields: ['data'],
          violations: [{ field: 'data', rule: 'max_items', message: `Cannot process more than ${maxBulkOperations} entries at once` }]
        })
      }
      return rows
    }

    addHook('resource:added', 'bulkOperationsRoutes', { beforeFunction: 'registerScopeRoutes' }, async ({ context: { scopeName } }) => {
      const urlPrefix = api.vars.transport?.mountPath || ''
      const path = `${urlPrefix}/${scopeName}/bulk`
      const resource = () => api.resources[scopeName]

      // Body: { data: [resource objects] }; responds 201 { data: [records] }.
      await api.addRoute({
        method: 'POST',
        path,
        handler: async ({ context, body, queryString }) => {
          bodyRows(body, queryString)
          const result = await resource().postMany({ document: body, format: 'jsonapi', returning: 'full' }, context)
          return { statusCode: 201, body: result }
        }
      })

      // Body: { data: [resource objects with id] }; responds 200 { data: [records] }.
      await api.addRoute({
        method: 'PATCH',
        path,
        handler: async ({ context, body, queryString }) => {
          bodyRows(body, queryString)
          const result = await resource().patchMany({ document: body, format: 'jsonapi', returning: 'full' }, context)
          return { statusCode: 200, body: result }
        }
      })

      // Body: { data: [{ type, id }] }; responds 200 { data: [the deleted identifiers] }.
      await api.addRoute({
        method: 'DELETE',
        path,
        handler: async ({ context, body, queryString }) => {
          const ids = bodyRows(body, queryString).map((identifier, index) => {
            if (identifier?.type !== scopeName || identifier.id === undefined || identifier.id === null) {
              throw new RestApiValidationError(`data[${index}] must be a resource identifier { type: '${scopeName}', id }`, { fields: [`data[${index}]`] })
            }
            return identifier.id
          })
          const result = await resource().deleteMany({ ids, returning: 'minimal' }, context)
          return { statusCode: 200, body: result }
        }
      })

      log.debug(`Added bulk operation routes for scope: ${scopeName}`)
    })

    log.info('Bulk Operations plugin installed successfully')
  }
}
