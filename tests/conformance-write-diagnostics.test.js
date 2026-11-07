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

  it('logs the resource, operation and error code without any input while preserving rollback and the caller input', async () => {
    const inputRecord = { data: { type: 'items', attributes: { name: 'Visible name', accessKey: 'PRIVATE_COMPILED_ACCESS', privateNote: 'PRIVATE_COMPILED_NOTE' } } }
    await assert.rejects(fixture.api.resources.items.post({ document: inputRecord, format: 'jsonapi' }), /Deliberate write failure/)
    const diagnostic = calls.find(args => args[0].includes('Error in POST method'))
    assert.ok(diagnostic)
    assert.equal(diagnostic[1].phase, 'writeFailure')
    assert.equal(diagnostic[1].backend, fixture.knex.client.config.client)
    assert.equal(diagnostic[1].transactionOutcome, 'rolledBack')
    assert.equal(diagnostic[1].scopeName, 'items')
    assert.equal(diagnostic[1].method, 'post')
    assert.equal(diagnostic[1].code, 'Error')
    const output = JSON.stringify(diagnostic)
    // Neither hidden nor visible input, nor the error's message, reaches the log.
    for (const text of ['PRIVATE_COMPILED_ACCESS', 'PRIVATE_COMPILED_NOTE', 'Visible name', 'Deliberate write failure']) {
      assert.ok(!output.includes(text), text)
    }
    assert.equal(inputRecord.data.attributes.accessKey, 'PRIVATE_COMPILED_ACCESS')
    assert.equal(await fixture.count('items'), 0)
  })
  it('logs no input when malformed input fails before transaction setup', async () => {
    const inputRecord = [{ accessKey: 'PRIVATE_EARLY_ACCESS', privateNote: 'PRIVATE_EARLY_NOTE' }]
    await assert.rejects(fixture.api.resources.items.post({ document: inputRecord, format: 'jsonapi' }), /document must be an object/)
    const diagnostic = calls.find(args => args[0].includes('Error in POST method'))
    assert.ok(diagnostic)
    assert.equal(diagnostic[1].code, 'REST_API_VALIDATION')
    assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE_EARLY_'))
    assert.equal(inputRecord[0].accessKey, 'PRIVATE_EARLY_ACCESS')
    assert.equal(await fixture.count('items'), 0)
  })
})
