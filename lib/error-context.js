// @ts-check
/** @import { OwnedTransaction, TransactionOutcome } from './transaction-types.js' */
/** @import { TransactionContext, TransactionState, TransactionFactory, TransactionCallback, CompletionHook, CleanupDiagnostic, WriteRequest } from './transaction-types.js' */
import { finishKnexTransactionConnection } from './knex-transaction.js'
import { RestApiError, RestApiValidationError, RestApiWriteError } from './rest-api-errors.js'
import { types } from 'node:util'

/** @type {WeakSet<OwnedTransaction>} */
const commitRollbacks = new WeakSet()
/** @type {WeakMap<OwnedTransaction, TransactionState>} */
const managedTransactions = new WeakMap()
/** @type {WeakMap<TransactionContext, TransactionState>} */
const activeContexts = new WeakMap()

/**
 * @param {unknown} error
 */
export function isRestApiError (error) {
  return error instanceof RestApiError
}

/**
 * @template {WriteRequest} Request
 * @template Result
 * @param {(request: Request) => Result | Promise<Result>} handler
 * @returns {(request: Request) => Promise<Result>}
 */
export function withWriteOutcome (handler) {
  return async request => {
    try {
      assertContextAvailable(request.context)
    } catch (error) {
      throw wrapWriteError(error, { transaction: activeContexts.get(request.context)?.transaction })
    }
    Object.assign(request.context, {
      error: undefined,
      cleanupErrors: undefined,
      transaction: undefined,
      transactionOutcome: undefined,
      transactionCommitted: false,
      shouldCommit: false
    })
    try {
      return await handler(request)
    } catch (error) {
      const context = request.context
      const transaction = context.transaction || request.params?.transaction
      const state = transaction ? managedTransactions.get(transaction) : undefined
      const participant = state?.participants.find(operation => operation.context === context)
      if (participant) participant.failed = true
      const ownsTransaction = state ? state.owner === context : context.shouldCommit
      if (ownsTransaction && state?.phase !== 'finished') {
        await rollbackAfterError(error, context, context.transaction)
      }
      throw wrapWriteError(error, context, context.transaction || request.params?.transaction)
    } finally {
      endWriteOperation(request.context)
    }
  }
}

/**
 * @template {{ context: TransactionContext }} Request
 * @template Result
 * @param {(request: Request) => Result} handler
 * @returns {(request: Request) => Result}
 */
export function withAvailableContext (handler) {
  return request => {
    assertContextAvailable(request.context)
    return handler(request)
  }
}

/**
 * @param {TransactionContext} context
 */
function assertContextAvailable (context) {
  const state = activeContexts.get(context)
  if (!state) return
  const error = new RestApiValidationError('Context is still in use by a transaction; use a separate context for each operation', { fields: ['context'] })
  failTransaction(state, error)
  throw error
}

/**
 * @param {TransactionState | undefined} state
 * @param {unknown} error
 */
function failTransaction (state, error) {
  if (!state || state.phase !== 'pending' || state.failed) return
  state.failed = true
  state.error = error
}

/**
 * @param {OwnedTransaction | undefined} transaction
 */
function transactionState (transaction) {
  for (let current = transaction; current; current = current.parentTransaction) {
    const state = managedTransactions.get(current)
    if (state) return state
  }
}

/**
 * @param {TransactionContext} context
 * @param {OwnedTransaction | null | undefined} transaction
 * @param {TransactionFactory | undefined} createTransaction
 * @param {CompletionHook} [runHooks]
 */
export async function beginWriteTransaction (context, transaction, createTransaction, runHooks) {
  /** @type {TransactionState | undefined} */
  let state
  if (transaction) {
    state = managedTransactions.get(transaction)
    if (!state || state.phase !== 'pending' || transaction.isCompleted()) {
      throw new RestApiValidationError('transaction must be an active transaction from api.transaction; raw transactions and savepoints cannot own library writes', { fields: ['transaction'] })
    }
    if (state.failed) throw state.error
    context.transaction = transaction
    context.shouldCommit = false
  } else {
    if (typeof createTransaction !== 'function') throw new RestApiValidationError('No transaction factory is installed')
    transaction = context.transaction = await createTransaction(context)
    if (managedTransactions.has(transaction)) {
      throw new RestApiValidationError('A transaction factory must create a new transaction, not return an existing owner', { fields: ['transaction'] })
    }
    context.shouldCommit = !!transaction
    if (!transaction || transaction.parentTransaction) {
      throw new RestApiValidationError('Owned transactions must be top-level; use api.transaction to compose library writes', { fields: ['transaction'] })
    }
    state = {
      transaction,
      owner: context,
      phase: 'pending',
      failed: false,
      participants: [],
      contexts: new Set(),
      finalizers: [],
      inFlight: new Map()
    }
    managedTransactions.set(transaction, state)
    state.onQueryError = error => failTransaction(state, error)
    transaction.on('query-error', state.onQueryError)
  }
  state.contexts.add(context)
  state.inFlight.set(context, Promise.withResolvers())
  activeContexts.set(context, state)
  if (runHooks) state.participants.push({ context, runHooks, operationIndex: state.participants.length })
  return transaction
}

/**
 * @param {TransactionContext} context
 */
export function endWriteOperation (context) {
  const state = context.transaction ? managedTransactions.get(context.transaction) : undefined
  state?.inFlight.get(context)?.resolve()
  state?.inFlight.delete(context)
}

/**
 * @param {TransactionContext} context
 */
export function isTransactionOwner (context) {
  return activeContexts.get(context)?.owner === context
}

/**
 * @param {TransactionState | undefined} state
 * @param {TransactionContext} context
 */
async function awaitOtherOperations (state, context) {
  if (!state) return
  const pending = []
  for (const [operation, completion] of state.inFlight) {
    if (operation !== context) pending.push(completion.promise)
  }
  await Promise.all(pending)
}

/**
 * @template Result
 * @param {{ params: TransactionCallback<Result>, context: TransactionContext, helpers: { newTransaction?: TransactionFactory } }} request
 */
export async function transactionMethod ({ params: callback, context, helpers }) {
  if (typeof callback !== 'function') throw new RestApiValidationError('transaction requires a callback', { fields: ['callback'] })
  const transaction = await beginWriteTransaction(context, null, helpers.newTransaction)
  const value = await callback(transaction)
  await commitTransaction(transaction, context)
  return value
}

/**
 * @param {OwnedTransaction} transaction
 * @param {() => unknown | Promise<unknown>} callback
 */
export function onTransactionFinished (transaction, callback) {
  const state = managedTransactions.get(transaction)
  if (state && state.phase !== 'finished') state.finalizers.push(callback)
}

/**
 * @param {TransactionState | undefined} state
 * @param {TransactionContext} context
 */
async function finishTransaction (state, context) {
  if (state?.phase === 'finished') return
  if (!state) {
    try {
      await finishKnexTransactionConnection(context.transaction, context.transactionOutcome, context.error)
    } catch (error) {
      (context.cleanupErrors ||= []).push({ phase: 'connectionRelease', error })
    }
    return
  }
  state.phase = 'finishing'
  const outcome = context.transactionOutcome
  /** @type {'afterCommit' | 'afterRollback' | null} */
  let hook = null
  if (outcome === 'committed') {
    hook = 'afterCommit'
  } else if (outcome === 'rolledBack') {
    hook = 'afterRollback'
  }
  let failed = false
  let primary
  /** @param {unknown} error
   * @param {Omit<CleanupDiagnostic, "error">} details
   */
  const retainFailure = (error, details) => {
    if (outcome === 'committed' && !failed) {
      failed = true
      primary = error
    } else {
      (context.cleanupErrors ||= []).push({ ...details, error })
    }
  }
  try {
    try {
      await finishKnexTransactionConnection(state.transaction, outcome, context.error)
    } catch (error) {
      retainFailure(error, { phase: 'connectionRelease' })
    }
    for (const operation of state.contexts) {
      operation.transactionOutcome = outcome || 'unknown'
      operation.transactionCommitted = outcome === 'committed'
    }
    const participants = outcome === 'rolledBack' ? [...state.participants].reverse() : state.participants
    for (const { context: operation, runHooks, operationIndex, failed: operationFailed } of participants) {
      if (!hook) continue
      if (hook === 'afterRollback' && !operationFailed) operation.error = context.error
      try {
        await runHooks(hook)
      } catch (error) {
        if (hook === 'afterCommit') operation.error = error
        retainFailure(error, { phase: hook, operationIndex, scopeName: operation.scopeName, method: operation.method })
      }
    }
    for (const [finalizerIndex, finalize] of state.finalizers.entries()) {
      try {
        await finalize()
      } catch (error) {
        retainFailure(error, { phase: 'finalization', finalizerIndex })
      }
    }
  } finally {
    state.phase = 'finished'
    if (state.onQueryError) state.transaction.off('query-error', state.onQueryError)
    for (const operation of state.contexts) activeContexts.delete(operation)
    state.contexts.clear()
    state.participants.length = 0
    state.finalizers.length = 0
    state.inFlight.clear()
  }
  if (failed) throw primary
}

/**
 * @param {unknown} error
 * @param {TransactionContext} context
 * @param {OwnedTransaction} [transaction]
 */
export function wrapWriteError (error, context, transaction = context.transaction) {
  context.error = error
  const wrapped = new RestApiWriteError(errorMessage(error), { cause: error, transactionOutcome: getWriteOutcome(context) })
  failTransaction(transactionState(transaction), wrapped)
  return wrapped
}

/**
 * @param {TransactionContext} context
 * @returns {TransactionOutcome}
 */
export function getWriteOutcome (context) {
  if (context.transactionOutcome) return context.transactionOutcome
  if (!context.transaction) return 'none'
  if (context.transaction.isCompleted?.()) return 'unknown'
  return 'pending'
}

/**
 * @param {TransactionContext & { db?: { client?: { config?: { client?: unknown } } } }} context
 * @param {{ phase: string, method?: string, scopeName?: string, backend?: unknown }} options
 */
export function getOperationDiagnosticContext (context, {
  phase,
  method = context.method,
  scopeName = context.scopeName,
  backend = context.db?.client?.config?.client
}) {
  return {
    method: method ?? null,
    scopeName: scopeName ?? null,
    phase,
    backend: typeof backend === 'string' ? backend : null,
    transactionOutcome: getWriteOutcome(context)
  }
}

/**
 * @param {OwnedTransaction} transaction
 * @param {TransactionContext} context
 */
export async function commitTransaction (transaction, context) {
  if (transaction.parentTransaction) {
    throw new RestApiValidationError('Owned transactions must be top-level; use api.transaction to compose library writes', { fields: ['transaction'] })
  }
  const state = managedTransactions.get(transaction)
  if (state && state.owner !== context) throw new RestApiValidationError('Only the transaction owner can complete it', { fields: ['transaction'] })
  if (state?.failed) throw state.error
  if (state && [...state.inFlight.keys()].some(operation => operation !== context)) {
    state.phase = 'completing'
    await awaitOtherOperations(state, context)
    throw new RestApiValidationError('Await every library operation before returning from the transaction callback', { fields: ['callback'] })
  }
  if (transaction.isCompleted()) throw new RestApiValidationError('Transaction was completed outside its owner', { fields: ['transaction'] })
  if (state) state.phase = 'completing'
  context.transactionOutcome = 'unknown'
  const result = /** @type {unknown} */ (await transaction.commit())
  const response = result && typeof result === 'object' && 'response' in result ? result.response : undefined
  const rolledBack = !!response && typeof response === 'object' && 'command' in response && response.command === 'ROLLBACK'
  if (rolledBack) {
    commitRollbacks.add(transaction)
    context.transactionOutcome = 'rolledBack'
  }
  await transaction.executionPromise
  if (rolledBack) throw new Error('Transaction was rolled back instead of committed')
  context.transactionOutcome = 'committed'
  context.transactionCommitted = true
  await finishTransaction(state, context)
}

/**
 * @param {unknown} error
 * @param {TransactionContext} context
 * @param {OwnedTransaction | undefined} transaction
 */
export async function rollbackAfterError (error, context, transaction) {
  context.error = error
  context.cleanupErrors ||= []
  if (!transaction) return false
  const state = managedTransactions.get(transaction)
  if (state && state.owner !== context) return false
  if (state?.phase === 'finished') return false
  const participant = state?.participants.find(operation => operation.context === context)
  if (participant) participant.failed = true
  if (state) state.phase = 'completing'
  await awaitOtherOperations(state, context)

  try {
    // PostgreSQL can acknowledge COMMIT with ROLLBACK after a caught SQL error.
    if (commitRollbacks.delete(transaction)) {
      context.transactionOutcome = 'rolledBack'
      await finishTransaction(state, context)
      return true
    }
    if (transaction.isCompleted?.()) {
      await finishTransaction(state, context)
      return false
    }
    context.transactionOutcome = 'unknown'
    await transaction.rollback()
    await transaction.executionPromise
    context.transactionOutcome = 'rolledBack'
    await finishTransaction(state, context)
    return true
  } catch (error) {
    context.cleanupErrors.push({ phase: 'rollback', error })
    await finishTransaction(state, context)
    return false
  }
}

/**
 * Add operational context to unexpected failures without erasing typed API
 * errors that callers and transports need to classify.
 *
 * @param {unknown} error
 * @param {{ message?: string, context?: unknown }} [options]
 */
export function wrapUnexpectedError (error, { message, context } = {}) {
  if (isRestApiError(error)) {
    return error
  }

  const wrappedError = new Error(`${message}: ${errorMessage(error)}`, {
    cause: error
  })
  return Object.assign(wrappedError, { context })
}

/**
 * @param {unknown} error
 */
export function errorMessage (error) {
  try {
    if (getBinaryDiagnostic(error)) return 'Binary value thrown'
    const message = /** @type {unknown} */ (Reflect.get(Object(error), 'message'))
    return typeof message === 'string' ? message : String(error)
  } catch {
    return 'Non-Error value thrown'
  }
}

/** @param {unknown} value */
export function getBinaryDiagnostic (value) {
  if (Buffer.isBuffer(value)) return { type: 'Buffer', byteLength: value.byteLength }
  if (ArrayBuffer.isView(value)) return { type: 'ArrayBufferView', byteLength: value.byteLength }
  if (types.isSharedArrayBuffer(value)) return { type: 'SharedArrayBuffer', byteLength: value.byteLength }
  if (types.isAnyArrayBuffer(value)) return { type: 'ArrayBuffer', byteLength: value.byteLength }
}
