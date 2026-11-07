import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createRowPolicyApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { pivots: 'row_policy_project_tasks', tasks: 'row_policy_tasks', projects: 'row_policy_projects', broken: 'row_policy_broken' }
const admin = { visibility: { all: true }, scopeValues: { workspaceId: 'workspace-a' } }
const viewer = { visibility: { groups: ['group-a'] }, scopeValues: { workspaceId: 'workspace-a' } }

// The same writes against an API without hooks and one whose finish hook can
// see the post-write refresh: the refresh is skipped only where nothing sees it.
describe(`Write read-back costs (${storageMode.mode})`, () => {
  const fixtures = {}
  const policyRuns = []
  const finishRecords = []
  before(async () => {
    for (const observed of [false, true]) {
      const fixture = await createConformanceFixture({
        createApi: createRowPolicyApi,
        apiOptions: { onPolicy: event => policyRuns.push(`${event.scopeName}:${event.queryPurpose}`) },
        tables
      })
      if (observed) {
        await fixture.api.customize({
          hooks: {
            finish: {
              functionName: 'observe-refreshed-record',
              handler: ({ context }) => { if (context.method === 'post') finishRecords.push(context.minimalRecord) }
            }
          }
        })
      }
      await fixture.reset()
      const project = async (name, group) => (await fixture.api.resources.policy_projects.post({
        format: 'jsonapi', returning: 'minimal', document: { data: { type: 'policy_projects', attributes: { name, access_group: group } } }
      }, admin)).data
      fixture.projects = { a1: await project('A1', 'group-a'), a2: await project('A2', 'group-a'), b: await project('B', 'group-b') }
      fixtures[observed ? 'observed' : 'plain'] = fixture
    }
  })
  after(async () => { for (const fixture of Object.values(fixtures)) await fixture.close() })

  const taskDocument = (fixture, title, { group = 'group-a', project = fixture.projects.a1 } = {}) => ({
    data: {
      type: 'policy_tasks',
      attributes: { title, access_group: group },
      relationships: {
        project: { data: { type: 'policy_projects', id: project.id } },
        shared_projects: { data: [fixture.projects.a1, fixture.projects.a2].map(({ id }) => ({ type: 'policy_projects', id })) }
      }
    }
  })

  async function measure (fixture, run) {
    let statements = 0
    const count = () => { statements++ }
    policyRuns.length = 0
    fixture.knex.on('query', count)
    try {
      await run()
    } finally {
      fixture.knex.removeListener('query', count)
    }
    const policy = {}
    for (const run of policyRuns) policy[run] = (policy[run] || 0) + 1
    return { statements, policy }
  }

  async function createTasks (fixture, size, returning) {
    return measure(fixture, async () => {
      for (let index = 0; index < size; index++) {
        await fixture.api.resources.policy_tasks.post({ format: 'jsonapi', returning, document: taskDocument(fixture, `Task ${index}`) }, viewer)
      }
    })
  }

  for (const returning of ['minimal', 'none', 'full']) {
    it(`a ${returning} create checks each linked type once and refreshes only for an observer`, async () => {
      const perRow = {}
      for (const [name, fixture] of Object.entries(fixtures)) {
        const small = await createTasks(fixture, 5, returning)
        const large = await createTasks(fixture, 20, returning)
        perRow[name] = { statements: (large.statements - small.statements) / 15 }
        for (const [run, count] of Object.entries(large.policy)) perRow[name][run] = count / 20
      }
      // Projects linked by two relationships (project, shared_projects) are read in one check.
      assert.equal(perRow.plain['policy_projects:relationship-validation'], 1)
      assert.equal(perRow.observed['policy_projects:relationship-validation'], 1)
      // The refresh: one more policy run and one more statement per write, only with the finish hook.
      assert.equal(perRow.observed.statements - perRow.plain.statements, 1, JSON.stringify(perRow))
      const ownRuns = ({ statements, ...runs }) => Object.entries(runs)
        .filter(([run]) => run.startsWith('policy_tasks:')).reduce((sum, [, count]) => sum + count, 0)
      assert.equal(ownRuns(perRow.observed) - ownRuns(perRow.plain), 1, JSON.stringify(perRow))
    })
  }

  it('an observing finish hook still sees the refreshed record', async () => {
    const fixture = fixtures.observed
    finishRecords.length = 0
    const created = await fixture.api.resources.policy_tasks.post({ format: 'jsonapi', returning: 'none', document: taskDocument(fixture, 'Observed') }, viewer)
    assert.equal(created, undefined)
    assert.equal(finishRecords.length, 1)
    assert.equal(finishRecords[0].attributes.title, 'Observed')
    assert.equal(typeof finishRecords[0].id, 'string')
  })

  it('allowed and refused writers get the same outcome with and without the refresh', async () => {
    const outcomes = {}
    for (const [name, fixture] of Object.entries(fixtures)) {
      const attempt = async (document, returning) => {
        try {
          const result = await fixture.api.resources.policy_tasks.post({ format: 'jsonapi', returning, document }, viewer)
          return { ok: result === undefined ? 'none' : result.data.type, attributes: result?.data?.attributes }
        } catch (error) {
          return { error: [error.code, error.subtype, error.message] }
        }
      }
      outcomes[name] = {
        allowedFull: await attempt(taskDocument(fixture, 'Allowed'), 'full'),
        allowedMinimal: await attempt(taskDocument(fixture, 'Allowed minimal'), 'minimal'),
        hiddenProject: await attempt(taskDocument(fixture, 'Hidden project', { project: fixture.projects.b }), 'minimal'),
        unreadableAfterwardsMinimal: await attempt(taskDocument(fixture, 'Group b task', { group: 'group-b' }), 'minimal'),
        unreadableAfterwardsFull: await attempt(taskDocument(fixture, 'Group b task full', { group: 'group-b' }), 'full')
      }
      const stored = await fixture.api.resources.policy_tasks.query({ format: 'plain', queryParams: { page: { size: 100 } } }, admin)
      outcomes[name].storedTitles = stored.data.map(task => task.title).filter(title => !/^Task \d+$|^Observed$/.test(title)).sort()
    }
    assert.ok(outcomes.plain.hiddenProject.error, JSON.stringify(outcomes.plain))
    assert.equal(outcomes.plain.allowedFull.attributes.title, 'Allowed')
    assert.deepEqual(outcomes.plain, outcomes.observed)
  })
})
