import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createRowPolicyApi, seedQueryPolicyApi } from '../tests/fixtures/api-configs.js'
import { createTestDatabase, databaseClient } from '../tests/helpers/test-database.js'
import { storageMode } from '../tests/helpers/storage-mode.js'

const database = await createTestDatabase()
const { knex } = database
const measurements = []
let trace

async function measure (name, shape, ids, operation) {
  const sql = { reads: 0, writes: 0, transaction: 0, other: 0, metadata: 0 }
  const count = ({ sql: statement }) => {
    let kind = 'other'
    if (/^select\b/i.test(statement)) kind = 'reads'
    else if (/^(insert|update|delete)\b/i.test(statement)) kind = 'writes'
    else if (/^(begin|commit|rollback|savepoint|release)\b/i.test(statement)) kind = 'transaction'
    sql[kind]++
    if (/any_(resource|field|relationship)_configs/.test(statement)) sql.metadata++
  }
  trace = []
  const started = performance.now()
  const heapBefore = process.memoryUsage().heapUsed
  knex.on('query', count)
  let result
  try { result = await operation() } finally { knex.off('query', count) }
  const elapsedMs = Number((performance.now() - started).toFixed(3))
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore
  assert.deepEqual(trace, ids.flatMap(id => [`before:${id}`, `after:${id}`]), name)
  assert.equal(sql.metadata, 0, `${name} must use published metadata`)
  assert.ok(sql.writes >= ids.length, `${name} must execute the requested child writes`)
  measurements.push({ name, ...shape, sql, childWrites: ids.length, hooks: trace.length, elapsedMs, heapDeltaBytes })
  trace = undefined
  return result
}

try {
  const api = await createRowPolicyApi(knex, { bulk: true, polymorphic: true })
  const tasks = api.resources.policy_tasks
  const projects = api.resources.policy_projects
  const adapter = api.knex.helpers.getStorageAdapter('policy_tasks')
  const hooks = {}
  for (const phase of ['before', 'after']) {
    hooks[`${phase}DataCallPatch`] = ({ context, scopeName }) => {
      if (scopeName === 'policy_tasks') trace?.push(`${phase}:${context.id}`)
    }
  }
  await api.customize({ hooks })

  for (const size of [1, 10, 40]) {
    const { viewer, project, visible } = await seedQueryPolicyApi(api, size)
    const ids = visible.map(row => row.id)
    for (const atomic of [true, false]) {
      for (const returning of ['full', 'none']) {
        const title = `Measured ${atomic} ${returning}`
        const result = await measure('bulkPatch', { size, atomic, returning }, ids, () => tasks.bulkPatch({
          atomic, returning, format: 'jsonapi', operations: ids.map(id => ({ id, data: { title } }))
        }, viewer))
        assert.equal(result.meta.succeeded, size)
        assert.equal(result.meta.failed, 0)
        if (returning === 'full') {
          assert.deepEqual(result.data.map(row => row.id), ids)
          assert.ok(result.data.every(row => row.attributes.title === title))
        } else assert.equal(Object.hasOwn(result, 'data'), false)
        const stored = await adapter.buildBaseQuery().whereIn(adapter.getIdColumn(), ids)
        assert.equal(stored.length, size)
        assert.ok(stored.every(row => adapter.getFieldValue(row, 'title') === title))
      }
    }

    const relationshipData = ids.map(id => ({ type: 'policy_tasks', id }))
    for (const method of ['deleteRelationship', 'postRelationship']) {
      await measure(method, { size, relationship: 'tasks' }, ids, () => projects[method]({
        id: project.id, relationshipName: 'tasks', relationshipData
      }, viewer))
      const related = await projects.getRelationship({ id: project.id, relationshipName: 'tasks' }, viewer)
      assert.deepEqual(related.data.map(row => row.id).sort(), method === 'postRelationship' ? [...ids].sort() : [])
    }
  }

  // A later hook may depend on an earlier write inside the same owner.
  const { viewer, visible } = await seedQueryPolicyApi(api, 2)
  const [first, second] = visible
  await api.customize({
    hooks: {
      beforeDataCallPatch: {
        functionName: 'read-earlier-bulk-write',
        handler: async ({ context, scopeName }) => {
          if (scopeName !== 'policy_tasks' || context.id !== second.id) return
          const previous = await tasks.get({ id: first.id, transaction: context.transaction, format: 'plain' }, { ...viewer })
          context.inputRecord.data.attributes.title = `${previous.title} then second`
        }
      }
    }
  })
  const result = await tasks.bulkPatch({
    atomic: true,
    format: 'plain',
    returning: 'full',
    operations: [
      { id: first.id, data: { title: 'First completed' } },
      { id: second.id, data: { title: 'Will be set by hook' } }
    ]
  }, viewer)
  assert.deepEqual(result.data.map(row => row.title), ['First completed', 'First completed then second'])
  console.log(JSON.stringify({ node: process.version, database: databaseClient, storage: storageMode.mode, dependentHookVerified: true, measurements }, null, 2))
} finally {
  try { await database.close() } finally { storageMode.clearRegistry(knex) }
}
