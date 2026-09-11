import assert from 'node:assert/strict'

// Keep the callback open while concurrency tests coordinate independent owners.
export async function holdManagedTransaction (api) {
  const ready = Promise.withResolvers()
  const finish = Promise.withResolvers()
  const rollbackRequested = new Error('Test callback requested rollback')
  const outcome = api.transaction(transaction => {
    ready.resolve(transaction)
    return finish.promise
  })
  outcome.catch(error => ready.reject(error))
  return {
    transaction: await ready.promise,
    async commit () {
      finish.resolve()
      await outcome
    },
    async rollback () {
      finish.reject(rollbackRequested)
      await assert.rejects(outcome, error => {
        assert.equal(error.cause, rollbackRequested)
        assert.equal(error.transactionOutcome, 'rolledBack')
        return true
      })
    }
  }
}

export function abortTransactionBeforeCommit (transaction) {
  const commit = transaction.commit
  const rollback = transaction.rollback
  const state = { transaction, commits: 0, rollbacks: 0 }
  transaction.commit = async (...args) => {
    state.commits++
    await assert.rejects(transaction.raw('BROKEN TRANSACTION STATEMENT;'), error => error.code === '42601')
    const result = await commit.apply(transaction, args)
    state.command = result?.response?.command
    await transaction.executionPromise
    state.resolved = true
    return result
  }
  transaction.rollback = async (...args) => {
    state.rollbacks++
    return rollback.apply(transaction, args)
  }
  state.close = async () => {
    transaction.commit = commit
    transaction.rollback = rollback
    if (!transaction.isCompleted()) await rollback.call(transaction)
  }
  return state
}

export function interceptTransactionCompletion (transaction, db, { phase, afterExecution = false }) {
  const originalQuery = transaction.client.query
  const originalMethod = transaction[phase]
  const state = { transaction, calls: 0, methodResolved: false, executed: false }
  transaction.executionPromise.catch(error => { state.executionError = error })

  transaction.client.query = async function (connection, statement) {
    const sql = typeof statement === 'string' ? statement : statement.sql
    if (!new RegExp(`^${phase}\\b`, 'i').test(sql)) return originalQuery.call(this, connection, statement)
    state.connection = connection
    state.calls++
    try {
      if (!afterExecution) return await originalQuery.call(this, connection, 'BROKEN TRANSACTION COMPLETION;')
      await originalQuery.call(this, connection, statement)
      state.executed = true
      throw new Error(`Lost ${phase} acknowledgement after execution`)
    } catch (error) {
      state.error = error
      throw error
    }
  }
  transaction[phase] = async (...args) => {
    const result = await originalMethod.apply(transaction, args)
    state.methodResolved = true
    return result
  }
  state.close = async () => {
    transaction.client.query = originalQuery
    transaction[phase] = originalMethod
    // A rejected control statement can leave the physical connection in a transaction.
    if (state.connection && !state.connection.__knex__disposed && state.connection.inTransaction !== false && !state.executed) await db.client.query(state.connection, 'ROLLBACK')
    else if (!transaction.isCompleted()) await transaction.rollback()
  }
  return state
}
