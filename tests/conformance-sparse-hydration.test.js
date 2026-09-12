import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords, seedUnqueriedIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

describe(`Sparse relationship hydration (${storageMode.mode})`, () => {
  let fixture
  const identifierReads = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' },
      apiOptions: {
        inverseMembership: true,
        collectionInclude: { limit: null },
        manyToManyInclude: { limit: null },
        fieldCallback: (kind, type, value) => kind === 'computed' ? value.toUpperCase() : value,
        resourcePolicy: ({ query, context, column }) => {
          if (context.hideRows) query.whereNot(column('name'), 'like', '% 2')
          return true
        }
      }
    })
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'sparse-identifier-read-probe',
          handler: ({ context }) => {
            if (context.knexQuery?.queryPurpose === 'include' && context.includeFailure) throw context.includeFailure
            if (context.knexQuery?.queryPurpose !== 'relationship-identifiers') return
            identifierReads.push(context.knexQuery.scopeName)
            if (context.identifierFailure) throw context.identifierFailure
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seedUnqueriedIdConformanceApi(fixture.knex, fixture.api, ['1', '2'])
    identifierReads.length = 0
  })
  after(async () => { await fixture?.close() })
  const read = (type, method, format, queryParams, context, transaction) => fixture.api.resources[type][method]({
    id: '1', format, queryParams, ...(transaction ? { transaction } : {})
  }, context)
  const main = (value, method, format) => method === 'query' ? value.data : [format === 'plain' ? value : value.data]
  const relationships = (row, format) => format === 'plain' ? Object.keys(row).filter(key => !['id', 'name', 'derivedName'].includes(key)) : Object.keys(row.relationships || {})

  for (const type of ['groups', 'items']) {
    for (const format of ['jsonapi', 'plain']) {
      for (const method of ['get', 'query']) {
        it(`${type} ${method} ${format} avoids all omitted linkage reads and computes selected attributes`, async () => {
          for (const fields of ['', 'name', 'derivedName,derivedName']) {
            identifierReads.length = 0
            const value = await read(type, method, format, { fields: { [type]: fields } })
            for (const row of main(value, method, format)) {
              assert.deepEqual(relationships(row, format), [])
              const attributes = format === 'plain' ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')) : row.attributes
              const name = `${type === 'items' ? 'Item' : 'Group'} ${row.id}`
              assert.deepEqual(attributes, fields.startsWith('derivedName') ? { derivedName: name.toUpperCase() } : fields ? { name } : {})
            }
            assert.deepEqual(identifierReads, [])
          }
        })
      }
    }
  }

  for (const [type, relationship] of [['items', 'groups'], ['groups', 'members'], ['groups', 'items'], ['groups', 'mentions']]) {
    it(`retains selected ${type}.${relationship} linkage and its visibility filtering`, async () => {
      const value = await read(type, 'query', 'jsonapi', { fields: { [type]: `name,${relationship}` }, sort: ['id'] }, { hideRows: true })
      assert.equal(value.data.length, 1)
      assert.deepEqual(Object.keys(value.data[0].relationships), [relationship])
      assert.deepEqual(value.data[0].relationships[relationship].data, [{ type: type === 'items' ? 'groups' : 'items', id: '1' }])
      assert.ok(identifierReads.length > 0)
    })

    it(`loads explicitly included ${type}.${relationship} when omitted from the fieldset`, async () => {
      const target = type === 'items' ? 'groups' : 'items'
      const value = await read(type, 'get', 'jsonapi', { fields: { [type]: 'name', [target]: 'name' }, include: [relationship] })
      assert.deepEqual(Object.keys(value.data.relationships || {}), [])
      assert.deepEqual(value.included.map(row => [row.type, row.id, row.attributes.name]), [[target, '1', `${target === 'items' ? 'Item' : 'Group'} 1`]])
      assert.deepEqual(identifierReads, [])
    })
  }

  it('retains nested includes through omitted to-one, collection and inverse relationships', async () => {
    const value = await read('items', 'get', 'jsonapi', {
      fields: { items: 'name', groups: 'name' }, include: ['group.items.groups', 'groups.members.group', 'subject.mentions']
    })
    assert.deepEqual(value.included.map(row => `${row.type}:${row.id}`).sort(), ['groups:1'])
    for (const row of [value.data, ...value.included]) assert.deepEqual(Object.keys(row.relationships || {}), [])
    assert.deepEqual(identifierReads, [])
  })

  it('keeps hidden included targets out when their linkage is also omitted', async () => {
    await fixture.api.resources.items.postRelationship({ id: '1', relationshipName: 'groups', relationshipData: [{ type: 'groups', id: '2' }] })
    identifierReads.length = 0
    const value = await read('items', 'get', 'jsonapi', { fields: { items: 'name', groups: 'name' }, include: ['groups'] }, { hideRows: true })
    assert.deepEqual(value.included.map(row => row.id), ['1'])
    assert.deepEqual(identifierReads, [])
  })

  it('retains full linkage when the fieldset applies only to another resource type', async () => {
    const value = await read('groups', 'get', 'jsonapi', { fields: { items: 'name' } })
    for (const name of ['members', 'items', 'mentions']) assert.deepEqual(value.data.relationships[name].data, [{ type: 'items', id: '1' }])
    assert.ok(identifierReads.length > 0)
  })

  it('checks visibility for selected belongs-to and polymorphic linkage', async () => {
    const adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo: fixture.api.resources.items.vars.schemaInfo })
    await adapter.buildBaseQuery().where(adapter.getIdColumn(), '1').update(adapter.toStorageRow({ groupId: '2', subjectId: '2' }))
    const value = await read('items', 'get', 'jsonapi', { fields: { items: 'group,subject' } }, { hideRows: true })
    assert.equal(value.data.relationships.group.data, null)
    assert.equal(value.data.relationships.subject.data, null)
    assert.deepEqual(identifierReads, ['groups'])
  })

  it('does not allocate a large omitted reverse collection', async () => {
    const reads = []
    for (let offset = 0; offset < 1001; offset += 100) {
      await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo,
        Array.from({ length: Math.min(100, 1001 - offset) }, (_, index) => ({ id: String(offset + index + 10), name: 'Child', groupId: '1', subjectType: 'groups', subjectId: '1' })))
    }
    const capture = (rows, query) => {
      if (/^select /i.test(query.sql) && Array.isArray(rows)) reads.push(rows.length)
    }
    fixture.knex.on('query-response', capture)
    try {
      const value = await read('groups', 'get', 'jsonapi', { fields: { groups: 'name' } })
      assert.deepEqual(value.data.attributes, { name: 'Group 1' })
    } finally { fixture.knex.off('query-response', capture) }
    assert.deepEqual(identifierReads, [])
    assert.ok(reads.every(count => count <= 1), JSON.stringify(reads))
  })

  it('skips unused identifier hooks but propagates failures for requested linkage', async () => {
    const failure = new Error('Requested linkage failed')
    const value = await read('groups', 'get', 'jsonapi', { fields: { groups: 'name' } }, { identifierFailure: failure })
    assert.equal(value.data.attributes.name, 'Group 1')
    await assert.rejects(read('groups', 'get', 'jsonapi', { fields: { groups: 'members' } }, { identifierFailure: failure }), error => {
      while (error && error !== failure) error = error.cause
      return error === failure
    })
  })

  it('reads pending included references in a borrowed transaction and preserves rollback', async () => {
    const adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo: fixture.api.resources.items.vars.schemaInfo })
    const transaction = await fixture.knex.transaction()
    try {
      await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '2').update(adapter.toStorageRow({ groupId: '1' }))
      const value = await read('groups', 'get', 'jsonapi', { fields: { groups: 'name', items: 'name' }, include: ['items'] }, undefined, transaction)
      assert.deepEqual(value.included.map(row => row.id).sort(), ['1', '2'])
      assert.deepEqual(identifierReads, [])
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
    const value = await read('groups', 'get', 'jsonapi', { fields: { groups: 'name', items: 'name' }, include: ['items'] })
    assert.deepEqual(value.included.map(row => row.id), ['1'])
  })

  for (const borrowed of [false, true]) {
    it(`full-response PATCH omits unused linkage reads (${borrowed ? 'borrowed' : 'owned'} transaction)`, async () => {
      const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
      const transaction = unit?.transaction
      try {
        const value = await fixture.api.resources.groups.patch({
          id: '1',
          document: createJsonApiDocument('groups', { name: 'Changed' }),
          transaction,
          returning: 'full',
          format: 'jsonapi',
          queryParams: { fields: { groups: 'name' } }
        }, { identifierFailure: new Error('Unused linkage must not run') })
        assert.deepEqual(value.data.attributes, { name: 'Changed' })
        assert.deepEqual(identifierReads, [])
        if (borrowed) assert.equal(transaction.isCompleted(), false)
      } finally { await unit?.rollback() }
      const value = await read('groups', 'get', 'jsonapi', { fields: { groups: 'name' } })
      assert.equal(value.data.attributes.name, borrowed ? 'Group 1' : 'Changed')
    })

    it(`propagates omitted-linkage include failures during PATCH (${borrowed ? 'borrowed' : 'owned'} transaction)`, async () => {
      const failure = new Error('Explicit include failed')
      const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
      const transaction = unit?.transaction
      try {
        await assert.rejects(fixture.api.resources.groups.patch({
          id: '1',
          document: createJsonApiDocument('groups', { name: 'Changed' }),
          transaction,
          returning: 'full',
          format: 'jsonapi',
          queryParams: { fields: { groups: 'name', items: 'name' }, include: ['members'] }
        }, { includeFailure: failure }), error => {
          while (error && error !== failure) error = error.cause
          return error === failure
        })
        const value = await read('groups', 'get', 'jsonapi', { fields: { groups: 'name' } }, undefined, transaction)
        assert.equal(value.data.attributes.name, borrowed ? 'Changed' : 'Group 1')
        if (borrowed) assert.equal(transaction.isCompleted(), false)
      } finally { await unit?.rollback() }
      const value = await read('groups', 'get', 'jsonapi', { fields: { groups: 'name' } })
      assert.equal(value.data.attributes.name, 'Group 1')
    })
  }
})
