import { getUrlPrefix } from '../../lib/querying/url-helpers.js'
import {
  determineResponseStatus,
  mapRestApiErrorToHttp
} from './transport-http-helpers.js'

export function extractQueryString (url = '') {
  return String(url || '').split('?')[1] || ''
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
    { vars: { transport: { mountPath } } },
    request
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

  await runHooks('transport:response', context)

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
  mountPath = ''
}) {
  if (String(method || '').toUpperCase() !== 'POST') return null
  if (!context?.id || !routeMeta?.scopeName || !helpers?.getLocation) return null

  const location = helpers.getLocation({
    scopeName: routeMeta.scopeName,
    id: context.id
  })

  const baseUrl = context.urlPrefix || mountPath
  return `${baseUrl}${location}`
}

export async function executeConnectorRoute ({
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
  runHooks
}) {
  const result = await handler({
    queryString,
    headers,
    params,
    body,
    context
  })

  const status = determineResponseStatus(method, result)
  const transportHeaders = await applyTransportResponseLifecycle({
    context,
    transportData,
    status,
    body: result,
    runHooks
  })

  return {
    status,
    body: status === 204 ? undefined : getConnectorResponseBody(result),
    headers: {
      ...(result?.headers || {}),
      ...transportHeaders
    },
    location: getConnectorLocationHeader({
      method,
      context,
      routeMeta,
      helpers,
      mountPath
    }),
    result
  }
}

export async function handleConnectorError ({
  error,
  context,
  transportData,
  runHooks
}) {
  const { status, body } = mapRestApiErrorToHttp(error)
  const headers = await applyTransportResponseLifecycle({
    context,
    transportData,
    status,
    body,
    runHooks
  })

  return { status, body, headers }
}
