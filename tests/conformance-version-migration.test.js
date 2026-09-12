import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi, createAnyApiFieldEvolutionApi, createAnyApiTemporalMigrationApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { backfillResourceVersions } from '../examples/migrations/resource-versions.js'

const fields = { revision: { type: 'string', nullable: true } }
const planFor = fixture => ({
  tableName: fixture.storage === 'anyapi' ? 'any_records' : 'schema_enrichment_items',
  idColumn: 'id',
  versionColumn: fixture.api.helpers.getStorageAdapter('items').translateColumn('revision'),
  scope: fixture.storage === 'anyapi' ? { tenant_id: fixture.api.anyapi.tenantId, resource: 'items' } : {}
})

describe(`Version backfill example (${storageMode.mode})`, () => {
  let fixture, plan, patchCalls
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: { fields, hooks: { afterDataCallPatch: { functionName: 'observe-backfill-hooks', handler: () => { patchCalls++ } } } }
    })
    plan = planFor(fixture)
  })
  beforeEach(async () => { await fixture.reset(); patchCalls = 0 })
  after(async () => { await fixture?.close() })
  const rows = () => fixture.knex(plan.tableName).where(plan.scope).select(plan.idColumn, plan.versionColumn).orderBy(plan.idColumn)
  const migrate = () => fixture.knex.transaction(transaction => backfillResourceVersions(transaction, plan))

  it('fills multiple pages with distinct tokens and preserves existing tokens on retry', async () => {
    for (let index = 0; index < 103; index++) await fixture.seed('items', { name: 'Selected', ...(index === 102 ? { revision: 'existing-token' } : {}) })
    assert.deepEqual(await migrate(), { scanned: 103, initialized: 102 })
    const stored = await rows()
    const tokens = stored.map(row => row[plan.versionColumn])
    assert.equal(new Set(tokens).size, 103)
    assert.equal(tokens.filter(token => token === 'existing-token').length, 1)
    for (const token of tokens.filter(token => token !== 'existing-token')) assert.match(token, /^[0-9a-f-]{36}$/)
    assert.deepEqual(await migrate(), { scanned: 103, initialized: 0 })
    assert.deepEqual(await rows(), stored)
    assert.equal(patchCalls, 0)
  })

  it('rolls back earlier backfills when a later existing value is malformed', async () => {
    await fixture.seed('items', { name: 'First' })
    await fixture.seed('items', { name: 'Invalid', revision: '' })
    const initial = await rows()
    await assert.rejects(migrate(), /Existing version/)
    assert.deepEqual(await rows(), initial)
  })

  it('leaves commit and rollback with the migration caller', async () => {
    await fixture.seed('items', { name: 'First' })
    const initial = await rows()
    const failure = new Error('Caller rollback')
    await assert.rejects(fixture.knex.transaction(async transaction => {
      assert.deepEqual(await backfillResourceVersions(transaction, plan), { scanned: 1, initialized: 1 })
      assert.equal(transaction.isCompleted(), false)
      throw failure
    }), error => error === failure)
    assert.deepEqual(await rows(), initial)
  })

  it('keeps unrelated rows and canonical tenant/resource scopes unchanged', async () => {
    await fixture.seed('items', { name: 'Selected' })
    await fixture.seed('items', { name: 'Unselected' })
    const nameColumn = fixture.api.helpers.getStorageAdapter('items').translateColumn('name')
    const selectedPlan = { ...plan, scope: { ...plan.scope, [nameColumn]: 'Selected' } }
    let foreignBefore
    const foreignRows = () => fixture.knex('any_records').where(builder => builder.whereNot('tenant_id', fixture.api.anyapi.tenantId).orWhereNot('resource', 'items')).orderBy('id')
    if (fixture.storage === 'anyapi') {
      const neighbor = await createAnyApiFieldEvolutionApi(fixture.knex, { tenantId: 'backfill_neighbor', fields, canonicalFieldsMap: { name: nameColumn, revision: plan.versionColumn } })
      await neighbor.resources.items.post({ format: 'plain', data: { id: '1', name: 'Selected', revision: 'neighbor-token' } })
      await neighbor.resources.groups.post({ format: 'plain', data: { id: '1', name: 'Selected' } })
      const sameTenant = await createAnyApiTemporalMigrationApi(fixture.knex, { tenantId: fixture.api.anyapi.tenantId })
      await sameTenant.resources.people.post({ format: 'plain', data: { id: '1', name: 'Selected' } })
      foreignBefore = await foreignRows()
    }
    assert.deepEqual(await fixture.knex.transaction(transaction => backfillResourceVersions(transaction, selectedPlan)), { scanned: 1, initialized: 1 })
    assert.equal((await rows()).filter(row => row[plan.versionColumn] === null).length, 1)
    if (foreignBefore) assert.deepEqual(await foreignRows(), foreignBefore)
  })

  it('requires an active transaction and explicit safe migration scope', async () => {
    await assert.rejects(backfillResourceVersions(fixture.knex, plan), /transaction/)
    await fixture.knex.transaction(async transaction => {
      for (const invalid of [{ ...plan, scope: undefined }, { ...plan, versionColumn: plan.idColumn }, { ...plan, tableName: 'any_records', scope: {} }]) {
        await assert.rejects(backfillResourceVersions(transaction, invalid))
      }
    })
  })
})

describe(`Version-field allocation and restart (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables: { items: 'schema_enrichment_items' } })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('migrates an existing resource before enabling managed revisions', async () => {
    const first = await fixture.seed('items', { name: 'Before migration' }, undefined, { generatedId: true })
    await fixture.api.resources.items.addKnexFields({ fields })
    const plan = fixture.storage === 'anyapi' ? planFor(fixture) : { tableName: 'schema_enrichment_items', idColumn: 'id', versionColumn: 'revision', scope: {} }
    assert.deepEqual(await fixture.knex.transaction(transaction => backfillResourceVersions(transaction, plan)), { scanned: 1, initialized: 1 })
    const api = await createSchemaEnrichmentApi(fixture.knex, { storage: fixture.storage, createTable: false, fields: { revision: { type: 'string', required: true } }, resourceOptions: { versionField: 'revision' } })
    const items = api.resources.items
    const current = await items.get({ id: first.id, format: 'plain' })
    assert.match(current.revision, /^[0-9a-f-]{36}$/)
    const updated = await items.patch({ id: first.id, data: { name: 'After migration' }, format: 'plain', returning: 'full', expectedVersion: current.revision })
    assert.notEqual(updated.revision, current.revision)
    await assert.rejects(items.patch({ id: first.id, data: { name: 'Stale' }, format: 'plain', expectedVersion: current.revision }), error => error.code === 'REST_API_VERSION_CONFLICT')
    const created = await items.post({ data: { name: 'New row' }, format: 'plain', returning: 'full' })
    assert.match(created.revision, /^[0-9a-f-]{36}$/)
  })
})
