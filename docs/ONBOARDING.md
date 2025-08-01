# Developer Contribution Guide

This guide is for developers who want to contribute to the json-rest-api codebase and understand its internal architecture.

## Introduction

json-rest-api is NOT a standalone library - it's a collection of plugins for [hooked-api](https://github.com/mercmobily/hooked-api). Each plugin extends the API with specific functionality by:

- Adding methods to the API or to resources
- Running hooks at strategic points
- Listening to global events

## What Each Plugin Does

### Core Pattern
Every plugin follows this structure:
```javascript
export const SomePlugin = {
  name: 'plugin-name',
  dependencies: ['other-plugin'], // optional
  
  install({ helpers, addScopeMethod, addApiMethod, vars, addHook, runHooks, on, /* ... */ }) {
    // 1. Add methods (API-level or resource-level)
    // 2. Add hooks to extend behavior
    // 3. Listen to events from other plugins
    // 4. Set up helpers for other plugins to use
  }
}
```

### Key Plugins
- **RestApiPlugin**: Defines REST methods (get, post, patch, delete) and core hooks
- **RestApiKnexPlugin**: Implements data helpers used by REST methods
- **ExpressPlugin**: Creates HTTP endpoints by listening to route events

## Resources vs Scopes

An important concept: `api.resources` is just an alias to `api.scopes`:

```javascript
// In rest-api-plugin.js
setScopeAlias('resources', 'addResource');
```

This means:
- `api.resources` === `api.scopes`
- `api.addResource()` === `api.addScope()`
- "Resource" is REST terminology, "Scope" is hooked-api terminology
- They're the same thing!

## Global Hooks Run by the Library

### Core hooked-api Hooks

The hooked-api framework provides several system-level hooks that plugins can use:

1. **scope:added** - Fired when a new scope (resource) is added via `api.addScope()` or `api.addResource()`
   - This is the most important  hook for plugins that need to set up resources
   - Receives context with `scopeName`, `scopeOptions`, and `vars`
   - Used by rest-api-plugin to compile schemas, validate relationships, and register routes

3. **plugin:installed** - Fired after each plugin is installed
   - Receives the plugin name and configuration

4. **error** - Global error handling hook
   - Allows plugins to intercept and handle errors

Example of using scope:added:
```javascript
// This is how rest-api-plugin uses scope:added to set up resources
addHook('scope:added', 'compileResourceSchemas', {}, async ({ context, scopes, runHooks }) => {
  // context.scopeName contains the resource name
  // This runs for EVERY resource added to the API
  const scope = scopes[context.scopeName];
  await compileSchemas(scope, { context, runHooks });
});
```

## Understanding vars and helpers in hooked-api

### vars
The `vars` object is a cascading configuration system:
- Set at global level: `vars.someValue = 'default'`
- Override at scope level: `scope.vars.someValue = 'specific'`
- Values cascade: scope → global → undefined

Example from rest-api-plugin:
```javascript
vars.queryDefaultLimit = restApiOptions.queryDefaultLimit || DEFAULT_QUERY_LIMIT
vars.queryMaxLimit = restApiOptions.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
```

### helpers
Helpers are shared functions that plugins provide for others to use:
- Pure functions (no side effects)
- Set by one plugin, used by others
- Example: Knex plugin provides `helpers.dataGet`, REST plugin uses it

```javascript
// Knex plugin sets:
helpers.dataGet = async ({ scopeName, context }) => { /* ... */ }

// REST plugin uses:
context.record = await helpers.dataGet({ scopeName, context, runHooks })
```

## Plugin Event Listening and Method Definition

Plugins interact through three mechanisms:

### 1. Global API Methods
```javascript
// Define
addApiMethod('addRoute', addRouteMethod);

// Use
api.addRoute({ method: 'GET', path: '/users', handler: myHandler })
```

### 2. Resource Methods
```javascript
// Define
addScopeMethod('get', getMethod);

// Use
api.resources.users.get({ id: '123' })
```

### 3. Event Listening
```javascript
// Listen
on('route:added', ({ route, scopeName }) => {
  console.log(`Route added for ${scopeName}`)
})

// Emit (done internally by hooked-api)
```

## Relationship Between rest-api-plugin and rest-api-knex-plugin

The relationship is complementary:

### rest-api-plugin.js
- Defines the REST API interface (methods like get, post, patch, delete)
- Orchestrates the request flow through hooks
- Validates inputs
- Transforms between formats (JSON:API ↔ simplified)
- Does NOT touch the database

### rest-api-knex-plugin.js
- Implements the data helpers that rest-api-plugin calls
- Provides: `dataGet`, `dataPost`, `dataPatch`, `dataDelete`, etc.
- Handles all database operations
- Transforms between database format and JSON:API
- Manages relationships at the database level

Example flow:
```javascript
// In rest-api-plugin get method:
await runHooks('beforeDataGet');
context.record = await helpers.dataGet({ scopeName, context, runHooks });
await runHooks('afterDataGet');

// dataGet is provided by rest-api-knex-plugin
```

## API Methods Run Hooks for Extensibility

Every REST method (get, post, patch, delete) follows this pattern:

```javascript
async function someMethod({ params, context, runHooks, /* ... */ }) {
  // 1. Validate
  validatePayload(params);
  
  // 2. Check permissions
  await scope.checkPermissions({ method: 'get', /* ... */ });
  
  // 3. Run before hooks
  await runHooks('beforeData');
  await runHooks('beforeDataGet');
  
  // 4. Perform operation (via helper)
  context.record = await helpers.dataGet({ /* ... */ });
  
  // 5. Run after hooks
  await runHooks('enrichRecord');
  
  // 6. Run finish hooks
  await runHooks('finish');
  await runHooks('finishGet');
  
  return context.record;
}
```

This allows plugins to hook into any phase of the request.

## How addRoute() Works in Detail

The `addRoute` implementation demonstrates the plugin communication pattern perfectly:

### 1. API Method Definition (rest-api-plugin)
```javascript
// In rest-api-plugin.js
addApiMethod('addRoute', addRouteMethod);

// In add-route.js
export default async ({ params, context, runHooks }) => {
  const { method, path, handler } = params;
  
  // Validate
  if (!method || !path || !handler) {
    throw new ValidationError('Route requires method, path, and handler');
  }
  
  // Copy params to context for hooks
  Object.assign(context, params);
  
  // Run the hook - this notifies all listeners
  await runHooks('addRoute');
  
  return { registered: true, method, path };
}
```

### 2. Route Registration (registerScopeRoutes hook)
When a resource is added, routes are automatically registered:
```javascript
// In register-scope-routes.js
await api.addRoute({
  method: 'GET',
  path: `${basePath}/${scopeName}`,
  handler: createRouteHandler(scopeName, 'query')
});

await api.addRoute({
  method: 'GET',
  path: `${basePath}/${scopeName}/:id`,
  handler: createRouteHandler(scopeName, 'get')
});
// ... etc for POST, PUT, PATCH, DELETE
```

### 3. Transport Implementation (express-plugin)
The Express plugin listens for the addRoute hook:
```javascript
// In express-plugin.js
addHook('addRoute', 'expressRouteCreator', {}, async ({ context }) => {
  const { method, path, handler } = context;
  
  // Convert to Express format
  const expressMethod = method.toLowerCase();
  const expressPath = convertToExpressPattern(path);
  
  // Create Express route
  router[expressMethod](expressPath, async (req, res) => {
    try {
      // Call the generic handler
      const result = await handler({
        queryString: req.url.split('?')[1] || '',
        headers: req.headers,
        params: req.params,
        body: req.body,
        context: createContext(req, res, 'express')
      });
      
      // Send response
      res.status(200).json(result);
    } catch (error) {
      // Handle errors
      handleError(error, req, res);
    }
  });
});
```

### 4. The Handler Function
The handler passed to addRoute is transport-agnostic:
```javascript
const createRouteHandler = (scopeName, methodName) => {
  return async ({ queryString, headers, params, body, context }) => {
    const scope = api.scopes[scopeName];
    
    // Build method parameters
    const methodParams = {};
    if (params.id) methodParams.id = params.id;
    if (body) methodParams.inputRecord = body;
    if (queryString) methodParams.queryParams = parseJsonApiQuery(queryString);
    
    // Call the resource method
    return await scope[methodName](methodParams, context);
  };
};
```

This architecture means:
- The REST plugin doesn't know about Express
- The Express plugin doesn't know about REST semantics
- They communicate through the addRoute hook
- Other transports (Fastify, Koa) can implement the same hook

## Summary

The power of json-rest-api comes from:
1. **Plugin composition** - Each plugin does one thing well
2. **Hook-based extensibility** - Any behavior can be extended
3. **Transport agnosticism** - REST logic is separate from HTTP handling
4. **Pure helpers** - Data operations are predictable and testable

When contributing:
- Identify which plugin your change belongs in
- Use hooks to extend, don't modify core code
- Keep helpers pure
- Follow the established patterns