import { before, beforeEach, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createBusboyDetector } from '../plugins/core/connectors/lib/busboy-detector.js'
import { createFormidableDetector } from '../plugins/core/connectors/lib/formidable-detector.js'
import { multipartBody, waitForPartialUpload } from './helpers/multipart.js'

for (const parser of ['busboy', 'formidable']) {
  describe(`Real ${parser} multipart detector`, () => {
    let server, directory, options, result, error, started, finished
    const makeDetector = () => parser === 'busboy' ? createBusboyDetector(options) : createFormidableDetector({ ...options, uploadDir: directory })
    const send = async (parts, raw) => {
      const { body, contentType } = raw || multipartBody(parts)
      return request(server).post('/').set('Content-Type', contentType).send(body).timeout({ response: 3000, deadline: 5000 })
    }
    const file = (name = 'attachment', data = Buffer.from([0, 255, 1, 2])) => ({ name, data, filename: 'photo.png', mimetype: 'image/png' })
    before(async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'library-detector-'))
      await writeFile(path.join(directory, 'unrelated'), 'keep')
      server = createServer(async (req, res) => {
        try {
          const parsing = makeDetector().parse({ _httpReq: req })
          started.resolve()
          result = await parsing
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
        } catch (caught) {
          error = caught
          res.writeHead(caught.statusCode || 500).end(caught.message)
        } finally { finished.resolve() }
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
    })
    beforeEach(() => {
      result = error = undefined
      options = {}
      started = Promise.withResolvers()
      finished = Promise.withResolvers()
    })
    after(async () => {
      server?.closeAllConnections()
      await new Promise(resolve => server?.close(resolve))
      await rm(directory, { recursive: true, force: true })
    })

    it('uses complete media-type detection', () => {
      const detector = makeDetector()
      assert.equal(detector.detect({ _httpReq: { headers: { 'content-type': 'Multipart/Form-Data; boundary=test' } } }), true)
      assert.equal(detector.detect({ _httpReq: { headers: { 'content-type': 'text/plain; note="multipart/form-data"' } } }), false)
    })

    it('parses binary contents, filename, MIME type and fields without leaving temp files', async () => {
      assert.equal((await send([{ name: 'title', data: 'Photo' }, file()])).status, 200, error?.stack)
      assert.deepEqual(result.fields, { title: 'Photo' })
      assert.equal(result.files.attachment.filename, 'photo.png')
      assert.equal(result.files.attachment.mimetype, 'image/png')
      assert.equal(result.files.attachment.size, 4)
      assert.deepEqual(result.files.attachment.data, file().data)
      assert.deepEqual(await readdir(directory), ['unrelated'])
    })

    it('preserves UTF-8 filenames, empty files and repeated text fields', async () => {
      assert.equal((await send([
        { name: 'tags[]', data: 'one' }, { name: 'tags[]', data: 'two' },
        { name: 'title', data: 'first' }, { name: 'title', data: 'second' },
        { ...file(), filename: 'café.png', data: Buffer.alloc(0) }
      ])).status, 200, error?.stack)
      assert.deepEqual(result.fields, { tags: ['one', 'two'], title: ['first', 'second'] })
      assert.equal(result.files.attachment.filename, 'café.png')
      assert.equal(result.files.attachment.size, 0)
      assert.deepEqual(await readdir(directory), ['unrelated'])
    })

    it('preserves prototype-like names as ordinary own properties', async () => {
      assert.equal((await send([{ name: '__proto__', data: 'value' }, { name: 'constructor', data: 'name' }])).status, 200, error?.stack)
      assert.equal(Object.getPrototypeOf(result.fields), Object.prototype)
      assert.equal(Object.getOwnPropertyDescriptor(result.fields, '__proto__')?.value, 'value')
      assert.equal(result.fields.constructor, 'name')
    })

    it('keeps simultaneous uploads independent and preserves unrelated files', async () => {
      const responses = await Promise.all(['first', 'second'].map(data => send([{ name: 'title', data }, file('attachment', Buffer.from(data))])))
      for (const [index, value] of ['first', 'second'].entries()) {
        assert.equal(responses[index].status, 200)
        assert.equal(responses[index].body.fields.title, value)
        assert.deepEqual(responses[index].body.files.attachment.data.data, [...Buffer.from(value)])
      }
      assert.deepEqual(await readdir(directory), ['unrelated'])
    })

    it('rejects repeated file fields without keeping a first or last file', async () => {
      assert.equal((await send([file(), file()])).status, 400)
      assert.equal(error.code, 'REST_API_PAYLOAD')
      assert.equal(result, undefined)
      assert.deepEqual(await readdir(directory), ['unrelated'])
    })

    it('accepts the exact file-size limit and rejects one byte over', async () => {
      options = parser === 'busboy' ? { limits: { fileSize: 8 } } : { maxFileSize: 8 }
      assert.equal((await send([file('attachment', Buffer.alloc(8))])).status, 200, error?.stack)
      result = undefined
      assert.equal((await send([file('attachment', Buffer.alloc(9))])).status, 413)
      assert.equal(result, undefined)
      assert.deepEqual(await readdir(directory), ['unrelated'])
    })

    it('rejects oversized text fields and extra files or fields', async () => {
      options = parser === 'busboy' ? { limits: { fieldSize: 8 } } : { maxFieldsSize: 8 }
      assert.equal((await send([{ name: 'title', data: '12345678' }])).status, 200)
      for (const [busboy, formidable, parts] of [
        [{ limits: { fieldSize: 8 } }, { maxFieldsSize: 8 }, [{ name: 'title', data: '123456789' }]],
        [{ limits: { fields: 1 } }, { maxFields: 1 }, [{ name: 'a', data: 'one' }, { name: 'b', data: 'two' }]],
        [{ limits: { files: 1 } }, { maxFiles: 1 }, [file('one'), file('two')]]
      ]) {
        options = parser === 'busboy' ? busboy : formidable
        assert.equal((await send(parts)).status, 413, error?.stack)
        assert.deepEqual(await readdir(directory), ['unrelated'])
      }
      if (parser === 'busboy') {
        options = { limits: { parts: 1 } }
        assert.equal((await send([file()])).status, 200)
        assert.equal((await send([file(), { name: 'title', data: 'extra' }])).status, 413)
      }
    })

    it('rejects missing boundaries and truncated multipart bodies', async () => {
      const raw = multipartBody([file()])
      for (const malformed of [
        { body: raw.body, contentType: 'multipart/form-data' },
        { ...raw, body: raw.body.subarray(0, raw.body.length - 12) }
      ]) {
        assert.equal((await send(null, malformed)).status, 400, error?.stack)
        assert.deepEqual(await readdir(directory), ['unrelated'])
      }
    })

    it('settles an aborted real HTTP upload and removes partial temp files', { timeout: 5000 }, async () => {
      const controller = new AbortController()
      const partialWritten = parser === 'formidable'
        ? waitForPartialUpload(directory, AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]))
        : Promise.resolve()
      const raw = multipartBody([file('attachment', Buffer.alloc(128))])
      const req = httpRequest({ method: 'POST', hostname: '127.0.0.1', port: server.address().port, headers: { 'content-type': raw.contentType, 'content-length': raw.body.length } })
      req.on('error', () => {})
      try {
        req.write(raw.body.subarray(0, raw.body.length - 30))
        await started.promise
        await partialWritten
        req.destroy()
        await finished.promise
        assert.equal(error?.code, 'REST_API_PAYLOAD')
        assert.deepEqual(await readdir(directory), ['unrelated'])
      } finally { controller.abort(); req.destroy() }
    })
  })
}

it('observes partial upload bytes that exist before the cancellation wait starts', { timeout: 2000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'library-partial-wait-'))
  try {
    const upload = await mkdtemp(path.join(directory, 'json-rest-upload-'))
    await writeFile(path.join(upload, 'partial'), Buffer.from([0, 1]))
    await waitForPartialUpload(directory, AbortSignal.timeout(1000))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
