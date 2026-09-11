import { snapshotResourceConfiguration } from '../lib/querying-writing/schema-helpers.js'
import { rejectRemovedOptions, resolveFormat, resolveReturning } from '../lib/querying-writing/response-options.js'

export default async function turnScopeInitIntoVars ({ context, scopes, vars: apiVars }) {
  // Refer to the scope's vars
  const scope = scopes[context.scopeName]
  const scopeOptions = scope?.scopeOptions || context.scopeOptions || {}
  const vars = scope?.vars || apiVars

  // The scope-specific ones
  vars.sortableFields = snapshotResourceConfiguration(scopeOptions.sortableFields || [])
  vars.defaultSort = snapshotResourceConfiguration(scopeOptions.defaultSort || null)

  // The general ones that are also set at api level, but overrideable
  if (typeof scopeOptions.queryDefaultLimit !== 'undefined') vars.queryDefaultLimit = scopeOptions.queryDefaultLimit
  if (typeof scopeOptions.queryMaxLimit !== 'undefined') vars.queryMaxLimit = scopeOptions.queryMaxLimit
  if (typeof scopeOptions.includeDepthLimit !== 'undefined') vars.includeDepthLimit = scopeOptions.includeDepthLimit
  if (typeof scopeOptions.enablePaginationCounts !== 'undefined') vars.enablePaginationCounts = scopeOptions.enablePaginationCounts

  rejectRemovedOptions(scopeOptions)
  if (scopeOptions.format !== undefined) vars.format = resolveFormat(scopeOptions.format)
  if (scopeOptions.returning !== undefined) vars.returning = resolveReturning(scopeOptions.returning)

  // Set idProperty as scope var
  if (typeof scopeOptions.idProperty !== 'undefined') vars.idProperty = scopeOptions.idProperty
  if (typeof scopeOptions.normalizeId === 'function') vars.normalizeId = scopeOptions.normalizeId

  // Add validation for query limits
  if (vars.queryDefaultLimit && vars.queryMaxLimit) {
    if (vars.queryDefaultLimit > vars.queryMaxLimit) {
      throw new Error(
        `Invalid scope '${context.scopeName}' configuration: ` +
        `queryDefaultLimit (${vars.queryDefaultLimit}) cannot exceed queryMaxLimit (${vars.queryMaxLimit})`
      )
    }
  }
}
