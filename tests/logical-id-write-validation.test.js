import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js'
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js'
import {
  cleanTables,
  validateJsonApiStructure,
} from './helpers/test-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api

describe('Logical resource ids in write validation', () => {
  before(async () => {
    api = new Api({
      name: 'logical-id-write-validation-test'
    })

    await api.use(RestApiPlugin, {
      simplifiedApi: false,
      simplifiedTransport: false,
      returnRecordApi: {
        post: 'full',
        put: 'full',
        patch: 'full'
      }
    })
    await api.use(RestApiKnexPlugin, { knex })

    await api.addResource('profiles', {
      tableName: 'logical_id_profiles',
      idProperty: 'user_id',
      schema: {
        id: { type: 'id', required: true, storage: { column: 'user_id' } },
        name: { type: 'string', required: true, max: 64 }
      }
    })
    await api.resources.profiles.createKnexTable()
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['logical_id_profiles'])
  })

  it('accepts explicit resource ids in non-simplified POST without exposing id as an attribute', async () => {
    const created = await api.resources.profiles.post({
      inputRecord: {
        data: {
          type: 'profiles',
          id: '101',
          attributes: {
            name: 'Alice'
          }
        }
      }
    })

    validateJsonApiStructure(created)
    assert.equal(created.data.id, '101')
    assert.equal(created.data.attributes.name, 'Alice')
    assert.ok(!('id' in created.data.attributes))

    const dbRow = await knex('logical_id_profiles').where('user_id', 101).first()
    assert.ok(dbRow)
    assert.equal(String(dbRow.user_id), '101')
    assert.equal(dbRow.name, 'Alice')
  })

  it('reports missing logical ids against data.id during POST validation', async () => {
    await assert.rejects(
      () => api.resources.profiles.post({
        inputRecord: {
          data: {
            type: 'profiles',
            attributes: {
              name: 'Missing Id'
            }
          }
        }
      }),
      (error) => {
        assert.equal(error.code, 'REST_API_VALIDATION')
        assert.deepEqual(error.details?.fields, ['data.id'])
        assert.equal(error.details?.violations?.[0]?.field, 'data.id')
        return true
      }
    )
  })

  it('accepts explicit resource ids in simplified POST and still keeps id out of attributes', async () => {
    const created = await api.resources.profiles.post({
      id: '202',
      name: 'Bob'
    })

    assert.equal(created.id, '202')
    assert.equal(created.name, 'Bob')

    const fetched = await api.resources.profiles.get({
      id: '202',
      simplified: false
    })

    validateJsonApiStructure(fetched)
    assert.equal(fetched.data.id, '202')
    assert.equal(fetched.data.attributes.name, 'Bob')
    assert.ok(!('id' in fetched.data.attributes))
  })

  it('accepts logical id validation through PUT full replacement', async () => {
    await knex('logical_id_profiles').insert({
      user_id: 303,
      name: 'Before'
    })

    const updated = await api.resources.profiles.put({
      id: '303',
      inputRecord: {
        data: {
          type: 'profiles',
          id: '303',
          attributes: {
            name: 'After'
          }
        }
      }
    })

    validateJsonApiStructure(updated)
    assert.equal(updated.data.id, '303')
    assert.equal(updated.data.attributes.name, 'After')
    assert.ok(!('id' in updated.data.attributes))

    const dbRow = await knex('logical_id_profiles').where('user_id', 303).first()
    assert.ok(dbRow)
    assert.equal(dbRow.name, 'After')
  })
})
