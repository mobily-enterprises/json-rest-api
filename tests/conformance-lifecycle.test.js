import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { setImmediate } from 'node:timers/promises'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const readStages = [
  'checkPermissions', 'beforeData', 'beforeDataGet', 'checkDataPermissions',
  'checkDataPermissionsGet', 'enrichRecord', 'getter', 'enrichAttributes',
  'enrichRecordWithRelationships', 'finish', 'finishGet'
].map(name => `get:${name}`)

function writeStages (method, returning, managed) {
  const suffix = method[0].toUpperCase() + method.slice(1)
  const names = method === 'delete'
    ? ['checkPermissions', 'beforeDataCall', 'beforeDataCallDelete', 'afterDataCallDelete', 'afterDataCall']
    : [
        'beforeProcessing', `beforeProcessing${suffix}`,
        'beforeSchemaValidate', `beforeSchemaValidate${suffix}`,
        `afterSchemaValidate${suffix}`, 'afterSchemaValidate', 'checkPermissions',
        'beforeDataCall', `beforeDataCall${suffix}`, 'setter',
        `afterDataCall${suffix}`, 'afterDataCall'
      ]
  return [
    ...names.map(name => `${method}:${name}`),
    ...(method !== 'delete' && returning === 'full' ? readStages : []),
    `${method}:finish`, `${method}:finish${suffix}`,
    ...(managed ? [] : [`${method}:afterCommit`])
  ]
}

const operations = [
  { name: 'POST', method: 'post', creates: true },
  { name: 'POST-generated', method: 'post', creates: true, generated: true },
  { name: 'PUT-create', method: 'put', creates: true },
  { name: 'PUT-update', method: 'put', creates: false },
  { name: 'PATCH', method: 'patch', creates: false },
  { name: 'DELETE', method: 'delete', creates: false }
]

describe(`Resource write lifecycle (${storageMode.mode})`, () => {
  let fixture, current, enabled, failureStage, operationContext, setterContext
  const events = []
  const snapshots = []
  const injectedError = new RestApiValidationError('Injected lifecycle failure')
  const auth = { userId: 'lifecycle-viewer' }

  async function observe (stage, context) {
    if (!enabled) return
    events.push(`${stage}:enter`)
    snapshots.push({
      stage,
      context,
      transaction: context.transaction,
      completed: context.transaction?.isCompleted(),
      id: context.id,
      inputId: context.inputRecord?.data?.id,
      inputName: context.inputRecord?.data?.attributes?.name,
      minimalName: context.minimalRecord?.attributes?.name,
      response: structuredClone(context.responseRecord),
      auth: context.auth
    })
    await setImmediate()
    if (stage === failureStage) throw injectedError
    if (stage === 'post:finishPost' && context.uncloneableResponse) context.responseRecord.extension = () => {}
    if (stage.endsWith(':afterCommit') && context.mutateCommittedResponse) {
      const record = context.simplified ? context.responseRecord : context.responseRecord.data
      record.id = 'Changed after commit'
      record.extra = 'Not part of the prepared identifier'
    }
    events.push(`${stage}:exit`)
  }

  before(async () => {
    fixture = await createConformanceFixture({
      apiOptions: {
        itemNameOptions: {
          setter: async (value, context) => {
            setterContext = context
            await observe(`${context.method}:setter`, operationContext)
            return value.toUpperCase()
          },
          getter: async (value, { parentContext }) => {
            await observe(`${parentContext.method}:getter`, parentContext)
            return value
          }
        }
      }
    })
    const stages = new Set(operations.flatMap(({ method }) => writeStages(method, 'full', false))
      .map(stage => stage.split(':')[1]).filter(name => !['setter', 'getter'].includes(name)))
    stages.add('afterRollback')
    await fixture.api.customize({
      hooks: Object.fromEntries([...stages].map(name => [name, {
        functionName: `trace-${name}`,
        handler: ({ context }) => {
          const owner = name === 'checkPermissions'
            ? context.originalContext
            : name === 'enrichAttributes' ? context.parentContext : context
          return observe(`${owner.method}:${name}`, owner)
        }
      }]))
    })
  })
  beforeEach(async (test) => {
    enabled = false
    failureStage = undefined
    operationContext = undefined
    setterContext = undefined
    await fixture.reset()
    current = await fixture.seed('items', { name: 'Original' }, undefined, { generatedId: test.name.includes('POST-generated') })
    events.length = 0
    snapshots.length = 0
  })
  after(async () => { await fixture?.close() })

  async function invoke (operation, format, returning, transaction, context = { auth }) {
    const id = operation.generated ? undefined : operation.creates ? '99' : current.id
    const identifier = id === undefined ? {} : { id }
    const attributes = { name: 'Changed', ...(operation.method === 'put' && !operation.creates ? { active: true, score: 0 } : {}) }
    const inputRecord = format === 'plain' ? { ...identifier, ...attributes } : { data: { type: 'items', ...identifier, attributes } }
    operationContext = context
    enabled = true
    return fixture.api.resources.items[operation.method]({ ...identifier, inputRecord, format, returning, transaction }, operationContext)
  }

  for (const format of ['jsonapi', 'plain']) {
    for (const managed of [false, true]) {
      it(`rejects uncloneable response extensions before committing (${format}, ${managed ? 'managed' : 'owned'})`, async () => {
        try {
          const check = async transaction => {
            await assert.rejects(invoke(operations[0], format, 'full', transaction, { auth, uncloneableResponse: true }), error => {
              assertWriteFailure(error, { outcome: managed ? 'pending' : 'rolledBack' })
              assert.equal(error.cause.name, 'DataCloneError')
              return true
            })
            assert.equal(operationContext.transactionCommitted, false)
            assert.equal(operationContext.transaction.isCompleted(), !managed)
            assert.equal(events.some(stage => stage.startsWith('post:afterCommit')), false)
            assert.equal(events.filter(stage => stage === 'post:afterRollback:enter').length, managed ? 0 : 1)
            if (managed) assert.equal(operationContext.transaction, transaction)
          }
          if (managed) {
            await assert.rejects(fixture.api.transaction(check), error => {
              assertWriteFailure(error, { outcome: 'rolledBack' })
              assert.equal(error.cause.cause.name, 'DataCloneError')
              return true
            })
          } else await check()
          assert.equal(operationContext.transactionOutcome, 'rolledBack')
          assert.equal(events.filter(stage => stage === 'post:afterRollback:enter').length, 1)
        } finally {
          enabled = false
        }
        assert.equal(await fixture.count('items'), 1)
      })

      for (const operation of operations.filter(operation => operation.method !== 'delete')) {
        it(`${operation.name} clears the previous resource ID when reusing context (${format}, ${managed ? 'managed' : 'owned'})`, async () => {
          const context = { auth }
          await fixture.api.resources.items.get({ id: current.id, format }, context)
          assert.equal(String(context.id), current.id)
          try {
            const check = async transaction => {
              const result = await invoke(operation, format, 'full', transaction, context)
              const assigned = snapshots.findIndex(entry => entry.stage === (operation.method === 'post' ? 'post:afterDataCallPost' : `${operation.method}:beforeSchemaValidate`))
              assert(assigned > 0)
              for (const entry of snapshots.slice(0, assigned)) assert.equal(entry.id, undefined, entry.stage)
              const id = (format === 'plain' ? result : result.data).id
              if (operation.creates) assert.notEqual(id, current.id)
              else assert.equal(id, current.id)
              for (const entry of snapshots.slice(assigned)) assert.equal(String(entry.id), id, entry.stage)
              assert.equal(context.transaction.isCompleted(), !managed)
              if (managed) assert.equal(context.transaction, transaction)
            }
            if (managed) await fixture.api.transaction(check)
            else await check()
            assert.equal(context.transactionOutcome, 'committed')
            assert.equal(events.filter(stage => stage === `${operation.method}:afterCommit:enter`).length, 1)
          } finally {
            enabled = false
          }
          assert.equal(await fixture.count('items'), operation.creates ? 2 : 1)
        })
      }
    }
  }

  for (const operation of operations) {
    for (const format of ['jsonapi', 'plain']) {
      if (operation.method !== 'delete') {
        it(`${operation.name} detaches its minimal ${format} identifier before afterCommit`, async () => {
          const result = await invoke(operation, format, 'minimal', undefined, { auth, mutateCommittedResponse: true })
          const id = String(operationContext.id)
          assert.deepEqual(result, format === 'plain' ? { type: 'items', id } : { data: { type: 'items', id } })
          const mutated = format === 'plain' ? operationContext.responseRecord : operationContext.responseRecord.data
          assert.equal(mutated.id, 'Changed after commit')
          assert.equal(operationContext.transactionCommitted, true)
        })
      }
      for (const managed of [false, true]) {
        for (const returning of operation.method === 'delete' ? ['none'] : ['none', 'minimal', 'full']) {
          it(`${operation.name} ${format}/${returning} awaits its exact trace with ${managed ? 'managed' : 'owned'} transaction`, async () => {
            try {
              const check = async transaction => {
                const result = await invoke(operation, format, returning, transaction)
                const expected = writeStages(operation.method, returning, managed)
                assert.deepEqual(events, expected.flatMap(stage => [`${stage}:enter`, `${stage}:exit`]))
                assert.equal(operationContext.transaction.isCompleted(), !managed)
                assert.equal(operationContext.transactionCommitted, !managed)
                if (managed) assert.equal(operationContext.transaction, transaction)
                for (const entry of snapshots) {
                  assert.equal(entry.transaction, operationContext.transaction, entry.stage)
                  assert.equal(entry.completed, entry.stage.endsWith(':afterCommit'), entry.stage)
                  assert.equal(entry.auth, auth, entry.stage)
                }
                const id = operation.generated ? String(operationContext.id) : operation.creates ? '99' : current.id
                if (operation.generated) {
                  assert.notEqual(operationContext.id, undefined)
                  assert.notEqual(id, current.id)
                  const assigned = snapshots.findIndex(entry => entry.stage === 'post:afterDataCallPost')
                  assert(assigned > 0)
                  for (const entry of snapshots.slice(0, assigned)) {
                    assert.equal(entry.id, undefined, entry.stage)
                    assert.equal(entry.inputId, undefined, entry.stage)
                  }
                  for (const entry of snapshots.slice(assigned)) assert.equal(String(entry.id), id, entry.stage)
                }
                const finished = snapshots.find(entry => entry.stage === `${operation.method}:finish`)
                assert.equal(String(finished.id), id)
                assert.equal(finished.context.method, operation.method)
                if (operation.method !== 'delete') {
                  assert.equal(setterContext.method, operation.method)
                  assert.equal(setterContext.scopeName, 'items')
                  assert.equal(setterContext.auth, auth)
                  assert.equal(setterContext.originalValue, 'Changed')
                  assert.equal(setterContext.originalAttributes.name, 'Changed')
                  assert.equal(finished.minimalName, 'CHANGED')
                  assert.equal(snapshots.find(entry => entry.stage === `${operation.method}:afterDataCall`).inputName, 'CHANGED')
                  const before = snapshots.find(entry => entry.stage === `${operation.method}:beforeDataCall`)
                  assert.equal(before.inputName, 'Changed')
                  if (!operation.creates) assert.equal(before.minimalName, 'ORIGINAL')
                  if (operation.method === 'put') assert.equal(finished.context.isCreate, operation.creates)
                } else assert.equal(finished.minimalName, 'ORIGINAL')
                if (returning === 'none') assert.equal(result, undefined)
                else if (returning === 'minimal') assert.deepEqual(result, format === 'plain' ? { type: 'items', id } : { data: { type: 'items', id } })
                else {
                  const record = format === 'plain' ? result : result.data
                  assert.equal(record.id, id)
                  assert.equal(format === 'plain' ? record.name : record.attributes.name, 'CHANGED')
                  const read = snapshots.find(entry => entry.stage === 'get:finish')
                  assert.notEqual(read.context, operationContext)
                  assert.equal(read.context.method, 'get')
                  assert.deepEqual(finished.response, result)
                }
              }
              if (managed) await fixture.api.transaction(check)
              else await check()
              assert.deepEqual(events, writeStages(operation.method, returning, false).flatMap(stage => [`${stage}:enter`, `${stage}:exit`]))
              assert.equal(operationContext.transactionOutcome, 'committed')
            } finally {
              enabled = false
            }
            assert.equal(await fixture.count('items'), operation.creates ? 2 : operation.method === 'delete' ? 0 : 1)
          })
        }
      }
    }

    for (const managed of [false, true]) {
      for (const stage of writeStages(operation.method, 'full', managed)) {
        it(`${operation.name} ${managed ? 'managed' : 'owned'} failure at ${stage} stops later stages and preserves ownership`, async () => {
          failureStage = stage
          try {
            const check = async transaction => {
              await assert.rejects(invoke(operation, 'jsonapi', 'full', transaction), error => assertWriteFailure(error, { cause: injectedError, outcome: managed ? 'pending' : stage.endsWith(':afterCommit') ? 'committed' : 'rolledBack' }))
              const stages = writeStages(operation.method, 'full', managed)
              const beforeFailure = stages.slice(0, stages.indexOf(stage))
              const rolledBack = !managed && !stage.endsWith(':afterCommit')
              assert.deepEqual(events, [
                ...beforeFailure.flatMap(name => [`${name}:enter`, `${name}:exit`]), `${stage}:enter`,
                ...(rolledBack ? [`${operation.method}:afterRollback:enter`, `${operation.method}:afterRollback:exit`] : [])
              ])
              assert.equal(operationContext.transaction.isCompleted(), !managed)
              assert.equal(operationContext.transactionCommitted, stage.endsWith(':afterCommit'))
              if (managed) assert.equal(operationContext.transaction, transaction)
            }
            if (managed) {
              await assert.rejects(fixture.api.transaction(check), error => {
                assertWriteFailure(error, { outcome: 'rolledBack' })
                assert.equal(error.cause.cause, injectedError)
                return true
              })
            } else await check()
            assert.equal(operationContext.transaction.isCompleted(), true)
            assert.equal(operationContext.transactionOutcome, stage.endsWith(':afterCommit') ? 'committed' : 'rolledBack')
            if (!stage.endsWith(':afterCommit')) {
              assert.deepEqual(events.slice(-2), [`${operation.method}:afterRollback:enter`, `${operation.method}:afterRollback:exit`])
              assert.equal(events.filter(event => event === `${operation.method}:afterRollback:enter`).length, 1)
            }
          } finally {
            enabled = false
          }
          const committed = stage.endsWith(':afterCommit')
          assert.equal(await fixture.count('items'), committed ? operation.creates ? 2 : operation.method === 'delete' ? 0 : 1 : 1)
          if (!(committed && operation.method === 'delete')) {
            const stored = await fixture.api.resources.items.get({ id: committed && operation.creates ? operationContext.id : current.id, format: 'plain' })
            assert.equal(stored.name, committed ? 'CHANGED' : 'ORIGINAL')
          }
        })
      }
    }
  }
})

describe(`Composed bulk lifecycle (${storageMode.mode})`, () => {
  let fixture, enabled, currentWrite, records, failureStage
  const events = []
  const snapshots = []
  const primary = new RestApiValidationError('Roll back completed bulk work')
  const observe = async (stage, context) => {
    if (!enabled || !context.bulkOperation) return
    currentWrite = context
    events.push([context.bulkIndex, `${stage}:enter`])
    snapshots.push({ stage, context, transaction: context.transaction, completed: context.transaction.isCompleted() })
    await setImmediate()
    if (context.bulkIndex === 1 && stage === failureStage) throw primary
    events.push([context.bulkIndex, `${stage}:exit`])
  }
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: {
        bulk: true,
        fieldCallback: async (phase, scopeName, value) => {
          if (phase === 'setter' && enabled) await observe(`${currentWrite.method}:setter`, currentWrite)
          return phase === 'computed' ? `Computed ${value}` : value
        }
      }
    })
    const names = new Set(['post', 'patch', 'delete'].flatMap(method => writeStages(method, 'none', false)).map(stage => stage.split(':')[1]))
    names.delete('setter')
    names.add('afterRollback')
    await fixture.api.customize({
      hooks: Object.fromEntries([...names].map(name => [name, {
        functionName: `composed-trace-${name}`,
        handler: ({ context }) => {
          const operation = context.originalContext || context
          return observe(`${operation.method}:${name}`, operation)
        }
      }]))
    })
  })
  beforeEach(async () => {
    enabled = false
    currentWrite = failureStage = undefined
    events.length = snapshots.length = 0
    await fixture.reset()
    records = []
    for (const index of [0, 1]) records.push(await fixture.seed('items', { name: `Original ${index}` }))
  })
  after(async () => { await fixture?.close() })

  const bulkInput = method => method === 'post'
    ? { inputRecords: records.map((record, index) => ({ type: 'items', id: String(10 + index), attributes: { name: `Changed ${10 + index}` } })) }
    : method === 'patch'
      ? { operations: records.map(({ id }, index) => ({ id, data: { type: 'items', id, attributes: { name: `Changed ${index}` } } })) }
      : { ids: records.map(({ id }) => id) }

  for (const method of ['post', 'patch', 'delete']) {
    for (const mode of ['atomic', 'non-atomic', 'managed commit', 'managed rollback']) {
      it(`${method} awaits every child stage and its ${mode} completion`, async () => {
        enabled = true
        const bulkMethod = `bulk${method[0].toUpperCase()}${method.slice(1)}`
        const atomic = mode !== 'non-atomic'
        const managed = mode.startsWith('managed')
        const rollback = mode === 'managed rollback'
        const input = bulkInput(method)
        let sharedTransaction
        const invoke = async transaction => {
          sharedTransaction = transaction
          await fixture.api.resources.items[bulkMethod]({ ...input, atomic, format: 'jsonapi', returning: 'none', transaction })
          if (managed) {
            assert.equal(transaction.isCompleted(), false)
            assert.equal(snapshots.some(entry => /afterCommit|afterRollback/.test(entry.stage)), false)
          }
          if (rollback) throw primary
        }
        if (rollback) await assert.rejects(fixture.api.transaction(invoke), error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
        else if (managed) await fixture.api.transaction(invoke)
        else await invoke()
        const stages = writeStages(method, 'none', atomic)
        const expected = [0, 1].flatMap(index => stages.map(stage => [index, stage]))
        if (atomic) expected.push(...(rollback ? [1, 0] : [0, 1]).map(index => [index, `${method}:${rollback ? 'afterRollback' : 'afterCommit'}`]))
        assert.deepEqual(events, expected.flatMap(([index, stage]) => [[index, `${stage}:enter`], [index, `${stage}:exit`]]))
        const contexts = new Set(snapshots.map(entry => entry.context))
        assert.equal(contexts.size, 2)
        const transactions = new Set(snapshots.map(entry => entry.transaction))
        assert.equal(transactions.size, atomic ? 1 : 2)
        if (managed) assert.deepEqual([...transactions], [sharedTransaction])
        for (const entry of snapshots) assert.equal(entry.completed, /afterCommit|afterRollback/.test(entry.stage))
        const stored = (await fixture.api.resources.items.query({ format: 'plain' })).data
        assert.equal(stored.length, rollback ? 2 : method === 'post' ? 4 : method === 'delete' ? 0 : 2)
        if (rollback) assert.deepEqual(stored.map(row => row.name).sort(), ['Original 0', 'Original 1'])
        if (!rollback && method === 'patch') assert.deepEqual(stored.map(row => row.name).sort(), ['Changed 0', 'Changed 1'])
      })
    }
  }
  for (const method of ['post', 'patch', 'delete']) {
    const stages = writeStages(method, 'none', true)
    for (const stage of [...stages, `${method}:afterCommit`]) {
      for (const mode of ['atomic', 'non-atomic', 'managed']) {
        it(`${method} ${mode} stops the failing child at ${stage}`, async () => {
          records.push(await fixture.seed('items', { name: 'Original 2' }))
          enabled = true
          failureStage = stage
          const atomic = mode !== 'non-atomic'
          const committed = stage.endsWith(':afterCommit')
          const bulkMethod = `bulk${method[0].toUpperCase()}${method.slice(1)}`
          const invoke = transaction => fixture.api.resources.items[bulkMethod]({ ...bulkInput(method), atomic, returning: 'none', format: 'jsonapi', transaction })
          const work = mode === 'managed' ? fixture.api.transaction(invoke) : invoke()
          if (atomic) await assert.rejects(work, error => assertWriteFailure(error, { cause: primary, outcome: committed ? 'committed' : 'rolledBack' }))
          else {
            const result = await work
            assert.equal(result.meta.succeeded, 2)
            assert.equal(result.meta.failed, 1)
            assert.equal(result.errors[0].index, 1)
            assert.equal(result.errors[0].error.code, primary.code)
            assert.equal(result.errors[0].error.transactionOutcome, committed ? 'committed' : 'rolledBack')
          }
          const expected = []
          const append = (index, list) => {
            for (const entry of list) {
              expected.push([index, `${entry}:enter`])
              if (index !== 1 || entry !== stage) expected.push([index, `${entry}:exit`])
            }
          }
          if (committed) {
            for (const index of [0, 1, 2]) append(index, [...stages, ...(atomic ? [] : [`${method}:afterCommit`])])
            if (atomic) for (const index of [0, 1, 2]) append(index, [`${method}:afterCommit`])
          } else {
            append(0, [...stages, ...(atomic ? [] : [`${method}:afterCommit`])])
            append(1, stages.slice(0, stages.indexOf(stage) + 1))
            append(1, [`${method}:afterRollback`])
            if (atomic) append(0, [`${method}:afterRollback`])
            else append(2, [...stages, `${method}:afterCommit`])
          }
          assert.deepEqual(events, expected)
          assert.equal(new Set(snapshots.map(entry => entry.context)).size, atomic && !committed ? 2 : 3)
          assert.equal(new Set(snapshots.map(entry => entry.transaction)).size, atomic ? 1 : 3)
          for (const entry of snapshots) assert.equal(entry.completed, /afterCommit|afterRollback/.test(entry.stage))
          const stored = (await fixture.api.resources.items.query({ format: 'plain' })).data
          const names = stored.map(row => row.name).sort()
          const originalNames = ['Original 0', 'Original 1', 'Original 2']
          const successful = [0, 1, 2].filter(index => committed || index !== 1)
          const expectedNames = atomic && !committed
            ? originalNames
            : method === 'post'
              ? [...originalNames, ...successful.map(index => `Changed ${10 + index}`)].sort()
              : method === 'patch'
                ? originalNames.map((name, index) => successful.includes(index) ? `Changed ${index}` : name).sort()
                : committed ? [] : ['Original 1']
          assert.deepEqual(names, expectedNames)
        })
      }
    }
  }
})

describe(`Composed relationship lifecycle (${storageMode.mode})`, () => {
  let fixture, enabled, failureStage, failureOccurrence, failureVisits, transaction, group, otherGroup, item, otherItem
  const events = []
  const snapshots = []
  const primary = new RestApiValidationError('Reject relationship composition')
  const methods = ['postRelationship', 'patchRelationship', 'deleteRelationship']
  const patchStages = writeStages('patch', 'none', true).filter(stage => !stage.endsWith(':setter')).map(stage => stage.split(':')[1])
  const suffix = method => method[0].toUpperCase() + method.slice(1)
  const label = (scopeName, id, method, hook) => `${scopeName}/${id}/${method}/${hook}`
  const compose = (parent, method, children) => {
    const outer = hook => label(parent.type, parent.id, method, hook)
    const patch = (record, hooks = patchStages) => hooks.map(hook => label(record.type, hook.startsWith('beforeProcessing') ? undefined : record.id, 'patch', hook))
    const stages = [outer('checkPermissions'), outer(`checkPermissions${suffix(method)}`)]
    const participants = [{ record: parent, method, start: 0 }]
    if (method === 'patchRelationship') {
      participants.push({ record: parent, method: 'patch', start: stages.length })
      stages.push(...patch(parent, patchStages.slice(0, -2)))
    } else stages.push(outer('beforeDataCall'), outer(`beforeDataCall${suffix(method)}`))
    for (const child of children) {
      participants.push({ record: child, method: 'patch', start: stages.length })
      stages.push(...patch(child))
    }
    if (method === 'patchRelationship') stages.push(...patch(parent, patchStages.slice(-2)))
    stages.push(outer('finish'), outer(`finish${suffix(method)}`))
    return { stages, participants }
  }
  const relations = [
    { scope: 'items', name: 'groups', many: true },
    { scope: 'groups', name: 'members', many: true },
    { scope: 'groups', name: 'items', many: true, reverse: true },
    { scope: 'groups', name: 'mentions', many: true, reverse: true },
    { scope: 'groups', name: 'firstItem', reverse: true },
    { scope: 'items', name: 'group' },
    { scope: 'items', name: 'subject' }
  ]
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: { inverseMembership: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    const names = new Set([...patchStages, 'afterCommit', 'afterRollback', ...methods.flatMap(method => [
      `checkPermissions${suffix(method)}`, `beforeDataCall${suffix(method)}`, `finish${suffix(method)}`
    ])])
    await fixture.api.customize({
      hooks: Object.fromEntries([...names].map(name => [name, {
        functionName: `relationship-trace-${name}`,
        handler: async ({ context }) => {
          const operation = context.originalContext || context
          if (!enabled || ![...methods, 'patch'].includes(operation.method)) return
          const stage = label(operation.scopeName, operation.id, operation.method, name)
          events.push(`${stage}:enter`)
          snapshots.push({ stage, context: operation, transaction: operation.transaction, completed: operation.transaction.isCompleted() })
          await setImmediate()
          if (stage === failureStage && ++failureVisits === failureOccurrence) throw primary
          events.push(`${stage}:exit`)
        }
      }]))
    })
  })
  beforeEach(async () => {
    enabled = false
    failureStage = transaction = undefined
    failureOccurrence = 1
    failureVisits = 0
    events.length = snapshots.length = 0
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    otherGroup = await fixture.seed('groups', { name: 'Other group' })
    item = await fixture.seed('items', { name: 'Item' })
    otherItem = await fixture.seed('items', { name: 'Other item' })
  })
  after(async () => { await fixture?.close() })

  for (const relation of relations) {
    for (const method of relation.many ? methods : ['patchRelationship']) {
      for (const clear of method === 'patchRelationship' ? [false, true] : [false]) {
        for (const mode of ['owned commit', 'owned rollback', 'managed commit', 'managed rollback']) {
          it(`${relation.scope}.${relation.name} ${method}${clear ? ' clear' : ''} traces nested writes under ${mode}`, async () => {
            const parent = relation.scope === 'items' ? item : group
            const oldTarget = relation.scope === 'items' ? group : item
            const newTarget = relation.scope === 'items' ? otherGroup : otherItem
            const idOf = ({ type, id }) => ({ type, id })
            const initial = relation.many ? [idOf(oldTarget)] : idOf(oldTarget)
            const resource = fixture.api.resources[relation.scope]
            await resource.patchRelationship({ id: parent.id, relationshipName: relation.name, relationshipData: initial })
            const managed = mode.startsWith('managed')
            const rollback = mode.endsWith('rollback')
            const target = method === 'deleteRelationship' ? oldTarget : newTarget
            const children = relation.reverse ? method === 'patchRelationship' ? clear ? [oldTarget] : [oldTarget, newTarget] : [target] : []
            const { stages, participants: enlisted } = compose(parent, method, children)
            if (rollback && !managed) failureStage = stages.at(-1)
            enabled = true
            const invoke = async supplied => {
              transaction = supplied
              await resource[method]({ id: parent.id, relationshipName: relation.name, relationshipData: clear ? relation.many ? [] : null : relation.many ? [idOf(target)] : idOf(target), transaction: supplied })
              if (managed) {
                assert.equal(supplied.isCompleted(), false)
                assert.equal(snapshots.some(entry => /afterCommit|afterRollback/.test(entry.stage)), false)
                if (rollback) throw primary
              }
            }
            const work = managed ? fixture.api.transaction(invoke) : invoke()
            if (rollback) await assert.rejects(work, error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
            else await work
            const participants = enlisted.map(({ record, method }) => hook => label(record.type, record.id, method, hook))
            const expected = stages.flatMap(stage => stage === failureStage ? [`${stage}:enter`] : [`${stage}:enter`, `${stage}:exit`])
            for (const participant of rollback ? [...participants].reverse() : participants) {
              const stage = participant(rollback ? 'afterRollback' : 'afterCommit')
              expected.push(`${stage}:enter`, `${stage}:exit`)
            }
            assert.deepEqual(events, expected)
            assert.equal(new Set(snapshots.map(entry => entry.context)).size, participants.length)
            const transactions = [...new Set(snapshots.map(entry => entry.transaction))]
            assert.equal(transactions.length, 1)
            if (managed) assert.equal(transactions[0], transaction)
            for (const entry of snapshots) assert.equal(entry.completed, /afterCommit|afterRollback/.test(entry.stage))
            enabled = false
            const stored = (await resource.getRelationship({ id: parent.id, relationshipName: relation.name })).data
            const expectedData = rollback ? initial : clear ? relation.many ? [] : null : method === 'deleteRelationship' ? [] : relation.many ? method === 'postRelationship' ? [idOf(oldTarget), idOf(newTarget)] : [idOf(newTarget)] : idOf(newTarget)
            if (Array.isArray(stored)) assert.deepEqual(stored.sort((a, b) => a.id.localeCompare(b.id)), expectedData)
            else assert.deepEqual(stored, expectedData)
          })
        }
      }
    }
  }

  for (const reverse of [false, true]) {
    for (const method of methods) {
      const sampleParent = { type: reverse ? 'groups' : 'items', id: 'parent' }
      const sampleOld = { type: reverse ? 'items' : 'groups', id: 'old' }
      const sampleNew = { ...sampleOld, id: 'new' }
      const sampleChildren = reverse ? method === 'patchRelationship' ? [sampleOld, sampleNew] : [method === 'deleteRelationship' ? sampleOld : sampleNew] : []
      const sample = compose(sampleParent, method, sampleChildren)
      const labels = [...sample.stages, ...sample.participants.map(({ record, method }) => label(record.type, record.id, method, 'afterCommit'))]
      for (const [failureIndex, failureLabel] of labels.entries()) {
        for (const managed of [false, true]) {
          it(`${reverse ? 'reverse' : 'pivot'} ${method} ${managed ? 'managed' : 'owned'} fails at ${failureLabel}`, async () => {
            const parent = reverse ? group : item
            const oldTarget = reverse ? item : group
            const newTarget = reverse ? otherItem : otherGroup
            const relationshipName = reverse ? 'items' : 'groups'
            const resource = fixture.api.resources[parent.type]
            const identifier = ({ type, id }) => ({ type, id })
            await resource.patchRelationship({ id: parent.id, relationshipName, relationshipData: [identifier(oldTarget)] })
            const target = method === 'deleteRelationship' ? oldTarget : newTarget
            const children = reverse ? method === 'patchRelationship' ? [oldTarget, newTarget] : [target] : []
            const { stages, participants } = compose(parent, method, children)
            const completion = ({ record, method }, hook) => label(record.type, record.id, method, hook)
            const completeTrace = [...stages, ...participants.map(participant => completion(participant, 'afterCommit'))]
            failureStage = completeTrace[failureIndex]
            failureOccurrence = completeTrace.slice(0, failureIndex + 1).filter(stage => stage === failureStage).length
            const committed = failureIndex >= stages.length
            enabled = true
            const invoke = async transaction => {
              await resource[method]({ id: parent.id, relationshipName, relationshipData: [identifier(target)], transaction })
              assert.equal(managed, true, 'Only a participant may return before its failing completion hook')
              assert.equal(transaction.isCompleted(), false)
            }
            await assert.rejects(managed ? fixture.api.transaction(invoke) : invoke(), error => assertWriteFailure(error, { cause: primary, outcome: committed ? 'committed' : 'rolledBack' }))
            const expected = []
            const append = (stage, failed = false) => {
              expected.push(`${stage}:enter`)
              if (!failed) expected.push(`${stage}:exit`)
            }
            const reached = committed ? participants : participants.filter(participant => participant.start <= failureIndex)
            if (committed) completeTrace.forEach((stage, index) => append(stage, index === failureIndex))
            else {
              stages.slice(0, failureIndex + 1).forEach((stage, index) => append(stage, index === failureIndex))
              for (const participant of [...reached].reverse()) {
                const earlyPatch = participant.method === 'patch' && failureIndex < participant.start + 2
                append(label(participant.record.type, earlyPatch ? undefined : participant.record.id, participant.method, 'afterRollback'))
              }
            }
            assert.deepEqual(events, expected)
            assert.equal(new Set(snapshots.map(entry => entry.context)).size, reached.length)
            assert.equal(new Set(snapshots.map(entry => entry.transaction)).size, 1)
            for (const entry of snapshots) assert.equal(entry.completed, /afterCommit|afterRollback/.test(entry.stage))
            enabled = false
            const stored = (await resource.getRelationship({ id: parent.id, relationshipName })).data
            const expectedData = !committed ? [identifier(oldTarget)] : method === 'deleteRelationship' ? [] : method === 'postRelationship' ? [identifier(oldTarget), identifier(newTarget)] : [identifier(newTarget)]
            assert.deepEqual(stored.sort((a, b) => a.id.localeCompare(b.id)), expectedData)
          })
        }
      }
    }
  }
})
