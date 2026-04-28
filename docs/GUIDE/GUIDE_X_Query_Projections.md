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

```javascript
import { RestApiPlugin, QueryProjectionsPlugin } from 'json-rest-api'

await api.use(RestApiPlugin, { simplifiedApi: false, simplifiedTransport: false })
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
        "trim(coalesce(??, '') || ' ' || coalesce(??, ''))",
        [column('first_name'), column('last_name')]
      )
    }
  },

  sortableFields: ['id', 'first_name', 'last_name'],
  defaultSort: ['full_name']
})
```

`select()` is called at query time. It can return:

- a `knex.raw(...)` expression
- a Knex reference
- a Knex query/subquery expression

The callback receives:

```javascript
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

## Sparse fieldsets

Query projection fields can be requested explicitly:

```javascript
const result = await api.resources.authors.get({
  id: '1',
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
const result = await api.resources.authors.query({
  queryParams: {
    sort: ['full_name'],
    page: { size: 20 }
  }
})
```

`json-rest-api` automatically appends `id` as a stable tie-breaker for cursor ordering. That prevents duplicate or skipped rows when multiple records share the same projected value.

## Included resources

Query projection fields can be selected for included resources too:

```javascript
const result = await api.resources.books.get({
  id: '1',
  queryParams: {
    include: ['author'],
    fields: {
      books: 'title',
      authors: 'full_name'
    }
  }
})
```

## Write behavior

Query projection fields are output-only. If a client sends them in `POST`, `PUT`, or `PATCH`, they are ignored.

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
