import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { availableParallelism, totalmem } from 'node:os'
import { performance } from 'node:perf_hooks'
import { setImmediate } from 'node:timers/promises'
import { createRowPolicyApi, seedQueryPolicyApi } from '../tests/fixtures/api-configs.js'
import { createTestDatabase, databaseClient } from '../tests/helpers/test-database.js'
import { storageMode } from '../tests/helpers/storage-mode.js'

function integerOption (name, fallback, maximum) {
  const key = `JSON_REST_API_STRESS_${name}`
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${key} must be an integer between 1 and ${maximum}`)
  }
  return value
}

const config = {
  rows: integerOption('ROWS', 100, 1000),
  reads: integerOption('READS', 200, 100000),
  writes: integerOption('WRITES', 32, 20000),
  concurrency: integerOption('CONCURRENCY', 4, 32),
  batches: integerOption('BATCHES', 1, 100),
  pageSize: integerOption('PAGE_SIZE', 20, 100)
}
if (process.argv.length > 2) throw new Error('Configure stress-resources.js with JSON_REST_API_STRESS_* environment variables')
if (config.reads * config.batches > 100000 || config.writes * config.batches > 20000) {
  throw new Error('Stress totals must not exceed 100000 reads or 20000 writes')
}
if (config.reads < 2 || config.writes < 4) throw new Error('Stress coverage requires at least 2 reads and 4 writes per batch')

const sqlContext = new AsyncLocalStorage()
const queryBudgets = {
  tasks: 8,
  shared_tasks: 8,
  'owned-commit': 12,
  'owned-rollback': 12,
  'managed-commit': 12,
  'managed-rollback': 12
}
const round = value => Number(value.toFixed(3))
const completionHooks = { committed: 0, rolledBack: 0 }
const batches = []
const memory = []
let unattributedStatements = 0
let scenarios = new Map()

function countQuery ({ sql }) {
  const operation = sqlContext.getStore()
  if (!operation || operation.complete) {
    unattributedStatements++
    return
  }
  operation.statements++
  if (/any_(resource|field|relationship)_configs/.test(sql)) operation.metadataStatements++
}

async function measure (name, operation) {
  const counts = { statements: 0, metadataStatements: 0 }
  const start = performance.now()
  await sqlContext.run(counts, operation)
  counts.complete = true
  const elapsedMs = performance.now() - start
  assert.ok(counts.statements > 0, `${name} must execute SQL in its operation context`)
  assert.equal(counts.metadataStatements, 0, `${name} must use published metadata`)
  assert.ok(counts.statements <= queryBudgets[name], `${name}: ${counts.statements} statements exceed ${queryBudgets[name]}`)
  const stats = scenarios.get(name) || { latencies: [], statements: 0, maxStatements: 0, metadataStatements: 0 }
  stats.latencies.push(elapsedMs)
  stats.statements += counts.statements
  stats.maxStatements = Math.max(stats.maxStatements, counts.statements)
  stats.metadataStatements += counts.metadataStatements
  scenarios.set(name, stats)
}

function summarizeScenarios () {
  return [...scenarios].sort(([left], [right]) => left.localeCompare(right)).map(([name, stats]) => {
    const samples = stats.latencies.sort((a, b) => a - b)
    const percentile = fraction => round(samples[Math.ceil(samples.length * fraction) - 1])
    return {
      name,
      operations: samples.length,
      statements: stats.statements,
      maxStatements: stats.maxStatements,
      statementLimit: queryBudgets[name],
      metadataStatements: stats.metadataStatements,
      latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: round(samples.at(-1)) }
    }
  })
}

async function sampleMemory (phase) {
  await setImmediate()
  const beforeGc = process.memoryUsage()
  if (globalThis.gc) globalThis.gc()
  const afterGc = process.memoryUsage()
  memory.push({ phase, ...beforeGc, ...(globalThis.gc ? { retainedHeapBytes: afterGc.heapUsed, rssAfterGc: afterGc.rss } : {}) })
}

// SQLite deliberately queues SQL on one connection; operation promises still overlap.
const sqlConnections = databaseClient === 'better-sqlite3' ? 1 : config.concurrency
const database = await createTestDatabase(undefined, { maxConnections: sqlConnections })
const { knex } = database
try {
  const versionResult = await knex.raw(databaseClient === 'better-sqlite3' ? 'select sqlite_version() as version' : 'select version() as version')
  const databaseVersion = (databaseClient === 'pg' ? versionResult.rows[0] : databaseClient === 'mysql2' ? versionResult[0][0] : versionResult[0]).version
  const api = await createRowPolicyApi(knex, { polymorphic: true })
  const seeded = await seedQueryPolicyApi(api, config.rows)
  const projects = api.resources.policy_projects
  const tasks = api.resources.policy_tasks
  const adapter = api.knex.helpers.getStorageAdapter('policy_tasks')
  const freshContext = () => structuredClone(seeded.viewer)
  const intentionalRollback = new Error('Stress workload requested rollback')
  const visibleById = new Map(seeded.visible.map((row, index) => [row.id, index]))
  const pageCount = Math.ceil(config.rows / config.pageSize)
  let persistedTitle = seeded.subject.attributes.title

  await api.customize({
    hooks: {
      finishPatch: ({ context }) => { if (context.stressRollback) throw intentionalRollback },
      ...Object.fromEntries(['afterCommit', 'afterRollback'].map(event => [event, ({ context }) => {
        if (!context.stressCompletion) return
        const outcome = event === 'afterCommit' ? 'committed' : 'rolledBack'
        assert.equal(context.transactionOutcome, outcome)
        context.stressCompletion[outcome]++
        completionHooks[outcome]++
      }]))
    }
  })

  async function read (index) {
    const relationshipName = index % 2 === 0 ? 'tasks' : 'shared_tasks'
    const page = Math.floor(index / 2) % pageCount + 1
    const expected = seeded.visible.slice((page - 1) * config.pageSize, page * config.pageSize)
    await measure(relationshipName, async () => {
      const result = await projects.getRelated({
        id: seeded.project.id,
        relationshipName,
        format: 'jsonapi',
        queryParams: { sort: ['title'], page: { number: page, size: config.pageSize }, include: ['subject'] }
      }, freshContext())
      assert.deepEqual(result.data.map(row => row.id), expected.map(row => row.id))
      assert.equal(result.meta.pagination.total, config.rows)
      const included = new Set()
      for (const row of result.data) {
        const originalIndex = visibleById.get(row.id)
        const subject = originalIndex % 2 === 0 ? seeded.project : seeded.subject
        assert.deepEqual(row.relationships.subject.data, { type: subject.type, id: subject.id })
        included.add(`${subject.type}:${subject.id}`)
        assert.equal(row.attributes.access_group, 'group-a')
        assert.equal(row.attributes.workspace_id, 'workspace-a')
      }
      assert.deepEqual((result.included || []).map(row => `${row.type}:${row.id}`).sort(), [...included].sort())
    })
  }

  async function write (index, batch) {
    const name = ['owned-commit', 'owned-rollback', 'managed-commit', 'managed-rollback'][index % 4]
    const managed = name.startsWith('managed')
    const rollback = name.endsWith('rollback')
    const title = `Stress ${batch}:${index}`
    const context = { ...freshContext(), stressCompletion: { committed: 0, rolledBack: 0 }, stressRollback: rollback && !managed }
    const ownerContext = freshContext()
    await measure(name, async () => {
      const patch = transaction => tasks.patch({ id: seeded.subject.id, data: { title }, format: 'plain', returning: 'full', transaction }, context)
      const operation = managed
        ? api.transaction(async transaction => {
          const result = await patch(transaction)
          assert.equal(result.title, title)
          assert.deepEqual(context.stressCompletion, { committed: 0, rolledBack: 0 })
          assert.equal(transaction.isCompleted(), false)
          if (rollback) throw intentionalRollback
        }, ownerContext)
        : patch()
      if (rollback) {
        await assert.rejects(operation, error => error.cause === intentionalRollback && error.transactionOutcome === 'rolledBack')
      } else {
        const result = await operation
        if (!managed) assert.equal(result.title, title)
        persistedTitle = title
      }
      assert.deepEqual(context.stressCompletion, { committed: rollback ? 0 : 1, rolledBack: rollback ? 1 : 0 })
      assert.equal(context.transactionOutcome, rollback ? 'rolledBack' : 'committed')
      if (managed) assert.equal(ownerContext.transactionOutcome, context.transactionOutcome)
      const stored = await adapter.buildBaseQuery().where(adapter.getIdColumn(), seeded.subject.id).first({ title: adapter.translateColumn('title') })
      assert.equal(stored.title, persistedTitle)
    })
  }

  // Seed/setup costs are excluded; every workload statement must be attributed to a call.
  await sampleMemory('after-seed')
  knex.on('query', countQuery)
  for (let batch = 1; batch <= config.batches; batch++) {
    const readStart = performance.now()
    let nextRead = 0
    let stopReads = false
    const workers = Array.from({ length: Math.min(config.concurrency, config.reads) }, async () => {
      while (nextRead < config.reads && !stopReads) {
        try { await read(nextRead++) } catch (error) {
          stopReads = true
          throw error
        }
      }
    })
    const outcomes = await Promise.allSettled(workers)
    const failed = outcomes.find(outcome => outcome.status === 'rejected')
    if (failed) throw failed.reason
    const readMs = performance.now() - readStart
    const writeStart = performance.now()
    for (let index = 0; index < config.writes; index++) await write(index, batch)
    const writeMs = performance.now() - writeStart
    assert.equal(unattributedStatements, 0, 'Concurrent SQL attribution must cover every workload statement')
    batches.push({
      batch,
      reads: { operations: config.reads, elapsedMs: round(readMs), perSecond: round(config.reads * 1000 / readMs) },
      writes: { operations: config.writes, elapsedMs: round(writeMs), perSecond: round(config.writes * 1000 / writeMs) },
      scenarios: summarizeScenarios()
    })
    scenarios = new Map()
    await sampleMemory(`batch-${batch}`)
  }
  assert.equal(unattributedStatements, 0, 'Workload queries must finish within their measured operation')
  console.log(JSON.stringify({
    config,
    environment: {
      node: process.version,
      database: databaseClient,
      databaseVersion,
      storage: storageMode.mode,
      platform: process.platform,
      arch: process.arch,
      availableCpus: availableParallelism(),
      systemMemoryBytes: totalmem(),
      sqlConnections,
      writeConcurrency: 1,
      explicitGc: typeof globalThis.gc === 'function'
    },
    fixture: { visible: config.rows, hidden: config.rows, foreignWorkspace: config.rows, linkedTasks: config.rows * 3, supportingResources: 2 },
    batches,
    completionHooks,
    unattributedStatements,
    memory,
    notes: ['Latencies include correctness checks and writes include persisted-state verification.',
      'Memory and latency are observations, not pass/fail limits or proof of leak freedom.',
      'SQLite SQL uses one connection; bounded read operations overlap and writes are sequential.']
  }, null, 2))
} finally {
  knex.removeListener('query', countQuery)
  try { await database.close() } finally { storageMode.clearRegistry(knex) }
}
