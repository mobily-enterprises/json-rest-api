import { createCanonicalDataHelpers } from './lib/storage/canonical-data-helpers.js'
import { createCanonicalLinkStore } from './lib/anyapi/canonical-link-store.js'
import { createCanonicalRelationshipReader } from './lib/anyapi/canonical-relationship-reader.js'
import { createKnexTransaction } from '../../lib/knex-transaction.js'
import { createEnhancedLogger } from '../../lib/enhanced-logger.js'
import { ensureAnyApiSchema } from './lib/anyapi/schema-utils.js'
import { AnyapiRegistry } from './lib/anyapi/anyapi-registry.js'
import { RestApiResourceError } from '../../lib/rest-api-errors.js'
import { compileSchemas } from './lib/querying-writing/compile-schemas.js'
import { snapshotResourceConfiguration } from './lib/querying-writing/schema-helpers.js'
import { assertFieldNameMap } from './lib/querying-writing/field-utils.js'
import { polymorphicFiltersHook, crossTableFiltersHook, basicFiltersHook } from './lib/querying/knex-query-helpers.js'
import { createStorageAdapterLookup } from './lib/storage/storage-adapter.js'
import { getDatabaseCapabilities } from './lib/querying-writing/database-capabilities.js'

const DEFAULT_TENANT = 'default'

export const RestApiAnyapiKnexPlugin = {
  name: 'rest-api-anyapi-knex',
  dependencies: ['rest-api'],

  async install ({ helpers, pluginOptions, api, log, addHook, addResourceMethod, scopes }) {
    log = createEnhancedLogger(log)
    const options = pluginOptions || {}
    const knex = options.knex
    const tenantId = options.tenantId || DEFAULT_TENANT

    if (!knex) {
      throw new Error('AnyapiKnexPlugin requires a knex instance')
    }

    await ensureAnyApiSchema(knex)

    const registry = new AnyapiRegistry({ knex, log })

    api.anyapi = api.anyapi || {}
    api.anyapi.registry = registry
    api.anyapi.tenantId = tenantId
    api.knex = {
      instance: knex,
      helpers: {},
      capabilities: await getDatabaseCapabilities(knex, log),
    }

    const getScopeStorageAdapter = createStorageAdapterLookup({
      knex,
      getResource: scopeName => api.resources?.[scopeName] || scopes?.[scopeName]
    })

    api.knex.helpers.getStorageAdapter = getScopeStorageAdapter
    helpers.getStorageAdapter = getScopeStorageAdapter

    const scopeOptionsRegistry = new Map()

    /** @type {import('../../lib/transaction-types.js').TransactionFactory} */
    helpers.newTransaction = context => createKnexTransaction(knex, context)

    addHook('release', 'anyapi-knex-release', {}, async ({ api }) => {
      if (api.knex?.instance) {
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

    const refreshStorageDescriptor = async (scopeName, compiledSchemaInfo) => {
      const scope = api.resources[scopeName]
      const schemaInfo = compiledSchemaInfo || scope.vars.schemaInfo
      const descriptor = await registry.getDescriptor(tenantId, scopeName)
      if (!descriptor) throw new Error(`Descriptor not found for resource '${scopeName}'`)
      descriptor.idProperty = schemaInfo.idProperty
      scope.vars.schemaInfo = {
        ...schemaInfo,
        descriptor,
        canonicalFieldMap: descriptor.canonicalFieldMap,
      }
      getScopeStorageAdapter(scopeName)
      scopeOptionsRegistry.set(scopeName, {
        ...scopeOptionsRegistry.get(scopeName),
        canonicalFieldsMap: descriptor.canonicalFieldMap,
      })
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
      const { schemaStructure, computed, schemaRelationships, idProperty } = scope.vars.schemaInfo
      const descriptor = await registry.registerResource({
        tenant: tenantId,
        resource: scopeName,
        schema: { ...schemaStructure, ...computed },
        relationships: schemaRelationships,
        canonicalFieldMap: scopeOptions.canonicalFieldsMap || null,
        idProperty
      })
      scopeOptionsRegistry.set(scopeName, snapshotResourceConfiguration({
        ...scopeOptions,
        idProperty,
        canonicalFieldsMap: descriptor.canonicalFieldMap
      }))
      await refreshStorageDescriptor(scopeName)
    })

    addResourceMethod('createKnexTable', async ({ scopeName }) => {
      await ensureAnyApiSchema(knex)
      await refreshStorageDescriptor(scopeName)
    })

    addResourceMethod('addKnexFields', async ({ scopeName, params }) => {
      if (!params?.fields || typeof params.fields !== 'object' || Array.isArray(params.fields)) {
        throw new Error('fields parameter is required for addKnexFields')
      }
      assertFieldNameMap(params.fields, `added fields in '${scopeName}'`)
      assertFieldNameMap(params.searchSchema, `added search schema in '${scopeName}'`)
      assertFieldNameMap(params.canonicalFieldsMap, `added canonical fields in '${scopeName}'`)
      const scope = api.resources[scopeName]
      const storedBefore = scopeOptionsRegistry.get(scopeName) || {}
      const unknown = Object.keys(params.canonicalFieldsMap || {}).filter(field => !Object.hasOwn(params.fields, field))
      if (unknown.length) {
        throw new Error(`canonicalFieldsMap contains unknown fields for addKnexFields: ${unknown}`)
      }
      const updatedStored = snapshotResourceConfiguration({
        ...storedBefore,
        schema: { ...storedBefore.schema, ...params.fields },
        searchSchema: { ...storedBefore.searchSchema, ...params.searchSchema }
      })
      const compiled = { scopeOptions: updatedStored, vars: { idProperty: scope.vars.idProperty } }
      await compileSchemas(compiled, { context: { scopeName }, runHooks: (name, context) => api.runHooks(name, context) })
      await api.transaction(async transaction => {
        for (const fieldName of Object.keys(params.fields)) {
          await registry.allocateField({
            tenant: tenantId,
            resource: scopeName,
            fieldName,
            definition: compiled.vars.schemaInfo.schemaStructure[fieldName] || compiled.vars.schemaInfo.computed[fieldName],
            canonicalField: params.canonicalFieldsMap?.[fieldName]
          }, { transaction })
        }
      })
      registry.invalidateDescriptor(tenantId, scopeName)
      scopeOptionsRegistry.set(scopeName, updatedStored)
      await refreshStorageDescriptor(scopeName, compiled.vars.schemaInfo)
    })

    addResourceMethod('alterKnexFields', async () => {
      throw new Error('alterKnexFields is not supported by AnyAPI Knex plugin yet')
    })
  },
}
