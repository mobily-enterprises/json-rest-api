import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Api } from 'hooked-api'
import { RestApiPlugin, FastifyPlugin } from '../index.js'

class FakeFastifyApp {
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

class FakeReply {
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

async function createFastifyConnectorApi () {
  const app = new FakeFastifyApp()
  const api = new Api({
    name: 'fastify-connector-test-api',
    log: { level: process.env.LOG_LEVEL || 'silent' }
  })

  await api.use(RestApiPlugin, {
    simplifiedApi: false,
    simplifiedTransport: false
  })

  await api.use(FastifyPlugin, {
    app,
    mountPath: '/api'
  })

  await api.addResource('users', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true }
    }
  })

  await api.addResource('articles', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true },
      body: { type: 'string' },
      author_id: { type: 'id', belongsTo: 'users', as: 'author' },
      internal_summary: { type: 'string', computed: true }
    }
  })

  return { api, app }
}

function findRoute (app, method, url) {
  return app.routes.find((route) => route.method === method && route.url === url)
}

describe('Fastify Plugin', () => {
  let api
  let app

  beforeEach(async () => {
    ({ api, app } = await createFastifyConnectorApi())
  })

  it('registers Fastify write routes with schema-backed JSON:API body validation', () => {
    const postRoute = findRoute(app, 'POST', '/api/articles')
    const putRoute = findRoute(app, 'PUT', '/api/articles/:id')
    const patchRoute = findRoute(app, 'PATCH', '/api/articles/:id')
    const getRoute = findRoute(app, 'GET', '/api/articles/:id')
    const postRelationshipRoute = findRoute(app, 'POST', '/api/articles/:id/relationships/:relationshipName')
    const patchRelationshipRoute = findRoute(app, 'PATCH', '/api/articles/:id/relationships/:relationshipName')
    const deleteRelationshipRoute = findRoute(app, 'DELETE', '/api/articles/:id/relationships/:relationshipName')

    assert.ok(postRoute?.schema?.body, 'POST route should have a body schema')
    assert.ok(putRoute?.schema?.body, 'PUT route should have a body schema')
    assert.ok(patchRoute?.schema?.body, 'PATCH route should have a body schema')
    assert.equal(getRoute?.schema, undefined, 'GET route should not have a body schema')
    assert.ok(postRelationshipRoute?.schema?.body, 'POST relationship route should have a body schema')
    assert.ok(patchRelationshipRoute?.schema?.body, 'PATCH relationship route should have a body schema')
    assert.ok(deleteRelationshipRoute?.schema?.body, 'DELETE relationship route should have a body schema')

    const postDataSchema = postRoute.schema.body.properties.data
    const postAttributes = postDataSchema.properties.attributes

    assert.deepEqual(postDataSchema.required, ['type'])
    assert.equal(postAttributes.properties.title.type, 'string')
    assert.equal(postAttributes.properties.author_id, undefined, 'belongsTo foreign key should not be accepted in attributes')
    assert.equal(postAttributes.properties.internal_summary, undefined, 'computed fields should not be accepted in attributes')
    assert.equal(postAttributes.properties.id, undefined, 'resource ids should not appear in attributes')
    assert.ok(postDataSchema.properties.relationships.properties.author, 'declared belongsTo relationships should be represented in the transport schema')

    const putDataSchema = putRoute.schema.body.properties.data
    assert.ok(putDataSchema.required.includes('id'), 'PUT body schema should require data.id')

    const patchDataSchema = patchRoute.schema.body.properties.data
    assert.ok(Array.isArray(patchDataSchema.anyOf), 'PATCH body schema should require at least one writable section')
    assert.deepEqual(patchDataSchema.anyOf, [
      { required: ['attributes'] },
      { required: ['relationships'] }
    ])

    assert.equal(postRelationshipRoute.schema.body.properties.data.type, 'array')
    assert.ok(Array.isArray(patchRelationshipRoute.schema.body.properties.data.anyOf))
    assert.equal(deleteRelationshipRoute.schema.body.properties.data.type, 'array')
  })

  it('registers the JSON:API content-type parser and rejects unsupported write content types before the route handler', async () => {
    const parser = app.parsers.find((entry) => entry.contentType === 'application/vnd.api+json')
    assert.ok(parser, 'Fastify connector should register the JSON:API parser')
    assert.deepEqual(parser.options, { parseAs: 'string' })

    const postRoute = findRoute(app, 'POST', '/api/articles')
    const reply = new FakeReply()

    await postRoute.preValidation(
      { headers: { 'content-type': 'text/plain' } },
      reply
    )

    assert.equal(reply.statusCode, 415)
    assert.equal(reply.contentType, 'application/vnd.api+json')
    assert.deepEqual(reply.payload, {
      errors: [{
        status: '415',
        title: 'Unsupported Media Type',
        detail: 'Content-Type must be application/vnd.api+json or application/json'
      }]
    })

    const multipartReply = new FakeReply()
    await postRoute.preValidation(
      { headers: { 'content-type': 'multipart/form-data; boundary=test' } },
      multipartReply
    )

    assert.equal(multipartReply.statusCode, 415)
  })

  it('leaves custom routes unschematized when they do not provide route metadata', async () => {
    await api.addRoute({
      method: 'POST',
      path: '/api/custom-endpoint',
      handler: async () => ({ ok: true })
    })

    const customRoute = findRoute(app, 'POST', '/api/custom-endpoint')
    assert.ok(customRoute)
    assert.equal(customRoute.schema, undefined)
  })
})
