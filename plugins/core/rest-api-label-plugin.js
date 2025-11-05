export const LabelPlugin = {
  name: 'rest-api-label',
  dependencies: ['rest-api'],

  /**
   * Install the label plugin (adds a computed 'label' attribute to all resources)
   * @param {object} deps Injected dependencies from json-rest-api
   * @param {function} deps.addHook - Register hooks
   * @param {object} deps.pluginOptions - Plugin options
   */
  async install ({ addHook, pluginOptions = {} }) {
    const opts = {
      preferNameFields: ['name', 'title'],
      disable: false,
      ...pluginOptions
    }

    function pickLabelFieldFromFields (fields, searchSchema) {
      const byGlobal = Object.keys(searchSchema || {}).find(k => searchSchema[k]?.globalSearch)
      if (byGlobal) return byGlobal
      for (const key of opts.preferNameFields) {
        if (fields?.[key]?.type === 'string') return key
      }
      const firstString = Object.entries(fields || {}).find(([_, def]) => def?.type === 'string')?.[0]
      if (firstString) return firstString
      return null
    }

    // Inject as a computed field AFTER schemas are compiled,
    // so it lives in schemaInfo.computed and not in schemaStructure
    addHook(
      'scope:added',
      'rest-api-label:inject-computed',
      { afterFunction: 'compileResourceSchemas' },
      ({ context, scopes }) => {
        if (opts.disable) return
        const { scopeName } = context
        const scope = scopes?.[scopeName]
        const schemaInfo = scope?.vars?.schemaInfo
        if (!schemaInfo) return

        // Respect explicit label already defined by resource
        if (schemaInfo.computed?.label || schemaInfo.schemaStructure?.label) {
          // If label accidentally made it into schemaStructure, remove it
          if (schemaInfo.schemaStructure?.label) delete schemaInfo.schemaStructure.label
          return
        }

        const structure = schemaInfo.schemaStructure || {}
        const searchStruct = schemaInfo.searchSchemaStructure || {}
        const idProp = schemaInfo.idProperty || 'id'

        const pick = pickLabelFieldFromFields(structure, searchStruct)

        schemaInfo.computed = schemaInfo.computed || {}
        schemaInfo.computed.label = {
          type: 'string',
          computed: true,
          ...(pick ? { dependencies: [pick] } : {}),
          compute: ({ attributes }) => {
            if (pick) {
              const v = attributes?.[pick]
              if (v != null) return String(v)
            }
            for (const k of opts.preferNameFields) {
              if (attributes?.[k] != null) return String(attributes[k])
            }
            return String(attributes?.[idProp] ?? '')
          }
        }
      }
    )
  }
}
