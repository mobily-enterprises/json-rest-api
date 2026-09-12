import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { createEnhancedLogger, enhanceLogger } from '../lib/enhanced-logger.js'

for (const logFullErrors of [false, true]) {
  it(`retains SQLite error messages in direct, envelope and cleanup logs with logFullErrors=${logFullErrors}`, () => {
    const logger = recordingLogger()
    const enhanced = createEnhancedLogger(logger, { logFullErrors, includeStack: false })
    const failure = new Database.SqliteError('Rollback statement failed', 'SQLITE_ERROR')
    enhanced.error('Direct', failure)
    enhanced.error('Envelope', { error: failure })
    enhanced.error('Cleanup', {
      error: new Error('Registry write failed'), cleanupErrors: [{ phase: 'rollback', error: failure }]
    })
    for (const formatted of [logger.calls[0].args[1], logger.calls[1].args[1].error]) {
      if (logFullErrors) assert.equal(formatted.message, failure.message)
      else assert.match(formatted, /Rollback statement failed/)
    }
    const cleanup = logger.calls[2].args[1].cleanupErrors[0]
    assert.equal(cleanup.phase, 'rollback')
    assert.equal(cleanup.error.message, failure.message)
    assert.equal(cleanup.error.code, failure.code)
    assert.equal(cleanup.error.stack, undefined)
  })
}

it('rejects in-place enhancement when a writer is not writable', () => {
  const logger = Object.freeze({ error () {} })
  assert.throws(() => enhanceLogger(logger), TypeError)
})

it('contains an error-envelope getter failure without losing other metadata', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger)
  const failure = null
  const data = { publicNote: 'Visible', get error () { throw failure } }
  enhanced.error('Failure', data)
  assert.equal(logger.calls[0].args[1].publicNote, 'Visible')
  assert.match(logger.calls[0].args[1].error, /Error serializing/)
})

it('reads an error-envelope accessor once through bounded value inspection', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger, { includeStack: false })
  let reads = 0
  const data = { publicNote: 'Visible', get error () { reads++; return new Error('Rejected') } }
  enhanced.warn('Failure', data)
  assert.equal(reads, 1)
  assert.equal(logger.calls[0].args[1].publicNote, 'Visible')
  assert.equal(logger.calls[0].args[1].error.message, 'Rejected')
  assert.equal(logger.calls[0].args[1].error.stack, undefined)
})

it('does not inspect cleanup errors for a hidden uploaded-file field', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger, { schemaInfo: { outputFields: { privateFile: { hidden: true } } } })
  let reads = 0
  const error = new Error('Upload cleanup failed')
  Object.defineProperty(error, 'message', { get () { reads++; return 'PRIVATE_FILENAME' } })
  enhanced.warn('File cleanup failed', { field: 'privateFile', error })
  assert.equal(reads, 0)
  assert.equal(logger.calls[0].args[1].field, 'privateFile')
  assert.equal(logger.calls[0].args[1].message, '[Redacted]')
  assert.ok(!JSON.stringify(logger.calls).includes('PRIVATE_FILENAME'))
})

it('does not invoke custom JSON conversion again while classifying validation errors', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger)
  let calls = 0
  const error = new Error('Original failure')
  error.toJSON = () => { calls++; return { message: error.message } }
  enhanced.logValidationError('Failed', error)
  assert.equal(calls, 1)
  assert.equal(logger.calls[0].args[1].error.message, 'Original failure')
})

function recordingLogger () {
  const logger = { calls: [] }
  for (const level of ['debug', 'info', 'warn', 'error', 'trace', 'fatal', 'log']) {
    logger[level] = function (...args) {
      assert.equal(this, logger)
      this.calls.push({ level, args })
      return this.calls.length
    }
  }
  return logger
}

describe('Enhanced logger method ownership', () => {
  for (const hasViolations of [true, false]) {
    const input = Object.assign(new Error('Invalid input'), hasViolations
      ? { details: { violations: [{ field: 'name', message: 'Required' }] } }
      : {})
    const branch = hasViolations ? 'validation details' : 'ordinary error fallback'

    it(`returns the synchronous writer result for ${branch}`, () => {
      const logger = recordingLogger()
      const enhanced = createEnhancedLogger(logger)
      assert.equal(enhanced.logValidationError('Invalid', input), 1)
      assert.equal(logger.calls.length, 1)
    })

    it(`allows awaiting writer completion for ${branch}`, async () => {
      const completion = Promise.withResolvers()
      const enhanced = createEnhancedLogger({ error: () => completion.promise })
      const result = enhanced.logValidationError('Invalid', input)
      assert.equal(result, completion.promise)
      completion.resolve('written')
      assert.equal(await result, 'written')
    })

    it(`preserves asynchronous writer rejection for ${branch}`, async () => {
      const failure = new Error('Logger unavailable')
      const completion = Promise.withResolvers()
      // Observe the sink independently so the old wrapper cannot leak an unhandled rejection.
      const rejected = assert.rejects(completion.promise, error => error === failure)
      const enhanced = createEnhancedLogger({ error: () => completion.promise })
      const result = enhanced.logValidationError('Invalid', input)
      completion.reject(failure)
      await rejected
      assert.equal(result, completion.promise)
      await assert.rejects(result, error => error === failure)
    })
  }

  it('enhances an existing logger without recursively invoking its replacement', () => {
    const logger = recordingLogger()
    assert.equal(enhanceLogger(logger, { includeStack: false }), logger)
    for (const level of ['debug', 'info', 'warn', 'error', 'trace', 'fatal', 'log']) {
      assert.equal(logger[level]('message', { count: 2 }), logger.calls.length)
    }
    assert.equal(logger.calls.length, 7)
    assert.deepEqual(logger.calls[0].args, ['message', { count: 2 }])
  })

  it('retains the original writer when a base method is replaced with the wrapper', () => {
    const logger = recordingLogger()
    const enhanced = createEnhancedLogger(logger, { includeStack: false })
    logger.error = enhanced.error
    const error = new Error('Invalid input')
    error.details = { violations: [{ field: 'title', rule: 'required', message: 'Required' }] }
    assert.equal(enhanced.error(error), 1)
    assert.equal(logger.calls[0].args[0].message, 'Invalid input')
    assert.equal(logger.calls[0].args[0].stack, undefined)
    assert.deepEqual(logger.calls[0].args[0].details.violations, error.details.violations)
  })

  it('forwards utility logging and preserves writer exceptions', () => {
    const logger = recordingLogger()
    enhanceLogger(logger, { includeStack: false })
    assert.equal(logger.logError('Write failed', new Error('Driver failed'), { phase: 'write' }), 1)
    assert.equal(logger.calls[0].args[1].phase, 'write')
    assert.equal(logger.calls[0].args[1].error.message, 'Driver failed')
    const failure = new Error('Logger unavailable')
    const failing = enhanceLogger({ error () { throw failure } })
    assert.throws(() => failing.error('message'), error => error === failure)
  })
})

describe('Bounded enhanced-log events', () => {
  it('does not follow cyclic proxy prototypes while classifying diagnostics', () => {
    const logger = recordingLogger()
    const enhanced = createEnhancedLogger(logger)
    let prototypeReads = 0
    const cyclic = new Proxy({ publicNote: 'Visible' }, {
      getPrototypeOf () { prototypeReads++; return cyclic }
    })
    enhanced.warn('Before', cyclic, { error: cyclic }, { publicNote: 'After' })
    assert.equal(prototypeReads, 0)
    assert.equal(logger.calls.length, 1)
    assert.deepEqual(logger.calls[0].args, [
      'Before', { publicNote: 'Visible' }, { error: '[Circular reference]' }, { publicNote: 'After' }
    ])
  })

  it('retains sibling arguments when diagnostic values cannot be inspected', () => {
    const logger = recordingLogger()
    const enhanced = createEnhancedLogger(logger)
    const array = ['Before', 'Unreadable', 'After']
    const invalidDate = new Date(NaN)
    const inspectionFailure = null
    Object.defineProperty(array, 1, { get () { throw inspectionFailure } })
    const inaccessible = new Proxy({}, { ownKeys () { throw new Error('Cannot inspect metadata') } })
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    enhanced.warn('Original event', invalidDate, array, inaccessible, proxy, { publicNote: 'Still visible' })
    assert.equal(logger.calls.length, 1)
    const args = logger.calls[0].args
    assert.equal(args[0], 'Original event')
    assert.match(args[1], /Error serializing/)
    assert.equal(args[2][0], 'Before')
    assert.match(args[2][1], /Error/)
    assert.equal(args[2][2], 'After')
    assert.match(args[3], /Cannot inspect metadata/)
    assert.match(args[4], /Error serializing/)
    assert.equal(args[5].publicNote, 'Still visible')
    assert.equal(Number.isNaN(invalidDate.getTime()), true)
  })

  it('bounds message and additional data without mutating caller data', () => {
    const logger = recordingLogger()
    const enhanced = createEnhancedLogger(logger)
    const message = 'message'.repeat(10000)
    const data = { values: Array.from({ length: 1000 }, () => 'value'.repeat(1000)) }
    enhanced.warn(message, data)
    assert.equal(logger.calls.length, 1)
    assert.ok(JSON.stringify(logger.calls).length < 100000)
    assert.match(JSON.stringify(logger.calls), /Truncated/)
    assert.equal(data.values.length, 1000)
    assert.equal(data.values[0].length, 5000)
  })

  it('emits one bounded validation event and does not read omitted violations', () => {
    const logger = recordingLogger()
    const enhanced = createEnhancedLogger(logger, { includeStack: false })
    const violations = Array.from({ length: 1000 }, () => ({ field: 'name', rule: 'required', message: 'Required' }))
    Object.defineProperty(violations, 900, { get () { assert.fail('Logger read omitted violation') } })
    enhanced.error(Object.assign(new Error('Invalid'), { details: { violations } }))
    assert.equal(logger.calls.length, 1)
    assert.equal(logger.calls[0].args[0].message, 'Invalid')
    assert.match(JSON.stringify(logger.calls), /Truncated/)
  })
})

it('redacts configured keys before reading values, including nested error details', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger, { redactFields: ['accessKey'] })
  const data = { nested: {} }
  Object.defineProperty(data.nested, 'accessKey', { enumerable: true, get () { assert.fail('Read redacted value') } })
  const error = Object.assign(new Error('Rejected'), { details: { accessKey: 'PRIVATE_DETAIL', publicNote: 'Visible' } })
  enhanced.logError('Failure', error, data)
  const output = JSON.stringify(logger.calls)
  assert.ok(!output.includes('PRIVATE_DETAIL'))
  assert.match(output, /Visible/)
  assert.match(output, /Redacted/)
  assert.equal(error.details.accessKey, 'PRIVATE_DETAIL')
})

it('does not read protected top-level metadata through convenience methods or error envelopes', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger, { redactFields: ['accessKey'] })
  const error = Object.assign(new Error('Invalid'), { details: { violations: [{ field: 'name', message: 'Required' }] } })
  let reads = 0
  const data = { publicNote: 'Visible' }
  Object.defineProperty(data, 'accessKey', { enumerable: true, get () { reads++; return 'PRIVATE_METADATA' } })
  enhanced.logError('Failure', error, data)
  enhanced.logValidationError('Validation failed', error, data)
  Object.defineProperty(data, 'error', { enumerable: true, value: error })
  enhanced.error('Envelope', data)
  assert.equal(logger.calls.length, 3)
  assert.equal(reads, 0)
  for (const call of logger.calls) {
    assert.equal(call.args[1].publicNote, 'Visible')
    assert.equal(call.args[1].accessKey, '[Redacted]')
  }
})

it('does not read a protected error key when classifying logger arguments', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger, { redactFields: ['error'] })
  let reads = 0
  const data = {}
  Object.defineProperty(data, 'error', { enumerable: true, get () { reads++; return 'PRIVATE_ERROR_FIELD' } })
  enhanced.warn('Protected field', data)
  assert.equal(logger.calls[0].args[1].error, '[Redacted]')
  assert.equal(reads, 0)
})

it('bounds convenience metadata before copying omitted entries', () => {
  const logger = recordingLogger()
  const enhanced = createEnhancedLogger(logger)
  let omittedReads = 0
  const data = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`field${index}`, index]))
  Object.defineProperty(data, 'omitted', { enumerable: true, get () { omittedReads++; return 'OMITTED' } })
  enhanced.logError('Failure', new Error('Rejected'), data)
  enhanced.logValidationError('Invalid', Object.assign(new Error('Rejected'), { details: { violations: [] } }), data)
  data.error = new Error('Rejected')
  enhanced.error(data)
  assert.equal(omittedReads, 0)
  assert.equal(logger.calls.length, 3)
})
