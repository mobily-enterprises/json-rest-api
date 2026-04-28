export const translateCanonicalAttributesForStorage = (attributes = {}, descriptor = {}) => {
  const row = {}

  for (const [fieldName, value] of Object.entries(attributes)) {
    const slot = descriptor.fields?.[fieldName]
    if (!slot) continue

    if (slot.slotType === 'belongsTo') {
      row[slot.slot] = value == null ? null : String(value)
    } else {
      row[slot.slot] = value
    }

    if (slot.slotType === 'belongsTo') {
      const alias = slot.alias || descriptor.fields?.[fieldName]?.alias
      const belongsToInfo = alias ? descriptor.belongsTo?.[alias] : null
      if (belongsToInfo) {
        row[belongsToInfo.typeColumn] = value == null ? null : belongsToInfo.target
      }
    }
  }

  return row
}

export const translateCanonicalRecordFromStorage = (row = {}, descriptor = {}, options = {}) => {
  const attributes = {}
  const consumedColumns = new Set(['id'])
  const allowedExtraFields = new Set(options.allowedExtraFields || [])

  for (const [slot, logical] of Object.entries(descriptor.reverseAttributes || {})) {
    if (slot in row) {
      attributes[logical] = row[slot]
      consumedColumns.add(slot)
    }
  }

  const relationships = {}

  for (const [alias, info] of Object.entries(descriptor.belongsTo || {})) {
    const idValue = row[info.idColumn]
    consumedColumns.add(info.idColumn)
    if (info.typeColumn) {
      consumedColumns.add(info.typeColumn)
    }
    const relationshipData = idValue == null
      ? null
      : { type: info.target, id: String(idValue) }

    relationships[alias] = { data: relationshipData }
  }

  for (const [alias, info] of Object.entries(descriptor.polymorphicBelongsTo || {})) {
    const typeValue = info.typeColumn ? row[info.typeColumn] : null
    const idValue = info.idColumn ? row[info.idColumn] : null
    if (info.typeColumn) {
      consumedColumns.add(info.typeColumn)
    }
    if (info.idColumn) {
      consumedColumns.add(info.idColumn)
    }

    let relationshipData = null
    if (typeValue != null && idValue != null) {
      relationshipData = {
        type: String(typeValue),
        id: String(idValue),
      }
    }

    relationships[alias] = { data: relationshipData }
  }

  const canonical = descriptor.canonical || {}
  const internalColumns = new Set([
    canonical.tenantColumn,
    canonical.resourceColumn,
    'created_at',
    'updated_at',
    'deleted_at'
  ].filter(Boolean))

  for (const [columnName, value] of Object.entries(row)) {
    if (consumedColumns.has(columnName) || internalColumns.has(columnName)) {
      continue
    }
    if (!allowedExtraFields.has(columnName)) {
      continue
    }
    attributes[columnName] = value
  }

  return { attributes, relationships }
}

export const getCanonicalFieldValue = (row, descriptor = {}, fieldName) => {
  if (!row || !fieldName) return undefined

  if (fieldName === 'id') {
    return row.id
  }

  const fieldInfo = descriptor.fields?.[fieldName]
  if (fieldInfo?.slot && Object.hasOwn(row, fieldInfo.slot)) {
    return row[fieldInfo.slot]
  }

  if (Object.hasOwn(row, fieldName)) {
    return row[fieldName]
  }

  return undefined
}
