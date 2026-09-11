import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createReturnRecordApi } from './fixtures/api-configs.js'
import { cleanTables } from './helpers/test-utils.js'

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
let api

describe('Explicit response options', () => {
  before(async () => { api = await createReturnRecordApi(knex) })
  after(async () => { await knex.destroy() })
  beforeEach(async () => { await cleanTables(knex, ['return_global_items', 'return_scope_items']) })

  it('uses global and resource defaults, with per-call overrides', async () => {
    const global = await api.resources.global_items.post({ inputRecord: { name: 'Global' }, format: 'plain' })
    assert.equal(global.name, 'Global')
    const scoped = await api.resources.scope_items.post({ inputRecord: { id: '43', name: 'Scoped' }, format: 'plain' })
    assert.deepEqual(scoped, { type: 'scope_items', id: '43' })
    const full = await api.resources.scope_items.patch({
      id: scoped.id, inputRecord: { name: 'Updated' }, format: 'plain', returning: 'full'
    })
    assert.equal(full.name, 'Updated')
    assert.equal(await api.resources.scope_items.patch({
      id: scoped.id, inputRecord: { name: 'Stored' }, format: 'plain', returning: 'none'
    }), undefined)
    assert.equal((await api.resources.scope_items.get({ id: scoped.id, format: 'plain' })).name, 'Stored')
  })

  it('keeps record fields separate from operation controls', async () => {
    const created = await api.resources.global_items.post({
      inputRecord: { id: '41', name: 'Options', format: 'record format', returning: 'record returning', queryParams: 'record query', data: { type: 'record data', value: 0 } },
      format: 'plain',
      returning: 'full'
    })
    assert.equal(created.id, '41')
    assert.equal(created.format, 'record format')
    assert.equal(created.returning, 'record returning')
    assert.equal(created.queryParams, 'record query')
    assert.deepEqual(created.data, { type: 'record data', value: 0 })
    await assert.rejects(api.resources.global_items.patch({
      id: '41', inputRecord: { id: '42', name: 'Wrong target' }, format: 'plain'
    }))
    assert.equal((await api.resources.global_items.get({ id: '41', format: 'plain' })).name, 'Options')
    await assert.rejects(api.resources.global_items.get({ id: '42' }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
  })

  it('rejects ambiguous shorthand before writing', async () => {
    await assert.rejects(api.resources.global_items.post({ name: 'Missing inputRecord' }), {
      code: 'REST_API_VALIDATION', details: { fields: ['inputRecord'], violations: [] }
    })
    assert.deepEqual((await api.resources.global_items.query({})).data, [])
  })

  it('rejects invalid representations and return modes instead of silently falling back', async () => {
    for (const format of [true, false, null, 'JSONAPI', 'simple', {}, []]) {
      await assert.rejects(api.resources.global_items.post({ inputRecord: { name: 'Invalid' }, format }), { code: 'REST_API_VALIDATION' })
      await assert.rejects(api.resources.global_items.query({ format }), { code: 'REST_API_VALIDATION' })
    }
    for (const returning of [true, false, null, 'no', 'FULL', {}, { post: 'full' }, []]) {
      await assert.rejects(api.resources.global_items.post({ inputRecord: { name: 'Invalid' }, format: 'plain', returning }), { code: 'REST_API_VALIDATION' })
    }
    assert.deepEqual((await api.resources.global_items.query({})).data, [])
  })

  it('reports removed options instead of running a different operation silently', async () => {
    for (const name of ['simplified', 'returnFullRecord', 'isTransport', 'simplifiedApi', 'simplifiedTransport', 'returnRecordApi', 'returnRecordTransport']) {
      await assert.rejects(api.resources.global_items.post({ inputRecord: { name: 'Invalid' }, [name]: true }), { code: 'REST_API_VALIDATION' })
      await assert.rejects(api.resources.global_items.query({ [name]: true }), { code: 'REST_API_VALIDATION' })
    }
    assert.deepEqual((await api.resources.global_items.query({})).data, [])
  })
})
