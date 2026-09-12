import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedCanonicalLinkRows, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

// Always canonical storage: both runner invocations exercise the same physical link table.
for (const direction of ['unpaired', 'forward', 'inverse']) {
  describe(`Canonical link prefetch pages, ${direction}`, () => {
    let fixture, template, targetColumn, parentColumn
    const ownerType = direction === 'forward' ? 'groups' : 'items'
    const targetType = direction === 'forward' ? 'items' : 'groups'
    const relationship = direction === 'forward' ? 'members' : 'groups'
    const size = 205
    const isPrefetch = ({ sql }) => /^select (?:["`]id["`], )?["`]relationship["`], ["`]inverse_relationship["`]/.test(sql)
    before(async () => {
      fixture = await createConformanceFixture({
        storage: 'anyapi',
        createApi: createIdConformanceApi,
        tables: { links: 'any_links', records: 'any_records' },
        apiOptions: {
          queryMaxLimit: size,
          inverseMembership: direction !== 'unpaired',
          manyToManyInclude: { limit: null, orderBy: ['id'] },
          resourcePolicy: ({ query, context, column }) => {
            if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
            if (context.hideAll && context.scopeName === targetType) query.whereRaw('1 = 0')
            return true
          }
        }
      })
      await fixture.api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'linkage-allocation-permissions',
            handler: ({ context, scopeName }) => {
              const request = context.originalContext
              if (scopeName === targetType && context.method === 'query' && request?.denyLinkage) throw new RestApiResourceError('Target query denied', { subtype: 'forbidden' })
            }
          },
          knexQueryFiltering: {
            functionName: 'linkage-allocation-filter-builder',
            handler: ({ context, scopeName }) => {
              if (scopeName !== targetType || context.knexQuery?.queryPurpose !== 'relationship-identifiers' || !context.linkageProbe) return
              context.linkageProbe.push({ auth: context.auth, transaction: context.transaction, filters: context.queryParams?.filters, linkQuery: context.knexQuery.query.toSQL().sql.includes('any_links') })
              context.knexQuery.query = context.knexQuery.query.clone()
            }
          }
        }
      })
    })
    const seed = async (type, records) => {
      for (let offset = 0; offset < records.length; offset += 100) await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records.slice(offset, offset + 100))
    }
    const linkRow = (id, parent = '100000') => {
      const row = { ...template, [targetColumn]: id, [parentColumn]: parent }
      if (direction !== 'unpaired' && Number(id) % 2 === 0) {
        return { ...row, relationship: row.inverse_relationship, inverse_relationship: row.relationship, left_resource: row.right_resource, left_id: row.right_id, right_resource: row.left_resource, right_id: row.left_id }
      }
      return row
    }
    beforeEach(async () => {
      await fixture.reset()
      await seed(ownerType, [{ id: '100000', name: 'Parent' }, { id: '100001', name: 'Parent' }, { id: '1', name: 'Wrong target type' }])
      await seed(targetType, Array.from({ length: size }, (_, i) => ({ id: String(i + 1), name: `${(i + 1) % 100 ? 'Target' : 'Hidden'} ${i + 1}` })))
      await fixture.api.anyapi.links.attachMany({ scopeName: ownerType, relName: relationship, relData: [{ type: targetType, id: '1' }], context: { id: '100000', db: fixture.knex } })
      const { id, ...row } = await fixture.knex('any_links').first()
      template = row
      targetColumn = row.left_resource === targetType ? 'left_id' : 'right_id'
      parentColumn = targetColumn === 'left_id' ? 'right_id' : 'left_id'
      await seedCanonicalLinkRows(fixture.knex, Array.from({ length: size - 1 }, (_, i) => linkRow(String(i + 2))))
      await seedCanonicalLinkRows(fixture.knex, [linkRow('1', '100001')])
    })
    after(async () => { await fixture?.close() })
    const measured = async operation => {
      const reads = []
      const capture = (rows, query) => { if (isPrefetch(query)) reads.push({ rows: rows.length, bindings: query.bindings.length }) }
      fixture.knex.on('query-response', capture)
      try { return { value: await operation(), reads } } finally { fixture.knex.off('query-response', capture) }
    }
    const fetch = (parentIds, transaction) => fixture.api.anyapi.links.fetchManyToManyRows({ scopeName: ownerType, relName: relationship, parentIds, context: { transaction } })
    const get = (params = {}, context) => fixture.api.resources[ownerType].get({ id: '100000', format: 'jsonapi', ...params }, context)
    const measureVisible = async (operation, reads = []) => {
      const capture = (rows, query) => {
        if (Array.isArray(rows) && query.sql.includes('any_links') && (isPrefetch(query) || / as ["`]childId["`]/.test(query.sql))) reads.push(rows.length)
      }
      fixture.knex.on('query-response', capture)
      try { return { value: await operation(), reads } } finally { fixture.knex.off('query-response', capture) }
    }

    it('fetches only visible linkage for sparse GET/query in both formats', async () => {
      for (const hideAll of [false, true]) {
        for (const format of ['jsonapi', 'plain']) {
          for (const method of ['get', 'query']) {
            const linkageProbe = []
            const auth = { user: 'reader' }
            const { value, reads } = await measureVisible(() => fixture.api.resources[ownerType][method]({
              ...(method === 'get' ? { id: '100000' } : {}),
              format,
              queryParams: { fields: { [ownerType]: relationship }, ...(method === 'query' ? { filters: { name: 'Parent' }, sort: ['id'] } : {}) }
            }, { hideRows: true, hideAll, linkageProbe, auth }))
            const parents = method === 'query' ? value.data : [format === 'jsonapi' ? value.data : value]
            let count = 0
            for (const parent of parents) {
              const actual = format === 'jsonapi' ? parent.relationships[relationship].data : parent[relationship]
              const expected = hideAll ? [] : parent.id === '100000' ? Array.from({ length: size }, (_, i) => String(i + 1)).filter(id => Number(id) % 100) : ['1']
              assert.deepEqual(actual.map(row => row.id).sort(), expected.sort())
              count += expected.length
            }
            assert.equal(reads.reduce((total, rows) => total + rows, 0), count)
            assert.ok(reads.every(rows => rows <= 101))
            assert.equal(linkageProbe.length, 1)
            assert.equal(linkageProbe[0].auth, auth)
            assert.equal(linkageProbe[0].transaction, undefined)
            assert.equal(linkageProbe[0].filters, undefined)
          }
        }
      }
    })

    it('filters linkage endpoint rows before returning them from storage', async () => {
      for (const hideAll of [false, true]) {
        for (const method of ['getRelationship', 'listMany']) {
          const linkageProbe = []
          const context = { hideRows: true, hideAll, linkageProbe }
          const { value, reads } = await measureVisible(() => method === 'listMany'
            ? fixture.api.anyapi.links.listMany({ scopeName: ownerType, relName: relationship, context: { ...context, id: '100000', db: fixture.knex } })
            : fixture.api.resources[ownerType].getRelationship({ id: '100000', relationshipName: relationship, format: 'jsonapi' }, context))
          const expected = hideAll ? [] : Array.from({ length: size }, (_, i) => String(i + 1)).filter(id => Number(id) % 100)
          const actual = method === 'listMany' ? value : value.data
          assert.deepEqual(actual.map(row => row.id).sort(), expected.sort())
          assert.equal(reads.reduce((total, rows) => total + rows, 0), expected.length)
          // The endpoint's parent GET also filters its other reverse relationships.
          assert.equal(linkageProbe.filter(probe => probe.linkQuery).length, 1)
        }
      }
    })

    it('filters missing targets while preserving each caller\'s duplicate-edge behavior', async () => {
      await seedCanonicalLinkRows(fixture.knex, [linkRow('1'), linkRow('206')])
      const { value, reads } = await measureVisible(() => get({ queryParams: { fields: { [ownerType]: relationship } } }))
      const identifiers = value.data.relationships[relationship].data
      assert.equal(identifiers.length, size + 1)
      assert.equal(identifiers.filter(row => row.id === '1').length, 2)
      assert.equal(identifiers.filter(row => row.id === '206').length, 0)
      assert.equal(reads.reduce((total, rows) => total + rows, 0), size + 1)
      const result = await measureVisible(() => fixture.api.anyapi.links.listMany({ scopeName: ownerType, relName: relationship, context: { id: '100000', db: fixture.knex } }))
      assert.equal(result.value.length, size)
      assert.equal(result.value.filter(row => row.id === '1').length, 1)
      assert.equal(result.value.filter(row => row.id === '206').length, 0)
      assert.equal(result.reads.reduce((total, rows) => total + rows, 0), size)
    })

    it('keeps visibility scoped to every parent across parent batches', async () => {
      const ids = Array.from({ length: size }, (_, i) => String(200000 + i))
      await seed(ownerType, ids.map(id => ({ id, name: 'Batch parent' })))
      await seedCanonicalLinkRows(fixture.knex, ids.map(id => linkRow('1', id)))
      const linkageProbe = []
      const { value, reads } = await measured(() => fixture.api.resources[ownerType].query({
        format: 'jsonapi',
        queryParams: { filters: { name: 'Batch parent' }, fields: { [ownerType]: relationship }, sort: ['id'], page: { size } }
      }, { hideRows: true, linkageProbe }))
      assert.deepEqual(value.data.map(row => row.id), ids)
      for (const row of value.data) assert.deepEqual(row.relationships[relationship].data, [{ type: targetType, id: '1' }])
      assert.deepEqual(reads.map(read => read.rows), [100, 100, 5])
      const bindingLimit = fixture.knex.client.config.client === 'mysql2' ? 4 * size + 240 : 240
      assert.ok(reads.every(read => read.bindings <= bindingLimit), JSON.stringify(reads))
      assert.equal(linkageProbe.length, 1)
      assert.equal(linkageProbe[0].filters, undefined)
    })

    it('rejects a denied target query before fetching its links', async () => {
      for (const method of ['get', 'getRelationship']) {
        const reads = []
        await assert.rejects(measureVisible(() => fixture.api.resources[ownerType][method]({
          id: '100000', relationshipName: relationship, format: 'jsonapi', queryParams: { fields: { [ownerType]: relationship } }
        }, { denyLinkage: true }), reads), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
        assert.deepEqual(reads, [])
      }
    })

    it('uses uncommitted target visibility and leaves the transaction to its owner', async () => {
      const transaction = await fixture.knex.transaction()
      try {
        const adapter = fixture.api.knex.helpers.getStorageAdapter(targetType)
        await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '1').update(adapter.toStorageRow({ name: 'Hidden pending' }))
        const linkageProbe = []
        const { value, reads } = await measureVisible(() => get({
          id: '100001', transaction, queryParams: { fields: { [ownerType]: relationship } }
        }, { hideRows: true, linkageProbe }))
        assert.deepEqual(value.data.relationships[relationship].data, [])
        assert.equal(reads.reduce((total, rows) => total + rows, 0), 0)
        assert.equal(linkageProbe.length, 1)
        assert.equal(linkageProbe[0].transaction, transaction)
        assert.equal(transaction.isCompleted(), false)
      } finally { await transaction.rollback() }
      assert.deepEqual((await get({ id: '100001' }, { hideRows: true })).data.relationships[relationship].data, [{ type: targetType, id: '1' }])
    })

    it('bounds physical rows for one parent and preserves both stored orientations', async () => {
      const { value, reads } = await measured(() => fetch(['100000']))
      assert.equal(reads.length, 3)
      assert.ok(reads.every(read => read.rows <= 101 && read.bindings <= 11), JSON.stringify(reads))
      assert.equal(value.length, size)
      assert.deepEqual(value.map(row => row.childId).sort(), Array.from({ length: size }, (_, i) => String(i + 1)).sort())
      assert.ok(value.every(row => row.parentId === '100000' && row.childType === targetType))
    })

    it('finishes an exact full page and orders mixed orientations by physical link ID', async () => {
      await seed(ownerType, [{ id: '100002', name: 'Boundary parent' }])
      await seedCanonicalLinkRows(fixture.knex, Array.from({ length: 101 }, (_, i) => linkRow(String(i + 1), '100002')))
      const { value, reads } = await measured(() => fetch(['100002']))
      assert.deepEqual(reads.map(read => read.rows), [101, 0])
      assert.deepEqual(value.map(row => row.childId), Array.from({ length: 101 }, (_, i) => String(i + 1)))
    })

    it('preserves duplicate stored edges across page boundaries', async () => {
      await seed(targetType, [{ id: '206', name: 'Last target' }])
      await seedCanonicalLinkRows(fixture.knex, [...Array.from({ length: 102 }, () => linkRow('1')), linkRow('206')])
      const { value, reads } = await measured(() => fetch(['100000']))
      assert.equal(value.length, 308)
      assert.equal(value.filter(row => row.childId === '1').length, 103)
      assert.equal(value.at(-1).childId, '206')
      assert.deepEqual(reads.map(read => read.rows), [101, 101, 101, 5])
    })

    for (const format of ['jsonapi', 'plain']) {
      for (const method of ['get', 'query']) {
        it(`${method} returns complete visible linkage and sparse includes (${format})`, async () => {
          const { value, reads } = await measured(() => fixture.api.resources[ownerType][method]({
            ...(method === 'get' ? { id: '100000' } : {}),
            format,
            queryParams: { ...(method === 'query' ? { filters: { name: 'Parent' }, sort: ['id'] } : {}), include: [relationship], fields: { [ownerType]: `name,${relationship}`, [targetType]: 'name' } }
          }, { hideRows: true }))
          const parents = method === 'query' ? value.data : [format === 'jsonapi' ? value.data : value]
          assert.deepEqual(parents.map(parent => parent.id), method === 'get' ? ['100000'] : ['100000', '100001'])
          for (const parent of parents) {
            const links = format === 'jsonapi' ? parent.relationships[relationship].data : parent[relationship]
            const expected = parent.id === '100000' ? Array.from({ length: size }, (_, i) => String(i + 1)).filter(id => Number(id) % 100) : ['1']
            assert.deepEqual(links.map(row => row.id).sort(), expected.sort())
            if (format === 'plain') assert.ok(links.every(row => row.name === `Target ${row.id}` && row.active === undefined))
          }
          if (format === 'jsonapi') {
            assert.equal(value.included.length, size - 2)
            assert.ok(value.included.every(row => row.type === targetType && Object.keys(row.attributes).join(',') === 'name'))
          }
          assert.deepEqual(reads, [])
          assert.ok(reads.every(read => read.rows <= 101), JSON.stringify(reads))
        })
      }
    }

    it('keeps other tenants, relationships and target resource types out of the prefetch', async () => {
      const targetResource = targetColumn === 'left_id' ? 'left_resource' : 'right_resource'
      await seedCanonicalLinkRows(fixture.knex, [
        { ...template, tenant_id: 'other' },
        { ...template, relationship: 'other', inverse_relationship: null },
        { ...template, [targetResource]: ownerType }
      ])
      const result = await get()
      assert.ok(result.data.relationships[relationship].data.every(row => row.type === targetType))
      const { value, reads } = await measured(() => fetch(['100000']))
      assert.equal(value.length, size)
      assert.ok(value.every(row => row.childType === targetType))
      assert.equal(reads.reduce((total, read) => total + read.rows, 0), size)
    })

    it('deduplicates repeated parents and avoids a query for an empty parent list', async () => {
      assert.deepEqual(await measured(() => fetch([])), { value: [], reads: [] })
      const { value, reads } = await measured(() => fetch(Array.from({ length: 33000 }, () => '100000')))
      assert.equal(value.length, size)
      assert.equal(reads.length, 3)
      assert.ok(reads.every(read => read.bindings <= 11))
    })

    it('uses pending links without completing the borrowed transaction', async () => {
      const transaction = await fixture.knex.transaction()
      try {
        await transaction('any_links').insert(linkRow('2', '100001'))
        const before = await fetch(['100000', '100001'], transaction)
        assert.equal(before.length, size + 2)
        const result = await get({ id: '100001', transaction })
        assert.deepEqual(result.data.relationships[relationship].data.map(row => row.id).sort(), ['1', '2'])
        assert.equal(transaction.isCompleted(), false)
      } finally { await transaction.rollback() }
      assert.equal((await fetch(['100000', '100001'])).length, size + 1)
    })

    it('rejects a later page failure instead of returning partial linkage', async t => {
      const failure = new RestApiValidationError('Later link page failed')
      const query = fixture.knex.client.query
      let attempts = 0
      t.mock.method(fixture.knex.client, 'query', function (connection, statement) {
        if (isPrefetch(statement) && ++attempts === 2) throw failure
        return query.call(this, connection, statement)
      })
      await assert.rejects(get(), error => error === failure)
      assert.equal(attempts, 2)
    })

    for (const borrowed of [false, true]) {
      it(`rejects failed full write-response paging and ${borrowed ? 'borrows' : 'rolls back'} the transaction`, async t => {
        const failure = new RestApiValidationError('Write response link page failed')
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        let attempts = 0; let injected = false; let observed
        await fixture.api.customize({
          hooks: {
            beforeDataCall: {
              functionName: 'link-prefetch-write-failure',
              handler: ({ context }) => {
                if (!context.injectLinkPageFailure || injected) return
                injected = true
                observed = context.transaction
                const query = observed.client.query
                t.mock.method(observed.client, 'query', function (connection, statement) {
                  if (isPrefetch(statement) && ++attempts === 2) throw failure
                  return query.call(this, connection, statement)
                })
              }
            }
          }
        })
        try {
          await assert.rejects(fixture.api.resources[ownerType].patch({
            id: '100000',
            transaction,
            format: 'jsonapi',
            returning: 'full',
            document: { data: { type: ownerType, id: '100000', attributes: { name: 'Pending' } } }
          }, { injectLinkPageFailure: true }), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
          assert.equal(attempts, 2)
          assert.equal(observed.isCompleted(), !borrowed)
          if (borrowed) {
            assert.equal(observed, transaction)
            assert.equal((await get({ transaction })).data.attributes.name, 'Pending')
          }
        } finally {
          t.mock.restoreAll()
          await unit?.rollback()
        }
        assert.equal((await get()).data.attributes.name, 'Parent')
      })
    }
  })
}
