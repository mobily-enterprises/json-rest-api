---
title: "Hooks and lifecycle"
chapter: 13
chapter_label: "13"
---

# 13. Hooks and lifecycle

Hooks extend particular lifecycle stages. Their names, ordering and context
shape depend on the operation. A write can invoke read hooks while preparing
its full response, and relationship writes can invoke nested resource writes.

An operation passes the caller's mutable context through its resource hooks.
Hooks can cache information, add properties for later hooks, and change the
documented writable fields at the appropriate stage. Those changes remain
visible to the caller after success or failure. There is no immutable context
wrapper or separate hook cache API.

Use [Writing Plugins](29-writing-plugins.md) for reusable extensions,
[field transformations](12-field-transformations.md) for setters/getters and
computed output, and [row policies](17-row-policies.md) for mandatory
visibility constraints.

## Register and observe hooks

The following blocks form one runnable example. Insert them in order into the
[starting script](03-running-example.md), before starting its server,
on a fresh database. Register named handlers through `api.customize`.

```javascript
await api.addResource('notes', {
  schema: {
    title: { type: 'string', required: true },
    canEdit: { type: 'boolean', virtual: true }
  }
})
await api.resources.notes.createKnexTable()
const events = []
api.customize({
  hooks: {
    beforeProcessingPost: {
      functionName: 'prepare-note-title',
      handler: async ({ context }) => {
        if (context.scopeName !== 'notes') return
        const title = context.inputRecord?.data?.attributes?.title
        context.noteTitleCache = typeof title === 'string' ? title.trim() : undefined
      }
    },
    beforeSchemaValidatePost: {
      functionName: 'normalize-note-title',
      handler: async ({ context }) => {
        if (context.scopeName !== 'notes') return
        const attributes = context.inputRecord.data.attributes
        if (context.noteTitleCache !== undefined) attributes.title = context.noteTitleCache
        events.push(`validate:${context.method}`)
      }
    },
    beforeDataCallPost: {
      functionName: 'observe-note-write',
      handler: async ({ context }) => {
        if (context.scopeName === 'notes') events.push(`write:${context.method}`)
      }
    },
    beforeDataGet: {
      functionName: 'observe-note-read',
      handler: async ({ context }) => {
        if (context.scopeName === 'notes') events.push(`read:${context.method}`)
      }
    },
    finishPost: {
      functionName: 'observe-note-finish',
      handler: async ({ context }) => {
        if (context.scopeName !== 'notes') return
        context.savedNoteId = String(context.id)
        events.push(`finish:${context.method}`)
      }
    },
    afterCommit: {
      functionName: 'observe-note-commit',
      handler: async ({ context }) => {
        if (context.scopeName === 'notes') events.push(`commit:${context.method}`)
      }
    }
  }
})
```

The first hook caches information; a later hook uses it to change the pending
title before validation; the finish hook adds information for the caller.
The input type is checked before using a string method because processing hooks
run before validation. For an ordinary field transformation, prefer a schema
setter; this example demonstrates communication between hook stages.

```javascript
const noteContext = {}
const fullNote = await api.resources.notes.post({
  data: { title: '  First note  ' }, format: 'plain', returning: 'full'
}, noteContext)
const fullEvents = events.splice(0)
console.log(fullNote.title, noteContext.savedNoteId, fullEvents)
```

The title is `First note`. The event sequence is `validate:post`, `write:post`,
`read:get`, `finish:post`, `commit:post`. The full response invokes a nested GET
before the write finishes; its context has method `get`.

```javascript
const minimalNote = await api.resources.notes.post({
  data: { title: '  Second note  ' }, format: 'plain', returning: 'minimal'
})
const minimalEvents = events.splice(0)
console.log(minimalNote, minimalEvents)
```

The minimal result contains `id` and `type: 'notes'`. The events omit `read:get`.
`returning: 'none'` also avoids that response GET. Do not put mandatory write
validation in read hooks: it would depend on the requested return mode.

## Cache permission information across hooks

The input-preparation recipe above already shows two hooks sharing a cache.
Permissions can use the same approach. These next recipes extend that runnable
example. The lookup below stands in for an application authorization service;
`auth.userId` must come from trusted application code.

```javascript
import { RestApiResourceError } from 'json-rest-api'

let permissionLookups = 0
async function loadNotePermissions (userId) {
  permissionLookups++
  return { canEdit: userId === 'editor' }
}

await api.customize({ hooks: {
  checkPermissions: {
    functionName: 'authorize-note-edit',
    handler: async ({ scopeName, context }) => {
      if (scopeName !== 'notes') return
      const operation = context.originalContext ?? context
      operation.notePermissions ??= await loadNotePermissions(operation.auth?.userId)
      if (context.method === 'patch' && !operation.notePermissions.canEdit) {
        throw new RestApiResourceError('Editing notes is forbidden', { subtype: 'forbidden' })
      }
    }
  }
} })

const permissionContext = { auth: { userId: 'editor' } }
const editedNote = await api.resources.notes.patch({
  id: fullNote.id, data: { title: 'Edited note' }
}, permissionContext)
const lookupsAfterEdit = permissionLookups
```

The write and its full-response GET perform one lookup in total. The permission
hook writes to the originating operation context through `originalContext` for
ordinary CRUD. Relationship permission hooks receive the operation directly,
so the fallback handles that boundary too. A nested response GET inherits the
cached object by reference. Later hooks read `notePermissions` from the relevant
operation; they do not need another lookup or a global cache.

This recipe permits reads and gates PATCH only. Define the allowed methods for
your application explicitly; use row policies when authorization must filter
collections or relationship targets. A cached decision is valid only for the
identity and conditions it was calculated for. Use a fresh context for a new call.

## Enrich a declared output field

`canEdit` was declared as a virtual boolean above, so it can appear in output
without a stored column. This hook obtains the cached permission through the
enrichment wrapper's `parentContext`:

```javascript
await api.customize({ hooks: {
  enrichAttributes: {
    functionName: 'show-note-edit-permission',
    handler: ({ scopeName, context }) => {
      if (scopeName !== 'notes') return
      context.attributes.canEdit = context.parentContext.notePermissions?.canEdit ?? false
    }
  }
} })

const editableNote = await api.resources.notes.get({ id: fullNote.id }, {
  auth: { userId: 'editor' }
})
const readOnlyNote = await api.resources.notes.get({ id: fullNote.id }, {
  auth: { userId: 'reader' }
})
```

The returned `canEdit` values are true and false. This output is information for
the caller; the write permission hook enforces access. Final field selection
still applies, so a sparse request for `title` alone omits `canEdit`. Prefer a
declared computed field for a value derived from resource attributes; use
enrichment when it depends on request-specific information such as this cache.

## Perform an effect after commit

The original example observes commit order. An application effect belongs at
that same boundary, rather than in a finish hook. This runnable stand-in records
notifications in an array; replace `publishNoteChanged` with your application
integration when using the recipe.

```javascript
const notifications = []
async function publishNoteChanged (change) {
  notifications.push(change)
}

await api.customize({ hooks: {
  afterCommit: {
    functionName: 'publish-note-change',
    handler: async ({ scopeName, context }) => {
      if (scopeName !== 'notes' || context.method !== 'patch') return
      await publishNoteChanged({
        id: String(context.id), title: context.minimalRecord.attributes.title
      })
    }
  }
} })

let notificationsBeforeCommit
await api.transaction(async transaction => {
  await api.resources.notes.patch({
    id: fullNote.id, data: { title: 'Ready to share' }, transaction
  }, { auth: { userId: 'editor' } })
  notificationsBeforeCommit = notifications.length
})
const notificationsAfterCommit = notifications.slice()
```

There are no notifications inside the transaction callback, and one after
`api.transaction` resolves. A rollback does not run this hook. An effect failure
after commit cannot roll back the saved note; it is reported with a committed
outcome. This is not durable delivery across process failure. Use a
transactional outbox when reliable eventual delivery is a requirement.

## Context depends on the boundary

`data` selects plain application input and `document` selects a JSON:API input
document. `format: 'plain'` and `format: 'jsonapi'` select output independently.
Resource POST/PUT/PATCH normalize either input into `context.inputRecord`, an
internal JSON:API document, before their processing hooks. The public
`inputRecord` argument has been removed; the hook field retains its name and
shape. It is not yet validated at the early processing boundary. Reads and
DELETE do not have their own write document; relationship writes accept
`relationshipData` instead.

| Boundary | Where to find operation data |
| --- | --- |
| Resource processing, validation, data and finish hooks | `context` is the same object supplied as the method's second argument, or a fresh object when omitted. Inspect `method` and `scopeName` before using method-specific properties. |
| Resource authorization through `checkPermissions` | Ordinary CRUD uses a permission wrapper whose `originalContext` points to the operation. Relationship methods invoke the hook with their operation context directly. Use `context.originalContext ?? context` for information shared with later operation hooks. |
| Attribute enrichment | Hooks share a per-resource enrichment wrapper. `context.attributes` is its output attribute object; `context.parentContext` is the read operation context. Included resources receive their own enrichment calls. |
| Full write response | A nested GET has a separate, shallow-copied context. It shares the write's transaction and referenced application objects. |

`inputRecord.data.attributes` contains write attributes. After setters run,
after-data hooks see transformed values. `minimalRecord` is internal stored
resource data; `responseRecord` holds the selected write output once prepared.
POST assigns its generated ID before after-data hooks. PATCH processing hooks
can run before `context.id` is populated; use later validated stages when an ID
is required. PUT selects its create/update branch before schema validation.

Do not use internal representation flags as application options. The public
options are `format` and `returning`; see [API migration](33-migrating-to-v2.md).
Getters and computed callbacks have their own documented
[contexts and dependency rules](12-field-transformations.md#dependency-contract).

## Field ownership and mutation

The context is mutable, but not every property is an application input. Use
application-specific names for cached values and additional information so they
do not collide with the library fields below. The library does not freeze the
context or enforce ownership through proxies.

| Field | Owner and availability | Supported mutation and effect |
| --- | --- | --- |
| Application properties, such as `auth`, `noteTitleCache` or `savedNoteId` | Caller and application hooks; available once assigned. | Add or update them to communicate between hooks. Trust/authentication comes from application code, never automatically from write data. |
| `inputRecord.data.attributes` | Library-normalized write input, available at processing hooks. | Prepare attributes in `beforeProcessing*` or `beforeSchemaValidate*`; schema validation follows. After-validation changes are not schema-validated again. Setters run after `beforeDataCall*`. Changes after the storage call do not update the database. |
| `inputRecord.data.relationships` | Library-normalized write input. | Prepare linkage in `beforeProcessing*`, before document validation, relationship authorization and relationship planning. Later changes do not rebuild the already prepared relationship operations. |
| `record` | Library-created JSON:API read result, available after fetching. | Read enrichment and finish hooks can adjust output. Final normalization, visibility checks and field projection still apply. This does not change stored values. |
| `attributes` on an enrichment wrapper | Library-created output attributes for one resource. | `enrichAttributes` hooks can update declared output fields; the returned attributes remain subject to final projection. Use `parentContext` for operation-wide cached information. |
| `responseRecord` | Selected write output, available at write finish; absent for `returning: 'none'`. | Finish hooks can adjust the response before final normalization and commit. A returned write result is copied before completion hooks; mutating this field in `afterCommit` does not change that result. |
| `method`, `scopeName`, `id`, `relationshipName`, `isUpdate` | Library-owned operation identity and branch selection. Availability varies by method and stage. | Inspect rather than overwrite. Changing them does not select a different operation or safely retarget a write. POST's ID is available after storage; normalize it with `String(context.id)` when comparing it to public IDs. |
| `schemaInfo`, `params`, `queryParams`, `format`, `returning`, `simplified` | Library-owned compiled schema, request parameters and selected response behavior. | Set public options in method arguments. Do not overwrite these fields to redirect processing. Use schema declarations, row policies and documented query hooks for customization. |
| `minimalRecord`, `originalMinimalRecord`, `originalInputAttributes`, `originalRecord` | Library-owned stored data and snapshots; availability depends on the stage. | Inspect them when available. Do not change snapshots to influence validation, permissions or persistence. |
| `transaction`, `db`, `shouldCommit`, `transactionOutcome`, `transactionCommitted`, `error`, `cleanupErrors` | Library-owned transaction and failure state. | Inspect through the documented transaction/error contract. Pass transaction handles through method arguments; do not replace these fields, forge outcomes or erase diagnostics. |
| `knexQuery`, `storageAdapter` | Temporary state at native query hook boundaries, also visible to nested query permission checks. | `knexQuery` is a filtering envelope; its `query` property holds the native builder. Use the [documented filtering contract](29-writing-plugins.md#knexqueryfiltering), and do not retain a builder for a later operation. |

Fields belonging to optional plugins follow those plugins' documented hooks.
Other implementation fields are not extension points simply because they are
visible on the context. A hook can throw to reject an operation; a late change
to validated attributes must not be used to bypass authorization or validation.

Use a fresh context for every independent operation, especially concurrent
calls. The same object is not an isolated request template: it contains loaded
records and transaction state after a call. To share authentication or a cache,
pass those values deliberately in new context objects. Nested objects are not
deep-cloned, so concurrent application hooks must coordinate shared mutations.

## Editor help for known hooks

Known hook names provide stage-specific context types when registered through
`api.customize` or resource hooks. For a separately declared handler, select its
hook name explicitly:

```typescript
import type { HookHandler } from 'json-rest-api'

type NoteContext = {
  auth?: { userId: string }
  notePermissions?: { canEdit: boolean }
}

const showEditPermission: HookHandler<'enrichAttributes', NoteContext> = ({ context }) => {
  context.attributes.canEdit = context.parentContext.notePermissions?.canEdit ?? false
}
```

Register `showEditPermission` as the handler of the named enrichment hook in the
recipe above. Use `RuntimeHooks<NoteContext>` to annotate a separate hook map.
JavaScript projects can use the same types through JSDoc and editor type checking.

The editor distinguishes an enrichment wrapper's `parentContext` from a
permission wrapper's `originalContext`, and marks library-owned fields such as
`method` and `transaction` readonly. Application cache properties and documented
write/output values remain mutable. Readonly annotations do not freeze runtime
objects or add another hook mechanism.

These types describe known boundaries, not a proof of the whole lifecycle.
Early input and arbitrary attribute values still need narrowing; a custom plugin
owns its custom hook context. Types cannot prove authorization, mutation order,
transaction completion or the safety of shared nested objects. Keep the runtime
contracts and focused hook tests alongside the editor guidance.

## Nested context inheritance

Built-in nested operations use separate context objects with shallow inheritance:

| Boundary | Inherited information | Separate working state |
| --- | --- | --- |
| Full write-response GET | Application properties and referenced cache/auth objects; the active transaction is passed explicitly. Write input is available for virtual-field response enrichment. | GET sets its own method, ID, schema, query selection and read result. Replacing a child top-level property does not replace the parent's property. |
| Relationship PATCH and reverse relationship child writes | Application properties and referenced objects; the active transaction is passed explicitly. | Child writes set their own method, input, schema and stored records. The parent retains its own operation identity and finish context. |
| Bulk children | Application properties and referenced objects; atomic children share the batch transaction. | Each child has its own context with `bulkOperation` and `bulkIndex`. Child cleanup diagnostics are collected by the batch. |
| Ordinary CRUD permission checks and attribute enrichment | A reference to the relevant operation through `originalContext` or `parentContext`. | A fresh wrapper for that permission/enrichment call. Adding a wrapper property does not add it to the originating context. Relationship permission hooks instead receive the relationship operation context directly. |
| Included-resource and relationship visibility queries | Application context and the active connection/transaction. | The library sets the target resource/schema and query selection; parent filters are not blindly applied as target filters. |

Shallow inheritance means a child sees an existing `context.cache` object by
reference: updating that object's contents is visible to the parent, whereas
assigning a different `context.cache` affects only the child. Library snapshots,
input and transaction bookkeeping remain subject to the ownership rules above.
Do not treat a child's copied write fields as that child's input: a nested GET
can retain information about the enclosing write for response enrichment.

For an application-initiated nested call, construct a new context containing the
application properties the child actually needs, and pass `transaction` in the
method arguments when it must participate in the parent's transaction. Passing
the parent's context object directly would let the child overwrite its method,
ID and other working fields. A blanket spread also inherits existing internal
fields; it is not a substitute for choosing the information to share.

## Resource write order

POST, PUT-create, PUT-update and PATCH follow this sequence. The method suffix
is `Post`, `Put` or `Patch`, for example `beforeDataCallPatch`.

1. Create or borrow a transaction and select response behavior.
2. `beforeProcessing`, then the method-specific processing hook.
3. Validate the request contract and relationships, and perform the
   method-specific existence/replacement checks. Run `beforeSchemaValidate`,
   then its method-specific hook; validate attributes; run the method-specific
   `afterSchemaValidate`, then `afterSchemaValidate`.
4. Authorize through `checkPermissions`; run `beforeDataCall`, then its
   method-specific hook.
5. Acquire required relationship locks, apply setters and write to storage.
6. Run the method-specific `afterDataCall`, then `afterDataCall`.
7. Apply relationship changes and refresh the minimal stored record.
8. Prepare the response; run `finish`, then its method-specific hook.
9. Commit an owned transaction and await its `afterCommit` chain.

DELETE has no processing, schema-validation or setter stage. Lookup and
permission checks precede `beforeDataCall` and `beforeDataCallDelete`.
Deletion precedes `afterDataCallDelete`, `afterDataCall`, `finish` and
`finishDelete`. DELETE returns no record.

The write hooks are named `beforeDataCall` and `afterDataCall`. `beforeData`
is a read hook. Registering `beforeDataPost` or `afterDataPost` does not attach
a handler to these resource write stages.

## Read order and output enrichment

GET authorizes through `checkPermissions`, then runs `beforeData` and
`beforeDataGet`. After fetching, it runs `checkDataPermissions`,
`checkDataPermissionsGet` and `enrichRecord`. Field getters and computed output
run during attribute enrichment, followed by `enrichAttributes`.
`enrichRecordWithRelationships`, `finish` and `finishGet` follow. Final
normalization, field projection and representation conversion happen afterward.

QUERY authorizes through `checkPermissions`, runs `beforeData` and
`beforeDataQuery`, fetches the collection, then runs `enrichRecord`.
Attribute enrichment covers primary and included records. `finish` and
`finishQuery` precede final projection and conversion. Do not infer QUERY
hook names or stages from the GET sequence.

Use declared computed fields for derived attributes so dependencies and sparse
fieldsets work together. An `enrichAttributes` hook operates on one attribute
object, whereas `enrichRecord` operates on the response document. Adding an
undeclared output key does not establish a supported field or bypass final
field filtering. Finish hooks are late observers; they are not a substitute
for schema validation or query policy.

## Relationship and bulk composition

Relationship POST and DELETE run `beforeDataCall`, followed by
`beforeDataCallPostRelationship` or `beforeDataCallDeleteRelationship`, after
resolving the visible parent and before mutation. Their context exposes
`scopeName`, `id`, `transaction`, and `minimalRecord`. A shared `beforeDataCall`
hook must account for `postRelationship` and `deleteRelationship` methods too.
Socket.IO uses this boundary to query subscription membership before a change;
its eligibility queries also run the ordinary query lifecycle in the write's
transaction with the subscriber's trusted context.

Relationship writes acquire database locks after the `beforeDataCall` hooks.
Belongs-to and polymorphic targets are rechecked while locking them. Collection
mutations also preserve a parent row version so concurrent replacements cannot
use stale membership; a database UPDATE trigger may run even when the parent's
attribute values did not change. These internal operations do not invoke another
resource hook. Keep borrowed transactions short, and leave rollback/retry of
deadlock or serialization failures to the outer owner. See
[relationship migration notes](33-migrating-to-v2.md#review-relationship-writes)
for the driver behavior and retry boundaries.

PATCH relationship authorizes through `checkPermissions` and
`checkPermissionsPatchRelationship`, then invokes a source-resource PATCH with
`returning: 'none'`, followed by `finish` and `finishPatchRelationship`.
POST/DELETE relationship invoke their own permission, before-data and finish
hooks. Reverse relationship mutations can run child PATCH lifecycles inside
the parent's operation. Direct pivot/link changes do not synthesize
pivot-resource hook calls.

Bulk operations invoke child resource lifecycles. Atomic children share a
transaction; non-atomic children complete separate transactions. Do not count
hook invocations as independent user requests or assume one context per batch.

## Completion and failure

Each hook is awaited. A failing ordinary hook stops later stages of its chain.
For an owned pre-commit failure, the operation attempts rollback;
`afterRollback` runs only after acknowledged rollback. After acknowledged
commit, an `afterCommit` failure reports a committed outcome and cannot undo
the mutation. Uncertain driver completion runs neither outcome hook.

With an explicit `api.transaction` handle, participating calls finish their
write stages while completion hooks wait for the owner. A rejected participant
poisons the managed unit even if its caller catches the error. Atomic children
complete in enlistment order after commit and reverse order after rollback.
Keep external side effects consistent with those boundaries; a finish hook
runs before commit.

See [managed transactions](19-managed-transactions.md) and
[transaction outcomes](20-transaction-outcomes.md) for ownership, typed failures
and retry guidance. `RestApiWriteError.cause` retains the error received at the
write boundary; it cannot recover an error replaced earlier by an extension
or the hook dispatcher.

## Registration-time extensions

Resource compilation exposes `schema:enrich` for stored attribute definitions,
`searchSchema:enrich` for filters, and then `computedSchema:enrich` for computed
output definitions. These run at registration and during canonical field
addition. Derived fields should use the computed hook so supported recompilation
rebuilds them. See the [computed enrichment contract and migration example](33-migrating-to-v2.md#computed-field-enrichment).


For plugin installation, scope registration, custom methods and helpers, use
[Writing Plugins](29-writing-plugins.md). Register resource-specific
behavior explicitly and guard global hooks by scope and method. Keep request
state on its operation context rather than in shared plugin variables.
