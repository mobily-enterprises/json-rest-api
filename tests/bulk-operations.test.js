import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createBulkOperationsApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { cleanTables } from './helpers/test-utils.js'

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
const cause = error => error?.cause ?? error
const country = id => ({ country: { data: { type: 'countries', id } } })

// postMany, patchMany and deleteMany on resources with belongsTo and many-to-many relationships.
describe('Many-row writes on related resources', { skip: storageMode.isAnyApi() && 'many-row writes need table storage' }, () => {
  let api, countryId

  before(async () => { api = await createBulkOperationsApi(knex) })
  after(async () => { await knex.destroy() })
  beforeEach(async () => {
    await cleanTables(knex, ['basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'])
    countryId = (await api.resources.countries.post({ document: { data: { type: 'countries', attributes: { name: 'Test Country', code: 'TC' } } } })).data.id
  })

  it('creates records with belongsTo relationships in input order', async () => {
    const result = await api.resources.publishers.postMany({
      returning: 'full',
      format: 'jsonapi',
      document: { data: ['One', 'Two', 'Three'].map(name => ({ type: 'publishers', attributes: { name }, relationships: country(countryId) })) }
    })
    assert.deepEqual(result.data.map(row => row.attributes.name), ['One', 'Two', 'Three'])
    for (const publisher of result.data) assert.equal(publisher.relationships.country.data.id, countryId)
    const stored = await api.resources.publishers.query({ format: 'jsonapi', queryParams: { sort: ['name'] } })
    assert.deepEqual(stored.data.map(row => row.attributes.name), ['One', 'Three', 'Two'])
  })

  it('writes nothing when one record is invalid and names its index', async () => {
    await assert.rejects(api.resources.authors.postMany({ data: [{ name: 'Valid' }, {}] }), error => {
      assert.equal(cause(error).code, 'REST_API_VALIDATION')
      assert.equal(cause(error).details.index, 1)
      return true
    })
    assert.equal((await knex('basic_authors')).length, 0)
  })

  it('checks belongsTo targets for the whole batch', async () => {
    await assert.rejects(api.resources.publishers.postMany({
      document: { data: [{ type: 'publishers', attributes: { name: 'Orphan' }, relationships: country('999') }] }
    }))
    assert.equal((await knex('basic_publishers')).length, 0)
  })

  it('refuses many-to-many links, which need single writes', async () => {
    const [author] = (await api.resources.authors.postMany({ data: [{ name: 'Writer' }], returning: 'minimal' })).data
    await assert.rejects(api.resources.books.postMany({
      document: { data: [{ type: 'books', attributes: { title: 'Linked' }, relationships: { ...country(countryId), authors: { data: [{ type: 'authors', id: author.id }] } } }] }
    }), error => cause(error).code === 'REST_API_BULK_WRITE_UNSUPPORTED')
    assert.equal((await knex('basic_books')).length, 0)
  })

  it('updates attributes and belongsTo links of many records', async () => {
    const other = (await api.resources.countries.post({ document: { data: { type: 'countries', attributes: { name: 'Other', code: 'OT' } } } })).data.id
    const created = await api.resources.publishers.postMany({ data: [{ name: 'A', country: countryId }, { name: 'B', country: countryId }], returning: 'minimal' })
    const ids = created.data.map(row => row.id)
    const updated = await api.resources.publishers.patchMany({
      format: 'jsonapi',
      returning: 'full',
      document: { data: ids.map((id, index) => ({ type: 'publishers', id, attributes: { name: `Renamed ${index}` }, relationships: country(other) })) }
    })
    assert.deepEqual(updated.data.map(row => [row.attributes.name, row.relationships.country.data.id]), [['Renamed 0', other], ['Renamed 1', other]])
  })

  it('deletes records with their many-to-many links', async () => {
    const book = (await api.resources.books.post({ document: { data: { type: 'books', attributes: { title: 'Linked' }, relationships: country(countryId) } } })).data
    const authors = await api.resources.authors.postMany({ data: [{ name: 'One' }, { name: 'Two' }], returning: 'minimal' })
    for (const author of authors.data) await api.resources.book_authors.post({ data: { book: book.id, author: author.id } })
    assert.equal((await knex('basic_book_authors')).length, 2)

    const deleted = await api.resources.authors.deleteMany({ ids: authors.data.map(author => author.id), returning: 'minimal' })
    assert.deepEqual(deleted.data, authors.data)
    assert.equal((await knex('basic_authors')).length, 0)
    assert.equal((await knex('basic_book_authors')).length, 0)
    await assert.rejects(api.resources.authors.deleteMany({ ids: authors.data.map(author => author.id) }), error => cause(error).subtype === 'not_found')
  })

  it('writes large batches in chunks of one statement each', async () => {
    const statements = []
    const record = query => { if (/^insert/i.test(query.sql)) statements.push(query.sql) }
    knex.on('query', record)
    try {
      await api.resources.authors.postMany({ data: Array.from({ length: 250 }, (_, index) => ({ name: `Author ${index}` })), chunkSize: 100 })
    } finally { knex.removeListener('query', record) }
    assert.equal(statements.length, 3)
    assert.equal((await knex('basic_authors')).length, 250)
  })
})
