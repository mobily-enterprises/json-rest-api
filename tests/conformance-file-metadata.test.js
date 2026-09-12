import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createFileUploadApi, createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createTestDatabase } from './helpers/test-database.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { FileHandlingPlugin } from '../plugins/core/file-handling-plugin.js'

const file = mimetype => ({ filename: 'upload', mimetype, size: 1, data: Buffer.from('x') })

describe(`Compiled upload metadata (${storageMode.mode})`, () => {
  let database, api, storage, detectorState
  const accepts = ['image/png']
  const uploaded = []
  before(async () => {
    database = await createTestDatabase()
    detectorState = { payload: null }
    storage = {
      async upload (file) { assert.equal(this, storage); uploaded.push(file.mimetype); return '/uploads/file' },
      async delete () { assert.equal(this, storage) }
    }
    api = await createFileUploadApi(database.knex, {
      storage,
      detectorState,
      fileAccepts: accepts,
      hooks: {
        'schema:enrich': {
          functionName: 'enrich-upload-types',
          handler: ({ context }) => { context.fields.attachment.accepts.push('image/webp') }
        }
      }
    })
  })
  beforeEach(async () => {
    await cleanTables(database.knex, ['file_documents'])
    uploaded.length = 0
    accepts.splice(0, accepts.length, 'image/png')
    detectorState.payload = null
  })
  after(async () => { try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) } })
  const upload = (mimetype, field = 'attachment') => {
    detectorState.payload = { fields: { title: 'Upload' }, files: { [field]: file(mimetype) } }
    return api.resources.documents.post({ document: createJsonApiDocument('documents', {}) })
  }

  it('retains the supplied backend identity and method receiver', async () => {
    assert.equal(api.resources.documents.vars.schemaInfo.schemaStructure.attachment.storage, storage)
    await upload('image/png')
    assert.deepEqual(uploaded, ['image/png'])
  })
  it('ignores later mutations of caller-held MIME declarations', async () => {
    accepts.push('text/plain')
    await assert.rejects(upload('text/plain'), /Invalid file type/)
    assert.deepEqual(uploaded, [])
  })
  it('uses the MIME rules produced by schema enrichment', async () => {
    await upload('image/webp')
    assert.deepEqual(uploaded, ['image/webp'])
  })
  if (storageMode.mode === 'anyapi') {
    it('keeps cached rules and backend handles after a rejected addition', async () => {
      await upload('image/png')
      const resource = api.resources.documents
      const original = resource.vars.schemaInfo
      await assert.rejects(resource.addKnexFields({
        fields: {
          misplaced: { type: 'file', storage, belongsToPolymorphic: { types: ['documents'], typeField: 'title', idField: 'id' } }
        }
      }), /cannot declare belongsToPolymorphic/)
      assert.equal(resource.vars.schemaInfo, original)
      await upload('image/webp')
      assert.deepEqual(uploaded, ['image/png', 'image/webp'])
    })
    it('discovers file fields after committed canonical additions', async () => {
      await upload('image/png')
      await api.resources.documents.addKnexFields({
        fields: {
          extra: { type: 'file', storage, accepts: ['image/png'], nullable: true }
        }
      })
      await upload('image/png', 'extra')
      assert.deepEqual(uploaded, ['image/png', 'image/png'])
    })
  }
})

describe(`Late upload plugin installation (${storageMode.mode})`, () => {
  let database, api, payload, uploads
  before(async () => {
    database = await createTestDatabase()
    uploads = 0
    const storage = { async upload () { uploads++; return '/uploads/late' }, async delete () {} }
    api = await createSchemaEnrichmentApi(database.knex, {
      fields: { attachment: { type: 'file', storage, accepts: ['image/png'], nullable: true } }
    })
    await api.use(FileHandlingPlugin)
    api.rest.registerFileDetector({ name: 'late-test', detect: () => Boolean(payload), parse: async () => payload })
  })
  beforeEach(async () => { await cleanTables(database.knex, ['schema_enrichment_items']); uploads = 0; payload = null })
  after(async () => { try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) } })
  it('uses already compiled resource fields', async () => {
    payload = { fields: { name: 'Late' }, files: { attachment: file('image/png') } }
    const result = await api.resources.items.post({ document: createJsonApiDocument('items', {}) })
    assert.equal(uploads, 1)
    assert.equal(result.data.attributes.attachment, '/uploads/late')
  })
})

if (storageMode.mode === 'anyapi') {
  describe('Upload discovery after an empty cached schema', () => {
    let database, api, storage, payload, uploads
    before(async () => {
      database = await createTestDatabase()
      uploads = 0
      storage = { async upload () { uploads++; return '/uploads/added' }, async delete () {} }
      api = await createSchemaEnrichmentApi(database.knex)
      await api.use(FileHandlingPlugin)
      api.rest.registerFileDetector({ name: 'added-file-test', detect: () => Boolean(payload), parse: async () => payload })
    })
    beforeEach(async () => { await cleanTables(database.knex, ['schema_enrichment_items']); uploads = 0; payload = null })
    after(async () => { try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) } })
    it('replaces the empty file list when the compiled owner changes', async () => {
      await api.resources.items.post({ document: createJsonApiDocument('items', { name: 'Before' }) })
      await api.resources.items.addKnexFields({
        fields: {
          attachment: { type: 'file', storage, accepts: ['image/png'], nullable: true }
        }
      })
      payload = { fields: { name: 'After' }, files: { attachment: file('image/png') } }
      const result = await api.resources.items.post({ document: createJsonApiDocument('items', {}) })
      assert.equal(uploads, 1)
      assert.equal(result.data.attributes.attachment, '/uploads/added')
    })
  })
}
