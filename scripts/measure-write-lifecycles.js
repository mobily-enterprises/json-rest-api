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
  const api = await createRowPolicyApi(knex, { polymorphic: true })
  const projects = api.resources.policy_projects
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
    const relationshipData = ids.map(id => ({ type: 'policy_tasks', id }))
    for (const method of ['deleteRelationship', 'postRelationship']) {
      await measure(method, { size, relationship: 'tasks' }, ids, () => projects[method]({
        id: project.id, relationshipName: 'tasks', relationshipData
      }, viewer))
      const related = await projects.getRelationship({ id: project.id, relationshipName: 'tasks' }, viewer)
      assert.deepEqual(related.data.map(row => row.id).sort(), method === 'postRelationship' ? [...ids].sort() : [])
    }
  }

  console.log(JSON.stringify({ node: process.version, database: databaseClient, storage: storageMode.mode, measurements }, null, 2))
} finally {
  try { await database.close() } finally { storageMode.clearRegistry(knex) }
}
