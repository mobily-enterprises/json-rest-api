export class Hooks {
  #events = new Map()

  add (event, name, options, handler, resource) {
    if (typeof handler !== 'function') throw new TypeError(`Hook '${name}' needs a function`)
    const { beforeFunction, afterFunction, ...unsupported } = options
    if (Object.keys(unsupported).length || (beforeFunction && afterFunction)) {
      throw new TypeError(`Hook '${name}' requires at most one beforeFunction or afterFunction`)
    }
    const handlers = this.#events.get(event) || []
    const anchor = beforeFunction || afterFunction
    let index = handlers.length
    if (anchor) {
      index = handlers.findIndex(entry => entry.name === anchor)
      if (index < 0) throw new Error(`Hook '${event}' has no handler '${anchor}'`)
      if (afterFunction) index++
    }
    handlers.splice(index, 0, { name, handler, resource })
    this.#events.set(event, handlers)
  }

  async run (event, args) {
    for (const entry of [...(this.#events.get(event) || [])]) {
      if (entry.resource && entry.resource !== args.scope) continue
      if (await entry.handler(args) === false) return false
    }
    return true
  }
}

function checkName (name) {
  if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name) ||
      ['__proto__', 'prototype', 'constructor', 'then'].includes(name)) {
    throw new TypeError(`Invalid name '${name}'`)
  }
}

function checkResourceMethodName (name) {
  checkName(name)
  if (['name', 'vars', 'helpers', 'scopeOptions'].includes(name)) {
    throw new Error(`Resource member '${name}' is reserved`)
  }
}

function assignValues (target, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    checkName(name)
    target[name] = value
  }
}

export class JsonRestApi {
  #hooks = new Hooks()
  #plugins = new Set()
  #resourceMethods = Object.create(null)

  constructor ({ name, logger = {}, ...options } = {}) {
    if ('log' in options || 'logging' in options) throw new TypeError('Pass logger directly instead of log or logging options')
    this.name = name
    this.log = Object.fromEntries(['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map(level => [
      level, (...args) => logger[level]?.(...args)
    ]))
    this.options = Object.freeze(options)
    this.vars = Object.create(null)
    this.helpers = Object.create(null)
    this.resources = Object.create(null)
  }

  // Existing operation handlers receive the same explicit argument object.
  #arguments (resource, params = {}, context = {}) {
    return {
      api: this,
      name: this.name,
      apiOptions: this.options,
      params,
      context,
      scope: resource,
      scopeName: resource?.name,
      scopeOptions: resource?.scopeOptions,
      scopes: this.resources,
      vars: resource?.vars || this.vars,
      helpers: resource?.helpers || this.helpers,
      log: this.log,
      runHooks: (event, nextContext = context) => this.#hooks.run(event, this.#arguments(resource, {}, nextContext))
    }
  }

  #method (handler, resource) {
    if (typeof handler !== 'function') throw new TypeError('Method needs a function')
    return async (params = {}, context = {}) => handler(this.#arguments(resource, params, context))
  }

  #addApiMethod (name, handler) {
    checkName(name)
    if (name in this) throw new Error(`API member '${name}' already exists`)
    this[name] = this.#method(handler)
  }

  #addResourceMethod (name, handler) {
    checkResourceMethodName(name)
    if (typeof handler !== 'function') throw new TypeError('Method needs a function')
    const api = this
    this.#resourceMethods[name] = async function (params = {}, context = {}) {
      return handler(api.#arguments(this, params, context))
    }
  }

  #addHooks (hooks = {}, resource) {
    for (const [event, definition] of Object.entries(hooks)) {
      const { handler, functionName = event, ...options } = typeof definition === 'function'
        ? { handler: definition }
        : definition
      this.#hooks.add(event, functionName, options, handler, resource)
    }
  }

  async use (plugin, pluginOptions = {}) {
    if (!plugin?.name || typeof plugin.install !== 'function') throw new TypeError('Invalid plugin')
    if (this.#plugins.has(plugin.name)) throw new Error(`Plugin '${plugin.name}' already installed`)
    for (const dependency of plugin.dependencies || []) {
      const alternatives = Array.isArray(dependency) ? dependency : [dependency]
      if (!alternatives.some(name => this.#plugins.has(name))) {
        throw new Error(`Plugin '${plugin.name}' requires ${alternatives.join(' or ')}`)
      }
    }
    await plugin.install({
      ...this.#arguments(),
      pluginOptions,
      addApiMethod: (name, handler) => this.#addApiMethod(name, handler),
      addResourceMethod: (name, handler) => this.#addResourceMethod(name, handler),
      addHook: (event, name, options, handler) => this.#hooks.add(event, name, options, handler)
    })
    this.#plugins.add(plugin.name)
    return this
  }

  async addResource (name, { hooks, methods = {}, vars, helpers, ...scopeOptions } = {}) {
    if ('scopeMethods' in scopeOptions) throw new TypeError('Use methods instead of scopeMethods')
    checkName(name)
    if (Object.hasOwn(this.resources, name)) throw new Error(`Resource '${name}' already exists`)
    const resource = Object.assign(Object.create(this.#resourceMethods), {
      name,
      scopeOptions: Object.freeze(scopeOptions),
      // One ordinary prototype link supplies live API defaults; writes stay local.
      vars: Object.create(this.vars),
      helpers: Object.create(this.helpers)
    })
    assignValues(resource.vars, vars)
    assignValues(resource.helpers, helpers)
    for (const [method, handler] of Object.entries(methods)) {
      checkResourceMethodName(method)
      resource[method] = this.#method(handler, resource)
    }
    this.resources[name] = resource
    await this.runHooks('resource:added', { scopeName: name, scopeOptions, vars: resource.vars, helpers: resource.helpers })
    this.#addHooks(hooks, resource)
    return resource
  }

  async customize ({ hooks, methods = {}, vars, helpers, ...unsupported } = {}) {
    if (Object.keys(unsupported).length) throw new TypeError(`Unsupported customization: ${Object.keys(unsupported).join(', ')}`)
    assignValues(this.vars, vars)
    assignValues(this.helpers, helpers)
    for (const [name, handler] of Object.entries(methods)) this.#addResourceMethod(name, handler)
    this.#addHooks(hooks)
    return this
  }

  async runHooks (event, context = {}) {
    return this.#hooks.run(event, this.#arguments(undefined, {}, context))
  }
}
