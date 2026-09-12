import { createOrdinaryDataHelpers } from './lib/storage/ordinary-data-helpers.js'
import { createKnexTransaction } from '../../lib/knex-transaction.js'
import { createEnhancedLogger } from '../../lib/enhanced-logger.js'
import { throwMissingPackage } from '../../lib/missing-package.js'
import { createSchema } from 'json-rest-schema'
import { createKnexTable, addKnexFields, alterKnexFields, generateKnexMigration, generateKnexMigrationDiff } from './lib/dbTablesOperations.js'
import { introspectKnexTableSnapshot } from './lib/dbIntrospection.js'
import { polymorphicFiltersHook, crossTableFiltersHook, basicFiltersHook } from './lib/querying/knex-query-helpers.js'
import { getDatabaseCapabilities } from './lib/querying-writing/database-capabilities.js'
import { createStorageAdapterLookup } from './lib/storage/storage-adapter.js'
import { assertWritableKnexColumns } from './lib/storage/storage-mapping.js'
import { assertFieldNameMap } from './lib/querying-writing/field-utils.js'

export const RestApiKnexPlugin = {
  name: 'rest-api-knex',
  dependencies: ['rest-api'],

  async install ({ helpers, pluginOptions, api, log, scopes, addHook, addResourceMethod }) {
    log = createEnhancedLogger(log)
    try {
      await import('knex')
    } catch (e) {
      throwMissingPackage('knex', 'rest-api-knex',
        'Knex.js is required for database operations. This is a peer dependency that allows you to control the version.')
    }

    const knexOptions = pluginOptions || {}
    const knex = knexOptions.knex

    api.knex = {
      instance: knex,
      helpers: {}
    }

    const getScopeStorageAdapter = createStorageAdapterLookup({
      knex,
      getResource: scopeName => api.resources?.[scopeName] || scopes?.[scopeName]
    })

    api.knex.helpers.getStorageAdapter = getScopeStorageAdapter
    helpers.getStorageAdapter = getScopeStorageAdapter

    addHook('resource:added', 'validate-knex-storage-columns', { afterFunction: 'compileResourceSchemas' }, ({ context }) => {
      assertWritableKnexColumns(context.vars.schemaInfo.storageInfo)
    })

    const buildScopeTableSchema = (vars = {}) => {
      const schemaStructure = vars.schemaInfo?.schemaStructure || {}
      const filteredSchema = {}

      for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
        if (!fieldDef.virtual) filteredSchema[fieldName] = fieldDef
      }

      return {
        structure: filteredSchema,
        storage: vars.schemaInfo?.storage,
        indexes: vars.schemaInfo?.indexes || [],
        foreignKeys: vars.schemaInfo?.foreignKeys || [],
        checkConstraints: vars.schemaInfo?.checkConstraints || []
      }
    }

    api.knex.capabilities = await getDatabaseCapabilities(knex, log)
    const { dbInfo, windowFunctions } = api.knex.capabilities

    log.info('Database capabilities detected:', {
      database: dbInfo.client,
      version: dbInfo.version,
      windowFunctions
    })

    const queryHookDependencies = { log, scopes, knex, getStorageAdapter: getScopeStorageAdapter }

    // Relationship joins must precede basic filters so column names are qualified.
    addHook('knexQueryFiltering', 'polymorphicFiltersHook', {},
      async (hookParams) => polymorphicFiltersHook(hookParams, queryHookDependencies)
    )

    addHook('knexQueryFiltering', 'crossTableFiltersHook', {},
      async (hookParams) => crossTableFiltersHook(hookParams, queryHookDependencies)
    )

    addHook('knexQueryFiltering', 'basicFiltersHook', {},
      async (hookParams) => basicFiltersHook(hookParams, queryHookDependencies)
    )

    addHook('release', 'releaseHook', {},
      async ({ api }) => api.knex.instance.destroy()
    )

    addResourceMethod('createKnexTable', async ({ vars, scopeOptions }) => {
      const tableSchemaInstance = buildScopeTableSchema(vars)
      await createKnexTable(api.knex.instance, vars.schemaInfo, tableSchemaInstance, scopeOptions)
    })

    addResourceMethod('introspectKnexTableSnapshot', async ({ vars }) => {
      return introspectKnexTableSnapshot(api.knex.instance, {
        tableName: vars.schemaInfo.tableName,
        idColumn: vars.schemaInfo.idProperty
      })
    })

    addResourceMethod('generateKnexMigration', async ({ vars, scopeOptions }) => {
      return generateKnexMigration(
        vars.schemaInfo.tableName,
        buildScopeTableSchema(vars),
        {
          ...scopeOptions,
          idProperty: vars.schemaInfo.idProperty,
          dialect: api.knex.instance?.client?.config?.client
        }
      )
    })

    addResourceMethod('generateKnexMigrationDiff', async ({ vars, params }) => {
      const snapshot = await introspectKnexTableSnapshot(api.knex.instance, {
        tableName: vars.schemaInfo.tableName,
        idColumn: vars.schemaInfo.idProperty
      })

      return generateKnexMigrationDiff(
        vars.schemaInfo.tableName,
        snapshot,
        buildScopeTableSchema(vars),
        {
          ...(params?.options || {}),
          idProperty: vars.schemaInfo.idProperty,
          dialect: snapshot.dialect || api.knex.instance?.client?.config?.client
        }
      )
    })

    addResourceMethod('alterKnexFields', async ({ vars, params }) => {
      if (!params.fields || typeof params.fields !== 'object') {
        throw new Error('fields parameter is required for alterKnexFields')
      }

      await alterKnexFields(
        api.knex.instance,
        vars.schemaInfo.tableName,
        { structure: params.fields },
        { storage: vars.schemaInfo.storage, ...params.options, idProperty: vars.schemaInfo.idProperty }
      )
    })

    addResourceMethod('addKnexFields', async ({ vars, scopeName, params }) => {
      assertFieldNameMap(params.fields, `added fields in '${scopeName}'`)
      const partialTableSchema = createSchema(params.fields)

      await addKnexFields(
        api.knex.instance,
        vars.schemaInfo.tableName,
        partialTableSchema,
        { storage: vars.schemaInfo.storage, idProperty: vars.schemaInfo.idProperty }
      )
    })

    /** @type {import('../../lib/transaction-types.js').TransactionFactory} */
    helpers.newTransaction = context => createKnexTransaction(knex, context)

    Object.assign(helpers, createOrdinaryDataHelpers({ api, scopes, knex, log, getScopeStorageAdapter }))

    log.info('RestApiKnexPlugin installed - basic CRUD operations ready')
  }
}
