import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Query copy failures (${storageMode.mode})`, () => {
  let fixture, group, item
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createQueryConformanceApi,
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    const dataQuery = fixture.api.helpers.dataQuery
    await fixture.api.customize({
      helpers: {
        dataQuery: async args => {
          const result = await dataQuery(args)
          if (args.context.uncopyable) result.data[0].attributes.uncopyable = () => {}
          return result
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Item' }, { group: { data: { type: 'groups', id: group.id } } })
  })
  after(async () => { await fixture?.close() })

  for (const related of [false, true]) {
    for (const format of ['jsonapi', 'plain']) {
      for (const borrowed of [false, true]) {
        for (const logging of ['success', 'throw', 'reject']) {
          it(`${related ? 'getRelated' : 'query'} ${format} preserves copy failure with ${logging} logging and ${borrowed ? 'borrowed' : 'no'} transaction`, async t => {
            const transaction = borrowed ? await fixture.knex.transaction() : undefined
            const outputError = console.error
            const secondary = new Error('Copy error logger failed')
            t.mock.method(console, 'error', (...args) => {
              if (String(args[0]).includes('Failed to clone record:')) {
                if (logging === 'throw') throw secondary
                if (logging === 'reject') return Promise.reject(secondary)
              }
              return outputError(...args)
            })
            const context = { uncopyable: true }
            const read = () => related
              ? fixture.api.resources.groups.getRelated({ id: group.id, relationshipName: 'items', format, transaction }, context)
              : fixture.api.resources.items.query({ format, transaction }, context)
            try {
              await assert.rejects(read(), error => error.name === 'DataCloneError' && error !== secondary)
              if (transaction) assert.equal(transaction.isCompleted(), false)
              context.uncopyable = false
              assert.deepEqual((await read()).data.map(record => record.id), [item.id])
            } finally {
              t.mock.restoreAll()
              if (transaction && !transaction.isCompleted()) await transaction.rollback()
            }
          })
        }
      }
    }
  }
})
