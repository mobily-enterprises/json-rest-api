# Generated resource labels

Install `LabelPlugin` after `RestApiPlugin` and before adding resources:

```js
import { LabelPlugin } from 'json-rest-api'

await api.use(LabelPlugin, { preferNameFields: ['name', 'title'] })
```

It adds a computed string `label` to resources that do not already declare one.
The label is derived during reads and is not a stored column. GET, query, full
write responses and included resources use the same computation in both plain
and JSON:API formats.

Candidates are derived during schema compilation, after attribute and search
enrichment. Canonical `addKnexFields` rebuilds them from the new configuration,
so a field addition retains the label and an added preferred/global-search
source becomes eligible. Reads and descriptor-only refreshes reuse the compiled
candidates. Ordinary Knex field-addition helpers perform DDL only; changing
their runtime declarations still requires resource initialization.

The plugin considers, in order:

1. The first global-search field that resolves to a public stored field on this
   resource. A search alias uses its `actualField`; a joined search path is not
   a local label source.
2. String fields listed in `preferNameFields`, in the configured order.
3. The first public stored string field in the schema.
4. The resource's logical ID.

Null and undefined values fall through to the next candidate. Empty strings,
zero and false are retained and converted to strings. Getters run before label
computation. Hidden, normally hidden and virtual fields, belongs-to foreign keys
and polymorphic backing fields are not automatic label sources. This keeps the default label from exposing private values or depending
on a transient write input.

Sparse fieldsets can select just the label:

```js
await api.resources.books.query({
  format: 'jsonapi',
  queryParams: { fields: { books: 'label' } }
})
```

The existing computed-field dependency mechanism fetches the candidate values
and removes unrequested dependencies from the result. Null fallbacks therefore
work with sparse fieldsets too. Pass `{ disable: true }` when installing the
plugin to disable automatic labels.

## Authored labels and record identity

An explicitly declared stored or computed `label` remains authoritative. The
plugin does not remove its schema definition or replace its computation. For
example, a resource may declare:

```js
label: {
  type: 'string',
  computed: true,
  dependencies: ['title'],
  compute: ({ id, attributes }) => `${id}: ${attributes.title ?? ''}`
}
```

Computed callbacks receive the current resource's public logical `id` separately
from `attributes`. This also works for custom `idProperty` names, collections
and included resources; the ID is not taken from the parent request. Direct
callers of `enrichAttributes` can supply its `id` argument explicitly.

Computed fields honor `hidden` and `normallyHidden` like stored fields: hidden
fields are omitted, and normally hidden fields appear only when requested.
Authors who intentionally derive a public value from normally hidden dependencies should
declare that computed field explicitly and review the information it returns.

The shared label suite (source checkout: `tests/conformance-labels.test.js`) checks these
contracts on regular and canonical storage. The
[migration guide](MIGRATING_API_V2.md#generated-labels-and-computed-visibility)
describes corrections from the earlier behavior.
