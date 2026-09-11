# 2.2 Manipulating and searching tables

This example uses countries without relationships. Insert the blocks below in
order into the [starting script](GUIDE_2_1_The_Starting_Point.md), with a fresh
database and before starting the HTTP server.

## Declare the record and search schemas

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, nullable: true, unique: true, search: true },
    population: { type: 'number', nullable: true }
  },
  searchSchema: {
    name: { type: 'string', filterOperator: '=' },
    nameContains: { type: 'string', actualField: 'name', filterOperator: 'contains' },
    populationRange: { type: 'array', actualField: 'population', filterOperator: 'between' },
    words: {
      type: 'string', oneOf: ['name', 'code'],
      filterOperator: 'contains', splitBy: ' ', matchAll: true
    },
    nameOrCode: {
      type: 'string',
      applyFilter (query, input, { column }) {
        query.where(function () {
          this.whereRaw('LOWER(??) LIKE LOWER(?)', [column('name'), `%${input}%`])
            .orWhereRaw('LOWER(??) = LOWER(?)', [column('code'), input])
        })
      }
    }
  }
})
await api.resources.countries.createKnexTable()
```

The record schema validates stored data. `searchSchema` declares public filter
names and their meaning. An explicit search field overrides the same field
inferred from `search: true`; other inferred fields remain available. Here,
`name` explicitly uses equality and `code` remains searchable through its marker.
The record's `population` field is searchable through `populationRange` only.

Filter names need not be column names. `actualField` maps an alias to a logical
resource field. `oneOf` applies a filter across several fields. Search schemas
are an allowlist and input-validation contract, not arbitrary client-supplied SQL.

## Create, patch, replace and delete records

```javascript
const france = await api.resources.countries.post({
  inputRecord: { name: 'France', code: 'FR', population: 68 }
})
const italy = await api.resources.countries.post({
  inputRecord: { name: 'Italyy', code: 'IT', population: 59 }
})
const germany = await api.resources.countries.post({
  inputRecord: { name: 'Germ', code: 'DE', population: 84 }
})
await api.resources.countries.patch({
  id: germany.id, inputRecord: { name: 'Germany' }, returning: 'none'
})
const patched = await api.resources.countries.get({ id: germany.id })
const replaced = await api.resources.countries.put({
  id: italy.id, inputRecord: { name: 'Italy', code: null, population: null }
})
console.log('Patched:', patched)
console.log('Replaced:', replaced)
await api.resources.countries.delete({ id: italy.id })
```

These population values are illustrative numbers for demonstrating filters.
PATCH changes the supplied name while retaining Germany's code and population.
PUT replaces Italy's record and explicitly clears its nullable fields. A
replacement must include attributes that already have values; omitting them
rejects with a complete-replacement validation error. Use null explicitly when
the schema permits clearing a value. PUT can also create a missing target. DELETE returns
undefined. Writes always place record attributes inside `inputRecord`.

## Query and filter

```javascript
await api.resources.countries.post({
  inputRecord: { name: 'United States', code: 'US', population: 330 }
})
await api.resources.countries.post({
  inputRecord: { name: 'United Kingdom', code: 'GB', population: 67 }
})
await api.resources.countries.post({
  inputRecord: { name: 'Austria', code: 'AT', population: 9 }
})
const exact = await api.resources.countries.query({
  queryParams: { filters: { name: 'France' } }
})
const byCode = await api.resources.countries.query({
  queryParams: { filters: { code: 'DE' } }
})
const contains = await api.resources.countries.query({
  queryParams: { filters: { nameContains: 'United' }, sort: ['name'] }
})
const range = await api.resources.countries.query({
  queryParams: { filters: { populationRange: [60, 90] }, sort: ['name'] }
})
console.log('Exact:', exact.data)
console.log('By code:', byCode.data)
console.log('Contains:', contains.data)
console.log('Range:', range.data)
```

The results are France, Germany, the two United countries, and France/Germany/
United Kingdom respectively. Query returns an object with a `data` array, not a
bare array. Pagination metadata is supplied for explicit pagination requests;
it is not guaranteed on every collection. Multiple filter keys combine as
constraints. The selected operator and database collation determine string
comparison behavior; avoid assuming all databases ignore case.

## Search multiple fields and words

```javascript
const allWords = await api.resources.countries.query({
  queryParams: { filters: { words: 'United US' } }
})
const custom = await api.resources.countries.query({
  queryParams: { filters: { nameOrCode: 'at' }, sort: ['name'] }
})
console.log('All words:', allWords.data)
console.log('Custom filter:', custom.data)
```

`words` splits on spaces and requires every term to match at least one of name
or code. `United US` matches United States: one term matches its name, the other
its code. Setting `matchAll: false` would allow any term to match.

The custom filter searches a case-folded name substring or an exact case-folded
code. It finds Austria and United States for `at`, not United Kingdom.
`applyFilter(query, input, { column, value, context, scopeName })` runs
synchronously and mutates the supplied Knex builder. `column(field)` translates
logical fields and `value(field, input)` converts values for their storage
representation. Group OR conditions so they do not bypass other filters or
access constraints. This example binds user input as values; SQL LIKE wildcard
characters in that input retain their SQL meaning. Custom SQL functions and
collations must be verified on the database you deploy.

## Select fields and paginate

```javascript
const page = await api.resources.countries.query({
  queryParams: {
    fields: { countries: 'name,code' },
    sort: ['name'],
    page: { number: 1, size: 2 }
  }
})
console.log('Selected fields:', page.data)
console.log('Pagination:', page.meta.pagination)
```

This returns Austria and France, with IDs, names and codes but no populations.
The numbered pagination total is five. Fieldsets select output and do not grant
access to hidden fields. See [pagination and ordering](GUIDE_2_7_Pagination_And_Ordering.md)
for cursors and collection limits.

## HTTP queries

With the example server running:

```bash
curl --globoff 'http://localhost:3000/api/countries?filter[nameContains]=United'
curl --globoff 'http://localhost:3000/api/countries?filter[words]=United%20US'
curl --globoff 'http://localhost:3000/api/countries?fields[countries]=name,code&page[number]=1&page[size]=2&sort=name'
```

HTTP filters use `filter[...]`; programmatic queries use `queryParams.filters`.
Generated HTTP responses are JSON:API documents. For payload changes from the
older API, use the [migration guide](MIGRATING_API_V2.md).

[Previous: starting point](GUIDE_2_1_The_Starting_Point.md) |
[Guide index](index.md) | [Next: belongsTo](GUIDE_2_3_BelongsTo_Relationships.md)
