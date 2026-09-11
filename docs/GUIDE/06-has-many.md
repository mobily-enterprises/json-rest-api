---
title: "Has-many relationships"
chapter: 6
chapter_label: "06"
---

# 06. Has-many relationships

A publisher has many authors; each author belongs to one publisher. The
`hasMany` declaration points to the logical foreign-key field on the child.
It does not store an array of IDs in the publisher's table.

Insert these blocks in order into the [starting script](03-running-example.md)
on a fresh database, before the HTTP server starts.

## Define and populate the resources

```javascript
await api.addResource('publishers', {
  schema: { name: { type: 'string', required: true, indexed: true } },
  relationships: {
    authors: { type: 'hasMany', target: 'authors', foreignKey: 'publisher_id' }
  },
  searchSchema: {
    authorSurname: { type: 'string', actualField: 'authors.surname', filterOperator: 'startsWith' }
  }
})
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true },
    surname: { type: 'string', required: true, indexed: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: {
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'contains' }
  }
})
await api.resources.publishers.createKnexTable()
await api.resources.authors.createKnexTable()

const frenchPublisher = await api.resources.publishers.post({
  inputRecord: { name: 'French Books Inc.' }
})
const germanPublisher = await api.resources.publishers.post({
  inputRecord: { name: 'German Press GmbH' }
})
const emptyPublisher = await api.resources.publishers.post({
  inputRecord: { name: 'Global Publishing' }
})
const victor = await api.resources.authors.post({
  inputRecord: { name: 'Victor', surname: 'Hugo', publisher: frenchPublisher.id }
})
const emile = await api.resources.authors.post({
  inputRecord: { name: 'Émile', surname: 'Zola', publisher: frenchPublisher.id }
})
await api.resources.authors.post({
  inputRecord: { name: 'Johann', surname: 'Goethe', publisher: germanPublisher.id }
})
const unassigned = await api.resources.authors.post({
  inputRecord: { name: 'Unknown', surname: 'Author', publisher: null }
})
```

Link children through the public `publisher` alias in `inputRecord`, not the
foreign-key field name. Declaring the inverse `belongsTo` also gives authors
a public relationship representation. Cross-table filter targets explicitly
declare `indexed: true`.

## Read linkage and include child records

```javascript
const identifiers = await api.resources.publishers.get({ id: frenchPublisher.id })
const embedded = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: { include: ['authors'] }
})
const document = await api.resources.publishers.get({
  id: frenchPublisher.id,
  format: 'jsonapi',
  queryParams: { include: ['authors'] }
})
const empty = await api.resources.publishers.get({ id: emptyPublisher.id })
console.log('Author identifiers:', identifiers.authors)
console.log('Included authors:', embedded.authors)
console.log('JSON:API document:', document)
console.log('Empty relationship:', empty.authors)
```

Without includes, plain `authors` contains `{ id }` objects for Victor and Émile.
With includes it contains their selected attributes too. JSON:API retains
identifier linkage in `data.relationships.authors.data` and puts full child
records in `included`. An empty to-many relationship is an empty array.
Discovering child identifiers has a query cost even without fetching attributes.

## Page related records and select fields

```javascript
const firstAuthorPage = await api.resources.publishers.getRelated({
  id: frenchPublisher.id,
  relationshipName: 'authors',
  queryParams: { sort: ['surname'], page: { number: 1, size: 1 } }
})
const sparse = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'],
    fields: { publishers: 'name,authors', authors: 'surname' }
  }
})
console.log('First related page:', firstAuthorPage)
console.log('Sparse authors:', sparse.authors)
```

The first related page contains Hugo and has `meta.pagination.total === 2`.
`getRelated` returns a collection for a to-many relationship. Its page options
apply to children; page options on a publisher query apply to publishers.
The sparse include keeps author IDs and surnames and omits their names. Keep
`authors` in the parent fieldset when you need its linkage in the response.

## Filter in either direction

```javascript
const matchingPublishers = await api.resources.publishers.query({
  queryParams: { filters: { authorSurname: 'Hu' } }
})
const matchingAuthors = await api.resources.authors.query({
  queryParams: { filters: { publisherName: 'German' } }
})
console.log('Publishers with a matching author:', matchingPublishers.data)
console.log('Authors with a matching publisher:', matchingAuthors.data)
```

These return French Books Inc. and Johann respectively. The server's search
schema declares allowed paths and operators. Filtering parents by matching
children does not itself request an include or restrict an included collection
to only those matching children.

## Change membership

```javascript
await api.resources.publishers.postRelationship({
  id: frenchPublisher.id,
  relationshipName: 'authors',
  relationshipData: [{ type: 'authors', id: unassigned.id }]
})
await api.resources.publishers.deleteRelationship({
  id: frenchPublisher.id,
  relationshipName: 'authors',
  relationshipData: [{ type: 'authors', id: victor.id }]
})
await api.resources.publishers.patch({
  id: frenchPublisher.id,
  inputRecord: { authors: [emile.id] },
  returning: 'none'
})
const finalLinkage = await api.resources.publishers.getRelationship({
  id: frenchPublisher.id, relationshipName: 'authors'
})
const detachedVictor = await api.resources.authors.get({ id: victor.id })
console.log('Final members:', finalLinkage.data)
console.log('Detached author still exists:', detachedVictor.name)
```

POST relationship adds an existing child, DELETE relationship removes specified
membership, and the parent PATCH replaces the collection with the supplied IDs.
The final member is Émile. Removing membership does not delete the author:
Victor remains, with no publisher. Detaching children requires their relationship
to allow null; required relationships cannot be cleared this way. Relationship
writes use `relationshipData` and return undefined. Resource writes put their
record, including any relationships, under `inputRecord`.

## HTTP examples

After the full example above, the French publisher has only Émile:

```bash
curl --globoff 'http://localhost:3000/api/publishers/1?include=authors'
curl --globoff 'http://localhost:3000/api/publishers/1/authors?page[number]=1&page[size]=10'
curl 'http://localhost:3000/api/publishers/1/relationships/authors'
```

The related endpoint returns author resources; the relationship endpoint returns
linkage. Generated HTTP routes use JSON:API documents. Use IDs from your server
when working with a persistent database.
