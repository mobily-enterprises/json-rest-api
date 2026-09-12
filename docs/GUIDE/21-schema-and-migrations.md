---
title: "Schema and migrations"
chapter: 21
chapter_label: "21"
---

# 21. Schema and migrations

`RestApiKnexPlugin` exposes a small schema-management surface for table-backed resources.

Use it when you want to:

- create tables directly from resource definitions
- add or alter plain columns on existing tables
- inspect a live table snapshot
- generate a create migration from a resource
- generate an additive diff migration from a live table

This is a Knex/table feature surface. It does not exist for non-table resources.

## Overview

Once a resource is backed by `RestApiKnexPlugin`, these scope methods are available:

- `createKnexTable()`
- `addKnexFields({ fields })`
- `alterKnexFields({ fields })`
- `introspectKnexTableSnapshot()`
- `generateKnexMigration()`
- `generateKnexMigrationDiff()`

Example:

```js
await api.addResource('memberships', {
  schema: {
    id: { type: 'id' },
    workspaceId: { type: 'id', required: true },
    userId: { type: 'id', required: true },
    role: { type: 'string', enum: ['owner', 'member'], required: true, defaultTo: 'member' }
  },

  indexes: [
    {
      name: 'uq_memberships_workspace_user',
      unique: true,
      columns: ['workspaceId', 'userId']
    }
  ],

  foreignKeys: [
    {
      name: 'fk_memberships_workspace_user',
      columns: ['workspaceId', 'userId'],
      referencedTableName: 'workspace_users',
      referencedColumns: ['workspace_id', 'user_id'],
      deleteRule: 'CASCADE',
      updateRule: 'RESTRICT'
    }
  ],

  checkConstraints: [
    {
      name: 'chk_memberships_workspace_positive',
      clause: 'workspace_id > 0'
    }
  ],

  tableName: 'memberships'
})
```

## Default Column Naming

Table-backed resources keep logical field names in the resource schema and map them to physical columns for Knex operations.

By default, physical columns use snake_case:

- `workspaceId` -> `workspace_id`
- `userId` -> `user_id`
- `createdAt` -> `created_at`

This keeps the API surface expressive without repeating `storage.column` on every camelCase field.

You only need `storage.column` when a field should use a non-standard column name:

```js
await api.addResource('profiles', {
  schema: {
    id: { type: 'id' },
    displayName: { type: 'string', required: true },
    legacyRef: { type: 'string', storage: { column: 'legacy_profile_ref' } }
  },
  tableName: 'profiles'
})
```

If you need physical columns to match the logical field names exactly for a whole resource, opt out explicitly:

```js
await api.addResource('verbatim_profiles', {
  storage: { naming: 'exact' },
  schema: {
    id: { type: 'id' },
    displayName: { type: 'string', required: true }
  },
  tableName: 'verbatim_profiles'
})
```

## Logical IDs and `idProperty`

`idProperty` names the physical primary-key column for table-backed resources. The API contract still uses the logical resource id.

```js
await api.addResource('profiles', {
  idProperty: 'user_id',
  schema: {
    id: { type: 'id', required: true, storage: { column: 'user_id' } },
    displayName: { type: 'string', required: true },
    loginCount: { type: 'number', defaultTo: 0 }
  },
  tableName: 'profiles'
})
```

With this definition:

- writes send the resource id as `id` or `data.id`
- reads return the resource id as `id` or `data.id`
- the primary key is stored in `user_id`
- `displayName` and `loginCount` are stored in `display_name` and `login_count`

The resource id is not part of `attributes`:

```js
await api.resources.profiles.post({
  format: 'jsonapi',
  document: {
    data: {
      type: 'profiles',
      id: '42',
      attributes: {
        displayName: 'Mercury'
      }
    }
  }
})
```

### ID normalization

If your primary keys need canonicalization beyond the default trim-and-stringify behavior, configure `normalizeId`.

```js
await api.use(RestApiPlugin, {
  normalizeId: (value) => {
    if (value === null || value === undefined) return null

    const normalized = String(value).trim()
    return normalized ? normalized.toUpperCase() : null
  }
})
```

You can override that per resource:

```js
await api.addResource('profiles', {
  idProperty: 'user_id',
  normalizeId: (value) => {
    if (value === null || value === undefined) return null

    const normalized = String(value).trim()
    return normalized ? normalized.toLowerCase() : null
  },
  schema: {
    id: { type: 'id', required: true, storage: { column: 'user_id' } },
    displayName: { type: 'string', required: true }
  },
  tableName: 'profiles'
})
```

For table-backed resources, `normalizeId` is applied before:

- reading a record by id
- replacing, patching, or deleting a record
- persisting an explicit `POST` resource id
- validating or writing relationship identifiers that point at the resource

If the normalizer returns an empty value, existing-resource operations fail as `not_found`, while explicit `POST` document ids fail validation on `data.id`.

## Create Tables

Create the table directly from the resource definition:

```js
await api.resources.memberships.createKnexTable()
```

`createKnexTable()` understands:

- storage-mapped column names
- mapped logical id columns
- top-level `indexes`
- top-level `foreignKeys`
- top-level `checkConstraints`
- enum columns
- MySQL-style `setValues`

This is the same table metadata used by migration generation and diffing.

## Field-Only Helpers

Two helpers only operate on columns:

```js
await api.resources.memberships.addKnexFields({
  fields: {
    noteCount: { type: 'number', defaultTo: 0, storage: { column: 'note_count' } }
  }
})

await api.resources.memberships.alterKnexFields({
  fields: {
    noteCount: { type: 'number', defaultTo: 7, storage: { column: 'note_count' } }
  }
})
```

Important:

- these helpers are field-only
- they reject top-level `indexes`, `foreignKeys`, and `checkConstraints`
- use `createKnexTable()`, `generateKnexMigration()`, or `generateKnexMigrationDiff()` for table metadata

Both regular-table helpers use the resource's `storage.naming` setting and each
supplied field's `storage.column`. For example, with `storage: { naming: 'exact' }`,
adding or altering `loginCount` addresses `loginCount`, not `login_count`.
Supply the complete intended column definition when altering a field, including
its explicit mapping, nullability and default. These regular helpers execute DDL;
keep the resource declaration in app source aligned with the migrated table.
They do not publish a new compiled resource schema as AnyAPI field additions do.

Direct `alterKnexFields` now handles PostgreSQL enum checks separately from the
column type. PostgreSQL alterations run in a transaction; passing a transaction
to the deep helper uses a savepoint and leaves the outer commit to its owner.
An owned PostgreSQL alteration uses the managed completion runner: errors retain
the original cause and `transactionOutcome`, failed completion prevents reuse of
its connection, and COMMIT acknowledged as ROLLBACK rejects. A failed or lost
savepoint RELEASE leaves the outer transaction to its caller; roll back that
owner rather than assuming the failed alteration has already been undone.

An incompatible enum or failed not-null change rolls back the whole field batch.
The column reader does not impose the full resource snapshot's single-column-ID
restriction and preserves unrelated indexes.

SQLite uses Knex's transactional table rebuild. Changing an enum's allowed
values, adding an enum to an existing string, or removing an enum throws before
any field in that call changes; supply a reviewed rebuild migration instead.
Changing only its default works. For the deep helper, a borrowed SQLite
transaction must start with `foreign_keys=OFF`, since SQLite cannot disable
foreign keys inside a transaction. The owner must validate `PRAGMA foreign_key_check`
before committing and restore enforcement afterward. Standalone calls let Knex
manage enforcement around its rebuild, preserving referencing rows. The library
holds that connection lease through error cleanup. If the driver reports an
unfinished transaction, cleanup rolls it back and restores the original
foreign-key setting before the connection can be borrowed again. A connection
whose state cannot be verified or whose cleanup fails is marked disposed.
Cleanup failure throws an `AggregateError` with the original error as `cause`
and the original/cleanup errors in order. This does not establish an uncertain
COMMIT's outcome or retry the alteration.

MySQL executes the field batch as one ALTER statement. Passing an existing
transaction to the deep helper throws before DDL, because MySQL would implicitly
commit it. Run schema changes separately from application transactions.

### AnyAPI field additions

AnyAPI allocates canonical slots and refreshes its compiled resource schema:

```js
await api.resources.items.addKnexFields({
  fields: {
    note: { type: 'string', nullable: true, search: true },
    score: { type: 'integer', defaultTo: 0 }
  },
  canonicalFieldsMap: { note: 'string_4' },
  searchSchema: {
    noteContains: { type: 'string', actualField: 'note', filterOperator: 'contains' }
  }
})
```

This optional map may cover a subset of the new stored fields; remaining fields
use the existing allocator. An initial resource map must still cover all stored
fields. Invalid, occupied or unknown slots and existing field names reject the
addition. Computed and virtual fields need no slots and cannot have overrides.
AnyAPI `alterKnexFields` remains explicitly unsupported.

One call uses one owned metadata transaction. Allocation failure rolls back the
batch and leaves the runtime schema unchanged. Added getters, setters, defaults,
serializers, computed fields and filters use the existing schema compiler;
cached request contracts are refreshed. Ordinary table helpers retain their
separate DDL behavior.

Existing rows are not backfilled: unused slots stay null, and defaults apply to
subsequent writes. Function defaults do not run during allocation. Backfill old
rows explicitly when needed. Declare the expanded schema and complete slot map
in app source for restart, including callbacks that persisted JSON cannot store.

Explicit maps now take effect during registration. Repeating `createKnexTable()`
ensures canonical tables and refreshes schema information without replacing
field metadata or removing additions.

Canonical registration allocates slots from the enriched compiled definitions;
it does not compile a second schema from persisted JSON. Schema/search hooks run
once per registration or `addKnexFields` compilation. Repeated table creation
does not rerun them. Search hook changes therefore survive descriptor refresh.

Re-registration rejects removing or remapping existing stored fields while the
resource has records. Preserve a complete `canonicalFieldsMap` when declaration
order changes, and perform an explicit data migration for layout changes. See
the [schema enrichment migration steps](33-migrating-to-v2.md#schema-enrichment-and-canonical-registration),
including the consequences for hooks that were previously overwritten.

Deep `AnyapiRegistry.allocateField` calls persist the field definition and its
allocation together. Borrowed transactions own their reads/writes and bypass the
global descriptor cache; the registry does not commit, roll back or publish their
uncommitted descriptors globally. After commit, call
`invalidateDescriptor(tenant, resource)` before an ordinary cached read. Deep
registry calls do not refresh an existing API's compiled schema; use the resource
helper for in-process additions.

Owned registry writes preserve their original rejection when rollback also
fails. The registry passes the original error and secondary `cleanupErrors` to
its error logger with the tenant and resource. It guards that logging call;
these diagnostics do not add fields to a frozen error. Registry writes now reject
with `RestApiWriteError`, preserving that original error as `cause` and carrying
the transaction outcome. The [migration guide](33-migrating-to-v2.md) explains the
error-class change and the outcome contract's current verification status.

A failed owned write invalidates its descriptor cache entry. In particular, a
commit call can reject after the database has completed the transaction; the
registry skips further rollback and reloads metadata on the next uncached read.
Driver completion alone does not prove commit or rollback, so callers must not
assume a rejected operation is safe to retry. Descriptor cache keys distinguish
the full tenant/resource pair, including identifiers containing `::`. This
in-memory cache correction requires no stored-data migration.

Unexpected descriptor read failures retain their original `cause` and context
identifying the tenant, resource (`scopeName`) and `descriptor` phase. Typed
API errors retain their identity on reads and become the cause of
`RestApiWriteError` when propagated through a write. Relationship processing propagates these
failures instead of returning partial linkage or includes. Direct registry
lookups return null for absent metadata; operations requiring that relationship
descriptor reject a missing descriptor. Schema errors and database failures
are distinct from a valid relationship with no matching records.

## Live Table Snapshots

Use `introspectKnexTableSnapshot()` to inspect the physical table shape:

```js
const snapshot = await api.resources.memberships.introspectKnexTableSnapshot()
```

Returned shape:

```js
{
  dialect: 'sqlite',
  schemaName: 'main',
  tableName: 'memberships',
  tableCollation: '',
  idColumn: 'id',
  primaryKeyColumns: ['id'],
  hasWorkspaceIdColumn: true,
  hasUserIdColumn: true,
  columns: [...],
  indexes: [...],
  foreignKeys: [...],
  checkConstraints: [...]
}
```

Column entries are normalized and include information such as:

- physical column name
- logical key
- type kind
- nullability
- default value
- precision / scale / datetime precision
- enum values
- set values

Current live introspection support:

- SQLite
- PostgreSQL via `pg` (verified on PostgreSQL 16)
- MySQL via `mysql2` (verified on MySQL 8; this does not establish MariaDB coverage)

PostgreSQL inspection reads the current schema's
[columns](https://www.postgresql.org/docs/16/infoschema-columns.html),
[indexes](https://www.postgresql.org/docs/16/catalog-pg-index.html) and
[constraints](https://www.postgresql.org/docs/16/catalog-pg-constraint.html).
It recognizes serial/identity allocation, mapped integer/string IDs, native temporal
precision, JSON/binary types and Knex's inline enum checks. Table and schema
names are bound in catalog queries.

The snapshot requires a single, non-null integer or string primary key.
Database allocation/default is optional: application-supplied IDs are supported,
and the snapshot still records the actual `autoIncrement` and default metadata.
PostgreSQL partial/expression indexes, included
index columns, nondefault null uniqueness, invalid indexes, exclusion constraints
and foreign keys into another schema are rejected when they cannot be represented
by this snapshot. Do not interpret that limited snapshot model as a database
limitation. Broader schema capabilities remain under verification.

## Create Migrations

Use `generateKnexMigration()` to emit a Knex migration string from the resource definition:

```js
const migration = await api.resources.memberships.generateKnexMigration()
console.log(migration)
```

This generates `exports.up` and `exports.down` for full table creation/drop.
The generated source is CommonJS: save it with a `.cjs` extension in an ESM
application, and configure Knex's migration loader to include that extension.
Review the generated migration before running it; generation does not execute DDL.

Static defaults retain their value, including empty/quoted/padded strings,
booleans, SQL null and BigInt literals. A function-valued `defaultTo` belongs to
runtime validation: table creation and migration generation do not call it or
freeze its result as a database default.

New dateTime/time columns default to precision 6 unless `temporalPrecision` is
declared. The time declaration explicitly includes its precision because the
Knex PostgreSQL time builder does not apply the precision argument. SQLite's
Knex decimal columns are stored as `float`; native decimal precision/scale
metadata is not available there.

It includes the same table metadata as `createKnexTable()`:

- mapped columns
- mapped id column
- indexes
- foreign keys
- check constraints
- enum columns
- supported MySQL-specific set columns

## Diff Migrations

Use `generateKnexMigrationDiff()` to draft a migration by comparing one resource's
desired schema against its live table snapshot. Review the plan, warnings and
generated code before placing the file in your application's Knex migrations:

```js
const diff = await api.resources.memberships.generateKnexMigrationDiff()
```

Returned shape:

```js
{
  migration,
  warnings,
  plan
}
```

`plan` is normalized into:

- `addColumns`
- `alterColumns`
- `dropColumns`
- `addIndexes`
- `dropIndexes`
- `addForeignKeys`
- `dropForeignKeys`
- `addCheckConstraints`
- `dropCheckConstraints` (PostgreSQL inline-enum replacements)

The generated migration is intentionally additive-first:

- create missing columns
- alter columns when supported
- recreate changed indexes when needed
- add missing foreign keys, or drop and recreate a changed named foreign key
- add supported check constraints

Columns, indexes and foreign keys omitted from the resource schema are preserved
by default, with warnings. A resource may describe only part of an application's
database contract. To remove omitted metadata deliberately, pass explicit booleans:

```js
const diff = await api.resources.memberships.generateKnexMigrationDiff({
  options: {
    allowDropColumns: true,
    allowDropIndexes: true,
    allowDropForeignKeys: true
  }
})
```

Enable only the removals you have reviewed. These flags cover every omitted item
of that kind in this table, so review each planned removal. A changed definition
under an existing index or foreign-key name is an explicit replacement and adds
a warning without needing a drop flag. Dropping a column while retaining its
index or foreign key rejects generation; remove that dependency explicitly too.
Necessary MySQL indexes supporting declared foreign keys remain preserved.

New not-null columns without a static non-null database default produce a
backfill warning, even when an application hook or function default would supply
values for future writes. Bigint-to-integer changes on native databases warn
about overflow. Generation does not inspect existing row values to prove either
change will succeed.

The diff compares effective storage declarations, including the default string
length and temporal precision. Native integer/float/binary metadata does not
produce an alteration merely because it reports implicit size information.
Boolean and decimal defaults compare by value; textual defaults retain their
contents. Equivalent check formatting does not propose a duplicate constraint,
and comparison preserves string-literal case.

PostgreSQL enum changes alter the text column and replace its inline check in
separate statements. `plan.dropCheckConstraints` makes those removals visible.
Use the normal transactional Knex migration execution: if existing values violate
the new enum, PostgreSQL can roll back the check removal and column change.
MySQL uses native enum alteration; its rejected narrowing case preserves the
old values and definition, but this does not promise transactional MySQL DDL.

Changing only native datetime/time precision now produces an executable
alteration. Reducing precision adds a data-loss warning. Tests execute increasing
precision and additive changes with existing rows, verify preserved values, then
require an empty second diff. MySQL non-unique indexes needed by retained foreign
keys are kept even when they were created implicitly by the database.

Enum values and static text/JSON/array defaults preserve apostrophes, backslashes
and question marks on the tested drivers. PostgreSQL literals avoid Knex's
parameter-marker rewriting, and MySQL introspection decodes generated JSON
defaults and escaped enum values without proposing another alteration. Quoted
constraint identifiers preserve case and spaces; changing `role` does not remove
a check on PostgreSQL's distinct `Role` column.

Direct table helpers require `schema` to contain `structure: fields`, including
add/alter helpers. Keep table metadata beside `structure`; bare field maps reject
before SQL. A `json-rest-schema` instance already provides `structure`. Public
resource calls retain `addKnexFields({ fields })` and `alterKnexFields({ fields })`.
See [the migration example](33-migrating-to-v2.md#table-helper-schemas-use-an-explicit-structure-wrapper).

Standalone `generateKnexMigration(tableName, schema, options)` calls must supply
`options.dialect` when enum/default values need dialect-specific escaping. The
resource-level generator already obtains it from the configured Knex client.

When a MySQL migration replaces or removes a supporting index, its plan includes
dropping the dependent foreign key first and restoring it after the new indexes
exist. This also allows removing an unwanted unique index while retaining
referential integrity. MySQL may create a replacement non-unique supporting
index. Composite keys retain their declared column order and referential actions.
These migrations use multiple DDL statements: pause application writes during
execution, and account for MySQL's implicit commits when planning recovery.

## Important Limits

This is a schema-vs-live-table diff, not a migration-history engine.

It answers:

- what the table looks like now
- what the resource says it should look like
- what Knex migration changes it can propose for review

It does not answer:

- what changed since a previous migration file
- how to reconstruct migration history
- whether the proposed change is safe for all existing data and application code
- how to synchronize an entire database from a resource schema

Other important limits:

- destructive changes are surfaced as warnings
- omitted columns, indexes and foreign keys are preserved unless their respective
  drop option is explicitly enabled
- partial and expression indexes cannot be represented by the simple SQLite or
  PostgreSQL snapshot and reject introspection instead of producing a false match
- SQLite descending or non-binary-collation indexes, and MySQL expression,
  prefix or descending indexes, also reject full snapshots
- generated columns reject full table snapshots on SQLite, MySQL and PostgreSQL;
  the narrower reader used by direct field alterations remains separate
- SQLite check-constraint add/drop/alter support is warning-only
- changing/removing an existing named check is warning-only on all dialects;
  PostgreSQL inline-enum replacements are handled separately
- changing the allowed enum values on SQLite is warning-only: its native ALTER
  cannot replace the check, and Knex's column rebuild retains the old check.
  Supply a reviewed table-rebuild migration for that change. The generated diff
  leaves the existing enum column unchanged and reports why; it does not claim
  that the new values became valid. Changing only an enum default is supported
- `setValues` diffing is only emitted for MySQL-compatible targets
- diff migrations do not auto-generate a destructive `down`

Passing the real-table suite does not verify every alteration: arbitrary SQL
default expressions, complex dependencies from other tables, native PostgreSQL
enum types and manual SQLite enum rebuilds remain outside its verified surface. Review the
generated SQL and warnings for the actual database. See
[contributing](../contributing.md#real-databases-and-redis) for native test commands.

PostgreSQL index sort direction, operator classes and collation details are not
fully represented by this snapshot. Inspect those definitions separately before
replacing an index; a successful snapshot is not a complete dependency or SQL
feature audit.

## When to Use Which Helper

- `createKnexTable()`
  - bootstrap a table directly from the resource

- `addKnexFields()` / `alterKnexFields()`
  - small column-only local changes

- `introspectKnexTableSnapshot()`
  - inspect the real physical table

- `generateKnexMigration()`
  - emit a full create migration from the current resource definition

- `generateKnexMigrationDiff()`
  - emit an additive migration against the live table
