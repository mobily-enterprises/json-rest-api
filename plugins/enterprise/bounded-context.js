import { ApiError } from '../../index.js'

export const BoundedContextPlugin = {
  install(api, options = {}) {
    const {
      contexts = {},
      sharedKernel = [],
      anticorruption = true,
      eventBus = null
    } = options

    // Store context configurations
    api._contexts = new Map()
    api._contextMappings = new Map()
    api._sharedKernel = new Set(sharedKernel)

    // Context factory
    api.createContext = (name, config = {}) => {
      const context = {
        name,
        api: config.api || api, // Can use separate API instance
        resources: new Set(),
        mappings: new Map(),
        translations: new Map(),
        events: []
      }

      // Apply context-specific configurations
      if (config.namespace) {
        context.namespace = config.namespace
      }

      if (config.storage) {
        // Allow context to have its own storage configuration
        context.storageConfig = config.storage
      }

      api._contexts.set(name, context)
      return context
    }

    // Add resource to a context
    api.addResourceToContext = (contextName, resourceName, config = {}) => {
      const context = api._contexts.get(contextName)
      if (!context) {
        throw new ApiError(`Context '${contextName}' not found`, 400)
      }

      context.resources.add(resourceName)

      // If resource is in shared kernel, track it
      if (api._sharedKernel.has(resourceName)) {
        if (!context.sharedResources) {
          context.sharedResources = new Set()
        }
        context.sharedResources.add(resourceName)
      }

      // Apply context-specific schema transformations
      if (config.schemaTransform) {
        context.translations.set(resourceName, config.schemaTransform)
      }

      return context
    }

    // Define mapping between contexts
    api.defineContextMapping = (fromContext, toContext, mappings) => {
      const key = `${fromContext}->${toContext}`
      api._contextMappings.set(key, {
        from: fromContext,
        to: toContext,
        mappings,
        type: mappings.type || 'conformist' // conformist, anticorruption, partnership
      })
    }

    // Translate data between contexts
    const translateData = (data, fromContext, toContext, resourceName) => {
      const mappingKey = `${fromContext}->${toContext}`
      const mapping = api._contextMappings.get(mappingKey)
      
      if (!mapping) {
        if (anticorruption) {
          throw new ApiError(`No mapping defined from '${fromContext}' to '${toContext}'`, 400)
        }
        return data // Pass through if no anticorruption
      }

      const resourceMapping = mapping.mappings[resourceName]
      if (!resourceMapping) {
        return data
      }

      // Apply field mappings
      const translated = {}
      for (const [sourceField, targetField] of Object.entries(resourceMapping.fields || {})) {
        if (typeof targetField === 'function') {
          translated[sourceField] = targetField(data[sourceField], data)
        } else if (typeof targetField === 'string') {
          translated[targetField] = data[sourceField]
        } else if (targetField === null) {
          // Skip field
          continue
        }
      }

      // Apply custom transformation
      if (resourceMapping.transform) {
        return resourceMapping.transform(data, translated)
      }

      return { ...data, ...translated }
    }

    // Anti-corruption layer
    if (anticorruption) {
      api.hook('beforeInsert', async (context) => {
        const resourceContext = findResourceContext(context.resource)
        if (!resourceContext) return

        // Check if data comes from another context
        if (context.sourceContext && context.sourceContext !== resourceContext.name) {
          context.data = translateData(
            context.data,
            context.sourceContext,
            resourceContext.name,
            context.resource
          )
        }
      })

      api.hook('afterGet', async (context) => {
        const resourceContext = findResourceContext(context.resource)
        if (!resourceContext) return

        // Check if data needs translation to target context
        if (context.targetContext && context.targetContext !== resourceContext.name) {
          context.result = translateData(
            context.result,
            resourceContext.name,
            context.targetContext,
            context.resource
          )
        }
      })
    }

    // Find which context a resource belongs to
    const findResourceContext = (resourceName) => {
      for (const [name, context] of api._contexts) {
        if (context.resources.has(resourceName)) {
          return context
        }
      }
      return null
    }

    // Context boundary enforcement
    api.hook('beforeOperation', async (context) => {
      const resourceContext = findResourceContext(context.resource)
      if (!resourceContext) return

      // Check cross-context access
      if (context.callingContext && context.callingContext !== resourceContext.name) {
        // Check if resource is in shared kernel
        if (!api._sharedKernel.has(context.resource)) {
          // Check if mapping exists
          const mappingKey = `${context.callingContext}->${resourceContext.name}`
          const mapping = api._contextMappings.get(mappingKey)
          
          if (!mapping && anticorruption) {
            throw new ApiError(
              `Cross-context access denied: '${context.callingContext}' cannot access '${context.resource}' in '${resourceContext.name}'`,
              403
            )
          }
        }
      }
    })

    // Context event publishing
    const publishContextEvent = (contextName, eventType, data) => {
      const context = api._contexts.get(contextName)
      if (!context) return

      const event = {
        context: contextName,
        type: eventType,
        data,
        timestamp: new Date()
      }

      context.events.push(event)

      // Publish to event bus if configured
      if (eventBus) {
        eventBus.publish(`context.${contextName}.${eventType}`, event)
      }

      // Notify interested contexts
      for (const [name, ctx] of api._contexts) {
        if (name !== contextName && ctx.subscribedEvents?.has(`${contextName}.${eventType}`)) {
          // Handle event in subscribing context
          if (ctx.eventHandlers) {
            const handler = ctx.eventHandlers.get(`${contextName}.${eventType}`)
            if (handler) {
              handler(event)
            }
          }
        }
      }
    }

    // Subscribe to events from other contexts
    api.subscribeToContextEvent = (subscriberContext, publisherContext, eventType, handler) => {
      const context = api._contexts.get(subscriberContext)
      if (!context) {
        throw new ApiError(`Context '${subscriberContext}' not found`, 400)
      }

      if (!context.subscribedEvents) {
        context.subscribedEvents = new Set()
      }
      if (!context.eventHandlers) {
        context.eventHandlers = new Map()
      }

      const eventKey = `${publisherContext}.${eventType}`
      context.subscribedEvents.add(eventKey)
      context.eventHandlers.set(eventKey, handler)
    }

    // API to query within context boundaries
    api.withinContext = (contextName) => {
      const context = api._contexts.get(contextName)
      if (!context) {
        throw new ApiError(`Context '${contextName}' not found`, 400)
      }

      return {
        resources: Object.fromEntries(
          Array.from(context.resources).map(name => [name, api.resources[name]])
        ),
        
        publish: (eventType, data) => publishContextEvent(contextName, eventType, data),
        
        subscribe: (publisherContext, eventType, handler) => 
          api.subscribeToContextEvent(contextName, publisherContext, eventType, handler),
        
        callOtherContext: async (targetContext, resource, method, ...args) => {
          const originalContext = args[args.length - 1]?.callingContext
          const options = args[args.length - 1] || {}
          options.callingContext = contextName
          options.sourceContext = contextName
          options.targetContext = targetContext

          try {
            return await api.resources[resource][method](...args.slice(0, -1), options)
          } finally {
            if (originalContext !== undefined) {
              options.callingContext = originalContext
            }
          }
        }
      }
    }

    // Initialize predefined contexts
    for (const [name, config] of Object.entries(contexts)) {
      const context = api.createContext(name, config)
      
      if (config.resources) {
        for (const resource of config.resources) {
          api.addResourceToContext(name, resource)
        }
      }

      if (config.mappings) {
        for (const [target, mapping] of Object.entries(config.mappings)) {
          api.defineContextMapping(name, target, mapping)
        }
      }
    }

    // Context visualization
    api.visualizeContexts = () => {
      const visualization = {
        contexts: {},
        mappings: [],
        sharedKernel: Array.from(api._sharedKernel)
      }

      for (const [name, context] of api._contexts) {
        visualization.contexts[name] = {
          resources: Array.from(context.resources),
          sharedResources: context.sharedResources ? Array.from(context.sharedResources) : [],
          events: context.events.length,
          subscriptions: context.subscribedEvents ? Array.from(context.subscribedEvents) : []
        }
      }

      for (const [key, mapping] of api._contextMappings) {
        visualization.mappings.push({
          from: mapping.from,
          to: mapping.to,
          type: mapping.type,
          resources: Object.keys(mapping.mappings)
        })
      }

      return visualization
    }
  }
}