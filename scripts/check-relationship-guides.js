import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JsonRestApi } from '../index.js'
import knexLib from 'knex'
import { RestApiPlugin, RestApiKnexPlugin, RestApiAnyapiKnexPlugin } from '../index.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const examples = [
  {
    file: 'GUIDE_2_6_Many_To_Many.md',
    modes: ['knex'],
    names: 'neil, terry, goodOmens, americanGods, includedBook, includedDocument, booksByNeil, authorsOfGods, contribution, updatedPivots, remainingMembers, remainingPivots, terryStillExists',
    check (result) {
      assert.deepEqual(result.includedBook.authors.map(author => author.name).sort(), ['Neil Gaiman', 'Terry Pratchett'])
      assert.equal(result.includedDocument.included.length, 2)
      assert.equal(result.booksByNeil.data.length, 2)
      assert.equal(result.booksByNeil.data.find(book => book.id === result.goodOmens.id).authors.length, 2)
      assert.deepEqual(result.authorsOfGods.data.map(author => author.id), [result.neil.id])
      assert.equal(result.contribution.contribution, 'primary')
      assert.equal(result.updatedPivots.data.length, 2)
      for (const pivot of result.updatedPivots.data) assert.equal(pivot.contribution, 'co-author')
      assert.deepEqual(result.remainingMembers.data, [{ type: 'authors', id: result.neil.id }])
      assert.equal(result.remainingPivots.data.length, 1)
      assert.equal(result.remainingPivots.data[0].contribution, 'co-author')
      assert.equal(result.terryStillExists.name, 'Terry Pratchett')
    }
  },
  {
    file: 'GUIDE_2_5_HasMany_Polymorphic.md',
    names: 'publisher, author, publisherReview, authorReviewDocument, publisherWithReviews, authorWithReviews, reviewsWithTargets, reviewDocument, reviewsOfVictor, reliablePublishers, reliableAuthors, publisherLinkage, authorLinkage',
    check (result) {
      assert.equal(result.publisher.id, result.author.id)
      assert.deepEqual(result.publisherReview.reviewable, { id: result.publisher.id, _type: 'publishers' })
      assert.equal(result.publisherWithReviews.reviews.length, 1)
      assert.equal(result.publisherWithReviews.reviews[0].comment, 'Reliable publisher')
      assert.equal(result.authorWithReviews.reviews.length, 1)
      assert.equal(result.authorWithReviews.reviews[0].comment, 'Excellent author')
      assert.deepEqual(result.reviewsWithTargets.data.map(review => review.reviewable._type).sort(), ['authors', 'publishers'])
      assert.deepEqual(result.reviewDocument.included.map(record => record.type).sort(), ['authors', 'publishers'])
      assert.deepEqual(result.reviewsOfVictor.data.map(record => record.id), [result.authorReviewDocument.data.id])
      assert.equal(result.reliablePublishers.data[0].id, result.publisher.id)
      assert.deepEqual(result.reliableAuthors.data, [])
      assert.deepEqual(result.publisherLinkage.data, [])
      assert.deepEqual(result.authorLinkage.data.map(record => record.id).sort(), [result.publisherReview.id, result.authorReviewDocument.data.id].sort())
    }
  },
  {
    file: 'GUIDE_2_3_BelongsTo_Relationships.md',
    names: 'france, frenchPublisher, includedPublisher, plainCollection, jsonapiCollection, sparsePublisher, fromFrance, fromUK, unassigned, cleared',
    check (result) {
      assert.deepEqual(result.frenchPublisher.country, { id: result.france.id })
      assert.equal(result.includedPublisher.country.name, 'France')
      assert.equal(result.plainCollection.data.length, 4)
      assert.equal(result.jsonapiCollection.included.length, 2)
      assert.equal(result.jsonapiCollection.included.filter(record => record.attributes.code === 'FR').length, 1)
      assert.deepEqual(result.sparsePublisher.country, { id: result.france.id, code: 'FR' })
      assert.equal(result.fromFrance.data.length, 2)
      assert.equal(result.fromUK.data[0].name, 'UK Books Ltd.')
      assert.equal(result.unassigned.data[0].name, 'Global Publishing')
      assert.equal(Object.hasOwn(result.unassigned.data[0], 'country'), false)
      assert.equal(result.cleared.data, null)
    }
  },
  {
    file: 'GUIDE_2_4_HasMany_Records.md',
    names: 'victor, emile, identifiers, embedded, document, empty, firstAuthorPage, sparse, matchingPublishers, matchingAuthors, finalLinkage, detachedVictor',
    check (result) {
      assert.deepEqual(result.identifiers.authors.map(record => record.id).sort(), [result.victor.id, result.emile.id].sort())
      assert.equal(result.embedded.authors.length, 2)
      assert.equal(result.document.data.relationships.authors.data.length, 2)
      assert.equal(result.document.included.length, 2)
      assert.deepEqual(result.empty.authors, [])
      assert.equal(result.firstAuthorPage.data[0].surname, 'Hugo')
      assert.equal(result.firstAuthorPage.meta.pagination.total, 2)
      assert.equal(result.sparse.authors.length, 2)
      for (const author of result.sparse.authors) assert.deepEqual(Object.keys(author).sort(), ['id', 'surname'])
      assert.equal(result.matchingPublishers.data[0].name, 'French Books Inc.')
      assert.equal(result.matchingAuthors.data[0].name, 'Johann')
      assert.deepEqual(result.finalLinkage.data, [{ type: 'authors', id: result.emile.id }])
      assert.equal(result.detachedVictor.name, 'Victor')
      assert.equal(Object.hasOwn(result.detachedVictor, 'publisher'), false)
    }
  }
]
for (const example of examples) {
  const source = await readFile(new URL(`../docs/GUIDE/${example.file}`, import.meta.url), 'utf8')
  const blocks = [...source.matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1])
  assert.equal(blocks.length, 5)
  for (const mode of example.modes || ['knex', 'anyapi']) {
    const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    try {
      const api = new JsonRestApi({ name: `relationship-guide-${mode}` })
      await api.use(RestApiPlugin)
      if (mode === 'anyapi') {
        await ensureAnyApiSchema(knex)
        await api.use(RestApiAnyapiKnexPlugin, { knex, tenantId: 'guide' })
      } else await api.use(RestApiKnexPlugin, { knex })
      const result = await new AsyncFunction('api', 'console', `${blocks.join('\n')}\nreturn { ${example.names} }`)(api, { log: () => {} })
      example.check(result)
      console.log(`Literal ${example.file} examples passed: ${mode}`)
    } finally { await knex.destroy() }
  }
}
