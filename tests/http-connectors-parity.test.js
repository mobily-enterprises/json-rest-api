import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import knexLib from 'knex'
import { Api } from 'hooked-api'
import {
  RestApiPlugin,
  RestApiKnexPlugin,
  ExpressPlugin,
  FastifyPlugin
} from '../index.js'
import { getUnsupportedMediaTypeErrorBody } from '../plugins/core/connectors/lib/transport-http-helpers.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'
import {
  FakeFastifyApp,
  invokeFastifyRoute
} from './helpers/fake-fastify.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

async function createConnectorParityApi () {
  const expressApp = express()
  const fastifyApp = new FakeFastifyApp()
  const api = new Api({
    name: 'connector-parity-test-api',
    log: { level: process.env.LOG_LEVEL || 'silent' }
  })

  await api.use(RestApiPlugin, {
    simplifiedApi: false,
    simplifiedTransport: false,
    returnRecordApi: {
      post: true,
      put: false,
      patch: false
    },
    returnRecordTransport: {
      post: 'full',
      put: 'no',
      patch: 'minimal'
    },
    sortableFields: ['id', 'name', 'code']
  })

  await api.use(RestApiKnexPlugin, { knex })
  await api.use(ExpressPlugin, { mountPath: '/api' })
  await api.use(FastifyPlugin, {
    app: fastifyApp,
    mountPath: '/api'
  })

  await api.customize({
    hooks: {
      'transport:request': {
        functionName: 'connector-parity-rejector',
        handler: async ({ context }) => {
          if (context.transport?.request?.headers?.['x-block-request'] === 'yes') {
            context.reject(401, 'Blocked by connector parity hook', {
              title: 'Unauthorized'
            })
          }
        }
      },
      'transport:response': {
        functionName: 'connector-parity-header',
        handler: async ({ context }) => {
          context.transport.response.headers['x-connector-test'] = 'enabled'
        }
      }
    }
  })

  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 },
      code: { type: 'string', max: 2 }
    },
    tableName: 'connector_parity_countries'
  })

  await api.resources.countries.createKnexTable()
  api.http.express.mount(expressApp)

  return { api, expressApp, fastifyApp }
}

function assertLocationSuffix (location, resourceId) {
  assert.ok(location, 'Expected Location header to be present')
  assert.ok(
    location.endsWith(`/api/countries/${resourceId}`) ||
      location.endsWith(`/countries/${resourceId}`),
    `Unexpected Location header: ${location}`
  )
}

describe('HTTP Connector Parity', () => {
  let api
  let expressApp
  let fastifyApp

  before(async () => {
    ({ api, expressApp, fastifyApp } = await createConnectorParityApi())
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['connector_parity_countries'])
  })

  it('returns the same create semantics through Express and Fastify', async () => {
    const expressDoc = createJsonApiDocument('countries', {
      name: 'Express Country',
      code: 'EC'
    })
    const fastifyDoc = createJsonApiDocument('countries', {
      name: 'Fastify Country',
      code: 'FC'
    })

    const expressResponse = await request(expressApp)
      .post('/api/countries')
      .set('Content-Type', 'application/vnd.api+json')
      .set('Accept', 'application/vnd.api+json')
      .send(expressDoc)

    const { reply: fastifyReply } = await invokeFastifyRoute(fastifyApp, {
      method: 'POST',
      routeUrl: '/api/countries',
      requestUrl: '/api/countries',
      headers: {
        'content-type': 'application/vnd.api+json',
        accept: 'application/vnd.api+json'
      },
      body: fastifyDoc
    })

    assert.equal(expressResponse.status, 201)
    assert.equal(fastifyReply.statusCode, 201)

    assert.equal(expressResponse.body.data.type, 'countries')
    assert.equal(fastifyReply.payload.data.type, 'countries')
    assert.equal(expressResponse.body.data.attributes.name, 'Express Country')
    assert.equal(fastifyReply.payload.data.attributes.name, 'Fastify Country')
    assert.equal(expressResponse.headers['x-connector-test'], 'enabled')
    assert.equal(fastifyReply.headers['x-connector-test'], 'enabled')

    assertLocationSuffix(expressResponse.headers.location, expressResponse.body.data.id)
    assertLocationSuffix(fastifyReply.headers.Location, fastifyReply.payload.data.id)
  })

  it('rejects unsupported write content types using each connector transport policy', async () => {
    const expressResponse = await request(expressApp)
      .post('/api/countries')
      .set('Content-Type', 'text/plain')
      .send('invalid payload')

    const { reply: fastifyReply } = await invokeFastifyRoute(fastifyApp, {
      method: 'POST',
      routeUrl: '/api/countries',
      requestUrl: '/api/countries',
      headers: { 'content-type': 'text/plain' },
      body: 'invalid payload'
    })

    assert.equal(expressResponse.status, 415)
    assert.equal(fastifyReply.statusCode, 415)
    assert.deepEqual(
      expressResponse.body,
      getUnsupportedMediaTypeErrorBody({ allowMultipart: true })
    )
    assert.deepEqual(
      fastifyReply.payload,
      getUnsupportedMediaTypeErrorBody()
    )
  })

  it('maps validation errors the same way in both connectors', async () => {
    const invalidDoc = createJsonApiDocument('countries', {
      code: 'IV'
    })

    const expressResponse = await request(expressApp)
      .post('/api/countries')
      .set('Content-Type', 'application/vnd.api+json')
      .set('Accept', 'application/vnd.api+json')
      .send(invalidDoc)

    const { reply: fastifyReply } = await invokeFastifyRoute(fastifyApp, {
      method: 'POST',
      routeUrl: '/api/countries',
      requestUrl: '/api/countries',
      headers: {
        'content-type': 'application/vnd.api+json',
        accept: 'application/vnd.api+json'
      },
      body: invalidDoc
    })

    assert.equal(expressResponse.status, 422)
    assert.equal(fastifyReply.statusCode, 422)
    assert.deepEqual(fastifyReply.payload, expressResponse.body)
    assert.equal(expressResponse.headers['x-connector-test'], 'enabled')
    assert.equal(fastifyReply.headers['x-connector-test'], 'enabled')
  })

  it('honors transport request rejection hooks the same way in both connectors', async () => {
    const expressResponse = await request(expressApp)
      .get('/api/countries')
      .set('x-block-request', 'yes')

    const { reply: fastifyReply } = await invokeFastifyRoute(fastifyApp, {
      method: 'GET',
      routeUrl: '/api/countries',
      requestUrl: '/api/countries',
      headers: { 'x-block-request': 'yes' }
    })

    assert.equal(expressResponse.status, 401)
    assert.equal(fastifyReply.statusCode, 401)
    assert.deepEqual(fastifyReply.payload, expressResponse.body)
    assert.equal(expressResponse.headers['x-connector-test'], undefined)
    assert.equal(fastifyReply.headers['x-connector-test'], undefined)
  })
})
