import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js'
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js'
import { cleanTables } from './helpers/test-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api

describe('Simplified POST with explicit resource ids', () => {
  before(async () => {
    api = new Api({
      name: 'custom-id-simplified-post-test'
    })

    await api.use(RestApiPlugin, {
      simplifiedApi: true,
      simplifiedTransport: false,
      returnRecordApi: {
        post: 'full',
        put: 'full',
        patch: 'full'
      }
    })
    await api.use(RestApiKnexPlugin, { knex })

    await api.addResource('user_settings', {
      tableName: 'test_user_settings',
      idProperty: 'user_id',
      searchSchema: {
        id: { type: 'id', actualField: 'id' }
      },
      schema: {
        theme: { type: 'string', required: true, max: 32 }
      }
    })
    await api.resources.user_settings.createKnexTable()
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['test_user_settings'])
  })

  it('persists the provided resource id when posting simplified records to a custom-id resource', async () => {
    const created = await api.resources.user_settings.post({
      id: '7',
      theme: 'dark'
    })

    assert.equal(created.id, '7')
    assert.equal(created.theme, 'dark')

    const dbRow = await knex('test_user_settings').where('user_id', 7).first()
    assert.ok(dbRow)
    assert.equal(String(dbRow.user_id), '7')
    assert.equal(dbRow.theme, 'dark')

    const fetched = await api.resources.user_settings.get({ id: '7' })
    assert.equal(fetched.id, '7')
    assert.equal(fetched.theme, 'dark')
  })
})
