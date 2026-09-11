import { getForeignKeyFields } from './lib/querying-writing/field-utils.js'

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

    function labelFields (fields, searchSchema, idProperty, relationships) {
      const relationshipFields = getForeignKeyFields(fields, relationships)
      const publicField = name => {
        const field = fields[name]
        return Object.hasOwn(fields, name) && name !== idProperty && !relationshipFields.has(name) && !field.hidden && !field.normallyHidden && !field.virtual
      }
      const byGlobal = Object.entries(searchSchema || {})
        .filter(([, field]) => field.globalSearch)
        .map(([name, field]) => field.actualField || name)
        .find(publicField)
      const strings = Object.keys(fields).filter(name => publicField(name) && fields[name].type === 'string')
      return [...new Set([byGlobal, ...opts.preferNameFields.filter(name => strings.includes(name)), strings[0]].filter(Boolean))]
    }

    addHook(
      'computedSchema:enrich',
      'rest-api-label:inject-computed',
      {},
      ({ context }) => {
        if (opts.disable) return
        const { fields, schemaStructure, searchSchemaStructure, schemaRelationships, idProperty } = context

        // Respect explicit label already defined by resource
        if (Object.hasOwn(fields, 'label') || Object.hasOwn(schemaStructure, 'label')) return

        const candidates = labelFields(schemaStructure, searchSchemaStructure, idProperty, schemaRelationships)

        fields.label = {
          type: 'string',
          computed: true,
          dependencies: candidates,
          compute: ({ attributes, id }) => {
            for (const field of candidates) {
              if (attributes?.[field] != null) return String(attributes[field])
            }
            return String(id ?? '')
          }
        }
      }
    )
  }
}
