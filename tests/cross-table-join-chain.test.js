import { it } from 'node:test'
import assert from 'node:assert/strict'
import { buildJoinChain, validateCrossTableField } from '../plugins/core/lib/querying/knex-cross-table-search.js'

const log = { trace () {} }
const scope = (tableName, structure = {}, schemaRelationships = {}) => ({ vars: { schemaInfo: { tableName, schemaInstance: { structure }, schemaRelationships } } })

for (const writer of ['none', 'throw', 'reject']) {
  it(`retains missing foreign-key configuration with ${writer} diagnostic writer`, async () => {
    const scopes = {
      books: scope('books', {}, { authors: { type: 'hasMany', target: 'authors' } }),
      authors: scope('authors', { name: { type: 'string', indexed: true } })
    }
    const calls = []
    await assert.rejects(buildJoinChain(scopes, {
      trace () {},
      error: (...args) => {
        calls.push(args)
        if (writer === 'throw') throw new Error('Diagnostic writer failed')
        if (writer === 'reject') return Promise.reject(new Error('Diagnostic writer failed'))
      }
    }, 'books', 'authors.name'), /Missing foreignKey in hasMany relationship/)
    assert.equal(calls.length, 1)
    const { error: failure, ...metadata } = calls[0][1]
    assert.match(failure.message, /Missing foreignKey/)
    assert.deepEqual(metadata, { method: 'buildJoinChain', scopeName: 'books', phase: 'crossTableJoin', backend: null, transactionOutcome: 'none', relName: 'authors' })
  })
}

for (const cause of [null, Object.freeze(new Error('Schema metadata failed'))]) {
  it(`retains the ${cause === null ? 'null' : 'frozen'} schema lookup cause without another error log`, async () => {
    const scopes = { get books () { throw cause } }
    await assert.rejects(validateCrossTableField(scopes, log, 'books', 'name'), error => {
      assert.equal(error.cause, cause)
      assert.equal(error.message, "Target scope 'books' not found")
      return true
    })
  })
}
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
