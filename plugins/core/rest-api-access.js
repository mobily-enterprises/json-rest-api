import { RestApiResourceError } from '../../lib/rest-api-errors.js'

export const AccessPlugin = {
  name: 'rest-api-access',
  dependencies: ['rest-api'],

  async install({ addHook, helpers, log, pluginOptions = {}, scopes }) {
    const ownershipOptions = pluginOptions.ownership || pluginOptions.autoOwnership || {}

    const config = {
      ownership: {
        enabled: ownershipOptions.enabled !== false,
        field: ownershipOptions.field || 'user_id',
        userResource: ownershipOptions.userResource || 'users',
        excludeResources: ownershipOptions.excludeResources || [],
        filterByOwner: ownershipOptions.filterByOwner !== false,
        requireOwnership: ownershipOptions.requireOwnership || false
      }
    }

    const state = {
      authCheckers: new Map()
    }

    const ownershipField = () => config.ownership.field

    function registerBuiltinCheckers() {
      state.authCheckers.set('public', () => true)

      state.authCheckers.set('authenticated', (context) => {
        if (context.auth?.system === true) return true
        return !!(context.auth?.userId || context.auth?.providerId)
      })

      state.authCheckers.set('owns', (context, { existingRecord, scopeVars }) => {
        if (context.auth?.system === true) return true
        if (!context.auth?.userId) return false

        const record = existingRecord || context.attributes
        if (!record) return true

        const field = scopeVars?.ownershipField || ownershipField()

        if (record.type && record.attributes) {
          const value = field === 'id' ? record.id : record.attributes[field]
          if (value !== undefined && value !== null) {
            return String(value) === String(context.auth.userId)
          }

          if (record.relationships) {
            const relationshipName = field.replace(/_id$/, '')
            const relationship = record.relationships[relationshipName]
            if (relationship?.data?.id) {
              return String(relationship.data.id) === String(context.auth.userId)
            }
          }
          return false
        }

        const value = record[field]
        if (value === undefined || value === null) return false
        return String(value) === String(context.auth.userId)
      })
    }

    registerBuiltinCheckers()

    addHook('scope:added', 'rest-auth-process-rules', {}, ({ context, scopes }) => {
      const { scopeName } = context
      const scope = scopes[scopeName]

      const auth = context.scopeOptions?.auth
      if (!auth) return

      scope.vars.authRules = auth
      scope.vars.ownershipField = context.scopeOptions?.ownershipField

      log?.info?.(`Auth rules registered for ${scopeName}`, {
        query: auth.query,
        get: auth.get,
        post: auth.post,
        patch: auth.patch,
        delete: auth.delete
      })
    })

    addHook('schema:enrich', 'rest-auth-auto-ownership-field', {}, ({ context, scopeOptions }) => {
      if (!config.ownership.enabled) return
      const { fields, scopeName } = context
      if (config.ownership.excludeResources.includes(scopeName)) return
      if (scopeOptions?.ownership === false) return

      const field = ownershipField()
      const relationshipName = (fields[field]?.as) || field.replace(/_id$/, '') || 'owner'

      if (fields[field]) {
        if (!fields[field].belongsTo) {
          fields[field].belongsTo = config.ownership.userResource
        }
        if (!fields[field].as) {
          fields[field].as = relationshipName
        }
        return
      }

      fields[field] = {
        type: 'integer',
        belongsTo: config.ownership.userResource,
        as: relationshipName,
        nullable: true,
        indexed: true,
        description: 'Automatically managed ownership field'
      }
    })

    function setOwnerOnInput({ context, scopeName, scopes, scopeOptions }) {
      if (!config.ownership.enabled) return
      if (config.ownership.excludeResources.includes(scopeName)) return
      if (!context.auth?.userId) {
        if (config.ownership.requireOwnership) {
          throw new Error(`Cannot operate on ${scopeName} without authentication`)
        }
        return
      }

      if (scopeOptions?.ownership === false) return

      const field = ownershipField()
      const scope = scopes[scopeName]
      const schemaInfo = scope?.vars?.schemaInfo
      const fieldSchema = schemaInfo?.schemaStructure?.[field]
      const hasField = !!fieldSchema
      const shouldSet = scopeOptions?.ownership === true || (scopeOptions?.ownership === undefined && hasField)
      if (!shouldSet || !hasField) return

      if (context.auth.roles?.includes?.('admin')) {
        return
      }

      if (!context.inputRecord?.data) return

      const relationships = context.inputRecord.data.relationships = context.inputRecord.data.relationships || {}
      const attributes = context.inputRecord.data.attributes = context.inputRecord.data.attributes || {}

      const relationshipName = fieldSchema.as || field.replace(/_id$/, '')

      if (fieldSchema.belongsTo) {
        relationships[relationshipName] = {
          data: {
            type: fieldSchema.belongsTo || config.ownership.userResource || 'users',
            id: String(context.auth.userId)
          }
        }
      } else {
        attributes[field] = context.auth.userId
      }
    }

    addHook('beforeProcessingPost', 'rest-auth-auto-set-owner', {}, ({ context, scopeName, scopes, scopeOptions }) => {
      setOwnerOnInput({ context, scopeName, scopes, scopeOptions })
    })
    addHook('beforeProcessingPatch', 'rest-auth-auto-set-owner', {}, ({ context, scopeName, scopes, scopeOptions }) => {
      setOwnerOnInput({ context, scopeName, scopes, scopeOptions })
    })
    addHook('beforeProcessingPut', 'rest-auth-auto-set-owner', {}, ({ context, scopeName, scopes, scopeOptions }) => {
      setOwnerOnInput({ context, scopeName, scopes, scopeOptions })
    })

    addHook('knexQueryFiltering', 'rest-auth-filter-by-owner', { sequence: -40 }, ({ context, scopes, scopeOptions }) => {
      if (!config.ownership.enabled || !config.ownership.filterByOwner) return

      const { query, tableName, scopeName } = context.knexQuery || {}

      if (!query || !tableName) {
        throw new Error('AccessPlugin: knexQuery must provide query and tableName for ownership filtering')
      }

      if (config.ownership.excludeResources.includes(scopeName)) return
      if (!context.auth?.userId) {
        if (config.ownership.requireOwnership) {
          throw new Error(`Cannot query ${scopeName} without authentication`)
        }
        return
      }

      if (context.auth.roles?.includes?.('admin')) return
      if (scopeOptions?.ownership === false) return

      const field = ownershipField()
      const scope = scopes[scopeName]
      const schemaInfo = scope?.vars?.schemaInfo
      const hasField = !!schemaInfo?.schemaStructure?.[field]
      const shouldFilter = scopeOptions?.ownership === true || (scopeOptions?.ownership === undefined && hasField)
      if (!shouldFilter || !hasField) return

      query.where(function () {
        this.where(`${tableName}.${field}`, context.auth.userId)
      })
    })

    addHook('checkPermissions', 'rest-auth-enforce', { sequence: -100 }, async ({ context, scope, scopeName }) => {
      const operation = context.method
      const scopeVars = scope?.vars
      const authRules = scopeVars?.authRules
      const minimalRecord = context.originalContext?.minimalRecord

      if (!authRules) return
      const rules = authRules[operation]
      if (!rules) {
        throw new Error(`Operation '${operation}' not allowed on resource '${scopeName}'`)
      }

      let passed = false
      const failures = []

      for (const rule of rules) {
        try {
          const [checkerName, ...paramParts] = rule.split(':')
          const checker = state.authCheckers.get(checkerName)
          const param = paramParts.join(':') || undefined
          if (!checker) {
            throw new Error(`Unknown auth rule: ${rule}`)
          }

          const result = await checker(context.originalContext || context, {
            existingRecord: minimalRecord,
            scopeVars,
            param
          })

          if (result) {
            passed = true
            break
          }

          failures.push(rule)
        } catch (error) {
          failures.push(`${rule} (error: ${error.message})`)
        }
      }

      if (!passed) {
        const err = new Error(
          `Access denied. Required one of: ${rules.join(', ')}. Failed checks: ${failures.join(', ')}`
        )
        err.statusCode = 403
        throw err
      }

      context.authGranted = true
    })

    addHook('checkPermissions', 'rest-auth-check-get-ownership', { sequence: -80 }, ({ context, scope, scopeName, scopeOptions }) => {
      if (!config.ownership.enabled || !config.ownership.filterByOwner) return
      if (config.ownership.excludeResources.includes(scopeName)) return

      if (!['get', 'put', 'patch', 'delete'].includes(context.method)) return

      const auth = context.originalContext?.auth || context.auth
      if (!auth?.userId) return
      if (auth.roles?.includes?.('admin')) return
      if (scopeOptions?.ownership === false) return

      const field = ownershipField()
      const schemaInfo = scope?.vars?.schemaInfo
      const hasField = !!schemaInfo?.schemaStructure?.[field]
      const shouldCheck = scopeOptions?.ownership === true || (scopeOptions?.ownership === undefined && hasField)
      if (!shouldCheck) return

      const record = context.originalContext?.minimalRecord
      if (!record) return

      const ownerId = record.attributes?.[field]
      if (ownerId && String(ownerId) !== String(auth.userId)) {
        throw new RestApiResourceError('Resource not found', { subtype: 'not_found' })
      }
    })

    if (!helpers.auth) {
      helpers.auth = {}
    }

    helpers.auth.requireAuth = function requireAuth(context) {
      if (!context.auth?.userId) {
        const error = new Error('Authentication required')
        error.statusCode = 401
        throw error
      }
      return context.auth
    }

    helpers.auth.requireOwnership = function requireOwnership(context, resourceOrUserId) {
      const auth = helpers.auth.requireAuth(context)
      const field = ownershipField()

      let ownerId

      if (typeof resourceOrUserId === 'object' && resourceOrUserId !== null) {
        ownerId = resourceOrUserId[field]
        if (!ownerId) {
          throw new Error(`Resource does not have ownership field '${field}'`)
        }
      } else if (resourceOrUserId !== undefined) {
        ownerId = resourceOrUserId
      } else if (context.existingRecord) {
        ownerId = context.existingRecord[field]
        if (!ownerId) {
          throw new Error(`Resource does not have ownership field '${field}'`)
        }
      } else {
        throw new Error('No resource or user ID provided for ownership check')
      }

      if (String(auth.userId) !== String(ownerId)) {
        const error = new Error('Access denied: you do not own this resource')
        error.statusCode = 403
        throw error
      }

      return auth
    }

    helpers.auth.registerChecker = function registerChecker(name, checkerFn) {
      state.authCheckers.set(name, checkerFn)
    }

    helpers.auth.checkPermission = async function checkPermission(context, rules, options = {}) {
      if (!rules || rules.length === 0) return true

      const { existingRecord, scopeVars } = options

      for (const rule of rules) {
        const [checkerName, ...paramParts] = rule.split(':')
        const checker = state.authCheckers.get(checkerName)
        if (!checker) continue

        const param = paramParts.join(':') || undefined
        if (await checker(context, { existingRecord, scopeVars, param })) {
          return true
        }
      }

      return false
    }

    helpers.auth.cleanup = function cleanup() {
      state.authCheckers.clear()
    }
  }
}

export default AccessPlugin
