import { createStorageAdapterUtilities } from './lib/querying/storage-adapter-utils.js'

const INLINE_POLICY_NAME = '<inline>'

function createRowPolicyError (message, code = 'REST_API_ROW_POLICY_CONTRACT') {
  const error = new Error(message)
  error.code = code
  return error
}

function compileRowPolicy ({ scopeName, scopeOptions = {}, policies }) {
  const definition = scopeOptions.rowPolicy

  if (definition === undefined || definition === null || definition === false) {
    return null
  }

  if (typeof definition === 'function') {
    return {
      name: INLINE_POLICY_NAME,
      source: 'inline',
      applyQuery: definition
    }
  }

  if (typeof definition === 'string') {
    const name = definition.trim()
    const applyQuery = policies[name]

    if (!name || !applyQuery) {
      throw createRowPolicyError(
        `Unknown row policy '${definition}' on resource '${scopeName}'.`
      )
    }

    return {
      name,
      source: 'registry',
      applyQuery
    }
  }

  throw createRowPolicyError(
    `Row policy for resource '${scopeName}' must be a registered policy name, a function, or false.`
  )
}

export const RowPolicyPlugin = {
  name: 'row-policy',
  dependencies: ['rest-api', 'rest-api-knex|rest-api-anyapi-knex'],

  install ({ api, addHook, vars, helpers, log, scopes, pluginOptions = {} }) {
    if (!api.knex?.instance) {
      throw new Error('RowPolicyPlugin requires a storage plugin with knex support (rest-api-knex or rest-api-anyapi-knex).')
    }

    const policies = { ...(pluginOptions.policies || {}) }
    for (const [name, policy] of Object.entries(policies)) {
      if (typeof policy !== 'function') {
        throw createRowPolicyError(`Row policy '${name}' must be a function.`)
      }
    }

    vars.rowPolicy = {
      policies: Object.keys(policies)
    }

    addHook('scope:added', 'compile-row-policy', {}, ({ context }) => {
      const { scopeName, scopeOptions = {} } = context
      const scope = scopes[scopeName]

      scope.vars.rowPolicy = compileRowPolicy({
        scopeName,
        scopeOptions,
        policies
      })
    })

    addHook('knexQueryFiltering', 'apply-row-policy', {}, async (hookParams) => {
      const { context } = hookParams
      const {
        query,
        scopeName,
        tableName,
        db,
        queryPurpose = 'unspecified',
        isAnyApi = false,
        storageAdapter: hookStorageAdapter
      } = context.knexQuery || {}

      if (!query || !scopeName) return

      const compiledPolicy = scopes[scopeName]?.vars?.rowPolicy
      if (!compiledPolicy) return

      const adapterUtils = createStorageAdapterUtilities(hookParams, {
        getStorageAdapter: helpers.getStorageAdapter
      })
      const storageAdapter = hookStorageAdapter || adapterUtils.fetchStorageAdapter(scopeName)

      const column = (field, options = {}) => {
        const targetScopeName = options.scopeName || scopeName
        const alias = Object.prototype.hasOwnProperty.call(options, 'alias')
          ? options.alias
          : adapterUtils.defaultAliasForScope(targetScopeName)
        return adapterUtils.translateColumn(targetScopeName, field, alias)
      }

      const value = (field, rawValue, options = {}) => {
        const targetScopeName = options.scopeName || scopeName
        return adapterUtils.translateFilterValue(targetScopeName, field, rawValue)
      }

      const result = await compiledPolicy.applyQuery({
        query,
        context,
        scopeName,
        tableName,
        queryPurpose,
        db,
        isAnyApi,
        storageAdapter,
        column,
        value,
        api
      })

      if (result === false) {
        query.whereRaw('1 = 0')
      } else if (result !== true) {
        throw createRowPolicyError(
          `Row policy '${compiledPolicy.name}' on resource '${scopeName}' must return true after applying its predicate, or false to deny all rows.`
        )
      }
    })

    api.rowPolicies = {
      getConfig: () => ({
        policies: Object.keys(policies)
      }),

      getScopeConfig: (scopeName) => {
        const compiledPolicy = scopes[scopeName]?.vars?.rowPolicy
        if (!compiledPolicy) return null

        return {
          policy: compiledPolicy.name,
          source: compiledPolicy.source
        }
      }
    }

    log.info('Row policy plugin installed', {
      policies: Object.keys(policies)
    })
  }
}
