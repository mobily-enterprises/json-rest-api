export const QueryProjectionsPlugin = {
  name: 'query-projections',
  dependencies: ['rest-api'],

  install ({ addHook, log }) {
    const normalizeQueryFields = ({ scopeName, scopeOptions = {} }) => {
      const schema = scopeOptions.schema || {}
      const relationships = scopeOptions.relationships || {}
      const rawQueryFields = scopeOptions.queryFields || {}
      const normalized = {}
      const reservedNames = new Set(Object.keys(schema))

      if (!rawQueryFields || typeof rawQueryFields !== 'object' || Array.isArray(rawQueryFields)) {
        throw new Error(`Invalid queryFields configuration for scope '${scopeName}'. Expected an object.`)
      }

      for (const relName of Object.keys(relationships)) {
        reservedNames.add(relName)
      }

      for (const fieldDef of Object.values(schema)) {
        if (fieldDef?.belongsTo && fieldDef?.as) {
          reservedNames.add(fieldDef.as)
        }
      }

      for (const [fieldName, fieldDef] of Object.entries(rawQueryFields)) {
        if (!fieldDef || typeof fieldDef !== 'object' || Array.isArray(fieldDef)) {
          throw new Error(`Query field '${fieldName}' in scope '${scopeName}' must be an object.`)
        }

        if (reservedNames.has(fieldName)) {
          throw new Error(`Query field '${fieldName}' in scope '${scopeName}' conflicts with an existing schema or relationship name.`)
        }

        if (!fieldDef.type) {
          throw new Error(`Query field '${fieldName}' in scope '${scopeName}' must have a type.`)
        }

        const select = fieldDef.select || fieldDef.project
        if (typeof select !== 'function') {
          throw new Error(`Query field '${fieldName}' in scope '${scopeName}' must define a select() function.`)
        }

        normalized[fieldName] = {
          ...fieldDef,
          select,
          sortable: fieldDef.sortable === true,
          hidden: fieldDef.hidden === true,
          normallyHidden: fieldDef.normallyHidden === true
        }
      }

      return normalized
    }

    const stripQueryFieldInput = ({ context, scopeName, scope, scopes }) => {
      const inputAttributes = context?.inputRecord?.data?.attributes
      const queryFields = scopes?.[scopeName]?.vars?.queryFields || scope?.vars?.queryFields || {}

      if (!inputAttributes || typeof inputAttributes !== 'object' || Array.isArray(inputAttributes)) {
        return
      }

      const stripped = []
      for (const fieldName of Object.keys(queryFields)) {
        if (Object.hasOwn(inputAttributes, fieldName)) {
          delete inputAttributes[fieldName]
          stripped.push(fieldName)
        }
      }

      if (stripped.length > 0) {
        const message = `Query fields [${stripped.join(', ')}] were sent in input for resource '${scopeName}' but will be ignored as they are query output only`
        if (typeof log?.warn === 'function') {
          log.warn(message)
        } else {
          console.warn(message)
        }
      }
    }

    const validateCompiledQueryFieldNamespace = ({ scopeName, scope, vars, scopes }) => {
      const activeScope = scope || scopes?.[scopeName]
      const scopeVars = vars || activeScope?.vars || {}
      const queryFields = scopeVars.queryFields || {}
      const schemaInfo = activeScope?.vars?.schemaInfo || scopeVars.schemaInfo || {}

      if (Object.keys(queryFields).length === 0) {
        return
      }

      const reservedNames = new Set([
        ...Object.keys(schemaInfo.schemaStructure || {}),
        ...Object.keys(schemaInfo.computed || {}),
        ...Object.keys(schemaInfo.schemaRelationships || {})
      ])

      for (const fieldDef of Object.values(schemaInfo.schemaStructure || {})) {
        if (fieldDef?.belongsTo && fieldDef?.as) {
          reservedNames.add(fieldDef.as)
        }
      }

      for (const fieldName of Object.keys(queryFields)) {
        if (reservedNames.has(fieldName)) {
          throw new Error(`Query field '${fieldName}' in scope '${scopeName}' conflicts with an existing schema, computed, or relationship name.`)
        }
      }
    }

    addHook('scope:added', 'compile-query-projections', { afterFunction: 'turnScopeInitIntoVars' }, ({ context, scopes }) => {
      const scopeName = context.scopeName
      const scope = scopes[scopeName]
      const vars = scope?.vars || {}
      const scopeOptions = scope?.scopeOptions || context.scopeOptions || {}
      const queryFields = normalizeQueryFields({ scopeName, scopeOptions })

      vars.queryFields = queryFields
      validateCompiledQueryFieldNamespace({ scopeName, scope, vars, scopes })

      log.debug(`Compiled query fields for '${scopeName}'`, {
        queryFields: Object.keys(queryFields),
        sortable: Object.keys(queryFields).filter((fieldName) => queryFields[fieldName].sortable === true)
      })
    })

    addHook('beforeSchemaValidate', 'strip-query-field-input', {}, stripQueryFieldInput)
  }
}
