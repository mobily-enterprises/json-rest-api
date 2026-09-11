---
title: "File uploads"
chapter: 26
chapter_label: "26"
---

# 26. File uploads

`FileHandlingPlugin` connects declared file fields to storage adapters. The
Express connector supports real Busboy 1.x and Formidable 3.x multipart parsers.
Fastify currently accepts JSON resource documents and rejects multipart with 415.

File attributes contain the storage adapter's URL or handle as a string.
Ordinary file columns currently use binary SQL storage; their UTF-8 bytes are
decoded before returning the public value. Canonical file slots store text.
Invalid UTF-8 fails with a normalization error instead of silently corrupting
the handle. A custom getter owns decoding its database representation; the
response still follows the file-handle contract. Blob attributes retain their
separate binary representation. This correction requires no schema migration.

## Quick Start

Install the chosen optional parser along with the connector and storage driver:

```sh
npm install json-rest-api express knex better-sqlite3 busboy
```

The following example uses an in-memory database and a local upload directory:

```js
import { JsonRestApi } from 'json-rest-api'
import express from 'express'
import knex from 'knex'
import { RestApiPlugin, RestApiKnexPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api'
import { LocalStorage } from 'json-rest-api/plugins/storage/local-storage.js'

const app = express()
const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
const storage = new LocalStorage({ directory: './uploads', fileBaseUrl: '/uploads' })
const api = new JsonRestApi({ name: 'uploads' })

await api.use(RestApiPlugin, { format: 'plain', returning: 'full' })
await api.use(RestApiKnexPlugin, { knex: db })
await api.use(FileHandlingPlugin)
await api.use(ExpressPlugin, {
  mountPath: '/api',
  fileParser: 'busboy',
  fileParserOptions: { limits: { fileSize: 10 * 1024 * 1024, files: 2 } }
})
await api.addResource('images', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    image: { type: 'file', storage, accepts: ['image/png'], maxSize: '10mb', required: true }
  }
})
await api.resources.images.createKnexTable()

app.use('/uploads', express.static('./uploads'))
api.http.express.mount(app)
const server = app.listen(3000)
```

Install `FileHandlingPlugin` before `ExpressPlugin`, then declare resources.
An unavailable parser or invalid detector factory fails setup; it no longer
silently disables uploads. Close the HTTP server and destroy `db` during your
application's shutdown. Choose the application's own file-serving policy; the
example serves public files through Express static middleware.

```sh
curl -H 'Accept: application/vnd.api+json' \
  -F 'title=Example' -F 'image=@photo.png;type=image/png' \
  http://localhost:3000/api/images
```

Multipart field names match resource attribute and file-field names. Express
builds the resource envelope using the route's type. The response is a full
JSON:API document containing the stored file URL, regardless of programmatic
plain/JSON:API defaults.

## Schema Configuration

| File field option | Meaning |
| --- | --- |
| `type: 'file'` | Store the resulting URL in this attribute |
| `storage` | Adapter implementing `upload(file)`; `delete(url)` enables rollback cleanup |
| `accepts` | Match the part's reported MIME type; exact types, `image/*`, or `['*']` |
| `maxSize` | Inclusive maximum in bytes, or a string such as `'10mb'` or `'1.5gb'` |
| `required` | Ordinary resource schema requirement for creation/replacement; PATCH may omit it |

Schema size and MIME checks run after parsing and before uploading to storage.
Parser limits bound the data accepted during parsing. A numeric `maxSize` of
zero permits only an empty file. MIME metadata checks do not inspect file bytes.

Resource POST, PUT and PATCH support multipart. PUT takes its identity from the
URL, just like a regular resource call. PATCH may update only text fields while
preserving the stored URL of an omitted file. Manage relationships through the
normal resource/relationship methods; multipart fields carry attributes/files.

Repeated text fields become arrays. `tags[]` entries are grouped under `tags`;
indexed bracket suffixes also append in arrival order. Text remains text until
the resource schema applies its normal validation/coercion. Unknown attributes
and unknown uploaded file fields are rejected. One uploaded file per file field
is supported; repeating a file field produces 400 instead of keeping the first
or last file. Distinct declared file fields can be uploaded together.

## Protocol Configuration

`fileParser` accepts `'busboy'`, `'formidable'`, or a factory returning a detector
with `name`, `detect(params)` and `parse(params)`. The factory receives
`fileParserOptions`. `enableFileUploads: false` disables the connector's multipart
handling. Express's `requestSizeLimit` controls JSON parsing; use parser options
for multipart limits.

### Busboy

```js
await api.use(ExpressPlugin, {
  mountPath: '/api',
  fileParser: 'busboy',
  fileParserOptions: {
    limits: { fileSize: 1024 * 1024, files: 2, fields: 10, fieldSize: 64 * 1024, parts: 12 }
  }
})
```

The detector uses the current Busboy factory and file-info event API. Files are
buffered in memory. Limits are inclusive: a file of exactly `fileSize` bytes is
accepted; one extra byte is rejected. Truncated fields and parts/files/fields
limit events reject the whole request. See [Busboy's API](https://github.com/mscdex/busboy#api)
for parser options.

### Formidable

```sh
npm install formidable
```

```js
await api.use(ExpressPlugin, {
  mountPath: '/api',
  fileParser: 'formidable',
  fileParserOptions: {
    uploadDir: './upload-temp',
    maxFileSize: 1024 * 1024,
    maxTotalFileSize: 2 * 1024 * 1024,
    maxFiles: 2,
    maxFields: 10,
    maxFieldsSize: 64 * 1024
  }
})
```

Each request gets a private directory beneath `uploadDir`, which defaults to
the operating system's temp directory. Completed files are read into buffers;
the request directory is removed before parsing returns, including on error or
cancellation. Other requests and unrelated files in the parent directory are
preserved. The result has no persistent `filepath` or cleanup callback. See
[Formidable's options](https://github.com/node-formidable/formidable#options).

Both detectors buffer their final results; neither streams directly into the
storage adapter. Empty files are accepted unless schema validation excludes
them. Default limits are:

| Limit | Busboy | Formidable |
| --- | --- | --- |
| Per file | 10 MiB | 10 MiB |
| Files | 10 | 10 |
| Text fields | 100 | 100 |
| Text bytes | 64 KiB per field | 6.25 MiB total |
| Combined file bytes | Bounded by file count and per-file size | 100 MiB |
| Parts | 110 | Bounded by file/field counts |

## Storage Adapters

`upload(file)` receives `filename`, `mimetype`, `size` and a `data` Buffer, and
returns a stored URL. Implement `delete(url)` to remove a newly uploaded file
when the upload's managed transaction rolls back. That deletion should be
idempotent for URLs produced by the adapter.

`LocalStorage` writes actual files. Its URL option is `fileBaseUrl`; supported
naming strategies are `hash`, `timestamp`, `original` and `custom`. Use `nameGenerator` with the custom naming strategy.
Filename generation is not a reservation. Uploads reserve their destination
with exclusive creation and select another name if a concurrent upload has
claimed it. Existing files, directories and symlinks are occupied names.
Concurrent uploads therefore cannot overwrite one another, including with
`original` or custom names. Availability/permission errors propagate instead
of being treated as evidence that a filename is unused.

Buffer uploads write to the reserved file; temporary-file uploads stream into
it and remove their source only after writing and closing succeed. A failed
upload attempts to close and remove only its reserved destination. If that
cleanup also fails, an `AggregateError` retains the original failure in `cause`
and lists it followed by cleanup failures in `errors`; the destination may
remain for reconciliation. The adapter does not retry a write or rerun a custom
name generator after partial failure. Only an occupied-name reservation is retried.

The included `S3Storage` is a mock/demo URL generator and does not upload bytes
to Amazon S3; provide a real adapter for that service.

Custom detectors can still return `file.cleanup()`. `FileHandlingPlugin` awaits
those callbacks after processing, including validation failures. Built-in
Formidable cleanup now happens inside the detector instead.

## Errors and cleanup

| Result | HTTP status |
| --- | ---: |
| Malformed multipart, missing boundary, repeated file field | 400 |
| Parser byte/count/part limit | 413 |
| Declared MIME/size requirement or resource schema violation | 422 |
| Unexpected detector, parser or storage failure | 500 |
| Typed access failure from storage | 403 |

A matched detector's failure propagates; the library does not try another parser
on an already consumed request. Typed parser errors retain their original cause
where available. A later validation failure rolls back an owned database write
and deletes tracked new uploads. Tests also disconnect real HTTP clients after
partial disk writes and verify temporary-file removal and database rollback.

Unexpected detector/parser/upload failures retain their original thrown value
as `cause`, with phase and field/detector context. Typed API errors retain their
identity. Storage failures are no longer converted into schema validation
errors; MIME, size and ordinary resource validation still return 422.

Custom temporary-file cleanup and uploaded-file deletion are best effort.
Failures are retained in the operation's `context.cleanupErrors` as
`{ phase, field, error }`, using `temporaryFileCleanup` or `uploadedFileCleanup`.
A failed warning log is recorded as `logging` with its `during` phase. Cleanup
continues with later files, and early cleanup diagnostics survive a subsequent
write failure. Failed upload deletions remain in `context.fileHandlingUploads`
for inspection and reconciliation; the library does not silently retry them.

Uploads are tracked against their creating transaction. Rollback cleanup selects
that transaction's uploads, so reusing a context cannot delete an earlier
transaction's committed files. Confirmed commit releases its tracking entries.
Standalone writes own their transaction. To group writes, pass the handle from
`api.transaction` to each operation and use a separate context for each one.
Individual operations finish while that unit is pending; the outer helper waits
for commit or rollback and the enlisted completion hooks. Rollback cleans the
operations in reverse order, including repeated uploads to the same record.
A failed completion chain does not prevent later operations' chains from running.
File deletion diagnostics remain on the operation's context; rejected completion
hooks also appear in the owner's error or indexed `cleanupErrors`.

Raw Knex transactions cannot own library writes. See the
[migration guide](33-migrating-to-v2.md) for the callback form.

If a commit wrapper rejects after the driver has completed the transaction,
the failure handler does not attempt rollback or run rollback-file cleanup.
Driver completion alone does not distinguish every committed, rolled-back or
uncertain outcome; it is not a guarantee that replaying the write is safe.

### Ownership after commit

File fields store opaque URLs; several records, resources or external callers
can refer to the same object. The library owns cleanup of parser temporary files
and newly uploaded objects until their transaction completes. Confirmed rollback
attempts to delete new uploads; confirmed commit releases upload tracking and
leaves the stored objects under application ownership.

PATCH/PUT replacement and DELETE do not delete previously committed files,
even after the last reference in that resource disappears. For example, if two
documents use `/uploads/shared.png`, replacing one document's attachment keeps
that file available to the other. Rolling back the replacement deletes only the
new upload and restores the old field value.

Applications that need garbage collection must track ownership and references
across their own consumers, then call the storage adapter's `delete(url)` after
they establish that the object is no longer needed. A successful record deletion
alone does not establish that. This also applies to intermediate uploads from
repeated writes in a transaction that commits. There is no automatic reference
registry or background garbage collector.

Run `npm run test:multipart` for native parser and resource tests on both storage
modes. The full gate also exercises multipart resource operations under Express
4 and 5. See the [migration guide](33-migrating-to-v2.md) before updating callers.
