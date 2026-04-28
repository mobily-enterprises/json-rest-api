# Knex Schema and Migrations

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
    workspaceId: { type: 'id', required: true, storage: { column: 'workspace_id' } },
    userId: { type: 'id', required: true, storage: { column: 'user_id' } },
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
    role: { type: 'string', enum: ['owner', 'member', 'viewer'] }
  }
})
```

Important:

- these helpers are field-only
- they reject top-level `indexes`, `foreignKeys`, and `checkConstraints`
- use `createKnexTable()`, `generateKnexMigration()`, or `generateKnexMigrationDiff()` for table metadata

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
- MySQL / MariaDB via `mysql2`

## Create Migrations

Use `generateKnexMigration()` to emit a Knex migration string from the resource definition:

```js
const migration = await api.resources.memberships.generateKnexMigration()
console.log(migration)
```

This generates `exports.up` and `exports.down` for full table creation/drop.

It includes the same table metadata as `createKnexTable()`:

- mapped columns
- mapped id column
- indexes
- foreign keys
- check constraints
- enum columns
- supported MySQL-specific set columns

## Diff Migrations

Use `generateKnexMigrationDiff()` to compare the desired schema against the live table snapshot:

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

The generated migration is intentionally additive-first:

- create missing columns
- alter columns when supported
- recreate changed indexes when needed
- add missing foreign keys
- add supported check constraints

## Important Limits

This is a schema-vs-live-table diff, not a migration-history engine.

It answers:

- what the table looks like now
- what the resource says it should look like
- what Knex migration can safely move the table toward that shape

It does not answer:

- what changed since a previous migration file
- how to reconstruct migration history

Other important limits:

- destructive changes are surfaced as warnings
- dropped columns are skipped unless explicitly allowed by diff options
- SQLite check-constraint add/drop/alter support is warning-only
- `setValues` diffing is only emitted for MySQL-compatible targets
- diff migrations do not auto-generate a destructive `down`

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
