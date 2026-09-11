import { it } from 'node:test'
import assert from 'node:assert/strict'
import { buildJoinChain } from '../plugins/core/lib/querying/knex-cross-table-search.js'

const log = { trace () {} }
const scope = (tableName, structure = {}, schemaRelationships = {}) => ({ vars: { schemaInfo: { tableName, schemaInstance: { structure }, schemaRelationships } } })
for (const kind of ['belongsTo', 'hasMany', 'manyToMany', 'polymorphic']) {
  it(`continues from the target after a pivot before ${kind}`, async () => {
    const scopes = {
      books: scope('books', {}, { authors: { type: 'manyToMany', through: 'credits', foreignKey: 'bookId', otherKey: 'authorId' } }),
      credits: scope('credits'),
      authors: scope('authors'),
      countries: scope('countries', { name: { type: 'string', indexed: true } }),
      locations: scope('locations')
    }
    if (kind === 'belongsTo') scopes.authors.vars.schemaInfo.schemaInstance.structure.countryId = { belongsTo: 'countries' }
    else if (kind === 'polymorphic') {
      scopes.authors.vars.schemaInfo.schemaRelationships.countries = { type: 'hasMany', target: 'countries', via: 'owner' }
      scopes.countries.vars.schemaInfo.schemaRelationships.owner = { belongsToPolymorphic: { types: ['authors'], typeField: 'ownerType', idField: 'ownerId' } }
    } else {
      scopes.authors.vars.schemaInfo.schemaRelationships.countries = kind === 'hasMany'
        ? { type: 'hasMany', target: 'countries', foreignKey: 'authorId' }
        : { type: 'manyToMany', through: 'locations', foreignKey: 'authorId', otherKey: 'countryId' }
    }
    const result = await buildJoinChain(scopes, log, 'books', 'authors.countries.name')
    assert.match(result.joinChain[2].joinCondition, /credits_to_authors_authors\./)
    assert.doesNotMatch(result.joinChain[2].joinCondition, /books_to_credits_credits\./)
  })
}

it('preserves an existing hasMany path regardless of manyToMany declaration order', async () => {
  const scopes = {
    books: scope('books', {}, {
      contributors: { type: 'manyToMany', target: 'authors', through: 'credits', foreignKey: 'bookId', otherKey: 'authorId' },
      authors: { type: 'hasMany', target: 'authors', foreignKey: 'bookId' }
    }),
    credits: scope('credits'),
    authors: scope('authors', { name: { type: 'string', indexed: true } })
  }
  const result = await buildJoinChain(scopes, log, 'books', 'authors.name')
  assert.equal(result.isMultiLevel, undefined)
  assert.equal(result.joinCondition, 'books.id = books_to_authors_authors.bookId')
})
