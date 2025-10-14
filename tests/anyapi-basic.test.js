import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'

import { RestApiPlugin, RestApiAnyapiKnexPlugin } from '../index.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
})

let api

describe('AnyAPI Knex Plugin - Basic Attributes', () => {
  before(async () => {
    try {
      await ensureAnyApiSchema(knex)

      api = new Api({ name: 'anyapi-test', log: { level: 'warn' } })
      await api.use(RestApiPlugin, { simplifiedApi: false, simplifiedTransport: false })
      await api.use(RestApiAnyapiKnexPlugin, { knex })

      await api.addResource('countries', {
        schema: {
          id: { type: 'id' },
          name: { type: 'string', required: true },
          code: { type: 'string', required: true },
        },
      })

      if (api.resources.countries?.createKnexTable) {
        await api.resources.countries.createKnexTable()
      }
    } catch (error) {
      console.error('Setup failed', error)
      throw error
    }
  })

  after(async () => {
    await api.release()
    await knex.destroy()
  })

  beforeEach(async () => {
    await knex('any_records').truncate()
  })

  it('creates and retrieves records', async () => {
    const result = await api.resources.countries.post({
      inputRecord: {
        data: {
          type: 'countries',
          attributes: {
            name: 'Australia',
            code: 'AU',
          },
        },
      },
      simplified: false,
    }).catch((error) => {
      console.error('POST failed', error)
      throw error
    })

    assert.ok(result.data.id, 'should return new id')
    assert.equal(result.data.attributes.name, 'Australia')

    const stored = await knex('any_records').first()
    assert.equal(stored.string_1, 'Australia')
    assert.equal(stored.string_2, 'AU')

    const fetched = await api.resources.countries.get({ id: result.data.id, simplified: false })
      .catch((error) => {
        console.error('GET failed', error)
        throw error
      })
    assert.equal(fetched.data.attributes.name, 'Australia')
  })

  it('lists records', async () => {
    await knex('any_records').insert([{
      tenant_id: 'default',
      resource: 'countries',
      string_1: 'Canada',
      string_2: 'CA',
    }, {
      tenant_id: 'default',
      resource: 'countries',
      string_1: 'Brazil',
      string_2: 'BR',
    }])

    const result = await api.resources.countries.query({ simplified: false })
    assert.equal(result.data.length, 2)
    const names = result.data.map((entry) => entry.attributes.name).sort()
    assert.deepEqual(names, ['Brazil', 'Canada'])
  })
})
