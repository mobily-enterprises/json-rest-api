import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, createRowPolicyApi, seedPolicyConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { pivots: 'row_policy_project_tasks', tasks: 'row_policy_tasks', projects: 'row_policy_projects', broken: 'row_policy_broken' }
const inputRecord = (title, id) => ({ data: { type: 'policy_tasks', ...(id === undefined ? {} : { id }), attributes: { title, access_group: 'group-a' } } })

for (const hiddenBy of ['policy', 'workspace']) {
  describe(`Bulk authorization, hiddenBy=${hiddenBy} (${storageMode.mode})`, () => {
    let fixture, seeded
    const transactions = new Set()
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createRowPolicyApi, apiOptions: { bulk: true }, tables })
      await fixture.api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'deny-bulk-index',
            handler: ({ context }) => {
              const original = context.originalContext
              if (original?.bulkOperation && original.transaction) transactions.add(original.transaction)
              if (['post', 'patch', 'delete'].includes(context.method) && original?.bulkOperation && original.bulkIndex === original.denyIndex) {
                throw Object.assign(new Error('Write denied'), { code: 'WRITE_DENIED', statusCode: 403 })
              }
            }
          }
        }
      })
    })
    afterEach(async () => {
      for (const transaction of transactions) if (!transaction.isCompleted()) await transaction.rollback()
      transactions.clear()
    })
    beforeEach(async () => {
      await fixture.reset()
      seeded = await seedPolicyConformanceApi(fixture.api, { hiddenBy })
    })
    after(async () => { await fixture?.close() })

    for (const method of ['bulkPatch', 'bulkDelete']) {
      for (const atomic of [true, false]) {
        it(`${method} preserves hidden records and ${atomic ? 'rolls back' : 'commits'} allowed operations`, async () => {
          const ids = [seeded.task.id, seeded.hiddenTask.id, seeded.hiddenParentTask.id]
          const params = method === 'bulkPatch'
            ? { operations: ids.map(id => ({ id, data: inputRecord('Updated', id).data })), atomic }
            : { ids, atomic }
          const operation = fixture.api.resources.policy_tasks[method](params, seeded.viewer)
          if (atomic) {
            await assert.rejects(operation, { code: 'REST_API_RESOURCE', subtype: 'not_found' })
          } else {
            const result = await operation
            assert.equal(result.meta.succeeded, 2)
            assert.equal(result.meta.failed, 1)
            assert.equal(result.errors[0].index, 1)
            assert.equal(result.errors[0].error.code, 'REST_API_RESOURCE')
            if (method === 'bulkPatch') {
              assert.deepEqual(result.data.map(row => row.id), [ids[0], ids[2]])
              assert.equal(result.data[1].relationships.project.data, null)
            } else assert.deepEqual(result.meta.deleted, [ids[0], ids[2]])
          }
          const adapter = fixture.api.knex.helpers.getStorageAdapter('policy_tasks')
          const stored = await adapter.buildBaseQuery()
          const rows = new Map(stored.map(row => [String(adapter.getFieldValue(row, 'id')), row]))
          assert.equal(adapter.getFieldValue(rows.get(ids[1]), 'title'), 'Hidden task')
          for (const [id, original] of [[ids[0], 'Visible task'], [ids[2], 'Visible task with hidden parent']]) {
            if (!atomic && method === 'bulkDelete') assert.equal(rows.has(id), false)
            else assert.equal(adapter.getFieldValue(rows.get(id), 'title'), atomic ? original : 'Updated')
          }
        })
      }
    }

    for (const atomic of [true, false]) {
      it(`bulkPost rejects hidden relationship targets (atomic=${atomic})`, async () => {
        const denied = inputRecord('Denied relationship')
        denied.data.relationships = { project: { data: { type: 'policy_projects', id: seeded.hiddenProject.id } } }
        const operation = fixture.api.resources.policy_tasks.bulkPost({ inputRecords: [inputRecord('Allowed'), denied], atomic }, seeded.viewer)
        if (atomic) await assert.rejects(operation, { code: 'REST_API_RESOURCE', subtype: 'not_found' })
        else {
          const result = await operation
          assert.equal(result.meta.succeeded, 1)
          assert.equal(result.meta.failed, 1)
          assert.equal(result.data[0].attributes.title, 'Allowed')
          assert.equal(result.errors[0].index, 1)
        }
        const rows = (await fixture.api.resources.policy_tasks.query({}, seeded.admin)).data
        assert.equal(rows.some(row => row.attributes.title === 'Denied relationship'), false)
        assert.equal(rows.some(row => row.attributes.title === 'Allowed'), !atomic)
      })
    }

    if (hiddenBy === 'policy') {
      for (const method of ['bulkPost', 'bulkPatch']) {
        for (const format of ['plain', 'jsonapi']) {
          for (const returning of ['none', 'minimal', 'full']) {
            it(`${method} selects ${format}/${returning} without exposing hidden linkage`, async () => {
              const record = inputRecord('Written', method === 'bulkPatch' ? seeded.hiddenParentTask.id : undefined)
              const data = format === 'jsonapi' ? record.data : record.data.attributes
              const params = method === 'bulkPost'
                ? { inputRecords: [format === 'jsonapi' ? record : data] }
                : { operations: [{ id: seeded.hiddenParentTask.id, data }] }
              const result = await fixture.api.resources.policy_tasks[method]({ ...params, format, returning }, seeded.viewer)
              assert.equal(result.meta.succeeded, 1)
              if (returning === 'none') assert.equal(Object.hasOwn(result, 'data'), false)
              else {
                assert.equal(result.data.length, 1)
                if (returning === 'minimal') assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'type'])
                else if (format === 'jsonapi') {
                  assert.equal(result.data[0].attributes.title, 'Written')
                  assert.equal(result.data[0].relationships.project.data, null)
                } else {
                  assert.equal(result.data[0].title, 'Written')
                  assert.equal(result.data[0].project, undefined)
                }
              }
              const visible = (await fixture.api.resources.policy_tasks.query({}, seeded.viewer)).data
              assert.equal(visible.filter(row => row.attributes.title === 'Written').length, 1)
            })
          }
        }
      }

      for (const method of ['bulkPost', 'bulkPatch', 'bulkDelete']) {
        for (const atomic of [true, false]) {
          it(`${method} applies each write permission (atomic=${atomic})`, async () => {
            const ids = [seeded.task.id, seeded.hiddenTask.id, seeded.hiddenParentTask.id]
            const params = method === 'bulkPost'
              ? { inputRecords: [inputRecord('Allowed'), inputRecord('Denied'), inputRecord('Allowed later')] }
              : method === 'bulkPatch'
                ? { operations: ids.map(id => ({ id, data: inputRecord('Updated', id).data })) }
                : { ids }
            const operation = fixture.api.resources.policy_tasks[method]({ ...params, atomic }, { ...seeded.admin, denyIndex: 1 })
            if (atomic) await assert.rejects(operation, { code: 'WRITE_DENIED' })
            else {
              const result = await operation
              assert.equal(result.meta.succeeded, 2)
              assert.equal(result.meta.failed, 1)
              assert.equal(result.errors[0].index, 1)
              assert.equal(result.errors[0].error.code, 'WRITE_DENIED')
            }
            const rows = (await fixture.api.resources.policy_tasks.query({}, seeded.admin)).data
            assert.equal(rows.find(row => row.id === ids[1]).attributes.title, 'Hidden task')
            if (atomic) {
              assert.deepEqual(rows.map(row => row.attributes.title).sort(), ['Hidden task', 'Visible task', 'Visible task with hidden parent'])
            } else if (method === 'bulkDelete') assert.deepEqual(rows.map(row => row.id), [ids[1]])
            else if (method === 'bulkPatch') assert.equal(rows.filter(row => row.attributes.title === 'Updated').length, 2)
            else {
              assert.equal(rows.length, 5)
              assert.equal(rows.some(row => row.attributes.title === 'Denied'), false)
            }
          })
        }
      }

      for (const atomic of [null, 'false', 0]) {
        it(`rejects non-boolean atomic=${JSON.stringify(atomic)} before executing a batch`, async () => {
          await assert.rejects(fixture.api.resources.policy_tasks.bulkPost({ inputRecords: [inputRecord('Unwritten')], atomic }, seeded.viewer), { code: 'REST_API_VALIDATION' })
          assert.equal((await fixture.api.resources.policy_tasks.query({}, seeded.admin)).data.length, 3)
        })
      }
    }
  })
}

describe(`Bulk zero ID (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, apiOptions: { bulk: true }, tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' } })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('accepts zero when the declared ID schema allows it', async () => {
    await fixture.api.resources.items.post({ inputRecord: { data: { type: 'items', id: '0', attributes: { name: 'Zero' } } } })
    const result = await fixture.api.resources.items.bulkPatch({ operations: [{ id: 0, data: { type: 'items', id: '0', attributes: { name: 'Updated zero' } } }] })
    assert.equal(result.data[0].id, '0')
    assert.equal(result.data[0].attributes.name, 'Updated zero')
  })
})

for (const connector of ['express', 'fastify']) {
  describe(`Bulk HTTP authorization through ${connector} (${storageMode.mode})`, () => {
    let fixture, app, seeded
    const seen = []
    const send = async (method, body, query = '', deny = false) => {
      const url = `/api/policy_tasks/bulk${query}`
      const headers = { accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json', 'x-deny-write': String(deny) }
      if (connector === 'fastify') {
        const response = await app.inject({ method, url, headers, payload: body })
        return { status: response.statusCode, body: response.body ? response.json() : undefined }
      }
      const response = await request(app)[method.toLowerCase()](url).set(headers).send(body).timeout({ response: 3000, deadline: 5000 })
      return { status: response.status, body: response.body }
    }
    before(async () => {
      app = connector === 'fastify' ? fastify() : express()
      fixture = await createConformanceFixture({ createApi: createRowPolicyApi, apiOptions: { bulk: true, connector, app, 'rest-api': { format: 'plain', returning: 'none' } }, tables })
      await fixture.api.customize({
        hooks: {
          'transport:request': {
            functionName: 'bulk-viewer',
            handler: ({ context }) => {
              Object.assign(context, seeded.viewer, { auth: { userId: 'viewer', denyWrite: context.transport.request.headers['x-deny-write'] === 'true' } })
            }
          },
          checkPermissions: {
            functionName: 'bulk-permissions',
            handler: ({ context }) => {
              if (!['post', 'patch', 'delete'].includes(context.method)) return
              const original = context.originalContext
              if (!original?.bulkOperation) return
              seen.push({ userId: original.auth?.userId, index: original.bulkIndex, workspace: original.scopeValues?.workspaceId })
              if (original.auth?.denyWrite) throw Object.assign(new Error('Write denied'), { code: 'WRITE_DENIED', statusCode: 403 })
            }
          }
        }
      })
      if (connector === 'fastify') await app.ready()
    })
    beforeEach(async () => {
      await fixture.reset()
      seeded = await seedPolicyConformanceApi(fixture.api)
      seen.length = 0
    })
    after(async () => {
      try { if (connector === 'fastify') await app?.close() } finally { await fixture?.close() }
    })

    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const bodyFor = () => method === 'POST'
        ? { data: [inputRecord('Created').data] }
        : method === 'PATCH'
          ? { operations: [{ id: seeded.task.id, data: inputRecord('Updated', seeded.task.id).data }] }
          : { ids: [seeded.task.id] }

      it(`forwards authenticated user and workspace for ${method}`, async () => {
        const response = await send(method, bodyFor())
        assert.equal(response.status, method === 'POST' ? 201 : 200, JSON.stringify(response.body))
        assert.equal(response.body.meta.succeeded, 1)
        assert.deepEqual(seen, [{ userId: 'viewer', index: 0, workspace: 'workspace-a' }])
      })

      it(`enforces write permission for ${method} and keeps the database unchanged`, async () => {
        const response = await send(method, bodyFor(), '', true)
        assert.equal(response.status, 403, JSON.stringify(response.body))
        const result = await fixture.api.resources.policy_tasks.get({ id: seeded.task.id, format: 'jsonapi' }, seeded.admin)
        assert.equal(result.data.attributes.title, 'Visible task')
        assert.equal((await fixture.api.resources.policy_tasks.query({}, seeded.admin)).data.length, 3)
      })
    }

    it('honors atomic=false while keeping hidden rows inaccessible', async () => {
      const operations = [seeded.task, seeded.hiddenTask].map(row => ({ id: row.id, data: inputRecord('Updated', row.id).data }))
      const response = await send('PATCH', { operations }, '?atomic=false')
      assert.equal(response.status, 200, JSON.stringify(response.body))
      assert.deepEqual(response.body.meta, { total: 2, succeeded: 1, failed: 1, atomic: false })
      assert.equal(response.body.errors[0].error.code, 'REST_API_RESOURCE')
      assert.equal(response.body.data[0].id, seeded.task.id)
    })

    for (const atomic of ['', '0', 'FALSE', 'false-ish']) {
      it(`rejects malformed atomic=${JSON.stringify(atomic)} before writing`, async () => {
        const response = await send('POST', { data: [inputRecord('Unwritten').data] }, `?atomic=${atomic}`)
        assert.equal(response.status, 422, JSON.stringify(response.body))
        assert.deepEqual(seen, [])
        assert.equal((await fixture.api.resources.policy_tasks.query({}, seeded.admin)).data.length, 3)
      })
    }
  })
}
