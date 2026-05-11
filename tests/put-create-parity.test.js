import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'

import {
  RestApiAnyapiKnexPlugin,
  RestApiKnexPlugin,
  RestApiPlugin,
} from '../index.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'
import {
  cleanTables,
  validateJsonApiStructure,
} from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

const tenantId = 'put_create_parity_tenant'
const profilesTable = 'put_create_profiles'
const accountsTable = 'put_create_accounts'

let api

const registerTable = (tableName, resourceName) => {
  if (storageMode.isAnyApi()) {
    storageMode.registerTable(tableName, resourceName, tenantId)
  }
}

const findStoredRow = async (tableName, resourceName, idColumn, id) => {
  if (storageMode.isAnyApi()) {
    return knex('any_records')
      .where({
        tenant_id: tenantId,
        resource: resourceName,
        logical_id: String(id),
      })
      .first()
  }

  return knex(tableName)
    .where(idColumn, id)
    .first()
}

const countStoredRows = async (tableName, resourceName, idColumn, id) => {
  if (storageMode.isAnyApi()) {
    const row = await knex('any_records')
      .where({
        tenant_id: tenantId,
        resource: resourceName,
        logical_id: String(id),
      })
      .count('* as count')
      .first()
    return Number(row?.count || 0)
  }

  const row = await knex(tableName)
    .where(idColumn, id)
    .count('* as count')
    .first()
  return Number(row?.count || 0)
}

describe(`PUT create parity (${storageMode.mode})`, () => {
  before(async () => {
    if (storageMode.isAnyApi()) {
      storageMode.clearRegistry()
      storageMode.setCurrentTenant(tenantId)
      await ensureAnyApiSchema(knex)
    }

    api = new Api({
      name: 'put-create-parity-test',
      log: { level: 'warn' }
    })

    await api.use(RestApiPlugin, {
      simplifiedApi: false,
      simplifiedTransport: false,
      returnRecordApi: {
        post: 'full',
        put: 'full',
        patch: 'full'
      },
      returnRecordTransport: {
        post: 'full',
        put: 'full',
        patch: 'full'
      },
      sortableFields: ['id', 'account_id', 'name', 'code']
    })

    if (storageMode.isAnyApi()) {
      await api.use(RestApiAnyapiKnexPlugin, { knex, tenantId })
    } else {
      await api.use(RestApiKnexPlugin, { knex })
    }

    await api.addResource('profiles', {
      tableName: profilesTable,
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        code: { type: 'string', required: true },
      }
    })
    await api.resources.profiles.createKnexTable()
    registerTable(profilesTable, 'profiles')

    await api.addResource('accounts', {
      tableName: accountsTable,
      idProperty: 'account_id',
      schema: {
        name: { type: 'string', required: true },
        code: { type: 'string', required: true },
      }
    })
    await api.resources.accounts.createKnexTable()
    registerTable(accountsTable, 'accounts')
  })

  after(async () => {
    await api?.release()
    await knex.destroy()
    if (storageMode.isAnyApi()) {
      storageMode.clearRegistry()
    }
  })

  beforeEach(async () => {
    await cleanTables(knex, [profilesTable, accountsTable])
  })

  it('creates a missing resource through PUT with the default id property', async () => {
    const created = await api.resources.profiles.put({
      id: '101',
      inputRecord: {
        data: {
          type: 'profiles',
          id: '101',
          attributes: {
            name: 'Created Profile',
            code: 'CP'
          }
        }
      },
      simplified: false
    })

    validateJsonApiStructure(created)
    assert.equal(created.data.id, '101')
    assert.equal(created.data.attributes.name, 'Created Profile')

    const stored = await findStoredRow(profilesTable, 'profiles', 'id', 101)
    assert(stored, 'PUT create should persist a row')
  })

  it('creates and then replaces a missing resource through PUT with a custom id property', async () => {
    const created = await api.resources.accounts.put({
      id: '501',
      inputRecord: {
        data: {
          type: 'accounts',
          id: '501',
          attributes: {
            name: 'Created Account',
            code: 'CA'
          }
        }
      },
      simplified: false
    })

    validateJsonApiStructure(created)
    assert.equal(created.data.id, '501')
    assert.equal(created.data.attributes.name, 'Created Account')
    assert.equal(created.data.attributes.account_id, undefined)

    const replaced = await api.resources.accounts.put({
      id: '501',
      inputRecord: {
        data: {
          type: 'accounts',
          id: '501',
          attributes: {
            name: 'Replaced Account',
            code: 'RA'
          }
        }
      },
      simplified: false
    })

    assert.equal(replaced.data.id, '501')
    assert.equal(replaced.data.attributes.name, 'Replaced Account')
    assert.equal(await countStoredRows(accountsTable, 'accounts', 'account_id', 501), 1)

    const fetched = await api.resources.accounts.get({
      id: '501',
      simplified: false
    })
    assert.equal(fetched.data.attributes.name, 'Replaced Account')
    assert.equal(fetched.data.attributes.code, 'RA')
    assert.equal(fetched.data.attributes.account_id, undefined)
  })
})
