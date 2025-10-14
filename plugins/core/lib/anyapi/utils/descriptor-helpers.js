import { RestApiValidationError } from '../../../../../lib/rest-api-errors.js'

export const normalizeId = (value) => (value === null || value === undefined ? null : String(value))

export const findSchemaFieldByAlias = (descriptor, alias) => {
  if (!descriptor?.schema) return null
  for (const [fieldName, definition] of Object.entries(descriptor.schema)) {
    if (!definition) continue
    if (definition.as === alias) {
      return { fieldName, definition }
    }
    if (definition.belongsTo && !definition.as) {
      const inferredAlias = fieldName.endsWith('_id') ? fieldName.slice(0, -3) : fieldName
      if (inferredAlias === alias) {
        return { fieldName, definition }
      }
    }
  }
  return null
}

export const resolveFieldInfo = (descriptor, field) => {
  if (!descriptor) return null
  if (field === 'id') {
    return { column: 'id', definition: { type: 'id' } }
  }

  const directField = descriptor.fields?.[field]
  if (directField?.slot) {
    return {
      column: directField.slot,
      definition: descriptor.schema?.[field] || null,
    }
  }

  const belongsToInfo = descriptor.belongsTo?.[field]
  if (belongsToInfo?.idColumn) {
    const schemaField = findSchemaFieldByAlias(descriptor, field)
    return {
      column: belongsToInfo.idColumn,
      definition: schemaField?.definition || null,
      isRelationship: true,
    }
  }

  const aliasField = findSchemaFieldByAlias(descriptor, field)
  if (aliasField) {
    const fieldEntry = descriptor.fields?.[aliasField.fieldName]
    if (fieldEntry?.slot) {
      return {
        column: fieldEntry.slot,
        definition: aliasField.definition,
      }
    }
  }

  return null
}

export const coerceValueForDefinition = (value, definition, { isRelationship } = {}) => {
  if (value === null || value === undefined) return null

  if (isRelationship) {
    return normalizeId(value)
  }

  const type = definition?.type || definition?.dataType
  if (!type) {
    return value
  }

  if (['number', 'integer', 'float', 'decimal'].includes(type)) {
    const numeric = Number(value)
    return Number.isNaN(numeric) ? value : numeric
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true
      if (value.toLowerCase() === 'false') return false
    }
    return Boolean(value)
  }

  if (['string', 'text', 'uuid', 'email'].includes(type)) {
    return String(value)
  }

  return value
}

export const normalizeFilterValues = (rawValue, definition, options) => {
  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => coerceValueForDefinition(item, definition, options))
  }
  return [coerceValueForDefinition(rawValue, definition, options)]
}

export const ensureFilterableField = (descriptor, field) => {
  const fieldInfo = resolveFieldInfo(descriptor, field)
  if (!fieldInfo?.column) {
    throw new RestApiValidationError('Invalid filter field', {
      fields: [`filters.${field}`],
      violations: [{
        field: `filters.${field}`,
        rule: 'unknown_field',
        message: `Filter on '${field}' is not supported in AnyAPI mode`,
      }],
    })
  }
  return fieldInfo
}
