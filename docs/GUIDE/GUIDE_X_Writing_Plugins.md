# Writing Plugins

`json-rest-api` is built as a set of plugins on top of `hooked-api`. This guide covers the public extension surface for plugin authors.

Use this guide when you want to:

- add resource-level behavior across many resources
- add new scope methods
- compile resource metadata into reusable runtime state
- hook into query or write processing

For internal architecture notes and maintainer-oriented details, see [docs/ONBOARDING.md](../ONBOARDING.md).

## Minimal plugin shape

```javascript
export const MyPlugin = {
  name: 'my-plugin',
  dependencies: ['rest-api'],

  install ({ addHook, addScopeMethod, helpers, log, pluginOptions = {} }) {
    addHook('scope:added', 'compile-my-plugin', {}, ({ context, scopes }) => {
      const scope = scopes[context.scopeName]
      scope.vars.myPlugin = { enabled: true }
    })

    addScopeMethod('doSomething', async ({ scopeName, scope, params, context }) => {
      return { scopeName, enabled: scope.vars.myPlugin?.enabled === true }
    })
  }
}
```

The usual pattern is:

1. compile resource metadata during `scope:added`
2. store normalized state in `scope.vars`
3. use hooks or scope methods to apply behavior at runtime

## The stable extension points

### `scope:added`

Use this to inspect `scopeOptions`, validate configuration, and compile resource-specific runtime state into `scope.vars`.

Typical uses:

- compile autofilter presets
- compile query-field definitions
- validate resource-specific options

Example:

```javascript
addHook('scope:added', 'compile-example', {}, ({ context, scopes }) => {
  const scope = scopes[context.scopeName]
  const options = scope.scopeOptions || {}

  scope.vars.example = {
    flag: options.exampleFlag === true
  }
})
```

### `beforeSchemaValidate`

Use this to normalize or strip write input before schema validation runs.

Typical uses:

- inject derived input values
- remove output-only fields from `POST`/`PUT`/`PATCH`
- translate alternate request forms into canonical attributes/relationships

Example:

```javascript
addHook('beforeSchemaValidate', 'strip-output-only-input', {}, ({ context }) => {
  const attributes = context.inputRecord?.data?.attributes
  if (!attributes) return

  delete attributes.output_only_field
})
```

### `knexQueryFiltering`

Use this to add query constraints to the generated Knex query.

Typical uses:

- automatic scoping
- cross-table filters
- custom public filter semantics

Example:

```javascript
addHook('knexQueryFiltering', 'scope-by-workspace', {}, async ({ context }) => {
  const query = context.knexQuery?.query
  if (!query) return

  query.where('workspace_id', context.session.workspaceId)
})
```

`knexQueryFiltering` is the right seam for filtering. It is **not** the right seam for turning ad hoc SQL aliases into first-class fields.

### `addScopeMethod`

Use this when a plugin needs a reusable method on every resource or selected resources.

Example:

```javascript
addScopeMethod('introspect', async ({ vars }) => {
  return {
    tableName: vars.schemaInfo?.tableName,
    fields: Object.keys(vars.schemaInfo?.schemaStructure || {})
  }
})
```

## The query-field seam

`json-rest-api` now supports a small, explicit seam for **query-only read fields**.

This is the seam used by `QueryProjectionsPlugin`, and it is the recommended pattern for plugins that need derived SQL-backed fields.

### What a plugin should provide

Compile resource-level definitions into:

```javascript
scope.vars.queryFields = {
  full_name: {
    type: 'string',
    sortable: true,
    hidden: false,
    normallyHidden: false,
    select: ({ knex, db, context, scopeName, tableName, fieldName, schemaInfo, adapter, column, ref }) => {
      return knex.raw(
        "trim(coalesce(??, '') || ' ' || coalesce(??, ''))",
        [column('first_name'), column('last_name')]
      )
    }
  }
}
```

### What core will do with `scope.vars.queryFields`

Once a plugin sets `scope.vars.queryFields`, core will:

- include visible query fields by default in `get()` and `query()`
- allow them in sparse fieldsets
- allow them in sorting when the plugin marks them sortable
- use them in cursor pagination with a stable `id` tie-breaker
- carry them through included-resource selection
- only expose declared query-field aliases on the AnyAPI path

### What this seam is for

Use it for:

- SQL-backed projections
- aggregate list fields
- joined display labels
- derived fields that must participate in `ORDER BY`

Do **not** use it for:

- writable fields
- storage/schema ownership
- migrations or introspection
- normal response-only computed fields

For the concrete projection example, see [Query Projections](GUIDE_X_Query_Projections.md).

## Recommended plugin pattern

When you add a new plugin feature, prefer this flow:

1. read plugin options at install time
2. validate and compile per-resource config in `scope:added`
3. store only normalized runtime state in `scope.vars`
4. use hooks or scope methods to apply behavior

That keeps the plugin declarative and avoids re-parsing configuration during requests.

## Boundaries to keep clean

- Keep **query-layer** extensions out of `schema`.
- Keep **write/input** reshaping in `beforeSchemaValidate`.
- Keep **filtering** in `knexQueryFiltering`.
- Keep **response-only** enrichment in `enrichAttributes`.
- Do not rely on arbitrary internal helper filenames as public API.

If a feature requires deeper integration than the public seams provide, treat that as a core extension discussion rather than a plugin hack.
