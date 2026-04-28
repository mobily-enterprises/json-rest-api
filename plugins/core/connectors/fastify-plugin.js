import { createContext } from './lib/request-helpers.js'
import { createEnhancedLogger } from '../../../lib/enhanced-logger.js'
import { buildFastifyRouteSchema } from './lib/fastify-transport-schemas.js'
import { getUrlPrefix } from '../lib/querying/url-helpers.js'
import {
  isWriteMethod,
  isAllowedWriteContentType,
  getUnsupportedMediaTypeErrorBody,
  determineResponseStatus,
  mapRestApiErrorToHttp
} from './lib/transport-http-helpers.js'

function getQueryString (request) {
  const rawUrl = request?.raw?.url || request?.url || ''
  return rawUrl.split('?')[1] || ''
}

function applyHeaders (reply, headers = {}) {
  for (const [headerName, headerValue] of Object.entries(headers)) {
    reply.header(headerName, headerValue)
  }
}

function registerVendorJsonParser (app) {
  if (typeof app?.addContentTypeParser !== 'function') return
  if (typeof app?.hasContentTypeParser === 'function' && app.hasContentTypeParser('application/vnd.api+json')) {
    return
  }

  app.addContentTypeParser(
    'application/vnd.api+json',
    { parseAs: 'string' },
    (request, body, done) => {
      if (body === '' || body === undefined || body === null) {
        done(null, {})
        return
      }

      try {
        done(null, JSON.parse(body))
      } catch (error) {
        error.statusCode = 400
        done(error)
      }
    }
  )
}

export const FastifyPlugin = {
  name: 'fastify',
  dependencies: ['rest-api'],

  async install ({ vars, helpers, pluginOptions, log, api, runHooks, addHook }) {
    const fastifyOptions = pluginOptions || {}
    const app = fastifyOptions.app

    if (!app || typeof app.route !== 'function') {
      throw new Error('FastifyPlugin requires a Fastify instance in pluginOptions.app.')
    }

    const enhancedLog = createEnhancedLogger(log, {
      logFullErrors: true,
      includeStack: true
    })

    if (!api.http) {
      api.http = {}
    }
    api.http.fastify = { app }

    const mountPath = fastifyOptions.mountPath || ''
    const strictContentType = fastifyOptions.strictContentType !== false

    vars.transport = {
      type: 'fastify',
      matchAll: '*',
      mountPath
    }

    registerVendorJsonParser(app)

    const buildFastifyHandler = ({ method, path, handler, routeMeta }) => {
      const routeSchema = buildFastifyRouteSchema({ routeMeta, api })

      const fastifyErrorHandler = async (error, request, reply) => {
        enhancedLog.logError('Fastify request error', error, {
          method: request.method,
          path: request.url
        })

        const context = request.jsonRestContext || createContext(request, reply, 'fastify')
        const { status, body } = mapRestApiErrorToHttp(error)

        if (context.transport) {
          context.transport.response.status = status
          context.transport.response.body = body
          await runHooks('transport:response', context)
          applyHeaders(reply, context.transport.response.headers)
        }

        reply.code(status)
        reply.type('application/vnd.api+json')
        return reply.send(body)
      }

      const preValidation = async (request, reply) => {
        if (!strictContentType || !isWriteMethod(method)) {
          return
        }

        const contentType = request.headers?.['content-type'] || ''
        if (isAllowedWriteContentType(contentType)) {
          return
        }

        reply.code(415)
        reply.type('application/vnd.api+json')
        return reply.send(getUnsupportedMediaTypeErrorBody())
      }

      return {
        method,
        url: path,
        ...(routeSchema ? { schema: routeSchema } : {}),
        errorHandler: fastifyErrorHandler,
        preValidation,
        handler: async (request, reply) => {
          const context = createContext(request, reply, 'fastify')

          context.urlPrefix = getUrlPrefix(
            context,
            { vars: { transport: { mountPath } } },
            request
          )

          const transportData = {
            request: {
              method: request.method,
              url: request.url,
              path: request.url,
              headers: request.headers,
              body: request.body,
              params: request.params,
              query: request.query
            },
            response: {
              headers: {},
              status: null
            }
          }

          context.transport = transportData
          request.jsonRestContext = context

          await runHooks('transport:request', context)

          if (context.rejection) {
            const rejectionBody = {
              errors: [{
                status: String(context.rejection.status || 500),
                title: context.rejection.title || 'Request Rejected',
                detail: context.rejection.message
              }]
            }
            applyHeaders(reply, transportData.response.headers)
            reply.code(context.rejection.status || 500)
            reply.type('application/vnd.api+json')
            return reply.send(rejectionBody)
          }

          if (context.handled) {
            return
          }

          const result = await handler({
            queryString: getQueryString(request),
            headers: request.headers,
            params: request.params,
            body: request.body,
            context
          })

          const responseStatus = determineResponseStatus(method, result)

          if (result?.headers) {
            applyHeaders(reply, result.headers)
          }

          transportData.response.status = responseStatus
          transportData.response.body = result
          await runHooks('transport:response', context)
          applyHeaders(reply, transportData.response.headers)

          reply.type('application/vnd.api+json')

          if (method === 'POST' && context.id && routeMeta?.scopeName && helpers.getLocation) {
            const location = helpers.getLocation({ scopeName: routeMeta.scopeName, id: context.id })
            const baseUrl = context.urlPrefix || mountPath
            reply.header('Location', `${baseUrl}${location}`)
          }

          if (responseStatus === 204) {
            reply.code(204)
            return reply.send()
          }

          const responseBody = result && result.body !== undefined ? result.body : result
          reply.code(responseStatus)
          return reply.send(responseBody)
        }
      }
    }

    addHook('addRoute', 'fastifyRouteCreator', {}, async ({ context }) => {
      const route = buildFastifyHandler(context)
      app.route(route)
      log.trace(`Fastify route created: ${context.method} ${context.path}`)
    })

    log.info('Fastify plugin initialized successfully')
  }
}
