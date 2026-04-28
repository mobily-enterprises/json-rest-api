export class FakeFastifyApp {
  constructor () {
    this.routes = []
    this.parsers = []
  }

  route (definition) {
    this.routes.push(definition)
  }

  addContentTypeParser (contentType, options, parser) {
    this.parsers.push({ contentType, options, parser })
  }

  hasContentTypeParser (contentType) {
    return this.parsers.some((entry) => entry.contentType === contentType)
  }
}

export class FakeReply {
  constructor () {
    this.statusCode = null
    this.contentType = null
    this.headers = {}
    this.payload = undefined
  }

  code (statusCode) {
    this.statusCode = statusCode
    return this
  }

  type (contentType) {
    this.contentType = contentType
    return this
  }

  header (name, value) {
    this.headers[name] = value
    return this
  }

  send (payload) {
    this.payload = payload
    return this
  }
}

export function findFastifyRoute (app, method, url) {
  return app.routes.find((route) => route.method === method && route.url === url)
}

export async function invokeFastifyRoute (
  app,
  {
    method,
    routeUrl,
    requestUrl = routeUrl,
    headers = {},
    body,
    params = {},
    query = {}
  }
) {
  const route = findFastifyRoute(app, method, routeUrl)
  if (!route) {
    throw new Error(`Fastify route not found: ${method} ${routeUrl}`)
  }

  const reply = new FakeReply()
  const request = {
    method,
    url: requestUrl,
    raw: { url: requestUrl },
    headers,
    body,
    params,
    query
  }

  if (typeof route.preValidation === 'function') {
    await route.preValidation(request, reply)
    if (reply.statusCode !== null || reply.payload !== undefined) {
      return { route, request, reply }
    }
  }

  try {
    await route.handler(request, reply)
  } catch (error) {
    if (typeof route.errorHandler === 'function') {
      await route.errorHandler(error, request, reply)
    } else {
      throw error
    }
  }

  return { route, request, reply }
}
