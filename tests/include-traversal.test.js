import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createIncludeTraversalApi, seedIncludeTraversalApi } from './fixtures/api-configs.js'
import { cleanTables, validateJsonApiStructure } from './helpers/test-utils.js'

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })

describe('Include traversal across paths, parents and resource types', () => {
  let api
  let branches
  before(async () => { api = await createIncludeTraversalApi(knex) })
  after(async () => { await knex.destroy() })
  beforeEach(async () => {
    await cleanTables(knex, ['comments', 'profiles', 'books', 'writers', 'publishers', 'countries'].map(name => `traversal_${name}`))
    branches = await seedIncludeTraversalApi(api)
  })

  const query = (resource, include) => api.resources[resource].query({ format: 'jsonapi', queryParams: { include } })
  const included = (response, type) => (response.included || []).filter(record => record.type === type)
  const assertCountries = response => {
    validateJsonApiStructure(response, true)
    assert.deepEqual(included(response, 'countries').map(record => record.attributes.name).sort(), ['Country 1', 'Country 2'])
    const identifiers = response.included.map(record => `${record.type}:${record.id}`)
    assert.equal(new Set(identifiers).size, identifiers.length, 'included resources are unique')
  }

  it('continues through three levels and finite relationship cycles', async () => {
    const response = await query('publishers', ['books.publisher.country'])
    assertCountries(response)
    assert.equal(included(response, 'books').length, 2)
  })

  it('traverses children of a resource already included through another path', async () => {
    for (const paths of [
      ['publisher', 'publisher.books.publisher.country'],
      ['publisher.books.publisher.country', 'publisher']
    ]) {
      assertCountries(await query('books', paths))
    }
  })

  it('returns properly shaped hasOne resources and children for every parent', async () => {
    const response = await query('writers', ['profile.country'])
    assertCountries(response)
    assert.deepEqual(included(response, 'profiles').map(record => record.attributes.name).sort(), ['Profile 1', 'Profile 2'])
    for (const branch of branches) {
      const writer = response.data.find(record => record.id === branch.writer.id)
      assert.deepEqual(writer.relationships.profile.data, branch.profile)
      const profile = included(response, 'profiles').find(record => record.id === branch.profile.id)
      assert.deepEqual(profile.relationships.country.data, branch.country)
    }
  })

  it('traverses the same nested path for every polymorphic target type', async () => {
    assertCountries(await query('comments', ['subject.publisher.country']))
  })

  it('continues polymorphic subtrees when their targets were already included', async () => {
    assertCountries(await query('comments', ['reviewer.publisher', 'subject.publisher.country']))
  })

  it('validates polymorphic paths against declared target types independently of stored rows', async () => {
    const response = await query('comments', ['subject.profile.country'])
    assert.deepEqual(included(response, 'countries').map(record => record.attributes.name), ['Country 1'])
    await assert.rejects(query('comments', ['subject.missing']), { code: 'REST_API_INCLUDE_INVALID' })
    await cleanTables(knex, ['traversal_comments'])
    await assert.rejects(query('comments', ['subject.profile.missing']), { code: 'REST_API_INCLUDE_INVALID' })
    assert.deepEqual((await query('comments', ['subject.profile.country'])).data, [])
  })

  it('retains nested include data while applying sparse fields to hasOne resources', async () => {
    const response = await api.resources.writers.query({
      format: 'jsonapi',
      queryParams: { include: ['profile.country'], fields: { profiles: 'name,country' } }
    })
    assertCountries(response)
    for (const profile of included(response, 'profiles')) {
      assert.deepEqual(Object.keys(profile.attributes), ['name'])
      const branch = branches.find(branch => branch.profile.id === profile.id)
      assert.deepEqual(profile.relationships.country.data, branch.country)
    }
  })

  it('returns null linkage for an absent hasOne resource', async () => {
    await api.resources.profiles.delete({ id: branches[1].profile.id })
    const response = await query('writers', ['profile.country'])
    validateJsonApiStructure(response, true)
    assert.equal(response.data.find(record => record.id === branches[1].writer.id).relationships.profile.data, null)
    assert.deepEqual(included(response, 'profiles').map(record => record.id), [branches[0].profile.id])
    assert.deepEqual(included(response, 'countries').map(record => record.id), [branches[0].country.id])
  })

  it('continues through reverse polymorphic includes', async () => {
    const response = await query('writers', ['comments.reviewer.publisher.country'])
    validateJsonApiStructure(response, true)
    assert.deepEqual(included(response, 'countries').map(record => record.attributes.name), ['Country 1'])
    assert.deepEqual(included(response, 'comments').map(record => record.id), [branches[0].comment.id])
  })

  it('reads reverse polymorphic children without searchable discriminator fields', async () => {
    const response = await api.resources.writers.getRelated({
      id: branches[0].writer.id,
      relationshipName: 'comments',
      queryParams: { include: ['reviewer.publisher.country'], page: { number: 1, size: 1 } },
      format: 'jsonapi'
    })
    assert.deepEqual(response.data.map(record => record.id), [branches[0].comment.id])
    assert.equal(response.meta.pagination.total, 1)
    assert.deepEqual(included(response, 'countries').map(record => record.id), [branches[0].country.id])
    const empty = await api.resources.writers.getRelated({
      id: branches[1].writer.id, relationshipName: 'comments', format: 'jsonapi'
    })
    assert.deepEqual(empty.data, [])
  })
})
