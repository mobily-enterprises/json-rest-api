import { createSchema } from 'json-rest-schema'
import { getForeignKeyFields, assertFieldName, assertFieldNameMap } from './field-utils.js'

/**
 * Schema processing utilities for search and field dependencies
 *
 * @description
 * This module provides utilities for:
 * - Marking search fields as indexed for database optimization
 * - Generating search schemas from various configuration sources
 * - Sorting fields by their dependencies (for getters/setters)
 * - Detecting circular dependencies in field definitions
 */

/**
 * Mark object-valued search definitions indexed in place, overriding false.
 * This is search metadata, not a DDL operation or a query-performance guarantee.
 *
 * @param {Object} searchSchema - Search definitions, if available
 * @returns {void}
 * @example
 * const fields = { title: { type: 'string', indexed: false } }
 * ensureSearchFieldsAreIndexed(fields)
 * // fields.title.indexed === true
 */
export function ensureSearchFieldsAreIndexed (searchSchema) {
  if (!searchSchema) return

  Object.keys(searchSchema).forEach(fieldName => {
    const fieldDef = searchSchema[fieldName]
    if (fieldDef && typeof fieldDef === 'object') {
      // Mark the field as indexed for cross-table search support
      fieldDef.indexed = true
    }
  })
}

function createRelationshipSearchEntries (fieldName, fieldDef, searchEntry) {
  if (!fieldDef?.belongsTo || !fieldDef?.as) {
    return [[fieldName, searchEntry]]
  }

  const relationshipEntry = {
    ...searchEntry,
    actualField: fieldName,
    isRelationship: true,
    targetResource: fieldDef.belongsTo
  }

  return [
    [fieldDef.as, relationshipEntry],
    [fieldName, {
      ...relationshipEntry
    }]
  ]
}

function registerSearchEntries (searchSchema, entries = []) {
  for (const [searchFieldName, searchEntry] of entries) {
    assertFieldName(searchFieldName, 'generated search schema')
    if (!searchFieldName || Object.hasOwn(searchSchema, searchFieldName)) {
      continue
    }

    searchSchema[searchFieldName] = searchEntry
  }
}

/**
 * Merge generated field filters into an explicit search schema.
 * Explicit names win. Boolean search copies the field declaration; configured
 * search may define one filter or named filters with actualField mappings.
 * belongsTo aliases and physical-field search entries share the target metadata.
 * Operator defaults are resolved later, not hard-coded by this generator.
 *
 * @param {Object} schema - Resource field definitions
 * @param {Object} explicitSearchSchema - Explicit filters taking precedence
 * @returns {Object|null} Merged definitions, or null when none exist
 * @example
 * generateSearchSchemaFromSchema({ title: { type: 'string', search: true } }, {})
 * // { title: { type: 'string' } }
 */
export const generateSearchSchemaFromSchema = (schema, explicitSearchSchema) => {
  assertFieldNameMap(explicitSearchSchema, 'explicit search schema')
  // Start with explicit searchSchema or empty object
  const searchSchema = explicitSearchSchema ? { ...explicitSearchSchema } : {}

  if (!schema) {
    return Object.keys(searchSchema).length > 0 ? searchSchema : null
  }

  // Process schema fields with 'search' property
  Object.entries(schema).forEach(([fieldName, fieldDef]) => {
    const effectiveSearch = fieldDef.search

    if (effectiveSearch) {
      if (effectiveSearch === true) {
        // Simple boolean - copy entire field definition (except search)
        const { search, ...fieldDefWithoutSearch } = fieldDef
        registerSearchEntries(searchSchema, createRelationshipSearchEntries(fieldName, fieldDef, {
          ...fieldDefWithoutSearch,
          // Do not set filterOperator here; centralized resolver will apply sensible defaults
        }))
      } else if (typeof effectiveSearch === 'object') {
        assertFieldNameMap(effectiveSearch, `search declaration for '${fieldName}'`)
        // Check if search defines multiple filter fields
        const hasNestedFilters = Object.values(effectiveSearch).some(
          v => typeof v === 'object' && v.filterOperator
        )

        if (hasNestedFilters) {
          // Multiple filters from one field (like published_after/before)
          Object.entries(effectiveSearch).forEach(([filterName, filterDef]) => {
            // Check if filter already exists in explicit searchSchema
            if (Object.hasOwn(searchSchema, filterName)) {
              // Skip - explicit searchSchema takes precedence
              return
            }

            searchSchema[filterName] = {
              type: fieldDef.type,
              actualField: fieldName,
              ...filterDef
            }
          })
        } else {
          // Single filter with config
          registerSearchEntries(searchSchema, createRelationshipSearchEntries(fieldName, fieldDef, {
            type: fieldDef.type,
            ...effectiveSearch
          }))
        }
      }
    }
  })

  // Handle _virtual search definitions
  if (schema._virtual?.search) {
    assertFieldNameMap(schema._virtual.search, 'virtual search schema')
    Object.entries(schema._virtual.search).forEach(([filterName, filterDef]) => {
      // Check if filter already exists in explicit searchSchema
      if (Object.hasOwn(searchSchema, filterName)) {
        // Skip - explicit searchSchema takes precedence
        return
      }

      searchSchema[filterName] = filterDef
    })
  }

  return Object.keys(searchSchema).length > 0 ? searchSchema : null
}

/**
 * Sort a fixed field graph dependency-first, preserving traversal order for ties.
 * Membership is indexed once; cycles and references outside the graph reject.
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => Iterable<T> | null | undefined} getDependencies
 * @returns {T[]}
 */
export function topologicalSort (items, getDependencies) {
  const itemNames = new Set(items)
  const sorted = []
  const visited = new Set()
  const visiting = new Set()
  const stack = []

  function enter (item) {
    if (visited.has(item)) return

    if (visiting.has(item)) {
      throw new Error(`Circular dependency detected: ${item}`)
    }

    visiting.add(item)

    stack.push({ item, iterator: (getDependencies(item) || [])[Symbol.iterator]() })
  }

  try {
    for (const item of items) {
      enter(item)
      while (stack.length) {
        const frame = stack[stack.length - 1]
        let next
        try {
          next = frame.iterator.next()
        } catch (error) {
          stack.pop()
          throw error
        }
        if (next.done) {
          visiting.delete(frame.item)
          visited.add(frame.item)
          sorted.push(frame.item)
          stack.pop()
          continue
        }
        if (!itemNames.has(next.value)) {
          throw new Error(`Unknown dependency '${next.value}' for '${frame.item}'`)
        }
        enter(next.value)
      }
    }
  } catch (error) {
    // Match nested for-of cleanup while retaining the original graph failure.
    for (let index = stack.length - 1; index >= 0; index--) {
      try { stack[index].iterator.return?.() } catch {}
    }
    throw error
  }

  return sorted
}

/** Validate callback dependencies once; retain direct read edges and execution orders. */
export function compileFieldDependencies ({ schemaStructure, computedFields, queryFields = {}, schemaRelationships = {}, idProperty = 'id', scopeName }) {
  const inputNames = new Set([...Object.keys(schemaStructure), 'id', idProperty])
  const getterNames = new Set([...inputNames, ...Object.keys(queryFields)])
  const readNames = new Set([...getterNames, ...Object.keys(computedFields)])
  const relationshipFields = getForeignKeyFields(schemaStructure, schemaRelationships)
  const getterDependencies = new Set([...getterNames].filter(name => !relationshipFields.has(name)))
  const computedDependencies = new Set([...readNames].filter(name => !relationshipFields.has(name)))
  const fieldGetters = Object.create(null)
  const fieldSetters = Object.create(null)
  const readDependencies = Object.fromEntries([...readNames].map(name => [name, []]))

  const dependencies = (name, definition, property, kind, available) => {
    const declared = definition[property]
    if (declared === undefined) return []
    if (!Array.isArray(declared) || declared.some(dep => typeof dep !== 'string' || dep.length === 0)) {
      throw new Error(`Field '${name}' in resource '${scopeName}' must declare ${property} as an array of nonempty field names`)
    }
    for (const dep of declared) {
      if (!available.has(dep)) {
        throw new Error(`Field '${name}' in resource '${scopeName}' has ${kind} dependency '${dep}' that does not exist in schema or is unavailable at that stage`)
      }
    }
    return [...new Set(declared)]
  }

  for (const [name, definition] of Object.entries({ ...schemaStructure, ...queryFields })) {
    for (const [callback, property, available, target] of [
      ['getter', 'runGetterAfter', getterDependencies, fieldGetters],
      ['setter', 'runSetterAfter', inputNames, fieldSetters]
    ]) {
      if (callback === 'setter' && Object.hasOwn(queryFields, name)) {
        if (definition.setter !== undefined || definition.runSetterAfter !== undefined) {
          throw new Error(`Query field '${name}' in resource '${scopeName}' cannot declare a setter or runSetterAfter; projections are read-only`)
        }
        continue
      }
      if (definition[callback] !== undefined && typeof definition[callback] !== 'function') {
        throw new Error(`Field '${name}' in resource '${scopeName}' has invalid ${callback} function`)
      }
      if (definition[callback] === undefined) {
        if (definition[property] !== undefined) {
          throw new Error(`Field '${name}' in resource '${scopeName}' declares ${property} without a ${callback} function`)
        }
        continue
      }
      const after = dependencies(name, definition, property, callback, available)
      target[name] = { [callback]: definition[callback], [property]: after, fieldDef: definition }
      if (callback === 'getter') readDependencies[name] = after
    }
  }

  for (const [name, definition] of Object.entries(computedFields)) {
    readDependencies[name] = dependencies(name, definition, 'dependencies', 'computed', computedDependencies)
  }

  let sortedGetterFields, sortedSetterFields, sortedComputedFields
  try {
    sortedGetterFields = topologicalSort([...getterNames], name => fieldGetters[name]?.runGetterAfter || [])
      .filter(name => Object.hasOwn(fieldGetters, name))
  } catch (error) {
    throw new Error(`Invalid getter dependencies in ${scopeName}: ${error.message}`, { cause: error })
  }
  try {
    sortedSetterFields = topologicalSort([...inputNames], name => fieldSetters[name]?.runSetterAfter || [])
      .filter(name => Object.hasOwn(fieldSetters, name))
  } catch (error) {
    throw new Error(`Invalid setter dependencies in ${scopeName}: ${error.message}`, { cause: error })
  }
  try {
    sortedComputedFields = topologicalSort([...readNames], name => readDependencies[name])
      .filter(name => Object.hasOwn(computedFields, name))
  } catch (error) {
    throw new Error(`Invalid computed dependencies in ${scopeName}: ${error.message}`, { cause: error })
  }

  return { fieldGetters, sortedGetterFields, fieldSetters, sortedSetterFields, readDependencies, sortedComputedFields, foreignKeyFields: relationshipFields }
}

/** Find only the dependencies needed by this read; ordering is already compiled.
 * @param {{ readDependencies?: Record<string, readonly string[]> }} schemaInfo
 * @param {Iterable<string>} fields
 * @returns {Set<string>}
 */
export function getFieldDependencyClosure (schemaInfo, fields) {
  const selected = new Set(fields)
  const pending = [...selected]
  const dependencies = schemaInfo.readDependencies || {}
  while (pending.length) {
    const name = pending.pop()
    if (!Object.hasOwn(dependencies, name)) continue
    for (const dependency of dependencies[name]) {
      if (selected.has(dependency)) continue
      selected.add(dependency)
      pending.push(dependency)
    }
  }
  return selected
}

/** Copy declaration data without freezing caller-owned values or cloning callbacks. */
export function snapshotResourceConfiguration (value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  let copy
  if (value instanceof Date) copy = new Date(value.getTime())
  else if (value instanceof RegExp) {
    copy = new RegExp(value.source, value.flags)
    copy.lastIndex = value.lastIndex
  } else if (typeof value.validateWith === 'function' && typeof value.getFieldDefinitions === 'function') {
    const factory = createSchema.createFactory(value)
    copy = factory({}, { operations: value.operations })
    seen.set(value, copy)
    copy.structure = snapshotResourceConfiguration(value.structure, seen)
    return copy
  } else if (Array.isArray(value)) copy = new Array(value.length)
  else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    copy = Object.create(prototype)
  }
  seen.set(value, copy)
  if (value instanceof Date || value instanceof RegExp) return copy
  for (const key of Object.keys(value)) {
    // File backends are external handles; their state and method receiver stay intact.
    const isFileBackend = key === 'storage' && value.type === 'file' && typeof value[key]?.upload === 'function'
    let propertyValue
    if (isFileBackend) {
      propertyValue = value[key]
    } else {
      propertyValue = snapshotResourceConfiguration(value[key], seen)
    }
    Object.defineProperty(copy, key, {
      value: propertyValue,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  return copy
}
