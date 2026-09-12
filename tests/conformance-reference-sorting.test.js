import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, createSearchPolicyApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'

const tables = { notes: 'search_policy_notes', items: 'search_policy_items', groups: 'search_policy_groups', teams: 'search_policy_teams' }
const admin = { visibility: { all: true }, scopeValues: { workspaceId: 'workspace-a' } }
const viewer = { visibility: { groups: ['group-a'] }, scopeValues: { workspaceId: 'workspace-a' } }
const linkage = (type, id) => ({ data: { type, id } })
const fromLink = link => parseJsonApiQuery(new URL(link, 'http://test.invalid').search.slice(1))

for (const hiddenBy of ['policy', 'workspace']) {
  describe(`Reference sorting hidden by ${hiddenBy} (${storageMode.mode})`, () => {
    let fixture
    const post = async (type, id, name, relationships = {}, hidden = false) => fixture.api.resources[type].post({
      document: { data: { type, id, attributes: { name, access_group: hidden ? 'group-b' : 'group-a' }, relationships } }
    }, admin)
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createSearchPolicyApi, tables })
      await fixture.api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'reference-sort-permission',
            handler: ({ context, scopeName }) => {
              if (context.method === 'query' && context.originalContext?.denyQueryScope === scopeName) throw new RestApiResourceError('Sort target denied', { subtype: 'forbidden' })
            }
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      await post('groups', '100', 'Visible A')
      await post('groups', '200', 'Visible B')
      await post('groups', '900', 'Hidden', {}, true)
      for (const [id, name, group] of [
        ['101', 'Visible A1', '100'], ['102', 'Hidden Z', '900'], ['103', 'Missing B', null],
        ['104', 'Visible B1', '200'], ['105', 'Hidden A', '900'], ['106', 'Visible A2', '100']
      ]) await post('items', id, name, group ? { group: linkage('groups', group) } : {})
      await post('items', '900', 'Hidden item', {}, true)
      for (const [id, type, target] of [
        ['201', 'groups', '100'], ['202', 'groups', '900'], ['203', 'items', '101'],
        ['204', 'items', '900'], ['205', null, null], ['206', 'groups', '200']
      ]) await post('notes', id, `Note ${id}`, type ? { subject: linkage(type, target) } : {})
      if (hiddenBy === 'workspace') {
        for (const type of ['groups', 'items']) {
          const adapter = fixture.api.knex.helpers.getStorageAdapter(type)
          await adapter.buildBaseQuery().where(adapter.getIdColumn(), '900').update({
            [adapter.translateColumn('access_group')]: 'group-a', [adapter.translateColumn('workspace_id')]: 'workspace-b'
          })
        }
      }
    })
    after(async () => { await fixture?.close() })

    const traverse = async (type, field, descending, format, expected, values) => {
      const sort = [descending ? `-${field}` : field]
      let queryParams = { sort, fields: { [type]: 'name' }, page: { size: 1 } }
      const collected = []
      const cursor = id => `${field}:${values[id] === null ? '~null' : encodeURIComponent(values[id])},id:${id}`
      for (let index = 0; index < 8; index++) {
        const result = await fixture.api.resources[type].query({ format, queryParams }, viewer)
        const row = result.data[0]
        assert.ok(row)
        collected.push(row.id)
        assert.equal(JSON.stringify(result.data).includes('__jra_'), false)
        if (!result.links.next) break
        assert.equal(result.meta.pagination.cursor.next, cursor(row.id))
        queryParams = fromLink(result.links.next)
        assert(index < 7, 'Forward reference traversal must terminate')
      }
      assert.deepEqual(collected, expected)
      const backwards = [expected.at(-1)]
      queryParams = { sort, fields: { [type]: 'name' }, page: { size: 1, before: cursor(expected.at(-1)) } }
      for (let index = 0; index < 8; index++) {
        const result = await fixture.api.resources[type].query({ format, queryParams }, viewer)
        backwards.unshift(...result.data.map(row => row.id))
        if (!result.links.next) break
        queryParams = fromLink(result.links.next)
        assert.ok(queryParams.page.before)
        assert(index < 7, 'Backward reference traversal must terminate')
      }
      assert.deepEqual(backwards, expected)
    }

    for (const format of ['jsonapi', 'plain']) {
      for (const descending of [false, true]) {
        it(`sorts and traverses visible references with hidden/null ties (${format}, ${descending ? 'desc' : 'asc'})`, async () => {
          await traverse('items', 'group_id', descending, format,
            descending ? ['104', '101', '106', '102', '103', '105'] : ['101', '106', '104', '102', '103', '105'],
            { 101: '100', 102: null, 103: null, 104: '200', 105: null, 106: '100' })
        })
      }
    }
    for (const alias of ['group', 'groupRef']) {
      it(`uses the same visible values through the ${alias} sort alias`, async () => {
        await traverse('items', alias, false, 'jsonapi', ['101', '106', '104', '102', '103', '105'],
          { 101: '100', 102: null, 103: null, 104: '200', 105: null, 106: '100' })
      })
    }
    for (const field of ['subject_id', 'subject_type']) {
      for (const descending of [false, true]) {
        it(`sorts polymorphic ${field} without exposing hidden linkage (${descending ? 'desc' : 'asc'})`, async () => {
          const byType = field === 'subject_type'
          const visible = byType ? (descending ? ['203', '201', '206'] : ['201', '206', '203']) : (descending ? ['206', '203', '201'] : ['201', '203', '206'])
          await traverse('notes', field, descending, 'jsonapi', [...visible, '202', '204', '205'],
            { 201: byType ? 'groups' : '100', 202: null, 203: byType ? 'items' : '101', 204: null, 205: null, 206: byType ? 'groups' : '200' })
        })
      }
    }
    it('uses later sort fields to order hidden and absent references together', async () => {
      const result = await fixture.api.resources.items.query({ queryParams: { sort: ['group_id', 'name'], page: { number: 1, size: 10 } } }, viewer)
      assert.deepEqual(result.data.map(row => row.id), ['101', '106', '104', '105', '102', '103'])
      assert.equal(result.meta.pagination.total, 6)
    })
    for (const field of ['parent_id', 'parent']) {
      it(`scopes both sides of a self-reference sort through ${field}`, async () => {
        await post('teams', '100', 'Visible parent')
        await post('teams', '900', 'Hidden parent', {}, true)
        await post('teams', '101', 'Visible child', { parent: linkage('teams', '100') })
        await post('teams', '102', 'Hidden child', { parent: linkage('teams', '900') })
        await post('teams', '103', 'No parent')
        if (hiddenBy === 'workspace') {
          const adapter = fixture.api.knex.helpers.getStorageAdapter('teams')
          await adapter.buildBaseQuery().where(adapter.getIdColumn(), '900').update({
            [adapter.translateColumn('access_group')]: 'group-a', [adapter.translateColumn('workspace_id')]: 'workspace-b'
          })
        }
        await traverse('teams', field, false, 'jsonapi', ['101', '100', '102', '103'], { 100: null, 101: '100', 102: null, 103: null })
      })
    }
    it('combines polymorphic type and ID sort keys in the same cursor', async () => {
      let queryParams = { sort: ['subject_type', '-subject_id'], page: { size: 1 } }
      const actual = []
      const expected = ['206', '201', '203', '202', '204', '205']
      const tokens = ['subject_type:groups,subject_id:200,id:206', 'subject_type:groups,subject_id:100,id:201', 'subject_type:items,subject_id:101,id:203', 'subject_type:~null,subject_id:~null,id:202', 'subject_type:~null,subject_id:~null,id:204']
      for (let index = 0; index < expected.length; index++) {
        const result = await fixture.api.resources.notes.query({ queryParams }, viewer)
        actual.push(...result.data.map(row => row.id))
        if (!result.links.next) break
        assert.equal(result.meta.pagination.cursor.next, tokens[index])
        queryParams = fromLink(result.links.next)
      }
      assert.deepEqual(actual, expected)
    })
    it('combines sorting, joined filters and includes without removing visible linkage', async () => {
      const result = await fixture.api.resources.items.query({ queryParams: { sort: ['group', 'group_id'], filters: { eitherJoinedReference: 'Visible' }, include: ['group'], page: { size: 1 } } }, viewer)
      assert.deepEqual(result.data.map(row => row.id), ['101'])
      assert.deepEqual(result.data[0].relationships.group.data, { type: 'groups', id: '100' })
      assert.deepEqual(result.included.map(row => row.id), ['100'])
      assert.equal(result.meta.pagination.cursor.next, 'group:100,group_id:100,id:101')
      assert.equal(JSON.stringify(result).includes('__jra_'), false)
    })
    it('recomputes visible sort values for each caller', async () => {
      const queryParams = { sort: ['group_id'], page: { size: 4 } }
      await fixture.api.resources.items.query({ queryParams }, viewer)
      const result = await fixture.api.resources.items.query({ queryParams }, admin)
      assert.equal(result.meta.pagination.cursor.next, hiddenBy === 'policy' ? 'group_id:900,id:102' : 'group_id:~null,id:102')
      const again = await fixture.api.resources.items.query({ queryParams }, viewer)
      assert.equal(again.meta.pagination.cursor.next, 'group_id:~null,id:102')
    })
    it('isolates source lookups from records with the same ID in other scopes', async () => {
      await post('groups', '101', 'Other resource with source ID')
      await post('teams', '900', 'Other resource with hidden target ID')
      const sourceAdapter = fixture.api.knex.helpers.getStorageAdapter('items')
      const table = sourceAdapter.getTableName()
      try {
        if (fixture.storage === 'anyapi') {
          const source = { ...await sourceAdapter.buildBaseQuery().where(sourceAdapter.getIdColumn(), '101').first() }
          delete source.id
          source[sourceAdapter.translateColumn('group_id')] = '200'
          const targetAdapter = fixture.api.knex.helpers.getStorageAdapter('groups')
          const target = { ...await targetAdapter.buildBaseQuery().where(targetAdapter.getIdColumn(), '900').first() }
          delete target.id
          target[targetAdapter.translateColumn('access_group')] = 'group-a'
          target[targetAdapter.translateColumn('workspace_id')] = 'workspace-a'
          await fixture.knex(table).insert([
            { ...source, tenant_id: 'reference_sort_other' },
            { ...source, resource: 'reference_sort_other' },
            { ...target, tenant_id: 'reference_sort_other' },
            { ...target, resource: 'reference_sort_other' }
          ])
        }
        await traverse('items', 'group_id', false, 'jsonapi', ['101', '106', '104', '102', '103', '105'],
          { 101: '100', 102: null, 103: null, 104: '200', 105: null, 106: '100' })
      } finally {
        if (fixture.storage === 'anyapi') await fixture.knex(table).where('tenant_id', 'reference_sort_other').orWhere('resource', 'reference_sort_other').delete()
      }
    })
    it('checks target query permission before sorting even an empty result', async () => {
      for (const [type, sort, target] of [['items', 'group_id', 'groups'], ['notes', 'subject_id', 'items']]) {
        await assert.rejects(fixture.api.resources[type].query({ queryParams: { sort: [sort], filters: { name: 'Absent' } } }, { ...viewer, denyQueryScope: target }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
      }
    })
    it('uses uncommitted target visibility without completing a caller transaction', async () => {
      const transaction = await fixture.knex.transaction()
      try {
        const adapter = fixture.api.knex.helpers.getStorageAdapter('groups')
        await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '100').update({ [adapter.translateColumn('access_group')]: 'group-b' })
        const result = await fixture.api.resources.items.query({ transaction, queryParams: { sort: ['group_id'], page: { size: 2 } } }, viewer)
        assert.deepEqual(result.data.map(row => row.id), ['104', '101'])
        assert.equal(result.meta.pagination.cursor.next, 'group_id:~null,id:101')
        assert.equal(transaction.isCompleted(), false)
      } finally { await transaction.rollback() }
    })
  })
}

for (const connector of ['express', 'fastify']) {
  describe(`Reference sort HTTP authorization through ${connector} (${storageMode.mode})`, () => {
    let fixture, app
    const get = async (url, denied) => {
      const headers = denied ? { 'x-target': denied } : {}
      const response = connector === 'express' ? await request(app).get(url).set(headers) : await app.inject({ method: 'GET', url, headers })
      return { status: response.statusCode, body: connector === 'express' ? response.body : response.json() }
    }
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({ createApi: createSearchPolicyApi, apiOptions: { app, connector }, tables })
      await fixture.api.customize({
        hooks: {
          'transport:request': {
            functionName: 'reference-sort-http-viewer',
            handler: ({ context }) => { Object.assign(context, viewer, { denyQueryScope: context.transport.request.headers['x-target'] }) }
          },
          checkPermissions: {
            functionName: 'reference-sort-http-permission',
            handler: ({ context, scopeName }) => {
              if (context.method === 'query' && context.originalContext?.denyQueryScope === scopeName) throw new RestApiResourceError('Sort target denied', { subtype: 'forbidden' })
            }
          }
        }
      })
      if (connector === 'fastify') await app.ready()
    })
    beforeEach(async () => {
      await fixture.reset()
      await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id: '900', attributes: { name: 'Hidden group', access_group: 'group-b' } } } }, admin)
      for (const [type, relationship] of [['items', 'group'], ['notes', 'subject']]) {
        for (const [id, target] of [['101', '900'], ['102', null]]) {
          await fixture.api.resources[type].post({
            document: {
              data: {
                type, id, attributes: { name: `Visible ${id}`, access_group: 'group-a' }, relationships: target ? { [relationship]: linkage('groups', target) } : {}
              }
            }
          }, admin)
        }
      }
    })
    after(async () => {
      try { if (connector === 'fastify') await app?.close() } finally { await fixture?.close() }
    })
    for (const [type, field, relationship] of [['items', 'group', 'group'], ['notes', 'subject_id', 'subject'], ['notes', 'subject_type', 'subject']]) {
      for (const mode of ['cursor', 'offset']) {
        it(`returns null ${field} linkage and round-trips ${mode} links`, async () => {
          const first = await get(`/api/${type}?sort=${field}&page[size]=1${mode === 'offset' ? '&page[number]=1' : ''}`)
          assert.equal(first.status, 200)
          assert.deepEqual(first.body.data.map(row => row.id), ['101'])
          assert.equal(first.body.data[0].relationships[relationship].data, null)
          assert.equal(JSON.stringify(first.body).includes('900'), false)
          assert.equal(JSON.stringify(first.body).includes('__jra_'), false)
          if (mode === 'cursor') assert.equal(first.body.meta.pagination.cursor.next, `${field}:~null,id:101`)
          else assert.equal(first.body.meta.pagination.total, 2)
          const nextUrl = new URL(first.body.links.next, 'http://test.invalid')
          const next = await get(nextUrl.pathname + nextUrl.search)
          assert.equal(next.status, 200)
          assert.deepEqual(next.body.data.map(row => row.id), ['102'])
          assert.equal(next.body.data[0].relationships[relationship].data, null)
        })
      }
    }
    it('returns a typed forbidden error when the sort target cannot be queried', async () => {
      const result = await get('/api/items?sort=group&page[size]=1', 'groups')
      assert.equal(result.status, 403)
      assert.equal(Object.hasOwn(result.body, 'data'), false)
      assert.equal(result.body.errors[0].detail, 'Sort target denied')
    })
  })
}

describe(`Reference sort defaults and result names (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createSearchPolicyApi, tables, apiOptions: { referenceSortDefaults: true, referenceSortCollisions: true } })
  })
  beforeEach(async () => {
    await fixture.reset()
    for (const [id, name, access] of [['100', 'Visible group', 'group-a'], ['900', 'Hidden group', 'group-b']]) {
      await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id, attributes: { name, access_group: access } } } }, admin)
    }
    for (const [id, group] of [['101', '900'], ['102', '100'], ['103', null]]) {
      await fixture.api.resources.items.post({
        document: {
          data: {
            type: 'items',
            id,
            attributes: { name: `Item ${id}`, access_group: 'group-a', __jra_sort_value_0: `Stored ${id}` },
            relationships: group ? { group: linkage('groups', group) } : {}
          }
        }
      }, admin)
    }
  })
  after(async () => { await fixture?.close() })
  for (const paginated of [false, true]) {
    it(`retains declared attributes and query projections alongside private sort values (${paginated ? 'cursor' : 'default limit'})`, async () => {
      const result = await fixture.api.resources.items.query({ queryParams: paginated ? { page: { size: 2 } } : {} }, viewer)
      assert.deepEqual(result.data.map(row => row.id), paginated ? ['102', '101'] : ['102', '101', '103'])
      for (const row of result.data) {
        assert.equal(row.attributes.__jra_sort_value_0, `Stored ${row.id}`)
        assert.equal(row.attributes.__jra_sort_value_2, `Item ${row.id}`)
        assert.deepEqual(Object.keys(row.attributes).filter(key => key.startsWith('__jra_')).sort(), ['__jra_sort_value_0', '__jra_sort_value_2'])
      }
      if (paginated) {
        assert.equal(result.meta.pagination.cursor.next, 'group_id:~null,group:~null,groupRef:~null,id:101')
        const next = await fixture.api.resources.items.query({ queryParams: fromLink(result.links.next) }, viewer)
        assert.deepEqual(next.data.map(row => row.id), ['103'])
      }
    })
  }
})

describe('Regular reference sorting preserves database collation', () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'knex', createApi: createIdConformanceApi, apiOptions: { idType: 'string', referenceCollation: 'case-insensitive' } })
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'reference-sort-collation-filter',
          handler: ({ context }) => {
            const state = context.knexQuery
            if (context.hideReference && state.scopeName === 'groups') state.query.whereNot(`${state.tableName}.${state.storageAdapter.getIdColumn()}`, 'H')
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    for (const id of ['a', 'B', 'H']) await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id, attributes: { name: id } } } })
    for (const [id, group] of [['1', 'a'], ['2', 'H'], ['3', 'B'], ['4', null]]) {
      await fixture.api.resources.items.post({ document: { data: { type: 'items', id, attributes: { name: id }, relationships: group ? { group: linkage('groups', group) } : {} } } })
    }
  })
  after(async () => { await fixture?.close() })
  for (const field of ['groupId', 'group']) {
    it(`uses column collation for ${field} ordering and both cursor directions`, async () => {
      let queryParams = { sort: [field], page: { size: 1 } }
      const ids = []
      for (let index = 0; index < 4; index++) {
        const result = await fixture.api.resources.items.query({ queryParams }, { hideReference: true })
        ids.push(...result.data.map(row => row.id))
        if (!result.links.next) break
        queryParams = fromLink(result.links.next)
      }
      assert.deepEqual(ids, ['1', '3', '2', '4'])
      const after = await fixture.api.resources.items.query({ queryParams: { sort: [field], page: { size: 1, after: `${field}:A,id:1` } } }, { hideReference: true })
      assert.deepEqual(after.data.map(row => row.id), ['3'])
      const before = await fixture.api.resources.items.query({ queryParams: { sort: [field], page: { size: 1, before: `${field}:b,id:3` } } }, { hideReference: true })
      assert.deepEqual(before.data.map(row => row.id), ['1'])
    })
  }
})
