# Query Projections

Query projections are SQL-backed, output-only query fields provided by the optional `QueryProjectionsPlugin`. They are different from normal computed fields.

If you want to build your own plugin on the same query-field seam, see [Writing Plugins](GUIDE_X_Writing_Plugins.md).

- **Computed fields** run after the row is fetched, in JavaScript.
- **Projected fields** are selected inside the query, so they can participate in `SELECT`, `ORDER BY`, and cursor pagination.

Use query projection fields when a derived value must behave like a real list field.

Typical cases:
- sorting by a derived label such as `full_name`
- cursor pagination over a derived value
- returning a derived SQL value without storing it

Do **not** use query projection fields for normal response decoration. Regular computed fields are simpler and remain the right default for that.

## Setup

The six executable blocks below form one scenario. Add them to the
[starting script](GUIDE_2_1_The_Starting_Point.md) after REST/storage installation,
before starting the server, on a fresh database. Other code blocks are
configuration fragments.

```javascript
import { QueryProjectionsPlugin } from 'json-rest-api'
await api.use(QueryProjectionsPlugin)
```

## Defining a query field

```javascript
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    first_name: { type: 'string', required: true },
    last_name: { type: 'string', required: true }
  },

  queryFields: {
    full_name: {
      type: 'string',
      sortable: true,
      select: ({ knex, column }) => knex.raw(
        knex.client.config.client === 'mysql2'
          ? "trim(concat(coalesce(??, ''), ' ', coalesce(??, '')))"
          : "trim(coalesce(??, '') || ' ' || coalesce(??, ''))",
        [column('first_name'), column('last_name')]
      )
    }
  },

  sortableFields: ['id', 'first_name', 'last_name'],
  defaultSort: ['full_name']
})
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author', nullable: true }
  }
})
await api.resources.authors.createKnexTable()
await api.resources.books.createKnexTable()
```

The expression uses `concat` for MySQL and `||` for SQLite/PostgreSQL. `column`
resolves logical fields to the selected storage representation.

```javascript
const jane = await api.resources.authors.post({ format: 'plain', inputRecord: { first_name: 'Jane', last_name: 'Doe' } })
await api.resources.authors.post({ format: 'plain', inputRecord: { first_name: 'John', last_name: 'Adams' } })
await api.resources.authors.post({ format: 'plain', inputRecord: { first_name: 'Jane', last_name: 'Smith' } })
const book = await api.resources.books.post({ format: 'plain', inputRecord: { title: 'Projection example', author: jane.id } })
```

`select()` is called at query time. It can return:

- a `knex.raw(...)` expression
- a Knex reference
- a Knex query/subquery expression

Return the expression directly from a synchronous callback. Knex raw values,
references and query builders are thenable: returning them from an `async`
callback or awaiting them can execute SQL instead of supplying an expression.
For example, use `select: ({ knex }) => knex.raw('?', [1])`, without `async`.

Definitions are compiled into `scope.vars.schemaInfo.queryFields` during schema
enrichment. Projection names cannot collide with stored/computed fields,
relationship names or logical ID names. Canonical field additions repeat these
checks before publishing a replacement schema. SQL expressions remain local to
each query; compiled definitions do not cache request-dependent SQL.

Getters and computed fields can declare projection names as dependencies. The
projection is selected before JavaScript callbacks run, including through a
chain of dependencies in a sparse fieldset. A projection needed only as an input
is removed from output unless selected and visible. Install the declaration
plugin before resource registration so dependencies can be validated.

The callback receives:

```js
{
  knex,      // current knex/db handle
  db,        // same as knex
  context,   // request context
  scopeName,
  tableName,
  fieldName,
  schemaInfo,
  adapter,   // storage adapter
  column,    // helper: logical field -> qualified storage column
  ref        // helper: logical field -> knex ref
}
```

## Behavior

Query projection fields are:

- returned by default in `get()` and `query()`
- available in sparse fieldsets
- usable in sorting and cursor pagination
- available on included resources
- ignored on writes

They are **not** stored columns, and they are **not** part of write validation.

A failed `select()` callback or rejected promise rejects the operation. On reads,
typed API errors retain their identity; unexpected errors are wrapped with the
resource/field context and the original thrown value as `cause`, including
non-Error values. Included projection failures also reject GET/query instead of
returning a partial response. During a full write response, the failure occurs
before an owned transaction commits; the public `RestApiWriteError` retains the
failure as its cause and reports the transaction outcome. A borrowed transaction
remains its owner's responsibility.

## Sparse fieldsets

Query projection fields can be requested explicitly:

```javascript
const sparse = await api.resources.authors.get({
  id: jane.id, format: 'jsonapi',
  queryParams: {
    fields: {
      authors: 'first_name,full_name'
    }
  }
})
```

If a query field is needed only for sorting, it is still selected internally, but it is removed from the response unless the sparse fieldset asked for it.

## Sorting and cursor pagination

Query projection fields are useful when a derived value must drive list behavior:

```javascript
const firstPage = await api.resources.authors.query({
  format: 'jsonapi',
  queryParams: { sort: ['full_name'], page: { size: 2 } }
})
const nextPage = await api.resources.authors.query({
  format: 'jsonapi',
  queryParams: { sort: ['full_name'], page: { size: 2, after: firstPage.meta.pagination.cursor.next } }
})
```

`json-rest-api` automatically appends `id` as a stable tie-breaker for cursor ordering. That prevents duplicate or skipped rows when multiple records share the same projected value.

Projection cursors retain the SQL expression's value before output formatting
and bind it directly on the next request. This also preserves precise timestamps
beyond the built-in millisecond write limit:

```js
queryFields: {
  preciseTimestamp: {
    type: 'dateTime',
    temporalPrecision: 6,
    sortable: true,
    select: ({ knex, column }) => knex.raw('??', [column('recordedAt')])
  }
}
```

Projections cannot declare `storage`, `setter`, or `runSetterAfter`; compilation
rejects those options. Use the stored field's serializer when writing that field.
For projection output formatting, use `getter` and optional `runGetterAfter`.
The shared dependency order awaits projection getters before dependent getters
or computed fields, and sparse reads fetch their declared dependencies. Hidden
dependencies remain hidden in the response. Getter failures propagate as read
errors. Neither getters nor response formatting change SQL ordering or cursors.
Always follow returned cursors/links without rebuilding them from attributes.
See [temporal migration requirements](MIGRATING_API_V2.md#temporal-formatting-and-native-databases)
for UTC bindings, fractional precision and existing AnyAPI data.

Structured (`object`/`array`) projections are output fields and cannot be marked
sortable. Select a scalar JSON key in a separate typed projection when it should
drive ordering or cursors. PostgreSQL structured selections use `to_jsonb` to
support `DISTINCT` parent queries; this does not alter application tables.
See [querying structured attributes](MIGRATING_API_V2.md#querying-structured-attributes)
for bound SQL examples and custom-filter migration.

Hidden projections cannot be sortable or appear in resource/include sort
configuration: cursors contain the selected SQL value. Use `normallyHidden`
for a publicly readable projection that should be omitted by default but remain
sortable. A `hidden` projection can still supply a getter/computed dependency.
See [hidden sort migration](MIGRATING_API_V2.md#hidden-sort-fields).

## Included resources

Without a target fieldset, includes select all visible projections and the
dependencies of getters and computed fields. This applies to to-one, to-many
and polymorphic includes in both storage modes, even before the target's first
direct read. A sparse fieldset returns only the requested fields; dependencies
selected solely for a callback are removed from the response.

Query projection fields can be selected for included resources too:

```javascript
const included = await api.resources.books.get({
  id: book.id, format: 'jsonapi',
  queryParams: {
    include: ['author'],
    fields: {
      books: 'title,author',
      authors: 'full_name'
    }
  }
})
```

## Write behavior

Query projection fields are output-only. If a client sends them in `POST`, `PUT`, or `PATCH`, they are ignored.

The configured logger receives a bounded warning with the operation, resource,
validation phase and total ignored-field count. It does not include submitted
attribute values. A failure to write this advisory warning does not reject the
operation.

That keeps the boundary clean:

- persisted fields own storage
- computed fields own response-layer enrichment
- query projection fields own query-layer derivation

## Limits

Projected fields are an advanced query feature. They are intentionally **backend-sensitive**.

Important limits:

- projection SQL can be dialect-specific
- this is not a portability layer across every SQL engine
- query projection fields are not auto-searchable
- if you want to sort by one, mark it `sortable: true`

For display-only derived values, prefer normal computed fields from [Field Transformations](GUIDE_3_Field_Transformations.md).
