import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { assertWriteFailure, cleanTables } from './helpers/test-utils.js'
import { createFileUploadApi } from './fixtures/api-configs.js'
import { RestApiPayloadError, RestApiResourceError } from '../lib/rest-api-errors.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api
let detectorState
let storage
const diagnostics = []

function createTrackingStorage () {
  return {
    uploaded: [],
    deleted: [],

    async upload (file) {
      const url = `/uploads/${file.filename}`
      this.uploaded.push(url)
      return url
    },

    async delete (url) {
      this.deleted.push(url)
    }
  }
}

function createTestFile ({ filename = 'upload.png', mimetype = 'image/png', cleanup } = {}) {
  return {
    filename,
    mimetype,
    size: 1,
    data: Buffer.from('x'),
    cleanup
  }
}

describe('File handling cleanup', () => {
  before(async () => {
    detectorState = { payload: null }
    storage = createTrackingStorage()
    api = await createFileUploadApi(knex, {
      detectorState, storage, logging: { logger: { debug: (...args) => diagnostics.push(args) } }
    })
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['file_documents'])
    detectorState.payload = null
    storage.uploaded = []
    storage.deleted = []
    diagnostics.length = 0
  })

  it('bounds detector registration diagnostics without changing detector identity', () => {
    const detector = { name: 'd'.repeat(65536), detect: () => false, parse: () => ({}) }
    api.rest.registerFileDetector(detector)
    assert.equal(api.rest.fileDetectors.at(-1), detector)
    assert.equal(detector.name.length, 65536)
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0][0], /^Registered file detector:/)
    assert.ok(JSON.stringify(diagnostics[0]).length < 10000)
    assert.ok(!JSON.stringify(diagnostics[0]).includes(detector.name))
  })

  it('cleans detector temp files when MIME validation rejects an upload', async () => {
    let cleanupCalls = 0
    detectorState.payload = {
      fields: { title: 'Invalid MIME' },
      files: {
        attachment: createTestFile({
          filename: 'invalid.txt',
          mimetype: 'text/plain',
          cleanup: async () => {
            cleanupCalls++
          }
        })
      }
    }

    await assert.rejects(
      api.resources.documents.post({
        document: { data: { type: 'documents', attributes: {} } },
        format: 'jsonapi'
      }),
      /Invalid file type for field 'attachment'/
    )

    assert.equal(cleanupCalls, 1)
    assert.deepEqual(storage.uploaded, [])
    assert.deepEqual(storage.deleted, [])
  })

  it('deletes uploaded files when a later write validation error rolls back', async () => {
    let cleanupCalls = 0
    detectorState.payload = {
      fields: {},
      files: {
        attachment: createTestFile({
          filename: 'valid.png',
          cleanup: async () => {
            cleanupCalls++
          }
        })
      }
    }

    await assert.rejects(
      api.resources.documents.post({
        document: { data: { type: 'documents', attributes: {} } },
        format: 'jsonapi'
      }),
      /Schema validation failed for resource attributes/
    )

    assert.equal(cleanupCalls, 1)
    assert.deepEqual(storage.uploaded, ['/uploads/valid.png'])
    assert.deepEqual(storage.deleted, ['/uploads/valid.png'])
  })

  it('preserves typed errors from file detectors', async () => {
    const detector = api.rest.fileDetectors[0]
    const originalParse = detector.parse
    const error = new RestApiPayloadError('Malformed upload', { path: 'attachment' })
    detectorState.payload = { fields: { title: 'Upload' }, files: {} }
    detector.parse = async () => { throw error }
    try {
      await assert.rejects(api.resources.documents.post({
        document: { data: { type: 'documents', attributes: { title: 'Upload' } } }, format: 'jsonapi'
      }), actual => assertWriteFailure(actual, { cause: error, outcome: 'rolledBack' }))
      assert.equal((await api.resources.documents.query({ format: 'jsonapi' })).data.length, 0)
    } finally {
      detector.parse = originalParse
    }
  })

  it('does not swallow unexpected errors from a matched detector', async () => {
    const detector = api.rest.fileDetectors[0]
    const originalParse = detector.parse
    const error = new Error('Detector failed')
    detectorState.payload = { fields: {}, files: {} }
    detector.parse = async () => { throw error }
    try {
      await assert.rejects(api.resources.documents.post({ data: { title: 'Document' }, format: 'plain' }), actual => assertWriteFailure(actual, { outcome: 'rolledBack' }) && actual.cause.cause === error)
      assert.equal((await api.resources.documents.query()).data.length, 0)
    } finally { detector.parse = originalParse }
  })

  it('merges uploaded files and text fields into the canonical plain-format input', async () => {
    detectorState.payload = { fields: { title: 'Parsed title' }, files: { attachment: createTestFile() } }
    const result = await api.resources.documents.post({ data: {}, format: 'plain' })
    assert.equal(result.title, 'Parsed title')
    assert.equal(result.attachment, '/uploads/upload.png')
    assert.equal((await api.resources.documents.get({ id: result.id })).data.attributes.attachment, result.attachment)
  })

  it('preserves unknown prototype-like attributes for validation in both formats', async () => {
    for (const format of ['plain', 'jsonapi']) {
      for (const name of ['__proto__', 'constructor', 'toString']) {
        const attributes = { title: 'Rejected', [name]: 'unknown' }
        const inputRecord = format === 'plain' ? attributes : { data: { type: 'documents', attributes } }
        await assert.rejects(api.resources.documents.post({ [format === 'plain' ? 'data' : 'document']: inputRecord, format }), { code: 'REST_API_VALIDATION' })
        assert.equal((await api.resources.documents.query()).data.length, 0)
      }
    }
  })

  it('preserves typed upload errors and still cleans temporary files', async () => {
    const originalUpload = storage.upload
    const error = new RestApiResourceError('Upload forbidden', { subtype: 'forbidden' })
    let cleanupCalls = 0
    detectorState.payload = {
      fields: { title: 'Upload' },
      files: { attachment: createTestFile({ cleanup: async () => { cleanupCalls++ } }) }
    }
    storage.upload = async () => { throw error }
    try {
      await assert.rejects(api.resources.documents.post({
        document: { data: { type: 'documents', attributes: {} } }, format: 'jsonapi'
      }), actual => assertWriteFailure(actual, { cause: error, outcome: 'rolledBack' }))
      assert.equal(cleanupCalls, 1)
      assert.equal((await api.resources.documents.query({ format: 'jsonapi' })).data.length, 0)
    } finally {
      storage.upload = originalUpload
    }
  })
})
