# Real database verification

The database runner starts disposable PostgreSQL and MySQL servers and runs each
selected suite with both regular Knex and AnyAPI storage. SQLite uses a separate
in-memory connection per fixture by default; concurrent tests use a disposable
WAL file and separate pooled connections. Each real-server fixture creates a randomly
named database, closes its pool, and drops that database on completion or setup
failure. Existing application databases and system services are not used.

## Run the completed database checks

Use the repository's Node version (`nvm use`, then `npm ci`). The development
dependencies include `pg` and `mysql2`. PostgreSQL's `initdb` and `postgres`, and
a MySQL `mysqld` binary, must also be available:

```sh
npm run test:databases
npm run test:databases:sqlite
npm run test:databases:pg
npm run test:databases:mysql
```

`JSON_REST_API_POSTGRES_BIN` selects the directory containing `initdb` and
`postgres`; otherwise the runner uses `pg_config --bindir`.
`JSON_REST_API_MYSQL_BIN` selects the MySQL executable; otherwise it uses
`mysqld` from PATH. MariaDB does not substitute for the required MySQL job.

The default command discovers every `tests/conformance-*.test.js` file and adds
the environment suite, `db-schema-conformance`, `db-field-alterations`,
`anyapi-temporal-migration`, `anyapi-field-evolution`, `anyapi-registry-failures`
and `anyapi-descriptor-failures`. The runner discovers
new conformance files automatically; the latest executed set is recorded in the
verification log.
Every shared conformance fixture uses the selected real driver. This includes
CRUD/relationship writes, response formats, field values, generated cases,
independent operation models, related collections, authorization, bulk policy
checks, and actual Express/Fastify requests and Socket.IO notifications.
These cover server identity, isolation and cleanup,
canonical schema setup, custom/generated IDs, real insert results, filters,
counts, projections, pagination, mapped/limited relationship includes, temporal
values, serializers and precision/range rejection. The table helper suite
executes ordinary SQL table creation, introspection, create/additive/precision
migrations, default preservation and named foreign-key replacement. It explicitly
uses regular tables even during the AnyAPI invocation; those repeated checks do
not establish canonical schema-evolution coverage. The separate temporal
migration suite always uses canonical storage, including the regular invocation.
It executes the one-off migration example against old slot metadata and existing
rows, then verifies fresh API reads, relationships, filters, cursors, native
precision changes and transactional failure recovery. Repeating it in both
invocations does not turn it into regular-table migration coverage.
The field-evolution suite also always uses canonical storage. It checks public
field additions, static/function defaults, transforms, filters, explicit slots,
repeated creation, restart declarations, failed batches and transaction-local
registry descriptors on the actual selected database.
The environment suite also verifies restoration/enforcement of the canonical
logical-ID unique index and repeated setup with a borrowed transaction.
The transaction suites check actual separate-connection visibility, owner
commit/rollback, repeated snapshots, disjoint PATCH updates, generated IDs,
atomic batch visibility and rollback across relationship changes. SQLite tests
assert its busy/snapshot conflict rather than pretending that two writers can
run together. Details and remaining races are in
[conformance coverage](conformance.md#concurrent-application-transactions).
They also execute competing replacements, inverse-edge additions, target/parent
deletion races and native deadlock recovery, checking final stored membership.
Broader schema changes, actual consumer migrations and transaction outcome APIs
have separate unfinished requirements. The [capability map](conformance.md#capability-map)
lists executed coverage and remaining limits; passing this command does not
establish every optional plugin/backend interaction.

The default SQL files also include `scripts/measure-query-baseline.js`. Each
storage-mode execution verifies 44 workload measurements against explicit
[query-count budgets](query-measurements.md#enforced-query-budgets), including a
101-target relationship write that crosses the batch boundary. Wall-clock and
heap measurements remain informational. Passing a file list selects only those
files; it does not add the defaults.

Select suites explicitly:

```sh
npm run test:databases:pg -- tests/conformance-ids.test.js
npm run test:databases:mysql -- tests/conformance-include-limits.test.js
```

Suites using `createConformanceFixture` or `createTestDatabase` select the runner's
database. An explicit `knexConfig` with a different driver now fails immediately.
Historical tests outside the shared conformance suite may still construct SQLite
directly; launching those with this runner does not make them real-driver evidence.
Check each additional suite's fixture and scope.

The executed combinations are SQLite 3.49.2 through `better-sqlite3`, PostgreSQL
16 through `pg`, and MySQL 8 through `mysql2`, each with regular and canonical
storage. Other Knex clients, server versions, MariaDB, Windows and arbitrary
database collations are unverified; a driver-specific branch in a helper does
not establish support or prove a combination unsupported.

The reference-filter/sort suites separately check case-insensitive regular-table
columns using SQLite `NOCASE`, a PostgreSQL ICU collation and MySQL
`utf8mb4_unicode_ci`. They repeat that regular-table case during canonical jobs;
they do not alter canonical ID collation. Separate canonical attachment cases
explicitly set MySQL logical/link ID columns to `utf8mb4_unicode_ci`, then verify
database equality with mixed stored/requested spellings and duplicate link pages.
These dedicated cases do not change the default fixture collation or establish
other canonical-collation combinations. Ordinary text-search assertions retain
the selected database's case behavior. PostgreSQL text operators cast numeric
columns to text before LIKE; equality and ordering continue comparing the column
in its original type. Numeric reference patterns retain literal leading zeros
and exponent suffixes after the existing input validation.

## Temporary binaries on Ubuntu 24.04

Local verification used PostgreSQL 16 and MySQL 8 from Ubuntu packages extracted
without installing or starting system services. An example for this distribution
and architecture follows; other systems can supply their own native binaries.

```sh
JRA_TEST_BINARIES=$(mktemp -d)
(
  cd "$JRA_TEST_BINARIES"
  apt-get download postgresql-16 postgresql-client-16 mysql-server-core-8.0 \
    libmecab2 libevent-pthreads-2.1-7t64
  for package in ./*.deb; do
    dpkg-deb --extract "$package" "$JRA_TEST_BINARIES/root"
  done
)
export JSON_REST_API_POSTGRES_BIN="$JRA_TEST_BINARIES/root/usr/lib/postgresql/16/bin"
export JSON_REST_API_MYSQL_BIN="$JRA_TEST_BINARIES/root/usr/sbin/mysqld"
export LD_LIBRARY_PATH="$JRA_TEST_BINARIES/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
npm run test:databases
```

Remove the temporary binary directory when finished. The runner separately owns
and removes all of its server data directories. PostgreSQL initialization follows
the documented [`initdb` options](https://www.postgresql.org/docs/16/app-initdb.html);
MySQL follows its [data-directory initialization procedure](https://dev.mysql.com/doc/refman/8.0/en/data-directory-initialization.html).
Both servers listen only on Unix sockets inside the runner's private temporary
directory. The runner does not enable TCP listeners. MySQL file import/export and
the X protocol are disabled. Test databases use UTF-8; MySQL uses `utf8mb4_bin`,
and PostgreSQL initializes with the `C` locale. Other collations need dedicated
tests. The MySQL connection/server time zone is UTC.

## Failures and interruption

Missing binaries, failed readiness, and failed tests produce a nonzero exit.
Initialization has a two-minute timeout, readiness a one-minute deadline, and
each selected test invocation a fifteen-minute timeout. SIGINT/SIGTERM stop child
process groups; shutdown escalates after five seconds. Server logs are printed
on failure before temporary files are removed. Nested Node test-runner context
is removed from test subprocesses so Node cannot silently skip the selected files.

The runner's failure/interruption tests use SQLite in the ordinary test gate.
Exercise the same cleanup checks with real servers using:

```sh
JSON_REST_API_RUNNER_DATABASE=pg node --test tests/database-runner.test.js
JSON_REST_API_RUNNER_DATABASE=mysql2 node --test tests/database-runner.test.js
```

These eight tests inject a failure after a live fixture has written a record,
interrupt active work with each signal, supply missing PostgreSQL/MySQL/Redis binaries,
select a nonexistent test file and try to substitute a different fixture driver.
They check the exit status, removed directory and, for real servers, the terminated
server PID. Missing dependencies and environments fail; they never become skips.

`npm run verify` remains the SQLite/connector/lint/docs gate; it does not imply
that PostgreSQL or MySQL were run. Omitting the real-database command locally is
an omitted integration environment, not a passing or unsupported combination.
Record an intentionally omitted local integration environment as **not run**,
with the omitted database and reason. A successful SQLite gate supplies no
PostgreSQL/MySQL result.

## Continuous integration

[The workflow](../../.github/workflows/verify.yml) runs on pushes, pull requests
and manual dispatch. Node 24.6.0 runs the full SQLite/connector/lint/docs gate
plus the SQLite database runner. Three native jobs run PostgreSQL, MySQL and
Redis on Node 24. Node 22 and Node 26 are outside the test matrix. SQL jobs execute all default
database files; Redis jobs execute the [two-server notification suite](real-redis.md).
Each runs both storage modes and the eight failure/interruption checks. Native binaries
are extracted into temporary directories; the existing runner supplies readiness,
private databases and cleanup. No private credentials or application checkouts
are needed.

Every matrix entry must succeed. The final `Verification` job runs even when a
dependency fails or is skipped and rejects any result other than success. There
are no optional integration jobs or path-based omissions. Repository owners can
select `Verification` as a required branch-protection check after the workflow
has run; this source change does not configure remote branch protection. Local
workflow validation and command results are recorded separately from any actual
GitHub run in the [evidence log](verification-progress.md).
