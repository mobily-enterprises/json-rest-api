# Version-field migration

This explicit schema/data procedure is verified on SQLite, PostgreSQL and MySQL
in both storage modes. The library implements revision conditions, membership
invalidation and optional HTTP validators. Stored revisions and HTTP
representation validators have different scopes; see the
[API migration guide](MIGRATING_API_V2.md) for their contracts. Application
adoption and the coordinated consumer migration remain unfinished.

## Choose the field deliberately

Declare a stored string attribute, such as `revision`, and later select it with
`versionField: 'revision'`. The field must be distinct from the primary ID and
cannot have a getter, setter, storage serializer, computed/virtual behavior or
relationship. The library creates opaque UUID tokens. Clients must compare and
submit the entire token, without parsing, trimming or changing its case.

Keep the selected output visibility explicit. A hidden revision remains hidden;
enabling versioning does not expose it. Clients using conditional writes need
an authorized way to read the revision. Full write responses or a subsequent
GET can provide it; minimal and none responses do not promise a new token.

## What changes a revision

The revision tracks public resource writes and declared relationship membership.
It is not a hash of the complete response and is not an HTTP ETag.

| Operation | Revision behavior |
| --- | --- |
| POST or unconditional PUT-create | Initializes a fresh UUID. Reusing a deleted ID never reuses its old revision. |
| PATCH or PUT-update | Assigns a fresh UUID, including unconditional writes and writes that submit unchanged attribute values. Clients must not treat tokens as operation counts. |
| Conditional PUT-create | Fails as not found; a condition cannot match a nonexistent row. |
| DELETE | Checks the supplied condition before deletion; surviving versioned relationship parents are invalidated. |
| Public relationship mutation | Rotates the owner's revision and affected configured inverse revisions. Explicitly retained many-to-many targets may also receive new tokens. |
| Child creation, reparenting, detachment or deletion | Rotates affected configured has-many/has-one parent revisions, including declared polymorphic inverses. |
| Child attribute change with unchanged membership | Does not rotate the parent's revision merely because included child attributes changed. |
| Ordinary pivot-resource write | Invalidates affected configured parents when either membership key changes. Canonical through-resource records remain separate from canonical links. |
| Bulk PATCH or DELETE | Applies the same rules per child. Optional `expectedVersions` must contain one token per input entry. |
| Transaction rollback | Restores revisions together with the associated writes and links. |

Submit conditions through `expectedVersion`, not as an attribute update. Omitting
the condition permits an unconditional write; versioning does not require every
client to submit a token. JSON:API and plain formats use the same stored revision
and preserve the field's visibility rules. SQL writers, triggers and transitive
database cascades require application-owned revision maintenance; the library
cannot infer their arbitrary effects on other resources or representations.

Each successful write consumes the previous revision even inside one transaction.
Use the returned revision for a second conditional write in that transaction;
reusing the first token conflicts. Rolling back the transaction restores the
revision that existed before its writes.

## Prepare existing data

Stop all writers, including old application instances, jobs and raw SQL writers.
Take the application's normal backup. Keep writers stopped through field
allocation, backfill, configuration deployment and readiness checks. Do not
enable version conditions against partially migrated data.

For ordinary Knex storage, add a nullable string column in an explicit schema
migration. Resolve any declared physical column mapping rather than assuming
the attribute and column names coincide. Allocate at least 128 characters if
using VARCHAR. Do not set a single shared default revision for existing rows.
Schema DDL and the data backfill are separate migration steps: transactional
DDL support differs by database.

For canonical storage, allocate a stored string field through `addKnexFields`
on the unversioned resource. This records its canonical slot allocation; do not
choose a `string_N` slot by inspection of empty record values. Read the resulting
descriptor's `fields.revision.slot` and use that actual column for the backfill.
Every canonical record query must include both `tenant_id` and `resource`, and
pagination must use physical `any_records.id`, not tenant-local `logical_id`.

Backfill SQL NULL revisions with a fresh UUID for each row in a caller-owned
transaction. Preserve existing valid string tokens so retries do not invalidate
clients unnecessarily. Reject empty or overlong existing values and resolve
them explicitly; do not silently overwrite them. If any validation or write
fails, let the error escape the transaction callback so the entire data phase
rolls back. The migration must not call public PATCH merely to populate tokens:
that would run application write hooks and side effects.

The repository's backfill example (source checkout: `examples/migrations/resource-versions.js`)
implements this data phase in pages of 100 records. Copy it into the application
migration directory and import it locally; it is an example, not a new library
export. Use an active raw Knex transaction for this one-off SQL migration.

For a dedicated ordinary table, after adding its nullable column:

```javascript
import { backfillResourceVersions } from './resource-versions.js'

await knex.transaction(transaction => backfillResourceVersions(transaction, {
  tableName: 'books',
  idColumn: 'id',
  versionColumn: 'revision',
  scope: {}
}))
```

Replace the physical names with the application's actual mapping. An explicit
empty scope means the whole dedicated table. For canonical storage, allocate
the field and resolve its persisted slot first:

```javascript
await api.resources.books.addKnexFields({
  fields: { revision: { type: 'string', nullable: true } }
})
const tenant = api.anyapi.tenantId
const descriptor = await api.anyapi.registry.getDescriptor(tenant, 'books', {
  bypassCache: true
})
await knex.transaction(transaction => backfillResourceVersions(transaction, {
  tableName: 'any_records',
  idColumn: 'id',
  versionColumn: descriptor.fields.revision.slot,
  scope: { tenant_id: tenant, resource: 'books' }
}))
```

Run field allocation once as its own migration step. Rerun only the data phase
to check backfill retry behavior; adding an already allocated field is an error.
The returned `scanned` and `initialized` counts let the migration record exactly
what it inspected and initialized. A successful retry preserves all tokens and
returns `initialized: 0`.

## Deploy and check readiness

Persist the field declaration in application source, including canonical field
configuration where applicable, then restart with `versionField: 'revision'`.
Selecting this option alone does not perform schema migration or backfill.
Restart resource registration against existing tables; do not run
`createKnexTable` again for an ordinary table that already exists.
Canonical `alterKnexFields` is not supported; do not use it to enforce SQL
NOT NULL on a shared slot. Application `required: true` can be enabled in the
new resource declaration after the backfill.

Verify every selected row has a valid string token, unrelated tenants/resources
are unchanged, and retrying the backfill initializes zero additional rows.
Check that a new POST initializes a token, unconditional PATCH rotates it,
a current conditional PATCH succeeds, and a stale one returns
`REST_API_VERSION_CONFLICT` without changing stored data. Test rollback before
allowing writers to resume.

Clients send `expectedVersion` alongside the single-write options, or aligned
`expectedVersions` for bulk PATCH/DELETE. They must not submit the revision among
the record attributes. A conflict requires fetching and reconciling the current
record; blindly retrying with a newly fetched token can overwrite another
client's edits. These tokens are not HTTP ETags.

If application deployment is rolled back, stop writers first. Old unconditional
writers do not maintain the new contract. Before re-enabling conditional clients,
rotate revisions for rows that might have changed under those writers, or
restore the pre-migration backup as part of the application's rollback plan.
The nullable added column can remain during rollback; dropping it is not
necessary to disable conditional writes.


## Pivot-resource writes

For ordinary storage, public writes to a declared many-to-many through resource
also invalidate affected versioned parent revisions. Both keys matter: changing
the member while retaining the parent still changes that parent's membership.

Canonical through-resource records are separate from canonical relationship
links. Use public relationship methods to change canonical memberships; creating
a through-resource record does not create a canonical link. Direct SQL and other
writers that bypass the public mutation paths still need explicit revision
maintenance.

## Deleting linked resources

Deleting a resource through the public API removes its many-to-many links in
the same transaction. Recreating the same resource ID starts without those old
memberships. Surviving versioned parents receive new revisions when their
membership changes. A caller rollback restores the deleted record, links and
parent revisions together.

Ordinary storage removes remaining declared pivot references after deleting the
resource row; canonical storage removes links matching its tenant, resource and
ID in either direction. Applications must not depend on deleted IDs retaining
memberships for later reuse. This does not provide revision maintenance for
arbitrary database triggers or SQL writers outside the public API.

Earlier releases deliberately left ordinary pivot rows for application cleanup.
That behavior changes: declared membership rows are removed automatically,
including for unversioned resources and custom IDs. Related resource records
are preserved; deleting a book's author links does not delete its authors.

Explicit ordinary SQL foreign keys retain their configured behavior: `RESTRICT`
can reject deletion, leaving both membership and revisions unchanged; `CASCADE`
can remove the pivot, with the surviving parent's revision updated by the public
delete transaction. These two rules are tested on SQLite, PostgreSQL and MySQL.

## Verification

The executable example and allocation/restart workflow pass six checks in each
of six database/storage combinations (36 total), with no failures or skips.
Tests cover 103 rows across multiple pages, distinct initialization tokens,
preservation of existing tokens, retry, rollback after late invalid data,
caller-owned rollback, filtered records, overlapping canonical tenants/resources,
and post-migration conditional updates and creation. See
the test suite (source checkout: `tests/conformance-version-migration.test.js`).
