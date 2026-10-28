// Stored resource definitions keep JSON values only. The paths of values JSON
// cannot hold (callbacks, class instances, RegExps) are recorded, so a server
// loading the definition knows which fields need code it may not have.

const isPlainObject = value => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * @param {unknown} value
 * @returns {{ json: any, callbacks: Array<Array<string|number>> }}
 */
export const toStoredJson = (value) => {
  const callbacks = []
  const visit = (current, path) => {
    if (current === undefined) return undefined
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current
    if (typeof current === 'number' && Number.isFinite(current)) return current
    if (Array.isArray(current)) return current.map((item, index) => visit(item, [...path, index]) ?? null)
    if (typeof current === 'object' && isPlainObject(current)) {
      const result = {}
      for (const [key, item] of Object.entries(current)) {
        const stored = visit(item, [...path, key])
        if (stored !== undefined) result[key] = stored
      }
      return result
    }
    callbacks.push(path)
    return undefined
  }
  return { json: visit(value, []), callbacks }
}

const targetsOf = definition => definition?.oneOf || [definition?.actualField].filter(Boolean)

/**
 * Combine a resource's declaration with the fields other servers added at run
 * time. Declared fields win; runtime fields this server added keep its local
 * callbacks. A field whose callbacks exist in no available code is hidden
 * rather than served without them, because a missing serializer or setter
 * would read or write the wrong values.
 * @param {{ declaration?: Record<string, any>, stored?: Record<string, any> | null, local?: { schema?: Record<string, any>, searchSchema?: Record<string, any> }, fromStorage?: boolean }} input
 */
export const composeResourceOptions = ({ declaration = {}, stored = null, local = {}, fromStorage = false }) => {
  const hidden = new Set()
  const hiddenFilters = new Set()
  const declaredSchema = declaration.schema || {}
  const declaredSearch = declaration.searchSchema || {}
  const schema = { ...declaredSchema }
  const searchSchema = { ...declaredSearch }

  if (fromStorage) {
    for (const path of stored?.callbacks || []) {
      if (path[0] === 'schema' && path.length > 1) hidden.add(path[1])
      else if (path[0] === 'searchSchema' && path.length > 1) hiddenFilters.add(path[1])
      else throw new Error(`Resource option '${path.join('.')}' cannot be loaded from storage; declare the resource in code`)
    }
  }

  const runtime = stored?.runtime || {}
  const needsCode = new Set((runtime.callbacks || []).map(path => `${path[0]}.${path[1]}`))
  const merge = (kind, target, declared, localDefinitions = {}, hide) => {
    for (const [name, definition] of Object.entries(runtime[kind] || {})) {
      if (Object.hasOwn(declared, name)) continue
      if (Object.hasOwn(localDefinitions, name)) target[name] = localDefinitions[name]
      else if (needsCode.has(`${kind}.${name}`)) hide.add(name)
      else target[name] = definition
    }
  }
  merge('schema', schema, declaredSchema, local.schema, hidden)
  merge('searchSchema', searchSchema, declaredSearch, local.searchSchema, hiddenFilters)

  for (const name of hidden) delete schema[name]
  for (const name of stored?.retired || []) {
    if (Object.hasOwn(schema, name)) schema[name] = { ...schema[name], retired: true }
  }
  for (const [name, definition] of Object.entries(searchSchema)) {
    if (hiddenFilters.has(name) || targetsOf(definition).some(target => hidden.has(target))) {
      hiddenFilters.add(name)
      delete searchSchema[name]
    }
  }

  const options = { ...declaration, schema }
  if (Object.keys(searchSchema).length || declaration.searchSchema) options.searchSchema = searchSchema
  if (hidden.size && Array.isArray(declaration.sortableFields)) {
    options.sortableFields = declaration.sortableFields.filter(field => !hidden.has(String(field).replace(/^-/, '')))
  }
  return { options, hidden: [...hidden], hiddenFilters: [...hiddenFilters] }
}

/**
 * Resources a stored declaration refers to. Polymorphic targets must be
 * registered before the resource itself; the others can follow.
 * @param {Record<string, any>} options
 */
export const relatedResources = (options = {}) => {
  const before = new Set()
  const after = new Set()
  for (const definition of Object.values(options.schema || {})) {
    if (definition?.belongsTo) after.add(definition.belongsTo)
  }
  for (const [name, definition] of Object.entries(options.relationships || {})) {
    for (const type of definition?.belongsToPolymorphic?.types || []) before.add(type)
    if (definition?.type === 'hasMany' || definition?.type === 'manyToMany' || definition?.hasMany) {
      after.add(definition.target || definition.hasMany || name)
    }
    if (definition?.through) after.add(definition.through)
  }
  return { before: [...before], after: [...after].filter(name => !before.has(name)) }
}
