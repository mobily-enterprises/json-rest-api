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
  const idProperty = descriptor.idProperty || 'id'
  if (field === 'id' || field === idProperty) {
    return {
      column: descriptor?.canonical?.logicalIdColumn || 'logical_id',
      definition: { type: 'id' }
    }
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
