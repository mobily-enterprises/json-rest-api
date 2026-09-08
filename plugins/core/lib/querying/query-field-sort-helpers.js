import { normalizeStableSort, parseSortEntry } from './sort-helpers.js'
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { createSchema } from 'json-rest-schema'
import { normalizeValueForDatabaseStorage } from '../querying-writing/database-value-normalizers.js'

export const validateCursorValues = (descriptors, cursorValues, parameter) => {
  const validated = Object.create(null)
  for (const { field, definition = {}, isRelationship } of descriptors) {
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
    const contract = createSchema({
      value: {
        type,
        noTrim: true,
        nullable: field !== 'id',
        ...(definition?.temporalPrecision !== undefined
          ? { temporalPrecision: definition.temporalPrecision }
          : {})
      }
    })
    const { validatedObject, errors } = contract.patch({ value })
    if (Object.keys(errors).length > 0 || (field === 'id' && !String(value ?? '').trim())) {
      const path = `page.${parameter}`
      throw new RestApiValidationError(`Invalid cursor value for sort field '${field}'.`, {
        fields: [path],
        violations: [{ field: path, rule: 'invalid_cursor_value', message: `Invalid ${type} value for '${field}'.` }]
      })
    }
    validated[field] = validatedObject.value
  }
  return validated
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
  const queryFieldSortableFields = Object.entries(vars.queryFields || {})
    .filter(([, fieldDef]) => fieldDef?.sortable === true)
    .map(([fieldName]) => fieldName)

  return Array.from(new Set([...baseSortableFields, ...queryFieldSortableFields]))
}

export const buildEffectiveSortList = (sort, { defaultSort, idField = 'id' } = {}) => {
  let sortList = Array.isArray(sort) ? [...sort] : (sort ? [sort] : [])

  if (sortList.length === 0 && defaultSort) {
    if (Array.isArray(defaultSort)) {
      sortList = [...defaultSort]
    } else if (typeof defaultSort === 'string') {
      sortList = [defaultSort]
    } else if (typeof defaultSort === 'object') {
      const field = defaultSort.field || defaultSort.column || idField
      const direction = (defaultSort.direction || '').toLowerCase() === 'desc' ? '-' : ''
      sortList = [`${direction}${field}`]
    }
  }

  return normalizeStableSort(sortList.length > 0 ? sortList : [idField], { idField })
}

export const applyQueryFieldOrder = (query, queryFieldRuntime, direction, nulls = 'last') => {
  query.orderByRaw(`(${queryFieldRuntime.sql}) IS NULL ${nulls === 'last' ? 'ASC' : 'DESC'}`, queryFieldRuntime.bindings)
  query.orderByRaw(`(${queryFieldRuntime.sql}) ${direction}`, queryFieldRuntime.bindings)
}

export const applyQueryFieldPredicate = (builder, queryFieldRuntime, operator, value) => {
  const definition = queryFieldRuntime.definition || {}
  const normalizedValue = normalizeValueForDatabaseStorage(value, definition.type, {
    temporalPrecision: definition.temporalPrecision
  })
  builder.whereRaw(`(${queryFieldRuntime.sql}) ${operator} ?`, [...queryFieldRuntime.bindings, normalizedValue])
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
