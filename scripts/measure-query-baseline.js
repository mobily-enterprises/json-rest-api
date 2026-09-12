import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createBasicApi, createRowPolicyApi, seedQueryPolicyApi } from '../tests/fixtures/api-configs.js'
import { storageMode } from '../tests/helpers/storage-mode.js'
import { createTestDatabase, databaseClient } from '../tests/helpers/test-database.js'

const database = await createTestDatabase()
const { knex } = database
const measurements = []

// Ceilings for this fixture's measured shapes, independent of runtime implementations.
function statementBudget (name, { size, atomic, polymorphicTypes } = {}) {
  const canonical = storageMode.isAnyApi()
  const fixed = {
    flat: [4, 4],
    sparse: [1, 1],
    'nested-includes': [7, 9],
    'many-to-many-related': [3, 3],
    'patch-full': [11, 10],
    'patch-nested-includes': [14, 15]
  }
  if (Object.hasOwn(fixed, name)) return fixed[name][canonical ? 1 : 0]
  if (['tasks-authorized', 'shared_tasks-authorized'].includes(name)) return 4 + polymorphicTypes
  if (['tasks-authorized-polymorphic', 'shared_tasks-authorized-polymorphic'].includes(name)) return 4 + 2 * polymorphicTypes
  if (name === 'relationship-authorization-denied') return 5 + Math.ceil((size + 1) / 100)
  if (name === 'relationship-authorization-allowed') {
    const batches = Math.ceil(size / 100)
    return 4 + 3 * batches
  }
  const writeCost = {
    'bulk-post-full': [8, 9],
    'bulk-patch-full': [8, 7],
    // One declared pivot (ordinary) or scoped canonical link cleanup per task.
    'bulk-delete': [4, 3]
  }
  if (Object.hasOwn(writeCost, name)) return writeCost[name][canonical ? 1 : 0] * size + (atomic ? 2 : 2 * size)
}

async function measure (name, operation, expectedRecords, shape = {}, check = () => {}) {
  const maxStatements = statementBudget(name, shape)
  assert.ok(Number.isSafeInteger(maxStatements) && maxStatements >= 0, `Missing query budget for ${name}`)
  let statements = 0
  let metadataStatements = 0
  const count = ({ sql }) => {
    statements++
    if (/any_(resource|field|relationship)_configs/.test(sql)) metadataStatements++
  }
  knex.on('query', count)
  const started = performance.now()
  const heapBefore = process.memoryUsage().heapUsed
  let result, elapsedMs, heapDeltaBytes
  try {
    result = await operation()
    elapsedMs = Number((performance.now() - started).toFixed(3))
    heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore
  } finally {
    knex.removeListener('query', count)
  }
  const records = Array.isArray(result?.data) ? result.data.length : result?.data ? 1 : 0
  assert.equal(records, expectedRecords, name)
  assert.equal(metadataStatements, 0, `${name} must use published resource metadata`)
  check(result)
  assert.ok(statements <= maxStatements, `${name} (${storageMode.mode}, ${JSON.stringify(shape)}): ${statements} SQL statements exceed budget ${maxStatements}`)
  measurements.push({ name, ...shape, statements, maxStatements, metadataStatements, records, included: result?.included?.length || 0, elapsedMs, heapDeltaBytes })
  return result
}

try {
  const api = await createBasicApi(knex)
  const post = (resource, attributes, relationships = {}) => api.resources[resource].post({
    format: 'jsonapi',
    document: { data: { type: resource, attributes, relationships } }
  })
  const country = (await post('countries', { name: 'Baseline country', code: 'BC' })).data
  const publisher = (await post('publishers', { name: 'Baseline publisher' }, {
    country: { data: { type: 'countries', id: country.id } }
  })).data
  const authors = []
  for (let i = 0; i < 3; i++) {
    authors.push((await post('authors', { name: `Author ${i}` })).data)
  }
  const books = []
  for (let i = 0; i < 10; i++) {
    books.push((await post('books', { title: `Book ${i}` }, {
      country: { data: { type: 'countries', id: country.id } },
      publisher: { data: { type: 'publishers', id: publisher.id } },
      authors: { data: authors.map(({ id, type }) => ({ id, type })) }
    })).data)
  }

  const scenarios = [
    ['flat', () => api.resources.books.query({ format: 'jsonapi' }), 10],
    ['sparse', () => api.resources.books.query({ format: 'jsonapi', queryParams: { fields: { books: 'title' } } }), 10],
    ['nested-includes', () => api.resources.books.query({ format: 'jsonapi', queryParams: { include: ['publisher.country', 'authors'] } }), 10],
    ['many-to-many-related', () => api.resources.books.getRelated({ format: 'jsonapi', id: books[0].id, relationshipName: 'authors' }), 3],
    ['patch-full', () => api.resources.books.patch({ format: 'jsonapi', returning: 'full', id: books[0].id, document: { data: { type: 'books', id: books[0].id, attributes: { title: 'Updated' } } } }), 1],
    ['patch-nested-includes', () => api.resources.books.patch({ format: 'jsonapi', returning: 'full', id: books[0].id, document: { data: { type: 'books', id: books[0].id, attributes: { title: 'Updated' } } }, queryParams: { include: ['publisher.country', 'authors'] } }), 1]
  ]
  for (const [name, operation, expectedRecords] of scenarios) {
    await measure(name, operation, expectedRecords)
  }

  const policyApi = await createRowPolicyApi(knex, { polymorphic: true, bulk: true })
  const projects = policyApi.resources.policy_projects
  const tasks = policyApi.resources.policy_tasks
  const linkage = ({ type, id }) => ({ type, id })
  for (const size of [1, 10, 40, 101]) {
    const { viewer, project, subject, visible, hidden } = await seedQueryPolicyApi(policyApi, size)
    const expectedIds = visible.map(row => row.id)
    const shape = { size, linkedRows: size * 3 }
    if (size <= 40) {
      for (const relationshipName of ['tasks', 'shared_tasks']) {
        for (const include of [[], ['subject']]) {
          await measure(`${relationshipName}-authorized${include.length ? '-polymorphic' : ''}`, () => projects.getRelated({
            id: project.id,
            relationshipName,
            format: 'jsonapi',
            queryParams: { sort: ['title'], page: { number: 1, size }, include }
          }, viewer), size, { ...shape, polymorphicTypes: Math.min(size, 2) }, result => {
            assert.deepEqual(result.data.map(row => row.id), expectedIds)
            assert.equal(result.meta.pagination.total, size)
            if (include.length) {
              const expected = (size === 1 ? [project] : [project, subject]).map(row => `${row.type}:${row.id}`).sort()
              assert.deepEqual(result.included.map(row => `${row.type}:${row.id}`).sort(), expected)
              for (const [index, row] of result.data.entries()) {
                assert.deepEqual(row.relationships.subject.data, linkage(index % 2 === 0 ? project : subject))
              }
            }
          })
        }
      }
    }

    await measure('relationship-authorization-allowed', () => projects.postRelationship({
      id: project.id,
      relationshipName: 'shared_tasks',
      format: 'jsonapi',
      relationshipData: visible.map(linkage)
    }, viewer), 0, { size })
    await measure('relationship-authorization-denied', async () => {
      await assert.rejects(projects.postRelationship({
        id: project.id,
        relationshipName: 'shared_tasks',
        relationshipData: [...visible, hidden[0]].map(linkage)
      }, viewer), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
    }, 0, { size, requestedTargets: size + 1 })
    const retained = await projects.getRelationship({ id: project.id, relationshipName: 'shared_tasks' }, viewer)
    assert.deepEqual(retained.data.map(row => row.id).sort(), [...expectedIds].sort())

    // The 101-target case crosses the write-query batch boundary, not the bulk request limit.
    if (size > 40) continue
    for (const atomic of [true, false]) {
      const resources = Array.from({ length: size }, (_, index) => ({
        type: 'policy_tasks',
        attributes: { title: `Bulk ${index}`, access_group: 'group-a' },
        relationships: { project: { data: linkage(project) } }
      }))
      const checkBulk = result => {
        assert.equal(result.meta.succeeded, size)
        assert.equal(result.meta.failed, 0)
        assert.equal(result.meta.atomic, atomic)
      }
      const created = await measure('bulk-post-full', () => tasks.bulkPost({
        format: 'jsonapi', returning: 'full', atomic, document: { data: resources }
      }, viewer), size, { size, atomic }, result => {
        checkBulk(result)
        assert.equal(new Set(result.data.map(row => row.id)).size, size)
        for (const [index, row] of result.data.entries()) {
          assert.equal(row.attributes.title, `Bulk ${index}`)
          assert.deepEqual(row.relationships.project.data, linkage(project))
        }
      })
      const ids = created.data.map(row => row.id)
      await measure('bulk-patch-full', () => tasks.bulkPatch({
        format: 'jsonapi',
        returning: 'full',
        atomic,
        operations: ids.map(id => ({ id, document: { data: { type: 'policy_tasks', id, attributes: { title: 'Bulk updated' } } } }))
      }, viewer), size, { size, atomic }, result => {
        checkBulk(result)
        assert.deepEqual(result.data.map(row => row.id), ids)
        assert.ok(result.data.every(row => row.attributes.title === 'Bulk updated'))
      })
      await measure('bulk-delete', () => tasks.bulkDelete({ ids, atomic }, viewer), 0, { size, atomic }, result => {
        checkBulk(result)
        assert.deepEqual(result.meta.deleted, ids)
      })
      for (const id of ids) await assert.rejects(tasks.get({ id }, viewer), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
    }
  }
  console.log(JSON.stringify({ node: process.version, database: databaseClient, storage: storageMode.mode, measurements }, null, 2))
} finally {
  try { await database.close() } finally { storageMode.clearRegistry(knex) }
}
