import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createRowPolicyApi, seedPolicyConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

for (const hiddenBy of ['policy', 'workspace']) {
  describe(`Shared authorization conformance, hiddenBy=${hiddenBy} (${storageMode.mode})`, () => {
    let fixture
    let seeded
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createRowPolicyApi,
        apiOptions: { polymorphic: true },
        tables: { pivots: 'row_policy_project_tasks', tasks: 'row_policy_tasks', projects: 'row_policy_projects', broken: 'row_policy_broken' }
      })
      assert.equal(fixture.storage, storageMode.mode)
      await fixture.api.customize({
        hooks: {
          checkDataPermissionsGet: {
            functionName: 'self-related-read-permission',
            handler: ({ context, scopeName }) => {
              if (scopeName !== 'policy_tasks') return
              if (context.expectedParent?.id === context.id) {
                assert.equal(context.record.data.attributes.title, context.expectedParent.title)
              }
              if (context.relatedDenyId === context.id) {
                throw new RestApiResourceError('Self-related target denied', { subtype: 'forbidden' })
              }
            }
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      seeded = await seedPolicyConformanceApi(fixture.api, { hiddenBy })
    })
    after(async () => { await fixture?.close() })

    for (const format of ['jsonapi', 'plain']) {
      it(`keeps parent and target permissions separate for self-type polymorphic reads (${format})`, async () => {
        await fixture.api.resources.policy_tasks.patch({
          id: seeded.hiddenParentTask.id,
          format: 'plain',
          returning: 'none',
          inputRecord: { subject: { _type: 'policy_tasks', id: seeded.task.id } }
        }, seeded.admin)
        for (const fields of [{}, { policy_tasks: 'title' }]) {
          const params = { id: seeded.hiddenParentTask.id, relationshipName: 'subject', format, queryParams: { fields } }
          const context = { ...seeded.viewer, expectedParent: { id: seeded.hiddenParentTask.id, title: 'Visible task with hidden parent' } }
          const result = await fixture.api.resources.policy_tasks.getRelated(params, context)
          assert.equal(format === 'plain' ? result.id : result.data.id, seeded.task.id)
          await assert.rejects(fixture.api.resources.policy_tasks.getRelated(params, {
            ...context, relatedDenyId: seeded.task.id
          }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
        }
      })

      it(`hides polymorphic linkage with and without includes (${format})`, async () => {
        for (const include of [[], ['subject']]) {
          const result = await fixture.api.resources.policy_tasks.get({
            id: seeded.hiddenParentTask.id, format, queryParams: { include }
          }, seeded.viewer)
          assert.equal(format === 'plain' ? result.subject : result.data.relationships.subject.data, format === 'plain' ? undefined : null)
          assert.equal(result.included?.length || 0, 0)
        }
        const params = { id: seeded.hiddenParentTask.id, relationshipName: 'subject', format }
        assert.equal((await fixture.api.resources.policy_tasks.getRelationship(params, seeded.viewer)).data, null)
        const related = await fixture.api.resources.policy_tasks.getRelated(params, seeded.viewer)
        assert.equal(format === 'plain' ? related : related.data, null)
      })

      it(`hides identifiers in write responses without clearing stored relationships (${format})`, async () => {
        const attributes = { title: 'Updated visible child' }
        const result = await fixture.api.resources.policy_tasks.patch({
          id: seeded.hiddenParentTask.id,
          format,
          returning: 'full',
          inputRecord: format === 'plain' ? attributes : { data: { type: 'policy_tasks', id: seeded.hiddenParentTask.id, attributes } }
        }, seeded.viewer)
        for (const name of ['project', 'subject']) {
          assert.equal(format === 'plain' ? result[name] : result.data.relationships[name].data, format === 'plain' ? undefined : null)
        }
        const adapter = fixture.api.knex.helpers.getStorageAdapter('policy_tasks')
        const row = await adapter.buildBaseQuery().where(adapter.getIdColumn(), seeded.hiddenParentTask.id).first()
        for (const field of ['project_id', 'subject_id']) assert.equal(String(adapter.getFieldValue(row, field)), seeded.hiddenProject.id)
      })

      it(`denies hidden primary records and paginates visible related rows only (${format})`, async () => {
        await assert.rejects(fixture.api.resources.policy_projects.get({ id: seeded.hiddenProject.id, format }, seeded.viewer), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
        for (const [relationshipName, expected] of [['tasks', [seeded.task.id]], ['shared_tasks', [seeded.task.id, seeded.hiddenParentTask.id]]]) {
          const result = await fixture.api.resources.policy_projects.getRelated({
            id: seeded.project.id, relationshipName, format, queryParams: { sort: ['id'], page: { number: 1, size: 1 } }
          }, seeded.viewer)
          assert.deepEqual(result.data.map(row => row.id), expected.slice(0, 1))
          assert.equal(result.meta.pagination.total, expected.length)
          const linkage = await fixture.api.resources.policy_projects.getRelationship({ id: seeded.project.id, relationshipName }, seeded.viewer)
          assert.deepEqual(linkage.data.map(row => row.id).sort(), expected.sort())
        }
      })

      it(`uses the borrowed transaction for linkage visibility (${format})`, async () => {
        const unit = await holdManagedTransaction(fixture.api)
        const transaction = unit.transaction
        try {
          await fixture.api.resources.policy_projects.patch({
            id: seeded.project.id, transaction, format: 'plain', returning: 'none', inputRecord: { access_group: 'group-b' }
          }, seeded.admin)
          const result = await fixture.api.resources.policy_tasks.get({ id: seeded.task.id, transaction, format }, seeded.viewer)
          assert.equal(format === 'plain' ? result.project : result.data.relationships.project.data, format === 'plain' ? undefined : null)
          assert.equal(transaction.isCompleted(), false)
        } finally { await unit.rollback() }
        const result = await fixture.api.resources.policy_tasks.get({ id: seeded.task.id, format }, seeded.viewer)
        assert.equal(format === 'plain' ? result.project.id : result.data.relationships.project.data.id, seeded.project.id)
      })

      for (const include of [[], ['project']]) {
        for (const method of ['get', 'query']) {
          for (const sparse of [false, true]) {
            it(`hides belongsTo identifiers through ${method}, include=${include.length}, sparse=${sparse} (${format})`, async () => {
              const result = await fixture.api.resources.policy_tasks[method]({
                id: seeded.hiddenParentTask.id,
                format,
                queryParams: { include, ...(sparse ? { fields: { policy_tasks: 'title,project' } } : {}) }
              }, seeded.viewer)
              const record = method === 'get'
                ? (format === 'plain' ? result : result.data)
                : result.data.find(row => row.id === seeded.hiddenParentTask.id)
              assert.equal(format === 'plain' ? record.project : record.relationships.project.data, format === 'plain' ? undefined : null)
              assert.equal(result.included?.some(row => row.type === 'policy_projects' && row.id === seeded.hiddenProject.id) || false, false)
            })
          }
        }
      }

      it(`filters linkage on included leaf resources without requiring nested includes (${format})`, async () => {
        const result = await fixture.api.resources.policy_projects.get({
          id: seeded.project.id, format, queryParams: { include: ['shared_tasks'] }
        }, seeded.viewer)
        const tasks = format === 'plain' ? result.shared_tasks : result.included.filter(row => row.type === 'policy_tasks')
        assert.deepEqual(tasks.map(row => row.id).sort(), [seeded.task.id, seeded.hiddenParentTask.id].sort())
        const withHiddenParent = tasks.find(row => row.id === seeded.hiddenParentTask.id)
        assert.equal(format === 'plain' ? withHiddenParent.project : withHiddenParent.relationships.project.data, format === 'plain' ? undefined : null)
      })

      it(`returns null from the hidden belongsTo linkage and related endpoints (${format})`, async () => {
        const params = { id: seeded.hiddenParentTask.id, relationshipName: 'project', format }
        assert.equal((await fixture.api.resources.policy_tasks.getRelationship(params, seeded.viewer)).data, null)
        const related = await fixture.api.resources.policy_tasks.getRelated(params, seeded.viewer)
        assert.equal(format === 'plain' ? related : related.data, null)
      })
    }
  })
}
