import { assertScalarQueryField } from '../querying-writing/field-utils.js'
import { normalizeStableSort, parseSortEntry } from './sort-helpers.js'
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { createSchemaFactory } from 'json-rest-schema'
import { normalizeDateValue } from '../querying-writing/database-value-normalizers.js'

const cursorContractCache = new WeakMap()

function getCursorContract (schema, definition) {
  let cache = cursorContractCache.get(schema)
  if (!cache) {
    cache = {
      factory: createSchemaFactory({ types: schema.types, validators: schema.validators, installCore: false }),
      contracts: new Map()
    }
    cursorContractCache.set(schema, cache)
  }
  // Unusual/invalid declarations retain schema validation without lossy JSON keys.
  if (typeof definition.type !== 'string' ||
      (definition.temporalPrecision !== undefined && !Number.isInteger(definition.temporalPrecision))) {
    return cache.factory({ value: definition })
  }
  const key = JSON.stringify(definition)
  if (!cache.contracts.has(key)) cache.contracts.set(key, cache.factory({ value: definition }))
  return cache.contracts.get(key)
}

export const validateCursorValues = (descriptors, cursorValues, parameter, schema) => {
  const validated = Object.create(null)
  for (const { field, definition = {}, isRelationship, queryFieldRuntime } of descriptors) {
    if (!Object.hasOwn(cursorValues, field)) continue
    const value = cursorValues[field]
    // Public resource IDs may be opaque strings, even when the storage schema
    // uses the numeric id type for ordinary attributes.
    const type = field === 'id' || isRelationship || definition?.type === 'id'
      ? 'string'
      : definition?.type
    if (!type) {
      validated[field] = value
      continue
    }
    const contract = getCursorContract(schema, {
      type,
      noTrim: true,
      nullable: field !== 'id',
      ...(definition?.temporalPrecision !== undefined
        ? { temporalPrecision: definition.temporalPrecision }
        : {})
    })
    let validationValue = value
    let invalidStorageValue = false
    const storedTemporal = Boolean(queryFieldRuntime || definition.storage?.serialize) && ['date', 'dateTime', 'time'].includes(type)
    if (storedTemporal && value !== null) {
      try {
        validationValue = normalizeDateValue(value, type, { temporalPrecision: definition.temporalPrecision, fieldName: field, source: 'cursor' })
      } catch {
        invalidStorageValue = true
      }
    }
    const { validatedObject, errors } = contract.patch({ value: validationValue })
    if (invalidStorageValue || Object.keys(errors).length > 0 || (field === 'id' && !String(value ?? '').trim())) {
      const path = `page.${parameter}`
      throw new RestApiValidationError(`Invalid cursor value for sort field '${field}'.`, {
        fields: [path],
        violations: [{ field: path, rule: 'invalid_cursor_value', message: `Invalid ${type} value for '${field}'.` }]
      })
    }
    // Preserve temporal SQL spelling, but bind epochs and scalar numbers as
    // numbers: SQLite expressions have no column affinity to coerce strings.
    validated[field] = storedTemporal
      ? (typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value)
      : validatedObject.value
  }
  return validated
}

export const resolveSortField = (field, schemaInfo = {}) => {
  if (field === 'id' || Object.hasOwn(schemaInfo.schemaStructure || {}, field) || Object.hasOwn(schemaInfo.queryFields || {}, field)) return field
  return schemaInfo.searchSchemaStructure?.[field]?.actualField || field
}

export const getEffectiveSortableFields = (vars = {}) => {
  const schema = vars.schemaInfo?.schemaStructure || {}
  const baseSortableFields = Array.isArray(vars.sortableFields) && vars.sortableFields.length > 0
    ? vars.sortableFields
    : ['id', ...Object.keys(schema).filter((field) => {
        const definition = schema[field]
        return !definition.hidden && !definition.virtual && !definition.computed && !definition.belongsToPolymorphic
      }), ...Object.entries(vars.schemaInfo?.searchSchemaStructure || {})
        .filter(([, definition]) => definition.isRelationship && schema[definition.actualField]?.hidden !== true)
        .map(([field]) => field)]
  const queryFieldSortableFields = Object.entries(vars.schemaInfo?.queryFields || {})
    .filter(([, fieldDef]) => fieldDef?.sortable === true)
    .map(([fieldName]) => fieldName)

  return Array.from(new Set([...baseSortableFields, ...queryFieldSortableFields])).filter(field => {
    const actualField = resolveSortField(field, vars.schemaInfo)
    const queryFields = vars.schemaInfo?.queryFields || {}
    const definition = Object.hasOwn(queryFields, actualField) ? queryFields[actualField] : schema[actualField]
    return definition?.hidden !== true && !['object', 'array'].includes(definition?.type)
  })
}

export const buildEffectiveSortList = (sort, { defaultSort, idField = 'id', schemaInfo } = {}) => {
  const toList = (value, option) => {
    if (value === undefined || value === null) return []
    const list = Array.isArray(value) ? [...value] : [value]
    if (list.some(entry => typeof entry !== 'string')) throw new Error(`${option} must be a string or an array of strings, such as ['-name', 'id'].`)
    return list
  }
  let sortList = toList(sort, 'sort')
  if (sortList.length === 0) sortList = toList(defaultSort, 'defaultSort')

  const normalized = normalizeStableSort(sortList.length > 0 ? sortList : [idField], { idField })
  for (const entry of normalized) {
    const { field } = parseSortEntry(entry)
    const actualField = resolveSortField(field, schemaInfo)
    const queryFields = schemaInfo?.queryFields || {}
    const definition = Object.hasOwn(queryFields, actualField) ? queryFields[actualField] : schemaInfo?.schemaStructure?.[actualField]
    if (definition?.hidden === true) {
      throw new RestApiValidationError(`Hidden field '${field}' cannot be used for sorting.`, {
        fields: [field],
        violations: [{ field, rule: 'hidden_sort', message: 'Sort fields must be publicly readable because their values may appear in cursors.' }]
      })
    }
    assertScalarQueryField(definition, field, 'sort')
  }
  return normalized
}

export const applyQueryFieldOrder = (query, queryFieldRuntime, direction, nulls = 'last') => {
  if (['pg', 'postgresql'].includes(query.client.config.client)) {
    // The selected alias also avoids different bound parameter numbers under DISTINCT.
    query.orderBy(queryFieldRuntime.fieldName, direction, nulls)
    return
  }
  if (['better-sqlite3', 'sqlite3'].includes(query.client.config.client)) {
    const order = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    query.orderByRaw(`(${queryFieldRuntime.sql}) ${order} NULLS ${nulls === 'last' ? 'LAST' : 'FIRST'}`, queryFieldRuntime.bindings)
    return
  }
  query.orderByRaw(`(${queryFieldRuntime.sql}) IS NULL ${nulls === 'last' ? 'ASC' : 'DESC'}`, queryFieldRuntime.bindings)
  query.orderByRaw(`(${queryFieldRuntime.sql}) ${direction}`, queryFieldRuntime.bindings)
}

export const applyColumnOrder = (query, column, direction, nulls = 'last') => {
  if (['pg', 'postgresql'].includes(query.client.config.client)) {
    query.orderBy(column, direction, nulls)
  } else if (['better-sqlite3', 'sqlite3'].includes(query.client.config.client)) {
    // Native null placement lets SQLite use the column's ordering index.
    const order = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    query.orderByRaw(`?? ${order} NULLS ${nulls === 'last' ? 'LAST' : 'FIRST'}`, [column])
  } else {
    query.orderByRaw(`?? IS NULL ${nulls === 'last' ? 'ASC' : 'DESC'}`, [column])
    query.orderBy(column, direction)
  }
}

// Both storage modes use the same cursor direction and null placement.
export const applySortDescriptorOrder = (query, { column, queryFieldRuntime, direction }, { before = false } = {}) => {
  const ascending = String(direction).toLowerCase() === 'asc'
  const queryDirection = (before ? !ascending : ascending) ? 'asc' : 'desc'
  const nulls = before ? 'first' : 'last'
  if (queryFieldRuntime) {
    applyQueryFieldOrder(query, queryFieldRuntime, queryDirection.toUpperCase(), nulls)
  } else {
    applyColumnOrder(query, column, queryDirection, nulls)
  }
}

export const applyQueryFieldPredicate = (builder, queryFieldRuntime, operator, value) => {
  builder.whereRaw(`(${queryFieldRuntime.sql}) ${operator} ?`, [...queryFieldRuntime.bindings, value])
}

export const applySortDescriptorPredicate = (builder, descriptor, operator, value, applyPlainPredicate, includeNull = false) => {
  if (includeNull) {
    return builder.where(function () {
      applySortDescriptorPredicate(this, descriptor, operator, value, applyPlainPredicate)
      if (descriptor.queryFieldRuntime) {
        this.orWhereRaw(`(${descriptor.queryFieldRuntime.sql}) IS NULL`, descriptor.queryFieldRuntime.bindings)
      } else {
        this.orWhereNull(descriptor.column)
      }
    })
  }
  if (value === null) {
    const isNotNull = operator === 'IS NOT NULL'
    if (descriptor.queryFieldRuntime) {
      return builder.whereRaw(`(${descriptor.queryFieldRuntime.sql}) IS ${isNotNull ? 'NOT ' : ''}NULL`, descriptor.queryFieldRuntime.bindings)
    }
    return isNotNull ? builder.whereNotNull(descriptor.column) : builder.whereNull(descriptor.column)
  }
  if (descriptor.definition?.storage?.serialize) {
    return builder.where(descriptor.column, operator, value)
  }
  if (descriptor?.queryFieldRuntime) {
    return applyQueryFieldPredicate(builder, descriptor.queryFieldRuntime, operator, value)
  }

  return applyPlainPredicate(builder, descriptor, operator, value)
}

export const buildCursorPredicateChains = (
  descriptors,
  cursorValues,
  operatorSelector,
  { onMissingValue } = {}
) => {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    return []
  }

  const predicateChains = []

  descriptors.forEach((descriptor, index) => {
    const cursorValue = cursorValues?.[descriptor.field]

    if (cursorValue === undefined) {
      onMissingValue?.(descriptor.field)
      throw new RestApiValidationError(`Cursor is missing a value for sort field '${descriptor.field}'.`, {
        fields: [descriptor.field],
        violations: [{
          field: descriptor.field,
          rule: 'missing_cursor_value',
          message: 'Cursor must include every sort field.'
        }]
      })
    }

    const operator = operatorSelector(descriptor.direction)
    const forward = operator === (descriptor.direction.toUpperCase() === 'DESC' ? '<' : '>')
    // Nulls sort last. There are no values after null at this sort position,
    // but later tie breakers can still advance within the null group.
    if (cursorValue === null && forward) return

    const chain = []
    for (let i = 0; i < index; i += 1) {
      const previousDescriptor = descriptors[i]
      const previousValue = cursorValues?.[previousDescriptor.field]

      chain.push({
        descriptor: previousDescriptor,
        operator: '=',
        value: previousValue
      })
    }

    chain.push({
      descriptor,
      operator: cursorValue === null ? 'IS NOT NULL' : operator,
      value: cursorValue,
      includeNull: cursorValue !== null && forward
    })

    predicateChains.push(chain)
  })

  return predicateChains
}

export const applyCursorPredicate = (
  query,
  descriptors,
  cursorValues,
  operatorSelector,
  applyPlainPredicate,
  { onMissingValue } = {}
) => {
  const predicateChains = buildCursorPredicateChains(
    descriptors,
    cursorValues,
    operatorSelector,
    { onMissingValue }
  )

  if (predicateChains.length === 0) {
    return false
  }

  query.where(function () {
    predicateChains.forEach((chain) => {
      this.orWhere(function () {
        chain.forEach(({ descriptor, operator, value, includeNull }) => {
          applySortDescriptorPredicate(
            this,
            descriptor,
            operator,
            value,
            applyPlainPredicate,
            includeNull
          )
        })
      })
    })
  })

  return true
}

export { parseSortEntry }
