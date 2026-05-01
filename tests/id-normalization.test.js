import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'

import {
  cleanTables,
  createJsonApiDocument,
  validateJsonApiStructure
} from './helpers/test-utils.js'
import { createIdNormalizationApi } from './fixtures/api-configs.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let defaultApi
let overrideApi

describe('Resource ID normalization', () => {
  before(async () => {
    defaultApi = await createIdNormalizationApi(knex, {
      tablePrefix: 'id_norm_default'
    })

    overrideApi = await createIdNormalizationApi(knex, {
      tablePrefix: 'id_norm_override',
      'rest-api': {
        returnRecordApi: {
          post: 'no',
          put: false,
          patch: false
        },
        normalizeId: (value) => {
          if (value === null || value === undefined) {
            return null
          }

          const normalized = String(value).trim()
          return normalized ? normalized.toUpperCase() : null
        }
      },
      countryResourceOptions: {
        normalizeId: (value) => {
          if (value === null || value === undefined) {
            return null
          }

          const normalized = String(value).trim()
          return normalized ? normalized.toLowerCase() : null
        }
      },
      tagResourceOptions: {
        normalizeId: (value) => {
          if (value === null || value === undefined) {
            return null
          }

          const normalized = String(value).trim()
          return normalized ? normalized.toLowerCase() : null
        }
      }
    })
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'id_norm_default_countries',
      'id_norm_default_publishers',
      'id_norm_default_tags',
      'id_norm_default_publisher_tags',
      'id_norm_override_countries',
      'id_norm_override_publishers',
      'id_norm_override_tags',
      'id_norm_override_publisher_tags'
    ])
  })

  it('uses the default normalizer to trim surrounding whitespace', async () => {
    const countryId = 'country-default'
    const countryDoc = createJsonApiDocument('countries', {
      name: 'Canada'
    })
    countryDoc.data.id = countryId

    await defaultApi.resources.countries.post({
      inputRecord: countryDoc,
      simplified: false
    })

    const result = await defaultApi.resources.countries.get({
      id: `  ${countryId}  `,
      simplified: false
    })

    validateJsonApiStructure(result)
    assert.equal(result.data.id, countryId)
    assert.equal(result.data.attributes.name, 'Canada')
  })

  it('lets a resource override the global normalizer', async () => {
    const countryId = 'country-override'
    const publisherId = 'publisher-override'
    const countryDoc = createJsonApiDocument('countries', {
      name: 'Spain'
    })
    countryDoc.data.id = countryId
    const publisherDoc = createJsonApiDocument('publishers', {
      name: 'Acme Press'
    })
    publisherDoc.data.id = publisherId

    await overrideApi.resources.countries.post({
      inputRecord: countryDoc,
      simplified: false
    })

    await overrideApi.resources.publishers.post({
      inputRecord: publisherDoc,
      simplified: false
    })

    const countryResult = await overrideApi.resources.countries.get({
      id: `  ${countryId.toUpperCase()}  `,
      simplified: false
    })

    validateJsonApiStructure(countryResult)
    assert.equal(countryResult.data.id, countryId)

    const publisherResult = await overrideApi.resources.publishers.get({
      id: `  ${publisherId}  `,
      simplified: false
    })

    validateJsonApiStructure(publisherResult)
    assert.equal(publisherResult.data.id, publisherId.toUpperCase())
  })

  it('normalizes explicit POST resource ids before persistence and return fetches', async () => {
    const inputRecord = createJsonApiDocument('publishers', {
      name: 'Explicit ID Press'
    })
    inputRecord.data.id = '  publisher-explicit  '

    const result = await overrideApi.resources.publishers.post({
      inputRecord,
      simplified: false
    })

    assert.equal(result, undefined)

    const inserted = await knex('id_norm_override_publishers')
      .where({ id: 'PUBLISHER-EXPLICIT' })
      .first()

    assert.equal(inserted?.id, 'PUBLISHER-EXPLICIT')

    const fetched = await overrideApi.resources.publishers.get({
      id: 'publisher-explicit',
      simplified: false
    })

    validateJsonApiStructure(fetched)
    assert.equal(fetched.data.id, 'PUBLISHER-EXPLICIT')
  })

  it('normalizes belongsTo relationship ids using the related resource normalizer before persistence', async () => {
    const countryRecord = createJsonApiDocument('countries', {
      name: 'Spain'
    })
    countryRecord.data.id = 'country-1'

    await overrideApi.resources.countries.post({
      inputRecord: countryRecord,
      simplified: false
    })

    const publisherRecord = createJsonApiDocument('publishers', {
      name: 'Country Linked Press'
    }, {
      country: {
        data: {
          type: 'countries',
          id: '  COUNTRY-1  '
        }
      }
    })
    publisherRecord.data.id = 'publisher-country'

    await overrideApi.resources.publishers.post({
      inputRecord: publisherRecord,
      simplified: false
    })

    const inserted = await knex('id_norm_override_publishers')
      .where({ id: 'PUBLISHER-COUNTRY' })
      .first()

    assert.equal(inserted?.country_id, 'country-1')
  })

  it('normalizes many-to-many relationship ids before pivot inserts and deletes', async () => {
    const tagRecord = createJsonApiDocument('tags', {
      name: 'Featured'
    })
    tagRecord.data.id = 'tag-1'

    await overrideApi.resources.tags.post({
      inputRecord: tagRecord,
      simplified: false
    })

    const publisherRecord = createJsonApiDocument('publishers', {
      name: 'Tagged Press'
    })
    publisherRecord.data.id = 'publisher-tags'

    await overrideApi.resources.publishers.post({
      inputRecord: publisherRecord,
      simplified: false
    })

    await overrideApi.resources.publishers.postRelationship({
      id: ' publisher-tags ',
      relationshipName: 'tags',
      relationshipData: [
        {
          type: 'tags',
          id: '  TAG-1  '
        }
      ],
      simplified: false
    })

    let pivotRows = await knex('id_norm_override_publisher_tags')
      .where({ publisher_id: 'PUBLISHER-TAGS' })
      .select('publisher_id', 'tag_id')

    assert.deepEqual(pivotRows, [{
      publisher_id: 'PUBLISHER-TAGS',
      tag_id: 'tag-1'
    }])

    await overrideApi.resources.publishers.deleteRelationship({
      id: 'publisher-tags',
      relationshipName: 'tags',
      relationshipData: [
        {
          type: 'tags',
          id: ' TAG-1 '
        }
      ],
      simplified: false
    })

    pivotRows = await knex('id_norm_override_publisher_tags')
      .where({ publisher_id: 'PUBLISHER-TAGS' })
      .select('publisher_id', 'tag_id')

    assert.deepEqual(pivotRows, [])
  })
})
