import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  cleanTables,
  countRecords,
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier
} from './helpers/test-utils.js'
import { createBasicApi } from './fixtures/api-configs.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api
let afterCommitFailureMethod = null
const rollbackEvents = []

describe('Post-commit hook failure semantics', () => {
  before(async () => {
    api = await createBasicApi(knex, {
      apiName: 'post-commit-hook-test',
      tablePrefix: 'post_commit'
    })

    await api.customize({
      hooks: {
        afterCommit: {
          functionName: 'post-commit-failure-test',
          handler: async ({ context }) => {
            if (context.method === afterCommitFailureMethod) {
              throw new Error(`afterCommit failed for ${context.method}`)
            }
          }
        },
        afterRollback: {
          functionName: 'post-commit-rollback-tracker',
          handler: async ({ context }) => {
            rollbackEvents.push(context.method)
          }
        }
      }
    })
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    afterCommitFailureMethod = null
    rollbackEvents.length = 0

    await cleanTables(knex, [
      'post_commit_countries',
      'post_commit_publishers',
      'post_commit_authors',
      'post_commit_books',
      'post_commit_book_authors'
    ])
  })

  it('surfaces afterCommit errors without rolling back committed resource writes', async () => {
    afterCommitFailureMethod = 'post'

    await assert.rejects(
      api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', {
          name: 'Committed Country',
          code: 'CC'
        }),
        simplified: false
      }),
      /afterCommit failed for post/
    )

    assert.equal(await countRecords(knex, 'post_commit_countries'), 1)
    assert.deepEqual(rollbackEvents, [])
  })

  it('surfaces afterCommit errors without rolling back committed relationship writes', async () => {
    const country = await api.resources.countries.post({
      inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' }),
      simplified: false
    })
    const book = await api.resources.books.post({
      inputRecord: createJsonApiDocument(
        'books',
        { title: 'Committed Book' },
        { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
      ),
      simplified: false
    })
    const author = await api.resources.authors.post({
      inputRecord: createJsonApiDocument('authors', { name: 'Committed Author' }),
      simplified: false
    })

    rollbackEvents.length = 0
    afterCommitFailureMethod = 'postRelationship'

    await assert.rejects(
      api.resources.books.postRelationship({
        id: book.data.id,
        relationshipName: 'authors',
        relationshipData: [resourceIdentifier('authors', author.data.id)]
      }),
      /afterCommit failed for postRelationship/
    )

    assert.equal(await countRecords(knex, 'post_commit_book_authors'), 1)
    assert.deepEqual(rollbackEvents, [])
  })
})
