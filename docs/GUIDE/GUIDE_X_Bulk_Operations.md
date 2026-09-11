# Bulk operations

`BulkOperationsPlugin` provides `bulkPost`, `bulkPatch` and `bulkDelete`. Entries
run through their normal resource lifecycle, sequentially. A bulk request can
reduce network overhead; it does not turn resource writes into one batched SQL
statement or skip permissions, validation, setters and hooks.

POST/PATCH use the same `format` and `returning` options as individual writes.
Results contain `meta`, optional indexed `errors`, and `data` for full/minimal
responses. `returning: 'none'` omits data. DELETE returns its summary and deleted
IDs in `meta.deleted`.

## Runnable example

Insert the following seven JavaScript blocks into the
[starting script](GUIDE_2_1_The_Starting_Point.md), after installing storage and
before declaring resources or starting the server, on a fresh database. Later
snippets in this guide are fragments illustrating existing application state.

```javascript
import { BulkOperationsPlugin } from 'json-rest-api/plugins/core/bulk-operations-plugin.js'

await api.use(BulkOperationsPlugin, { maxBulkOperations: 100, defaultAtomic: true })
await api.addResource('books', {
  schema: { title: { type: 'string', required: true } }
})
await api.resources.books.createKnexTable()
```

```javascript
const created = await api.resources.books.bulkPost({
  inputRecords: [{ title: 'Alpha' }, { title: 'Beta' }], format: 'plain'
})
console.log(created.data, created.meta)
```

The two records are returned in input order. The summary is
`{ total: 2, succeeded: 2, failed: 0, atomic: true }`.
For JSON:API bulk creation, each input may be a resource object
`{ type, attributes, relationships }` or a document `{ data: ... }`.
Individual resource POST still requires a document when selecting JSON:API.

```javascript
const updated = await api.resources.books.bulkPatch({
  operations: created.data.map(book => ({ id: book.id, data: { title: `${book.title} revised` } })),
  format: 'plain', returning: 'minimal'
})
console.log(updated.data, updated.meta)
```

PATCH entries are `{ id, data }`; `data` is the plain input record in this
example. For `format: 'jsonapi'`, it is the JSON:API resource object, including
its type/ID and attributes/relationships. Minimal output contains identifiers.

```javascript
const partial = await api.resources.books.bulkPost({
  inputRecords: [{ title: 'Gamma' }, {}], format: 'plain', atomic: false
})
console.log(partial.data, partial.errors, partial.meta)
```

Gamma is stored, while the second entry fails required-title validation. The
summary reports one success and one failure; `errors[0].index` is 1. Successful
data entries are compacted, so their array positions do not represent failed
input slots. Use the indexed errors to identify rejected inputs.

```javascript
let atomicError
try {
  await api.resources.books.bulkPost({
    inputRecords: [{ title: 'Not retained' }, {}], format: 'plain', atomic: true
  })
} catch (error) { atomicError = error }
const afterAtomicFailure = await api.resources.books.query({ format: 'plain' })
console.log(atomicError?.transactionOutcome, afterAtomicFailure.data.map(book => book.title))
```

The owned batch rejects with rolled-back outcome, and Not retained is absent.
The earlier, separately completed calls remain stored.

```javascript
const gamma = partial.data[0]
let managedError
try {
  await api.transaction(async transaction => {
    await api.resources.books.bulkPatch({
      operations: [{ id: gamma.id, data: { title: 'Pending title' } }],
      format: 'plain', returning: 'none', atomic: true, transaction
    })
    throw new Error('Cancel this unit')
  })
} catch (error) { managedError = error }
const afterManagedRollback = await api.resources.books.get({ id: gamma.id, format: 'plain' })
console.log(managedError?.message, afterManagedRollback.title)
```

The outer callback rejection restores Gamma. The batch borrows the managed
transaction and cannot independently commit its changes.

```javascript
const deleted = await api.resources.books.bulkDelete({ ids: created.data.map(book => book.id), atomic: true })
const remaining = await api.resources.books.query({ format: 'plain' })
console.log(deleted.meta, remaining.data)
```

The delete summary names the two deleted IDs. Gamma remains.

## Configuration Options

Pass these options directly to `api.use(BulkOperationsPlugin, options)`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxBulkOperations` | positive safe integer | 100 | Maximum number of records that can be processed in a single request |
| `defaultAtomic` | boolean | true | Whether operations are atomic (all-or-nothing) by default |

Invalid values and unknown option names fail during installation. Remove
`batchSize` and `enableOptimizations`: they did not provide SQL batching, and the
disconnected optimization handler has been removed. Do not wrap options inside
a `'bulk-operations'` key. See [the migration steps](MIGRATING_API_V2.md#bulk-writes).

## Failures and diagnostics

Atomic failures preserve the original error if rollback also rejects. The
outer batch attempts rollback once for an unfinished transaction it owns and stores
secondary rollback errors in the supplied context's `cleanupErrors` array;
`context.error` retains the original failure. Both diagnostic fields reset on
the next bulk call. A rejected rollback does not confirm that data was restored.
Managed completion follows the [transaction contract](managed-transactions.md).

Child cleanup diagnostics are now available on the batch context, including
warnings from successful entries. Each has a zero-based `bulkIndex` alongside
its `phase`, original `error` and any file information. For example:

```js
const context = {};
const result = await api.resources.books.bulkPatch({
  operations: [{ id: '42', data: { title: 'Updated title' } }],
  format: 'plain',
  atomic: false
}, context);

for (const diagnostic of context.cleanupErrors || []) {
  console.error(diagnostic.bulkIndex, diagnostic.phase, diagnostic.error);
}
```

The batch response keeps its existing indexed primary errors; secondary cleanup
errors are retained on the context. `meta.failed` counts rejected calls, not
rolled-back writes: an `afterCommit` hook can fail after its data is stored.

Remaining child uploads are retained in `context.fileHandlingUploads`, also
tagged with `bulkIndex` and retaining their storage and transaction references.
They can include a failed deletion or committed files whose tracking-release
hook did not run. Do not delete or retry them solely because they are tracked.
Reusing the batch context clears old error diagnostics and keeps unresolved
upload tracking without copying it into new children. Write errors expose
`transactionOutcome`; managed completion-chain diagnostics also identify
`operationIndex`, `scopeName` and `method`. Broader integration remains in progress.

## Version conditions

For a resource with an explicit stored `versionField`, bulk PATCH and DELETE
accept `expectedVersions`: one revision token for each entry, in the same order
as `operations` or `ids`. Omit the entire array for unconditional writes. Each
token must be a non-empty string of at most 128 characters; null entries and
partially conditional arrays are not supported. The library validates the
array before starting any child operation, including in non-atomic mode.

```js
const current = await api.resources.books.get({ id: '42', format: 'plain' })
await api.resources.books.bulkPatch({
  operations: [{ id: current.id, data: { title: 'Updated title' } }],
  expectedVersions: [current.revision],
  format: 'plain'
})
```

Use the revision field selected by your resource configuration. It belongs in
`expectedVersions`, not in the submitted attributes. Successful updates rotate
the revision even when no conditions were supplied. Read full responses or
fetch the record again to obtain its new revision.

A stale condition raises `REST_API_VERSION_CONFLICT`. An owned atomic batch
rolls back all its changes. A non-atomic batch retains successful children and
reports the failed child's index and transaction outcome in `errors`. Caller
transactions retain their normal ownership rules below. Missing or inaccessible
rows retain the single-write not-found behavior.

HTTP bulk PATCH/DELETE use the same `expectedVersions` property in the request
body, alongside `operations` or `ids`. Atomic version conflicts map to HTTP 409;
malformed condition arrays map to 422. These are body conditions, not HTTP
`If-Match` validators. Bulk creation rejects revision conditions, and all bulk
methods reject the singular `expectedVersion` option.

## Transaction ownership

Pass `transaction` in the first argument to bulkPost, bulkPatch or bulkDelete,
with `atomic: true`. Each entry uses that same transaction, including its
relationship changes and full-response reads. The bulk call neither commits nor
rolls it back. Other calls and raw SQL can join the same transaction.

```js
await api.transaction(async transaction => {
  return api.resources.books.bulkPatch({
    operations: [{ id: '42', data: { title: 'Updated title' } }],
    format: 'plain',
    returning: 'minimal',
    atomic: true,
    transaction
  })
})
```

The managed helper rolls back the whole unit after callback rejection or a
participating write/observed SQL failure, even when caught. A rejected batch can
leave changes pending until the helper finishes; its individual operations do
not complete the transaction or create savepoints. Raw transactions and child
savepoints cannot be passed to library writes. Raw SQL can join the managed
callback through its actual Knex handle.

Without a supplied transaction, an atomic batch owns one transaction for all
entries; a non-atomic batch lets each entry own its transaction. Passing a
transaction with `atomic: false` rejects before any child or SQL runs. This also
applies when `defaultAtomic` is false: explicitly select `atomic: true` to join
an outer transaction. A completed transaction rejects through the normal write
path and is never silently replaced with a new one.

Managed completion defers enlisted completion chains to the owner. See
[managed transactions](managed-transactions.md) and
[transaction outcomes](transaction-outcomes.md) for file/event integration,
completion failures and uncertain outcomes.

## HTTP API Usage

Express and Fastify expose bulk endpoints. Install the connector and bulk
plugin **before declaring resources**, then mount/start the application.
Authenticated transport context reaches every ordinary resource write and its
permission checks. HTTP always selects JSON:API/full responses: POST returns
201, PATCH and DELETE return 200 with the batch summary. `atomic` query values
must be exactly `true` or `false`; malformed values produce 422 without writes.
The optional plugin reserves `/RESOURCE/bulk` for these methods, including when
the resource accepts opaque IDs. This bulk protocol is not an implementation of
the JSON:API Atomic Operations extension.


The bulk HTTP request bodies are:

| Method and path | Body fields |
| --- | --- |
| `POST /api/books/bulk` | `data`: array of JSON:API resource objects |
| `PATCH /api/books/bulk` | `operations`: array of `{ id, data }`, where `data` is a resource object |
| `DELETE /api/books/bulk` | `ids`: array of resource IDs |

For example:

```json
{
  "operations": [
    { "id": "1", "data": { "type": "books", "id": "1", "attributes": { "title": "Revised" } } }
  ]
}
```

Select `?atomic=false` for independent child transactions, or omit it for the
configured default. Non-atomic error summaries require application handling;
a successful HTTP status does not mean every child call succeeded. In
particular, inspect each error's transaction outcome before retrying a mutation
that may already have committed. See [transaction outcomes](transaction-outcomes.md).
