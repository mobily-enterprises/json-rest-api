import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import express from 'express'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createFileUploadApi } from './fixtures/api-configs.js'
import { assertWriteFailure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { abortTransactionBeforeCommit } from './helpers/transaction-completion.js'
import { normalizeAttributes } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'
import { LocalStorage } from '../plugins/storage/local-storage.js'

const exists = async path => {
  try { await stat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
const originalCause = error => {
  while (error && typeof error === 'object' && Object.hasOwn(error, 'cause')) error = error.cause
  return error
}

describe(`Stored file handles (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: knex => createFileUploadApi(knex, { storage: { upload: async () => { throw new Error('Unexpected upload') } } }),
      tables: { documents: 'file_documents' }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    it(`round-trips Unicode file handles through ${format} writes and reads`, async () => {
      const resource = fixture.api.resources.documents
      const attributes = { title: 'Document', attachment: '/uploads/été-😀.png' }
      const input = () => format === 'plain' ? { ...attributes } : { data: { type: 'documents', attributes: { ...attributes } } }
      const fields = result => format === 'plain' ? result : result.data.attributes
      const created = await resource.post({ inputRecord: input(), format })
      const id = format === 'plain' ? created.id : created.data.id
      assert.deepEqual(fields(created).attachment, attributes.attachment)
      for (const method of ['patch', 'put']) {
        attributes.attachment = `/uploads/${method}-日本語.png`
        assert.equal(fields(await resource[method]({ id, inputRecord: input(), format })).attachment, attributes.attachment)
        assert.equal(fields(await resource.get({ id, format })).attachment, attributes.attachment)
        const records = (await resource.query({ format })).data
        assert.equal((format === 'plain' ? records[0] : records[0].attributes).attachment, attributes.attachment)
      }
    })
  }

  it('decodes file bytes without changing blobs, nulls, missing fields or the input', () => {
    const expected = '\uFEFF/uploads/été-😀.png'
    const bytes = Buffer.from(expected)
    const padded = Buffer.concat([Buffer.from('prefix'), bytes, Buffer.from('suffix')])
    for (const value of [expected, bytes, new Uint8Array(padded.buffer, padded.byteOffset + 6, bytes.length)]) {
      const input = { attachment: value, bytes, absent: null }
      const result = normalizeAttributes(input, { attachment: { type: 'file' }, bytes: { type: 'blob' }, absent: { type: 'file' }, missing: { type: 'file' } })
      assert.equal(result.attachment, expected)
      assert.equal(result.bytes, bytes)
      assert.equal(result.absent, null)
      assert.equal(Object.hasOwn(result, 'missing'), false)
      assert.equal(input.attachment, value)
    }
  })

  it('rejects invalid UTF-8 file bytes with their normalization cause and field context', () => {
    for (const source of ['database', 'response']) {
      assert.throws(() => normalizeAttributes({ attachment: Buffer.from([0xc3, 0x28]) }, { attachment: { type: 'file' } }, { resourceType: 'documents', source }), error => {
        assert.ok(error.cause instanceof TypeError)
        assert.deepEqual(error.context, { fieldName: 'attachment', resourceType: 'documents', source, phase: 'normalization' })
        return true
      })
    }
  })

  it('lets a custom file getter decode stored bytes before normalizing its response', () => {
    const bytes = Buffer.from('/uploads/custom.png')
    const schema = { attachment: { type: 'file', getter: () => '/uploads/custom.png' } }
    assert.equal(normalizeAttributes({ attachment: bytes }, schema).attachment, bytes)
    assert.equal(normalizeAttributes({ attachment: bytes }, schema, { source: 'response' }).attachment, '/uploads/custom.png')
  })
})

describe(`File cleanup diagnostic previews (${storageMode.mode})`, () => {
  let fixture, cleanupError, writeFailure, deleted
  const detectorState = { payload: null }
  const primary = new Error('Write rejected after upload')
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: knex => createFileUploadApi(knex, {
        storage: {
          upload: async () => '/stored/attachment.png',
          delete: async url => { deleted.push(url) }
        },
        detectorState,
        hooks: {
          'schema:enrich': {
            functionName: 'declare-private-file-diagnostic-field',
            handler: ({ context }) => { context.fields.accessKey = { type: 'string', hidden: true } }
          },
          finishPost: {
            functionName: 'reject-file-diagnostic-write',
            handler: () => { if (writeFailure) throw primary }
          }
        }
      }),
      tables: { documents: 'file_documents' }
    })
  })
  beforeEach(async () => {
    writeFailure = false
    deleted = []
    detectorState.payload = null
    await fixture.reset()
    cleanupError = Object.assign(new Error('Temporary cleanup failed'), {
      details: { accessKey: 'PRIVATE_FILE_KEY', data: Buffer.from('PRIVATE_BYTES'), large: 'x'.repeat(100000) }
    })
    detectorState.payload = {
      fields: { title: 'Document' },
      files: {
        attachment: {
          filename: 'attachment.png',
          mimetype: 'image/png',
          size: 4,
          data: Buffer.from('data'),
          cleanup: async () => { throw cleanupError }
        }
      }
    }
  })
  after(async () => { await fixture?.close() })
  for (const format of ['jsonapi', 'plain']) {
    for (const failed of [false, true]) {
      it(`${format} bounds and redacts cleanup warnings after a ${failed ? 'failed' : 'successful'} write`, async t => {
        const calls = []
        t.mock.method(console, 'warn', (...args) => { calls.push(args) })
        const context = {}
        writeFailure = failed
        const operation = fixture.api.resources.documents.post({
          format, inputRecord: format === 'plain' ? {} : { data: { type: 'documents', attributes: {} } }
        }, context)
        if (failed) await assert.rejects(operation, error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
        else await operation
        const warning = calls.find(args => String(args[0]).includes('File cleanup failed'))
        assert.ok(warning)
        assert.equal(warning[1].scopeName, 'documents')
        assert.equal(warning[1].method, 'post')
        assert.equal(warning[1].phase, 'temporaryFileCleanup')
        assert.equal(warning[1].backend, fixture.knex.client.config.client)
        assert.equal(warning[1].transactionOutcome, 'pending')
        const output = JSON.stringify(warning)
        assert.ok(output.length < 30000, 'Cleanup diagnostic must be bounded')
        assert.ok(!output.includes('PRIVATE_FILE_KEY'))
        assert.match(output, /byteLength/)
        assert.match(output, /Redacted/)
        assert.equal(context.cleanupErrors[0].error, cleanupError)
        assert.equal(cleanupError.details.data.toString(), 'PRIVATE_BYTES')
        assert.equal(await fixture.count('documents'), failed ? 0 : 1)
        assert.deepEqual(deleted, failed ? ['/stored/attachment.png'] : [])
      })
    }
  }
})

describe(`File cleanup failure boundaries (${storageMode.mode})`, () => {
  let fixture, directory, probe, detectorState, temporary, stored, cleaned, deleted
  const primary = new RestApiValidationError('Write failed after uploads')
  const cleanupError = new Error('File cleanup failed')
  const loggingError = new Error('Cleanup warning failed')
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jra-file-failures-'))
    detectorState = { payload: null }
    const storage = {
      async upload (file) {
        if (probe.uploadFailure) throw probe.error
        const path = join(directory, 'stored', file.filename)
        await copyFile(file.filepath, path)
        stored.push(path)
        return path
      },
      async delete (path) {
        deleted.push(path)
        if (probe.deleteFailure && path === stored[0]) throw cleanupError
        await unlink(path)
      }
    }
    fixture = await createConformanceFixture({
      createApi: knex => createFileUploadApi(knex, { storage, detectorState, fileFields: ['attachment', 'thumbnail'] }),
      tables: { documents: 'file_documents' }
    })
    await fixture.api.customize({
      helpers: { newTransaction: () => probe.parent ? probe.parent.transaction() : fixture.knex.transaction() },
      hooks: {
        finish: {
          functionName: 'fail-managed-uploaded-write',
          handler: ({ context }) => { if (context.failManagedWrite) throw primary }
        },
        afterCommit: {
          functionName: 'observe-managed-file-commit',
          afterFunction: 'releaseUploadedFiles',
          handler: ({ context }) => {
            context.fileCompletions?.push([context.fileOperation, 'committed'])
            if (context.failManagedCompletion) throw cleanupError
          }
        },
        afterRollback: {
          functionName: 'observe-managed-file-rollback',
          afterFunction: 'cleanupUploadedFiles',
          handler: ({ context }) => {
            context.fileCompletions?.push([context.fileOperation, 'rolledBack'])
            if (context.failManagedCompletion) throw cleanupError
          }
        },
        finishPost: {
          functionName: 'fail-uploaded-write',
          handler: ({ context }) => {
            if (probe.writeFailure) throw primary
            if (probe.abortCommit) probe.completion = abortTransactionBeforeCommit(context.transaction)
            if (probe.commitRejection) {
              const commit = context.transaction.commit.bind(context.transaction)
              const rollback = context.transaction.rollback.bind(context.transaction)
              context.transaction.commit = async () => { await commit(); throw primary }
              context.transaction.rollback = async () => { probe.rollbackAttempts++; return rollback() }
            }
          }
        }
      }
    })
  })
  beforeEach(async () => {
    probe = {}
    detectorState.payload = null
    temporary = []
    stored = []
    cleaned = []
    deleted = []
    await fixture.reset()
    for (const name of ['temporary', 'stored']) {
      await rm(join(directory, name), { recursive: true, force: true })
      await mkdir(join(directory, name))
    }
  })
  after(async () => {
    try { await fixture?.close() } finally { if (directory) await rm(directory, { recursive: true, force: true }) }
  })

  const prepare = async (tag = '') => {
    const files = {}
    for (const field of ['attachment', 'thumbnail']) {
      const filename = `${tag}${field}.png`
      const filepath = join(directory, 'temporary', filename)
      await writeFile(filepath, 'x')
      temporary.push(filepath)
      files[field] = {
        filename,
        filepath,
        mimetype: 'image/png',
        size: 1,
        cleanup: async () => {
          cleaned.push(filepath)
          if (probe.temporaryFailure && field === 'attachment') throw cleanupError
          await unlink(filepath)
        }
      }
    }
    detectorState.payload = { fields: { title: 'Document' }, files }
  }
  const post = (format, context, transaction) => fixture.api.resources.documents.post({
    inputRecord: format === 'plain' ? {} : { data: { type: 'documents', attributes: {} } }, format, transaction
  }, context)
  const failWarnings = t => {
    const warn = console.warn
    t.mock.method(console, 'warn', (...args) => {
      if (probe.loggingFailure) throw loggingError
      return warn(...args)
    })
  }

  for (const format of ['jsonapi', 'plain']) {
    for (const existing of [false, true]) {
      for (const outcome of ['commit', 'callback failure', 'caught write failure']) {
        it(`${format} completes managed uploads in order after ${outcome}, including repeated writes to a ${existing ? 'stored' : 'new'} record`, async () => {
          await prepare('original-')
          const original = await post(format, {})
          const idOf = result => format === 'plain' ? result.id : result.data.id
          const attributesOf = result => format === 'plain' ? result : result.data.attributes
          const originalId = idOf(original)
          const originalFiles = [...stored]
          const fileCompletions = []
          const contexts = Array.from({ length: 3 }, (_, fileOperation) => ({ fileOperation, fileCompletions }))
          const owner = {}
          let id
          const work = fixture.api.transaction(async transaction => {
            await prepare('first-')
            if (existing) {
              id = originalId
              await fixture.api.resources.documents.patch({
                id,
                transaction,
                format,
                inputRecord: format === 'plain' ? {} : { data: { type: 'documents', attributes: {} } }
              }, contexts[0])
            } else id = idOf(await post(format, contexts[0], transaction))
            await prepare('second-')
            contexts[1].failManagedWrite = outcome === 'caught write failure'
            const patch = fixture.api.resources.documents.patch({
              id,
              transaction,
              format,
              inputRecord: format === 'plain' ? {} : { data: { type: 'documents', attributes: {} } }
            }, contexts[1])
            if (outcome === 'caught write failure') {
              await assert.rejects(patch, error => assertWriteFailure(error, { cause: primary, outcome: 'pending' }))
            } else {
              await patch
              await prepare('third-')
              await post(format, contexts[2], transaction)
              const staged = attributesOf(await fixture.api.resources.documents.get({ id, transaction, format }))
              assert.equal(staged.attachment, stored[4])
              assert.equal(staged.thumbnail, stored[5])
            }
            assert.deepEqual(fileCompletions, [])
            assert.deepEqual(deleted, [])
            for (const path of stored) assert.equal(await exists(path), true)
            for (const path of temporary) assert.equal(await exists(path), false)
            const accepted = outcome === 'caught write failure' ? 2 : 3
            for (const context of contexts.slice(0, accepted)) {
              assert.equal(context.transactionCommitted, false)
              assert.equal(context.fileHandlingUploads.length, 2)
            }
            if (outcome === 'callback failure') throw primary
            return id
          }, owner)
          if (outcome === 'commit') assert.equal(await work, id)
          else await assert.rejects(work, error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
          const committed = outcome === 'commit'
          const accepted = outcome === 'caught write failure' ? 2 : 3
          const order = Array.from({ length: accepted }, (_, index) => index)
          if (!committed) order.reverse()
          assert.deepEqual(fileCompletions, order.map(index => [index, committed ? 'committed' : 'rolledBack']))
          assert.equal(owner.transactionOutcome, committed ? 'committed' : 'rolledBack')
          for (const context of contexts.slice(0, accepted)) {
            assert.deepEqual(context.fileHandlingUploads, [])
            assert.equal(context.transactionOutcome, owner.transactionOutcome)
          }
          const uploaded = stored.slice(2)
          assert.deepEqual(deleted, committed ? [] : order.flatMap(index => uploaded.slice(index * 2, index * 2 + 2)))
          for (const path of originalFiles) assert.equal(await exists(path), true)
          if (committed) {
            const row = attributesOf(await fixture.api.resources.documents.get({ id, format }))
            for (const field of ['attachment', 'thumbnail']) assert.equal(await exists(row[field]), true)
          } else {
            for (const path of uploaded) assert.equal(await exists(path), false)
            const restored = attributesOf(await fixture.api.resources.documents.get({ id: originalId, format }))
            assert.equal(restored.attachment, originalFiles[0])
            assert.equal(restored.thumbnail, originalFiles[1])
          }
          assert.equal(await fixture.count('documents'), committed ? existing ? 2 : 3 : 1)
        })
      }
    }

    for (const committed of [false, true]) {
      it(`${format} attempts later managed file completion chains after a ${committed ? 'commit' : 'rollback'} hook fails`, async () => {
        const fileCompletions = []
        const contexts = [0, 1, 2].map(fileOperation => ({ fileOperation, fileCompletions, failManagedCompletion: fileOperation !== 1 }))
        const owner = {}
        await assert.rejects(fixture.api.transaction(async transaction => {
          for (const [index, context] of contexts.entries()) {
            await prepare(`${index}-`)
            await post(format, context, transaction)
          }
          if (!committed) throw primary
        }, owner), error => assertWriteFailure(error, { cause: committed ? cleanupError : primary, outcome: committed ? 'committed' : 'rolledBack' }))
        assert.deepEqual(fileCompletions, (committed ? [0, 1, 2] : [2, 1, 0]).map(index => [index, committed ? 'committed' : 'rolledBack']))
        assert.deepEqual(owner.cleanupErrors, (committed ? [2] : [2, 0]).map(operationIndex => ({
          phase: committed ? 'afterCommit' : 'afterRollback', error: cleanupError, operationIndex, scopeName: 'documents', method: 'post'
        })))
        for (const context of contexts) assert.deepEqual(context.fileHandlingUploads, [])
        for (const path of stored) assert.equal(await exists(path), committed)
        for (const path of temporary) assert.equal(await exists(path), false)
        assert.equal(await fixture.count('documents'), committed ? 3 : 0)
      })
    }

    it(`${format} retains failed managed upload cleanup and still deletes the other files after replacement and deletion roll back`, async () => {
      await prepare('original-')
      const original = await post(format, {})
      const id = format === 'plain' ? original.id : original.data.id
      const originalFiles = [...stored]
      stored = []
      probe.deleteFailure = true
      const contexts = [{}, {}, {}]
      const owner = {}
      await assert.rejects(fixture.api.transaction(async transaction => {
        for (const index of [0, 1]) {
          await prepare(`replacement-${index}-`)
          await fixture.api.resources.documents.patch({
            id,
            transaction,
            format,
            inputRecord: format === 'plain' ? {} : { data: { type: 'documents', attributes: {} } }
          }, contexts[index])
        }
        await fixture.api.resources.documents.delete({ id, transaction }, contexts[2])
        assert.deepEqual(deleted, [])
        throw primary
      }, owner), error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
      assert.deepEqual(deleted, [...stored.slice(2), ...stored.slice(0, 2)])
      for (const [index, path] of stored.entries()) assert.equal(await exists(path), index === 0)
      for (const path of originalFiles) assert.equal(await exists(path), true)
      for (const path of temporary) assert.equal(await exists(path), false)
      assert.deepEqual(contexts[0].cleanupErrors, [{ phase: 'uploadedFileCleanup', field: 'attachment', error: cleanupError }])
      assert.deepEqual(contexts[0].fileHandlingUploads.map(upload => upload.url), [stored[0]])
      assert.deepEqual(contexts[1].fileHandlingUploads, [])
      const restored = await fixture.api.resources.documents.get({ id, format: 'plain' })
      assert.equal(restored.attachment, originalFiles[0])
      assert.equal(restored.thumbnail, originalFiles[1])
      assert.equal(await fixture.count('documents'), 1)
    })

    it(`${format} rejects an owned savepoint before processing or uploading files`, async () => {
      await prepare()
      probe.parent = await fixture.knex.transaction()
      const context = {}
      try {
        await assert.rejects(post(format, context), error => {
          assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' })
          assert.match(error.message, /owned transactions must be top-level/i)
          return true
        })
        assert.equal(context.transaction.parentTransaction, probe.parent)
        assert.equal(context.transaction.isCompleted(), true)
        assert.equal(context.transactionCommitted, false)
        assert.equal(probe.parent.isCompleted(), false)
        assert.deepEqual(stored, [])
        assert.deepEqual(deleted, [])
        assert.deepEqual(cleaned, [])
        assert.deepEqual(context.cleanupErrors, [])
        assert.equal(context.fileHandlingUploads, undefined)
        for (const path of temporary) assert.equal(await exists(path), true)
        await probe.parent.commit()
      } finally {
        if (context.transaction && !context.transaction.isCompleted()) await context.transaction.rollback()
        if (!probe.parent.isCompleted()) await probe.parent.rollback()
      }
      assert.equal(await fixture.count('documents'), 0)
    })

    if (databaseClient === 'pg') {
      for (const deleteFailure of [false, true]) {
        it(`${format} cleans uploads after a PostgreSQL commit rolls back with ${deleteFailure ? 'failed' : 'successful'} file deletion`, async () => {
          probe = { abortCommit: true, deleteFailure }
          await prepare()
          const context = {}
          let error
          try {
            try { await post(format, context) } catch (caught) { error = caught }
            assert.equal(probe.completion.command, 'ROLLBACK')
            assert.equal(probe.completion.resolved, true)
            assert.equal(probe.completion.commits, 1)
            assert.equal(probe.completion.rollbacks, 0)
          } finally { await probe.completion?.close() }
          assert.equal(await fixture.count('documents'), 0)
          assert.ok(error instanceof Error, 'Uploaded writes must reject a confirmed rollback')
          assert.match(error.message, /rolled back instead of committed/i)
          assert.equal(context.error, error.cause)
          assert.equal(context.transactionCommitted, false)
          assert.deepEqual(deleted, stored)
          assert.deepEqual(cleaned, temporary)
          assert.equal(await exists(stored[0]), deleteFailure)
          assert.equal(await exists(stored[1]), false)
          for (const path of temporary) assert.equal(await exists(path), false)
          assert.deepEqual(context.cleanupErrors, deleteFailure ? [{ phase: 'uploadedFileCleanup', field: 'attachment', error: cleanupError }] : [])
          assert.deepEqual(context.fileHandlingUploads.map(upload => upload.url), deleteFailure ? [stored[0]] : [])
        })
      }
    }

    it(`${format} preserves committed uploads if the commit wrapper rejects after completion`, async () => {
      probe = { commitRejection: true, rollbackAttempts: 0 }
      await prepare()
      const context = {}
      await assert.rejects(post(format, context), error => assertWriteFailure(error, { cause: primary }))
      assert.equal(context.transaction.isCompleted(), true)
      assert.equal(context.transactionCommitted, false)
      assert.equal(probe.rollbackAttempts, 0)
      assert.deepEqual(deleted, [])
      for (const path of stored) assert.equal(await exists(path), true)
      assert.equal(await fixture.count('documents'), 1)
    })

    for (const method of ['detect', 'parse']) {
      for (const value of [null, undefined]) {
        it(`${format} retains ${String(value)} from detector ${method}`, async t => {
          detectorState.payload = { fields: {}, files: {} }
          t.mock.method(fixture.api.rest.fileDetectors[0], method, async () => { throw value })
          await assert.rejects(post(format, {}), error => originalCause(error) === value)
          assert.equal(await fixture.count('documents'), 0)
        })
      }
    }
    for (const writeFailure of [false, true]) {
      for (const loggingFailure of [false, true]) {
        it(`${format} retains temporary cleanup diagnostics and cleans later files with ${writeFailure ? 'failed' : 'successful'} write and ${loggingFailure ? 'failed' : 'successful'} warning`, async t => {
          probe = { temporaryFailure: true, writeFailure, loggingFailure }
          await prepare()
          failWarnings(t)
          const context = {}
          if (writeFailure) await assert.rejects(post(format, context), error => assertWriteFailure(error, { cause: primary }))
          else await post(format, context)
          assert.deepEqual(cleaned, temporary)
          assert.equal(await exists(temporary[0]), true)
          assert.equal(await exists(temporary[1]), false)
          assert.deepEqual(context.cleanupErrors, [
            { phase: 'temporaryFileCleanup', field: 'attachment', error: cleanupError },
            ...(loggingFailure ? [{ phase: 'logging', during: 'temporaryFileCleanup', field: 'attachment', error: loggingError }] : [])
          ])
          assert.equal(await fixture.count('documents'), writeFailure ? 0 : 1)
          for (const path of stored) assert.equal(await exists(path), !writeFailure)
        })

        if (!writeFailure) {
          it(`${format} records failed deletion and attempts later uploads with ${loggingFailure ? 'failed' : 'successful'} warning`, async t => {
            probe = { writeFailure: true, deleteFailure: true, loggingFailure }
            await prepare()
            failWarnings(t)
            const context = {}
            await assert.rejects(post(format, context), error => assertWriteFailure(error, { cause: primary }))
            assert.deepEqual(deleted, stored)
            assert.equal(await exists(stored[0]), true)
            assert.equal(await exists(stored[1]), false)
            assert.deepEqual(context.cleanupErrors, [
              { phase: 'uploadedFileCleanup', field: 'attachment', error: cleanupError },
              ...(loggingFailure ? [{ phase: 'logging', during: 'uploadedFileCleanup', field: 'attachment', error: loggingError }] : [])
            ])
            assert.deepEqual(context.fileHandlingUploads.map(upload => upload.url), [stored[0]])
            assert.equal(await fixture.count('documents'), 0)
          })
        }
      }
    }

    for (const [label, error] of [['typed', new RestApiResourceError('Upload forbidden', { subtype: 'forbidden' })], ['frozen', Object.freeze(new Error('Storage failed'))], ['null', null], ['undefined', undefined], ['string', 'Storage failed']]) {
      it(`${format} preserves ${label} upload failure and cleans every temporary file`, async () => {
        probe = { uploadFailure: true, error }
        await prepare()
        await assert.rejects(post(format, {}), actual => {
          assert.equal(originalCause(actual), error)
          if (error instanceof RestApiResourceError) assertWriteFailure(actual, { cause: error })
          else assert.ok(!(actual instanceof RestApiValidationError))
          return true
        })
        assert.deepEqual(cleaned, temporary)
        for (const path of temporary) assert.equal(await exists(path), false)
        assert.equal(await fixture.count('documents'), 0)
      })
    }

    for (const managed of [false, true]) {
      it(`${format} does not delete an earlier ${managed ? 'helper-committed' : 'owned-committed'} upload when context reuse fails`, async () => {
        await prepare()
        const context = {}
        if (managed) await fixture.api.transaction(transaction => post(format, context, transaction))
        else await post(format, context)
        const previousFiles = [...stored]
        detectorState.payload = null
        await assert.rejects(post(format, context), error => assertWriteFailure(error, { type: RestApiValidationError }))
        assert.deepEqual(deleted, [])
        for (const path of previousFiles) assert.equal(await exists(path), true)
        assert.equal(await fixture.count('documents'), 1)
      })
    }
  }
})

describe(`LocalStorage managed rollback (${storageMode.mode})`, () => {
  let fixture, directory, storage, detectorState, failRelationship, changedNote
  const primary = new RestApiValidationError('Reject replacement upload')
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jra-local-managed-'))
    storage = new LocalStorage({ directory, nameStrategy: 'original' })
    detectorState = { payload: null }
    fixture = await createConformanceFixture({
      createApi: knex => createFileUploadApi(knex, { storage, detectorState, withNotes: true }),
      tables: { notes: 'file_notes', documents: 'file_documents' }
    })
    await fixture.api.customize({
      hooks: {
        finishPatch: {
          functionName: 'reject-local-replacement',
          handler: async ({ context, scopeName }) => {
            if (context.failReplacement) throw primary
            if (failRelationship && scopeName === 'notes') {
              changedNote = await fixture.api.resources.notes.getRelationship({ id: context.id, relationshipName: 'document', transaction: context.transaction })
              throw primary
            }
          }
        }
      }
    })
  })
  beforeEach(async () => {
    detectorState.payload = null
    failRelationship = false
    changedNote = undefined
    await fixture.reset()
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory)
  })
  after(async () => {
    try { await fixture?.close() } finally { if (directory) await rm(directory, { recursive: true, force: true }) }
  })
  const payload = data => ({
    fields: { title: 'Document' },
    files: {
      attachment: { filename: 'shared.png', mimetype: 'image/png', size: data.length, data: Buffer.from(data) }
    }
  })
  for (const format of ['jsonapi', 'plain']) {
    const inputRecord = (attributes = {}) => format === 'plain' ? attributes : { data: { type: 'documents', attributes } }
    const idOf = result => format === 'plain' ? result.id : result.data.id
    for (const method of ['patch', 'put', 'delete']) {
      for (const commit of [false, true]) {
        it(`${format} retains shared committed files after ${method} ${commit ? 'commit' : 'rollback'}`, async () => {
          detectorState.payload = payload('shared committed bytes')
          const first = await fixture.api.resources.documents.post({ inputRecord: inputRecord(), format })
          const id = idOf(first)
          detectorState.payload = null
          const second = await fixture.api.resources.documents.post({
            inputRecord: inputRecord({ title: 'Second owner', attachment: '/uploads/shared.png' }), format
          })
          if (method !== 'delete') detectorState.payload = payload('replacement bytes')
          const context = {}
          const work = fixture.api.transaction(async transaction => {
            await fixture.api.resources.documents[method]({ id, transaction, format, ...(method === 'delete' ? {} : { inputRecord: inputRecord() }) }, context)
            assert.equal(await readFile(join(directory, 'shared.png'), 'utf8'), 'shared committed bytes')
            if (method !== 'delete') assert.equal(await readFile(join(directory, 'shared_1.png'), 'utf8'), 'replacement bytes')
            if (!commit) throw primary
          })
          if (commit) await work
          else await assert.rejects(work, error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
          detectorState.payload = null
          assert.equal((await fixture.api.resources.documents.get({ id: idOf(second), format: 'plain' })).attachment, '/uploads/shared.png')
          assert.equal(await readFile(join(directory, 'shared.png'), 'utf8'), 'shared committed bytes')
          assert.equal(await exists(join(directory, 'shared_1.png')), commit && method !== 'delete')
          if (!commit || method !== 'delete') {
            const row = await fixture.api.resources.documents.get({ id, format: 'plain' })
            assert.equal(row.attachment, commit ? '/uploads/shared_1.png' : '/uploads/shared.png')
          }
          assert.equal(await fixture.count('documents'), commit && method === 'delete' ? 1 : 2)
          assert.deepEqual(context.fileHandlingUploads || [], [])
          assert.deepEqual(context.cleanupErrors || [], [])
          // Committed storage objects are application-owned even after the last reference goes.
          await fixture.api.resources.documents.delete({ id: idOf(second) })
          if (!commit || method !== 'delete') await fixture.api.resources.documents.delete({ id })
          assert.equal(await fixture.count('documents'), 0)
          assert.equal(await readFile(join(directory, 'shared.png'), 'utf8'), 'shared committed bytes')
          assert.equal(await exists(join(directory, 'shared_1.png')), commit && method !== 'delete')
        })
      }
    }

    it(`${format} cleans a new upload after the real document insert rejects a duplicate ID`, async () => {
      const original = await fixture.api.resources.documents.post({ inputRecord: inputRecord({ title: 'Existing' }), format })
      detectorState.payload = payload('failed duplicate bytes')
      const record = inputRecord()
      if (format === 'plain') record.id = idOf(original)
      else record.data.id = idOf(original)
      let databaseError
      const capture = error => { databaseError = error }
      const context = {}
      fixture.knex.on('query-error', capture)
      try {
        await assert.rejects(fixture.api.resources.documents.post({ inputRecord: record, format }, context), error => {
          assert.ok(databaseError, 'The failure must come from an executed SQL statement')
          assert.equal(originalCause(error), databaseError)
          return assertWriteFailure(error, { outcome: 'rolledBack' })
        })
      } finally { fixture.knex.off('query-error', capture) }
      assert.equal(await exists(join(directory, 'shared.png')), false)
      assert.equal(await fixture.count('documents'), 1)
      assert.deepEqual(context.fileHandlingUploads, [])
    })

    it(`${format} rolls back the document, changed child and upload after a relationship write fails`, async () => {
      const note = await fixture.seed('notes', { text: 'Unlinked note' })
      detectorState.payload = payload('relationship upload bytes')
      const record = format === 'plain'
        ? { notes: [note.id] }
        : { data: { type: 'documents', attributes: {}, relationships: { notes: { data: [{ type: 'notes', id: note.id }] } } } }
      failRelationship = true
      const context = {}
      await assert.rejects(fixture.api.resources.documents.post({ inputRecord: record, format }, context), error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
      assert.ok(changedNote?.data?.id, 'The child relationship was written before its finish hook rejected')
      assert.equal(await fixture.count('documents'), 0)
      assert.equal(await fixture.count('notes'), 1)
      assert.equal((await fixture.api.resources.notes.getRelationship({ id: note.id, relationshipName: 'document' })).data, null)
      assert.equal(await exists(join(directory, 'shared.png')), false)
      assert.deepEqual(context.fileHandlingUploads, [])
    })

    for (const writeFailure of [false, true]) {
      it(`${format} preserves committed bytes when a filename collision precedes ${writeFailure ? 'write' : 'callback'} rollback`, async t => {
        const inputRecord = () => format === 'plain' ? {} : { data: { type: 'documents', attributes: {} } }
        detectorState.payload = payload('committed bytes')
        const original = await fixture.api.resources.documents.post({ inputRecord: inputRecord(), format })
        const id = format === 'plain' ? original.id : original.data.id
        detectorState.payload = payload('replacement bytes')
        // Model a competing upload claiming the filename after its availability check.
        t.mock.method(storage, 'generateFilename', async () => 'shared.png')
        const context = { failReplacement: writeFailure }
        await assert.rejects(fixture.api.transaction(async transaction => {
          await fixture.api.resources.documents.patch({ id, inputRecord: inputRecord(), format, transaction }, context)
          throw primary
        }), error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
        assert.equal(await readFile(join(directory, 'shared.png'), 'utf8'), 'committed bytes')
        assert.equal(await exists(join(directory, 'shared_1.png')), false)
        assert.deepEqual(context.fileHandlingUploads, [])
        assert.deepEqual(context.cleanupErrors || [], [])
        const restored = await fixture.api.resources.documents.get({ id, format: 'plain' })
        assert.equal(restored.attachment, '/uploads/shared.png')
        assert.equal(await fixture.count('documents'), 1)
      })
    }
  }
})

describe(`Bulk file cleanup (${storageMode.mode})`, () => {
  let fixture, directory, detectorState, payloads, probe, originalIds, contexts
  const primary = new RestApiValidationError('Middle uploaded entry failed')
  const cleanupError = new Error('Bulk file cleanup failed')
  const loggingError = new Error('Bulk file warning failed')
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jra-bulk-files-'))
    detectorState = { payload: null }
    const storage = {
      async upload (file) {
        const path = join(directory, 'stored', file.filename)
        await copyFile(file.filepath, path)
        return path
      },
      async delete (path) {
        if (probe.deleteFailure && path.endsWith('1-attachment.png')) throw cleanupError
        await unlink(path)
      }
    }
    fixture = await createConformanceFixture({
      createApi: knex => createFileUploadApi(knex, { storage, detectorState, bulk: true, fileFields: ['attachment', 'thumbnail'] }),
      tables: { documents: 'file_documents' }
    })
    await fixture.api.customize({
      hooks: {
        beforeProcessing: {
          functionName: 'select-bulk-file-payload',
          beforeFunction: 'processFiles',
          handler: ({ context }) => { detectorState.payload = context.bulkOperation ? payloads[context.bulkIndex] : null }
        },
        finish: {
          functionName: 'fail-bulk-file-write',
          handler: ({ context }) => {
            if (!context.bulkOperation || !['post', 'patch'].includes(context.method)) return
            contexts.set(context.bulkIndex, context)
            if (context.bulkIndex === 1 && probe.failure === 'finish') throw primary
          }
        },
        afterCommit: {
          functionName: 'fail-bulk-file-completion',
          beforeFunction: 'releaseUploadedFiles',
          handler: ({ context }) => {
            if (context.bulkOperation && context.bulkIndex === 1 && probe.failure === 'afterCommit') throw primary
          }
        }
      }
    })
  })
  beforeEach(async () => {
    probe = {}
    payloads = []
    contexts = new Map()
    detectorState.payload = null
    await fixture.reset()
    for (const part of ['temporary', 'stored']) {
      await rm(join(directory, part), { recursive: true, force: true })
      await mkdir(join(directory, part))
    }
    originalIds = []
    for (let index = 0; index < 3; index++) {
      const record = await fixture.api.resources.documents.post({ format: 'plain', inputRecord: { title: `Original ${index}` } })
      originalIds.push(record.id)
    }
  })
  after(async () => {
    try { await fixture?.close() } finally { if (directory) await rm(directory, { recursive: true, force: true }) }
  })

  const prepare = async () => {
    payloads = []
    for (let index = 0; index < 3; index++) {
      const files = {}
      for (const field of ['attachment', 'thumbnail']) {
        const filename = `${index}-${field}.png`
        const filepath = join(directory, 'temporary', filename)
        await writeFile(filepath, 'file contents')
        files[field] = {
          filename,
          filepath,
          mimetype: 'image/png',
          size: 13,
          cleanup: async () => {
            if (index !== 1 && field === 'attachment') throw cleanupError
            await unlink(filepath)
          }
        }
      }
      payloads.push({ fields: {}, files })
    }
  }

  for (const method of ['bulkPost', 'bulkPatch']) {
    for (const format of ['jsonapi', 'plain']) {
      for (const scenario of ['warnings', 'rollback', 'failed-cleanup', 'post-commit']) {
        it(`${method} retains ${format} file diagnostics and tracking for ${scenario}`, async t => {
          probe = { failure: scenario === 'post-commit' ? 'afterCommit' : scenario === 'warnings' ? undefined : 'finish', deleteFailure: scenario === 'failed-cleanup' }
          if (probe.deleteFailure) t.mock.method(console, 'warn', () => { throw loggingError })
          await prepare()
          const ids = method === 'bulkPost' ? ['91', '92', '93'] : originalIds
          const records = ids.map((id, index) => format === 'plain' ? { id, title: `Changed ${index}` } : { type: 'documents', id, attributes: { title: `Changed ${index}` } })
          const params = method === 'bulkPost' ? { inputRecords: records } : { operations: records.map((data, index) => ({ id: ids[index], data })) }
          const context = { cleanupErrors: [{ phase: 'stale' }] }
          const result = await fixture.api.resources.documents[method]({ ...params, format, atomic: false }, context)
          const failed = scenario !== 'warnings'
          const rolledBack = probe.failure === 'finish'
          assert.equal(result.meta.succeeded, failed ? 2 : 3)
          assert.equal(result.meta.failed, failed ? 1 : 0)
          if (failed) assert.deepEqual(result.errors.map(entry => [entry.index, entry.error.code, entry.error.message]), [[1, primary.code, primary.message]])
          const retainedFields = scenario === 'post-commit' ? ['attachment', 'thumbnail'] : probe.deleteFailure ? ['attachment'] : []
          assert.deepEqual((context.fileHandlingUploads || []).map(({ field, bulkIndex, url }) => ({ field, bulkIndex, url })), retainedFields.map(field => ({ field, bulkIndex: 1, url: join(directory, 'stored', `1-${field}.png`) })))
          const diagnostics = []
          const add = (phase, bulkIndex) => {
            diagnostics.push({ phase, field: 'attachment', error: cleanupError, bulkIndex })
            if (probe.deleteFailure) diagnostics.push({ phase: 'logging', during: phase, field: 'attachment', error: loggingError, bulkIndex })
          }
          add('temporaryFileCleanup', 0)
          if (probe.deleteFailure) add('uploadedFileCleanup', 1)
          add('temporaryFileCleanup', 2)
          assert.deepEqual(context.cleanupErrors, diagnostics)
          const stored = (await fixture.api.resources.documents.query({ format: 'plain' })).data
          for (let index = 0; index < 3; index++) {
            const record = stored.find(record => record.id === ids[index])
            if (index === 1 && rolledBack && method === 'bulkPost') assert.equal(record, undefined)
            else {
              assert.equal(record.title, index === 1 && rolledBack ? `Original ${index}` : `Changed ${index}`)
              if (!(index === 1 && rolledBack)) assert.equal(record.attachment, join(directory, 'stored', `${index}-attachment.png`))
            }
            for (const field of ['attachment', 'thumbnail']) {
              assert.equal(await exists(join(directory, 'temporary', `${index}-${field}.png`)), index !== 1 && field === 'attachment')
              assert.equal(await exists(join(directory, 'stored', `${index}-${field}.png`)), index !== 1 || !rolledBack || (probe.deleteFailure && field === 'attachment'))
            }
          }
          for (const upload of context.fileHandlingUploads || []) {
            assert.equal(upload.transaction, contexts.get(1).transaction)
            assert.equal(upload.storage, contexts.get(1).fileHandlingUploads.find(entry => entry.field === upload.field).storage)
          }
          for (const child of contexts.values()) {
            assert.ok((child.cleanupErrors || []).every(entry => !Object.hasOwn(entry, 'bulkIndex')))
            assert.ok((child.fileHandlingUploads || []).every(entry => !Object.hasOwn(entry, 'bulkIndex')))
          }
          assert.equal(contexts.get(1).transactionCommitted, !rolledBack)
          assert.equal(JSON.stringify(result).includes('Bulk file cleanup failed'), false)
          const retained = [...(context.fileHandlingUploads || [])]
          probe = {}
          payloads = []
          await fixture.api.resources.documents.bulkPost({ inputRecords: [{ id: '999', title: 'Recovery' }], format: 'plain', atomic: false }, context)
          assert.equal(context.cleanupErrors, undefined)
          assert.deepEqual(context.fileHandlingUploads || [], retained)
          for (const upload of retained) assert.equal(await exists(upload.url), true)
        })
      }
    }
  }
})

describe(`Upload error HTTP classification (${storageMode.mode})`, () => {
  let fixture, server, baseUrl, failure, uploadCalls
  before(async () => {
    const app = express()
    fixture = await createConformanceFixture({
      createApi: knex => createFileUploadApi(knex, {
        app,
        storage: { upload: async () => { uploadCalls++; throw failure }, delete: async () => {} }
      }),
      tables: { documents: 'file_documents' }
    })
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })
  beforeEach(async () => { uploadCalls = 0; await fixture.reset() })
  after(async () => {
    try {
      if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    } finally { await fixture?.close() }
  })
  for (const [name, error, status] of [
    ['unexpected storage error', new Error('Storage unavailable'), 500],
    ['null storage error', null, 500],
    ['typed access error', new RestApiResourceError('Upload forbidden', { subtype: 'forbidden' }), 403],
    ['invalid MIME input', new Error('Upload must not run'), 422]
  ]) {
    it(`returns ${status} for ${name}`, async () => {
      failure = error
      const form = new FormData()
      form.set('title', 'Document')
      form.set('attachment', new Blob(['x'], { type: status === 422 ? 'text/plain' : 'image/png' }), 'attachment.png')
      const response = await fetch(`${baseUrl}/api/documents`, { method: 'POST', body: form })
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.errors[0].status, String(status))
      assert.equal(uploadCalls, status === 422 ? 0 : 1)
      assert.equal(await fixture.count('documents'), 0)
    })
  }
})
