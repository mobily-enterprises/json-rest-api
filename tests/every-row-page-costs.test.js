import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createRowPolicyApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

const tables = { pivots: 'row_policy_project_tasks', tasks: 'row_policy_tasks', projects: 'row_policy_projects', broken: 'row_policy_broken' }
const viewer = { visibility: { groups: ['group-a'] }, scopeValues: { workspaceId: 'workspace-a' } }
// Projects 271-300 are in group-b, which the viewer cannot see.
const PROJECTS = 300
const VISIBLE_PROJECTS = 270

// Server code reading every row: pages of pageSizeLimit rows cost the same
// statements and row-policy runs at 480 and 960 rows, and a page's linkage to
// 300 projects is checked in one query, while HTTP stays capped at queryMaxLimit.
describe(`Every-row page costs (${storageMode.mode})`, () => {
  let fixture
  const app = express()
  const policyRuns = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createRowPolicyApi,
      apiOptions: { onPolicy: event => policyRuns.push(`${event.scopeName}:${event.queryPurpose}`), connector: 'express', app },
      tables
    })
    await fixture.api.customize({
      hooks: {
        'transport:request': { functionName: 'every-row-viewer', handler: ({ context }) => { Object.assign(context, viewer) } }
      }
    })
  })
  after(async () => { await fixture?.close() })

  async function seed (tasks) {
    await fixture.reset()
    const insert = async (type, records) => {
      for (let offset = 0; offset < records.length; offset += 100) {
        await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records.slice(offset, offset + 100))
      }
    }
    await insert('policy_projects', Array.from({ length: PROJECTS }, (_, index) => ({
      id: String(index + 1), name: `Project ${index + 1}`, access_group: index < VISIBLE_PROJECTS ? 'group-a' : 'group-b', workspace_id: 'workspace-a'
    })))
    await insert('policy_tasks', Array.from({ length: tasks }, (_, index) => ({
      id: String(index + 1), title: `Task ${index + 1}`, access_group: 'group-a', workspace_id: 'workspace-a', project_id: (index % PROJECTS) + 1
    })))
  }

  async function measure (run) {
    let statements = 0
    const count = () => { statements++ }
    policyRuns.length = 0
    fixture.knex.on('query', count)
    let result
    try {
      result = await run()
    } finally {
      fixture.knex.removeListener('query', count)
    }
    const policy = {}
    for (const entry of policyRuns) policy[entry] = (policy[entry] || 0) + 1
    return { result, statements, policy }
  }

  // The cursor loop server code uses to read every row, asking for 1,000-row pages. The
  // fieldset keeps the belongs-to project and leaves out the many-to-many shared_projects,
  // whose AnyAPI link reads are bounded to 100 parents each by design.
  async function readEveryRow (params = {}) {
    const rows = []
    let cursor
    do {
      const page = await fixture.api.resources.policy_tasks.query({
        ...params,
        queryParams: {
          fields: { policy_tasks: 'title,access_group,project' },
          sort: ['id'],
          page: cursor ? { size: 1000, after: cursor } : { size: 1000 }
        }
      }, { ...viewer })
      rows.push(...page.data)
      cursor = page.meta.pagination.hasMore ? page.meta.pagination.cursor.next : undefined
    } while (cursor)
    return rows
  }

  it('reads 480 and 960 rows with the same statements and policy runs through pageSizeLimit', async (t) => {
    await seed(480)
    const small = await measure(() => readEveryRow({ pageSizeLimit: 1000 }))
    await seed(960)
    const large = await measure(() => readEveryRow({ pageSizeLimit: 1000 }))
    const capped = await measure(() => readEveryRow())
    t.diagnostic(`480 rows: ${small.statements} statements ${JSON.stringify(small.policy)}`)
    t.diagnostic(`960 rows: ${large.statements} statements ${JSON.stringify(large.policy)}`)
    t.diagnostic(`960 rows at queryMaxLimit: ${capped.statements} statements ${JSON.stringify(capped.policy)}`)

    assert.equal(small.result.length, 480)
    assert.equal(large.result.length, 960)
    assert.equal(new Set(large.result.map(row => row.id)).size, 960)
    assert.equal(large.statements, small.statements)
    assert.deepEqual(large.policy, small.policy)
    assert.equal(large.policy['policy_tasks:collection'], 1)
    assert.equal(large.policy['policy_projects:relationship-identifiers'], 1)

    // Without it the same read pages at queryMaxLimit (100): ten pages, each with its own policy runs.
    assert.deepEqual(capped.result.map(row => row.id), large.result.map(row => row.id))
    assert.equal(capped.policy['policy_tasks:collection'], 10)
    assert.equal(capped.policy['policy_projects:relationship-identifiers'], 10)
    assert.ok(capped.statements >= 5 * large.statements, `${capped.statements} statements at 100 rows a page, ${large.statements} at 1,000`)
  })

  it('checks a page linking 300 projects in one visibility query and hides the unreadable ones', async () => {
    await seed(960)
    const { result, statements, policy } = await measure(() => readEveryRow({ pageSizeLimit: 1000 }))
    assert.equal(policy['policy_projects:relationship-identifiers'], 1)
    assert.ok(statements <= 4, `one 960-row page costs ${statements} statements`)
    const projectOf = row => row.relationships.project.data
    for (const row of result) {
      const projectId = (Number(row.id) - 1) % PROJECTS + 1
      if (projectId > VISIBLE_PROJECTS) assert.equal(projectOf(row), null, `task ${row.id} links hidden project ${projectId}`)
      else assert.deepEqual(projectOf(row), { type: 'policy_projects', id: String(projectId) })
    }
    assert.equal(result.filter(row => projectOf(row) === null).length, 90)
  })

  it('refuses a pageSizeLimit that is not a positive integer', async () => {
    for (const pageSizeLimit of [0, -1, 1.5, '1000', null]) {
      await assert.rejects(
        fixture.api.resources.policy_tasks.query({ pageSizeLimit, queryParams: { page: { size: 10 } } }, { ...viewer }),
        error => {
          const validation = error instanceof RestApiValidationError ? error : error.cause
          return validation instanceof RestApiValidationError && validation.details.fields.includes('pageSizeLimit')
        },
        `pageSizeLimit ${JSON.stringify(pageSizeLimit)}`
      )
    }
  })

  it('keeps server calls without it and HTTP page sizes capped at queryMaxLimit', async () => {
    await seed(960)
    const server = await fixture.api.resources.policy_tasks.query({ queryParams: { page: { size: 500 } } }, { ...viewer })
    assert.equal(server.data.length, 100)
    assert.equal(server.meta.pagination.pageSize, 100)
    assert.equal(server.meta.pagination.hasMore, true)

    // A query string cannot set the server-only parameter.
    for (const query of ['page[size]=500', 'page[size]=500&pageSizeLimit=1000']) {
      const response = await request(app).get(`/api/policy_tasks?${query}`)
      assert.equal(response.statusCode, 200, query)
      assert.equal(response.body.data.length, 100, query)
      assert.equal(response.body.meta.pagination.pageSize, 100, query)
      assert.equal(response.body.meta.pagination.hasMore, true, query)
    }
  })
})
