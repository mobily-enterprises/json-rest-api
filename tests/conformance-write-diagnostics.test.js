import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Compiled write diagnostic visibility (${storageMode.mode})`, () => {
  let fixture
  const calls = []
  before(async () => {
    const capture = (...args) => calls.push(args)
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        fields: { accessKey: { type: 'string', hidden: true }, privateNote: { type: 'string', normallyHidden: true } },
        logging: { level: 'error', format: 'pretty', logger: { log: capture, warn: capture, error: capture } },
        hooks: { beforeDataCall: { functionName: 'reject-diagnostic-write', handler: () => { throw new Error('Deliberate write failure') } } }
      }
    })
  })
  beforeEach(async () => { await fixture.reset(); calls.length = 0 })
  after(async () => { await fixture?.close() })

  it('uses published field visibility while preserving rollback and the caller input', async () => {
    const inputRecord = { data: { type: 'items', attributes: { name: 'Visible name', accessKey: 'PRIVATE_COMPILED_ACCESS', privateNote: 'PRIVATE_COMPILED_NOTE' } } }
    await assert.rejects(fixture.api.resources.items.post({ inputRecord, format: 'jsonapi' }), /Deliberate write failure/)
    const diagnostic = calls.find(args => args[0].includes('Error in POST method'))
    assert.ok(diagnostic)
    assert.equal(diagnostic[1].phase, 'writeFailure')
    assert.equal(diagnostic[1].backend, fixture.knex.client.config.client)
    assert.equal(diagnostic[1].transactionOutcome, 'rolledBack')
    assert.equal(diagnostic[1].scopeName, 'items')
    assert.equal(diagnostic[1].method, 'post')
    const output = JSON.stringify(diagnostic)
    assert.ok(!output.includes('PRIVATE_COMPILED_ACCESS'))
    assert.ok(!output.includes('PRIVATE_COMPILED_NOTE'))
    assert.match(output, /Visible name/)
    assert.match(output, /Redacted/)
    assert.equal(inputRecord.data.attributes.accessKey, 'PRIVATE_COMPILED_ACCESS')
    assert.equal(await fixture.count('items'), 0)
  })
  it('redacts hidden values when malformed input fails before transaction setup', async () => {
    const inputRecord = [{ accessKey: 'PRIVATE_EARLY_ACCESS', privateNote: 'PRIVATE_EARLY_NOTE' }]
    await assert.rejects(fixture.api.resources.items.post({ inputRecord, format: 'jsonapi' }), /inputRecord must be a record object/)
    const diagnostic = calls.find(args => args[0].includes('Error in POST method'))
    assert.ok(diagnostic)
    assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE_EARLY_'))
    assert.equal(inputRecord[0].accessKey, 'PRIVATE_EARLY_ACCESS')
    assert.equal(await fixture.count('items'), 0)
  })
})
