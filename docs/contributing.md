---
title: "Contributing"
---

# Contributing

Use **Node 24** for development and verification. The library requires Node 24 or
newer; `.nvmrc` pins the version used by this repository and CI. Do not add a
second Node-version matrix without a concrete compatibility requirement.

## Setup

```sh
nvm install
nvm use
npm ci
```

SQLite fixtures need no external database or credentials. If the native SQLite
driver compiles from source, install Python 3, make and a C/C++ compiler.
Documentation uses Ruby 3.2 and Bundler 2.6.9. Install Bundler and run `npm run docs`;
the script installs missing gems into `docs/vendor/bundle` before building.
`npm run docs:dev -- --no-open` serves the site without opening a browser.

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.js`, `index.d.ts` | Public exports |
| `lib/` | Runtime, errors, diagnostics and transaction ownership |
| `plugins/` | Resource operations, storage and optional integrations |
| `types/` | Public TypeScript contracts |
| `tests/fixtures/`, `tests/helpers/` | Resource factories and test infrastructure |
| `tests/*.test.js` | Library regression suites |
| `examples/` | Maintained runnable examples and data migration utilities |
| `scripts/` | Documentation, package and verification tools |
| `docs/GUIDE/` | User guides and the application migration guide |
| `old/` | Inactive history; excluded from packaging and automated discovery |

[Architecture](architecture.md) explains the main execution boundaries.
`tests/README.md` in a source checkout contains fixture conventions and the command matrix.

## Verification

Run focused suites for changed behavior. Reserve the comprehensive gate for
changes that need it and release preparation:

```sh
npm run verify
```

This runs checked JavaScript/types, packed public declarations and imports,
query budgets, both complete SQLite storage suites, Express 4 checks, lint and
the documentation build. A storage-specific test may be skipped in one mode
and executed in the other; inspect both results before calling it untested.

`npm run test:clean-package` installs the actual tarball in a fresh temporary
consumer and checks optional dependencies plus ordinary/canonical CRUD.
The `test:*guide`, `test:quickstart`, `test:api-reference` and `test:server-examples`
commands execute maintained documentation examples. Run those when their code changes.

Tests and package tools use temporary directories and dispose of their databases,
servers and sockets. They do not operate on application databases. Consumer checks
require an explicit path and command; library verification does not establish an
application migration.

## Real databases and Redis

The database runner starts disposable servers and creates isolated test databases.
Supply PostgreSQL's `initdb`/`postgres` and MySQL's `mysqld`, then run:

```sh
npm run test:databases:pg
npm run test:databases:mysql
npm run test:redis
```

`JSON_REST_API_POSTGRES_BIN` selects the PostgreSQL executable directory; otherwise
the runner uses `pg_config --bindir`. `JSON_REST_API_MYSQL_BIN` selects the MySQL
executable; otherwise it uses `mysqld` on PATH. MariaDB does not replace this MySQL
check. `JSON_REST_API_REDIS_BIN` selects Redis; otherwise the runner uses PATH.

For an affected subset, pass test paths directly:

```sh
node scripts/test-databases.js pg tests/conformance-managed-transactions.test.js
```

See [backend capabilities](GUIDE/30-backend-capabilities.md) for supported semantics.
The CI workflow documents its disposable binary setup and database matrix.

## Releases

1. Review the public API and update the [migration guide](GUIDE/33-migrating-to-v2.md).
2. Use a new major version for breaking changes. Keep the manifest and lock aligned.
3. Run the agreed verification scope and inspect failures, cancellations and skips.
4. Inspect the tarball contents and confirm that `old/`, tests, local configuration
   and development dependencies are absent from the installed runtime package.
5. Commit the release changes. Publishing and tagging are explicit maintainer actions.

Keep secrets in ignored local configuration. Record release evidence in the release
or pull request; do not add another execution ledger or TODO document to the active tree.
