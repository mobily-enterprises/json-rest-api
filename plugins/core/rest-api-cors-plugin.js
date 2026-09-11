import { mergeResponseHeaders } from './connectors/lib/transport-http-helpers.js'

export const CorsPlugin = {
  name: 'rest-api-cors',
  dependencies: ['rest-api'],

  async install ({ api, addHook, vars, log, pluginOptions = {} }) {
    if (!vars.transport) throw new Error('CorsPlugin requires an HTTP connector to be installed first')

    const corsConfig = {
      origin: pluginOptions.origin ?? '*',
      credentials: pluginOptions.credentials ?? true,
      methods: pluginOptions.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: pluginOptions.allowedHeaders ?? [
        'Content-Type', 'Authorization', 'X-Requested-With', 'X-HTTP-Method-Override', 'Accept', 'Origin'
      ],
      exposedHeaders: pluginOptions.exposedHeaders ?? ['X-Total-Count', 'X-Page-Count', 'Link', 'Location'],
      maxAge: pluginOptions.maxAge ?? 86400,
      optionsSuccessStatus: pluginOptions.optionsSuccessStatus ?? 204
    }
    vars.cors = corsConfig
    const originDecision = Symbol('corsOriginDecision')

    async function isOriginAllowed (origin, allowedOrigin) {
      if (!origin) return allowedOrigin === '*' && !corsConfig.credentials
      if (typeof allowedOrigin === 'string') return allowedOrigin === '*' || allowedOrigin === origin
      if (allowedOrigin instanceof RegExp) return new RegExp(allowedOrigin.source, allowedOrigin.flags).test(origin)
      if (Array.isArray(allowedOrigin)) {
        for (const candidate of allowedOrigin) if (await isOriginAllowed(origin, candidate)) return true
        return false
      }
      if (typeof allowedOrigin === 'function') return !!(await allowedOrigin(origin))
      return false
    }

    async function allowRequestOrigin (context) {
      if (!(originDecision in context)) {
        // If the predicate throws, the error response must not retry or grant access.
        context[originDecision] = false
        context[originDecision] = await isOriginAllowed(context.transport.request.headers?.origin, corsConfig.origin)
      }
      return context[originDecision]
    }

    await api.addRoute({
      method: 'OPTIONS',
      path: vars.transport.matchAll,
      handler: async ({ context }) => {
        if (!await allowRequestOrigin(context)) {
          return {
            statusCode: 403,
            body: { errors: [{ status: '403', title: 'Forbidden', detail: 'CORS origin not allowed' }] }
          }
        }
        return {
          statusCode: corsConfig.optionsSuccessStatus,
          headers: {
            'Access-Control-Allow-Methods': corsConfig.methods.join(', '),
            'Access-Control-Allow-Headers': corsConfig.allowedHeaders.join(', '),
            'Access-Control-Max-Age': String(corsConfig.maxAge)
          },
          body: null
        }
      }
    })

    addHook('transport:response', 'cors-headers', {}, async ({ context }) => {
      const { request, response } = context.transport || {}
      if (!request || !response) return

      const wildcard = corsConfig.origin === '*' && !corsConfig.credentials
      // Responses without a matching Origin must also have the correct cache key.
      if (!wildcard) response.headers = mergeResponseHeaders(response.headers, { vary: 'Origin' })
      if (!await allowRequestOrigin(context)) return

      const headers = { 'Access-Control-Allow-Origin': wildcard ? '*' : request.headers.origin }
      if (corsConfig.credentials) headers['Access-Control-Allow-Credentials'] = 'true'
      if (corsConfig.exposedHeaders.length) headers['Access-Control-Expose-Headers'] = corsConfig.exposedHeaders.join(', ')
      response.headers = mergeResponseHeaders(response.headers, headers)
    })

    log.info('CORS plugin installed', { origin: corsConfig.origin, credentials: corsConfig.credentials, methods: corsConfig.methods })
  }
}
