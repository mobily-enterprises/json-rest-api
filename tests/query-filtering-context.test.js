import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import applyQueryFiltersMethod from '../plugins/core/rest-api-plugin-methods/apply-query-filters.js'
import { withQueryFilteringContext } from '../plugins/core/lib/querying/query-builder-utils.js'

// Any attempt to assimilate this builder would execute a database query.
const unexecutedQuery = () => ({ then () { assert.fail('Filtering executed the query') } })

describe('Scoped query filtering context', () => {
  it('awaits filters and returns the replacement builder without executing it', async () => {
    const previous = { enclosing: true }
    const context = { knexQuery: previous }
    const original = unexecutedQuery()
    const replacement = unexecutedQuery()
    const state = { query: original, queryPurpose: 'collection' }
    const result = await withQueryFilteringContext(context, state, async () => {
      assert.equal(context.knexQuery, state)
      await Promise.resolve()
      context.knexQuery = { query: replacement }
    })
    assert.equal(result.query, replacement)
    assert.equal(context.knexQuery, previous)
  })

  it('restores the enclosing state after nested filtering rejects', async () => {
    const previous = { enclosing: true }
    const context = { knexQuery: previous }
    const outer = { query: unexecutedQuery() }
    const inner = { query: unexecutedQuery() }
    const failure = new Error('Filter failed')
    await assert.rejects(withQueryFilteringContext(context, outer, async () => {
      await assert.rejects(withQueryFilteringContext(context, inner, async () => {
        assert.equal(context.knexQuery, inner)
        throw failure
      }), error => error === failure)
      assert.equal(context.knexQuery, outer)
      throw failure
    }), error => error === failure)
    assert.equal(context.knexQuery, previous)
  })

  for (const clear of ['query', 'state']) {
    it(`retains the original builder when a filter removes its ${clear}`, async () => {
      const context = {}
      const original = unexecutedQuery()
      const result = await withQueryFilteringContext(context, { query: original }, async () => {
        if (clear === 'query') context.knexQuery.query = null
        else delete context.knexQuery
      })
      assert.equal(result.query, original)
      assert.equal(Object.hasOwn(context, 'knexQuery'), false)
    })
  }

  it('removes temporary state when a synchronous filter throws', async () => {
    const context = {}
    const failure = new Error('Synchronous filter failed')
    await assert.rejects(withQueryFilteringContext(context, { query: unexecutedQuery() }, () => {
      throw failure
    }), error => error === failure)
    assert.equal(Object.hasOwn(context, 'knexQuery'), false)
  })
})

for (const rejectPermissions of [false, true]) {
  it(`restores query and adapter after include permissions ${rejectPermissions ? 'reject' : 'succeed'}`, async () => {
    const previous = { enclosing: true }
    const previousAdapter = { outer: true }
    const adapter = { inner: true }
    const context = { knexQuery: previous, storageAdapter: previousAdapter }
    const query = unexecutedQuery()
    const failure = new Error('Include permission failed')
    let hooks = 0
    const operation = applyQueryFiltersMethod({
      context,
      params: { query, storageAdapter: adapter, queryPurpose: 'include' },
      scopeName: 'items',
      scope: {
        vars: { schemaInfo: {} },
        checkPermissions: async ({ originalContext }) => {
          assert.equal(originalContext.knexQuery.query, query)
          assert.equal(originalContext.storageAdapter, adapter)
          assert.equal(originalContext.scopeName, 'items')
          if (rejectPermissions) throw failure
        }
      },
      runHooks: async () => {
        hooks += 1
        assert.equal(context.knexQuery.query, query)
        assert.equal(context.storageAdapter, adapter)
      }
    })
    if (rejectPermissions) await assert.rejects(operation, error => error === failure)
    else assert.equal((await operation).query, query)
    assert.equal(hooks, rejectPermissions ? 0 : 1)
    assert.equal(context.knexQuery, previous)
    assert.equal(context.storageAdapter, previousAdapter)
  })
}
