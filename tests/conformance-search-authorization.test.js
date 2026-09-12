import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSearchPolicyApi, createIdConformanceApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'

const tables = { notes: 'search_policy_notes', items: 'search_policy_items', groups: 'search_policy_groups', teams: 'search_policy_teams' }
const admin = { visibility: { all: true }, scopeValues: { workspaceId: 'workspace-a' } }
const viewer = { visibility: { groups: ['group-a'] }, scopeValues: { workspaceId: 'workspace-a' } }
const linkage = record => ({ data: { type: record.type, id: record.id } })

for (const hiddenBy of ['policy', 'workspace']) {
  describe(`Search authorization hidden by ${hiddenBy} (${storageMode.mode})`, () => {
    let fixture, team, hiddenTeam, group, hiddenGroup, hiddenTeamGroup, item, hiddenGroupItem, hiddenTeamItem, orphan
    const created = []
    const post = async (type, name, relationships = {}, hidden = false) => {
      const record = (await fixture.api.resources[type].post({
        document: { data: { type, attributes: { name, note: null, access_group: hidden ? 'group-b' : 'group-a' }, relationships } }
      }, admin)).data
      if (hidden) created.push(record)
      return record
    }
    const query = async (type, filters, context = viewer, format = 'jsonapi') => fixture.api.resources[type].query({
      format, queryParams: { filters, sort: ['id'], page: { number: 1, size: 20 } }
    }, context)
    const assertIds = (result, expected) => {
      assert.deepEqual(result.data.map(row => row.id), expected.map(row => row.id))
      assert.equal(result.meta.pagination.total, expected.length)
    }
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createSearchPolicyApi, tables })
      await fixture.api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'search-target-permission',
            handler: ({ context, scopeName }) => {
              if (context.method === 'query' && context.originalContext?.denyQueryScope === scopeName) throw new RestApiResourceError('Search target denied', { subtype: 'forbidden' })
            }
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      created.length = 0
      team = await post('teams', 'Visible team')
      hiddenTeam = await post('teams', 'Hidden team', {}, true)
      group = await post('groups', 'Visible group', { team: linkage(team) })
      hiddenGroup = await post('groups', 'Hidden group', { team: linkage(team) }, true)
      hiddenTeamGroup = await post('groups', 'Other group', { team: linkage(hiddenTeam) })
      item = await post('items', 'Visible item', { group: linkage(group) })
      hiddenGroupItem = await post('items', 'Primary match', { group: linkage(hiddenGroup) })
      hiddenTeamItem = await post('items', 'Other item', { group: linkage(hiddenTeamGroup) })
      orphan = await post('items', 'Orphan')
      await post('items', 'Hidden item', { group: linkage(group) }, true)
      await post('notes', 'Visible subject', { subject: linkage(group) })
      await post('notes', 'Hidden subject', { subject: linkage(hiddenGroup) })
      await post('notes', 'Hidden path', { subject: linkage(hiddenGroupItem) })
      if (hiddenBy === 'workspace') {
        for (const record of created) {
          const adapter = fixture.api.knex.helpers.getStorageAdapter(record.type)
          await adapter.buildBaseQuery().where(adapter.getIdColumn(), record.id).update({
            [adapter.translateColumn('access_group')]: 'group-a', [adapter.translateColumn('workspace_id')]: 'workspace-b'
          })
        }
      }
    })
    after(async () => { await fixture?.close() })

    if (storageMode.isAnyApi()) {
      it('isolates joined and polymorphic targets with overlapping foreign-scope IDs', async () => {
        const transaction = await fixture.knex.transaction()
        try {
          for (const [type, record] of [['groups', group], ['teams', team]]) {
            const schemaInfo = fixture.api.resources[type].vars.schemaInfo
            for (const descriptor of [
              { ...schemaInfo.descriptor, tenant: 'outside_search_tenant' },
              { ...schemaInfo.descriptor, resource: `outside_search_${type}` }
            ]) {
              await seedStorageAdapterRecords(transaction, { ...schemaInfo, descriptor }, [{
                id: record.id,
                name: `Outside ${type}`,
                note: null,
                access_group: 'group-a',
                workspace_id: 'workspace-a',
                ...(type === 'groups' ? { team_id: team.id } : {})
              }])
            }
          }
          for (const [type, field, outside, visible, expectedName] of [
            ['items', 'groupName', 'Outside groups', 'Visible group', 'Visible item'],
            ['items', 'teamName', 'Outside teams', 'Visible team', 'Visible item'],
            ['notes', 'subjectName', 'Outside groups', 'Visible group', 'Visible subject'],
            ['notes', 'subjectTeam', 'Outside teams', 'Visible team', 'Visible subject']
          ]) {
            const read = value => fixture.api.resources[type].query({ transaction, queryParams: { filters: { [field]: value }, page: { number: 1, size: 20 } } }, viewer)
            const excluded = await read(outside)
            assert.deepEqual(excluded.data, [])
            assert.equal(excluded.meta.pagination.total, 0)
            const included = await read(visible)
            assert.deepEqual(included.data.map(row => row.attributes.name), [expectedName])
            assert.equal(included.meta.pagination.total, 1)
          }
          assert.equal(transaction.isCompleted(), false)
        } finally { await transaction.rollback() }
      })
    }

    for (const format of ['jsonapi', 'plain']) {
      it(`filters reference IDs through target visibility, including relationship aliases (${format})`, async () => {
        for (const field of ['group_id', 'group', 'groupRef']) {
          assertIds(await query('items', { [field]: hiddenGroup.id }, viewer, format), [])
          assertIds(await query('items', { [field]: group.id }, viewer, format), [item])
        }
      })
      it(`treats hidden references as null for equality and inequality (${format})`, async () => {
        assertIds(await query('items', { groupRef: null }, viewer, format), [hiddenGroupItem, orphan])
        assertIds(await query('items', { groupRefNot: null }, viewer, format), [item, hiddenTeamItem])
        assertIds(await query('items', { groupRefNot: group.id }, viewer, format), [hiddenTeamItem])
      })
      it(`applies ID-list and range operators to visible references (${format})`, async () => {
        assertIds(await query('items', { groupRefs: [group.id, hiddenGroup.id] }, viewer, format), [item])
        assertIds(await query('items', { groupRange: [group.id, hiddenGroup.id] }, viewer, format), [item])
        assertIds(await query('items', { groupRefs: [] }, viewer, format), [])
      })
      it(`retains independent OR matches while concealing reference matches (${format})`, async () => {
        for (const field of ['eitherReference', 'eitherJoinedReference']) {
          assertIds(await query('items', { [field]: hiddenGroup.id }, viewer, format), [])
          assertIds(await query('items', { [field]: 'Primary' }, viewer, format), [hiddenGroupItem])
          assertIds(await query('items', { [field]: 'Orphan' }, viewer, format), [orphan])
          assertIds(await query('items', { [field]: `0${group.id}` }, viewer, format), [])
        }
      })
      it(`keeps text patterns literal on numeric references and joined paths (${format})`, async () => {
        for (const field of ['groupContains', 'groupStarts', 'groupEnds', 'groupLike', 'teamContains']) {
          const id = field === 'teamContains' ? team.id : group.id
          assertIds(await query('items', { [field]: id }, viewer, format), [item])
          for (const pattern of [`0${id}`, `${id}e0`]) {
            const result = await query('items', { [field]: pattern }, viewer, format)
            assert.deepEqual(result.data.map(row => row.id), [], `${field}: ${JSON.stringify(pattern)}`)
          }
        }
        const match = await query('notes', { subjectReferenceText: team.id }, viewer, format)
        assert.deepEqual(match.data.map(row => format === 'plain' ? row.name : row.attributes.name), ['Visible subject'])
        assertIds(await query('notes', { subjectReferenceText: `0${team.id}` }, viewer, format), [])
      })
      it(`filters polymorphic backing ID/type fields through visible linkage (${format})`, async () => {
        const byId = await query('notes', { subject_id: hiddenGroup.id }, viewer, format)
        assert.deepEqual(byId.data.map(row => format === 'plain' ? row.name : row.attributes.name), hiddenGroupItem.id === hiddenGroup.id ? ['Hidden path'] : [])
        assertIds(await query('notes', { subject_id: hiddenGroup.id, subject_type: 'groups' }, viewer, format), [])
        for (const field of ['subject_type', 'eitherSubject']) {
          const result = await query('notes', { [field]: 'groups' }, viewer, format)
          assert.deepEqual(result.data.map(row => format === 'plain' ? row.name : row.attributes.name), ['Visible subject'])
          assert.equal(result.meta.pagination.total, 1)
        }
        const empty = await query('notes', { subject_type: null }, viewer, format)
        assert.deepEqual(empty.data.map(row => format === 'plain' ? row.name : row.attributes.name), ['Hidden subject'])
        assert.equal(empty.meta.pagination.total, 1)
      })
      it(`does not expose relationship backing attributes, including sparse responses (${format})`, async () => {
        for (const type of ['items', 'notes']) {
          for (const fields of [undefined, { [type]: type === 'items' ? 'name,group_id' : 'name,subject_id,subject_type' }]) {
            const result = await fixture.api.resources[type].query({ format, queryParams: { fields } }, viewer)
            for (const record of result.data) {
              const attributes = format === 'plain' ? record : record.attributes
              for (const key of ['group_id', 'subject_id', 'subject_type']) assert.equal(Object.hasOwn(attributes, key), false, `${type}.${key}`)
            }
          }
        }
      })
      it(`does not match hidden belongs-to fields or counts (${format})`, async () => {
        assertIds(await query('groups', { name: 'Hidden group' }, viewer, format), [])
        const record = await fixture.api.resources.items.get({ id: hiddenGroupItem.id }, viewer)
        assert.equal(record.data.relationships.group.data, null)
        assertIds(await query('items', { groupName: 'Hidden group' }, viewer, format), [])
        assertIds(await query('items', { groupName: 'Visible group' }, viewer, format), [item])
      })
      it(`preserves a primary OR match with a hidden or absent related row (${format})`, async () => {
        assertIds(await query('items', { eitherName: 'Primary' }, viewer, format), [hiddenGroupItem])
        assertIds(await query('items', { eitherName: 'Orphan' }, viewer, format), [orphan])
        assertIds(await query('items', { eitherName: 'Hidden' }, viewer, format), [])
      })
      it(`enforces visibility at each intermediate join (${format})`, async () => {
        assertIds(await query('items', { teamName: 'Hidden team' }, viewer, format), [])
        assertIds(await query('items', { teamName: 'Visible team' }, viewer, format), [item])
      })
    }
    it('treats hidden and absent joined rows equally for null field searches', async () => {
      assertIds(await query('items', { groupNote: null }), [item, hiddenGroupItem, hiddenTeamItem, orphan])
    })
    it('filters reverse joins before matching and counting parents', async () => {
      assertIds(await query('groups', { itemName: 'Hidden item' }), [])
      assertIds(await query('groups', { itemName: 'Visible item' }), [group])
      assertIds(await query('teams', { groupName: 'Hidden group' }), [])
      await post('items', 'Visible item', { group: linkage(group) })
      assertIds(await query('groups', { itemName: 'Visible item' }), [group])
    })
    it('checks target query permission even when no primary rows match', async () => {
      await assert.rejects(query('items', { groupName: 'Missing' }, { ...viewer, denyQueryScope: 'groups' }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
    })
    it('checks reference target query permission before matching rows', async () => {
      for (const [type, filters, deniedScope] of [
        ['items', { groupRef: 9999 }, 'groups'],
        ['notes', { subject_id: 9999 }, 'items'],
        ['notes', { subject_type: 'groups' }, 'groups']
      ]) await assert.rejects(query(type, filters, { ...viewer, denyQueryScope: deniedScope }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
    })
    it('keeps self-reference visibility correlated to the outer row', async () => {
      const descendant = await post('teams', 'Visible descendant', { parent: linkage(team) })
      const adapter = fixture.api.knex.helpers.getStorageAdapter('teams')
      await adapter.buildBaseQuery().where(adapter.getIdColumn(), descendant.id).update({ [adapter.translateColumn('parent_id')]: hiddenTeam.id })
      assertIds(await query('teams', { parent: hiddenTeam.id }), [])
      assertIds(await query('teams', { parent: null }), [team, descendant])
      assertIds(await query('teams', { parent: hiddenTeam.id }, admin), hiddenBy === 'policy' ? [descendant] : [])
      assertIds(await query('teams', { parent: hiddenTeam.id }), [])
    })
    for (const mode of ['cursor', 'offset']) {
      it(`paginates visible references in both directions (${mode})`, async () => {
        let params = { filters: { groupRefNot: null }, sort: ['id'], page: { size: 1, ...(mode === 'offset' ? { number: 1 } : {}) } }
        const pages = []
        for (let index = 0; index < 3; index++) {
          const page = await fixture.api.resources.items.query({ queryParams: params }, viewer)
          pages.push(page)
          if (mode === 'offset') assert.equal(page.meta.pagination.total, 2)
          if (!page.links.next) break
          params = parseJsonApiQuery(new URL(page.links.next, 'http://test.invalid').search.slice(1))
          assert(index < 2, 'Reference pagination must terminate')
        }
        assert.deepEqual(pages.flatMap(page => page.data.map(row => row.id)), [item.id, hiddenTeamItem.id])
        const previousParams = mode === 'offset'
          ? parseJsonApiQuery(new URL(pages[1].links.prev, 'http://test.invalid').search.slice(1))
          : { ...params, page: { size: 1, before: `id:${encodeURIComponent(hiddenTeamItem.id)}` } }
        const previous = await fixture.api.resources.items.query({ queryParams: previousParams }, viewer)
        assert.deepEqual(previous.data.map(row => row.id), [item.id])
      })
    }
    it('masks reference fields on joined and polymorphic search targets', async () => {
      assertIds(await query('items', { teamRef: hiddenTeam.id }), [])
      assertIds(await query('items', { teamRef: team.id }), [item])
      await post('notes', 'Visible group with hidden team', { subject: linkage(hiddenTeamGroup) })
      const result = await query('notes', { subjectTeamRef: hiddenTeam.id })
      assertIds(result, [])
      const visible = await query('notes', { subjectTeamRef: team.id })
      assert.deepEqual(visible.data.map(row => row.attributes.name), ['Visible subject'])
    })
    it('filters direct and nested polymorphic search targets', async () => {
      assertIds(await query('notes', { subjectName: 'Hidden group' }), [])
      const direct = await query('notes', { subjectName: 'Visible group' })
      assert.equal(direct.data[0].attributes.name, 'Visible subject')
      assert.equal(direct.meta.pagination.total, 1)
      const nested = await query('notes', { subjectTeam: 'Visible team' })
      assert.deepEqual(nested.data.map(row => row.attributes.name), ['Visible subject'])
      assert.equal(nested.meta.pagination.total, 1)
    })
    it('does not identify a hidden polymorphic target through a null attribute filter', async () => {
      const result = await query('notes', { subjectNote: null })
      assert.deepEqual(result.data.map(row => row.attributes.name), ['Visible subject', 'Hidden path'])
      assert.equal(result.meta.pagination.total, 2)
    })
    it('combines direct and nested polymorphic filters regardless of argument order', async () => {
      for (const filters of [
        { subjectName: 'Visible group', subjectTeam: 'Visible team' },
        { subjectTeam: 'Visible team', subjectName: 'Visible group' }
      ]) {
        const result = await query('notes', filters)
        assert.deepEqual(result.data.map(row => row.attributes.name), ['Visible subject'])
        assert.equal(result.meta.pagination.total, 1)
      }
    })
    it('uses the borrowed transaction for joined visibility and leaves its outcome to the caller', async () => {
      const transaction = await fixture.knex.transaction()
      try {
        const adapter = fixture.api.knex.helpers.getStorageAdapter('groups')
        await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), group.id).update({
          [adapter.translateColumn('access_group')]: 'group-b'
        })
        const result = await fixture.api.resources.items.query({ transaction, queryParams: { filters: { groupName: 'Visible group' }, page: { number: 1, size: 20 } } }, viewer)
        assertIds(result, [])
        const byReference = await fixture.api.resources.items.query({ transaction, queryParams: { filters: { groupRef: group.id }, page: { number: 1, size: 20 } } }, viewer)
        assertIds(byReference, [])
        assert.equal(transaction.isCompleted(), false)
      } finally { await transaction.rollback() }
      assertIds(await query('items', { groupName: 'Visible group' }), [item])
    })
    it('stores and filters scalar ID attributes and retains canonical slot positions after reload', async () => {
      const note = (await fixture.api.resources.notes.post({
        document: {
          data: {
            type: 'notes', attributes: { name: 'External seven', access_group: 'group-a', external_id: 7 }, relationships: { subject: linkage(group) }
          }
        }
      }, admin)).data
      for (const externalId of [7, '7']) assertIds(await query('notes', { external_id: externalId }), [note])
      if (fixture.api.anyapi) {
        const { registry, tenantId } = fixture.api.anyapi
        const descriptor = await registry.getDescriptor(tenantId, 'notes', { bypassCache: true })
        assert.equal(descriptor.fields.name.slot, 'string_1')
        assert.equal(descriptor.fields.subject_type.slot, 'string_5')
        assert.equal(descriptor.fields.subject_id.slot, 'string_6')
        assert.equal(descriptor.fields.external_id.slot, 'string_7')
        assert.equal(descriptor.fields.notes_key, undefined, 'the resource ID does not allocate an undeclared scalar attribute')
        await registry.registerResource({ tenant: tenantId, resource: 'notes', schema: descriptor.schema, relationships: descriptor.relationships, idProperty: descriptor.idProperty })
        const reloaded = await registry.getDescriptor(tenantId, 'notes', { bypassCache: true })
        assert.deepEqual(reloaded.fields, descriptor.fields)
        const stored = await fixture.api.knex.helpers.getStorageAdapter('notes').buildBaseQuery().where('logical_id', note.id).first()
        assert.equal(stored.string_5, 'groups')
        assert.equal(stored.string_6, group.id)
        assert.equal(stored.string_7, '7')
      }
      assertIds(await query('notes', { external_id: 7 }), [note])
    })
  })
}

for (const connector of ['express', 'fastify']) {
  describe(`Search HTTP authorization through ${connector} (${storageMode.mode})`, () => {
    let fixture, app, hiddenGroupId
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({ createApi: createSearchPolicyApi, apiOptions: { app, connector }, tables })
      await fixture.api.customize({
        hooks: {
          'transport:request': {
            functionName: 'search-http-viewer',
            handler: ({ context }) => { Object.assign(context, viewer, { denyQueryScope: context.transport.request.headers['x-target'] }) }
          },
          checkPermissions: {
            functionName: 'search-http-permission',
            handler: ({ context, scopeName }) => {
              if (context.method === 'query' && context.originalContext?.denyQueryScope === scopeName) throw new RestApiResourceError('Search target denied', { subtype: 'forbidden' })
            }
          }
        }
      })
      if (connector === 'fastify') await app.ready()
    })
    beforeEach(async () => {
      await fixture.reset()
      const group = (await fixture.api.resources.groups.post({
        document: {
          data: {
            type: 'groups', attributes: { name: 'Hidden group', access_group: 'group-b' }
          }
        }
      }, admin)).data
      hiddenGroupId = group.id
      for (const [type, relationship] of [['items', 'group'], ['notes', 'subject']]) {
        await fixture.api.resources[type].post({
          document: {
            data: {
              type, attributes: { name: 'Primary match', access_group: 'group-a' }, relationships: { [relationship]: linkage(group) }
            }
          }
        }, admin)
      }
    })
    after(async () => {
      try { if (connector === 'fastify') await app?.close() } finally { await fixture?.close() }
    })
    for (const [type, filter, value, expected, deniedScope, jsonValue] of [
      ['items', 'groupName', 'Hidden group', [], undefined],
      ['items', 'eitherName', 'Primary', ['Primary match'], undefined],
      ['notes', 'subjectName', 'Hidden group', [], undefined],
      ['items', 'groupRef', 'hidden-id', [], undefined],
      ['notes', 'subject_id', 'hidden-id', [], undefined],
      ['notes', 'subject_type', 'groups', [], undefined],
      ['items', 'groupRef', '9999', [], 'groups'],
      ['items', 'groupRef', 'null', ['Primary match'], undefined, true],
      ['notes', 'subject_type', 'null', ['Primary match'], undefined, true],
      ['items', 'groupRefs', '[]', [], undefined, true],
      ['items', 'groupName', 'Missing', [], 'groups'],
      ['items', 'teamName', 'Missing', [], 'teams'],
      ['notes', 'subjectTeam', 'Missing', [], 'teams']
    ]) {
      it(`${type} ${filter}${jsonValue ? '[json]' : ''} ${deniedScope ? `rejects denied ${deniedScope}` : 'respects joined visibility and counts'}`, async () => {
        const url = `/api/${type}?${new URLSearchParams({ [`filter[${filter}]${jsonValue ? '[json]' : ''}`]: value === 'hidden-id' ? hiddenGroupId : value, 'page[number]': '1', 'page[size]': '20' })}`
        const headers = deniedScope ? { 'x-target': deniedScope } : {}
        const response = connector === 'express' ? await request(app).get(url).set(headers) : await app.inject({ method: 'GET', url, headers })
        const body = connector === 'express' ? response.body : response.json()
        assert.equal(response.statusCode, deniedScope ? 403 : 200)
        if (deniedScope) {
          assert.equal(Object.hasOwn(body, 'data'), false)
          assert.equal(body.errors[0].detail, 'Search target denied')
        } else {
          assert.deepEqual(body.data.map(row => row.attributes.name), expected)
          assert.equal(body.meta.pagination.total, expected.length)
          for (const row of body.data) {
            for (const relationship of Object.values(row.relationships)) assert.equal(relationship.data, null)
            for (const field of ['group_id', 'subject_id', 'subject_type']) assert.equal(Object.hasOwn(row.attributes, field), false)
          }
        }
      })
    }
    it('rejects malformed typed filter input without returning data', async () => {
      const url = '/api/items?' + new URLSearchParams({ 'filter[groupRefs][json]': '[1,' })
      const response = connector === 'express' ? await request(app).get(url) : await app.inject({ method: 'GET', url })
      const body = connector === 'express' ? response.body : response.json()
      assert.equal(response.statusCode, 400)
      assert.equal(Object.hasOwn(body, 'data'), false)
      assert.deepEqual(body.errors[0].source, { parameter: 'filter[groupRefs][json]' })
    })
  })
}

describe('Regular reference column collation', () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'knex', createApi: createIdConformanceApi, apiOptions: { idType: 'string', referenceCollation: 'case-insensitive' } })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('preserves database collation when filtering a visible reference', async () => {
    const group = (await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id: 'Case-sensitive', attributes: { name: 'Group' } } } })).data
    const item = (await fixture.api.resources.items.post({ document: { data: { type: 'items', id: 'item', attributes: { name: 'Item' }, relationships: { group: linkage(group) } } } })).data
    const result = await fixture.api.resources.items.query({ queryParams: { filters: { group: 'case-sensitive' } } })
    assert.deepEqual(result.data.map(row => row.id), [item.id])
  })
})
