# Writing Plugins

`json-rest-api` is built as a set of plugins on top of `hooked-api`. This guide covers the public extension surface for plugin authors.

Use this guide when you want to:

- add resource-level behavior across many resources
- add new scope methods
- compile resource metadata into reusable runtime state
- hook into query or write processing

For internal architecture notes and maintainer-oriented details, see docs/ONBOARDING.md (source checkout: `docs/ONBOARDING.md`).

## Minimal plugin shape

These three blocks form a runnable example. Add them to the
[starting script](GUIDE_2_1_The_Starting_Point.md) after installing storage,
before starting the server, on a fresh database. Later snippets are fragments
for a plugin's `install` function.

```javascript
const MyPlugin = {
  name: 'my-plugin',
  dependencies: ['rest-api'],
  install ({ addHook, addScopeMethod }) {
    addHook('beforeSchemaValidate', 'trim-example-name', {}, ({ context }) => {
      const attributes = context.inputRecord?.data?.attributes
      if (typeof attributes?.name === 'string') attributes.name = attributes.name.trim()
    })
    addHook('scope:added', 'compile-my-plugin', {}, ({ context, scopes }) => {
      const scope = scopes[context.scopeName]
      scope.vars.myPlugin = { enabled: context.scopeOptions.exampleFlag === true }
    })
    addScopeMethod('describeExample', async ({ scopeName, scope }) => ({
      scopeName, enabled: scope.vars.myPlugin.enabled
    }))
  }
}
await api.use(MyPlugin)
```

Install registration hooks before registering the resources they configure.

```javascript
await api.addResource('authors', {
  schema: { name: { type: 'string', required: true } },
  exampleFlag: true
})
await api.addResource('publishers', {
  schema: { name: { type: 'string', required: true } }
})
await api.resources.authors.createKnexTable()
await api.resources.publishers.createKnexTable()
```

The custom method is available on each resource, with resource-specific state.

```javascript
const authorDescription = await api.resources.authors.describeExample()
const publisherDescription = await api.resources.publishers.describeExample()
const createdAuthor = await api.resources.authors.post({
  format: 'plain', inputRecord: { name: '  Ada  ' }
})
console.log(authorDescription, publisherDescription, createdAuthor)
```

The first result is `{ scopeName: 'authors', enabled: true }`; the second is
`{ scopeName: 'publishers', enabled: false }`. The created author's `name` is
`'Ada'`: the hook trims the declared attribute before attribute validation and
storage.
Export `MyPlugin` as a named
export when moving the declaration into its own module.

The usual pattern is:

1. compile resource metadata during `scope:added`
2. store normalized state in `scope.vars`
3. use hooks or scope methods to apply behavior at runtime

## The stable extension points

### `scope:added`

Use this to inspect `scopeOptions`, validate configuration, and compile resource-specific runtime state into `scope.vars`.

Typical uses:

- initialize resource-specific extension state
- validate non-schema resource options

Declare fields during `schema:enrich` (or `computedSchema:enrich` for computed
fields). Use `schema:compiled` for work that needs the compiled schema, such
as autofilter configuration; do not add fields after compilation.

Example:

```js
addHook('scope:added', 'compile-example', {}, ({ context, scopes }) => {
  const scope = scopes[context.scopeName]
  const options = context.scopeOptions || {}

  scope.vars.example = {
    flag: options.exampleFlag === true
  }
})
```

### `beforeSchemaValidate`

Use this to normalize attribute values before attribute schema validation runs.
Request document validation and relationship processing have already begun.
Use the earlier `beforeProcessing` stage if an extension must change the input
structure before those checks, and validate any untrusted shape it reads.

Typical uses:

- inject derived input values
- apply attribute-level business checks

This hook cannot make an otherwise rejected request document valid retroactively.

The complete example above trims a declared string attribute here. It does not
attempt to remove an unknown field after request validation has rejected it.
For stage order and available context, use the
[write lifecycle reference](GUIDE_7_Hooks_Data_Management_And_Plugins.md#resource-write-order).

### `knexQueryFiltering`

Use this to add query constraints to the generated Knex query.

Typical uses:

- automatic scoping
- cross-table filters
- custom public filter semantics

The hook receives the current builder through `context.knexQuery.query`,
along with its `scopeName` and `tableName`. It also runs for nested queries.
Raw column names are unsafe to assume: ordinary resources can map logical fields
to different columns, and canonical resources use storage slots and aliases.

For equality scoping and write stamping, use
[AutoFilterPlugin](GUIDE_X_Autofiltering.md). For mandatory resource visibility,
use [RowPolicyPlugin](GUIDE_X_Row_Policies.md), whose policy context supplies
logical column/value translation and query-purpose metadata. For a public
client-selected filter, use the
[custom search filter contract](GUIDE_2_2_Manipulating_And_Searching_Tables.md).
These mechanisms avoid duplicating storage translation in application hooks.

A filtering hook does not turn an ad hoc SQL alias into a declared field;
use the query-field contract below for selected or sortable derived values.

### `addScopeMethod`

Use this when a plugin needs a reusable method on every resource or selected resources.

Example:

```js
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

Declare query fields during the existing schema-enrichment stage:

```js
addHook('schema:enrich', 'declare-uppercase-name', {}, ({ context }) => {
  if (context.scopeName !== 'authors') return
  context.queryFields.uppercase_name = {
    type: 'string',
    sortable: true,
    select: ({ knex, column }) => knex.raw('upper(??)', [column('first_name')])
  }
})
```

Install the hook before registering resources. Core normalizes the final map
and rejects names that collide with attributes, computed fields, relationships
or logical IDs. If another declaration hook replaces the map, order this hook
after that one. The published definitions are available at
`scope.vars.schemaInfo.queryFields`; do not mutate a separate `vars.queryFields`
map. Canonical `addKnexFields` recompiles declarations and dependencies before
publication. SQL callbacks are still evaluated with each query's context.

### What core does with compiled query fields

Core will:

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
2. declare schema metadata during its enrichment stage; use `scope:added` for other registration work
3. store only normalized runtime state in `scope.vars`
4. use hooks or scope methods to apply behavior

That keeps the plugin declarative and avoids re-parsing configuration during requests.

## Boundaries to keep clean

- Keep **query-layer** extensions out of `schema`.
- Choose input hooks according to the [write lifecycle](GUIDE_7_Hooks_Data_Management_And_Plugins.md#resource-write-order).
- Keep **filtering** in `knexQueryFiltering`.
- Keep **response-only** enrichment in `enrichAttributes`.
- Do not rely on arbitrary internal helper filenames as public API.

If a feature requires deeper integration than the public seams provide, treat that as a core extension discussion rather than a plugin hack.
