import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createFileUploadApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Conditional file replacement (${storageMode.mode})`, () => {
  let fixture, original, cleanupCalls
  const detectorState = { payload: null }
  const active = new Set()
  const uploaded = []
  const deleted = []
  const storage = {
    async upload (file) {
      const url = `/uploads/${file.filename}`
      uploaded.push(url)
      active.add(url)
      return url
    },
    async delete (url) { deleted.push(url); active.delete(url) }
  }
  const payload = filename => ({
    fields: { title: filename },
    files: { attachment: { filename, mimetype: 'image/png', size: 1, data: Buffer.from('x'), cleanup: async () => { cleanupCalls++ } } }
  })
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: knex => createFileUploadApi(knex, { storage, detectorState, versioned: true }),
      tables: { documents: 'file_documents' }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    active.clear()
    cleanupCalls = 0
    detectorState.payload = payload('original.png')
    original = await fixture.seed('documents', { title: 'Original' })
    detectorState.payload = null
    uploaded.length = 0
    deleted.length = 0
    cleanupCalls = 0
  })
  after(async () => { await fixture?.close() })
  for (const method of ['patch', 'put']) {
    it(`removes an earlier successful ${method} upload when a later condition rolls back the transaction`, async () => {
      const documents = fixture.api.resources.documents
      const before = await documents.get({ id: original.id })
      await assert.rejects(fixture.api.transaction(async transaction => {
        detectorState.payload = payload('provisional.png')
        const first = await documents[method]({ id: original.id, expectedVersion: original.attributes.revision, transaction, format: 'plain', inputRecord: {} })
        assert.notEqual(first.revision, original.attributes.revision)
        assert.ok(active.has('/uploads/provisional.png'))
        detectorState.payload = payload('rejected.png')
        await documents[method]({ id: original.id, expectedVersion: original.attributes.revision, transaction, format: 'plain', inputRecord: {} })
      }), error => error.code === 'REST_API_VERSION_CONFLICT')
      detectorState.payload = null
      assert.equal(cleanupCalls, 2)
      assert.deepEqual([...deleted].sort(), [...uploaded].sort())
      assert.deepEqual([...active], [original.attributes.attachment])
      assert.deepEqual(await documents.get({ id: original.id }), before)
    })
    for (const format of ['jsonapi', 'plain']) {
      it(`cleans a rejected ${method} upload and preserves the original (${format})`, async () => {
        const documents = fixture.api.resources.documents
        const before = await documents.get({ id: original.id })
        detectorState.payload = payload('rejected.png')
        const write = expectedVersion => documents[method]({
          id: original.id,
          expectedVersion,
          format,
          returning: 'full',
          inputRecord: format === 'plain' ? {} : { data: { type: 'documents', attributes: {} } }
        })
        await assert.rejects(write('stale-token'), error => error.code === 'REST_API_VERSION_CONFLICT')
        assert.equal(cleanupCalls, 1)
        assert.deepEqual(deleted, uploaded)
        assert.deepEqual([...active], [original.attributes.attachment])
        detectorState.payload = null
        assert.deepEqual(await documents.get({ id: original.id }), before)

        detectorState.payload = payload('accepted.png')
        const result = await write(original.attributes.revision)
        const attributes = format === 'plain' ? result : result.data.attributes
        assert.equal(attributes.attachment, '/uploads/accepted.png')
        assert.notEqual(attributes.revision, original.attributes.revision)
        assert.ok(active.has('/uploads/accepted.png'))
        assert.equal(cleanupCalls, 2)
      })
    }
  }
})
