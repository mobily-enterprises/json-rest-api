import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js'
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js'
import {
  cleanTables,
  validateJsonApiStructure
} from './helpers/test-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api

function createMysqlStyleInsertDb (baseKnex) {
  return (tableName) => {
    const query = baseKnex(tableName)
    const originalInsert = query.insert.bind(query)

    query.insert = (...args) => {
      const insertBuilder = originalInsert(...args)
      const originalReturning = insertBuilder.returning.bind(insertBuilder)

      insertBuilder.returning = async (...returnArgs) => {
        await originalReturning(...returnArgs)
        return [0]
      }

      return insertBuilder
    }

    return query
  }
}

describe('Custom id POST fallback when insert returning is unusable', () => {
  before(async () => {
    api = new Api({
      name: 'custom-id-mysql-returning-fallback-test'
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
      tableName: 'mysqlish_user_settings',
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
    await cleanTables(knex, ['mysqlish_user_settings'])
  })

  it('returns the explicit id for simplified POST when the insert result is 0', async () => {
    const mysqlStyleDb = createMysqlStyleInsertDb(knex)

    const created = await api.resources.user_settings.post({
      inputRecord: {
        id: '6',
        theme: 'dark'
      },
      simplified: true,
      transaction: mysqlStyleDb
    })

    assert.equal(created.id, '6')
    assert.equal(created.theme, 'dark')

    const dbRow = await knex('mysqlish_user_settings').where('user_id', 6).first()
    assert.ok(dbRow)
    assert.equal(String(dbRow.user_id), '6')
    assert.equal(dbRow.theme, 'dark')
  })

  it('returns the explicit id for non-simplified POST when the insert result is 0', async () => {
    const mysqlStyleDb = createMysqlStyleInsertDb(knex)

    const created = await api.resources.user_settings.post({
      inputRecord: {
        data: {
          type: 'user_settings',
          id: '8',
          attributes: {
            theme: 'light'
          }
        }
      },
      simplified: false,
      transaction: mysqlStyleDb
    })

    validateJsonApiStructure(created)
    assert.equal(created.data.id, '8')
    assert.equal(created.data.attributes.theme, 'light')

    const dbRow = await knex('mysqlish_user_settings').where('user_id', 8).first()
    assert.ok(dbRow)
    assert.equal(String(dbRow.user_id), '8')
    assert.equal(dbRow.theme, 'light')
  })
})
