# 2.3 `belongsTo` relationships

A publisher belongs to a country. In table-backed storage, the publisher holds
the foreign key; several publishers can reference the same country. Use the
[starting script](GUIDE_2_1_The_Starting_Point.md), and insert the JavaScript
blocks below in order before the server starts. Start with a fresh database.

## Define resources and create records

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true, indexed: true }
  }
})
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255 },
    country_id: { type: 'id', belongsTo: 'countries', as: 'country', nullable: true }
  },
  searchSchema: {
    country: { type: 'id', actualField: 'country_id', nullable: true },
    countryCode: { type: 'string', actualField: 'countries.code' }
  }
})
await api.resources.countries.createKnexTable()
await api.resources.publishers.createKnexTable()

const france = await api.resources.countries.post({
  inputRecord: { name: 'France', code: 'FR' }
})
const uk = await api.resources.countries.post({
  inputRecord: { name: 'United Kingdom', code: 'GB' }
})
const frenchPublisher = await api.resources.publishers.post({
  inputRecord: { name: 'French Books Inc.', country: france.id }
})
await api.resources.publishers.post({
  inputRecord: { name: 'Another French Publisher', country: france.id }
})
const britishPublisher = await api.resources.publishers.post({
  inputRecord: { name: 'UK Books Ltd.', country: uk.id }
})
await api.resources.publishers.post({
  inputRecord: { name: 'Global Publishing', country: null }
})
```

Plain writes use the relationship alias `country` inside `inputRecord`.
Do not supply the foreign-key field `country_id` as a public relationship input.
Without an include, the plain response contains `country: { id: france.id }`;
an unassigned to-one relationship is omitted from plain output. JSON:API
represents its linkage with `data: null`.

`country_id` is the logical schema field. Its physical column can differ with
storage configuration. Hooks must follow their stage's context contract instead
of assuming that logical relationship fields are already SQL columns.

## Include related records

```javascript
const includedPublisher = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: { include: ['country'] }
})
console.log('Included country:', includedPublisher.country)

const plainCollection = await api.resources.publishers.query({
  queryParams: { include: ['country'], sort: ['id'] }
})
console.log('Publishers:', plainCollection.data)

const jsonapiCollection = await api.resources.publishers.query({
  format: 'jsonapi',
  queryParams: { include: ['country'], sort: ['id'] }
})
console.log('JSON:API collection:', jsonapiCollection)
```

`includedPublisher.country.name` is `France`. Plain collections still have a
`data` array; included records are embedded into their corresponding parent
objects. JSON:API collections put related records in `included` and keep
identifiers under each primary record's `relationships.country.data`. The two
French publishers share one France entry in that document's `included` array.
The unassigned publisher retains null linkage.

## Select sparse fields

```javascript
const sparsePublisher = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['country'],
    fields: { publishers: 'name,country', countries: 'code' }
  }
})
console.log('Sparse country:', sparsePublisher.country)
```

Include the `country` relationship in the publisher's fieldset when its linkage
must appear. The related country has its ID and code `FR`, without its name.
Sparse fields select output; they are not an authorization policy.

## Filter by a relationship

```javascript
const fromFrance = await api.resources.publishers.query({
  queryParams: { filters: { country: france.id } }
})
const fromUK = await api.resources.publishers.query({
  queryParams: { filters: { countryCode: 'GB' } }
})
const unassigned = await api.resources.publishers.query({
  queryParams: { filters: { country: null } }
})
console.log('French publishers:', fromFrance.data)
console.log('British publishers:', fromUK.data)
console.log('Unassigned publishers:', unassigned.data)
```

The declared `country` filter selects two French publishers, `countryCode`
selects UK Books Ltd., and null selects Global Publishing. `actualField` maps
these public filter names to the ID field or the related resource's code.
Cross-table filtering requires the related code field to declare `indexed: true`.
Filtering does not automatically include the related record's attributes.

## Change or clear the relationship

```javascript
await api.resources.publishers.patch({
  id: britishPublisher.id,
  inputRecord: { country: france.id },
  returning: 'none'
})
await api.resources.publishers.patchRelationship({
  id: britishPublisher.id,
  relationshipName: 'country',
  relationshipData: null
})
const cleared = await api.resources.publishers.getRelationship({
  id: britishPublisher.id, relationshipName: 'country'
})
console.log('Cleared linkage:', cleared.data)
```

PATCH can update an attribute and relationship in the same record operation.
`patchRelationship` takes linkage in `relationshipData`, changes only the named
relationship and returns undefined.
Clearing it requires the relationship to allow null. The example ends with
`cleared.data === null`; linkage reads return a JSON:API linkage document.

## HTTP calls

Generated routes use JSON:API. With the server running and the example's fresh
records, these read commands exercise includes, fieldsets and related filtering.
Use the IDs returned by your server for a persistent database.

```bash
curl --globoff 'http://localhost:3000/api/publishers/1?include=country'
curl --globoff 'http://localhost:3000/api/publishers?include=country&fields[publishers]=name,country&fields[countries]=code'
curl --globoff 'http://localhost:3000/api/publishers?filter[countryCode]=FR'

curl -X PATCH http://localhost:3000/api/publishers/1/relationships/country \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":{"type":"countries","id":"2"}}'
```

The relationship endpoint body is a linkage document, distinct from a resource
PATCH body with `data.type`, `data.id` and `data.relationships`. See the
[API reference](../API.md) for both forms and their error/transaction contracts.

[Previous: searching](GUIDE_2_2_Manipulating_And_Searching_Tables.md) |
[Guide index](index.md) | [Next: hasMany](GUIDE_2_4_HasMany_Records.md)
