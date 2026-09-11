// @ts-check
import { isImmediateExpression } from '../querying-writing/query-field-helpers.js'
/**
 * Add logical field selections to an unexecuted builder, using the caller's translator.
 * `*` retains wildcard behavior. Aliases are null when table prefixing is disabled.
 * @param {import('../storage/storage-types.js').StorageQuery} query
 * @param {string} tableName
 * @param {readonly string[] | string} fieldsToSelect
 * @param {boolean} [useTablePrefix]
 * @param {{ translateColumn?: (field: string, alias?: string | null) => string | import('knex').Knex.Raw<unknown> | Record<string, string | import('knex').Knex.Raw<unknown>> | null | undefined }} [options]
 * @returns {import('../storage/storage-types.js').StorageQuery}
 */
export const buildQuerySelection = (
  query,
  tableName,
  fieldsToSelect,
  useTablePrefix = false,
  options = {}
) => {
  const translateColumn = options.translateColumn

  /** @param {string} field @param {string | null} aliasForField */
  const applyTranslation = (field, aliasForField) => {
    if (translateColumn) {
      const translated = translateColumn(field, aliasForField)
      if (translated) {
        return translated
      }
    }

    if (aliasForField) {
      return `${aliasForField}.${field}`
    }
    return field
  }

  const targetAlias = useTablePrefix ? tableName : null

  if (fieldsToSelect === '*') {
    const translated = translateColumn ? translateColumn('*', targetAlias) : null
    if (translated) {
      return query.select(translated)
    }
    return useTablePrefix ? query.select(`${tableName}.*`) : query
  }

  /** @type {readonly string[]} */
  const fieldsArray = Array.isArray(fieldsToSelect)
    ? fieldsToSelect
    : Array.from(fieldsToSelect || [])

  const translatedFields = fieldsArray.map((field) => {
    if (typeof field !== 'string') return field

    const aliasMatch = field.match(/\s+as\s+/i)
    if (aliasMatch) {
      const [source = '', alias = ''] = field.split(/\s+as\s+/i)
      const translatedSource = applyTranslation(source.trim(), targetAlias)
      if (typeof translatedSource !== 'string') {
        if (isImmediateExpression(translatedSource)) return { [alias.trim()]: translatedSource }
        const values = Object.values(translatedSource)
        if (values.length !== 1 || values[0] === undefined) {
          throw new Error(`Cannot apply alias '${alias.trim()}' to a translation containing multiple or missing expressions`)
        }
        return { [alias.trim()]: values[0] }
      }
      return `${translatedSource} as ${alias.trim()}`
    }

    return applyTranslation(field.trim(), targetAlias)
  })

  return query.select(translatedFields)
}
