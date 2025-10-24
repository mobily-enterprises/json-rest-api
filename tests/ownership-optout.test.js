import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  validateJsonApiStructure,
  cleanTables,
  createJsonApiDocument,
  assertResourceAttributes
} from './helpers/test-utils.js'
import { createOwnershipOptOutApi } from './fixtures/api-configs.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
})

let api

async function createPublicItem (resourceName, name, authUserId) {
  const doc = createJsonApiDocument(resourceName, { name })
  const res = await api.resources[resourceName].post({
    inputRecord: doc,
    simplified: false
  }, { auth: { userId: authUserId } })

  validateJsonApiStructure(res)
  assertResourceAttributes(res.data, { name })
  return res.data
}

describe('Ownership opt-out (ownerField:false / ownership:false)', () => {
  before(async () => {
    api = await createOwnershipOptOutApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'ownopt_public_items_of',
      'ownopt_public_items_own'
    ])
  })

  it('ownerField:false - allows create+query without user_id column present', async () => {
    await createPublicItem('public_items_ownerfield', 'Alpha', 1)
    await createPublicItem('public_items_ownerfield', 'Beta', 2)

    // Query with auth
    const resultAuth = await api.resources.public_items_ownerfield.query({ simplified: false }, { auth: { userId: 1 } })
    validateJsonApiStructure(resultAuth, true)
    assert.equal(resultAuth.data.length, 2)

    // Query without auth (ownership disabled -> no filtering)
    const resultNoAuth = await api.resources.public_items_ownerfield.query({ simplified: false })
    validateJsonApiStructure(resultNoAuth, true)
    assert.equal(resultNoAuth.data.length, 2)
  })

  it('ownership:false - allows create+query without user_id column present', async () => {
    await createPublicItem('public_items_ownership', 'Gamma', 1)
    await createPublicItem('public_items_ownership', 'Delta', 2)

    const resultAuth = await api.resources.public_items_ownership.query({ simplified: false }, { auth: { userId: 99 } })
    validateJsonApiStructure(resultAuth, true)
    assert.equal(resultAuth.data.length, 2)

    const resultNoAuth = await api.resources.public_items_ownership.query({ simplified: false })
    validateJsonApiStructure(resultNoAuth, true)
    assert.equal(resultNoAuth.data.length, 2)
  })
})

