import { createCanonicalDataHelpers } from './lib/storage/canonical-data-helpers.js'
import { createCanonicalLinkStore } from './lib/anyapi/canonical-link-store.js'
import { createCanonicalRelationshipReader } from './lib/anyapi/canonical-relationship-reader.js'
import { createKnexTransaction } from '../../lib/knex-transaction.js'
import { createEnhancedLogger } from '../../lib/enhanced-logger.js'
import { ensureAnyApiSchema } from './lib/anyapi/schema-utils.js'
import { AnyapiRegistry } from './lib/anyapi/anyapi-registry.js'
import { composeResourceOptions, relatedResources } from './lib/anyapi/stored-definition.js'
import { RestApiResourceError, RestApiValidationError } from '../../lib/rest-api-errors.js'
import { compileSchemas } from './lib/querying-writing/compile-schemas.js'
import { snapshotResourceConfiguration } from './lib/querying-writing/schema-helpers.js'
import { assertFieldNameMap } from './lib/querying-writing/field-utils.js'
import { polymorphicFiltersHook, crossTableFiltersHook, basicFiltersHook } from './lib/querying/knex-query-helpers.js'
import { createStorageAdapterLookup } from './lib/storage/storage-adapter.js'
import { translateCanonicalAttributesForStorage } from './lib/storage/canonical-storage-mapping.js'
import { applyDatabaseReadOptions, normalizeStoredFieldValue } from './lib/querying-writing/database-value-normalizers.js'

const DEFAULT_TENANT = 'default'
const MIGRATION_BATCH_SIZE = 500
// Methods that read a published schema; schema checks wrap these.
const REQUEST_METHODS = ['query', 'aggregate', 'get', 'post', 'put', 'patch', 'delete', 'getRelated', 'getRelationship', 'postRelationship', 'patchRelationship', 'deleteRelationship']

const optionsSignature = options => JSON.stringify([
  Object.keys(options.schema || {}).sort(),
  Object.keys(options.searchSchema || {}).sort(),
  Object.entries(options.schema || {}).filter(([, definition]) => definition?.retired === true).map(([name]) => name).sort()
])

// A validation failure may come from a schema another server already changed.
// Writes that may have committed are never repeated.
const isStaleSchemaRejection = error => error?.type === 'rest_api_validation' && !['committed', 'unknown'].includes(error.transactionOutcome)

export const RestApiAnyapiKnexPlugin = {
  name: 'rest-api-anyapi-knex',
  dependencies: ['rest-api'],

  async install ({ helpers, pluginOptions, api, log, addHook, addResourceMethod, scopes }) {
    log = createEnhancedLogger(log)
    const options = pluginOptions || {}
    const knex = options.knex
    const tenantId = options.tenantId || DEFAULT_TENANT
    const { ensureSchema = true, ownsKnex = true, onSchemaChanged, schemaCheckInterval, slots, indexedSlots } = options

    if (!knex) {
      throw new Error('AnyapiKnexPlugin requires a knex instance')
    }
    if (options.registry !== undefined && (!(options.registry instanceof AnyapiRegistry) || options.registry.knex !== knex)) {
      throw new Error('AnyapiKnexPlugin registry must be an AnyapiRegistry for the same knex instance')
    }
    if (onSchemaChanged !== undefined && typeof onSchemaChanged !== 'function') {
      throw new Error('AnyapiKnexPlugin onSchemaChanged must be a function')
    }
    if (schemaCheckInterval !== undefined && !(Number.isFinite(schemaCheckInterval) && schemaCheckInterval >= 0)) {
      throw new Error('AnyapiKnexPlugin schemaCheckInterval must be a non-negative number of milliseconds')
    }

    const registry = options.registry || new AnyapiRegistry({ knex, log })
    if (ensureSchema) await registry.ensureSchema({ slots, indexedSlots })

    api.anyapi = api.anyapi || {}
    api.anyapi.registry = registry
    api.anyapi.tenantId = tenantId
    api.knex = {
      instance: knex,
      helpers: {},
      capabilities: await registry.getCapabilities(log),
    }

    const getScopeStorageAdapter = createStorageAdapterLookup({
      knex,
      getResource: scopeName => api.resources?.[scopeName] || scopes?.[scopeName]
    })

    api.knex.helpers.getStorageAdapter = getScopeStorageAdapter
    helpers.getStorageAdapter = getScopeStorageAdapter

    // Owned copies of what this server declared and added, callbacks included.
    const declarations = new Map()
    const runtimeDeclarations = new Map()
    const storageLoaded = new Set()
    const compiledSignatures = new Map()
    const lastChecked = new Map()
    const reloads = new Map()
    const checks = new Map()
    const loading = new Map()

    /** @type {import('../../lib/transaction-types.js').TransactionFactory} */
    helpers.newTransaction = context => createKnexTransaction(knex, context)

    addHook('release', 'anyapi-knex-release', {}, async ({ api }) => {
      if (ownsKnex && api.knex?.instance) {
        await api.knex.instance.destroy()
      }
    })

    const getDescriptor = (scopeName) => {
      const descriptor = api.resources?.[scopeName]?.vars?.schemaInfo?.descriptor
      if (!descriptor) {
        throw new Error(`Descriptor not found for resource '${scopeName}'`)
      }
      return descriptor
    }

    const linkStore = createCanonicalLinkStore({ api, getDescriptor, getScopeStorageAdapter })
    api.anyapi.links = linkStore.methods
    helpers.dataRelatedIdsQuery = linkStore.dataRelatedIdsQuery
    const { buildIncludes, attachReverseRelationships, attachManyToManyRelationships } = createCanonicalRelationshipReader({
      api, knex, getDescriptor, getScopeStorageAdapter, linkStore
    })

    const publishedVersion = scopeName => api.resources[scopeName]?.vars?.schemaInfo?.descriptor?.schemaVersion ?? 0

    const composeOptions = (scopeName, descriptor) => composeResourceOptions({
      declaration: declarations.get(scopeName),
      stored: descriptor.definition,
      local: runtimeDeclarations.get(scopeName),
      fromStorage: storageLoaded.has(scopeName)
    })

    const compileOptions = async (scopeName, scopeOptions) => {
      const compiled = { scopeOptions, vars: { idProperty: api.resources[scopeName].vars.idProperty } }
      await compileSchemas(compiled, { context: { scopeName }, runHooks: (name, context) => api.runHooks(name, context) })
      return compiled.vars.schemaInfo
    }

    // Publish a descriptor with the schema it implies. Recompile only when the
    // field set changed, so schema hooks do not rerun on every refresh.
    const publish = async (scopeName, descriptor, { compiled } = {}) => {
      const scope = api.resources[scopeName]
      if (publishedVersion(scopeName) > descriptor.schemaVersion) return
      const { options: scopeOptions, hidden, hiddenFilters } = composeOptions(scopeName, descriptor)
      if (hidden.length || hiddenFilters.length) {
        await log.warn(`AnyAPI resource '${scopeName}' hides stored fields whose callbacks this server does not declare`, {
          tenant: tenantId, scopeName, fields: hidden, filters: hiddenFilters
        })
      }
      // Fields never move on their own; migrateField copies one into an indexed slot.
      const unindexed = Object.entries(scopeOptions.schema || {})
        .filter(([name, definition]) => definition?.indexed === true && descriptor.fields[name]?.indexed === false)
        .map(([name]) => name)
      if (unindexed.length) {
        await log.warn(`AnyAPI resource '${scopeName}' declares indexed fields stored in unindexed slots`, {
          tenant: tenantId, scopeName, fields: unindexed
        })
      }
      const signature = optionsSignature(scopeOptions)
      let schemaInfo = scope.vars.schemaInfo
      if (compiled?.signature === signature) schemaInfo = compiled.schemaInfo
      else if (compiledSignatures.get(scopeName) !== signature) schemaInfo = await compileOptions(scopeName, scopeOptions)
      compiledSignatures.set(scopeName, signature)

      descriptor.idProperty = schemaInfo.idProperty
      scope.vars.schemaInfo = {
        ...schemaInfo,
        descriptor,
        canonicalFieldMap: descriptor.canonicalFieldMap,
      }
      getScopeStorageAdapter(scopeName)
      lastChecked.set(scopeName, Date.now())
    }

    // Reloads of one resource run in order, so an older read never wins.
    const reload = (scopeName) => {
      const run = (reloads.get(scopeName) || Promise.resolve()).catch(() => {}).then(async () => {
        registry.invalidateDescriptor(tenantId, scopeName)
        const descriptor = await registry.getDescriptor(tenantId, scopeName)
        if (!descriptor) {
          throw new RestApiResourceError(`Resource '${scopeName}' is not registered in AnyAPI storage`, {
            subtype: 'not_found', resourceType: 'scope', resourceId: scopeName
          })
        }
        await publish(scopeName, descriptor)
        return publishedVersion(scopeName)
      })
      reloads.set(scopeName, run)
      run.finally(() => { if (reloads.get(scopeName) === run) reloads.delete(scopeName) }).catch(() => {})
      return run
    }

    const notifySchemaChanged = async (scopeName, version) => {
      if (!onSchemaChanged) return
      try {
        await onSchemaChanged({ tenant: tenantId, resource: scopeName, version })
      } catch (error) {
        // The change is committed; other servers still catch up through schema checks.
        await log.logError('AnyAPI onSchemaChanged failed', error, { tenant: tenantId, scopeName, version })
      }
    }

    const ensureFresh = (scopeName, maxAge) => {
      if (maxAge > 0 && Date.now() - (lastChecked.get(scopeName) ?? 0) < maxAge) return false
      if (!checks.has(scopeName)) {
        const check = (async () => {
          lastChecked.set(scopeName, Date.now())
          const version = await registry.getSchemaVersion(tenantId, scopeName)
          if (version === null || version <= publishedVersion(scopeName)) return false
          await reload(scopeName)
          return true
        })()
        checks.set(scopeName, check)
        check.finally(() => checks.delete(scopeName)).catch(() => {})
      }
      return checks.get(scopeName)
    }

    const watchSchema = (scope) => {
      for (const name of REQUEST_METHODS) {
        const method = scope[name]
        if (typeof method !== 'function') continue
        scope[name] = async function (params = {}, context = {}) {
          // A caller transaction may hold uncommitted metadata; never publish from it.
          if (params?.transaction) return method.call(this, params, context)
          await ensureFresh(scope.name, schemaCheckInterval)
          try {
            return await method.call(this, params, context)
          } catch (error) {
            if (!isStaleSchemaRejection(error)) throw error
            let reloaded = false
            try { reloaded = await ensureFresh(scope.name, 0) } catch { throw error }
            if (!reloaded) throw error
            return method.call(this, params, context)
          }
        }
      }
    }

    const loadResource = async (name, chain = new Set()) => {
      if (typeof name !== 'string' || !name) throw new TypeError('loadResource requires a resource name')
      if (Object.hasOwn(api.resources, name)) return api.resources[name]
      if (chain.has(name)) return null
      if (!loading.has(name)) {
        const load = (async () => {
          const descriptor = await registry.getDescriptor(tenantId, name)
          if (!descriptor) return null
          if (!descriptor.definition?.options) {
            throw new Error(`AnyAPI resource '${name}' has no stored definition; declare it in code or register it again with this version`)
          }
          const { options: declaration } = composeResourceOptions({
            declaration: descriptor.definition.options,
            stored: { callbacks: descriptor.definition.callbacks },
            fromStorage: true
          })
          const { before, after } = relatedResources(declaration)
          const nextChain = new Set([...chain, name])
          for (const target of before) await loadResource(target, nextChain)
          if (Object.hasOwn(api.resources, name)) return api.resources[name]
          storageLoaded.add(name)
          try {
            await api.addResource(name, declaration)
          } catch (error) {
            // A failed registration must not leave a half-published resource behind.
            storageLoaded.delete(name)
            declarations.delete(name)
            delete api.resources[name]
            throw error
          }
          for (const target of after) await loadResource(target, nextChain)
          return api.resources[name]
        })()
        loading.set(name, load)
        load.finally(() => loading.delete(name)).catch(() => {})
      }
      return loading.get(name)
    }

    api.anyapi.loadResource = name => loadResource(name)
    api.anyapi.loadResources = async () => {
      for (const { resource } of await registry.listResources(tenantId)) await loadResource(resource)
      return api.resources
    }
    api.anyapi.getSchemaVersion = resource => registry.getSchemaVersion(tenantId, resource)
    api.anyapi.handleSchemaChange = async ({ tenant, resource, version } = {}) => {
      if ((tenant !== undefined && tenant !== tenantId) || typeof resource !== 'string' || !Object.hasOwn(api.resources, resource)) return false
      if (version !== undefined && publishedVersion(resource) >= version) return false
      await reload(resource)
      return true
    }

    const buildSearchMembershipQuery = ({ sourceScopeName, relationshipName, targetScopeName, foreignKey, otherKey, db }) => {
      const info = linkStore.getManyToManyInfo(sourceScopeName, relationshipName)
      if (!info) throw new RestApiResourceError(`Relationship '${sourceScopeName}.${relationshipName}' not found`, { subtype: 'related_type_not_found' })
      const links = linkStore.buildRelatedLinkQuery({ ...info, db, allParents: true })
      const pivotAdapter = getScopeStorageAdapter(targetScopeName)
      return {
        query: db.select({
          [pivotAdapter.translateColumn(foreignKey)]: 'parentId',
          [pivotAdapter.translateColumn(otherKey)]: 'childId'
        }).from(links.as('search_membership'))
      }
    }

    const queryHookDependencies = { log, scopes: api.resources, knex, getStorageAdapter: getScopeStorageAdapter, buildSearchMembershipQuery }

    const applyBuiltInAnyApiQueryFilters = async (context) => {
      const hookParams = { context }
      await polymorphicFiltersHook(hookParams, queryHookDependencies)
      await crossTableFiltersHook(hookParams, queryHookDependencies)
      await basicFiltersHook(hookParams, queryHookDependencies)
    }

    Object.assign(helpers, createCanonicalDataHelpers({
      api,
      knex,
      getScopeStorageAdapter,
      getDescriptor,
      linkStore,
      buildIncludes,
      attachReverseRelationships,
      attachManyToManyRelationships,
      applyBuiltInAnyApiQueryFilters
    }))

    addHook('resource:added', 'anyapi-register-resource', {}, async ({ context }) => {
      const { scopeName, scopeOptions = {} } = context
      const scope = api.resources[scopeName]
      const declaration = snapshotResourceConfiguration(scopeOptions)
      declarations.set(scopeName, declaration)
      compiledSignatures.set(scopeName, optionsSignature(declaration))
      let descriptor
      let changed = false
      if (storageLoaded.has(scopeName)) {
        descriptor = await registry.getDescriptor(tenantId, scopeName)
        if (!descriptor) throw new Error(`Descriptor not found for resource '${scopeName}'`)
      } else {
        const { schemaStructure, computed, schemaRelationships, idProperty } = scope.vars.schemaInfo
        ;({ descriptor, changed } = await registry.register({
          tenant: tenantId,
          resource: scopeName,
          schema: { ...schemaStructure, ...computed },
          relationships: schemaRelationships,
          canonicalFieldMap: scopeOptions.canonicalFieldsMap || null,
          idProperty,
          declaration
        }))
      }
      await publish(scopeName, descriptor)
      if (schemaCheckInterval !== undefined) watchSchema(scope)
      if (changed) await notifySchemaChanged(scopeName, descriptor.schemaVersion)
    })

    addResourceMethod('createKnexTable', async ({ scopeName }) => {
      if (ensureSchema) await ensureAnyApiSchema(knex, { slots, indexedSlots })
      const descriptor = await registry.getDescriptor(tenantId, scopeName)
      if (!descriptor) throw new Error(`Descriptor not found for resource '${scopeName}'`)
      await publish(scopeName, descriptor)
    })

    addResourceMethod('reloadSchema', async ({ scopeName }) => reload(scopeName))

    // Compile the resource with the additions, so allocation stores enriched definitions.
    const prepareAdditions = async (scopeName, { fields, searchSchema = {}, canonicalFieldsMap }) => {
      const current = composeOptions(scopeName, api.resources[scopeName].vars.schemaInfo.descriptor).options
      const candidate = snapshotResourceConfiguration({
        ...current,
        schema: { ...current.schema, ...fields },
        searchSchema: { ...current.searchSchema, ...searchSchema }
      })
      const schemaInfo = await compileOptions(scopeName, candidate)
      const allocation = {
        tenant: tenantId,
        resource: scopeName,
        fields: Object.fromEntries(Object.keys(fields).map(fieldName => [fieldName, {
          definition: schemaInfo.schemaStructure[fieldName] || schemaInfo.computed[fieldName],
          declaration: fields[fieldName],
          canonicalField: canonicalFieldsMap?.[fieldName]
        }])),
        searchSchema
      }
      return { candidate, schemaInfo, allocation }
    }

    const publishChange = async (scopeName, { fields = {}, searchSchema = {}, compiled } = {}) => {
      registry.invalidateDescriptor(tenantId, scopeName)
      if (Object.keys(fields).length || Object.keys(searchSchema).length) {
        const local = runtimeDeclarations.get(scopeName) || {}
        runtimeDeclarations.set(scopeName, {
          schema: { ...local.schema, ...fields },
          searchSchema: { ...local.searchSchema, ...searchSchema }
        })
      }
      // The fresh descriptor also carries changes other servers made meanwhile.
      const descriptor = await registry.getDescriptor(tenantId, scopeName)
      await publish(scopeName, descriptor, { compiled })
      await notifySchemaChanged(scopeName, descriptor.schemaVersion)
    }

    addResourceMethod('addKnexFields', async ({ scopeName, params }) => {
      if (!params?.fields || typeof params.fields !== 'object' || Array.isArray(params.fields)) {
        throw new Error('fields parameter is required for addKnexFields')
      }
      assertFieldNameMap(params.fields, `added fields in '${scopeName}'`)
      assertFieldNameMap(params.searchSchema, `added search schema in '${scopeName}'`)
      assertFieldNameMap(params.canonicalFieldsMap, `added canonical fields in '${scopeName}'`)
      const unknown = Object.keys(params.canonicalFieldsMap || {}).filter(field => !Object.hasOwn(params.fields, field))
      if (unknown.length) {
        throw new Error(`canonicalFieldsMap contains unknown fields for addKnexFields: ${unknown}`)
      }
      const fields = snapshotResourceConfiguration(params.fields)
      const searchSchema = snapshotResourceConfiguration(params.searchSchema || {})
      const { candidate, schemaInfo, allocation } = await prepareAdditions(scopeName, { fields, searchSchema, canonicalFieldsMap: params.canonicalFieldsMap })
      await api.transaction(transaction => registry.allocateFields(allocation, { transaction }))
      await publishChange(scopeName, { fields, searchSchema, compiled: { signature: optionsSignature(candidate), schemaInfo } })
    })

    const retirable = (scopeName, fieldName) => {
      const definition = api.resources[scopeName].vars.schemaInfo.schemaStructure[fieldName]
      if (!definition || fieldName === 'id' || definition.virtual === true || definition.belongsTo) {
        throw new Error(`'${scopeName}.${fieldName}' is not a stored attribute`)
      }
      return definition
    }

    addResourceMethod('retireKnexFields', async ({ scopeName, params }) => {
      const fields = Array.isArray(params) ? params : params?.fields
      if (!Array.isArray(fields) || !fields.length) throw new Error('retireKnexFields requires an array of field names')
      fields.forEach(fieldName => retirable(scopeName, fieldName))
      await registry.retireFields({ tenant: tenantId, resource: scopeName, fields })
      await publishChange(scopeName)
    })

    // Change a field's type: copy its values into a new field, then retire it.
    addResourceMethod('migrateField', async ({ scopeName, params }) => {
      const { from, to, transform } = params || {}
      const { name, ...declaration } = to || {}
      if (typeof from !== 'string' || typeof name !== 'string' || !name) {
        throw new Error('migrateField requires from and to: { name, ...definition }')
      }
      if (transform !== undefined && typeof transform !== 'function') throw new Error('migrateField transform must be a function')
      const fromDefinition = retirable(scopeName, from)
      if (fromDefinition.retired) throw new Error(`Field '${scopeName}.${from}' is already retired`)
      if (declaration.computed || declaration.virtual || declaration.belongsTo || declaration.getter || declaration.setter || declaration.storage) {
        throw new Error(`migrateField target '${name}' must be a plain stored attribute; add other fields with addKnexFields`)
      }
      assertFieldNameMap({ [name]: declaration }, `migrated field in '${scopeName}'`)
      const fields = snapshotResourceConfiguration({ [name]: declaration })
      const { schemaInfo, allocation } = await prepareAdditions(scopeName, { fields })

      await api.transaction(async (transaction) => {
        const descriptor = await registry.allocateFields(allocation, { transaction })
        await copyFieldValues({ transaction, descriptor, schemaInfo, from, fromDefinition, to: name, transform })
        await registry.retireFields({ tenant: tenantId, resource: scopeName, fields: [from] }, { transaction })
      })
      await publishChange(scopeName, { fields })
    })

    const copyFieldValues = async ({ transaction, descriptor, schemaInfo, from, fromDefinition, to, transform }) => {
      const { canonical } = descriptor
      const source = descriptor.fields[from].slot
      const target = descriptor.fields[to].slot
      const idColumn = canonical.logicalIdColumn
      for (let lastId = null; ;) {
        const query = transaction(canonical.tableName)
          .where(canonical.tenantColumn, tenantId)
          .where(canonical.resourceColumn, descriptor.resource)
          .orderBy('id')
          .limit(MIGRATION_BATCH_SIZE)
          .select('id', idColumn, source)
        if (lastId !== null) query.where('id', '>', lastId)
        const rows = await applyDatabaseReadOptions(query)
        if (!rows.length) return
        for (const row of rows) {
          lastId = row.id
          const value = normalizeStoredFieldValue(row[source], fromDefinition, { fieldName: from, resourceType: descriptor.resource })
          const next = transform ? await transform(value, { id: String(row[idColumn]) }) : value
          const rejected = reason => {
            const message = `Record '${row[idColumn]}' cannot migrate '${from}' to '${to}': ${reason}`
            return new RestApiValidationError(message, { fields: [to], violations: [{ field: to, rule: 'field_migration', message }] })
          }
          const { validatedObject, errors } = await schemaInfo.schemaInstance.patch({ [to]: next ?? null })
          if (Object.keys(errors).length) throw rejected(Object.values(errors)[0].message)
          let stored
          try {
            stored = translateCanonicalAttributesForStorage({ [to]: validatedObject[to] ?? null }, descriptor, {
              schemaInfo, databaseClient: knex.client.config.client
            })
          } catch (error) {
            if (error?.type === 'rest_api_validation') throw rejected(error.message)
            throw error
          }
          await transaction(canonical.tableName).where('id', row.id).update({ [target]: stored[target] ?? null })
        }
      }
    }

    addResourceMethod('alterKnexFields', async () => {
      throw new Error('alterKnexFields is not supported by AnyAPI Knex plugin yet')
    })
  },
}
