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

export const translateCanonicalRecordFromStorage = (row = {}, descriptor = {}) => {
  const attributes = {}

  for (const [slot, logical] of Object.entries(descriptor.reverseAttributes || {})) {
    if (slot in row) {
      attributes[logical] = row[slot]
    }
  }

  const relationships = {}

  for (const [alias, info] of Object.entries(descriptor.belongsTo || {})) {
    const idValue = row[info.idColumn]
    const relationshipData = idValue == null
      ? null
      : { type: info.target, id: String(idValue) }

    relationships[alias] = { data: relationshipData }
  }

  for (const [alias, info] of Object.entries(descriptor.polymorphicBelongsTo || {})) {
    const typeValue = info.typeColumn ? row[info.typeColumn] : null
    const idValue = info.idColumn ? row[info.idColumn] : null

    let relationshipData = null
    if (typeValue != null && idValue != null) {
      relationshipData = {
        type: String(typeValue),
        id: String(idValue),
      }
    }

    relationships[alias] = { data: relationshipData }
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
