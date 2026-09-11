# Effects of PUT and PATCH on related data

PATCH changes supplied values. PUT describes a replacement and requires explicit
values for persisted attributes and belongs-to relationships that already have
values. PUT does not silently clear those stored values by omission.

Relationship collections have an additional PUT rule: supplying a JSON:API
`data.relationships` object makes omitted declared collections part of the
replacement. An empty object can therefore clear collections. PATCH changes
only the relationships named in its input.

The following six blocks form one runnable example. Insert them in order into
the [starting script](GUIDE_2_1_The_Starting_Point.md) before starting its server,
on a fresh database. JSON:API input makes the relationship-object boundary
explicit; plain input is described below.

## Create the example records

```javascript
await api.addResource('publishers', {
  schema: { name: { type: 'string', required: true } },
  relationships: { books: { type: 'hasMany', target: 'books', foreignKey: 'publisher_id' } }
})
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    note: { type: 'string', nullable: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  }
})
await api.resources.publishers.createKnexTable()
await api.resources.books.createKnexTable()
const publisher = await api.resources.publishers.post({ inputRecord: { name: 'Example Press' } })
const book = await api.resources.books.post({
  inputRecord: { title: 'First edition', note: 'Keep me', publisher: publisher.id }
})
```

The plain create calls still put data inside `inputRecord`, and refer to the
relationship by its public name `publisher`, not its backing column.

## PATCH retains omitted values

```javascript
const patched = await api.resources.books.patch({
  id: book.id, format: 'jsonapi',
  inputRecord: { data: { type: 'books', id: book.id, attributes: { title: 'Second edition' } } }
})
console.log(patched.data.attributes, patched.data.relationships.publisher.data)
```

The title changes. The note remains `Keep me` and the publisher linkage remains.
A supplied to-many array replaces that relationship's membership; it is not an
append operation. Use [relationship endpoints](GUIDE_2_9_Relationships_Urls.md)
for explicit attachment/removal.

## PUT requires explicit existing values

```javascript
let incompletePutError
try {
  await api.resources.books.put({
    id: book.id, format: 'jsonapi',
    inputRecord: { data: { type: 'books', id: book.id, attributes: { title: 'Rejected edition' } } }
  })
} catch (error) {
  incompletePutError = error
}
const afterRejectedPut = await api.resources.books.get({ id: book.id })
console.log(incompletePutError?.cause?.message, afterRejectedPut.title)
```

The owned write rejects with `RestApiWriteError`; its cause is a
`RestApiValidationError` describing the omitted note and publisher. Its
`transactionOutcome` is `rolledBack`, and the title remains `Second edition`.
In an application, handle or propagate the error; the catch here lets the
remaining examples run.

```javascript
const replaced = await api.resources.books.put({
  id: book.id, format: 'jsonapi',
  inputRecord: {
    data: {
      type: 'books', id: book.id,
      attributes: { title: 'Third edition', note: null },
      relationships: { publisher: { data: { type: 'publishers', id: publisher.id } } }
    }
  }
})
console.log(replaced.data.attributes, replaced.data.relationships.publisher.data)
```

This replacement explicitly clears the nullable note and retains the publisher.
To clear the publisher, supply `publisher: { data: null }` in JSON:API
relationships (or `publisher: null` in plain input). Required/non-nullable
relationships cannot be detached this way. Computed and virtual fields are not
persisted replacement values; ordinary required-field validation still applies.

## PUT's relationship-object boundary

```javascript
await api.resources.publishers.put({
  id: publisher.id, format: 'jsonapi',
  inputRecord: { data: { type: 'publishers', id: publisher.id, attributes: { name: 'Renamed Press' } } }
})
const retainedBooks = await api.resources.publishers.getRelationship({ id: publisher.id, relationshipName: 'books' })
await api.resources.publishers.put({
  id: publisher.id, format: 'jsonapi',
  inputRecord: {
    data: {
      type: 'publishers', id: publisher.id, attributes: { name: 'Empty Press' },
      relationships: {}
    }
  }
})
const clearedBooks = await api.resources.publishers.getRelationship({ id: publisher.id, relationshipName: 'books' })
const detachedBook = await api.resources.books.get({ id: book.id })
console.log(retainedBooks.data, clearedBooks.data, detachedBook)
```

The first PUT has no relationships object and keeps the book membership. The
second includes an empty object and detaches the book. The book record still
exists; its nullable publisher is cleared. Plain read output omits an unassigned
to-one relationship. A JSON:API linkage read represents it as `data: null`.

The same omission boundary applies to declared many-to-many collections and
reverse has-one relationships: replacing membership does not delete target
records. Reverse changes can invoke child PATCH lifecycles and fail when the
child cannot be detached. Ordinary through-row metadata and canonical links
have different storage behavior; see [many-to-many relationships](GUIDE_2_6_Many_To_Many.md).

## PATCH selects the relationship to replace

```javascript
await api.resources.publishers.patch({
  id: publisher.id, format: 'jsonapi',
  inputRecord: {
    data: {
      type: 'publishers', id: publisher.id,
      relationships: { books: { data: [{ type: 'books', id: book.id }] } }
    }
  }
})
const reattachedBooks = await api.resources.publishers.getRelationship({ id: publisher.id, relationshipName: 'books' })
const unchangedPublisher = await api.resources.publishers.get({ id: publisher.id })
console.log(reattachedBooks.data, unchangedPublisher.name)
```

The book is attached again, and the publisher name remains `Empty Press`.
For either method, an explicitly supplied empty collection clears membership.
Omitted PATCH attributes and relationships remain unchanged.

## Plain input and choosing the method

Plain calls use `inputRecord: { title, note, publisher, ... }`. Supplying public
relationship names causes their conversion into JSON:API relationship entries.
A PUT that supplies one relationship can therefore clear other omitted
collections. Use PATCH for a partial update, or explicitly include every
relationship you intend to retain in a PUT replacement. Hooks that introduce a
relationships object also participate in this boundary.

Use `returning: 'full'`, `'minimal'` or `'none'` to select the write response;
none/minimal do not skip write validation or mutation. See
[hooks](GUIDE_7_Hooks_Data_Management_And_Plugins.md) for nested response reads and
[managed transactions](managed-transactions.md) for atomic multi-call changes.
Unconditional PUT can create a missing resource at the supplied ID; an
`expectedVersion` condition cannot match a missing row. See
[version-field migration](version-field-migration.md) for conditional writes.
