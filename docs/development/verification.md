# Development verification

For breaking-version and dependency coordination, follow the
[release procedure](releasing.md). Consumer migration remains paused.

The library requires **Node 24 or newer** (`engines.node: >=24.0.0`). Development
and CI verification run on **Node 24 only**; `.nvmrc` pins 24.6.0. This is the
maintainer's selected policy as of 2026-09-09. Node 22 and Node 26 are outside the
test matrix. Earlier multi-runtime results remain historical evidence in the
[execution log](verification-progress.md).

Keep both storage modes and the SQLite/PostgreSQL/MySQL/Redis and connector
coverage below. The narrower runtime matrix removes repeated version runs,
without reducing those behavior and integration requirements.

## Clean checkout

Required tools are Node/npm, curl, Ruby and Bundler. Documentation is verified
with Ruby 3.2.3 and Bundler 2.6.9, the version in `docs/Gemfile.lock`. SQLite runs
in memory; the standard suite needs no external database, Redis server, private
credentials or `.env` file. Socket.IO tests use local authentication fixtures.
Native SQLite may compile from source: the successful Node 24 installation did
so. Have Python 3, make and a C/C++ toolchain available for that fallback.

From the repository root, with nvm installed:

```sh
nvm install
nvm use
npm ci
gem install bundler -v 2.6.9
cd docs
bundle config set --local path vendor/bundle
bundle install
cd ..
npm run verify
```

If another runtime manager is used, select the version in `.nvmrc` before
`npm ci`. Run Ruby installation commands in the user's Ruby environment.
Dependencies are public and locked by `package-lock.json` and
`docs/Gemfile.lock`. Bundler's local directory and the generated `docs/_site`
are ignored by Git. The docs script also checks Bundler dependencies and installs
missing gems before building.

Reinstall dependencies after switching Node major versions. A native
`better-sqlite3` binary built for one Node ABI cannot be reused with another;
changing the executable alone is insufficient. Select Node 24 before installing
and testing in this checkout.

## Commands and coverage

| Command | Coverage |
| --- | --- |
| `npm run verify` | Internal and packed public type/import/content checking, both SQLite query-budget jobs, both full SQLite suites, Express 4 checks on both storage modes, maintained-source/test/script lint, then Jekyll documentation build; stops at the first failed stage |
| `npm run test:public-types` | Packs the exact artifact, verifies its file/link set and runtime imports, then compiles the packaged declarations and negative fixtures |
| `npm run test:consumer -- --consumer PATH -- COMMAND [ARGS...]` | Runs an explicit consumer command against the packed artifact; use `--jskit PATH` before the final separator for paired app/workspace staging. Consumer migration/checks remain paused for jskit-ai and vibe64. |
| `npm run test:connectors` | Complete Express 5/Fastify/Express 4 connector selections across both SQLite storage modes; see the connector section below |
| `npm run test:clean-package` | Installs the actual tarball in a clean temporary consumer, checks optional peers and core loading, then installs Knex/SQLite and exercises storage without library development dependencies |
| `npm run typecheck` | Incremental internal JSDoc contracts and negative type fixtures; see [scope](typechecking.md) |
| `npm run test:query-budgets` | 44 deterministic workload measurements with SQL ceilings and behavior checks in each SQLite storage mode; append `:knex` or `:anyapi` to select one, see [budgets](query-measurements.md#enforced-query-budgets) |
| `npm test` | All `tests/*.test.js` using regular Knex storage |
| `npm run test:anyapi` | The same files with AnyAPI selected through `JSON_REST_API_STORAGE=anyapi` |
| `npm run test:conformance` | Dedicated shared value/generated/model suites, explicitly run in each storage mode |
| `npm run test:databases` | Every shared conformance suite and query-budget workload on disposable SQLite/PostgreSQL/MySQL servers in both storage modes, environment checks, ordinary schema migrations and canonical temporal/field evolution; requires native server binaries, see the [setup guide](real-databases.md) |
| `npm run test:databases:pg`, `npm run test:databases:mysql` | One real server, both storage modes; append explicit test paths to select additional suites |
| `npm run test:redis` | Actual Redis Pub/Sub between two Socket.IO servers over polling and WebSocket, both application storage modes; requires a Redis executable, see the [setup guide](real-redis.md) |
| `npm run test:id-contracts` | Both focused ID jobs: mapped integer/string keys, normalization, custom IDs and relationships |
| `npm run test:id-contracts:knex` | Regular ID conformance and historical logical/custom-ID regressions |
| `npm run test:id-contracts:anyapi` | AnyAPI ID conformance, normalization and custom-ID regressions |
| `npm run test:temporal` | Both temporal jobs: shared temporal values, serializers and boundaries, getters/setters/computed fields |
| `npm run test:temporal:knex` | Regular temporal job, including the historical storage-mapping suite |
| `npm run test:temporal:anyapi` | Actual AnyAPI temporal job; the historical regular-only storage-mapping suite is excluded |
| `npm run lint` | Runtime, maintained tests and scripts; docs and examples remain excluded |
| `npm run docs` | Build documentation into `docs/_site` |
| `npm run docs:dev -- --no-open` | Serve documentation without launching a browser; SIGINT/SIGTERM shut down Jekyll |

Run one file with `node --test tests/fixture-isolation.test.js`; prefix it with
`JSON_REST_API_STORAGE=anyapi` for the other backend. The AnyAPI environment
assignment in current npm scripts requires a POSIX shell. Windows development
through WSL follows the same sequence; native Windows is not yet verified.

Tests allocate their HTTP ports dynamically and release resources on teardown.
Documentation preview uses port 4000 and should run once per workstation. Tests
create resources through fixture modules, clean tables between tests, and keep
cleanup metadata associated with its database and explicit tenant.

The [conformance guide](conformance.md) documents generated seeds and replay,
fixture responsibilities, backend ID ordering differences, and legacy files that
instantiate one backend directly even when the other test mode is selected.

The current gate includes real Express 5.1.0, Express 4.22.2 and Fastify 5.12.3
request handling on both SQLite storage modes. `npm run test:connectors` runs the
complete connector matrix. `test:connectors:knex` and `:anyapi` run Express 5 /
Fastify / query-parser / multipart / CORS / Socket.IO checks for one backend. `test:connectors:express4` runs
both Express 4 variants; append `:knex` or `:anyapi` to select one.

Express 4 is installed through a development-only npm alias. A test preload
uses Node's synchronous import hooks to redirect the actual production
connector import as well as test imports, asserts the resolved version/path,
and fails if the alias is missing. The runtime has no framework-selection
switch or compatibility adapter. Normal tests use the installed Express 5.
Fastify uses actual injection, schema registration, parsing, serialization and
error handling; its former fake has been removed.

`tests/cors-transport.test.js` checks real Express 4/5 and Fastify responses for
early parser/media failures, explicit request rejection, response-hook failure,
async origin decisions, preflights, cache headers and API/host boundaries. The
existing CORS and Socket.IO suites also run in the focused connector matrix.
`npm run test:socketio` runs the Socket.IO behavior, contract and authorization
suites in both storage modes; append `:knex` or `:anyapi` to select one. The
contract suite uses real WebSocket and HTTP polling clients. Express 4's job
also runs the contract suite, including actual HTTP writes and notifications.
Negative event checks attach listeners before writing and drain earlier server
packets with an acknowledgement instead of waiting for an arbitrary delay.
Real Redis and managed transaction/event tests have separate native and lifecycle
evidence; see [Redis verification](real-redis.md) and the
[Socket.IO contract](../GUIDE/GUIDE_X_SocketIO.md).

The latest completed gate has one existing regular-mode skipped test and no
AnyAPI skips, detailed in [verification progress](verification-progress.md).
It does not establish PostgreSQL/MySQL compatibility or final transaction/file
lifecycle behavior. The separate [database checks](real-databases.md) verify
every shared conformance suite on both storage modes of all three databases,
including authorization, real HTTP/Socket.IO, concurrent writes, ordinary SQL
schema changes and canonical temporal/field evolution. Fixed-storage cases are
identified in that guide. Other migrations, the remaining capability audit,
types, package checks and final reviews remain open.

[CI](../../.github/workflows/verify.yml) requires the full local gate and SQLite
database runner on Node 24, plus three PostgreSQL/MySQL/Redis jobs on that same
runtime. Each native job runs both storage modes and proves
failure/interruption cleanup. Missing servers, drivers or test files fail the
job. A separate Node 24 clean-package job verifies a fresh tarball installation.
The final `Verification` check requires every library/database matrix entry and
the clean-package job to succeed.
Locally, report an omitted database environment as **not run**, naming the
database and reason; a successful `npm run verify` does not cover that omission.
See [CI details and limits](real-databases.md#continuous-integration).


`npm run test:multipart` runs real Busboy 1.6.0 and Formidable 3.5.4 detector
tests, real Express resource uploads with LocalStorage and SQLite, and custom
detector regressions. `:knex` and `:anyapi` select one storage mode. Native parser
tests use actual HTTP requests, including client disconnects after partial disk
writes. Temporary directories are per suite/request and removed on teardown.
Both optional parser peers are locked development dependencies, so missing them
fails verification instead of skipping coverage. Express 4 jobs include the
same resource upload tests through the production connector import.

## Focused tutorial execution

`npm run test:tutorial-guides` executes every registered tutorial in its supported
storage modes. For a small documentation edit, pass guide keys to run just those
examples, for example `npm run test:tutorial-guides -- plugins hooks`. Unknown
keys fail before fixture creation and list the available keys. Omitting keys
retains the complete corpus. These focused runs supplement the full tutorial and
native gates; they do not claim coverage of omitted guides or consumer apps.

## Command failure behavior

A1-06's command inventory is complete: conformance, native databases/connectors,
internal types, packaged/clean-install checks and direct/paired consumers all have
explicit npm entry points. This is command availability and failure propagation,
not proof that paused consumer migrations are accepted.

Node test/TypeScript failures propagate through their npm commands; aggregate
commands use `&&`. Package checks assert their contract and let child-process or
compiler failures reject. The native harness turns startup, nonzero child exit,
timeout and interruption into failure. Both consumer modes use the same awaited
child runner, which rejects nonzero exits/signals and timeouts; temporary staging
is removed in `finally`. Neither mode converts a rejected check into success.

A local command probe used this repository as the consumer, reached the actual
packed import check, and deliberately exited 7. The npm command failed and its
temporary install was absent afterward. This exercised command propagation
without accessing jskit-ai or vibe64. The paired staging path remains documented
in the [consumer migration procedure](consumer-migration.md); actual paired
acceptance still requires the separately tracked migrations and source checks.

## Response-option acceptance coverage

B0-10 is verified across the request boundary, persisted behavior and actual
connectors. These tests exercise the selected contract directly; they do not
provide an old/new API translator or establish downstream migration.

| Requirement | Owning coverage |
| --- | --- |
| Malformed formats and write-return values | `conformance-response-options.test.js` checks 14 resource/relationship/bulk methods; return modes apply to POST/PUT/PATCH and bulk POST/PATCH. Every rejection names the control and executes zero SQL. |
| Removed aliases fail clearly | The same suite checks all seven removed names with true, false and explicitly undefined values. Connector parser tests preserve those names inside filter data. |
| Payload names do not become controls | `return-record-settings.test.js` persists `format`, `returning`, `queryParams` and nested `data` fields through `inputRecord`; it also rejects ambiguous shorthand and mismatched IDs. |
| Defaults and overrides | `conformance-formats.test.js` crosses plugin/resource defaults, per-call format and return overrides, both representations, POST, both PUT paths, PATCH, GET/query with includes and DELETE. Stored rows and exact response shapes are asserted. |
| Every applicable response mode | The format suite and `conformance-lifecycle.test.js` cover none/minimal/full resource writes; `conformance-bulk-authorization.test.js` covers bulk POST/PATCH in both formats with hidden linkage. Relationship and delete responses are fixed contracts, not additional returning modes. |
| Programmatic and HTTP boundaries | `http-connectors-parity.test.js` exercises real Express/Fastify routing and JSON:API output independently of programmatic defaults, all relationship routes and HTTP error behavior. Its removed-control cases now check every alias with true, false and empty values, including Express 4 runs. |

See the [execution log](verification-progress.md) for the exact current native,
connector and accumulated gate results. A successful library matrix does not
close the separately tracked jskit-ai, app or migration-guide artifact checks.
