import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { advanceResourceVersion } from '../plugins/core/lib/writing/resource-version.js'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'

describe(`Atomic resource revision storage (${storageMode.mode})`, () => {
  let fixture, item, initial
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      databaseOptions: { concurrent: true, maxConnections: 2 },
      tables: { items: 'schema_enrichment_items' },
      apiOptions: { fields: { revision: { type: 'string' } }, resourceOptions: { versionField: 'revision' } }
    })
  })
  beforeEach(async () => { await fixture.reset(); item = await fixture.seed('items', { name: 'Original' }); initial = item.attributes.revision })
  after(async () => { await fixture?.close() })
  const advance = (transaction, expectedVersion) => advanceResourceVersion({
    scopeName: 'items',
    helpers: fixture.api.helpers,
    expectedVersion,
    context: { transaction, id: item.id, schemaInfo: fixture.api.resources.items.vars.schemaInfo }
  })
  const read = async () => (await fixture.api.resources.items.get({ id: item.id, format: 'jsonapi' })).data.attributes.revision

  it('replaces a matching token and rejects its subsequent stale use', async () => {
    const next = await fixture.knex.transaction(transaction => advance(transaction, initial))
    assert.match(next, /^[0-9a-f-]{36}$/)
    assert.equal(await read(), next)
    await assert.rejects(fixture.knex.transaction(transaction => advance(transaction, initial)), error => error instanceof RestApiResourceError && error.subtype === 'conflict')
    assert.equal(await read(), next)
  })

  it('advances unconditional writes and rolls revision changes back with the transaction', async () => {
    const next = await fixture.knex.transaction(transaction => advance(transaction))
    assert.notEqual(next, initial)
    const failure = new Error('Rollback requested')
    await assert.rejects(fixture.knex.transaction(async transaction => {
      assert.notEqual(await advance(transaction, next), next)
      throw failure
    }), error => error === failure)
    assert.equal(await read(), next)
  })

  it('allows only one of two concurrent transactions to replace the same revision', async () => {
    let arrivals = 0
    let release
    const ready = new Promise(resolve => { release = resolve })
    const update = () => fixture.knex.transaction(async transaction => {
      if (++arrivals === 2) release()
      await ready
      return advance(transaction, initial)
    })
    const outcomes = await Promise.allSettled([update(), update()])
    const succeeded = outcomes.filter(outcome => outcome.status === 'fulfilled')
    const failed = outcomes.filter(outcome => outcome.status === 'rejected')
    assert.equal(arrivals, 2)
    assert.equal(succeeded.length, 1)
    assert.equal(failed.length, 1)
    const error = failed[0].reason
    const sqliteBusy = fixture.knex.client.config.client === 'better-sqlite3' && /^SQLITE_BUSY/.test(error.code)
    assert.ok(sqliteBusy || (error instanceof RestApiResourceError && error.subtype === 'conflict'))
    assert.equal(await read(), succeeded[0].value)
  })

  for (const variant of ['uppercase', 'trailing-space']) {
    it(`compares revision bytes exactly for ${variant}`, async () => {
      const expectedVersion = variant === 'uppercase' ? initial.toUpperCase() + (/[a-f]/.test(initial) ? '' : 'A') : initial + ' '
      await assert.rejects(fixture.knex.transaction(transaction => advance(transaction, expectedVersion)), error => error instanceof RestApiResourceError && error.subtype === 'conflict')
      assert.equal(await read(), initial)
    })
  }

  for (const expectedVersion of [null, 1, '', {}, 'x'.repeat(129)]) {
    it(`rejects malformed version input (${typeof expectedVersion}, ${String(expectedVersion).length})`, async () => {
      await assert.rejects(fixture.knex.transaction(transaction => advance(transaction, expectedVersion)), RestApiValidationError)
      assert.equal(await read(), initial)
    })
  }
})

if (storageMode.mode === 'anyapi') {
  describe('Conditional canonical write scope', () => {
    let fixture, items
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { records: 'any_records' },
        apiOptions: { fields: { revision: { type: 'string' } }, resourceOptions: { versionField: 'revision' } }
      })
      items = fixture.api.resources.items
    })
    beforeEach(async () => { await fixture.reset() })
    after(async () => { await fixture?.close() })
    for (const method of ['patch', 'put', 'delete']) {
      it(`scopes ${method} when foreign rows share both ID and revision`, async () => {
        const created = await fixture.seed('items', { name: 'Original' })
        const token = created.attributes.revision
        const schema = items.vars.schemaInfo
        for (const scope of [{ tenant: 'neighbor' }, { resource: 'foreign_items' }]) {
          await seedStorageAdapterRecords(fixture.knex, { ...schema, descriptor: { ...schema.descriptor, ...scope } }, [
            { id: created.id, name: 'Foreign', revision: token }
          ])
        }
        const foreign = () => fixture.knex('any_records').where(query => query.where('tenant_id', 'neighbor').orWhere('resource', 'foreign_items')).orderBy('id')
        const before = await foreign()
        assert.equal(before.length, 2)
        const mutate = expectedVersion => items[method]({
          id: created.id,
          expectedVersion,
          format: 'plain',
          ...(method === 'delete' ? {} : { inputRecord: { name: 'Updated' } })
        })
        await mutate(token)
        assert.deepEqual(await foreign(), before)
        if (method === 'delete') {
          await items.post({ inputRecord: { id: created.id, name: 'Recreated' }, format: 'plain' })
        }
        const current = await items.get({ id: created.id, format: 'plain' })
        assert.notEqual(current.revision, token)
        // The old condition still matches foreign rows, but cannot satisfy this write.
        await assert.rejects(mutate(token), error => error.code === 'REST_API_VERSION_CONFLICT')
        assert.deepEqual(await items.get({ id: created.id, format: 'plain' }), current)
        assert.deepEqual(await foreign(), before)
      })
    }
  })
}
