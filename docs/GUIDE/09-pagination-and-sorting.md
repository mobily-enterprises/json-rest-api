---
title: "Pagination and sorting"
chapter: 9
chapter_label: "09"
---

# 09. Pagination and sorting

Pagination applies to the collection queried. A publisher query pages publishers;
a publisher's to-many `getRelated` call pages its related records. Including
children does not make the parent's page options paginate those children.

Insert these blocks into the [starting script](03-running-example.md)
on a fresh database, before the server starts.

## Define a stable ordering

```javascript
await api.addResource('countries', {
  queryDefaultLimit: 2,
  queryMaxLimit: 3,
  defaultSort: ['name'],
  schema: {
    name: { type: 'string', required: true, search: true },
    code: { type: 'string', required: true }
  }
})
await api.resources.countries.createKnexTable()
for (const [name, code] of [
  ['France', 'FR'], ['Germany', 'DE'], ['Austria', 'AT'],
  ['Italy', 'IT'], ['United Kingdom', 'GB']
]) {
  await api.resources.countries.post({ data: { name, code }, returning: 'none' })
}
```

The resource default sorts by name. A query may override it using
`queryParams.sort`, for example `['-name']` for descending order. An ID tie-breaker
provides stable ordering where the selected values are equal. `defaultSort`
accepts a string or an array of strings; object-shaped defaults are rejected.

Values that may be NULL sort after every other value, in either direction. The
ID, and on table storage a `required` attribute that is not `nullable`, holds no
NULL and sorts without that placement, so an index ending with the sort columns
serves its pages in either direction on every database: an index on
`(authorId, id)` serves books filtered by author and sorted by `-id`. A
descending sort on another field still breaks ties by ascending ID; end it with
`-id`, as in `['-name', '-id']`, to read it from a `(name, id)` index. Other sort
values keep the placement: nullable attributes, attributes with a setter,
serializer or `nullOnEmpty`, relationship fields, query projections and AnyAPI
attributes (a field added later leaves existing records' slots empty).
PostgreSQL then reads only ascending sorts from a plain index; MariaDB, and
MySQL on a nullable column, sort the matching rows.

## Default limits and numbered pages

```javascript
const defaultPage = await api.resources.countries.query({})
const numbered = await api.resources.countries.query({
  queryParams: { page: { number: 2, size: 2 } }
})
const emptyPage = await api.resources.countries.query({
  queryParams: { page: { number: 10, size: 2 } }
})
console.log('Default records:', defaultPage.data)
console.log('Second page:', numbered.data)
console.log('Numbered metadata:', numbered.meta.pagination)
console.log('Beyond the last page:', emptyPage.data)
```

Omitted page options, or `page: {}`, use the capped default limit and omit
pagination metadata. Here, the default result is Austria and France.
`page: { number: 2, size: 2 }` selects Germany and Italy. With pagination counts
enabled, metadata is:

```json
{ "page": 2, "pageSize": 2, "pageCount": 3, "total": 5, "hasMore": true }
```

Page 10 returns an empty array. `enablePaginationCounts: false` suppresses the
count query and count-derived metadata (`total`, `pageCount` and the `last`
link); do not assume every collection response contains totals. The page then
reads one extra row, so `hasMore` and the `next` link remain, and a numbered
page costs one statement. Every mode respects `queryMaxLimit`.

Server code that reads every row, for example an export or a nightly job, can
raise the cap for one call with `pageSizeLimit`, a parameter beside
`queryParams`: `query({ queryParams: { page: { size: 1000 } }, pageSizeLimit: 1000 })`
reads up to 1,000 rows a page, so each page's row policy and linkage checks run
once per 1,000 rows instead of once per `queryMaxLimit`. The transports never
pass it, so HTTP and Socket.IO page sizes stay capped by `queryMaxLimit`.

## Cursor pages

```javascript
const firstCursorPage = await api.resources.countries.query({
  queryParams: { sort: ['name'], page: { size: 2 } }
})
const nextCursor = firstCursorPage.meta.pagination.cursor.next
const secondCursorPage = await api.resources.countries.query({
  queryParams: { sort: ['name'], page: { size: 2, after: nextCursor } }
})
console.log('First cursor page:', firstCursorPage.data)
console.log('Second cursor page:', secondCursorPage.data)
```

`page: { size: 2 }` starts cursor pagination. It returns Austria and France;
the next page returns Germany and Italy. Cursor pages report `hasMore` and,
when available, an opaque next cursor under `meta.pagination.cursor.next`.
They do not count the collection. Treat cursors as opaque and keep the same sort,
filters and fields when continuing. Returned links preserve those options.

Use `after` or `before` with a returned cursor. Do not combine either boundary
with `number`, supply both boundaries, or use an empty cursor string. Omitted
page sizes use the resource default; explicitly keep the chosen size when
constructing the next call yourself.

## Sparse fields and ordering

```javascript
const sparse = await api.resources.countries.query({
  queryParams: {
    fields: { countries: 'code' },
    sort: ['name'],
    page: { size: 2 }
  }
})
const nextSparse = await api.resources.countries.query({
  queryParams: {
    fields: { countries: 'code' },
    sort: ['name'],
    page: { size: 2, after: sparse.meta.pagination.cursor.next }
  }
})
console.log('Sparse first page:', sparse.data)
console.log('Sparse second page:', nextSparse.data)
```

The first sparse page contains IDs and codes AT/FR; the second contains DE/IT.
The library retains the sort values needed internally without exposing omitted
fields in the response. Sparse output is not permission to sort by hidden fields.

Stored attributes, logical IDs and SQL query projections keep their own sort
meaning when a search filter with the same name points elsewhere. A distinct
sortable search alias can target a scalar stored field. Cursor values and
relationship include `orderBy` follow the same field-resolution rules.

## Derived and structured values

Use [query projections](15-query-projections.md) when a derived SQL value
must participate in sorting and cursors. JavaScript computed fields run after
fetching and are not a replacement for SQL ordering.

Object and array fields do not define a generic whole-document order. They are
excluded from default sortable fields; explicitly making them sortable or using
them in a default sort rejects schema compilation. Project a scalar JSON value
when that is the intended ordering, and verify the SQL on your chosen backend.
Stored SQL values drive cursor comparison; getters format returned values.

## HTTP examples

```bash
curl --globoff 'http://localhost:3000/api/countries?page[number]=2&page[size]=2&sort=name'
curl --globoff 'http://localhost:3000/api/countries?page[size]=2&sort=name'
curl --globoff 'http://localhost:3000/api/countries?page[size]=2&sort=name&fields[countries]=code'
```

HTTP responses are JSON:API documents. Follow their returned links to continue
pagination, preserving filters, fields, sort and size. See the
[migration contract](33-migrating-to-v2.md#pagination-modes-and-counts) for removed
options and count behavior.
