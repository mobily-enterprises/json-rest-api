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
  inputRecord: {
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
