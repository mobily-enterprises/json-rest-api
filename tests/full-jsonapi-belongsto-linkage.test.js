import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createCamelCaseBelongsToApi } from './fixtures/api-configs.js'
import {
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier,
  assertResourceRelationship
} from './helpers/test-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api

describe('Full JSON:API belongsTo linkage', () => {
  before(async () => {
    api = await createCamelCaseBelongsToApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await knex('camel_fk_publishers').delete()
    await knex('camel_fk_countries').delete()
  })

  const createCountry = async () => {
    return api.resources.countries.post({
      document: createJsonApiDocument('countries', {
        name: 'United States'
      }),
      format: 'jsonapi'
    })
  }

  const createPublisher = async (countryId = null) => {
    return api.resources.publishers.post({
      document: createJsonApiDocument(
        'publishers',
        { name: 'Mapped Publisher' },
        {
          country: createRelationship(
            countryId == null ? null : resourceIdentifier('countries', countryId)
          )
        }
      ),
      format: 'jsonapi'
    })
  }

  it('emits belongsTo linkage on primary resources without include for single and collection responses', async () => {
    const country = await createCountry()
    const publisher = await createPublisher(country.data.id)

    assertResourceRelationship(
      publisher.data,
      'country',
      resourceIdentifier('countries', country.data.id)
    )
    assert.equal(Object.hasOwn(publisher.data.attributes, 'countryId'), false)

    const single = await api.resources.publishers.get({
      id: publisher.data.id,
      format: 'jsonapi'
    })

    assertResourceRelationship(
      single.data,
      'country',
      resourceIdentifier('countries', country.data.id)
    )
    assert.equal(Object.hasOwn(single.data.attributes, 'countryId'), false)

    const collection = await api.resources.publishers.query({
      format: 'jsonapi'
    })

    assert.equal(collection.data.length, 1)
    assertResourceRelationship(
      collection.data[0],
      'country',
      resourceIdentifier('countries', country.data.id)
    )
    assert.equal(Object.hasOwn(collection.data[0].attributes, 'countryId'), false)
  })

  it('keeps primary belongsTo linkage when include is requested and adds included resources', async () => {
    const country = await createCountry()
    const publisher = await createPublisher(country.data.id)

    const result = await api.resources.publishers.get({
      id: publisher.data.id,
      queryParams: {
        include: ['country']
      },
      format: 'jsonapi',
      returning: 'full'
    })

    assertResourceRelationship(
      result.data,
      'country',
      resourceIdentifier('countries', country.data.id)
    )
    assert.equal(Object.hasOwn(result.data.attributes, 'countryId'), false)
    assert.equal(result.included?.length, 1)
    assert.equal(result.included?.[0]?.type, 'countries')
    assert.equal(result.included?.[0]?.id, country.data.id)
  })

  it('emits explicit null belongsTo linkage without exposing the foreign key attribute', async () => {
    const country = await createCountry()
    const publisher = await createPublisher(country.data.id)

    const patched = await api.resources.publishers.patch({
      id: publisher.data.id,
      document: {
        data: {
          type: 'publishers',
          id: publisher.data.id,
          relationships: {
            country: { data: null }
          }
        }
      },
      format: 'jsonapi',
      returning: 'full'
    })

    assert.equal(patched.data.relationships?.country?.data, null)
    assert.equal(Object.hasOwn(patched.data.attributes, 'countryId'), false)

    const single = await api.resources.publishers.get({
      id: publisher.data.id,
      format: 'jsonapi'
    })

    assert.equal(single.data.relationships?.country?.data, null)
    assert.equal(Object.hasOwn(single.data.attributes, 'countryId'), false)
  })
})
