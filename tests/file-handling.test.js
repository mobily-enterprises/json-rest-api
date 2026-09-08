import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { cleanTables } from './helpers/test-utils.js'
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
    api = await createFileUploadApi(knex, { detectorState, storage })
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['file_documents'])
    detectorState.payload = null
    storage.uploaded = []
    storage.deleted = []
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
        inputRecord: { data: { type: 'documents', attributes: {} } },
        simplified: false
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
        inputRecord: { data: { type: 'documents', attributes: {} } },
        simplified: false
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
        inputRecord: { data: { type: 'documents', attributes: { title: 'Upload' } } }, simplified: false
      }), actual => actual === error)
      assert.equal((await api.resources.documents.query({ simplified: false })).data.length, 0)
    } finally {
      detector.parse = originalParse
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
        inputRecord: { data: { type: 'documents', attributes: {} } }, simplified: false
      }), actual => actual === error)
      assert.equal(cleanupCalls, 1)
      assert.equal((await api.resources.documents.query({ simplified: false })).data.length, 0)
    } finally {
      storage.upload = originalUpload
    }
  })
})
