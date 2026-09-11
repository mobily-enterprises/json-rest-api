import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatDiagnosticValue, formatError, formatErrorString, formatErrorSummary, readDiagnosticProperty } from '../lib/error-formatter.js'
import { createEnhancedLogger } from '../lib/enhanced-logger.js'
import { wrapUnexpectedError } from '../lib/error-context.js'

it('retains primitive property access and null absence in guarded diagnostics', () => {
  assert.equal(readDiagnosticProperty('abc', 1), 'b')
  assert.equal(readDiagnosticProperty(false, 'valueOf'), Boolean.prototype.valueOf)
  for (const absent of [null, undefined]) {
    assert.equal(readDiagnosticProperty(absent, 'constructor'), undefined)
    assert.equal(formatDiagnosticValue(absent), absent)
  }
  assert.deepEqual(formatDiagnosticValue([false, 0, 1n, Symbol('tag')]), [false, 0, '1', 'Symbol(tag)'])
})

describe('Binary diagnostic metadata', () => {
  const inputs = [
    ['Buffer', Buffer.from('PRIVATE_BYTES')],
    ['ArrayBufferView', new Uint16Array([1000, 2000])],
    ['ArrayBufferView', new DataView(new ArrayBuffer(16), 4, 3)],
    ['ArrayBuffer', new ArrayBuffer(12)],
    ['SharedArrayBuffer', new SharedArrayBuffer(10)]
  ]
  for (const [type, data] of inputs) {
    it(`logs only size and type for ${type} contents`, () => {
      let reads = 0
      Object.defineProperty(data, 'privateNote', { enumerable: true, get () { reads++; return 'PRIVATE_NOTE' } })
      const preview = { type, byteLength: data.byteLength }
      assert.deepEqual(formatDiagnosticValue({ upload: { data } }), { upload: { data: preview } })
      const error = Object.assign(new Error('Upload failed'), { details: { data } })
      assert.deepEqual(formatError(error, { includeStack: false }).details.data, preview)
      const calls = []
      createEnhancedLogger({ error: (...args) => calls.push(args) }).logError('Failed', error, { data })
      assert.deepEqual(calls[0][1].data, preview)
      assert.equal(reads, 0)
    })
  }

  it('does not enumerate bytes when the thrown value itself is a Buffer', () => {
    const data = Buffer.from('PRIVATE_BYTES')
    const formatted = formatError(data)
    assert.deepEqual(formatted.data, { type: 'Buffer', byteLength: data.byteLength })
    assert.equal(Object.hasOwn(formatted, '0'), false)
    assert.equal(data.toString(), 'PRIVATE_BYTES')
  })

  it('does not convert thrown binary contents into diagnostic message text', () => {
    const failure = Buffer.from('PRIVATE_BYTES')
    const error = new Error('Original failure')
    error.toJSON = () => { throw failure }
    const output = formatErrorString(error, { includeStack: false })
    assert.ok(!output.includes('PRIVATE_BYTES'))
    assert.match(output, /Binary value thrown/)
    const wrapped = wrapUnexpectedError(failure)
    assert.ok(!wrapped.message.includes('PRIVATE_BYTES'))
    assert.equal(wrapped.cause, failure)
  })
})

describe('Diagnostic metadata accessors', () => {
  for (const options of [{ includeStack: false }, { redactFields: ['message'] }]) {
    it(`omits custom JSON stacks before access with ${JSON.stringify(options)}`, () => {
      let reads = 0
      const error = new Error('Original failure')
      error.toJSON = () => ({
        code: 'CUSTOM',
        get stack () { reads++; return 'PRIVATE_STACK' },
        cause: { errors: [{ get stack () { reads++; return 'PRIVATE_STACK' } }] }
      })
      const formatted = formatError(error, options)
      assert.equal(formatted.code, 'CUSTOM')
      assert.equal(Object.hasOwn(formatted, 'stack'), false)
      assert.equal(reads, 0)
      assert.ok(!JSON.stringify(formatted).includes('PRIVATE_STACK'))
    })
  }

  for (const field of ['name', 'message', 'stack', 'code', 'details']) {
    it(`contains a throwing ${field} accessor in full and summary diagnostics`, () => {
      const error = new Error('Original failure')
      const failure = null
      Object.defineProperty(error, field, { configurable: true, get () { throw failure } })
      assert.doesNotThrow(() => formatErrorString(error))
      assert.doesNotThrow(() => formatErrorSummary(error))
      const calls = []
      const logger = createEnhancedLogger({ error: (...args) => calls.push(args) })
      logger.logError('Failed', error)
      logger.logValidationError('Failed', error)
      assert.equal(calls.length, 2)
    })
  }

  it('skips redacted message/details getters in full and summary diagnostics', () => {
    const error = new Error('Original failure')
    Object.defineProperty(error, 'stack', { configurable: true, enumerable: true, value: 'PRIVATE_VALUE' })
    let reads = 0
    for (const field of ['message', 'details']) {
      Object.defineProperty(error, field, { configurable: true, get () { reads++; return 'PRIVATE_VALUE' } })
    }
    const options = { redactFields: ['message', 'details'] }
    const full = formatErrorString(error, options)
    const summary = formatErrorSummary(error, options)
    assert.equal(reads, 0)
    assert.ok(!full.includes('PRIVATE_VALUE'))
    assert.ok(!summary.includes('PRIVATE_VALUE'))
  })
})

describe('Diagnostic serialization failures', () => {
  for (const [label, failure] of [['null', null], ['undefined', undefined], ['string', 'Serializer failed']]) {
    it(`retains the original error when nested properties and toJSON throw ${label}`, () => {
      const error = new Error('Original failure')
      error.toJSON = () => { throw failure }
      error.details = { get nested () { throw failure } }
      Object.defineProperty(error, 'extra', { enumerable: true, get () { throw failure } })
      const formatted = formatError(error, { includeStack: false })
      assert.equal(formatted.message, 'Original failure')
      assert.equal(formatted.toJSONError, `Failed to call toJSON: ${String(failure)}`)
      assert.match(formatted.details.nested, /Error serializing/)
      assert.match(formatted.extra, /Error serializing/)
    })
  }

  it('contains a non-enumerable cause getter failure without replacing the original message', () => {
    const error = new Error('Original failure')
    const failure = null
    Object.defineProperty(error, 'cause', { get () { throw failure } })
    const formatted = formatError(error, { includeStack: false })
    assert.equal(formatted.message, 'Original failure')
    assert.match(formatted.cause, /Error serializing/)
  })

  it('contains a throwing toJSON accessor and still formats other properties', () => {
    const error = Object.assign(new Error('Original failure'), { code: 'ORIGINAL' })
    const failure = undefined
    Object.defineProperty(error, 'toJSON', { get () { throw failure } })
    const formatted = formatError(error, { includeStack: false })
    assert.equal(formatted.message, 'Original failure')
    assert.equal(formatted.code, 'ORIGINAL')
    assert.equal(formatted.toJSONError, 'Failed to call toJSON: undefined')
  })
})

describe('Error cause diagnostics', () => {
  it('preserves native non-enumerable causes and nested error messages', () => {
    const driver = Object.assign(new Error('Connection lost'), { code: 'DRIVER_FAILURE' })
    const error = new Error('Write failed', { cause: driver })
    const formatted = formatError(error, { includeStack: false })
    assert.equal(formatted.cause.name, 'Error')
    assert.equal(formatted.cause.message, 'Connection lost')
    assert.equal(formatted.cause.code, 'DRIVER_FAILURE')
    assert.equal(formatted.cause.stack, undefined)
    assert.equal(error.cause, driver)
    assert.equal(Object.hasOwn(driver, 'code'), true)
  })

  it('retains aggregate members, primitive causes and errors nested in details', () => {
    const inner = new TypeError('Invalid driver response', { cause: 0 })
    const error = new AggregateError([inner, 'secondary failure'], 'Batch failed', { cause: false })
    error.details = { cleanup: new Error('Release failed', { cause: null }) }
    const formatted = formatError(error, { includeStack: false })
    assert.equal(formatted.cause, false)
    assert.equal(formatted.errors[0].message, 'Invalid driver response')
    assert.equal(formatted.errors[0].cause, 0)
    assert.equal(formatted.errors[1], 'secondary failure')
    assert.equal(formatted.details.cleanup.message, 'Release failed')
    assert.equal(formatted.details.cleanup.cause, null)
  })

  it('bounds cyclic and deeply nested causes through the existing depth limit', () => {
    const root = new Error('Root')
    root.cause = root
    const serialized = formatErrorString(root, { includeStack: false })
    assert.match(serialized, /Circular reference/)
    const nested = new Error('Outer', { cause: new Error('Middle', { cause: new Error('Inner') }) })
    const formatted = formatError(nested, { includeStack: false, maxDepth: 0 })
    assert.equal(formatted.cause.message, 'Middle')
    assert.equal(formatted.cause.cause, '[Max depth exceeded]')
  })

  it('delivers causes through enhanced utility logging with the selected stack policy', () => {
    const calls = []
    const logger = createEnhancedLogger({ error: (...args) => calls.push(args) }, { includeStack: false })
    logger.logError('Operation failed', new Error('Outer', { cause: new Error('Inner') }))
    assert.equal(calls[0][1].error.cause.message, 'Inner')
    assert.equal(calls[0][1].error.cause.stack, undefined)
    const withStack = formatError(new Error('Outer', { cause: new Error('Inner') }))
    assert.match(withStack.cause.stack, /Error: Inner/)
  })
})

describe('Bounded error diagnostics', () => {
  it('bounds messages, stacks and a wide nested payload without changing the error', () => {
    const message = 'private-value-'.repeat(10000)
    const error = new Error(message)
    error.details = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field-${i}`, message]))
    const output = formatErrorString(error)
    assert.ok(output.length < 100000)
    assert.match(output, /Truncated/)
    assert.equal(error.message, message)
    assert.equal(Object.keys(error.details).length, 200)
  })

  it('limits root properties, large keys and aggregate members', () => {
    const error = new AggregateError(Array.from({ length: 1000 }, () => new Error('Nested')), 'Batch')
    for (let i = 0; i < 1000; i++) error[`${i}-${'key'.repeat(1000)}`] = 'value'
    const formatted = formatError(error, { includeStack: false })
    assert.ok(Object.keys(formatted).length < 100)
    assert.ok(JSON.stringify(formatted).length < 100000)
    assert.match(JSON.stringify(formatted), /Truncated/)
    assert.equal(error.errors.length, 1000)
  })

  it('does not read the tail of a large array once the preview is full', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i)
    Object.defineProperty(values, 900, { get () { assert.fail('Diagnostic read outside its preview') } })
    const error = Object.assign(new Error('Large list'), { values })
    const formatted = formatError(error, { includeStack: false })
    assert.ok(formatted.values.length < 100)
    assert.match(JSON.stringify(formatted.values), /Truncated/)
  })
})

it('bounds custom JSON output and nonstandard error text', () => {
  const error = Object.assign(new Error('Failure'), { toJSON: () => 'value'.repeat(10000) })
  const formatted = formatError(error, { includeStack: false })
  assert.ok(Object.keys(formatted).length < 100)
  assert.match(formatted.toJSONResult, /Truncated/)
  const nonstandard = { name: 'Error', message: { payload: 'value'.repeat(100000) }, amount: 1n }
  const output = formatErrorString(nonstandard, { includeStack: false })
  assert.ok(output.length < 100000)
  assert.match(output, /Non-string diagnostic text/)
  assert.equal(nonstandard.amount, 1n)
})

it('shares its traversal budget across sibling containers', () => {
  let reads = 0
  const branches = Array.from({ length: 50 }, () => Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [index, { get value () { reads++; return 'small' } }])
  ))
  const formatted = formatError(Object.assign(new Error('Wide graph'), { branches }), { includeStack: false })
  assert.ok(reads > 0 && reads <= 256)
  assert.match(JSON.stringify(formatted), /Truncated/)
})

it('bounds one-line summaries and avoids reading omitted violations', () => {
  const violations = Array.from({ length: 1000 }, () => ({ field: 'name', message: 'invalid'.repeat(1000) }))
  Object.defineProperty(violations, 900, { get () { assert.fail('Summary read omitted violation') } })
  const error = Object.assign(new Error('Validation failed'), { details: { violations } })
  const summary = formatErrorSummary(error)
  assert.ok(summary.length <= 2048)
  assert.match(summary, /Truncated/)
  assert.equal(error.details.violations.length, 1000)
  assert.ok(formatErrorSummary(new Error('long'.repeat(10000))).length <= 2048)
})

it('retains short summary spelling and bounds summary-only logging', () => {
  const error = Object.assign(new Error('Invalid'), {
    code: 'VALIDATION',
    details: {
      violations: [{ field: 'name', message: 'Required' }], fields: ['name']
    }
  })
  error.toJSON = () => { assert.fail('Summary invoked custom JSON conversion') }
  Object.defineProperty(error.details, 'unrelated', { enumerable: true, get () { assert.fail('Summary inspected unrelated details') } })
  assert.equal(formatErrorSummary(error), 'Invalid | code: VALIDATION | violations: [name: Required] | fields: name')
  const calls = []
  const logger = createEnhancedLogger({ warn: (...args) => calls.push(args) }, { logFullErrors: false })
  logger.warn(new Error('long'.repeat(10000)))
  assert.ok(calls[0][0].length <= 2048)
})
