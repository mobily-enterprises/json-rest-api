import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTransportData, executeConnectorRoute, handleConnectorError } from '../plugins/core/connectors/lib/connector-core.js'
import { createStrongEntityTag } from '../plugins/core/connectors/lib/http-validators.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { cloneRequestHeaders } from '../plugins/core/connectors/lib/request-helpers.js'

describe('Connector response body replacement', () => {
  it('copies repeated request header values for speculative views', () => {
    const original = { 'x-marker': 'original', 'x-values': ['first', 'second'] }
    const copy = cloneRequestHeaders(original)
    copy['x-marker'] = 'changed'
    copy['x-values'][0] = 'changed'
    assert.deepEqual(original, { 'x-marker': 'original', 'x-values': ['first', 'second'] })
    assert.deepEqual(cloneRequestHeaders(), {})
  })
  it('keeps wildcard existence independent of body serialization', async () => {
    const transportData = buildTransportData({ method: 'GET' })
    const outcome = await executeConnectorRoute({
      httpValidators: true,
      method: 'GET',
      headers: { 'if-match': '*' },
      context: { transport: transportData },
      transportData,
      handler: async () => ({ data: null }),
      runHooks: async (name, context) => { context.transport.response.body = undefined }
    })
    assert.equal(outcome.status, 200)
    assert.equal(outcome.body, undefined)
    assert.equal(outcome.headers.etag, undefined)
  })
  for (const method of ['GET', 'PATCH']) {
    for (const replacement of [{ errors: [], meta: { replaced: true } }, null, undefined]) {
      it(`preserves error replacement ${JSON.stringify(replacement)} for ${method}`, async () => {
        const transportData = buildTransportData({ method })
        const context = { transport: transportData }
        let calls = 0
        const outcome = await handleConnectorError({
          error: new RestApiResourceError('Missing resource', { subtype: 'not_found' }),
          context,
          transportData,
          runHooks: async (name, hookContext) => {
            assert.equal(name, 'transport:response')
            calls++
            hookContext.transport.response.body = replacement
          }
        })
        assert.equal(calls, 1)
        assert.equal(outcome.status, 404)
        assert.deepEqual(outcome.body, replacement)
      })
    }
  }
  for (const httpValidators of [false, true]) {
    for (const replacement of [{ data: null, meta: { replaced: true } }, null, undefined]) {
      it(`preserves ${JSON.stringify(replacement)} with validators ${httpValidators}`, async () => {
        const transportData = buildTransportData({ method: 'GET' })
        const context = { transport: transportData }
        let calls = 0
        const outcome = await executeConnectorRoute({
          httpValidators,
          method: 'GET',
          context,
          transportData,
          handler: async () => ({ data: { type: 'items', id: '1' } }),
          runHooks: async (name, hookContext) => {
            assert.equal(name, 'transport:response')
            calls++
            hookContext.transport.response.body = replacement
          }
        })
        const serialized = httpValidators && replacement !== undefined
        assert.equal(calls, 1)
        assert.equal(outcome.status, 200)
        assert.deepEqual(outcome.body, serialized ? JSON.stringify(replacement) : replacement)
        assert.equal(outcome.headers.etag, serialized ? createStrongEntityTag(JSON.stringify(replacement)) : undefined)
      })
    }
  }
})
