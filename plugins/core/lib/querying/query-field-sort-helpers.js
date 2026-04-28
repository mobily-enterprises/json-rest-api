import { normalizeStableSort, parseSortEntry } from './sort-helpers.js'

export const getEffectiveSortableFields = (vars = {}) => {
  const baseSortableFields = Array.isArray(vars.sortableFields)
    ? vars.sortableFields
    : []
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

export const applyQueryFieldOrder = (query, queryFieldRuntime, direction) => {
  query.orderByRaw(`(${queryFieldRuntime.sql}) ${direction}`, queryFieldRuntime.bindings)
}

export const applyQueryFieldPredicate = (builder, queryFieldRuntime, operator, value) => {
  builder.whereRaw(`(${queryFieldRuntime.sql}) ${operator} ?`, [...queryFieldRuntime.bindings, value])
}

export const applySortDescriptorPredicate = (builder, descriptor, operator, value, applyPlainPredicate) => {
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
      return
    }

    const chain = []
    for (let i = 0; i < index; i += 1) {
      const previousDescriptor = descriptors[i]
      const previousValue = cursorValues?.[previousDescriptor.field]

      if (previousValue === undefined) {
        onMissingValue?.(previousDescriptor.field)
        return
      }

      chain.push({
        descriptor: previousDescriptor,
        operator: '=',
        value: previousValue
      })
    }

    chain.push({
      descriptor,
      operator: operatorSelector(descriptor.direction),
      value: cursorValue
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
        chain.forEach(({ descriptor, operator, value }) => {
          applySortDescriptorPredicate(
            this,
            descriptor,
            operator,
            value,
            applyPlainPredicate
          )
        })
      })
    })
  })

  return true
}

export { parseSortEntry }
