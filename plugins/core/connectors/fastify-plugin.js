import { createContext } from './lib/request-helpers.js'
import { createEnhancedLogger } from '../../../lib/enhanced-logger.js'
import { buildTransportRouteSchema } from './lib/transport-route-schemas.js'
import {
  isWriteMethod,
  isAllowedWriteContentType,
  getUnsupportedMediaTypeErrorBody
} from './lib/transport-http-helpers.js'
import {
  extractQueryString,
  buildTransportRequestData,
  createConnectorContext,
  runTransportRequestLifecycle,
  buildTransportRejectionBody,
  executeConnectorRoute,
  handleConnectorError
} from './lib/connector-core.js'

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
      const routeSchema = buildTransportRouteSchema({ routeMeta, api })

      const fastifyErrorHandler = async (error, request, reply) => {
        enhancedLog.logError('Fastify request error', error, {
          method: request.method,
          path: request.url
        })

        const context = request.jsonRestContext || null
        const transportData = context?.transport || null
        const { status, body, headers } = await handleConnectorError({
          error,
          context,
          transportData,
          runHooks
        })

        applyHeaders(reply, headers)
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
          const requestData = buildTransportRequestData({
            method: request.method,
            url: request.url,
            path: request.url,
            headers: request.headers,
            body: request.body,
            params: request.params,
            query: request.query
          })
          const { context, transportData } = createConnectorContext({
            request,
            reply,
            source: 'fastify',
            mountPath,
            requestData,
            createContext
          })
          request.jsonRestContext = context

          const { rejected, handled } = await runTransportRequestLifecycle({
            context,
            runHooks
          })

          if (rejected) {
            const rejectionBody = buildTransportRejectionBody(context)
            applyHeaders(reply, transportData.response.headers)
            reply.code(context.rejection.status || 500)
            reply.type('application/vnd.api+json')
            return reply.send(rejectionBody)
          }

          if (handled) {
            return
          }

          const outcome = await executeConnectorRoute({
            method,
            handler,
            queryString: extractQueryString(request?.raw?.url || request?.url || ''),
            headers: request.headers,
            params: request.params,
            body: request.body,
            context,
            transportData,
            routeMeta,
            helpers,
            mountPath,
            runHooks
          })

          applyHeaders(reply, outcome.headers)
          reply.type('application/vnd.api+json')

          if (outcome.location) {
            reply.header('Location', outcome.location)
          }

          if (outcome.status === 204) {
            reply.code(204)
            return reply.send()
          }

          reply.code(outcome.status)
          return reply.send(outcome.body)
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
