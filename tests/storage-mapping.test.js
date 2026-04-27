import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js'
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js'
import {
  cleanTables,
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier,
  assertResourceAttributes,
  assertResourceRelationship,
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

const serializeDateTimeForSql = (value) => {
  if (value == null) return null
  if (!(value instanceof Date)) {
    throw new Error('serializeDateTimeForSql expects a Date value after schema normalization')
  }

  return value.toISOString().replace('T', ' ').slice(0, 19)
}

describe('Storage mapping', () => {
  before(async () => {
    api = new Api({
      name: 'storage-mapping-test',
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
      }
    })
    await api.use(RestApiKnexPlugin, { knex })

    await api.addResource('countries', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true }
      },
      relationships: {
        profiles: { type: 'hasMany', target: 'profiles', foreignKey: 'country_id' }
      },
      tableName: 'mapped_countries'
    })
    await api.resources.countries.createKnexTable()

    await api.addResource('profiles', {
      schema: {
        id: { type: 'id' },
        displayName: { type: 'string', required: true, storage: { column: 'display_name' } },
        loginCount: { type: 'number', defaultTo: 0, storage: { column: 'login_count' } },
        lastSeenAt: {
          type: 'dateTime',
          nullable: true,
          storage: {
            column: 'last_seen_at',
            serialize: serializeDateTimeForSql
          }
        },
        countryId: {
          type: 'id',
          nullable: true,
          belongsTo: 'countries',
          as: 'country',
          storage: { column: 'country_id' }
        },
        confirmationToken: { type: 'string', virtual: true }
      },
      tableName: 'mapped_profiles'
    })
    await api.resources.profiles.createKnexTable()
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['mapped_profiles', 'mapped_countries'])
  })

  it('persists mapped columns while exposing logical field names', async () => {
    const country = await api.resources.countries.post({
      inputRecord: createJsonApiDocument('countries', {
        name: 'Australia'
      })
    })

    const createResult = await api.resources.profiles.post({
      inputRecord: createJsonApiDocument(
        'profiles',
        {
          displayName: 'Mercury',
          loginCount: 7,
          lastSeenAt: '2026-01-02T03:04:05Z',
          confirmationToken: 'secret-token'
        },
        {
          country: createRelationship(resourceIdentifier('countries', country.data.id))
        }
      )
    })

    validateJsonApiStructure(createResult)
    assertResourceAttributes(createResult.data, {
      displayName: 'Mercury',
      loginCount: 7
    })
    assert.equal(createResult.data.attributes.confirmationToken, 'secret-token')
    assert.ok(createResult.data.attributes.lastSeenAt instanceof Date)
    assert.equal(createResult.data.attributes.lastSeenAt.toISOString(), '2026-01-02T03:04:05.000Z')
    assert.ok(!('display_name' in createResult.data.attributes))
    assert.ok(!('country_id' in createResult.data.attributes))

    const dbRecord = await knex('mapped_profiles').first()
    assert.equal(dbRecord.display_name, 'Mercury')
    assert.equal(dbRecord.login_count, 7)
    assert.equal(dbRecord.last_seen_at, '2026-01-02 03:04:05')
    assert.equal(String(dbRecord.country_id), country.data.id)
    assert.ok(!('displayName' in dbRecord))
    assert.ok(!('countryId' in dbRecord))
    assert.ok(!('confirmationToken' in dbRecord))

    const getResult = await api.resources.profiles.get({
      id: createResult.data.id,
      queryParams: {
        include: ['country']
      }
    })

    validateJsonApiStructure(getResult)
    assertResourceAttributes(getResult.data, {
      displayName: 'Mercury',
      loginCount: 7
    })
    assert.ok(getResult.data.attributes.lastSeenAt instanceof Date)
    assert.equal(getResult.data.attributes.lastSeenAt.toISOString(), '2026-01-02T03:04:05.000Z')
    assert.ok(!('display_name' in getResult.data.attributes))
    assertResourceRelationship(
      getResult.data,
      'country',
      resourceIdentifier('countries', country.data.id)
    )
  })

  it('applies storage mapping on PATCH updates and sparse fieldsets', async () => {
    const created = await api.resources.profiles.post({
      inputRecord: createJsonApiDocument('profiles', {
        displayName: 'Before',
        loginCount: 1,
        lastSeenAt: '2026-01-01T00:00:00Z'
      })
    })

    const patchResult = await api.resources.profiles.patch({
      id: created.data.id,
      inputRecord: {
        data: {
          type: 'profiles',
          id: created.data.id,
          attributes: {
            displayName: 'After',
            lastSeenAt: '2026-02-03T04:05:06Z',
            confirmationToken: 'updated-token'
          }
        }
      },
      queryParams: {
        fields: {
          profiles: 'displayName,lastSeenAt,confirmationToken'
        }
      }
    })

    validateJsonApiStructure(patchResult)
    assert.deepEqual(Object.keys(patchResult.data.attributes).sort(), ['confirmationToken', 'displayName', 'lastSeenAt'])
    assert.equal(patchResult.data.attributes.displayName, 'After')
    assert.equal(patchResult.data.attributes.confirmationToken, 'updated-token')
    assert.ok(patchResult.data.attributes.lastSeenAt instanceof Date)
    assert.equal(patchResult.data.attributes.lastSeenAt.toISOString(), '2026-02-03T04:05:06.000Z')

    const dbRecord = await knex('mapped_profiles').where('id', created.data.id).first()
    assert.equal(dbRecord.display_name, 'After')
    assert.equal(dbRecord.last_seen_at, '2026-02-03 04:05:06')
    assert.ok(!('displayName' in dbRecord))
  })
})
