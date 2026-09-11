import { RestApiValidationError } from '../../lib/rest-api-errors.js'
import { beginWriteTransaction, commitTransaction, onTransactionFinished, rollbackAfterError, withWriteOutcome } from '../../lib/error-context.js'
import { rejectRemovedOptions, resolveFormat, resolveReturning } from './lib/querying-writing/response-options.js'

function validateAtomic (atomic, field = 'atomic') {
  if (typeof atomic !== 'boolean') {
    throw new RestApiValidationError(`${field} must be a boolean`, { fields: [field] })
  }
}

function validateTransactionMode (atomic, transaction) {
  if (!atomic && transaction) {
    throw new RestApiValidationError('A caller transaction requires atomic bulk operations', { fields: ['transaction'] })
  }
}

function resolveBulkVersions (params, records, schemaInfo) {
  if (params.expectedVersion !== undefined) {
    throw new RestApiValidationError('Bulk writes require expectedVersions aligned with the batch', { fields: ['expectedVersion'] })
  }
  const versions = params.expectedVersions
  if (versions === undefined) return undefined
  if (!records || !schemaInfo?.versionField || !Array.isArray(versions) || versions.length !== records.length ||
    Array.from(versions).some(token => typeof token !== 'string' || !token.length || token.length > 128)) {
    throw new RestApiValidationError('expectedVersions requires a versioned update/delete batch with one non-empty token of at most 128 characters per item', { fields: ['expectedVersions'] })
  }
  return versions.slice()
}

function retainChildCleanup (context, recordContext, bulkIndex) {
  let copiedErrors = 0
  let copiedUploads = []
  const collect = () => {
    const errors = recordContext.cleanupErrors || []
    if (errors.length > copiedErrors) {
      const entries = context.cleanupErrors ||= []
      for (const entry of errors.slice(copiedErrors)) entries.push({ ...entry, bulkIndex })
      copiedErrors = errors.length
    }
    if (copiedUploads.length) context.fileHandlingUploads = context.fileHandlingUploads.filter(entry => !copiedUploads.includes(entry))
    copiedUploads = (recordContext.fileHandlingUploads || []).map(entry => ({ ...entry, bulkIndex }))
    if (copiedUploads.length) (context.fileHandlingUploads ||= []).push(...copiedUploads)
  }
  collect()
  onTransactionFinished(recordContext.transaction, collect)
}

export const BulkOperationsPlugin = {
  name: 'bulk-operations',
  dependencies: ['rest-api'],

  async install ({ api, log, addHook, addResourceMethod, helpers, pluginOptions }) {
    const bulkOptions = pluginOptions || {}
    const {
      maxBulkOperations = 100,
      defaultAtomic = true
    } = bulkOptions
    const unknown = Object.keys(bulkOptions).filter(name => !['maxBulkOperations', 'defaultAtomic'].includes(name))
    if (unknown.length) {
      throw new RestApiValidationError(`Unsupported bulk options: ${unknown.join(', ')}. Pass maxBulkOperations and defaultAtomic directly.`, { fields: unknown })
    }
    if (!Number.isSafeInteger(maxBulkOperations) || maxBulkOperations < 1) {
      throw new RestApiValidationError('maxBulkOperations must be a positive safe integer', { fields: ['maxBulkOperations'] })
    }
    validateAtomic(defaultAtomic, 'defaultAtomic')

    log.info('Installing Bulk Operations plugin', { maxBulkOperations, defaultAtomic })

    // Add bulk methods to each scope
    addResourceMethod('bulkPost', withWriteOutcome(async ({ scope, vars, params, context }) => {
      const { inputRecords, atomic = defaultAtomic } = params
      rejectRemovedOptions(params)
      validateAtomic(atomic)
      validateTransactionMode(atomic, params.transaction)
      resolveBulkVersions(params)
      const format = resolveFormat(params.format, vars.format)
      const returning = resolveReturning(params.returning, vars.returning)

      // Validate bulk size
      if (!Array.isArray(inputRecords) || inputRecords.length === 0) {
        throw new RestApiValidationError('Bulk operations require an array of records', {
          fields: ['data'],
          violations: [{ field: 'data', rule: 'required_array', message: 'Must be a non-empty array' }]
        })
      }

      if (inputRecords.length > maxBulkOperations) {
        throw new RestApiValidationError(`Bulk operations limited to ${maxBulkOperations} records`, {
          fields: ['data'],
          violations: [{
            field: 'data',
            rule: 'max_items',
            message: `Cannot process more than ${maxBulkOperations} records at once`
          }]
        })
      }

      const results = []
      const errors = []
      let transaction = null
      const ownsTransaction = !params.transaction

      try {
        // Start transaction if atomic mode
        if (atomic) {
          transaction = await beginWriteTransaction(context, params.transaction, helpers.newTransaction)
        }

        for (const [recordIndex, inputRecord] of inputRecords.entries()) {
          const recordContext = {
            ...context,
            cleanupErrors: undefined,
            fileHandlingUploads: undefined,
            bulkOperation: true,
            bulkIndex: recordIndex
          }
          try {
            // Use the existing post method with transaction
            const result = await scope.post({
              inputRecord: format === 'jsonapi' && inputRecord && !Object.hasOwn(inputRecord, 'data') ? { data: inputRecord } : inputRecord,
              transaction,
              format,
              returning
            }, recordContext)

            results.push({
              index: recordIndex,
              status: 'success',
              data: format === 'jsonapi' ? result?.data : result
            })
          } catch (error) {
            if (atomic) {
              throw error
            } else {
              // In non-atomic mode, collect errors
              errors.push({
                index: recordIndex,
                status: 'error',
                error: {
                  code: error.code || 'UNKNOWN_ERROR',
                  message: error.message,
                  details: error.details,
                  transactionOutcome: error.transactionOutcome
                }
              })
            }
          } finally { retainChildCleanup(context, recordContext, recordIndex) }
        }

        // Commit transaction if atomic
        if (transaction && ownsTransaction) {
          await commitTransaction(transaction, context)
        }

        // Build response
        return {
          ...(returning === 'none' ? {} : { data: results.map(r => r.data) }),
          errors: errors.length > 0 ? errors : undefined,
          meta: {
            total: inputRecords.length,
            succeeded: results.length,
            failed: errors.length,
            atomic
          }
        }
      } catch (error) {
        await rollbackAfterError(error, context, ownsTransaction ? transaction : null)
        throw error
      }
    }))

    addResourceMethod('bulkPatch', withWriteOutcome(async ({ scope, vars, params, context }) => {
      const { operations, atomic = defaultAtomic } = params
      rejectRemovedOptions(params)
      validateAtomic(atomic)
      validateTransactionMode(atomic, params.transaction)
      const format = resolveFormat(params.format, vars.format)
      const returning = resolveReturning(params.returning, vars.returning)

      // Validate operations
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new RestApiValidationError('Bulk patch requires an array of operations', {
          fields: ['operations'],
          violations: [{ field: 'operations', rule: 'required_array', message: 'Must be a non-empty array' }]
        })
      }

      if (operations.length > maxBulkOperations) {
        throw new RestApiValidationError(`Bulk operations limited to ${maxBulkOperations} operations`, {
          fields: ['operations'],
          violations: [{
            field: 'operations',
            rule: 'max_items',
            message: `Cannot process more than ${maxBulkOperations} operations at once`
          }]
        })
      }

      const expectedVersions = resolveBulkVersions(params, operations, vars.schemaInfo)
      const results = []
      const errors = []
      let transaction = null
      const ownsTransaction = !params.transaction

      try {
        if (atomic) {
          transaction = await beginWriteTransaction(context, params.transaction, helpers.newTransaction)
        }

        for (let i = 0; i < operations.length; i++) {
          const operation = operations[i]

          // Validate operation structure
          if (!operation || operation.id === undefined || operation.id === null || !operation.data) {
            errors.push({
              index: i,
              status: 'error',
              error: {
                code: 'INVALID_OPERATION',
                message: 'Operation must include id and data',
                details: { operation },
                transactionOutcome: 'none'
              }
            })
            if (atomic) {
              throw new RestApiValidationError('Invalid operation structure', {
                fields: [`operations[${i}]`],
                violations: [{
                  field: `operations[${i}]`,
                  rule: 'required_fields',
                  message: 'Operation must include id and data'
                }]
              })
            }
            continue
          }

          const recordContext = {
            ...context,
            cleanupErrors: undefined,
            fileHandlingUploads: undefined,
            bulkOperation: true,
            bulkIndex: i
          }
          try {
            const result = await scope.patch({
              id: operation.id,
              expectedVersion: expectedVersions?.[i],
              inputRecord: format === 'jsonapi' ? { data: operation.data } : operation.data,
              transaction,
              format,
              returning
            }, recordContext)

            results.push({
              index: i,
              id: operation.id,
              status: 'success',
              data: format === 'jsonapi' ? result?.data : result
            })
          } catch (error) {
            if (atomic) {
              throw error
            } else {
              errors.push({
                index: i,
                id: operation.id,
                status: 'error',
                error: {
                  code: error.code || 'UNKNOWN_ERROR',
                  message: error.message,
                  details: error.details,
                  transactionOutcome: error.transactionOutcome
                }
              })
            }
          } finally { retainChildCleanup(context, recordContext, i) }
        }

        if (transaction && ownsTransaction) {
          await commitTransaction(transaction, context)
        }

        return {
          ...(returning === 'none' ? {} : { data: results.map(r => r.data) }),
          errors: errors.length > 0 ? errors : undefined,
          meta: {
            total: operations.length,
            succeeded: results.length,
            failed: errors.length,
            atomic
          }
        }
      } catch (error) {
        await rollbackAfterError(error, context, ownsTransaction ? transaction : null)
        throw error
      }
    }))

    addResourceMethod('bulkDelete', withWriteOutcome(async ({ scope, vars, params, context }) => {
      const { ids, atomic = defaultAtomic } = params
      rejectRemovedOptions(params)
      validateAtomic(atomic)
      validateTransactionMode(atomic, params.transaction)
      if (params.format !== undefined) resolveFormat(params.format)

      // Validate IDs
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new RestApiValidationError('Bulk delete requires an array of IDs', {
          fields: ['ids'],
          violations: [{ field: 'ids', rule: 'required_array', message: 'Must be a non-empty array' }]
        })
      }

      if (ids.length > maxBulkOperations) {
        throw new RestApiValidationError(`Bulk operations limited to ${maxBulkOperations} IDs`, {
          fields: ['ids'],
          violations: [{
            field: 'ids',
            rule: 'max_items',
            message: `Cannot process more than ${maxBulkOperations} IDs at once`
          }]
        })
      }

      const expectedVersions = resolveBulkVersions(params, ids, vars.schemaInfo)
      const results = []
      const errors = []
      let transaction = null
      const ownsTransaction = !params.transaction

      try {
        if (atomic) {
          transaction = await beginWriteTransaction(context, params.transaction, helpers.newTransaction)
        }

        // Process deletes
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i]

          const recordContext = {
            ...context,
            cleanupErrors: undefined,
            fileHandlingUploads: undefined,
            bulkOperation: true,
            bulkIndex: i
          }
          try {
            await scope.delete({
              id,
              expectedVersion: expectedVersions?.[i],
              transaction
            }, recordContext)

            results.push({
              index: i,
              id,
              status: 'success'
            })
          } catch (error) {
            if (atomic) {
              throw error
            } else {
              errors.push({
                index: i,
                id,
                status: 'error',
                error: {
                  code: error.code || 'UNKNOWN_ERROR',
                  message: error.message,
                  details: error.details,
                  transactionOutcome: error.transactionOutcome
                }
              })
            }
          } finally { retainChildCleanup(context, recordContext, i) }
        }

        if (transaction && ownsTransaction) {
          await commitTransaction(transaction, context)
        }

        return {
          meta: {
            total: ids.length,
            succeeded: results.length,
            failed: errors.length,
            deleted: results.filter(r => r.status === 'success').map(r => r.id),
            atomic
          },
          errors: errors.length > 0 ? errors : undefined
        }
      } catch (error) {
        await rollbackAfterError(error, context, ownsTransaction ? transaction : null)
        throw error
      }
    }))

    // Hook into scope creation to add bulk routes
    addHook('resource:added', 'bulkOperationsRoutes', { beforeFunction: 'registerScopeRoutes' }, async ({ context: { scopeName } }) => {
      const urlPrefix = api.vars.transport?.mountPath || ''
      const scopePath = `${urlPrefix}/${scopeName}`

      // Create route handlers
      const createBulkRouteHandler = (method) => {
        return async ({ context, body, queryString }) => {
          const query = Object.fromEntries(new URLSearchParams(queryString))
          rejectRemovedOptions(query)
          if (query.atomic !== undefined && query.atomic !== 'true' && query.atomic !== 'false') {
            throw new RestApiValidationError('atomic must be true or false', { fields: ['atomic'] })
          }
          // Parse query params for atomic mode override
          const atomic = query?.atomic !== undefined
            ? query.atomic === 'true'
            : defaultAtomic

          let params
          if (method === 'bulkPost') {
            // For bulk create, expect array in data field (JSON:API style)
            params = {
              inputRecords: body?.data || body,
              atomic
            }
          } else if (method === 'bulkPatch') {
            // For bulk update, expect operations array
            params = {
              operations: body?.operations || body,
              atomic
            }
          } else if (method === 'bulkDelete') {
            // For bulk delete, expect IDs array
            params = {
              ids: body?.data || body?.ids || body,
              atomic
            }
          }

          const result = await api.resources[scopeName][method]({
            ...params,
            expectedVersion: body?.expectedVersion,
            expectedVersions: body?.expectedVersions,
            format: 'jsonapi',
            returning: 'full'
          }, context)
          return { statusCode: method === 'bulkPost' ? 201 : 200, body: result }
        }
      }

      // Register bulk routes
      await api.addRoute({
        method: 'POST',
        path: `${scopePath}/bulk`,
        handler: createBulkRouteHandler('bulkPost')
      })

      await api.addRoute({
        method: 'PATCH',
        path: `${scopePath}/bulk`,
        handler: createBulkRouteHandler('bulkPatch')
      })

      await api.addRoute({
        method: 'DELETE',
        path: `${scopePath}/bulk`,
        handler: createBulkRouteHandler('bulkDelete')
      })

      log.debug(`Added bulk operation routes for scope: ${scopeName}`)
    })

    log.info('Bulk Operations plugin installed successfully')
  }
}
