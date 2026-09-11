# Backend capabilities and limits

This reference describes the current working tree. Its breaking API is not yet
a coordinated consumer release; follow the [migration guide](MIGRATING_API_V2.md)
before upgrading an application. Node 24 or later is required; verification is
run on Node 24 only.

## Database and storage choices

| Combination | Verification and limits |
| --- | --- |
| SQLite through `better-sqlite3` | Verified with SQLite 3.49.2. Ordering helpers require SQLite 3.30 or later. Concurrent writers can fail with busy/snapshot conflicts; the library does not make SQLite a multi-writer database. |
| PostgreSQL through `pg` | Verified on PostgreSQL 16. Native precision, constraints, transaction visibility and failure paths have dedicated checks. |
| MySQL through `mysql2` | Verified on MySQL 8. DDL can implicitly commit and is not treated as an atomic rollbackable migration. |
| MariaDB, MSSQL, Oracle and other Knex clients | Unverified, including dialects with branches in capability helpers. Those branches are not a support guarantee. |

The library does not ship a generic remote-service or NoSQL CRUD backend. See
[custom data sources](GUIDE_5_Non-Db_Resources.md) for the distinction between
custom service methods and a complete storage integration.

The SQL matrix exercises ordinary resource tables and canonical AnyAPI storage.
Canonical storage uses shared tables with tenant/resource predicates and opaque
logical IDs; those IDs sort lexically. Ordinary numeric IDs sort numerically.
Neither storage choice changes the database's transaction or collation behavior.
Dedicated collation tests cover selected cases, not arbitrary database collations.
Other server versions and Windows remain unverified.

Per-parent include limits require window-function capability. Capability detection
does not establish support for every query on an otherwise unverified dialect.
Use the executed capability map (source checkout: `docs/development/conformance.md`)
and database verification guide (source checkout: `docs/development/real-databases.md`) for exact
suite scopes and versions. A passing SQLite suite is not native PostgreSQL/MySQL
evidence, even when launched with a different storage-mode environment variable.

## Temporal values

Public date/dateTime inputs are strings; time inputs remain strings too. Built-in
dateTime writes pass through JavaScript Date and support millisecond precision.
They reject nonzero submillisecond digits. Declaring precision 6 does not enable
microsecond writes through that conversion. Database string reads can retain
microseconds; library PostgreSQL/MySQL queries request temporal strings to avoid
loss through driver Date conversion. Caller-owned raw queries retain their own
driver parsing behavior.

Native PostgreSQL/MySQL time/dateTime columns accept declared precision 0–6.
New columns default to precision 6; existing columns require a reviewed migration.
MySQL native DATE/DATETIME writes reject years below 1000. Custom text mappings
and synchronous serializers can support different storage representations, but
must satisfy the chosen column, driver and read-normalization contracts.
See [temporal migration details](MIGRATING_API_V2.md#temporal-values-and-storage-serializers)
for calendar ranges, UTC normalization, time formatting and old canonical slots.

## Schema changes

Generated diffs describe the declared schema versus the live table; they are not
a migration-history engine. Review warnings and generated SQL. Unsupported
changes can be omitted with warnings, and destructive `down` migrations are not
generated automatically. SQLite check/enum changes can require a reviewed table
rebuild. Native SET fields require an explicit MySQL target.

AnyAPI field additions persist slot metadata; `alterKnexFields` is unsupported.
Re-registering populated resources cannot remove or remap stored fields. Preserve
slot maps and migrate stored data explicitly when changing layouts. Old canonical
temporal storage needs the documented data migration, not just a package update.
See [table helpers and migration limits](GUIDE_X_Knex_Schema_And_Migrations.md).

## Transaction ownership and failures

Use `api.transaction` to group library writes and raw SQL. Its callback receives
a real Knex transaction, but the library owns completion and deferred hooks.
Pass that handle to each participating operation and await each call. Unmanaged
raw Knex transactions and child savepoints are rejected by library write methods.
Raw transactions remain usable for direct SQL, low-level helpers and read-only
API calls; each low-level schema/registry helper retains its documented contract.

A rejected write can already be committed. Inspect the recorded transaction
outcome; an unknown outcome requires reconciliation rather than blind replay or
upload deletion. The library does not automatically retry conflicts. See
[transactions and errors](MIGRATING_API_V2.md#transactions-and-errors) for ownership,
completion-hook behavior and migration examples.

## Files, notifications and known gaps

`LocalStorage` writes real files. The exported `S3Storage` is a mock/demo URL
generator and does not upload bytes to Amazon S3. A real S3 adapter is not
implemented by this roadmap. File cleanup is best effort; failures remain in
diagnostic context for reconciliation. See [file storage and cleanup](GUIDE_X_File_Uploads.md).

Socket.IO has real WebSocket/polling and Redis integration checks. These are
resource invalidations, not a durable event log or exactly-once delivery system;
see the [Socket.IO contract](GUIDE_X_SocketIO.md).

Native positioning concurrency has a known failure. Canonical native positioning
verification and implementation work remain paused. Passing unrelated CRUD,
Socket.IO or database suites does not clear that limitation. Real-consumer
migration and the final cross-repository verification also remain unfinished.
