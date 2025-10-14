import { resolveFieldInfo } from '../utils/descriptor-helpers.js'

const JOIN_METHODS = new Set([
  'join',
  'innerJoin',
  'leftJoin',
  'leftOuterJoin',
  'rightJoin',
  'rightOuterJoin',
  'outerJoin',
  'crossJoin',
])

const JOIN_ON_METHODS = new Set([
  'on',
  'andOn',
  'orOn',
  'onVal',
  'andOnVal',
  'orOnVal',
])

const JOIN_ON_IN_METHODS = new Set([
  'onIn',
  'orOnIn',
  'onNotIn',
  'orOnNotIn',
])

const JOIN_ON_NULL_METHODS = new Set([
  'onNull',
  'orOnNull',
  'onNotNull',
  'orOnNotNull',
])

const JOIN_ON_BETWEEN_METHODS = new Set([
  'onBetween',
  'orOnBetween',
  'onNotBetween',
  'orOnNotBetween',
])

const WHERE_METHODS = new Set([
  'where',
  'andWhere',
  'orWhere',
  'whereNot',
  'andWhereNot',
  'orWhereNot',
  'having',
  'orHaving',
])

const WHERE_IN_METHODS = new Set([
  'whereIn',
  'orWhereIn',
  'whereNotIn',
  'orWhereNotIn',
])

const BETWEEN_METHODS = new Set(['whereBetween', 'orWhereBetween', 'whereNotBetween', 'orWhereNotBetween'])

const NULL_METHODS = new Set(['whereNull', 'orWhereNull', 'whereNotNull', 'orWhereNotNull'])

const ORDER_METHODS = new Set(['orderBy', 'orderByRaw'])

const GROUP_METHODS = new Set(['groupBy', 'groupByRaw'])

const SELECT_METHODS = new Set(['select', 'columns', 'distinct'])

const AGGREGATE_METHODS = new Set(['count', 'min', 'max', 'sum', 'avg'])

const CALLBACK_FIRST_METHODS = new Set([
  'where',
  'andWhere',
  'orWhere',
  'having',
  'orHaving',
])

const isFunction = (value) => typeof value === 'function'
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

const SQL_OPERATORS = new Set([
  '=',
  '!=',
  '<>',
  '<',
  '<=',
  '>',
  '>=',
  'like',
  'not like',
  'ilike',
  'not ilike',
  'is',
  'is not',
  'is null',
  'is not null',
])

const parseTableExpression = (expression) => {
  if (expression && typeof expression === 'object' && !Array.isArray(expression)) {
    const [alias, tableName] = Object.entries(expression)[0] || []
    if (!alias) {
      return { original: expression }
    }
    return { alias, tableName, original: expression }
  }

  if (typeof expression !== 'string') {
    return { original: expression }
  }

  const raw = expression.trim()
  if (raw === '') {
    return { original: expression }
  }

  const asMatch = raw.split(/\s+as\s+/i)
  if (asMatch.length === 2) {
    return { tableName: asMatch[0].trim(), alias: asMatch[1].trim(), original: expression }
  }

  const parts = raw.split(/\s+/)
  if (parts.length === 2) {
    return { tableName: parts[0].trim(), alias: parts[1].trim(), original: expression }
  }

  return { tableName: raw, alias: raw, original: expression }
}

const translateObjectKeys = (adapter, obj) => {
  const result = {}
  for (const [key, value] of Object.entries(obj)) {
    result[adapter.translateColumn(key)] = value
  }
  return result
}

const translateJoinObject = (adapter, obj) => {
  const result = {}
  for (const [lhs, rhs] of Object.entries(obj)) {
    const translatedKey = typeof lhs === 'string' ? adapter.translateColumn(lhs) : lhs
    const translatedValue = typeof rhs === 'string' ? adapter.translateColumn(rhs) : rhs
    result[translatedKey] = translatedValue
  }
  return result
}

const maybeWrapCallback = (adapter, callback) => {
  if (!isFunction(callback)) return callback
  return function wrappedCallback (...args) {
    return callback.apply(adapter.proxy, args)
  }
}

const isRaw = (value) => Boolean(value && typeof value === 'object' && typeof value.toSQL === 'function' && value.toSQL().method)

const ensureArray = (value) => (Array.isArray(value) ? value : [value])

export async function preloadRelatedDescriptors ({ registry, descriptor }) {
  const visited = new Map()
  const queue = [descriptor.resource]
  visited.set(descriptor.resource, descriptor)

  while (queue.length > 0) {
    const resource = queue.pop()
    const current = visited.get(resource)
    if (!current) continue

    const relatedTargets = new Set()

    Object.values(current.belongsTo || {}).forEach((info) => {
      if (info?.target) relatedTargets.add(info.target)
    })

    Object.values(current.relationships || {}).forEach((info) => {
      if (info?.target) relatedTargets.add(info.target)
    })

    Object.values(current.manyToMany || {}).forEach((info) => {
      if (info?.target) relatedTargets.add(info.target)
      if (info?.through) relatedTargets.add(info.through)
    })

    Object.values(current.polymorphicBelongsTo || {}).forEach((info) => {
      ensureArray(info?.types || []).forEach((type) => relatedTargets.add(type))
    })

    for (const target of relatedTargets) {
      if (!target || visited.has(target)) continue
      const nextDescriptor = await registry.getDescriptor(current.tenant, target)
      if (!nextDescriptor) continue
      visited.set(target, nextDescriptor)
      queue.push(target)
    }
  }

  return visited
}

export class AnyapiQueryAdapter {
  constructor ({
    descriptor,
    db,
    registry,
    descriptorsMap,
    resourceToTableName,
    tableNameToResource,
    log,
  }) {
    this.descriptor = descriptor
    this.db = db
    this.registry = registry
    this.descriptorsMap = descriptorsMap
    this.resourceToTableName = resourceToTableName || new Map()
    this.tableNameToResource = tableNameToResource || new Map()
    this.log = log || console

    this.primaryAlias = this.resourceToTableName.get(descriptor.resource) || descriptor.resource
    this.aliasDescriptors = new Map()
    this.aliasDescriptors.set(this.primaryAlias, descriptor)

    this.aliasDescriptors.set(descriptor.resource, descriptor)
    this.aliasActualNames = new Map()
    this.aliasActualNames.set(this.primaryAlias, this.primaryAlias)
    this.aliasActualNames.set(descriptor.resource, this.primaryAlias)

    const physicalTableName = this.resourceToTableName.get(descriptor.resource)
    if (physicalTableName) {
      this.aliasDescriptors.set(physicalTableName, descriptor)
      this.aliasActualNames.set(physicalTableName, this.primaryAlias)
    }

    this.builders = new WeakMap()

    this.builder = db({ [this.primaryAlias]: descriptor.canonical.tableName })
      .where(`${this.primaryAlias}.${descriptor.canonical.tenantColumn}`, descriptor.tenant)
      .where(`${this.primaryAlias}.${descriptor.canonical.resourceColumn}`, descriptor.resource)

    this.proxy = this.#createProxy(this.builder)
  }

  get tableAlias () {
    return this.primaryAlias
  }

  get query () {
    return this.proxy
  }

  translateColumn (reference) {
    if (typeof reference !== 'string') {
      return reference
    }

    const trimmed = reference.trim()
    if (trimmed === '*' || trimmed === '') {
      return reference
    }

    const parts = trimmed.split('.')
    let requestedAlias
    let field

    if (parts.length === 1) {
      requestedAlias = this.primaryAlias
      field = parts[0]
    } else {
      requestedAlias = parts.shift()
      field = parts.join('.')
    }

    if (!field) {
      return reference
    }

    let descriptor = this.aliasDescriptors.get(requestedAlias)
    if (!descriptor) {
      const resource = this.tableNameToResource.get(requestedAlias) || requestedAlias
      descriptor = this.descriptorsMap.get(resource)
      if (descriptor) {
        this.aliasDescriptors.set(requestedAlias, descriptor)
        const actualAlias = this.resourceToTableName.get(resource) || resource
        this.aliasActualNames.set(requestedAlias, actualAlias)
      }
    }

    if (!descriptor) {
      return reference
    }

    const info = resolveFieldInfo(descriptor, field)
    if (!info?.column) {
      return reference
    }

    const actualAlias = this.aliasActualNames.get(requestedAlias) ||
      this.resourceToTableName.get(descriptor.resource) ||
      descriptor.resource

    return `${actualAlias}.${info.column}`
  }

  translateColumns (columns) {
    if (Array.isArray(columns)) {
      return columns.map((column) => this.translateColumn(column))
    }
    return this.translateColumn(columns)
  }

  registerAlias (alias, descriptor) {
    if (!alias || !descriptor) return
    this.aliasDescriptors.set(alias, descriptor)
    this.aliasActualNames.set(alias, alias)
  }

  #translateWhereArgs (method, args) {
    if (args.length === 0) return args
    const [first, ...rest] = args

    if (isFunction(first)) {
      return [maybeWrapCallback(this, first), ...rest]
    }

    if (isObject(first) && !isRaw(first)) {
      return [translateObjectKeys(this, first), ...rest]
    }

    if (Array.isArray(first)) {
      return [first.map((item) => (typeof item === 'string' ? this.translateColumn(item) : item)), ...rest]
    }

    const translatedFirst = this.translateColumn(first)

    if (rest.length > 0 && isFunction(rest[rest.length - 1])) {
      const newRest = [...rest]
      newRest[newRest.length - 1] = maybeWrapCallback(this, rest[rest.length - 1])
      return [translatedFirst, ...newRest]
    }

    return [translatedFirst, ...rest]
  }

  #translateWhereInArgs (args) {
    if (args.length === 0) return args
    const [column, values, ...rest] = args
    const translatedColumn = this.translateColumn(column)

    if (isFunction(values)) {
      return [translatedColumn, maybeWrapCallback(this, values), ...rest]
    }

    return [translatedColumn, values, ...rest]
  }

  #translateBetweenArgs (args) {
    if (args.length === 0) return args
    const [column, range, ...rest] = args
    return [this.translateColumn(column), range, ...rest]
  }

  #translateNullArgs (args) {
    if (args.length === 0) return args
    const [column, ...rest] = args
    return [this.translateColumn(column), ...rest]
  }

  #translateOrderArgs (method, args) {
    if (args.length === 0) return args

    if (method === 'orderByRaw') {
      return args
    }

    const [column, direction, ...rest] = args

    if (Array.isArray(column)) {
      return [column.map((entry) => {
        if (typeof entry === 'string') {
          return this.translateColumn(entry)
        }
        if (isObject(entry)) {
          const [col, dir] = Object.entries(entry)[0] || []
          if (!col) return entry
          return { [this.translateColumn(col)]: dir }
        }
        return entry
      }), direction, ...rest]
    }

    if (isObject(column) && column.column) {
      return [{ ...column, column: this.translateColumn(column.column) }, direction, ...rest]
    }

    return [this.translateColumn(column), direction, ...rest]
  }

  #translateGroupArgs (args) {
    if (args.length === 0) return args
    const [first, ...rest] = args
    if (Array.isArray(first)) {
      return [first.map((entry) => (typeof entry === 'string' ? this.translateColumn(entry) : entry)), ...rest]
    }
    return [this.translateColumn(first), ...rest]
  }

  #translateSelectArgs (args) {
    if (args.length === 0) return args
    const [first, ...rest] = args

    if (Array.isArray(first)) {
      return [first.map((entry) => (typeof entry === 'string' ? this.translateColumn(entry) : entry)), ...rest]
    }

    if (typeof first === 'string') {
      return [this.translateColumn(first), ...rest]
    }

    return [first, ...rest]
  }

  #translateAggregateArgs (args) {
    if (args.length === 0) return args
    const [column, options] = args
    if (Array.isArray(column)) {
      return [column.map((entry) => (typeof entry === 'string' ? this.translateColumn(entry) : entry)), options]
    }
    if (typeof column === 'string') {
      return [this.translateColumn(column), options]
    }
    return args
  }

  #translateOnArgs (args) {
    if (args.length === 0) return args
    const [first, ...rest] = args

    if (isFunction(first)) {
      return [maybeWrapCallback(this, first), ...rest]
    }

    if (isObject(first) && !isRaw(first)) {
      return [translateJoinObject(this, first), ...rest]
    }

    const translatedFirst = typeof first === 'string' ? this.translateColumn(first) : first

    if (rest.length === 0) {
      return [translatedFirst]
    }

    const translatedRest = rest.map((value, index) => {
      if (isFunction(value)) {
        return maybeWrapCallback(this, value)
      }
      if (typeof value !== 'string') {
        return value
      }
      const lower = value.toLowerCase()
      if (SQL_OPERATORS.has(lower)) {
        return value
      }
      return this.translateColumn(value)
    })

    return [translatedFirst, ...translatedRest]
  }

  #translateOnInArgs (args) {
    if (args.length === 0) return args
    const [column, values, ...rest] = args
    const translatedColumn = typeof column === 'string' ? this.translateColumn(column) : column

    if (isFunction(values)) {
      return [translatedColumn, maybeWrapCallback(this, values), ...rest]
    }

    return [translatedColumn, values, ...rest]
  }

  #translateOnBetweenArgs (args) {
    if (args.length === 0) return args
    const [column, range, ...rest] = args
    return [typeof column === 'string' ? this.translateColumn(column) : column, range, ...rest]
  }

  #translateOnNullArgs (args) {
    if (args.length === 0) return args
    const [column, ...rest] = args
    return [typeof column === 'string' ? this.translateColumn(column) : column, ...rest]
  }

  #addResourceConstraints (joinClause, alias, descriptor) {
    joinClause.on(`${alias}.${descriptor.canonical.tenantColumn}`, this.db.raw('?', [descriptor.tenant]))
    joinClause.andOn(`${alias}.${descriptor.canonical.resourceColumn}`, this.db.raw('?', [descriptor.resource]))
  }

  #createJoinProxy (joinClause) {
    const adapter = this
    const handler = {
      get (target, prop, receiver) {
        const original = target[prop]
        if (typeof original !== 'function') {
          return Reflect.get(target, prop, receiver)
        }
        return (...args) => {
          let translatedArgs = args

          if (WHERE_METHODS.has(prop)) {
            translatedArgs = adapter.#translateWhereArgs(prop, args)
          } else if (WHERE_IN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateWhereInArgs(args)
          } else if (BETWEEN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateBetweenArgs(args)
          } else if (NULL_METHODS.has(prop)) {
            translatedArgs = adapter.#translateNullArgs(args)
          } else if (JOIN_ON_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnArgs(args)
          } else if (JOIN_ON_IN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnInArgs(args)
          } else if (JOIN_ON_BETWEEN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnBetweenArgs(args)
          } else if (JOIN_ON_NULL_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnNullArgs(args)
          }

          const result = original.apply(target, translatedArgs)
          return result === target ? receiver : result
        }
      },
    }

    return new Proxy(joinClause, handler)
  }

  #handleJoin (method, args) {
    if (args.length === 0) return args
    const [tableExpression, ...rest] = args
    const parsed = parseTableExpression(tableExpression)

    if (!parsed.tableName || !parsed.alias) {
      return args
    }

    const resource = this.tableNameToResource.get(parsed.tableName) || parsed.tableName
    const descriptor = this.descriptorsMap.get(resource)

    if (!descriptor) {
      return args
    }

    this.registerAlias(parsed.alias, descriptor)

    const joinTarget = { [parsed.alias]: descriptor.canonical.tableName }

    if (rest.length === 0) {
      return [joinTarget]
    }

    const [first, ...remaining] = rest

    if (isFunction(first)) {
      const joinCallback = first
      const wrappedCallback = (joinClause) => {
        this.#addResourceConstraints(joinClause, parsed.alias, descriptor)
        const proxyClause = this.#createJoinProxy(joinClause)
        return joinCallback.call(proxyClause, proxyClause)
      }
      return [joinTarget, wrappedCallback, ...remaining]
    }

    const translatedArgs = rest.map((value, index) => {
      if (index === 0 || index === 1) {
        return this.translateColumn(value)
      }
      return value
    })

    return [joinTarget, ...translatedArgs]
  }

  #createProxy (builder) {
    const adapter = this
    const handler = {
      get (target, prop, receiver) {
        if (prop === '__adapter__') {
          return adapter
        }

        const value = target[prop]
        if (typeof value !== 'function') {
          return Reflect.get(target, prop, receiver)
        }

        if (JOIN_METHODS.has(prop)) {
          return (...args) => {
            const translatedArgs = adapter.#handleJoin(prop, args)
            const result = value.apply(target, translatedArgs)
            return result === target ? receiver : result
          }
        }

        return (...args) => {
          let translatedArgs = args

          if (WHERE_METHODS.has(prop)) {
            translatedArgs = adapter.#translateWhereArgs(prop, args)
          } else if (WHERE_IN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateWhereInArgs(args)
          } else if (BETWEEN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateBetweenArgs(args)
          } else if (NULL_METHODS.has(prop)) {
            translatedArgs = adapter.#translateNullArgs(args)
          } else if (JOIN_ON_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnArgs(args)
          } else if (JOIN_ON_IN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnInArgs(args)
          } else if (JOIN_ON_BETWEEN_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnBetweenArgs(args)
          } else if (JOIN_ON_NULL_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOnNullArgs(args)
          } else if (ORDER_METHODS.has(prop)) {
            translatedArgs = adapter.#translateOrderArgs(prop, args)
          } else if (GROUP_METHODS.has(prop)) {
            translatedArgs = adapter.#translateGroupArgs(args)
          } else if (SELECT_METHODS.has(prop)) {
            translatedArgs = adapter.#translateSelectArgs(args)
          } else if (AGGREGATE_METHODS.has(prop)) {
            translatedArgs = adapter.#translateAggregateArgs(args)
          } else if (CALLBACK_FIRST_METHODS.has(prop) && args.length && isFunction(args[0])) {
            translatedArgs = [maybeWrapCallback(adapter, args[0]), ...args.slice(1)]
          }

          const result = value.apply(target, translatedArgs)
          return result === target ? receiver : result
        }
      },
    }

    const proxy = new Proxy(builder, handler)
    this.builders.set(proxy, builder)
    return proxy
  }
}
