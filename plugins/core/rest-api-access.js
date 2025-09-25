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

    const evaluateOwnership = ({ record, field, schemaInfo, userId }) => {
      if (!record) return 'unknown'

      debugger
      const idProperty = schemaInfo?.idProperty || 'id'
      const schemaStructure = schemaInfo?.schemaStructure || {}
      const schemaRelationships = schemaInfo?.schemaRelationships || {}

      const matchesUser = (value) => value !== undefined && value !== null && String(value) === userId

      if (field === idProperty) {
        if (record.id === undefined || record.id === null) {
          return 'unknown'
        }
        return matchesUser(record.id) ? 'match' : 'mismatch'
      }

      const fieldSchema = schemaStructure[field]

      if (record.type && record.attributes && fieldSchema && !fieldSchema.belongsTo) {
        const attributeValue = record.attributes[field]
        if (attributeValue !== undefined && attributeValue !== null) {
          return matchesUser(attributeValue) ? 'match' : 'mismatch'
        }
      }

      let relationshipName
      if (fieldSchema?.belongsTo) {
        relationshipName = fieldSchema.as || field
      } else if (schemaRelationships[field]) {
        relationshipName = field
      }

      if (!relationshipName) {
        return 'unknown'
      }

      const relationship = record.relationships?.[relationshipName]
      const relData = relationship?.data
      if (!relData) {
        return 'unknown'
      }

      if (Array.isArray(relData)) {
        return relData.some((item) => matchesUser(item?.id)) ? 'match' : 'mismatch'
      }

      if (relData?.id === undefined || relData?.id === null) {
        return 'unknown'
      }

      return matchesUser(relData.id) ? 'match' : 'mismatch'
    }

    const resolveStorageAdapter = (scopeName, hookContext = {}) => {
      if (!scopeName) return null

      if (hookContext.storageAdapter) return hookContext.storageAdapter
      if (hookContext.knexQuery?.storageAdapter) return hookContext.knexQuery.storageAdapter

      if (helpers.getStorageAdapter) {
        return helpers.getStorageAdapter(scopeName)
      }
      return null
    }

    const translateColumnReference = ({ field, tableName, scopeName, hookContext }) => {
      const storageAdapter = resolveStorageAdapter(scopeName, hookContext)
      const translated = storageAdapter?.translateColumn?.(field) ?? field
      if (tableName) {
        return `${tableName}.${translated}`
      }
      return translated
    }

    const translateFilterValue = ({ field, value, scopeName, hookContext }) => {
      const storageAdapter = resolveStorageAdapter(scopeName, hookContext)
      if (!storageAdapter?.translateFilterValue) return value
      return storageAdapter.translateFilterValue(field, value)
    }

    function registerBuiltinCheckers() {
      state.authCheckers.set('public', () => true)

      state.authCheckers.set('authenticated', (context) => {
        if (context.auth?.system === true) return true
        return !!(context.auth?.userId || context.auth?.providerId)
      })

      state.authCheckers.set('owns', (context, { existingRecord, scopeVars }) => {
        if (context.auth?.system === true) return true
        if (!context.auth?.userId) return false
        if (context.method === 'post') return true

        // Minimal record is always prepared upstream (dataGetMinimal for reads, request payload snapshot for POST).
        const record = existingRecord
        if (!record) return true

        const userId = String(context.auth.userId)
        const field = scopeVars?.ownershipField || ownershipField()
        const schemaInfo = scopeVars?.schemaInfo || {}

        const ownershipStatus = evaluateOwnership({
          record,
          field,
          schemaInfo,
          userId
        })

        return ownershipStatus === 'match'
      })
    }

    registerBuiltinCheckers()

    addHook('scope:added', 'rest-auth-process-rules', {}, ({ context, scopes }) => {
      const { scopeName } = context
      const scope = scopes[scopeName]

      const auth = context.scopeOptions?.auth
      if (!auth) return

      debugger
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
      const relationshipName = fields[field]?.as || fields[field]?.belongsTo || field

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
        type: 'number',
        belongsTo: config.ownership.userResource,
        ...(relationshipName ? { as: relationshipName } : {}),
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

      const relationshipName = fieldSchema.as || fieldSchema.belongsTo || field

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

      const storageAdapter = resolveStorageAdapter(scopeName, context)
      if (storageAdapter && !context.storageAdapter) {
        context.storageAdapter = storageAdapter
      }

      const columnRef = translateColumnReference({ field, tableName, scopeName, hookContext: context })
      const ownerValue = translateFilterValue({ field, value: context.auth.userId, scopeName, hookContext: context })

      if (ownerValue === null) {
        query.whereNull(columnRef)
      } else {
        query.where(columnRef, ownerValue)
      }
    })

    addHook('checkPermissions', 'rest-auth-enforce', { sequence: -100 }, async ({ context, scope, scopeName }) => {
      const operation = context.method
      debugger
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
        // if (rule === 'owns') debugger
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
      const schemaInfo = scope?.vars?.schemaInfo || {}
      const hasField = !!schemaInfo?.schemaStructure?.[field]
      const shouldCheck = scopeOptions?.ownership === true || (scopeOptions?.ownership === undefined && hasField)
      if (!shouldCheck) return

      const record = context.originalContext?.minimalRecord
      if (!record) return

      const idProperty = schemaInfo.idProperty || 'id'
      const userId = String(auth.userId)

      // Ownership by primary key (e.g., users modifying themselves)
      if (field === idProperty) {
        if (record.id !== undefined && record.id !== null && String(record.id) !== userId) {
          throw new RestApiResourceError('Resource not found', { subtype: 'not_found' })
        }
        return
      }

      const ownershipStatus = evaluateOwnership({
        record,
        field,
        schemaInfo,
        userId
      })

      if (ownershipStatus === 'mismatch') {
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
