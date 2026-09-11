import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fastify from 'fastify'
import { createFastifySchemaApi } from './fixtures/api-configs.js'
import { getRequestContracts } from '../plugins/core/lib/querying-writing/request-contracts.js'

function resolveSchemaNode (rootSchema, schemaNode) {
  if (!schemaNode || !Array.isArray(schemaNode.allOf) || schemaNode.allOf.length !== 1) {
    return schemaNode
  }

  const ref = schemaNode.allOf[0]?.$ref || ''
  if (!ref.startsWith('#/definitions/')) {
    return schemaNode
  }

  const definitionName = ref.slice('#/definitions/'.length)
  return rootSchema?.definitions?.[definitionName] || schemaNode
}

describe('Fastify Plugin', () => {
  let api
  let app
  const routes = []
  const findFastifyRoute = (method, url) => routes.find(route => route.method === method && route.url === url)

  before(async () => {
    app = fastify()
    app.addHook('onRoute', route => { routes.push(route) })
    api = await createFastifySchemaApi(app)
    await app.ready()
  })
  after(async () => { await app?.close() })

  it('registers Fastify write routes with schema-backed JSON:API body validation', () => {
    const postRoute = findFastifyRoute('POST', '/api/articles')
    const putRoute = findFastifyRoute('PUT', '/api/articles/:id')
    const patchRoute = findFastifyRoute('PATCH', '/api/articles/:id')
    const getRoute = findFastifyRoute('GET', '/api/articles/:id')
    const postRelationshipRoute = findFastifyRoute('POST', '/api/articles/:id/relationships/:relationshipName')
    const patchRelationshipRoute = findFastifyRoute('PATCH', '/api/articles/:id/relationships/:relationshipName')
    const deleteRelationshipRoute = findFastifyRoute('DELETE', '/api/articles/:id/relationships/:relationshipName')
    const relationshipContracts = getRequestContracts({
      scopeName: 'articles',
      schemaInfo: api.resources.articles.vars.schemaInfo,
      includeDepthLimit: api.resources.articles.vars.includeDepthLimit,
      sortableFields: api.resources.articles.vars.sortableFields
    })

    assert.ok(postRoute?.schema?.body, 'POST route should have a body schema')
    assert.ok(putRoute?.schema?.body, 'PUT route should have a body schema')
    assert.ok(patchRoute?.schema?.body, 'PATCH route should have a body schema')
    assert.equal(getRoute?.schema, undefined, 'GET route should not have a body schema')
    assert.ok(postRelationshipRoute?.schema?.body, 'POST relationship route should have a body schema')
    assert.ok(patchRelationshipRoute?.schema?.body, 'PATCH relationship route should have a body schema')
    assert.ok(deleteRelationshipRoute?.schema?.body, 'DELETE relationship route should have a body schema')

    const postDataSchema = resolveSchemaNode(postRoute.schema.body, postRoute.schema.body.properties.data)
    const postAttributes = postDataSchema.properties.attributes

    assert.deepEqual(postDataSchema.required, ['type'])
    assert.equal(postAttributes.properties.title.type, 'string')
    assert.equal(postAttributes.properties.author_id, undefined, 'belongsTo foreign key should not be accepted in attributes')
    assert.equal(postAttributes.properties.internal_summary, undefined, 'computed fields should not be accepted in attributes')
    assert.equal(postAttributes.properties.id, undefined, 'resource ids should not appear in attributes')
    const postRelationships = resolveSchemaNode(postRoute.schema.body, postDataSchema.properties.relationships)
    assert.ok(postRelationships.properties.author, 'declared belongsTo relationships should be represented in the transport schema')

    const putDataSchema = resolveSchemaNode(putRoute.schema.body, putRoute.schema.body.properties.data)
    assert.ok(putDataSchema.required.includes('id'), 'PUT body schema should require data.id')

    const patchDataSchemaNode = patchRoute.schema.body.properties.data
    assert.ok(Array.isArray(patchDataSchemaNode.anyOf), 'PATCH body schema should require at least one writable section')
    assert.deepEqual(patchDataSchemaNode.anyOf, [
      { required: ['attributes'] },
      { required: ['relationships'] }
    ])

    assert.equal(postRelationshipRoute.schema.body.properties.data.type, 'array')
    assert.ok(Array.isArray(patchRelationshipRoute.schema.body.properties.data.anyOf))
    assert.equal(deleteRelationshipRoute.schema.body.properties.data.type, 'array')
    assert.deepEqual(
      postRelationshipRoute.schema.body,
      relationshipContracts.postRelationship.schema.toJsonSchema({
        mode: relationshipContracts.postRelationship.mode,
        additionalProperties: false
      })
    )
    assert.deepEqual(
      patchRelationshipRoute.schema.body,
      relationshipContracts.patchRelationship.schema.toJsonSchema({
        mode: relationshipContracts.patchRelationship.mode,
        additionalProperties: false
      })
    )
    assert.deepEqual(
      deleteRelationshipRoute.schema.body,
      relationshipContracts.deleteRelationship.schema.toJsonSchema({
        mode: relationshipContracts.deleteRelationship.mode,
        additionalProperties: false
      })
    )
  })

  it('parses both JSON media types and rejects unsupported write content types', async () => {
    for (const contentType of ['application/json', 'application/vnd.api+json']) {
      const response = await app.inject({ method: 'POST', url: '/api/custom-endpoint', payload: { ok: true }, headers: { 'content-type': contentType } })
      assert.equal(response.statusCode, 201)
      assert.deepEqual(response.json(), { echo: { ok: true } })
    }
    for (const contentType of ['text/plain', 'multipart/form-data; boundary=test']) {
      const response = await app.inject({ method: 'POST', url: '/api/articles', payload: 'unsupported', headers: { 'content-type': contentType } })
      assert.equal(response.statusCode, 415)
      assert.equal(response.headers['content-type'], 'application/vnd.api+json')
      assert.equal(response.json().errors[0].title, 'Unsupported Media Type')
    }
  })

  it('leaves custom routes unschematized when they do not provide route metadata', async () => {
    const customRoute = findFastifyRoute('POST', '/api/custom-endpoint')
    assert.ok(customRoute)
    assert.equal(customRoute.schema, undefined)
  })
})
