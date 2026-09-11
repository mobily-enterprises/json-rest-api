import { getUrlPrefix } from '../../lib/querying/url-helpers.js'
import { lockRelationshipParent } from '../../lib/writing/relationship-processor.js'
import { parseJsonApiQuery } from '../../lib/querying-writing/connectors-query-parser.js'
import { serializableTransaction } from '../../../../lib/knex-transaction.js'
import { cloneRequestHeaders } from './request-helpers.js'
import { RestApiPreconditionFailedError, RestApiValidationError, RestApiWriteError } from '../../../../lib/rest-api-errors.js'
import { createStrongEntityTag, matchesIfMatch, parseIfMatch } from './http-validators.js'
import { getWriteOutcome, wrapWriteError } from '../../../../lib/error-context.js'
import {
  determineResponseStatus,
  isWriteMethod,
  mapRestApiErrorToHttp,
  mergeResponseHeaders
} from './transport-http-helpers.js'

const responseLifecycleStarted = Symbol('responseLifecycleStarted')

export function extractQueryString (url = '') {
  const value = String(url || '')
  const index = value.indexOf('?')
  return index === -1 ? '' : value.slice(index + 1)
}

export function buildTransportRequestData ({
  method,
  url,
  path,
  headers,
  body,
  params,
  query
}) {
  return {
    method,
    url,
    path,
    headers,
    body,
    params,
    query
  }
}

export function buildTransportData (requestData) {
  return {
    request: requestData,
    response: {
      headers: {},
      status: null
    }
  }
}

export function createConnectorContext ({
  request,
  reply,
  source,
  mountPath = '',
  publicBaseUrl = '',
  requestData,
  createContext,
  urlPrefixOverride
}) {
  const context = createContext(request, reply, source)

  if (urlPrefixOverride) {
    context.urlPrefixOverride = urlPrefixOverride
  }

  context.urlPrefix = getUrlPrefix(
    context,
    { vars: { transport: { mountPath, publicBaseUrl } } }
  )

  const transportData = buildTransportData(requestData)
  context.transport = transportData

  return { context, transportData }
}

export async function runTransportRequestLifecycle ({ context, runHooks }) {
  await runHooks('transport:request', context)

  return {
    rejected: !!context.rejection,
    handled: !!context.handled
  }
}

export function addWriteOutcomeToHttpErrors (body, context) {
  if (!isWriteMethod(context.transport?.request?.method) || !Array.isArray(body?.errors)) return body
  return {
    ...body,
    errors: body.errors.map(error => ({
      ...error,
      meta: { ...error.meta, transactionOutcome: error.meta?.transactionOutcome || getWriteOutcome(context) }
    }))
  }
}

export function buildTransportRejectionBody (context) {
  return {
    errors: [{
      status: String(context.rejection?.status || 500),
      title: context.rejection?.title || 'Request Rejected',
      detail: context.rejection?.message
    }]
  }
}

export async function applyTransportResponseLifecycle ({
  context,
  transportData,
  status,
  body,
  runHooks
}) {
  if (!context || !transportData) {
    return {}
  }

  transportData.response.status = status
  transportData.response.body = body
  context.transport = transportData

  // A failing response hook is reported as an error, without rerunning hooks.
  if (!context[responseLifecycleStarted]) {
    context[responseLifecycleStarted] = true
    await runHooks('transport:response', context)
  }

  return transportData.response.headers || {}
}

export function getConnectorResponseBody (result) {
  return result && result.body !== undefined ? result.body : result
}

export function getConnectorLocationHeader ({
  method,
  context,
  routeMeta,
  helpers,
  mountPath = '',
  publicBaseUrl = ''
}) {
  if (String(method || '').toUpperCase() !== 'POST') return null
  if (context?.id === undefined || context.id === null || !routeMeta?.scopeName || !helpers?.getLocation) return null

  const location = helpers.getLocation({
    scopeName: routeMeta.scopeName,
    id: context.id
  })

  const baseUrl = getUrlPrefix(context, {
    vars: { transport: { mountPath, publicBaseUrl } }
  })
  return `${baseUrl}${location}`
}

export async function executeConnectorRoute ({
  api,
  httpValidators = false,
  method,
  handler,
  queryString,
  headers,
  params,
  body,
  context,
  transportData,
  routeMeta,
  helpers,
  mountPath = '',
  publicBaseUrl = '',
  runHooks
}) {
  const requestMethod = String(method).toUpperCase()
  const ignoreConditions = ['OPTIONS', 'CONNECT', 'TRACE'].includes(requestMethod)
  const condition = httpValidators && !ignoreConditions ? parseIfMatch(headers?.['if-match']) : undefined
  const isGet = ['GET', 'HEAD'].includes(requestMethod)
  const conditionalWrite = condition !== undefined && !isGet && routeMeta?.kind === 'resource' && ['put', 'patch', 'delete'].includes(routeMeta.operation)
  if (condition !== undefined && !isGet && !conditionalWrite) {
    throw new RestApiValidationError('If-Match is not supported for this route', { fields: ['headers.if-match'] })
  }
  const request = {
    queryString,
    headers,
    params,
    body,
    context
  }
  let result
  if (conditionalWrite) {
    result = await api.transaction(async transaction => {
      const readTransport = buildTransportData({ ...transportData.request, headers: cloneRequestHeaders(transportData.request.headers), method: 'GET', body: undefined })
      let readContext
      if (condition.wildcard) {
        readContext = { ...context }
      } else {
        readContext = {
          ...context,
          request: { ...context.request, headers: cloneRequestHeaders(context.request?.headers), method: 'GET' },
          transport: readTransport,
          precondition: true
        }
      }
      let preconditionPassed = false
      const precondition = async () => {
        preconditionPassed = false
        let representation
        try {
          representation = await api.resources[routeMeta.scopeName].get({
            id: params.id,
            format: 'jsonapi',
            transaction,
            ...(condition.wildcard ? {} : { queryParams: parseJsonApiQuery(queryString) })
          }, readContext)
          await lockRelationshipParent({ context: readContext, helpers, scopeName: routeMeta.scopeName })
        } catch (error) {
          // Conditional PUT requires an existing visible representation.
          if (routeMeta.operation === 'put' && error.subtype === 'not_found') {
            throw new RestApiPreconditionFailedError({ resourceType: routeMeta.scopeName, resourceId: params.id })
          }
          throw error
        }
        if (!condition.wildcard) {
          await applyTransportResponseLifecycle({ context: readContext, transportData: readTransport, status: 200, body: representation, runHooks })
          const bytes = JSON.stringify(getConnectorResponseBody(readTransport.response.body))
          const tag = bytes === undefined ? undefined : parseIfMatch(createStrongEntityTag(bytes)).tags[0]
          if (!matchesIfMatch(condition, { exists: bytes !== undefined, tag })) {
            throw new RestApiPreconditionFailedError({ resourceType: routeMeta.scopeName, resourceId: params.id })
          }
        }
        preconditionPassed = true
      }
      const result = await handler({ ...request, transaction, precondition })
      if (!preconditionPassed) throw new RestApiValidationError('Resource handler did not evaluate its HTTP precondition', { fields: ['headers.if-match'] })
      return result
    }, { [serializableTransaction]: !condition.wildcard })
  } else {
    result = await handler(request)
  }

  const status = determineResponseStatus(method, result)
  const location = getConnectorLocationHeader({
    method,
    context,
    routeMeta,
    helpers,
    mountPath,
    publicBaseUrl
  })
  const transportHeaders = await applyTransportResponseLifecycle({
    context,
    transportData,
    status,
    body: result,
    runHooks
  })

  let responseBody
  if (status !== 204) {
    const response = context && transportData ? transportData.response.body : result
    responseBody = getConnectorResponseBody(response)
  }
  const serialized = httpValidators && isGet && status === 200 && responseBody !== undefined
  const responseBytes = serialized ? JSON.stringify(responseBody) : undefined
  const validatorHeaders = serialized ? { etag: createStrongEntityTag(responseBytes) } : undefined
  if (condition !== undefined && isGet && status >= 200 && status < 300) {
    const tag = validatorHeaders ? parseIfMatch(validatorHeaders.etag).tags[0] : undefined
    if (!matchesIfMatch(condition, { exists: status === 200, tag })) {
      throw new RestApiPreconditionFailedError({ resourceType: routeMeta?.scopeName, resourceId: params?.id })
    }
  }
  return {
    status,
    body: serialized ? responseBytes : responseBody,
    serialized,
    headers: mergeResponseHeaders(result?.headers, transportHeaders, validatorHeaders),
    location,
    result
  }
}

export async function handleConnectorError ({
  error,
  context,
  transportData,
  runHooks
}) {
  const write = isWriteMethod(transportData?.request?.method)
  if (write && !(error instanceof RestApiWriteError)) error = wrapWriteError(error, context)
  const { status, body } = mapRestApiErrorToHttp(error)
  try {
    const headers = await applyTransportResponseLifecycle({ context, transportData, status, body, runHooks })
    return { status, body: context && transportData ? transportData.response.body : body, headers }
  } catch (responseError) {
    const failure = new AggregateError([error, responseError], 'Request and response hook failed', { cause: error })
    const outcome = mapRestApiErrorToHttp(write ? wrapWriteError(failure, context) : failure)
    // The first attempt marked the lifecycle started, so this only updates metadata.
    const headers = await applyTransportResponseLifecycle({ context, transportData, ...outcome, runHooks })
    return { ...outcome, headers }
  }
}
