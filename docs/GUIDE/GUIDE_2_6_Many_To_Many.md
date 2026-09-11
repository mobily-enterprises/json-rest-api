# 2.6 Many-to-many relationships

Books can have several authors, and authors can write several books. A pivot
resource, `book_authors`, represents each connection and can also hold attributes
such as a contribution role. Declare that resource alongside the two endpoints.

Insert the following blocks in order into the [starting script](GUIDE_2_1_The_Starting_Point.md)
with a fresh database, before the HTTP server starts. This chapter uses
`RestApiKnexPlugin` and ordinary pivot rows. Canonical storage keeps membership
in separate tenant-scoped links: direct pivot resource rows and their metadata
do not create or describe those links. The relationship-read/write API remains
available there, but the direct pivot examples below apply to table-backed storage.

## Define the resources

```javascript
await api.addResource('books', {
  schema: { title: { type: 'string', required: true, indexed: true } },
  relationships: {
    authors: { type: 'manyToMany', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
  },
  searchSchema: {
    authorName: { type: 'string', actualField: 'authors.name', filterOperator: 'contains' }
  }
})
await api.addResource('authors', {
  schema: { name: { type: 'string', required: true, indexed: true } },
  relationships: {
    books: { type: 'manyToMany', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  },
  searchSchema: {
    bookTitle: { type: 'string', actualField: 'books.title', filterOperator: 'contains' }
  }
})
await api.addResource('book_authors', {
  schema: {
    book_id: { type: 'id', belongsTo: 'books', as: 'book', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author', required: true },
    contribution: { type: 'string', nullable: true }
  },
  searchSchema: { book: { type: 'id', actualField: 'book_id' } }
})
await api.resources.books.createKnexTable()
await api.resources.authors.createKnexTable()
await api.resources.book_authors.createKnexTable()
```

`through` names the pivot resource. `foreignKey` is its logical field pointing
to the current resource, and `otherKey` points to the related resource. The
reverse declaration swaps these fields. Storage mapping determines physical
columns. Each pivot record has its own resource ID.

## Create records with membership

```javascript
const neil = await api.resources.authors.post({ inputRecord: { name: 'Neil Gaiman' } })
const terry = await api.resources.authors.post({ inputRecord: { name: 'Terry Pratchett' } })
const goodOmens = await api.resources.books.post({
  inputRecord: { title: 'Good Omens', authors: [neil.id, terry.id] }
})
const americanGods = await api.resources.books.post({
  format: 'jsonapi',
  inputRecord: {
    data: {
      type: 'books',
      attributes: { title: 'American Gods' },
      relationships: { authors: { data: [{ type: 'authors', id: neil.id }] } }
    }
  }
})
```

The plain record uses an ID array under `inputRecord.authors`; JSON:API uses
identifier linkage under `data.relationships.authors.data`. These operations
create the necessary pivot connections. Do not also create direct pivot records
for those same connections.

## Read includes and filter through the pivot

```javascript
const includedBook = await api.resources.books.get({
  id: goodOmens.id, queryParams: { include: ['authors'] }
})
const includedDocument = await api.resources.books.get({
  id: goodOmens.id, format: 'jsonapi', queryParams: { include: ['authors'] }
})
const booksByNeil = await api.resources.books.query({
  queryParams: { filters: { authorName: 'Neil' }, include: ['authors'] }
})
const authorsOfGods = await api.resources.authors.query({
  queryParams: { filters: { bookTitle: 'Gods' } }
})
console.log('Good Omens authors:', includedBook.authors)
console.log('JSON:API authors:', includedDocument.included)
console.log('Books by Neil:', booksByNeil.data)
console.log('Authors of Gods:', authorsOfGods.data)
```

Good Omens includes both authors. Plain responses embed included records;
JSON:API retains relationship identifiers and places related records in
`included`. Without an include, membership is represented by IDs rather than
full author attributes. The filter finds both books by Neil; its Good Omens
result still includes Terry as well. Filtering a parent does not filter the
included collection to just matching children. The reverse title filter finds
Neil alone.

## Work with pivot attributes directly

```javascript
const colorOfMagic = await api.resources.books.post({
  inputRecord: { title: 'The Color of Magic' }
})
const contribution = await api.resources.book_authors.post({
  inputRecord: { book: colorOfMagic.id, author: terry.id, contribution: 'primary' }
})
const omensPivots = await api.resources.book_authors.query({
  queryParams: { filters: { book: goodOmens.id } }
})
for (const pivot of omensPivots.data) {
  await api.resources.book_authors.patch({
    id: pivot.id, inputRecord: { contribution: 'co-author' }, returning: 'none'
  })
}
const updatedPivots = await api.resources.book_authors.query({
  queryParams: { filters: { book: goodOmens.id } }
})
console.log('Direct pivot:', contribution)
console.log('Updated contributions:', updatedPivots.data)
```

The pivot is a resource: use its public relationship aliases `book` and `author`
in `inputRecord`. Its declared `book` filter finds the two Good Omens connection
records. Updating their attributes changes contribution metadata without
replacing membership. Query the pivot resource to retrieve these attributes;
a book's author include does not automatically attach pivot attributes to authors.
Direct pivot creation should not duplicate membership already created through
`authors`. Define the uniqueness constraints your persistent schema requires.

## Remove membership without deleting an author

```javascript
await api.resources.books.deleteRelationship({
  id: goodOmens.id,
  relationshipName: 'authors',
  relationshipData: [{ type: 'authors', id: terry.id }]
})
const remainingMembers = await api.resources.books.getRelationship({
  id: goodOmens.id, relationshipName: 'authors'
})
const remainingPivots = await api.resources.book_authors.query({
  queryParams: { filters: { book: goodOmens.id } }
})
const terryStillExists = await api.resources.authors.get({ id: terry.id })
console.log('Remaining authors:', remainingMembers.data)
console.log('Remaining pivot records:', remainingPivots.data)
console.log('Author remains:', terryStillExists.name)
```

The Good Omens connection to Terry is removed, including that pivot record's
contribution metadata. Neil's connection and Terry's author record remain.
The relationship method returns undefined and takes identifiers in
`relationshipData`. A resource PATCH with `inputRecord: { authors: [...] }`
replaces the membership set; use relationship POST/DELETE for incremental changes.

## HTTP endpoints

After running all the blocks, Good Omens has only Neil:

```bash
curl --globoff 'http://localhost:3000/api/books/1?include=authors'
curl 'http://localhost:3000/api/books/1/relationships/authors'
curl --globoff 'http://localhost:3000/api/books?filter[authorName]=Neil'
curl --globoff 'http://localhost:3000/api/book_authors?filter[book]=1'
```

Generated HTTP endpoints use JSON:API documents, including for the pivot
resource. Use IDs returned by your server when adapting this example to an
existing database.

[Previous: polymorphic hasMany](GUIDE_2_5_HasMany_Polymorphic.md) |
[Guide index](index.md) | [Next: pagination](GUIDE_2_7_Pagination_And_Ordering.md)
