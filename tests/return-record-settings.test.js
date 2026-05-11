import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createReturnRecordApi } from './fixtures/api-configs.js'
import { cleanTables } from './helpers/test-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api

function itemDocument (type, name, id) {
  const doc = {
    data: {
      type,
      attributes: { name }
    }
  }

  if (id !== undefined) {
    doc.data.id = String(id)
  }

  return doc
}

describe('Return record settings', () => {
  before(async () => {
    api = await createReturnRecordApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'return_global_items',
      'return_scope_items'
    ])
  })

  it('normalizes plugin-level boolean return settings', async () => {
    const created = await api.resources.global_items.post({
      inputRecord: itemDocument('global_items', 'Global Created'),
      simplified: false
    })

    assert.equal(created.data.type, 'global_items')
    assert.equal(created.data.attributes.name, 'Global Created')

    const replaced = await api.resources.global_items.put({
      id: created.data.id,
      inputRecord: itemDocument('global_items', 'Global Replaced', created.data.id),
      simplified: false
    })
    assert.equal(replaced, undefined)

    const patched = await api.resources.global_items.patch({
      id: created.data.id,
      inputRecord: itemDocument('global_items', 'Global Patched', created.data.id),
      simplified: false
    })
    assert.equal(patched, undefined)

    const fetched = await api.resources.global_items.get({
      id: created.data.id,
      simplified: false
    })
    assert.equal(fetched.data.attributes.name, 'Global Patched')
  })

  it('normalizes per-call boolean return settings', async () => {
    const created = await api.resources.global_items.post({
      inputRecord: itemDocument('global_items', 'Per-call Created'),
      simplified: false,
      returnFullRecord: false
    })
    assert.equal(created, undefined)

    const queryResult = await api.resources.global_items.query({
      simplified: false
    })
    assert.equal(queryResult.data.length, 1)
    const fetched = queryResult.data[0]
    assert.equal(fetched.attributes.name, 'Per-call Created')

    const patched = await api.resources.global_items.patch({
      id: fetched.id,
      inputRecord: itemDocument('global_items', 'Per-call Patched', fetched.id),
      simplified: false,
      returnFullRecord: true
    })
    assert.equal(patched.data.type, 'global_items')
    assert.equal(patched.data.id, fetched.id)
    assert.equal(patched.data.attributes.name, 'Per-call Patched')
  })

  it('normalizes resource-level boolean return settings', async () => {
    const created = await api.resources.scope_items.post({
      inputRecord: itemDocument('scope_items', 'Scoped Created'),
      simplified: false
    })
    assert.equal(created, undefined)

    const queryResult = await api.resources.scope_items.query({
      simplified: false
    })
    assert.equal(queryResult.data.length, 1)
    const fetched = queryResult.data[0]

    const replaced = await api.resources.scope_items.put({
      id: fetched.id,
      inputRecord: itemDocument('scope_items', 'Scoped Replaced', fetched.id),
      simplified: false
    })
    assert.equal(replaced.data.type, 'scope_items')
    assert.equal(replaced.data.id, fetched.id)
    assert.equal(replaced.data.attributes.name, 'Scoped Replaced')

    const patched = await api.resources.scope_items.patch({
      id: fetched.id,
      inputRecord: itemDocument('scope_items', 'Scoped Patched', fetched.id),
      simplified: false
    })
    assert.deepEqual(patched, {
      data: {
        type: 'scope_items',
        id: fetched.id
      }
    })
  })

  it('normalizes transport boolean return settings', async () => {
    const created = await api.resources.global_items.post({
      inputRecord: itemDocument('global_items', 'Transport Created'),
      simplified: false,
      isTransport: true
    })
    assert.equal(created, undefined)

    const queryResult = await api.resources.global_items.query({
      simplified: false
    })
    assert.equal(queryResult.data.length, 1)
    const fetched = queryResult.data[0]

    const replaced = await api.resources.global_items.put({
      id: fetched.id,
      inputRecord: itemDocument('global_items', 'Transport Replaced', fetched.id),
      simplified: false,
      isTransport: true
    })
    assert.equal(replaced.data.type, 'global_items')
    assert.equal(replaced.data.id, fetched.id)
    assert.equal(replaced.data.attributes.name, 'Transport Replaced')

    const patched = await api.resources.global_items.patch({
      id: fetched.id,
      inputRecord: itemDocument('global_items', 'Transport Patched', fetched.id),
      simplified: false,
      isTransport: true
    })
    assert.deepEqual(patched, {
      data: {
        type: 'global_items',
        id: fetched.id
      }
    })

    const scoped = await api.resources.scope_items.post({
      inputRecord: itemDocument('scope_items', 'Scoped Transport Created'),
      simplified: false,
      isTransport: true
    })
    assert.equal(scoped.data.type, 'scope_items')
    assert.equal(scoped.data.attributes.name, 'Scoped Transport Created')
  })
})
