import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  createRelationshipIncludeStorageAdapterApi,
  seedRelationshipIncludeStorageAdapterApi
} from './fixtures/api-configs.js'
import { cleanTables } from './helpers/test-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

describe('Relationship include storage adapters', () => {
  let api

  before(async () => {
    api = await createRelationshipIncludeStorageAdapterApi(knex)
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'uninitialized_bookings',
      'uninitialized_pets'
    ])
    await seedRelationshipIncludeStorageAdapterApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  it('maps sparse fields for an included scope whose adapter is not initialized', async () => {
    assert.equal(api.resources.pets.vars.storageAdapter, undefined)

    const result = await api.resources.bookings.get({
      id: 41,
      queryParams: {
        include: ['pet'],
        fields: {
          bookings: 'reference,petId',
          pets: 'firstName'
        }
      },
      simplified: false
    })

    const includedPet = result.included.find(resource => resource.type === 'pets')
    assert(includedPet)
    assert.deepEqual(includedPet.attributes, { firstName: 'Coco' })
  })
})
