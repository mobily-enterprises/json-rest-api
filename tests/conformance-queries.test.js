import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi, createRowPolicyApi, seedQueryPolicyApi } from './fixtures/api-configs.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { createCursor } from '../plugins/core/lib/querying/knex-pagination-helpers.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const records = [
  { name: 'Gamma', rank: 2, note: 'odd', active: true },
  { name: 'Alpha', rank: 1, note: 'special', active: true },
  { name: 'alpha', rank: 1, note: '', active: false },
  { name: 'Beta', rank: null, note: null, active: true },
  { name: 'Alpha', rank: 0, note: 'other', active: false },
  { name: 'Void', rank: null, note: 'special', active: true }
]
const ids = result => result.data.map(record => record.id)
// The fixture uses SQLite's default LIKE, PostgreSQL C, or MySQL utf8mb4_bin.
const caseInsensitiveLike = databaseClient === 'better-sqlite3'

describe(`Shared query conformance (${storageMode.mode})`, () => {
  let fixture
  let items
  let nestedIds
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createQueryConformanceApi,
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
    })
    assert.equal(fixture.storage, storageMode.mode)
    items = fixture.api.resources.items
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'query-conformance-permissions',
          handler: ({ context, scopeName }) => {
            if (context.method === 'query' && context.originalContext?.denyQueryScope === scopeName) {
              throw new RestApiResourceError('Query denied', { subtype: 'forbidden' })
            }
          }
        },
        knexQueryFiltering: {
          functionName: 'query-conformance-row-filter',
          handler: ({ context }) => {
            const { scopeName, tableName, query, storageAdapter } = context.knexQuery
            if (context.hideQueryScope === scopeName) {
              query.whereNot(`${tableName}.${storageAdapter.translateColumn(context.hideQueryField)}`,
                storageAdapter.translateFilterValue(context.hideQueryField, context.hideQueryValue))
            }
          }
        },
        finishQuery: {
          functionName: 'query-conformance-nested-query',
          handler: async ({ context, scopeName }) => {
            if (scopeName === 'items' && context.nestedQueryProbe) {
              nestedIds = ids(await items.query({ queryParams: { page: { number: 1, size: 3 } } }, { ...context, nestedQueryProbe: false }))
            }
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    nestedIds = undefined
    await fixture.seed('groups', { name: 'First' })
    await fixture.seed('groups', { name: 'Other' })
    await fixture.seed('groups', { name: 'Empty' })
    for (const [index, record] of records.entries()) {
      await fixture.seed('items', { ...record, secret: 'Hidden' }, index < 5
        ? { group: { data: { type: 'groups', id: index < 4 ? '1' : '2' } } }
        : undefined)
    }
    await fixture.api.resources.groups.postRelationship({
      id: '1', relationshipName: 'members', relationshipData: ['4', '2', '6', '3'].map(id => ({ type: 'items', id }))
    })
    await fixture.api.resources.groups.postRelationship({
      id: '2', relationshipName: 'members', relationshipData: [{ type: 'items', id: '5' }]
    })
  })
  after(async () => { await fixture?.close() })

  const fromLink = (link, path) => {
    const url = new URL(link, 'https://api.example.test')
    assert.equal(url.pathname, path)
    return parseJsonApiQuery(url.search.slice(1))
  }

  for (const format of ['jsonapi', 'plain']) {
    for (const [filters, expected] of [
      [{ name: 'Alpha' }, ['5', '2']],
      [{ nameContains: 'ph' }, ['5', '2', '3']],
      [{ nameStarts: 'Al' }, caseInsensitiveLike ? ['5', '2', '3'] : ['5', '2']],
      [{ nameEnds: 'ma' }, ['1']],
      [{ above: 0 }, ['2', '3', '1']],
      [{ range: [0, 1] }, ['5', '2', '3']],
      [{ ranks: [0, 2] }, ['5', '1']],
      [{ ranks: [] }, []],
      [{ rank: null }, ['4', '6']],
      [{ otherRank: null }, ['5', '2', '3', '1']],
      [{ otherRank: 1 }, ['5', '1']],
      [{ eitherText: 'special' }, ['2', '6']],
      [{ allWords: 'Alpha,other' }, ['5']],
      [{ anyWords: 'Gamma,special' }, ['2', '1', '6']],
      [{ relatedWords: 'Void,First' }, ['2', '3', '1', '4', '6']],
      [{ relatedAllWords: 'Alpha,First' }, caseInsensitiveLike ? ['2', '3'] : ['2']],
      [{ eitherRange: [-1, 0] }, ['5', '2', '3', '1', '4', '6']],
      [{ customRank: 1 }, ['2', '3', '1']],
      [{ active: false, ranks: [0, 1] }, ['5', '3']],
      [{ name: "x' OR 1=1 --" }, []]
    ]) {
      it(`filters ${JSON.stringify(filters)} with matching counts (${format})`, async () => {
        const result = await items.query({ format, queryParams: { filters, page: { number: 1, size: 3 } } })
        assert.deepEqual(ids(result), expected.slice(0, 3))
        assert.equal(result.meta.pagination.total, expected.length)
      })
    }

    it(`uses default limits and sparse projections without exposing dependencies (${format})`, async () => {
      const result = await items.query({ format, queryParams: { fields: { items: 'displayName' } } })
      assert.deepEqual(ids(result), ['5', '2'])
      for (const record of result.data) {
        const actual = format === 'plain' ? record : record.attributes
        assert.equal(actual.displayName, 'alpha ·')
        for (const key of ['name', 'rank', 'doubleRank', 'secret', 'privateRank', 'internalRank']) assert.equal(actual[key], undefined)
      }
      const selected = await items.get({ id: '2', format, queryParams: { fields: { items: 'internalRank,privateRank' } } })
      const actual = format === 'plain' ? selected : selected.data.attributes
      assert.equal(actual.internalRank, 1)
      assert.equal(actual.privateRank, undefined)
    })

    it(`counts distinct parents when several children match a filter (${format})`, async () => {
      const first = await fixture.api.resources.groups.query({ format, queryParams: { filters: { childName: 'Alpha' }, page: { number: 1, size: 1 } } })
      assert.deepEqual(ids(first), ['1'])
      assert.equal(first.meta.pagination.total, 2)
      assert.equal(first.meta.pagination.pageCount, 2)
      const second = await fixture.api.resources.groups.query({ format, queryParams: fromLink(first.links.next, '/groups') })
      assert.deepEqual(ids(second), ['2'])
      assert.equal(second.links.next, undefined)
    })

    for (const sort of ['sortLabel', '-sortLabel']) {
      it(`orders distinct parents by bound nullable projection ${sort} with sparse pages (${format})`, async () => {
        const groups = fixture.api.resources.groups
        await groups.patch({ id: '3', format: 'plain', inputRecord: { name: 'Other' } })
        await items.patch({ id: '6', format: 'plain', inputRecord: { name: 'Alpha', group: '3' } })
        const params = { sort: [sort], filters: { childName: 'Alpha' }, fields: { groups: 'name' } }
        const counted = await groups.query({ format, queryParams: { ...params, page: { number: 1, size: 1 } } })
        assert.equal(counted.meta.pagination.total, 3)
        assert.deepEqual(ids(counted), ['2'])
        let queryParams = { ...params, page: { size: 1 } }
        const seen = []
        for (let page = 0; page < 4; page++) {
          const result = await groups.query({ format, queryParams })
          seen.push(...ids(result))
          for (const row of result.data) assert.equal((format === 'plain' ? row : row.attributes).sortLabel, undefined)
          if (!result.links.next) break
          queryParams = fromLink(result.links.next, '/groups')
          assert(page < 3, 'Distinct cursor traversal must terminate')
        }
        assert.deepEqual(seen, ['2', '3', '1'])
        queryParams = { ...params, page: { size: 1, before: createCursor({ id: '1', sortLabel: null }, ['sortLabel', 'id']) } }
        const reversed = []
        for (let page = 0; page < 3; page++) {
          const result = await groups.query({ format, queryParams })
          reversed.unshift(...ids(result))
          if (!result.links.next) break
          queryParams = fromLink(result.links.next, '/groups')
          assert(page < 2, 'Distinct backward traversal must terminate')
        }
        assert.deepEqual(reversed, ['2', '3'])
      })
    }

    for (const mode of ['cursor', 'offset']) {
      it(`follows ${mode} links through a filter that joins related resources (${format})`, async () => {
        let queryParams = { filters: { relatedWords: 'Void,First' }, fields: { items: 'name' }, page: { size: 2, ...(mode === 'offset' ? { number: 1 } : {}) } }
        const collected = []
        for (let index = 0; index < 4; index++) {
          const result = await items.query({ format, queryParams })
          collected.push(...ids(result))
          if (mode === 'offset') assert.equal(result.meta.pagination.total, 5)
          if (!result.links.next) break
          queryParams = fromLink(result.links.next, '/items')
          assert.equal(queryParams.filters.relatedWords, 'Void,First')
          assert(index < 3, 'Joined traversal must terminate')
        }
        assert.deepEqual(collected, ['2', '3', '1', '4', '6'])
      })
    }

    for (const [sort, expected] of [
      [['doubleRank'], ['5', '2', '3', '1', '4', '6']],
      [['-doubleRank'], ['1', '2', '3', '5', '4', '6']],
      [['displayName', '-rank'], ['2', '3', '5', '4', '1', '6']]
    ]) {
      for (const mode of ['cursor', 'offset']) {
        it(`traverses ${mode} links for ${sort.join(',')} and capped sparse pages (${format})`, async () => {
          let queryParams = { sort, fields: { items: 'name' }, page: { size: 100, ...(mode === 'offset' ? { number: 1 } : {}) } }
          const collected = []
          for (let index = 0; index < 4; index++) {
            const result = await items.query({ format, queryParams })
            assert.equal(result.meta.pagination.pageSize, 3)
            collected.push(...ids(result))
            for (const record of result.data) {
              const actual = format === 'plain' ? record : record.attributes
              assert.equal(actual.doubleRank, undefined)
              assert.equal(actual.displayName, undefined)
            }
            if (!result.links.next) break
            queryParams = fromLink(result.links.next, '/items')
            assert.equal(queryParams.page.size, 3)
            assert.equal(queryParams.fields.items, 'name')
            assert(index < 3, 'Traversal must terminate')
          }
          assert.deepEqual(collected, expected)
        })
      }
    }

    it(`keeps projection input out of storage and rejects invalid query fields (${format})`, async () => {
      const attributes = { name: 'Created', rank: 3, displayName: 'Injected' }
      const result = await items.post({
        format,
        inputRecord: format === 'plain' ? { id: '100', ...attributes } : { data: { ...createJsonApiDocument('items', attributes).data, id: '100' } }
      })
      assert.equal(format === 'plain' ? result.displayName : result.data.attributes.displayName, 'created ·')
      for (const queryParams of [
        { filters: { range: [] } },
        { filters: { range: [1] } },
        { filters: { range: [0, 1, 2] } },
        { filters: { range: [null, 1] } },
        { filters: { displayName: 'alpha ·' } },
        { sort: ['privateRank'] },
        { sort: ['missing'] },
        { fields: { items: 'missing' } },
        { include: ['missing'] }
      ]) {
        await assert.rejects(items.query({ format, queryParams }), error => {
          assert.match(error.code, /^REST_API_(VALIDATION|FIELDSET_INVALID|INCLUDE_INVALID)$/)
          return true
        }, JSON.stringify(queryParams))
      }
    })

    it(`rejects unknown include paths even when matching collections are empty (${format})`, async () => {
      for (const path of ['missing', 'name', 'group.missing', 'group.items.missing', '__proto__', 'constructor', 'toString']) {
        const queryParams = { include: [path] }
        const expected = { code: 'REST_API_INCLUDE_INVALID', statusCode: 400, details: { path, resourceType: 'items' } }
        await assert.rejects(items.get({ id: '1', format, queryParams }), expected)
        await assert.rejects(items.query({ format, queryParams: { ...queryParams, filters: { name: 'Absent' } } }), expected)
        await assert.rejects(fixture.api.resources.groups.getRelated({ id: '3', relationshipName: 'members', format, queryParams }), expected)
      }
      const empty = await items.query({ format, queryParams: { include: ['group.items.group'], filters: { name: 'Absent' } } })
      assert.deepEqual(empty.data, [])
      await assert.rejects(items.getRelated({ id: '6', relationshipName: 'group', format, queryParams: { include: ['missing'] } }), {
        code: 'REST_API_INCLUDE_INVALID', statusCode: 400
      })
      const emptyGroup = await items.getRelated({ id: '6', relationshipName: 'group', format, queryParams: { include: ['items.group'] } })
      assert.equal(format === 'plain' ? emptyGroup : emptyGroup.data, null)
    })

    for (const kind of ['hasMany', 'manyToMany']) {
      const relationshipName = kind === 'hasMany' ? 'items' : 'members'
      const expected = kind === 'hasMany' ? ['2', '3', '1', '4'] : ['2', '3', '4', '6']
      const related = queryParams => fixture.api.resources.groups.getRelated({ id: '1', relationshipName, format, queryParams })

      it(`applies target filters, sparse fields and includes to ${kind} collections (${format})`, async () => {
        const result = await related({
          filters: { active: false }, fields: { items: 'name,doubleRank,group', groups: 'name' }, include: ['group'], page: { number: 1, size: 1 }
        })
        assert.deepEqual(ids(result), ['3'])
        assert.equal(result.meta.pagination.total, 1)
        const record = result.data[0]
        assert.equal(format === 'plain' ? record.doubleRank : record.attributes.doubleRank, 2)
        assert.equal(format === 'plain' ? record.group.name : result.included.find(entry => entry.type === 'groups').attributes.name, 'First')
      })

      for (const mode of ['cursor', 'offset']) {
        it(`traverses ${kind} ${mode} pages within the parent (${format})`, async () => {
          let queryParams = { sort: ['doubleRank'], fields: { items: 'name' }, page: { size: 2, ...(mode === 'offset' ? { number: 1 } : {}) } }
          const collected = []
          for (let index = 0; index < 4; index++) {
            const result = await related(queryParams)
            collected.push(...ids(result))
            assert.equal(result.meta.pagination.pageSize, 2)
            if (mode === 'offset') assert.equal(result.meta.pagination.total, 4)
            if (!result.links.next) break
            queryParams = fromLink(result.links.next, `/groups/1/${relationshipName}`)
            assert.deepEqual(Object.keys(queryParams.filters || {}), [])
            assert(index < 3, 'Related traversal must terminate')
          }
          assert.deepEqual(collected, expected)
        })
      }
    }

    it(`reads both orientations of many-to-many links and empty parents (${format})`, async () => {
      await items.postRelationship({ id: '1', relationshipName: 'collections', relationshipData: [{ type: 'groups', id: '2' }] })
      const parents = await items.getRelated({ id: '2', relationshipName: 'collections', format })
      assert.deepEqual(ids(parents), ['1'])
      const members = await fixture.api.resources.groups.getRelated({ id: '2', relationshipName: 'members', format })
      assert.deepEqual(ids(members), ['5', '1'])
      const empty = await fixture.api.resources.groups.getRelated({ id: '3', relationshipName: 'members', format, queryParams: { page: { number: 1 } } })
      assert.deepEqual(empty.data, [])
      assert.equal(empty.meta.pagination.total, 0)
    })

    it(`honors target permissions and row filters in many-to-many counts (${format})`, async () => {
      const params = { id: '1', relationshipName: 'members', format, queryParams: { page: { number: 1, size: 3 } } }
      await assert.rejects(fixture.api.resources.groups.getRelated(params, { denyQueryScope: 'items' }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
      const result = await fixture.api.resources.groups.getRelated(params, {
        hideQueryScope: 'items', hideQueryField: 'id', hideQueryValue: '2'
      })
      assert.deepEqual(ids(result), ['3', '4', '6'])
      assert.equal(result.meta.pagination.total, 3)
    })

    it(`keeps many-to-many membership out of nested independent queries (${format})`, async () => {
      const result = await fixture.api.resources.groups.getRelated({ id: '1', relationshipName: 'members', format }, { nestedQueryProbe: true })
      assert.deepEqual(ids(result), ['2', '3'])
      assert.deepEqual(nestedIds, ['5', '2', '3'])
    })

    it(`reads uncommitted many-to-many changes and leaves rollback to the caller (${format})`, async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      const params = { id: '1', relationshipName: 'members' }
      try {
        await fixture.api.resources.groups.postRelationship({ ...params, transaction, relationshipData: [{ type: 'items', id: '5' }] })
        const result = await fixture.api.resources.groups.getRelated({ ...params, transaction, format, queryParams: { page: { number: 1, size: 3 } } })
        assert.deepEqual(ids(result), ['5', '2', '3'])
        assert.equal(result.meta.pagination.total, 5)
        assert.equal(transaction.isCompleted(), false)
      } finally { await unit.rollback() }
      const result = await fixture.api.resources.groups.getRelated({ ...params, format, queryParams: { page: { number: 1, size: 3 } } })
      assert.deepEqual(ids(result), ['2', '3', '4'])
      assert.equal(result.meta.pagination.total, 4)
    })

    it(`does not add SQL round trips for each many-to-many member (${format})`, async () => {
      const related = size => fixture.api.resources.groups.getRelated({
        id: '1', relationshipName: 'members', format, queryParams: { page: { number: 1, size } }
      })
      await related(1)
      const statements = []
      const capture = query => statements.push(query.sql)
      fixture.knex.on('query', capture)
      try {
        assert.equal((await related(1)).data.length, 1)
        const singleCount = statements.length
        statements.length = 0
        assert.equal((await related(3)).data.length, 3)
        assert(singleCount > 0)
        assert.equal(statements.length, singleCount)
      } finally { fixture.knex.off('query', capture) }
    })

    if (storageMode.mode === 'knex') {
      it(`retains pivot-resource permission and filter hooks (${format})`, async () => {
        const params = { id: '1', relationshipName: 'members', format, queryParams: { page: { number: 1, size: 3 } } }
        await assert.rejects(fixture.api.resources.groups.getRelated(params, { denyQueryScope: 'memberships' }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
        const result = await fixture.api.resources.groups.getRelated(params, {
          hideQueryScope: 'memberships', hideQueryField: 'itemId', hideQueryValue: '2'
        })
        assert.deepEqual(ids(result), ['3', '4', '6'])
        assert.equal(result.meta.pagination.total, 3)
      })
    }

    it(`returns many-to-many members once despite duplicate physical links (${format})`, async () => {
      const { knex, api } = fixture
      if (api.anyapi) {
        const row = await knex('any_links').where({ tenant_id: api.anyapi.tenantId }).first()
        const { id, ...duplicate } = row
        assert.ok(id)
        await knex('any_links').insert(duplicate)
      } else {
        await knex('conformance_memberships').insert({ parent_key: 1, child_key: 2 })
      }
      const result = await api.resources.groups.getRelated({
        id: '1', relationshipName: 'members', format, queryParams: { sort: ['rank'], page: { number: 1, size: 3 } }
      })
      assert.deepEqual(ids(result), ['2', '3', '4'])
      assert.equal(result.meta.pagination.total, 4)
    })
  }
})

describe(`Related collection query scaling (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createRowPolicyApi,
      apiOptions: { polymorphic: true },
      tables: { pivots: 'row_policy_project_tasks', tasks: 'row_policy_tasks', projects: 'row_policy_projects', broken: 'row_policy_broken' }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    it(`keeps round trips constant for 2, 10 and 40 visible members (${format})`, async () => {
      const { viewer, project, subject, visible } = await seedQueryPolicyApi(fixture.api, 40)
      for (const relationshipName of ['tasks', 'shared_tasks']) {
        for (const include of [[], ['subject']]) {
          let baseline
          for (const size of [2, 10, 40]) {
            let statements = 0
            let metadata = 0
            const capture = ({ sql }) => {
              statements++
              if (/any_(resource|field|relationship)_configs/.test(sql)) metadata++
            }
            fixture.knex.on('query', capture)
            let result
            try {
              result = await fixture.api.resources.policy_projects.getRelated({
                id: project.id,
                relationshipName,
                format,
                queryParams: {
                  sort: ['title'],
                  page: { number: 1, size },
                  include,
                  fields: { policy_tasks: 'title,subject', policy_projects: 'name' }
                }
              }, viewer)
            } finally { fixture.knex.off('query', capture) }
            assert.equal(metadata, 0)
            assert.ok(statements > 0)
            baseline ??= statements
            assert.equal(statements, baseline, `${relationshipName}, include=${include}, size=${size}`)
            assert.deepEqual(ids(result), visible.slice(0, size).map(row => row.id))
            assert.equal(result.meta.pagination.total, 40)
            assert.equal(new URL(result.links.self, 'http://api.test').pathname, `/policy_projects/${project.id}/${relationshipName}`)
            for (const [index, row] of result.data.entries()) {
              const target = index % 2 === 0 ? project : subject
              if (format === 'jsonapi') {
                assert.deepEqual(Object.keys(row.attributes), ['title'])
                assert.deepEqual(row.relationships.subject.data, { type: target.type, id: target.id })
              } else {
                assert.equal(row.project, undefined)
                assert.equal(row.access_group, undefined)
                assert.equal(row.subject.id, target.id)
                if (include.length) assert.equal(row.subject.name ?? row.subject.title, target.attributes.name ?? target.attributes.title)
              }
            }
            if (format === 'jsonapi' && include.length) {
              assert.deepEqual(result.included.map(row => `${row.type}:${row.id}`).sort(), [project, subject].map(row => `${row.type}:${row.id}`).sort())
            }
          }
        }
      }
    })
  }
})

describe(`Disabled pagination counts (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createQueryConformanceApi,
      apiOptions: { counts: false },
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
    })
    assert.equal(fixture.storage, storageMode.mode)
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('honors false at plugin level without issuing a count query', async () => {
    await fixture.seed('items', { name: 'One' })
    const queries = []
    const capture = query => queries.push(query.sql)
    fixture.knex.on('query', capture)
    try {
      const result = await fixture.api.resources.items.query({ queryParams: { page: { number: 1, size: 1 } } })
      assert.equal(result.meta.pagination.total, undefined)
      assert.equal(result.meta.pagination.pageCount, undefined)
      assert.equal(queries.some(sql => /count\s*\(/i.test(sql)), false)
    } finally { fixture.knex.off('query', capture) }
  })
})
