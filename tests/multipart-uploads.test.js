import { before, beforeEach, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import { once } from 'node:events'
import express from 'express'
import request from 'supertest'
import knexLib from 'knex'
import { LocalStorage } from '../plugins/storage/local-storage.js'
import { createFileUploadApi } from './fixtures/api-configs.js'
import { cleanTables } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { multipartBody, waitForPartialUpload } from './helpers/multipart.js'

for (const parser of ['busboy', 'formidable']) {
  describe(`Real express multipart (${parser}, ${storageMode.mode})`, () => {
    let api, app, knex, directory, temporary, stored, rollback
    const bytes = Buffer.from([0, 255, 1, 2])
    const file = (data = bytes, name = 'attachment', mimetype = 'image/png') => ({ name, data, filename: 'photo.png', mimetype })
    const title = { name: 'title', data: 'Upload' }
    const send = async (parts, { method = 'post', url = '/api/documents', raw } = {}) => {
      const { body, contentType } = raw || multipartBody(parts)
      return request(app)[method](url).set('Accept', 'application/vnd.api+json').set('Content-Type', contentType).send(body).timeout({ response: 3000, deadline: 5000 })
    }
    const assertEmpty = async () => {
      assert.deepEqual((await api.resources.documents.query()).data, [])
      assert.deepEqual(await readdir(stored), [])
      assert.deepEqual(await readdir(temporary), [])
    }
    before(async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'library-multipart-'))
      temporary = path.join(directory, 'temporary')
      stored = path.join(directory, 'stored')
      await mkdir(temporary)
      await mkdir(stored)
      app = express()
      knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
      api = await createFileUploadApi(knex, {
        app,
        fileParser: parser,
        fileMaxSize: 8,
        fileRequired: true,
        storage: new LocalStorage({ directory: stored, fileBaseUrl: '/uploads' }),
        fileParserOptions: parser === 'busboy'
          ? { limits: { fileSize: 64, files: 2, fields: 4, parts: 6 } }
          : { uploadDir: temporary, maxFileSize: 64, maxFiles: 2, maxFields: 4 }
      })
      await api.customize({
        hooks: { afterRollback: { functionName: 'observe-multipart-rollback', handler: () => rollback?.resolve() } }
      })
      assert.equal(api.anyapi ? 'anyapi' : 'knex', storageMode.mode)
    })
    beforeEach(async () => {
      await cleanTables(knex, ['file_documents'])
      for (const name of await readdir(stored)) await rm(path.join(stored, name))
    })
    after(async () => {
      try { await knex?.destroy() } finally {
        storageMode.clearRegistry(knex)
        await rm(directory, { recursive: true, force: true })
      }
    })

    it('registers the selected real detector', () => {
      assert.deepEqual(api.rest.fileDetectors.map(detector => detector.name), [`express-${parser}-multipart`])
    })

    it('creates a resource and persists the exact uploaded bytes', async () => {
      const response = await send([title, file()])
      assert.equal(response.status, 201, JSON.stringify(response.body))
      assert.equal(response.headers['content-type'], 'application/vnd.api+json')
      const record = response.body.data
      assert.equal(record.attributes.title, 'Upload')
      assert.deepEqual(await readFile(path.join(stored, path.basename(record.attributes.attachment))), bytes)
      assert.equal((await api.resources.documents.get({ id: record.id })).data.attributes.attachment, record.attributes.attachment)
      assert.deepEqual(await readdir(temporary), [])
    })

    it('supports multipart PUT creation with identity taken from the URL', async () => {
      const response = await send([title, file()], { method: 'put', url: '/api/documents/701' })
      assert.equal(response.status, 200, JSON.stringify(response.body))
      assert.equal(response.body.data.id, '701')
      assert.deepEqual(await readFile(path.join(stored, path.basename(response.body.data.attributes.attachment))), bytes)
      assert.deepEqual(await readdir(temporary), [])
    })

    it('updates text fields through multipart PATCH without replacing an omitted file', async () => {
      const created = await send([title, file()])
      assert.equal(created.status, 201, JSON.stringify(created.body))
      const updated = await send([{ name: 'title', data: 'Updated' }], { method: 'patch', url: `/api/documents/${created.body.data.id}` })
      assert.equal(updated.status, 200, JSON.stringify(updated.body))
      assert.equal(updated.body.data.attributes.title, 'Updated')
      assert.equal(updated.body.data.attributes.attachment, created.body.data.attributes.attachment)
      assert.equal((await readdir(stored)).length, 1)
      assert.deepEqual(await readdir(temporary), [])
    })

    it('rejects MIME and schema size violations without retaining files', async () => {
      for (const upload of [file(bytes, 'attachment', 'text/plain'), file(Buffer.alloc(9))]) {
        const response = await send([title, upload])
        assert.equal(response.status, 422, JSON.stringify(response.body))
        await assertEmpty()
      }
      assert.equal((await send([title, file(Buffer.alloc(8))])).status, 201)
    })

    it('uses the resource schema to require a file on creation', async () => {
      assert.equal((await send([title])).status, 422)
      await assertEmpty()
    })

    it('removes an uploaded file when later resource validation rolls back', async () => {
      const response = await send([file()])
      assert.equal(response.status, 422, JSON.stringify(response.body))
      await assertEmpty()
    })

    it('rejects duplicate files and parser limits before persisting anything', async () => {
      for (const [parts, status] of [[[title, file(), file()], 400], [[title, file(Buffer.alloc(65))], 413]]) {
        const response = await send(parts)
        assert.equal(response.status, status, JSON.stringify(response.body))
        await assertEmpty()
      }
    })

    it('rejects malformed multipart instead of falling through to a different detector', async () => {
      const raw = multipartBody([title, file()])
      const response = await send(null, { raw: { ...raw, body: raw.body.subarray(0, raw.body.length - 12) } })
      assert.equal(response.status, 400, JSON.stringify(response.body))
      await assertEmpty()
    })

    it('rejects unknown uploaded fields without orphaning a file', async () => {
      const response = await send([title, file(bytes, 'unknown')])
      assert.equal(response.status, 422, JSON.stringify(response.body))
      await assertEmpty()
    })

    it('keeps prototype-like text fields visible to resource validation', async () => {
      const response = await send([title, { name: '__proto__', data: 'value' }, file()])
      assert.equal(response.status, 422, JSON.stringify(response.body))
      await assertEmpty()
    })

    it('rolls back a canceled real HTTP upload and removes partial files', { timeout: 5000 }, async () => {
      const controller = new AbortController()
      const detector = api.rest.fileDetectors[0]
      const originalParse = detector.parse
      const started = Promise.withResolvers()
      rollback = Promise.withResolvers()
      detector.parse = (...args) => {
        const parsing = originalParse(...args)
        started.resolve()
        return parsing
      }
      const partialWritten = parser === 'formidable'
        ? waitForPartialUpload(temporary, AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]))
        : Promise.resolve()
      const server = app.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const raw = multipartBody([title, file(Buffer.alloc(32))])
      const req = httpRequest({ method: 'POST', path: '/api/documents', hostname: '127.0.0.1', port: server.address().port, headers: { 'content-type': raw.contentType, 'content-length': raw.body.length } })
      req.on('error', () => {})
      try {
        req.write(raw.body.subarray(0, raw.body.length - 30))
        await started.promise
        await partialWritten
        req.destroy()
        await rollback.promise
        await assertEmpty()
      } finally {
        controller.abort()
        req.destroy()
        detector.parse = originalParse
        rollback = undefined
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      }
    })
  })
}
