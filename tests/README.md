# Testing json-rest-api

Use Node 24 (`nvm use`); the library requires Node 24+, and the development/CI
matrix tests Node 24 only. Install with `npm ci`. The
[verification guide](../docs/development/verification.md) covers clean-checkout
prerequisites, including Ruby/Bundler for documentation.

## Choosing checks

| Command | Scope |
| --- | --- |
| `npm test` | Complete default SQLite test invocation |
| `npm run test:anyapi` | Complete suite with canonical storage selected; some historical fixtures explicitly use one backend |
| `npm run verify` | Internal and packed public types, query budgets in both modes, both full SQLite invocations, Express 4 in both modes, lint and documentation |
| `npm run typecheck` | Incremental checked JavaScript and type-contract fixtures; see [checked scope](../docs/development/typechecking.md) |
| `npm run test:public-types` | Strict consumer compilation against an extracted npm tarball, runtime/type export agreement, and negative public-import checks; shares installed dependency files |
| `npm run test:clean-package` | Installs the actual tarball into a fresh temporary consumer without shared dependencies; checks optional-peer-free imports, missing Express diagnostics and SQLite CRUD in both storage modes |
| `npm run test:api-reference` | Executes selected literal API-reference schema/hook examples and checks their CRUD, computed-field, filter, pagination and error behavior in both SQLite storage modes |
| `npm run test:quickstart` | Executes the literal quickstart setup, calls and Express server on an allocated port; checks SQLite results and HTTP reads/writes |
| `npm run test:setup-guide` | Executes the initial setup SQLite example and response-default overrides from the guide |
| `npm run test:relationship-guides` | Executes belongsTo, hasMany and polymorphic guides in both SQLite modes and the direct-pivot many-to-many guide in ordinary storage; checks includes, filters, membership and pivot metadata |
| `npm run test:tutorial-guides` | Executes searching, pagination, PUT/PATCH, bulk, relationship-endpoint, transformation, temporal, projection, hook, autofilter, row-policy, plugin and Fastify injection examples in both SQLite storage modes; custom service methods without storage |
| `npm run test:tutorial-guides:databases` | Runs the same executable tutorial assertions on SQLite/PostgreSQL/MySQL and both storage modes using isolated databases; requires the native database setup |
| `npm run test:server-examples` | Runs the URL override example and quickTest as child servers; checks HTTP responses with ordinary SQLite/Express |
| `npm run test:file-guide` | Executes the file guide's actual setup with ordinary SQLite and Express 5/4; verifies multipart, served bytes and rejection cleanup in temporary directories |
| `npm run test:socket-guide` | Executes the Socket.IO guide's actual public server setup on Express 5/4 and checks the documented subscription protocol with a real client |
| `npm run test:migration-guide` / `npm run test:migration-guide:databases` | Executes selected After snippets with result, relationship and transaction assertions, plus the schema guide's mapped-ID example and generated table migration; SQLite by default or all three native drivers |
| `npm run test:conformance` | Shared conformance suites in both storage modes |
| `npm run test:connectors` | Express 5, Express 4, Fastify, multipart, CORS, HTTP validators/conditional client, bulk revision bodies and Socket.IO selections in both modes |
| `npm run test:query-budgets` | Enforced query-count and behavior budgets; elapsed time and heap readings are informational |
| `npm run test:databases` | Disposable SQLite, PostgreSQL and MySQL integration selections in both modes |
| `npm run test:redis` | Separate real Redis/Socket.IO integration selection |
| `npm run lint` | Maintained runtime, tests and scripts |
| `npm run docs` | Build the documentation site |

`npm run verify` does not run the native database or Redis jobs, package-install
checks, or downstream application checks. Run the relevant additional jobs for
the changed boundary. Native services require local binaries; use the
[database setup](../docs/development/real-databases.md) and
[Redis setup](../docs/development/real-redis.md) instructions.

Run a focused file directly; adding a filename to `npm test` does not replace
its existing `tests/*.test.js` argument:

```sh
node --test tests/conformance-write-diagnostics.test.js
JSON_REST_API_STORAGE=anyapi node --test tests/conformance-write-diagnostics.test.js
npm run test:databases:pg -- tests/conformance-write-diagnostics.test.js
npm run test:databases:mysql -- tests/conformance-write-diagnostics.test.js
```

The environment-assignment syntax requires a POSIX shell. In PowerShell, set
`$Env:JSON_REST_API_STORAGE = 'anyapi'` before the command and remove it afterward.
Native Windows is not part of the verified development matrix.

## Writing a suite

Create `tests/feature-name.test.js`. Reuse factories in
[fixtures/api-configs.js](fixtures/api-configs.js); add resource declarations to
an appropriate factory there, never directly in a test file. Instantiate once
in `before`, reset data in `beforeEach`, and close resources in `after`.

For driver-aware coverage, use
[createConformanceFixture](fixtures/conformance.js). Its `reset()` delegates to
`cleanTables`, its `seed()` writes through the public API, and `close()` releases
the database and registry state. It verifies the selected storage mode. Pass all
physical tables owned by a custom fixture in its `tables` mapping. Suites using
`createTestDatabase` also honor the selected database. A test that constructs
SQLite directly remains a SQLite test when launched by the native runner.

[TEST_TEMPLATE.test.js](TEST_TEMPLATE.test.js) is the existing ordinary SQLite
example. For a shared driver-aware example, see
[conformance-write-diagnostics.test.js](conformance-write-diagnostics.test.js).
Use the assertion and document helpers in
[helpers/test-utils.js](helpers/test-utils.js) for consistent JSON:API checks.
Seed through the API; inspect raw storage only when the assertion specifically
concerns persistence, mappings, migrations or transaction visibility. Explain
that boundary in the test rather than comparing raw rows to API representations.

## Current request contract

Use `format: 'jsonapi'` by default in tests. Explicitly test `format: 'plain'`
when plain responses are the subject. The removed `simplified` and
`returnFullRecord` options belong only in rejection/migration regressions.
Writes use `returning: 'none'`, `'minimal'` or `'full'`; request `'full'` when
asserting returned attributes. Context remains the second method argument.

```javascript
const created = await api.resources.books.post({
  inputRecord: createJsonApiDocument('books', { title: 'My Book' }, {
    country: createRelationship(resourceIdentifier('countries', countryId))
  }),
  format: 'jsonapi',
  returning: 'full'
}, context)
assertResourceAttributes(created.data, { title: 'My Book' })
```

Use JSON:API relationships for foreign keys, and string resource identifiers.
Configure searchable/sortable fields in the fixture before exercising queries.
Pass filters, sorting and pagination through `queryParams`, matching existing
conformance cases. Do not assume native row IDs or driver result shapes are
public representations.

## Evidence and cleanup

For a bug fix, first demonstrate the regression against the failing source where
practical, then check the corrected behavior and relevant failure interactions.
Use real independent connections for concurrency claims. Keep generated seeds
and replay details when using generated cases. Test rollback, original error
identity and external side effects when those are affected.

A successful job must exit zero. Inspect final pass/fail/cancel/skip counts;
expected error logs are not themselves failures. Explain material skips and
fixed-backend fixtures. Close database pools, HTTP servers, sockets, timers and
temporary services in teardown, including setup-failure paths.

Run `npm test` before each push and the full gate plus affected integrations for
changes spanning shared boundaries. Record commands, Node/driver versions and
source state in the [verification ledger](../docs/development/verification-progress.md).
Consumer verification is separately scoped: the package-check script requires
an explicit consumer path and command, and passing library tests does not prove
an application migration. See the [master plan](../library-improvement-plan.md)
for current migration scope; jskit-ai, vibe64 and seeds remain paused.
