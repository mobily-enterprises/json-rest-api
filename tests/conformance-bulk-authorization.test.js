import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, createRowPolicyApi, seedPolicyConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { pivots: 'row_policy_project_tasks', tasks: 'row_policy_tasks', projects: 'row_policy_projects', broken: 'row_policy_broken' }
const resource = (title, id) => ({ type: 'policy_tasks', ...(id === undefined ? {} : { id }), attributes: { title, access_group: 'group-a' } })
const tableOnly = storageMode.isAnyApi() && 'many-row writes need table storage'

describe(`Bulk zero ID (${storageMode.mode})`, { skip: tableOnly }, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' } })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('accepts zero when the declared ID schema allows it', async () => {
    await fixture.api.resources.items.post({ document: { data: { type: 'items', id: '0', attributes: { name: 'Zero' } } } })
    const result = await fixture.api.resources.items.patchMany({ document: { data: [{ type: 'items', id: '0', attributes: { name: 'Updated zero' } }] }, format: 'jsonapi', returning: 'full' })
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
    const titles = async () => (await fixture.api.resources.policy_tasks.query({ format: 'plain' }, seeded.admin)).data.map(row => row.title).sort()
    const original = ['Hidden task', 'Visible task', 'Visible task with hidden parent']

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
              if (original?.bulkIndex === undefined) return
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
        ? { data: [resource('Created')] }
        : method === 'PATCH'
          ? { data: [resource('Updated', seeded.task.id)] }
          : { data: [{ type: 'policy_tasks', id: seeded.task.id }] }

      it(`forwards authenticated user and workspace for ${method}`, { skip: tableOnly }, async () => {
        const response = await send(method, bodyFor())
        assert.equal(response.status, method === 'POST' ? 201 : 200, JSON.stringify(response.body))
        assert.equal(response.body.data.length, 1)
        if (method === 'DELETE') assert.deepEqual(response.body.data, [{ type: 'policy_tasks', id: seeded.task.id }])
        else assert.equal(response.body.data[0].attributes.title, method === 'POST' ? 'Created' : 'Updated')
        assert.deepEqual(seen, [{ userId: 'viewer', index: 0, workspace: 'workspace-a' }])
      })

      it(`enforces write permission for ${method} and keeps the database unchanged`, { skip: tableOnly }, async () => {
        const response = await send(method, bodyFor(), '', true)
        assert.equal(response.status, 403, JSON.stringify(response.body))
        assert.deepEqual(await titles(), original)
      })

      it(`answers ${method} with a refusal on AnyAPI storage`, { skip: !storageMode.isAnyApi() && 'AnyAPI only' }, async () => {
        const response = await send(method, bodyFor())
        assert.equal(response.status, 422, JSON.stringify(response.body))
        assert.equal(response.body.errors[0].code, 'REST_API_BULK_WRITE_UNSUPPORTED')
        assert.deepEqual(await titles(), original)
      })
    }

    it('writes many rows per request and keeps hidden rows out of every change', { skip: tableOnly }, async () => {
      const created = await send('POST', { data: ['One', 'Two', 'Three'].map(title => resource(title)) })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      const ids = created.body.data.map(row => row.id)
      assert.deepEqual(seen.map(entry => entry.index), [0, 1, 2])

      const updated = await send('PATCH', { data: ids.map(id => resource(`Updated ${id}`, id)) })
      assert.equal(updated.status, 200, JSON.stringify(updated.body))
      assert.deepEqual(updated.body.data.map(row => row.attributes.title), ids.map(id => `Updated ${id}`))

      // A hidden row fails the whole request as not found and changes nothing.
      for (const [method, body] of [
        ['PATCH', { data: [resource('Leak', ids[0]), resource('Leak', seeded.hiddenTask.id)] }],
        ['DELETE', { data: [ids[0], seeded.hiddenTask.id].map(id => ({ type: 'policy_tasks', id })) }]
      ]) {
        const response = await send(method, body)
        assert.equal(response.status, 404, JSON.stringify(response.body))
      }
      assert.equal((await titles()).includes('Leak'), false)

      const deleted = await send('DELETE', { data: ids.map(id => ({ type: 'policy_tasks', id })) })
      assert.equal(deleted.status, 200, JSON.stringify(deleted.body))
      assert.deepEqual(await titles(), original)
    })

    it('rejects malformed requests and requests over the limit before writing', async () => {
      for (const [method, body, query] of [
        ['POST', {}, ''],
        ['POST', { data: [] }, ''],
        ['POST', { data: [resource('Unwritten')] }, '?atomic=false'],
        ['POST', { data: Array.from({ length: 1001 }, (_, index) => resource(`Row ${index}`)) }, ''],
        ['PATCH', { operations: [{ id: '1', data: resource('Old shape', '1') }] }, ''],
        ['DELETE', { data: [seeded.task.id] }, ''],
        ['DELETE', { data: [{ type: 'policy_projects', id: seeded.task.id }] }, '']
      ]) {
        const response = await send(method, body, query)
        assert.equal(response.status, 422, `${method} ${JSON.stringify(body).slice(0, 80)}: ${JSON.stringify(response.body)}`)
      }
      assert.deepEqual(seen, [])
      assert.deepEqual(await titles(), original)
    })
  })
}
