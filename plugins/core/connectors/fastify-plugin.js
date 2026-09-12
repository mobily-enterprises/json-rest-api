import { createContext } from './lib/request-helpers.js'
import { buildTransportRouteSchema, getTransportRouteContract } from './lib/transport-route-schemas.js'
import { validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import {
  isWriteMethod,
  isAllowedWriteContentType,
  mergeResponseHeaders,
  acceptsJsonApi,
  getNotAcceptableErrorBody,
  getNotFoundErrorBody,
  getUnsupportedMediaTypeErrorBody
} from './lib/transport-http-helpers.js'
import {
  extractQueryString,
  buildTransportRequestData,
  createConnectorContext,
  runTransportRequestLifecycle,
  applyTransportResponseLifecycle,
  addWriteOutcomeToHttpErrors,
  buildTransportRejectionBody,
  executeConnectorRoute,
  logHttpRequestError,
  handleConnectorError
} from './lib/connector-core.js'

function applyHeaders (reply, headers = {}) {
  const merged = mergeResponseHeaders({ vary: reply.getHeader('vary') }, headers, { vary: 'Accept' })
  for (const [headerName, headerValue] of Object.entries(merged)) {
    reply.header(headerName, headerValue)
  }
}

async function setJsonApiResponseType (request, reply, payload) {
  // Fastify adds a charset during serialization; normalize after that step.
  reply.header('Content-Type', 'application/vnd.api+json')
  return payload
}

function registerJsonParsers (app) {
  const parse = (request, body, done) => {
    try { done(null, body === '' ? {} : JSON.parse(body)) } catch (error) {
      error.statusCode = 400
      error.type = 'entity.parse.failed'
      done(error)
    }
  }
  for (const contentType of ['application/json', 'application/vnd.api+json']) {
    if (app.hasContentTypeParser(contentType)) app.removeContentTypeParser(contentType)
    app.addContentTypeParser(contentType, { parseAs: 'string' }, parse)
  }
}

export const FastifyPlugin = {
  name: 'fastify',
  dependencies: ['rest-api'],

  async install ({ vars, helpers, pluginOptions, log, api, scopes, runHooks, addHook }) {
    const fastifyOptions = pluginOptions || {}
    const httpValidators = fastifyOptions.httpValidators ?? false
    if (typeof httpValidators !== 'boolean') throw new TypeError('httpValidators must be a boolean')
    const app = fastifyOptions.app

    if (!app || typeof app.route !== 'function') {
      throw new Error('FastifyPlugin requires a Fastify instance in pluginOptions.app.')
    }

    if (!api.http) {
      api.http = {}
    }
    api.http.fastify = { app }

    const mountPath = fastifyOptions.mountPath || ''
    const publicBaseUrl = fastifyOptions.publicBaseUrl || ''
    const strictContentType = fastifyOptions.strictContentType !== false

    vars.transport = {
      type: 'fastify',
      matchAll: '*',
      mountPath,
      publicBaseUrl
    }

    const ensureContext = (request, reply) => {
      if (!request.jsonRestContext) {
        const requestData = buildTransportRequestData({
          method: request.method,
          url: request.url,
          path: request.url,
          headers: request.headers,
          body: request.body,
          params: request.params,
          query: request.query
        })
        const { context } = createConnectorContext({
          request, reply, source: 'fastify', mountPath, publicBaseUrl, requestData, createContext
        })
        request.jsonRestContext = context
      }
      return request.jsonRestContext
    }
    const sendResponse = async (request, reply, status, body) => {
      const context = ensureContext(request, reply)
      body = addWriteOutcomeToHttpErrors(body, context)
      const headers = await applyTransportResponseLifecycle({ context, transportData: context.transport, status, body, runHooks })
      applyHeaders(reply, headers)
      return reply.code(status).type('application/vnd.api+json').send(body)
    }

    const buildFastifyHandler = ({ method, path, handler, routeMeta }) => {
      const routeSchema = buildTransportRouteSchema({ routeMeta, api })

      const fastifyErrorHandler = async (error, request, reply) => {
        const context = ensureContext(request, reply)
        await logHttpRequestError({
          error,
          context,
          log,
          scopes,
          routeMeta,
          api,
          method: request.method,
          path,
          message: 'Fastify request error'
        })

        const transportData = context.transport
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
        const context = ensureContext(request, reply)
        const { rejected, handled } = await runTransportRequestLifecycle({ context, runHooks })
        if (rejected) {
          return sendResponse(request, reply, context.rejection.status || 500, buildTransportRejectionBody(context))
        }
        if (handled) return

        applyHeaders(reply)
        if (!acceptsJsonApi(request.headers?.accept)) {
          return sendResponse(request, reply, 406, getNotAcceptableErrorBody())
        }
      }

      const preParsing = async (request, reply, payload) => {
        if (strictContentType && isWriteMethod(request.method) && !isAllowedWriteContentType(request.headers?.['content-type'])) {
          await sendResponse(request, reply, 415, getUnsupportedMediaTypeErrorBody())
          return
        }
        return payload
      }

      return {
        method,
        url: path,
        ...(routeSchema
          ? {
              schema: routeSchema,
              // Use the existing request contract without Ajv's field removal or coercion.
              validatorCompiler: () => (payload) => {
                try {
                  const contract = getTransportRouteContract({ routeMeta, api })
                  return { value: validateRequestContractOrThrow(contract, payload) }
                } catch (error) { return { error } }
              }
            }
          : {}),
        errorHandler: fastifyErrorHandler,
        onSend: setJsonApiResponseType,
        preParsing,
        preValidation,
        handler: async (request, reply) => {
          const context = request.jsonRestContext
          if (context.handled) return
          const transportData = context.transport

          const outcome = await executeConnectorRoute({
            api,
            httpValidators,
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
            publicBaseUrl,
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

    const pendingRoutes = []
    let registerRoute = route => pendingRoutes.push(route)
    app.register(async (instance) => {
      registerJsonParsers(instance)
      registerRoute = route => instance.route(route)
      for (const route of pendingRoutes.splice(0)) registerRoute(route)

      if (fastifyOptions.handle404 !== false) {
        instance.register(async (fallback) => {
          const route = buildFastifyHandler({
            method: 'GET',
            handler: async ({ context }) => ({
              statusCode: 404,
              body: getNotFoundErrorBody(context.transport.request.method, context.transport.request.path.split('?')[0])
            })
          })
          fallback.setErrorHandler(route.errorHandler)
          fallback.addHook('onSend', setJsonApiResponseType)
          fallback.addHook('preParsing', route.preParsing)
          fallback.setNotFoundHandler({ preValidation: route.preValidation }, route.handler)
        }, { prefix: mountPath })
      }
    })

    addHook('addRoute', 'fastifyRouteCreator', {}, async ({ context }) => {
      registerRoute(buildFastifyHandler(context))
      log.trace(`Fastify route created: ${context.method} ${context.path}`)
    })

    log.info('Fastify plugin initialized successfully')
  }
}
