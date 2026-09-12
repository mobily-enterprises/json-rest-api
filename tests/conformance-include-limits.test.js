import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const viewer = { hideRows: true }
const relation = (type, id) => ({ data: { type, id } })
const configurations = [
  { strategy: 'window', limit: 1, orderBy: ['name'] },
  { strategy: 'window', limit: 2, orderBy: ['-name'] },
  { strategy: 'standard', limit: 1, orderBy: ['name'] },
  { strategy: 'standard', limit: 2, orderBy: ['-name'] }
]

async function seedIncludeLimits (fixture) {
  const post = async (type, id, name, relationships = {}) => fixture.api.resources[type].post({ document: { data: { type, id, attributes: { name }, relationships } } })
  await fixture.reset()
  for (const type of ['groups', 'items']) {
    await post(type, '100', 'Parent')
    await post(type, '200', 'Parent')
  }
  for (const [id, name, parent] of [
    ['101', 'Hidden first', '100'], ['102', 'Visible Z', '100'], ['103', 'Visible A', '100'],
    ['201', 'Hidden second', '200'], ['202', 'Visible B', '200'], ['203', 'Visible C', '200']
  ]) await post('items', id, name, { group: relation('groups', parent), subject: relation('groups', parent) })
  for (const [id, name] of [['101', 'Visible B'], ['102', 'Visible A'], ['103', 'Visible C'], ['900', 'Hidden target']]) await post('groups', id, name)
  for (const [parent, children] of [['100', ['900', '101', '102']], ['200', ['900', '101', '103']]]) {
    await fixture.api.resources.items.postRelationship({ id: parent, relationshipName: 'groups', relationshipData: children.map(id => ({ type: 'groups', id })) })
  }
}

for (const connector of ['express', 'fastify']) {
  describe(`Include limit HTTP through ${connector} (${storageMode.mode})`, () => {
    let fixture, app
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      const include = { strategy: 'window', limit: 1, orderBy: ['displayName'] }
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables,
        apiOptions: {
          app,
          connector,
          collectionInclude: include,
          manyToManyInclude: include,
          includeProjection: true,
          resourcePolicy: ({ query, context, column }) => {
            if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
            return true
          }
        }
      })
      await fixture.api.customize({ hooks: { 'transport:request': { functionName: 'include-limit-viewer', handler: ({ context }) => { context.hideRows = true } } } })
      if (connector === 'fastify') await app.ready()
    })
    beforeEach(async () => { await seedIncludeLimits(fixture) })
    after(async () => {
      try { if (connector === 'fastify') await app?.close() } finally { await fixture?.close() }
    })
    for (const [type, relationship, target] of [['groups', 'items', 'items'], ['groups', 'mentions', 'items'], ['items', 'groups', 'groups']]) {
      it(`limits visible ${type}.${relationship} with sparse query projections`, async () => {
        const url = `/api/${type}?filter[name]=Parent&include=${relationship}&fields[${target}]=name,displayName`
        const response = connector === 'express' ? await request(app).get(url) : await app.inject({ method: 'GET', url })
        const body = connector === 'express' ? response.body : response.json()
        assert.equal(response.statusCode, 200)
        assert.deepEqual(body.data.map(row => row.id), ['100', '200'])
        const expected = relationship === 'groups' ? ['102', '101'] : ['103', '202']
        assert.deepEqual(body.data.map(row => row.relationships[relationship].data.map(child => child.id)), expected.map(id => [id]))
        assert.equal(body.included.length, 2)
        for (const row of body.included) {
          assert.ok(row.attributes.name.startsWith('Visible'))
          assert.equal(row.attributes.displayName, row.attributes.name.toUpperCase())
        }
      })
    }
  })
}

for (const strategy of ['standard', 'window']) {
  for (const limit of [0, null]) {
    describe(`Include ${strategy} limit ${limit} (${storageMode.mode})`, () => {
      let fixture
      before(async () => {
        fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { collectionInclude: { strategy, limit } } })
      })
      beforeEach(async () => {
        await fixture.reset()
        await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id: '100', attributes: { name: 'Parent' } } } })
        for (let id = 10; id < 32; id++) {
          await fixture.api.resources.items.post({
            document: {
              data: {
                type: 'items', id: String(id), attributes: { name: `Child ${id}` }, relationships: { group: relation('groups', '100') }
              }
            }
          })
        }
      })
      after(async () => { await fixture?.close() })
      it('returns the declared cardinality even beyond the target default limit', async () => {
        const result = await fixture.api.resources.groups.get({ id: '100', queryParams: { include: ['items'] } })
        const expected = limit === 0 ? [] : Array.from({ length: 22 }, (_, index) => String(index + 10))
        assert.deepEqual(result.data.relationships.items.data.map(row => row.id), expected)
        assert.deepEqual((result.included || []).map(row => row.id), expected)
      })
    })
  }
}

describe(`Reference visibility inside limited includes (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables,
      apiOptions: {
        collectionInclude: { strategy: 'window', limit: 2, orderBy: ['group'] },
        resourcePolicy: ({ query, context, column }) => {
          if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
          return true
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    for (const [id, name] of [['100', 'Parent'], ['900', 'Hidden group']]) await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id, attributes: { name } } } })
    for (const [id, group] of [['101', null], ['102', '900'], ['103', '100']]) {
      await fixture.api.resources.items.post({
        document: {
          data: {
            type: 'items',
            id,
            attributes: { name: `Child ${id}` },
            relationships: { subject: relation('groups', '100'), ...(group ? { group: relation('groups', group) } : {}) }
          }
        }
      })
    }
  })
  after(async () => { await fixture?.close() })
  it('sorts hidden references with nulls before selecting a parent subset', async () => {
    const result = await fixture.api.resources.groups.get({ id: '100', queryParams: { include: ['mentions'], fields: { items: 'name' } } }, viewer)
    assert.deepEqual(result.data.relationships.mentions.data.map(row => row.id), ['103', '101'])
    assert.deepEqual(result.included.map(row => row.id), ['103', '101'])
    assert.equal(JSON.stringify(result).includes('900'), false)
    assert.equal(JSON.stringify(result).includes('__jra_'), false)
  })
})

for (const include of configurations) {
  for (const projection of [false, true]) {
    describe(`Include limits ${include.strategy}/${include.limit}, projection ${projection} (${storageMode.mode})`, () => {
      let fixture
      before(async () => {
        const config = projection ? { ...include, orderBy: include.orderBy.map(field => field.replace('name', 'displayName')) } : include
        fixture = await createConformanceFixture({
          createApi: createIdConformanceApi,
          tables,
          apiOptions: {
            collectionInclude: config,
            manyToManyInclude: config,
            includeProjection: projection,
            resourcePolicy: ({ query, context, column }) => {
              if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
              return true
            }
          }
        })
      })
      beforeEach(async () => {
        await seedIncludeLimits(fixture)
      })
      after(async () => { await fixture?.close() })

      for (const [type, relationship, target] of [['groups', 'items', 'items'], ['groups', 'mentions', 'items'], ['items', 'groups', 'groups']]) {
        for (const format of ['jsonapi', 'plain']) {
          it(`orders and limits visible ${type}.${relationship} using ${include.strategy} (${format})`, async () => {
            let expected = relationship === 'groups'
              ? (include.limit === 1 ? { 100: ['102'], 200: ['101'] } : { 100: ['101', '102'], 200: ['103', '101'] })
              : (include.limit === 1 ? { 100: ['103'], 200: ['202'] } : { 100: ['102', '103'], 200: ['203', '202'] })
            if (include.strategy === 'standard') {
              expected = relationship === 'groups'
                ? (include.limit === 1 ? { 100: ['102'], 200: [] } : { 100: ['101'], 200: ['103', '101'] })
                : (include.limit === 1 ? { 100: ['103'], 200: [] } : { 100: ['102'], 200: ['203'] })
            }
            const result = await fixture.api.resources[type].query({
              format,
              queryParams: {
                filters: { name: 'Parent' },
                include: [relationship],
                fields: projection ? { [target]: 'name,displayName' } : undefined
              }
            }, viewer)
            assert.deepEqual(result.data.map(row => row.id), ['100', '200'])
            for (const row of result.data) {
              const children = format === 'jsonapi' ? row.relationships[relationship].data : row[relationship]
              assert.deepEqual(children.map(child => child.id), expected[row.id])
              if (format === 'plain') for (const child of children) assert.ok(child.name.startsWith('Visible'))
            }
            if (format === 'jsonapi') {
              assert.deepEqual(result.included.map(row => row.id).sort(), [...new Set(Object.values(expected).flat())].sort())
              for (const row of result.included) {
                assert.ok(row.attributes.name.startsWith('Visible'))
                if (projection) assert.equal(row.attributes.displayName, row.attributes.name.toUpperCase())
              }
            }
            assert.equal(JSON.stringify(result).includes('__jra_'), false)
            assert.equal(JSON.stringify(result).includes('jsonrestapi_rn'), false)
          })
        }
      }
      it('deduplicates physical links before applying the include limit', async () => {
        if (fixture.storage === 'anyapi') {
          const row = { ...await fixture.knex('any_links').where({ left_id: '100', right_id: '102' }).first() }
          delete row.id
          await fixture.knex('any_links').insert(row)
        } else {
          await fixture.api.resources.memberships.post({
            document: {
              data: {
                type: 'memberships', relationships: { item: relation('items', '100'), group: relation('groups', '102') }
              }
            }
          })
        }
        const result = await fixture.api.resources.items.get({ id: '100', queryParams: { include: ['groups'] } }, viewer)
        assert.deepEqual(result.data.relationships.groups.data.map(row => row.id), include.limit === 1 ? ['102'] : ['101', '102'])
      })
      it('uses the caller transaction before choosing limited children', async () => {
        const transaction = await fixture.knex.transaction()
        try {
          const adapter = fixture.api.knex.helpers.getStorageAdapter('items')
          await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '103').update({ [adapter.translateColumn('name')]: 'Hidden changed' })
          const result = await fixture.api.resources.groups.get({ id: '100', transaction, queryParams: { include: ['items'] } }, viewer)
          assert.deepEqual(result.data.relationships.items.data.map(row => row.id), ['102'])
          assert.equal(transaction.isCompleted(), false)
        } finally { await transaction.rollback() }
        assert.equal((await fixture.api.resources.items.get({ id: '103' })).data.attributes.name, 'Visible A')
      })
    })
  }
}
