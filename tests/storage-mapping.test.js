import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { JsonRestApi } from '../lib/runtime/json-rest-api.js'
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js'
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js'
import {
  REST_API_TEMPORAL_DATA_ERROR_CODE,
  RestApiTemporalDataError
} from '../lib/rest-api-errors.js'
import { mapRestApiErrorToHttp } from '../plugins/core/connectors/lib/transport-http-helpers.js'
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
const DEFAULT_PROFILE_CREATED_AT = '2026-08-25T12:34:56.789Z'
const COMPUTED_PROFILE_DATE = new Date('2026-08-25T23:45:01.987Z')

const serializeDateTimeForSql = (value) => {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new Error('serializeDateTimeForSql expects an RFC 3339 string after schema validation')
  }

  return new Date(value).toISOString().replace('T', ' ').slice(0, 19)
}

describe('Storage mapping', () => {
  before(async () => {
    api = new JsonRestApi({
      name: 'storage-mapping-test',
    })

    await api.use(RestApiPlugin, {
      format: 'jsonapi',
      sortableFields: ['id', 'displayName', 'loginCount', 'lastSeenAt', 'countryId', 'externalRef'],
      returning: 'full',

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
        displayName: { type: 'string', required: true, search: true },
        loginCount: { type: 'number', defaultTo: 0 },
        lastSeenAt: {
          type: 'dateTime',
          nullable: true,
          temporalPrecision: 0,
          getter: (value) => value == null ? value : new Date(value),
          storage: {
            serialize: serializeDateTimeForSql
          }
        },
        createdAt: {
          type: 'dateTime',
          temporalPrecision: 3,
          defaultTo: () => new Date(DEFAULT_PROFILE_CREATED_AT).toISOString()
        },
        calculatedAt: {
          type: 'dateTime',
          temporalPrecision: 0,
          computed: true,
          compute: () => new Date(COMPUTED_PROFILE_DATE)
        },
        birthDate: { type: 'date', nullable: true },
        openingTime: { type: 'time', nullable: true, temporalPrecision: 2 },
        observedAtMs: { type: 'epochMilliseconds', nullable: true },
        observedAtSeconds: { type: 'epochSeconds', nullable: true },
        countryId: {
          type: 'id',
          nullable: true,
          belongsTo: 'countries',
          as: 'country'
        },
        externalRef: { type: 'string', nullable: true, search: true, storage: { column: 'legacy_ref' } },
        confirmationToken: { type: 'string', virtual: true }
      },
      tableName: 'mapped_profiles'
    })
    await api.resources.profiles.createKnexTable()

    await api.addResource('verbatim_profiles', {
      storage: { naming: 'exact' },
      schema: {
        id: { type: 'id' },
        displayName: { type: 'string', required: true },
        loginCount: { type: 'number', defaultTo: 0 }
      },
      tableName: 'verbatim_profiles'
    })
    await api.resources.verbatim_profiles.createKnexTable()
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['mapped_profiles', 'mapped_countries', 'verbatim_profiles'])
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
          lastSeenAt: '2026-01-02T11:04:05+08:00',
          birthDate: '2020-02-29',
          openingTime: '09:30:15.12',
          observedAtMs: '1767323045000',
          observedAtSeconds: '1767323045',
          externalRef: 'legacy-001',
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
    assert.equal(createResult.data.attributes.lastSeenAt, '2026-01-02T03:04:05Z')
    assert.equal(createResult.data.attributes.createdAt, DEFAULT_PROFILE_CREATED_AT)
    assert.equal(createResult.data.attributes.calculatedAt, '2026-08-25T23:45:01Z')
    assert.equal(createResult.data.attributes.birthDate, '2020-02-29')
    assert.equal(createResult.data.attributes.openingTime, '09:30:15.12')
    assert.equal(createResult.data.attributes.observedAtMs, 1767323045000)
    assert.equal(createResult.data.attributes.observedAtSeconds, 1767323045)
    assert.ok(!('display_name' in createResult.data.attributes))
    assert.ok(!('country_id' in createResult.data.attributes))

    const dbRecord = await knex('mapped_profiles').first()
    assert.equal(dbRecord.display_name, 'Mercury')
    assert.equal(dbRecord.login_count, 7)
    assert.equal(dbRecord.last_seen_at, '2026-01-02 03:04:05')
    assert.equal(dbRecord.observed_at_ms, 1767323045000)
    assert.equal(dbRecord.observed_at_seconds, 1767323045)
    assert.equal(String(dbRecord.country_id), country.data.id)
    assert.equal(dbRecord.legacy_ref, 'legacy-001')
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
    assert.equal(getResult.data.attributes.lastSeenAt, '2026-01-02T03:04:05Z')
    assert.equal(getResult.data.attributes.createdAt, DEFAULT_PROFILE_CREATED_AT)
    assert.equal(getResult.data.attributes.calculatedAt, '2026-08-25T23:45:01Z')
    assert.equal(getResult.data.attributes.birthDate, '2020-02-29')
    assert.equal(getResult.data.attributes.openingTime, '09:30:15.12')
    assert.equal(getResult.data.attributes.observedAtMs, 1767323045000)
    assert.equal(getResult.data.attributes.observedAtSeconds, 1767323045)
    assert.ok(!('display_name' in getResult.data.attributes))
    assertResourceRelationship(
      getResult.data,
      'country',
      resourceIdentifier('countries', country.data.id)
    )

    const queryResult = await api.resources.profiles.query({
      queryParams: {
        filters: {
          displayName: 'Mercury',
          externalRef: 'legacy-001'
        }
      }
    })

    validateJsonApiStructure(queryResult, true)
    assert.equal(queryResult.data.length, 1)
    assertResourceAttributes(queryResult.data[0], {
      displayName: 'Mercury',
      externalRef: 'legacy-001'
    })
    assert.equal(queryResult.data[0].attributes.createdAt, DEFAULT_PROFILE_CREATED_AT)
    assert.equal(queryResult.data[0].attributes.calculatedAt, '2026-08-25T23:45:01Z')
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
    assert.equal(patchResult.data.attributes.lastSeenAt, '2026-02-03T04:05:06Z')

    const dbRecord = await knex('mapped_profiles').where('id', created.data.id).first()
    assert.equal(dbRecord.display_name, 'After')
    assert.equal(dbRecord.last_seen_at, '2026-02-03 04:05:06')
    assert.ok(!('displayName' in dbRecord))
  })

  it('rejects temporal values outside the public JSON contract before storage', async () => {
    const invalidTemporalValues = [
      { lastSeenAt: '2026-01-02 03:04:05' },
      { lastSeenAt: new Date('2026-01-02T03:04:05Z') },
      { birthDate: '2026-02-30' },
      { openingTime: '09:30Z' }
    ]

    for (const [index, temporalAttributes] of invalidTemporalValues.entries()) {
      await assert.rejects(
        api.resources.profiles.post({
          inputRecord: createJsonApiDocument('profiles', {
            displayName: `Invalid temporal value ${index}`,
            ...temporalAttributes
          })
        }),
        (error) => error?.code === 'REST_API_VALIDATION'
      )
    }
  })

  it('fails loudly when storage returns an invalid non-null temporal value', async () => {
    const insertedIds = await knex('mapped_profiles').insert({
      display_name: 'Corrupt temporal row',
      login_count: 0,
      last_seen_at: 'not-a-date',
      created_at: new Date(DEFAULT_PROFILE_CREATED_AT)
    })
    const profileId = insertedIds[0]

    await assert.rejects(
      api.resources.profiles.get({ id: profileId }),
      (error) => {
        assert(error instanceof RestApiTemporalDataError)
        assert.equal(error.code, REST_API_TEMPORAL_DATA_ERROR_CODE)
        assert.equal(
          error.message,
          "Invalid database value for dateTime field 'profiles.lastSeenAt'."
        )
        assert.deepEqual(error.details, {
          field: 'lastSeenAt',
          resourceType: 'profiles',
          fieldType: 'dateTime',
          source: 'database'
        })
        assert.deepEqual(mapRestApiErrorToHttp(error), {
          status: 500,
          body: {
            errors: [{
              status: '500',
              code: REST_API_TEMPORAL_DATA_ERROR_CODE,
              title: 'Invalid Temporal Data',
              detail: "Invalid database value for dateTime field 'profiles.lastSeenAt'."
            }]
          }
        })
        return true
      }
    )
  })

  it('can opt out of snake_case translation for an entire resource', async () => {
    const created = await api.resources.verbatim_profiles.post({
      inputRecord: createJsonApiDocument('verbatim_profiles', {
        displayName: 'Exact Mode',
        loginCount: 3
      })
    })

    validateJsonApiStructure(created)
    assertResourceAttributes(created.data, {
      displayName: 'Exact Mode',
      loginCount: 3
    })

    const dbRecord = await knex('verbatim_profiles').where('id', created.data.id).first()
    assert.equal(dbRecord.displayName, 'Exact Mode')
    assert.equal(dbRecord.loginCount, 3)
    assert.equal(Object.hasOwn(dbRecord, 'display_name'), false)
    assert.equal(Object.hasOwn(dbRecord, 'login_count'), false)
  })
})
