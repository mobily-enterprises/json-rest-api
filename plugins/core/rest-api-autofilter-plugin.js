import { RestApiResourceError, RestApiValidationError } from '../../lib/rest-api-errors.js'
import { assertGenuineSystemFlag, isSystemContext } from '../../lib/system-context.js'
import { snapshotResourceConfiguration } from './lib/querying-writing/schema-helpers.js'
import { createStorageAdapterUtilities } from './lib/querying/storage-adapter-utils.js'

const PUBLIC_PRESET_NAME = 'public'
// Queries that write or lock the rows they select: shared rows are never theirs.
const WRITE_PURPOSES = new Set(['bulk-write', 'lock', 'claim'])

function valuesEqual (left, right) {
  if (left === right) return true
  if (left === null || right === null) return left === right
  if (left === undefined || right === undefined) return left === right
  return String(left) === String(right)
}

function buildAutofilterContextError ({ scopeName, filter }) {
  const resolverName = filter.resolverName || '<inline>'
  const error = new Error(
    `Missing autofilter value for resolver '${resolverName}' on resource '${scopeName}'`
  )
  error.code = 'REST_API_AUTOFILTER_CONTEXT'
  return error
}

function buildAutofilterConsistencyError ({ filter, resolvedValue }) {
  const fieldPath = filter.inputPath
  const expectedValue = resolvedValue === null ? 'null' : String(resolvedValue)

  return new RestApiValidationError(
    `Scoped field '${filter.field}' must match the resolved autofilter value`,
    {
      fields: [fieldPath],
      violations: [{
        field: fieldPath,
        rule: 'autofilter_consistency',
        message: `Field must match autofilter value '${expectedValue}'`
      }]
    }
  )
}

function ensureResolverMap (resolverMap = {}) {
  const normalized = Object.create(null)

  for (const [name, resolver] of Object.entries(resolverMap)) {
    if (typeof resolver !== 'function') {
      throw new Error(`AutoFilter resolver '${name}' must be a function.`)
    }
    normalized[name] = resolver
  }

  return normalized
}

function getPresetFilters (presetName, presets) {
  const preset = Object.hasOwn(presets, presetName) ? presets[presetName] : undefined

  if (!preset) {
    throw new Error(`Unknown autofilter preset '${presetName}'.`)
  }

  if (Array.isArray(preset)) {
    return preset
  }

  if (typeof preset === 'object' && preset !== null && Array.isArray(preset.filters)) {
    return preset.filters
  }

  throw new Error(`Autofilter preset '${presetName}' must be an array or an object with a filters array.`)
}

function normalizeFilterDefinition ({ filterDef, resolvers, schemaStructure, scopeName }) {
  if (!filterDef || typeof filterDef !== 'object' || Array.isArray(filterDef)) {
    throw new Error(`Invalid autofilter definition on resource '${scopeName}'.`)
  }

  const field = String(filterDef.field || '').trim()
  if (!field) {
    throw new Error(`Autofilter definitions on resource '${scopeName}' must include a field.`)
  }

  const fieldDef = Object.hasOwn(schemaStructure, field) ? schemaStructure[field] : undefined
  if (!fieldDef) {
    throw new Error(`Autofilter field '${field}' does not exist on resource '${scopeName}'.`)
  }

  if (fieldDef.virtual === true || fieldDef.computed === true) {
    throw new Error(`Autofilter field '${field}' on resource '${scopeName}' must be a persisted field.`)
  }

  const resolverDef = filterDef.resolve ?? filterDef.resolver
  let resolve
  let resolverName

  if (typeof resolverDef === 'string') {
    resolve = Object.hasOwn(resolvers, resolverDef) ? resolvers[resolverDef] : undefined
    resolverName = resolverDef
    if (!resolve) {
      throw new Error(`Unknown autofilter resolver '${resolverDef}' on resource '${scopeName}'.`)
    }
  } else if (typeof resolverDef === 'function') {
    resolve = resolverDef
    resolverName = '<inline>'
  } else {
    throw new Error(`Autofilter field '${field}' on resource '${scopeName}' must define a resolver.`)
  }

  const relationshipName = fieldDef.belongsTo && fieldDef.as
    ? fieldDef.as
    : null

  if (filterDef.shared !== undefined && typeof filterDef.shared !== 'boolean') {
    throw new Error(`Autofilter field '${field}' on resource '${scopeName}' must set shared to true or false.`)
  }
  if (filterDef.shared === true && fieldDef.nullable !== true) {
    throw new Error(`Autofilter field '${field}' on resource '${scopeName}' is shared, so it must be nullable: NULL marks a shared row.`)
  }

  return {
    field,
    fieldDef,
    resolve,
    resolverName,
    required: filterDef.required !== false,
    shared: filterDef.shared === true,
    relationshipName,
    relationshipType: relationshipName ? fieldDef.belongsTo : null,
    inputPath: relationshipName
      ? `data.relationships.${relationshipName}.data.id`
      : `data.attributes.${field}`
  }
}

function compileAutoFilterDefinition ({ scopeName, scopeOptions = {}, schemaStructure = {}, resolvers, presets }) {
  const definition = scopeOptions.autofilter

  if (definition === undefined || definition === null || definition === false) {
    return null
  }

  let presetName = null
  const rawFilters = []

  if (typeof definition === 'string') {
    presetName = definition
    rawFilters.push(...getPresetFilters(presetName, presets))
  } else if (Array.isArray(definition)) {
    rawFilters.push(...definition)
  } else if (typeof definition === 'object') {
    if (definition.preset) {
      presetName = definition.preset
      rawFilters.push(...getPresetFilters(presetName, presets))
    }

    if (Array.isArray(definition.filters)) {
      rawFilters.push(...definition.filters)
    } else if (!definition.preset) {
      throw new Error(`Autofilter definition for resource '${scopeName}' must include a filters array or preset.`)
    }
  } else {
    throw new Error(`Invalid autofilter definition for resource '${scopeName}'.`)
  }

  return {
    preset: presetName,
    filters: rawFilters.map((filterDef) => normalizeFilterDefinition({
      filterDef,
      resolvers,
      schemaStructure,
      scopeName
    }))
  }
}

async function resolveFilterValue ({ filter, context, scopeName, api, helpers, scopes, vars, log }) {
  const value = await filter.resolve({
    context,
    scopeName,
    filter,
    api,
    helpers,
    scopes,
    vars,
    log
  })

  if (value === undefined && filter.required) {
    throw buildAutofilterContextError({ scopeName, filter })
  }

  return value
}

function ensureInputContainers (context) {
  const data = context.inputRecord.data
  data.attributes = data.attributes || {}
  data.relationships = data.relationships || {}
  return data
}

function applyResolvedInputValue ({ context, filter, resolvedValue, injectMissing }) {
  const data = ensureInputContainers(context)
  const { attributes, relationships } = data

  if (filter.relationshipName) {
    const relationship = relationships[filter.relationshipName]
    const relationshipData = relationship?.data

    if (relationshipData !== undefined) {
      if (relationshipData === null) {
        if (resolvedValue !== null) {
          throw buildAutofilterConsistencyError({ filter, resolvedValue })
        }
        return
      }

      if (Array.isArray(relationshipData) || !valuesEqual(relationshipData?.id, resolvedValue)) {
        throw buildAutofilterConsistencyError({ filter, resolvedValue })
      }

      if (relationshipData?.type && filter.relationshipType && relationshipData.type !== filter.relationshipType) {
        throw buildAutofilterConsistencyError({ filter, resolvedValue })
      }

      return
    }

    if (attributes[filter.field] !== undefined && !valuesEqual(attributes[filter.field], resolvedValue)) {
      throw buildAutofilterConsistencyError({ filter, resolvedValue })
    }

    if (injectMissing) {
      relationships[filter.relationshipName] = resolvedValue === null
        ? { data: null }
        : {
            data: {
              type: filter.relationshipType,
              id: String(resolvedValue)
            }
          }
    }

    return
  }

  const existingValue = attributes[filter.field]
  if (existingValue !== undefined) {
    if (!valuesEqual(existingValue, resolvedValue)) {
      throw buildAutofilterConsistencyError({ filter, resolvedValue })
    }
    return
  }

  if (injectMissing) {
    attributes[filter.field] = resolvedValue
  }
}

// A system context owns no workspace or user, so a create must say whose row it is.
function requireExplicitOwnership ({ compiledConfig, inputRecord, scopeName, index }) {
  const data = inputRecord?.data || {}
  const missing = compiledConfig.filters.filter(filter => {
    if (filter.relationshipName && data.relationships?.[filter.relationshipName]?.data !== undefined) return false
    return data.attributes?.[filter.field] === undefined
  })
  if (!missing.length) return
  const prefix = index === undefined ? '' : `data.${index}.`
  const violations = missing.map(filter => ({
    field: `${prefix}${filter.inputPath}`,
    rule: 'system_ownership_required',
    message: `A create in a system context must set '${filter.field}' explicitly${filter.shared ? ' (null for a shared row)' : ''}`
  }))
  throw new RestApiValidationError(`Creating '${scopeName}' records in a system context needs explicit ownership values`, {
    fields: violations.map(violation => violation.field),
    violations
  })
}

// Without an owner value a shared filter would stamp NULL, creating a row every owner sees.
function refuseSharedCreate ({ filter, resolvedValue, scopeName }) {
  if (!filter.shared || resolvedValue !== null) return
  throw new RestApiResourceError(`Shared ${scopeName} records can only be created in a system context`, {
    subtype: 'forbidden', resourceType: scopeName
  })
}

function sharedFieldValue (record, filter) {
  if (filter.relationshipName) {
    const linkage = record?.relationships?.[filter.relationshipName]?.data
    if (linkage !== undefined) return linkage === null ? null : linkage.id
  }
  return record?.attributes?.[filter.field]
}

async function enforceScopedInput ({ compiledConfig, context, scopeName, injectMissing, api, helpers, scopes, vars, log }) {
  if (!compiledConfig || compiledConfig.filters.length === 0) return
  assertGenuineSystemFlag(context)
  if (isSystemContext(context)) {
    if (injectMissing) requireExplicitOwnership({ compiledConfig, inputRecord: context.inputRecord, scopeName })
    return
  }

  for (const filter of compiledConfig.filters) {
    const resolvedValue = await resolveFilterValue({
      filter,
      context,
      scopeName,
      api,
      helpers,
      scopes,
      vars,
      log
    })

    if (resolvedValue === undefined) continue
    if (injectMissing) refuseSharedCreate({ filter, resolvedValue, scopeName })

    applyResolvedInputValue({
      context,
      filter,
      resolvedValue,
      injectMissing
    })
  }
}

export const AutoFilterPlugin = {
  name: 'autofilter',
  dependencies: ['rest-api', ['rest-api-knex', 'rest-api-anyapi-knex']],

  install ({ api, addHook, vars, helpers, log, scopes, pluginOptions = {} }) {
    if (!api.knex?.instance) {
      throw new Error('AutoFilterPlugin requires a storage plugin with knex support (rest-api-knex or rest-api-anyapi-knex).')
    }

    const state = {
      resolvers: ensureResolverMap(pluginOptions.resolvers || {}),
      presets: snapshotResourceConfiguration({
        [PUBLIC_PRESET_NAME]: { filters: [] },
        ...(pluginOptions.presets || {})
      })
    }

    vars.autofilter = {
      presets: Object.keys(state.presets),
      resolvers: Object.keys(state.resolvers)
    }

    addHook('schema:compiled', 'compile-autofilter', {}, ({ context }) => {
      const { scopeName, scopeOptions, schemaInfo } = context
      schemaInfo.autofilter = compileAutoFilterDefinition({
        scopeName,
        scopeOptions,
        schemaStructure: schemaInfo.schemaStructure,
        resolvers: state.resolvers,
        presets: state.presets
      })
      // Many-row writes refuse these fields and require them in upsert conflict keys.
      schemaInfo.ownershipFields = (schemaInfo.autofilter?.filters || []).map(filter => filter.field)
    })

    addHook('knexQueryFiltering', 'autofilter-scope', {}, async ({ context }) => {
      const { query, tableName, scopeName, queryPurpose } = context.knexQuery || {}
      if (!query || !scopeName) return

      const compiledConfig = scopes[scopeName]?.vars?.schemaInfo?.autofilter
      if (!compiledConfig || compiledConfig.filters.length === 0) return
      assertGenuineSystemFlag(context)
      if (isSystemContext(context)) return
      const writes = WRITE_PURPOSES.has(queryPurpose)
      const adapterUtils = createStorageAdapterUtilities({ context }, {
        getStorageAdapter: helpers.getStorageAdapter
      })

      for (const filter of compiledConfig.filters) {
        const resolvedValue = await resolveFilterValue({
          filter,
          context,
          scopeName,
          api,
          helpers,
          scopes,
          vars,
          log
        })

        if (resolvedValue === undefined) continue

        const columnRef = adapterUtils.translateColumn(scopeName, filter.field, tableName)
        const translatedValue = adapterUtils.translateFilterValue(scopeName, filter.field, resolvedValue)

        if (filter.shared) {
          // Reads see the owner's rows and the shared (NULL) ones; writes and locks only the owner's.
          if (translatedValue === null) {
            if (writes) query.whereRaw('1 = 0')
            else query.whereNull(columnRef)
          } else if (writes) {
            query.where(columnRef, translatedValue)
          } else {
            query.where(builder => builder.where(columnRef, translatedValue).orWhereNull(columnRef))
          }
        } else if (translatedValue === null) {
          query.whereNull(columnRef)
        } else {
          query.where(columnRef, translatedValue)
        }
      }
    })

    addHook('beforeProcessingPost', 'autofilter-stamp-post', { batch: true }, async ({ context, scopeName }) => {
      await enforceScopedInput({
        compiledConfig: scopes[scopeName]?.vars?.schemaInfo?.autofilter,
        context,
        scopeName,
        injectMissing: true,
        api,
        helpers,
        scopes,
        vars,
        log
      })
    })

    addHook('beforeProcessingPut', 'autofilter-stamp-put', {}, async ({ context, scopeName }) => {
      await enforceScopedInput({
        compiledConfig: scopes[scopeName]?.vars?.schemaInfo?.autofilter,
        context,
        scopeName,
        injectMissing: true,
        api,
        helpers,
        scopes,
        vars,
        log
      })
    })

    addHook('beforeProcessingPatch', 'autofilter-validate-patch', { batch: true }, async ({ context, scopeName }) => {
      await enforceScopedInput({
        compiledConfig: scopes[scopeName]?.vars?.schemaInfo?.autofilter,
        context,
        scopeName,
        injectMissing: false,
        api,
        helpers,
        scopes,
        vars,
        log
      })
    })

    // Batch form of autofilter-stamp-post: resolve each owner value once, stamp every row.
    addHook('beforeProcessingPostMany', 'autofilter-stamp-post-many', {}, async ({ context, scopeName }) => {
      const compiledConfig = scopes[scopeName]?.vars?.schemaInfo?.autofilter
      if (!compiledConfig || compiledConfig.filters.length === 0) return
      assertGenuineSystemFlag(context)
      if (isSystemContext(context)) {
        context.inputRecords.forEach((inputRecord, index) => requireExplicitOwnership({ compiledConfig, inputRecord, scopeName, index }))
        return
      }
      for (const filter of compiledConfig.filters) {
        const resolvedValue = await resolveFilterValue({ filter, context, scopeName, api, helpers, scopes, vars, log })
        if (resolvedValue === undefined) continue
        refuseSharedCreate({ filter, resolvedValue, scopeName })
        for (const inputRecord of context.inputRecords) {
          applyResolvedInputValue({ context: { inputRecord }, filter, resolvedValue, injectMissing: true })
        }
      }
    })

    // Shared rows are readable by every owner but writable only in a system context.
    const refuseSharedRowWrite = ({ context, scopeName }) => {
      const compiledConfig = scopes[scopeName]?.vars?.schemaInfo?.autofilter
      const sharedFilters = compiledConfig?.filters.filter(filter => filter.shared) || []
      if (!sharedFilters.length || !context.minimalRecord || isSystemContext(context)) return
      for (const filter of sharedFilters) {
        if (sharedFieldValue(context.minimalRecord, filter) === null) {
          throw new RestApiResourceError(`Shared ${scopeName} records can only be changed in a system context`, {
            subtype: 'forbidden', resourceType: scopeName, resourceId: context.id
          })
        }
      }
    }
    addHook('beforeDataCallPatch', 'autofilter-shared-row-patch', { batch: true }, refuseSharedRowWrite)
    addHook('beforeDataCallPut', 'autofilter-shared-row-put', { batch: true }, refuseSharedRowWrite)
    addHook('beforeDataCallDelete', 'autofilter-shared-row-delete', { batch: true }, refuseSharedRowWrite)

    api.autofilter = {
      getConfig: () => ({
        presets: Object.keys(state.presets),
        resolvers: Object.keys(state.resolvers)
      }),

      getScopeConfig: (scopeName) => {
        const compiledConfig = scopes[scopeName]?.vars?.schemaInfo?.autofilter
        if (!compiledConfig) return null

        return {
          preset: compiledConfig.preset,
          filters: compiledConfig.filters.map((filter) => ({
            field: filter.field,
            resolver: filter.resolverName,
            required: filter.required,
            shared: filter.shared
          }))
        }
      }
    }

    log.info('AutoFilter plugin installed', {
      presets: Object.keys(state.presets),
      resolvers: Object.keys(state.resolvers)
    })
  }
}
