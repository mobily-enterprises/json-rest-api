---
title: "Hooks and lifecycle"
chapter: 13
chapter_label: "13"
---

# 13. Hooks and lifecycle

Hooks extend particular lifecycle stages. Their names, ordering and context
shape depend on the operation. A write can invoke read hooks while preparing
its full response, and relationship writes can invoke nested resource writes.

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
  schema: { title: { type: 'string', required: true } }
})
await api.resources.notes.createKnexTable()
const events = []
api.customize({
  hooks: {
    beforeSchemaValidatePost: {
      functionName: 'normalize-note-title',
      handler: async ({ context }) => {
        if (context.scopeName !== 'notes') return
        const attributes = context.inputRecord.data.attributes
        if (typeof attributes.title === 'string') attributes.title = attributes.title.trim()
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
        if (context.scopeName === 'notes') events.push(`finish:${context.method}`)
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

The normalization runs before attribute validation, so it checks the input type
before using a string method. For an ordinary field transformation, prefer a
schema setter; this example demonstrates a hook boundary.

```javascript
const fullNote = await api.resources.notes.post({
  inputRecord: { title: '  First note  ' }, format: 'plain', returning: 'full'
})
const fullEvents = events.splice(0)
console.log(fullNote.title, fullEvents)
```

The title is `First note`. The event sequence is `validate:post`, `write:post`,
`read:get`, `finish:post`, `commit:post`. The full response invokes a nested GET
before the write finishes; its context has method `get`.

```javascript
const minimalNote = await api.resources.notes.post({
  inputRecord: { title: '  Second note  ' }, format: 'plain', returning: 'minimal'
})
const minimalEvents = events.splice(0)
console.log(minimalNote, minimalEvents)
```

The minimal result contains `id` and `type: 'notes'`. The events omit `read:get`.
`returning: 'none'` also avoids that response GET. Do not put mandatory write
validation in read hooks: it would depend on the requested return mode.

## Context depends on the boundary

`format: 'plain'` and `format: 'jsonapi'` select public representations. Resource
POST/PUT/PATCH normalize plain input into a JSON:API document before their
processing hooks. That document is not yet validated at the early processing
boundary. Reads and DELETE do not have a resource input document; relationship
writes accept `relationshipData` instead.

| Boundary | Where to find operation data |
| --- | --- |
| Resource processing, validation, data and finish hooks | `context` is the operation context; inspect `method` and `scopeName` before using method-specific properties. |
| Resource authorization through `checkPermissions` | The operation context is `context.originalContext`. |
| Attribute enrichment | `context.attributes` is the attribute object for one resource; `context.parentContext` is its read operation context. Included resources also receive enrichment. |
| Full write response | A nested GET has a separate context and shares the write's transaction and auth identities. |

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
