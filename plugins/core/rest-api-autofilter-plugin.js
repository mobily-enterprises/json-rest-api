import { RestApiValidationError } from '../../lib/rest-api-errors.js'
import { createStorageAdapterUtilities } from './lib/querying/storage-adapter-utils.js'

const PUBLIC_PRESET_NAME = 'public'

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
  const normalized = {}

  for (const [name, resolver] of Object.entries(resolverMap)) {
    if (typeof resolver !== 'function') {
      throw new Error(`AutoFilter resolver '${name}' must be a function.`)
    }
    normalized[name] = resolver
  }

  return normalized
}

function getPresetFilters (presetName, presets) {
  const preset = presets[presetName]

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

  const fieldDef = schemaStructure[field]
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
    resolve = resolvers[resolverDef]
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

  return {
    field,
    fieldDef,
    resolve,
    resolverName,
    required: filterDef.required !== false,
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

async function enforceScopedInput ({ compiledConfig, context, scopeName, injectMissing, api, helpers, scopes, vars, log }) {
  if (!compiledConfig || compiledConfig.filters.length === 0) return

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
  dependencies: ['rest-api', 'rest-api-knex|rest-api-anyapi-knex'],

  install ({ api, addHook, vars, helpers, log, scopes, pluginOptions = {} }) {
    if (!api.knex?.instance) {
      throw new Error('AutoFilterPlugin requires a storage plugin with knex support (rest-api-knex or rest-api-anyapi-knex).')
    }

    const state = {
      resolvers: ensureResolverMap(pluginOptions.resolvers || {}),
      presets: {
        [PUBLIC_PRESET_NAME]: { filters: [] },
        ...(pluginOptions.presets || {})
      }
    }

    vars.autofilter = {
      presets: Object.keys(state.presets),
      resolvers: Object.keys(state.resolvers)
    }

    addHook('scope:added', 'compile-autofilter', {}, ({ context }) => {
      const { scopeName, scopeOptions = {} } = context
      const scope = scopes[scopeName]
      const schemaStructure = scope?.vars?.schemaInfo?.schemaStructure || scopeOptions.schema || {}

      scope.vars.autofilter = compileAutoFilterDefinition({
        scopeName,
        scopeOptions,
        schemaStructure,
        resolvers: state.resolvers,
        presets: state.presets
      })
    })

    addHook('knexQueryFiltering', 'autofilter-scope', {}, async ({ context }) => {
      const { query, tableName, scopeName } = context.knexQuery || {}
      if (!query || !scopeName) return

      const compiledConfig = scopes[scopeName]?.vars?.autofilter
      if (!compiledConfig || compiledConfig.filters.length === 0) return
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

        if (translatedValue === null) {
          query.whereNull(columnRef)
        } else {
          query.where(columnRef, translatedValue)
        }
      }
    })

    addHook('beforeProcessingPost', 'autofilter-stamp-post', {}, async ({ context, scopeName }) => {
      await enforceScopedInput({
        compiledConfig: scopes[scopeName]?.vars?.autofilter,
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
        compiledConfig: scopes[scopeName]?.vars?.autofilter,
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

    addHook('beforeProcessingPatch', 'autofilter-validate-patch', {}, async ({ context, scopeName }) => {
      await enforceScopedInput({
        compiledConfig: scopes[scopeName]?.vars?.autofilter,
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

    api.autofilter = {
      getConfig: () => ({
        presets: Object.keys(state.presets),
        resolvers: Object.keys(state.resolvers)
      }),

      getScopeConfig: (scopeName) => {
        const compiledConfig = scopes[scopeName]?.vars?.autofilter
        if (!compiledConfig) return null

        return {
          preset: compiledConfig.preset,
          filters: compiledConfig.filters.map((filter) => ({
            field: filter.field,
            resolver: filter.resolverName,
            required: filter.required
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
