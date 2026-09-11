import { requirePackage } from 'hooked-api'
import onHeaders from 'on-headers'
import { getOperationDiagnosticContext } from '../../../lib/error-context.js'
import { createContext } from './lib/request-helpers.js'
import { createEnhancedLogger } from '../../../lib/enhanced-logger.js'
import {
  isWriteMethod,
  isAllowedWriteContentType,
  isMultipartContentType,
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
  handleConnectorError
} from './lib/connector-core.js'

export const ExpressPlugin = {
  name: 'express',
  dependencies: ['rest-api'],

  async install ({ vars, helpers, pluginOptions, log, scopes, api, runHooks, addHook }) {
    // Dynamic import for Express
    let express
    try {
      express = (await import('express')).default
    } catch (e) {
      requirePackage('express', 'express',
        'Express.js is required for HTTP server functionality. This is a peer dependency.')
    }
    // Initialize express namespace
    if (!api.http) {
      api.http = {}
    }
    api.http.express = {}

    const expressOptions = pluginOptions || {}
    const httpValidators = expressOptions.httpValidators ?? false
    if (typeof httpValidators !== 'boolean') throw new TypeError('httpValidators must be a boolean')

    // Get mountPath from options (this is now a transport concern)
    const mountPath = expressOptions.mountPath || ''
    const basePath = mountPath.replace(/\/+$/, '')
    const publicBaseUrl = expressOptions.publicBaseUrl || ''
    const strictContentType = expressOptions.strictContentType !== false
    const requestSizeLimit = expressOptions.requestSizeLimit || '1mb'

    // Set transport information for other plugins
    vars.transport = {
      type: 'express',
      matchAll: '*', // Express wildcard pattern for matching all routes
      mountPath, // Transport-specific mount path
      publicBaseUrl
    }

    // Register file detector if enabled
    if (expressOptions.enableFileUploads !== false && api.rest?.registerFileDetector) {
      const parserLib = expressOptions.fileParser || 'busboy'
      const parserOptions = expressOptions.fileParserOptions || {}

      let detector

      if (parserLib === 'busboy') {
        const { createBusboyDetector } = await import('./lib/busboy-detector.js')
        detector = createBusboyDetector(parserOptions)
      } else if (parserLib === 'formidable') {
        const { createFormidableDetector } = await import('./lib/formidable-detector.js')
        detector = createFormidableDetector(parserOptions)
      } else if (typeof parserLib === 'function') detector = await parserLib(parserOptions)
      else throw new Error('fileParser must be busboy, formidable, or a detector factory')

      if (!detector?.name || typeof detector.detect !== 'function' || typeof detector.parse !== 'function') {
        throw new Error('File detector must have name, detect() and parse()')
      }

      if (detector) {
        api.rest.registerFileDetector({
          name: `express-${detector.name}`,
          detect: (params, context) => {
            if (!context || !context.raw || !context.raw.req) return false
            const detectParams = { ...params, _expressReq: context.raw.req }
            return detector.detect(detectParams)
          },
          parse: (params, context) => {
            const parseParams = { ...params, _expressReq: context.raw.req, _expressRes: context.raw.res }
            return detector.parse(parseParams)
          }
        })
        log.info(`Express plugin registered file detector: ${detector.name}`)
      }
    }

    // Create Express routers
    const router = expressOptions.router || express.Router()
    const notFoundRouter = express.Router()

    const isApiPath = path => !basePath || path === basePath || path.startsWith(`${basePath}/`)
    const allowsMultipart = () => expressOptions.enableFileUploads !== false && !!api.rest?.fileDetectors?.length
    const ensureContext = (req, res) => {
      if (!req.context || !req.transportData) {
        const requestData = buildTransportRequestData({
          method: req.method,
          url: req.url,
          path: req.path,
          headers: req.headers,
          body: req.body,
          params: req.params,
          query: req.query
        })
        const { context, transportData } = createConnectorContext({
          request: req,
          reply: res,
          source: 'express',
          mountPath: basePath,
          publicBaseUrl,
          requestData,
          createContext,
          urlPrefixOverride: req.urlPrefixOverride
        })
        req.context = context
        req.transportData = transportData
      }
      return { context: req.context, transportData: req.transportData }
    }
    const applyHeaders = (res, headers) => res.set(mergeResponseHeaders({ vary: res.getHeader('Vary') }, headers, { vary: 'Accept' }))
    const sendResponse = async (req, res, status, body) => {
      const { context, transportData } = ensureContext(req, res)
      body = addWriteOutcomeToHttpErrors(body, context)
      const headers = await applyTransportResponseLifecycle({ context, transportData, status, body, runHooks })
      applyHeaders(res, headers)
      return res.status(status).type('application/vnd.api+json').json(body)
    }
    router.use((req, res, next) => next(isApiPath(req.path) ? undefined : 'router'))
    router.use((req, res, next) => {
      onHeaders(res, function () {
        if (httpValidators && req.method === 'PUT') this.removeHeader('ETag')
        if (String(this.getHeader('Content-Type')).split(';')[0] === 'application/vnd.api+json') {
          // Express adds a charset during JSON serialization; JSON:API forbids it.
          this.setHeader('Content-Type', 'application/vnd.api+json')
        }
      })
      next()
    })

    // Reject unsupported media types before a body parser can report a syntax error.
    if (strictContentType) {
      router.use((req, res, next) => {
        if (isWriteMethod(req.method) && !isAllowedWriteContentType(req.get('Content-Type'), { allowMultipart: allowsMultipart() })) {
          sendResponse(req, res, 415, getUnsupportedMediaTypeErrorBody({ allowMultipart: allowsMultipart() })).catch(next)
          return
        }
        next()
      })
    }

    // Add body parsing middleware
    router.use(express.json({
      limit: requestSizeLimit,
      strict: false,
      type: ['application/json', 'application/vnd.api+json']
    }))

    // Add transport hook middleware
    const handleTransportRequest = async (req, res, next) => {
      const { context } = ensureContext(req, res)
      const { rejected, handled } = await runTransportRequestLifecycle({
        context,
        runHooks
      })

      if (rejected) {
        return sendResponse(req, res, context.rejection.status || 500, buildTransportRejectionBody(context))
      }

      if (handled) {
        return
      }

      res.vary('Accept')
      if (!acceptsJsonApi(req.get('Accept'))) {
        return sendResponse(req, res, 406, getNotAcceptableErrorBody())
      }

      next()
    }
    router.use((req, res, next) => {
      handleTransportRequest(req, res, next).catch(next)
    })

    /**
     * Error handler - maps REST API errors to HTTP responses
     */
    const handleError = async (error, req, res, routeMeta) => {
      const { context, transportData } = ensureContext(req, res)
      const schemaInfo = scopes[routeMeta?.scopeName]?.vars?.schemaInfo || context.schemaInfo
      createEnhancedLogger(log, { schemaInfo }).logError('HTTP request error', error, {
        ...getOperationDiagnosticContext(context, {
          phase: 'httpError',
          method: req.method,
          scopeName: routeMeta?.scopeName || context.scopeName,
          backend: api.knex?.instance?.client?.config?.client
        }),
        path: req.route?.path
      })

      const { status, body: errorResponse, headers } = await handleConnectorError({
        error,
        context,
        transportData,
        runHooks
      })

      applyHeaders(res, headers)
      res.status(status).type('application/vnd.api+json').json(errorResponse)
    }

    /**
     * Listen to addRoute hook to create Express routes
     */
    addHook('addRoute', 'expressRouteCreator', {}, async ({ context }) => {
      const { method, path, handler, routeMeta } = context

      // Apply any global before middleware
      const beforeMiddleware = expressOptions.middleware?.beforeAll || []

      try {
        // Extract the handler logic into a shared function to keep it DRY (Don't Repeat Yourself).
        const expressHandler = async (req, res) => {
          try {
            const { context, transportData } = ensureContext(req, res)

            const outcome = await executeConnectorRoute({
              api,
              httpValidators,
              method: req.method,
              handler,
              queryString: extractQueryString(req.url),
              headers: req.headers,
              params: req.params,
              body: isMultipartContentType(req.get('Content-Type')) && routeMeta?.kind === 'resource' && ['post', 'put', 'patch'].includes(routeMeta.operation)
                ? { data: { type: routeMeta.scopeName, attributes: {} } }
                : req.body,
              context,
              transportData,
              routeMeta,
              helpers,
              mountPath: basePath,
              publicBaseUrl,
              runHooks
            })
            applyHeaders(res, outcome.headers)

            // Set content type
            res.set('Content-Type', 'application/vnd.api+json')

            if (outcome.location) {
              res.set('Location', outcome.location)
            }

            // Handle response based on status
            if (outcome.status === 204) {
              res.sendStatus(204)
            } else if (outcome.serialized) {
              res.status(outcome.status).send(outcome.body)
            } else {
              res.status(outcome.status).json(outcome.body)
            }
          } catch (error) {
            await handleError(error, req, res, routeMeta)
          }
        }

        // CRITICAL: Express routing method selection - wildcard vs specific routes
        //
        // Express provides two different ways to register routes:
        // 1. router.METHOD(path, handler) - e.g., router.get('/users', handler)
        //    - Only responds to the SPECIFIC HTTP method
        //    - Perfect for normal REST endpoints
        //
        // 2. router.use(path, handler)
        //    - Responds to ALL HTTP methods
        //    - Needed for wildcard paths that must handle any method
        //
        // The CORS plugin needs wildcard routes because it must handle OPTIONS
        // requests for ANY path under the API prefix, even paths that don't exist
        // as defined routes. For example:
        // - Defined route: GET /api/users
        // - Browser might send: OPTIONS /api/users/invalid/path
        // - CORS must still respond with proper headers
        //
        if (path === vars.transport.matchAll) {
          // This is a wildcard route (path = '*')
          // We MUST use router.use() because:
          // - We need to catch ALL paths (using '*' or '/api/*')
          // - We need to handle a SPECIFIC method (e.g., OPTIONS)
          // - router.options('*') would NOT work for paths like '/api/some/nested/path'

          // Since router.use() responds to ALL methods, we need a wrapper
          // that only handles our specific method (e.g., OPTIONS)
          const methodSpecificMiddleware = (req, res, next) => {
            if (req.method.toLowerCase() === method.toLowerCase()) {
              expressHandler(req, res)
            } else {
              // Not our method, pass to next middleware
              next()
            }
          }
          // IMPORTANT: We do NOT need to pass a path to router.use() here!
          // When no path is provided, router.use() matches ALL requests
          // This is exactly what we want for wildcard routes
          router.use(...beforeMiddleware, methodSpecificMiddleware)
        } else {
          // This is a normal route with a specific path (e.g., '/api/users')
          // We use router.METHOD() because:
          // - We want to respond to ONLY this specific HTTP method
          // - The path is exact, not a wildcard
          // - This is more efficient than router.use() with method checking
          //
          // Note: Routes from RestApiPlugin already include the full path with mountPath
          // So we use them as-is without adding basePath to avoid double-prefixing

          router[method.toLowerCase()](path, ...beforeMiddleware, expressHandler)

          // Debug logging for route registration
        }
      } catch (routeError) {
        log.error('[EXPRESS DEBUG] Error creating route:', {
          error: routeError.message,
          stack: routeError.stack,
          path,
          method: method.toLowerCase()
        })
        throw routeError
      }

      const logPath = path === vars.transport.matchAll
        ? '(all paths)'  // router.use() with no path matches everything
        : path
      log.trace(`Express route created: ${method} ${logPath}`)
    })

    // Apply global middleware if configured
    const finalRouter = express.Router()
    if (expressOptions.middleware?.beforeAll) {
      finalRouter.use(...expressOptions.middleware.beforeAll)
    }
    finalRouter.use(router)
    // Catch parser, request-hook and route-matching errors on Express 4 and 5.
    finalRouter.use((error, req, res, next) => {
      if (res.headersSent) return next(error)
      handleError(error, req, res).catch(next)
    })

    // Set up 404 handler in separate router (unless disabled)
    if (expressOptions.handle404 !== false) {
      const handleNotFound = async (req, res, next) => {
        if (isApiPath(req.path)) {
          await sendResponse(req, res, 404, getNotFoundErrorBody(req.method, req.path))
        } else {
          next()
        }
      }
      notFoundRouter.use((req, res, next) => {
        handleNotFound(req, res, next).catch(error => handleError(error, req, res).catch(next))
      })
    }

    // Store routers in api.http.express namespace
    api.http.express.router = finalRouter
    api.http.express.notFoundRouter = notFoundRouter

    // Allow other plugins to add middleware before 404 handler
    const beforeNotFoundMiddleware = []
    api.http.express.beforeNotFound = (middleware) => {
      beforeNotFoundMiddleware.push(middleware)
    }

    // Add convenient mounting method
    api.http.express.mount = (app, path = '') => {
      // Mount main router with all routes
      app.use(path, finalRouter)

      // Mount any middleware that should come before 404
      beforeNotFoundMiddleware.forEach(middleware => {
        app.use(path, middleware)
      })

      // Mount 404 handler router after all other routes (if enabled)
      if (expressOptions.handle404 !== false) {
        app.use(path, notFoundRouter)
      }

      log.info(`Express routes mounted at ${path || '/'}`)
    }

    log.info('Express plugin initialized successfully')
  }
}
