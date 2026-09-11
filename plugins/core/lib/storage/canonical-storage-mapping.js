// @ts-check
import { serializeFieldValueForStorage } from './storage-mapping.js'
import { getPolymorphicLinkage } from '../querying-writing/relationship-contracts.js'

/** @import { CanonicalDescriptor, StorageRow, StorageSchemaInfo, StorageWriteOptions } from './storage-types.js' */

/**
 * @param {StorageRow} [attributes]
 * @param {Partial<CanonicalDescriptor>} [descriptor]
 * @param {StorageWriteOptions & { schemaInfo?: Partial<StorageSchemaInfo> }} [options]
 * @returns {StorageRow}
 */
export const translateCanonicalAttributesForStorage = (attributes = {}, descriptor = {}, { schemaInfo, context = null, operation = null, databaseClient } = {}) => {
  /** @type {StorageRow} */
  const row = {}

  for (const [fieldName, value] of Object.entries(attributes)) {
    if (!descriptor.fields || !Object.hasOwn(descriptor.fields, fieldName)) continue
    const slot = descriptor.fields?.[fieldName]
    if (!slot) continue

    if (slot.slotType === 'belongsTo') {
      row[slot.slot] = value == null ? null : String(value)
    } else {
      const definition = schemaInfo?.schemaStructure?.[fieldName] || descriptor.schema?.[fieldName]
      const serialized = serializeFieldValueForStorage(value, {
        fieldName,
        columnName: slot.slot,
        definition,
        schemaInfo,
        context: context || { scopeName: descriptor.resource },
        operation,
        databaseClient,
        textStorage: slot.slotType === 'string'
      })
      row[slot.slot] = definition?.type === 'id' && serialized != null ? String(serialized) : serialized
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

/** @param {Partial<CanonicalDescriptor>} [descriptor] @returns {string} */
export const getCanonicalResourceIdColumn = (descriptor = {}) => (
  descriptor?.canonical?.logicalIdColumn || 'logical_id'
)

/** @param {StorageRow | null} [row] @param {Partial<CanonicalDescriptor>} [descriptor] @returns {string | null} */
export const getCanonicalResourceId = (row = {}, descriptor = {}) => {
  const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
  const logicalId = row?.[logicalIdColumn]

  if (logicalId !== undefined && logicalId !== null) {
    return String(logicalId)
  }

  if (row?.id !== undefined && row?.id !== null) {
    return String(row.id)
  }

  return null
}

/**
 * @param {StorageRow} [row]
 * @param {Partial<CanonicalDescriptor>} [descriptor]
 * @param {{ allowedExtraFields?: string[] }} [options]
 * @returns {{ attributes: StorageRow, relationships: Record<string, { data: { type: string, id: string } | null }> }}
 */
export const translateCanonicalRecordFromStorage = (row = {}, descriptor = {}, options = {}) => {
  /** @type {StorageRow} */
  const attributes = {}
  const logicalIdColumn = getCanonicalResourceIdColumn(descriptor)
  const consumedColumns = new Set(['id', logicalIdColumn])
  const allowedExtraFields = new Set(options.allowedExtraFields || [])

  for (const [slot, logical] of Object.entries(descriptor.reverseAttributes || {})) {
    if (slot in row) {
      attributes[logical] = row[slot]
      consumedColumns.add(slot)
    }
  }

  /** @type {Record<string, { data: { type: string, id: string } | null }>} */
  const relationships = {}

  for (const [alias, info] of Object.entries(descriptor.belongsTo || {})) {
    const backingField = descriptor.reverseAttributes?.[info.idColumn]
    if (backingField !== undefined) delete attributes[backingField]
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
    delete attributes[info.typeField]
    delete attributes[info.idField]
    const typeValue = info.typeColumn ? row[info.typeColumn] : null
    const idValue = info.idColumn ? row[info.idColumn] : null
    if (info.typeColumn) {
      consumedColumns.add(info.typeColumn)
    }
    if (info.idColumn) {
      consumedColumns.add(info.idColumn)
    }

    relationships[alias] = {
      data: getPolymorphicLinkage({
        type: typeValue,
        id: idValue,
        types: info.types,
        scopeName: descriptor.resource,
        relationshipName: alias
      })
    }
  }

  /** @type {Partial<CanonicalDescriptor['canonical']>} */
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

/** @param {StorageRow | null | undefined} row @param {Partial<CanonicalDescriptor>} descriptor @param {string} fieldName @returns {unknown} */
export const getCanonicalFieldValue = (row, descriptor = {}, fieldName) => {
  if (!row || !fieldName) return undefined

  const idProperty = descriptor.idProperty || 'id'
  if (fieldName === 'id' || fieldName === idProperty) {
    return getCanonicalResourceId(row, descriptor)
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
