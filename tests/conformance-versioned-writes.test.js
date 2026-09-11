import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

for (const format of ['jsonapi', 'plain']) {
  describe(`Versioned resource writes ${format} (${storageMode.mode})`, () => {
    let fixture, items, completedPatches
    const input = (name, revision) => format === 'plain'
      ? { name, ...(revision === undefined ? {} : { revision }) }
      : { data: { type: 'items', attributes: { name, ...(revision === undefined ? {} : { revision }) } } }
    const attributes = result => format === 'plain' ? result : result.data.attributes
    const id = result => format === 'plain' ? result.id : result.data.id
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        databaseOptions: { concurrent: true, maxConnections: 2 },
        tables: { items: 'schema_enrichment_items' },
        apiOptions: {
          fields: { revision: { type: 'string', required: true } },
          resourceOptions: { versionField: 'revision' },
          hooks: {
            beforeDataCallPatch: { functionName: 'try-changing-version', handler: async ({ context }) => { if (context.changeVersion) context.inputRecord.data.attributes.revision = 'hook-token'; await context.synchronize?.() } },
            afterDataCallPatch: { functionName: 'observe-version-write', handler: ({ context }) => { completedPatches++; if (context.failWrite) throw new Error('Reject versioned write') } }
          }
        }
      })
      items = fixture.api.resources.items
    })
    beforeEach(async () => { await fixture.reset(); completedPatches = 0 })
    after(async () => { await fixture?.close() })

    it('initializes revisions and prevents a stale PATCH from overwriting a newer write', async () => {
      const body = input('Original')
      const created = await items.post({ inputRecord: body, format, returning: 'full' })
      const first = attributes(created).revision
      assert.match(first, /^[0-9a-f-]{36}$/)
      assert.equal(format === 'plain' ? body.revision : body.data.attributes.revision, undefined)
      const updated = await items.patch({ id: id(created), inputRecord: input('Updated'), expectedVersion: first, format, returning: 'full' })
      assert.notEqual(attributes(updated).revision, first)
      await assert.rejects(items.patch({ id: id(created), inputRecord: input('Stale'), expectedVersion: first, format }), error => error.subtype === 'conflict')
      const stored = await items.get({ id: id(created), format })
      assert.equal(completedPatches, 1)
      assert.equal(attributes(stored).name, 'Updated')
      assert.equal(attributes(stored).revision, attributes(updated).revision)
    })

    it('advances unconditional PUT and requires a current token for conditional DELETE', async () => {
      const created = await items.put({ id: '1', inputRecord: input('Created'), format, returning: 'full' })
      const first = attributes(created).revision
      const replaced = await items.put({ id: '1', inputRecord: input('Replaced'), format, returning: 'full' })
      assert.notEqual(attributes(replaced).revision, first)
      await assert.rejects(items.delete({ id: '1', expectedVersion: first }), error => error.subtype === 'conflict')
      assert.equal(await fixture.count('items'), 1)
      await items.delete({ id: '1', expectedVersion: attributes(replaced).revision })
      assert.equal(await fixture.count('items'), 0)
    })

    it('keeps the generated token authoritative and rolls it back with a failed write', async () => {
      const created = await items.post({ inputRecord: input('Original'), format, returning: 'full' })
      const first = attributes(created).revision
      await assert.rejects(items.patch({ id: id(created), inputRecord: input('Failed'), expectedVersion: first, format }, { failWrite: true }), /Reject versioned write/)
      const unchanged = await items.get({ id: id(created), format })
      assert.equal(attributes(unchanged).revision, first)
      assert.equal(attributes(unchanged).name, 'Original')
      const updated = await items.patch({ id: id(created), inputRecord: input('Updated'), expectedVersion: first, format, returning: 'full' }, { changeVersion: true })
      assert.match(attributes(updated).revision, /^[0-9a-f-]{36}$/)
      assert.notEqual(attributes(updated).revision, first)
    })

    it('allows only one simultaneous public PATCH with the same revision', async () => {
      const created = await items.post({ inputRecord: input('Original'), format, returning: 'full' })
      let arrivals = 0
      let release
      const ready = new Promise(resolve => { release = resolve })
      const synchronize = async () => {
        if (++arrivals === 2) release()
        await ready
      }
      const update = name => items.patch({ id: id(created), inputRecord: input(name), expectedVersion: attributes(created).revision, format, returning: 'full' }, { synchronize })
      const outcomes = await Promise.allSettled([update('First client'), update('Second client')])
      const succeeded = outcomes.filter(outcome => outcome.status === 'fulfilled')
      const failed = outcomes.filter(outcome => outcome.status === 'rejected')
      assert.equal(arrivals, 2)
      assert.equal(succeeded.length, 1)
      assert.equal(failed.length, 1)
      const error = failed[0].reason
      const sqliteBusy = fixture.knex.client.config.client === 'better-sqlite3' && /^SQLITE_BUSY/.test(error.code)
      assert.ok(sqliteBusy || error.subtype === 'conflict')
      assert.equal(completedPatches, 1)
      const stored = await items.get({ id: id(created), format })
      assert.equal(attributes(stored).revision, attributes(succeeded[0].value).revision)
      assert.equal(attributes(stored).name, attributes(succeeded[0].value).name)
    })

    it('rotates unchanged-value writes and consumes each transaction revision once', async () => {
      const created = await items.post({ inputRecord: input('Original'), format, returning: 'full' })
      const original = attributes(created).revision
      const recordId = id(created)
      const unchanged = await items.patch({ id: recordId, inputRecord: input('Original'), expectedVersion: original, format, returning: 'full' })
      const current = attributes(unchanged).revision
      assert.notEqual(current, original)
      assert.equal(attributes(unchanged).name, 'Original')
      const failure = new Error('Rollback successive revisions')
      const revisions = [original, current]
      await assert.rejects(fixture.api.transaction(async transaction => {
        const first = await items.patch({ id: recordId, inputRecord: input('First'), expectedVersion: current, transaction, format, returning: 'full' })
        revisions.push(attributes(first).revision)
        const second = await items.patch({ id: recordId, inputRecord: input('Second'), expectedVersion: attributes(first).revision, transaction, format, returning: 'full' })
        revisions.push(attributes(second).revision)
        assert.equal(new Set(revisions).size, revisions.length)
        await assert.rejects(items.patch({ id: recordId, inputRecord: input('Stale'), expectedVersion: attributes(first).revision, transaction, format }), error => error.code === 'REST_API_VERSION_CONFLICT')
        const stored = await items.get({ id: recordId, transaction, format })
        assert.equal(attributes(stored).revision, attributes(second).revision)
        assert.equal(attributes(stored).name, 'Second')
        throw failure
      }), error => error === failure || error.cause === failure)
      const restored = await items.get({ id: recordId, format })
      assert.equal(attributes(restored).revision, current)
      assert.equal(attributes(restored).name, 'Original')
      assert.equal(completedPatches, 3)
    })

    it('rejects supplied revision attributes and conditional creation', async () => {
      await assert.rejects(items.post({ inputRecord: input('Forged', 'caller-token'), format }), /version field is managed/)
      await assert.rejects(items.put({ id: '1', inputRecord: input('Missing'), expectedVersion: 'old-token', format }), error => error.subtype === 'not_found')
      assert.equal(await fixture.count('items'), 0)
    })
  })
}
