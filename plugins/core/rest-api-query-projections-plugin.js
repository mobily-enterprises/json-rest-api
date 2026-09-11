import { formatDiagnosticValue } from '../../lib/error-formatter.js'
import { assertFieldNameMap } from './lib/querying-writing/field-utils.js'

export const QueryProjectionsPlugin = {
  name: 'query-projections',
  dependencies: ['rest-api'],

  install ({ addHook, log }) {
    const stripQueryFieldInput = async ({ context, scopeName, scope, scopes }) => {
      const inputAttributes = context?.inputRecord?.data?.attributes
      const queryFields = scopes?.[scopeName]?.vars?.schemaInfo?.queryFields || scope?.vars?.schemaInfo?.queryFields || {}

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
        // This warning is advisory; a failing sink must not reject the write.
        try {
          await log?.warn?.('Query projection input fields ignored', formatDiagnosticValue({
            operation: context.method,
            scopeName,
            phase: 'beforeSchemaValidate',
            fieldCount: stripped.length,
            fields: stripped
          }))
        } catch {}
      }
    }

    addHook('schema:enrich', 'declare-query-projections', {}, ({ context }) => {
      const fields = context.scopeOptions.queryFields ?? {}
      assertFieldNameMap(fields, `query fields in '${context.scopeName}'`)
      context.queryFields = fields && typeof fields === 'object' && !Array.isArray(fields) ? { ...fields } : fields
    })

    addHook('beforeSchemaValidate', 'strip-query-field-input', {}, stripQueryFieldInput)
  }
}
