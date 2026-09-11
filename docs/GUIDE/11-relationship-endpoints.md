---
title: "Relationship endpoints"
chapter: 11
chapter_label: "11"
---

# 11. Relationship endpoints

Relationship methods are part of `RestApiPlugin`; no extra relationship plugin
is required. Install a storage plugin and an HTTP connector before registering
resources. Configure the connector's `mountPath`, for example `/api`, as in the
[quickstart](../QUICKSTART.md).

There are two kinds of read endpoint:

| Endpoint | Programmatic method | Response |
| --- | --- | --- |
| `/api/publishers/1/relationships/authors` | `getRelationship` | JSON:API identifier linkage |
| `/api/publishers/1/authors` | `getRelated` | Related resource records |

A linkage read returns a document even when programmatic record format is plain.
A related read respects `format`: plain to-one reads return a record or null,
plain to-many reads return a collection with `data`, and JSON:API reads return
a document. Related reads apply the target's fields, filtering and pagination;
they do not promise every related record in a single response.

## Set up a runnable example

Insert these blocks into the [starting script](03-running-example.md)
on a fresh database, before the HTTP server starts.

```javascript
await api.addResource('publishers', {
  schema: { name: { type: 'string', required: true } },
  relationships: { authors: { type: 'hasMany', target: 'authors', foreignKey: 'publisher_id' } }
})
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  }
})
await api.resources.publishers.createKnexTable()
await api.resources.authors.createKnexTable()
const publisher = await api.resources.publishers.post({ inputRecord: { name: 'Scribner' } })
const stephen = await api.resources.authors.post({ inputRecord: { name: 'Stephen King' } })
const peter = await api.resources.authors.post({ inputRecord: { name: 'Peter Straub' } })
```

The inverse relationships are explicitly declared. A `belongsTo` field does not
automatically create an arbitrary reverse `hasOne` or `hasMany` endpoint.

## Add membership and read each representation

```javascript
await api.resources.publishers.postRelationship({
  id: publisher.id,
  relationshipName: 'authors',
  relationshipData: [
    { type: 'authors', id: stephen.id },
    { type: 'authors', id: peter.id }
  ]
})
const linkage = await api.resources.publishers.getRelationship({
  id: publisher.id, relationshipName: 'authors'
})
const related = await api.resources.publishers.getRelated({
  id: publisher.id,
  relationshipName: 'authors',
  queryParams: { fields: { authors: 'name' }, sort: ['name'] }
})
console.log('Identifiers:', linkage.data)
console.log('Records:', related.data)
```

Linkage contains `{ type: 'authors', id }` identifiers. Related records contain
IDs and names, ordered Peter then Stephen. Relationship-only writes take
`relationshipData`, not `inputRecord`; HTTP wraps that linkage in a `data` member.
POST adds members and DELETE removes specified members; both apply only to
supported to-many relationships. PATCH replaces a to-many set or a to-one target.
All three relationship write methods return undefined.

## Replace and remove members

```javascript
await api.resources.publishers.patchRelationship({
  id: publisher.id,
  relationshipName: 'authors',
  relationshipData: [{ type: 'authors', id: stephen.id }]
})
const replaced = await api.resources.publishers.getRelationship({
  id: publisher.id, relationshipName: 'authors'
})
await api.resources.publishers.deleteRelationship({
  id: publisher.id,
  relationshipName: 'authors',
  relationshipData: [{ type: 'authors', id: stephen.id }]
})
const empty = await api.resources.publishers.getRelationship({
  id: publisher.id, relationshipName: 'authors'
})
console.log('After replacement:', replaced.data)
console.log('After removal:', empty.data)
```

Replacement leaves Stephen alone; removal leaves an empty array. Authors remain
in the database. With `hasMany`, detachment clears the child's nullable foreign
key. With ordinary many-to-many storage, it removes the pivot row. Required
relationships cannot be cleared by detaching a child.

## Change and clear a to-one target

```javascript
await api.resources.authors.patchRelationship({
  id: peter.id,
  relationshipName: 'publisher',
  relationshipData: { type: 'publishers', id: publisher.id }
})
const peterPublisher = await api.resources.authors.getRelated({
  id: peter.id, relationshipName: 'publisher'
})
await api.resources.authors.patchRelationship({
  id: peter.id, relationshipName: 'publisher', relationshipData: null
})
const cleared = await api.resources.authors.getRelationship({
  id: peter.id, relationshipName: 'publisher'
})
console.log('Related publisher:', peterPublisher.name)
console.log('Cleared linkage:', cleared.data)
```

The related read returns Scribner; the final linkage is null. Use null only when
the relationship permits it. Polymorphic linkage also requires its target type;
see [polymorphic relationships](07-polymorphic-relationships.md).

## HTTP equivalents

After running all blocks, both authors are unassigned. These commands add them,
read both endpoints, and clear the collection again:

```bash
curl -X POST http://localhost:3000/api/publishers/1/relationships/authors \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":[{"type":"authors","id":"1"},{"type":"authors","id":"2"}]}'
curl http://localhost:3000/api/publishers/1/relationships/authors
curl --globoff 'http://localhost:3000/api/publishers/1/authors?fields[authors]=name&sort=name'
curl -X PATCH http://localhost:3000/api/publishers/1/relationships/authors \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":[]}'
```

Successful generated relationship writes return HTTP 204 without a body. Use IDs
returned by the server for persistent databases. Resource PATCH is a different
body shape: `data.type`, `data.id`, and `data.relationships` alongside any
attributes being changed.

## Permissions and transactions

Relationship operations apply their method-specific permission checks and
resource/target visibility. Linkage discovery is not a bypass for related query
permissions. Ordinary pivot rows also have their own query visibility; canonical
links are separate from pivot resource rows. Configure hooks through
`api.customize` using the [hook guide](13-hooks-and-lifecycle.md).

A successful relationship write participates in the library's transaction
lifecycle. Compose several operations with a handle from
[`api.transaction`](19-managed-transactions.md). A loop of independent operations
is not a single atomic transaction. Failures report the
[write outcome](20-transaction-outcomes.md); do not blindly retry an unknown outcome.

Use relationship writes for membership-only changes, related reads for records,
and resource PATCH when updating attributes and relationships together. Where
provided, follow response links for discovery and pagination; relative links
must be resolved against the API URL by clients that require absolute URLs.
