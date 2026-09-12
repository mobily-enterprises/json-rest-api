# Consumer use of schema and migration features

Read-only source investigation, 12 September 2026, extended to the five remote applications explicitly identified by the owner. Consumer repositories were not modified. No application, migration, database command, or test was run as part of this investigation.

The source references below capture the investigation before the follow-on
migration safeguards. Those later library changes preserve omitted indexes and
foreign keys by default, reject known unrepresentable snapshot features, and add
warnings and dependency checks. They do not change the consumer-usage findings.

## Finding

The inspected consumers do use database migrations, but I found **no call from their maintained source or traced installed framework packages to json-rest-api's migration-generation, schema-diff, table-introspection, table-creation, or field-alteration helpers**. This now includes `sas/dogandgroom`, `sas/compas-next`, `sas/racing`, `pass/whs2`, and `matt/beepollen` on the remote server, their installed JSKIT runtimes, and the three recorded published artifacts found there. Their migration path is JSKIT-owned configuration and authored migration files executed by Knex; CompAS also has an application-owned historical schema bootstrap.

This is not evidence that json-rest-api's implementations are placeholders. They produce real DDL and migration source, and this library has regressions that execute that source against test databases. It is evidence that the current consumer paths inspected here do not establish demand for those particular helpers.

All five remote applications' inspected JSKIT hosts install ordinary Knex storage. Here the owner's “canonical apps” means the authoritative hosted application sources; it does **not** mean that these applications use the library's AnyAPI canonical-storage backend. No AnyAPI plugin, registry or field-allocation use was found in them. Canonical storage remains an implemented and tested library feature, with no external adopter established by this investigation.

## Remote application evidence

The remote audit read existing source and installed files through the documented administrative access path. It also read GitHub's commit/tree/blob APIs for canonical branch evidence, and read WHS2's managed canonical `main` ref. It did not clone, fetch, pull, install dependencies, refresh a checkout, modify Git configuration, or invoke application scripts. Environment files, credentials and business-data exports were excluded. Infrastructure access details are intentionally omitted here.

### Current server checkouts and installed packages

The following materialized server session checkouts were inspected directly. Their `HEAD` values match the canonical branch commits shown. A matching `HEAD` identifies the checkout base; the helper scan read the actual filesystem contents, including additional source present there, rather than assuming a clean worktree.

| Application | Inspected session source | `HEAD` / canonical commit | Installed `json-rest-api` | Installed `@jskit-ai/json-rest-api-core` | Installed `crud-core` / `database-runtime` |
| --- | --- | --- | --- | --- | --- |
| `sas/dogandgroom` | Session `2026-08-17_13-05-55`, `source/` | `65f94edcba4c1fdaf90b1ba7e54baeeb2ecacd4b` | `1.0.29` | `0.1.127` | `0.1.194` / `0.1.183` |
| `sas/compas-next` | Sessions `2026-08-20_15-08-30` and `2026-08-22_04-39-46`, `source/` | `0f5f895b6a954fae31254d00073a5c49d4c46df6` | `1.0.28` | `0.1.123` | `0.1.190` / `0.1.179` |
| `sas/racing` | Session `2026-08-22_04-39-54`, `source/` | `de4771c72ac000a76d2e29943de959b98c947df2` | `1.0.28` | `0.1.123` | `0.1.190` / `0.1.179` |
| `matt/beepollen` | Sessions `2026-08-21_02-45-39` and `2026-08-24_03-41-10`, `source/` | `72a4fdb2550cd513f8e6bb19b3662144453b3023` | `1.0.28` | `0.1.123` | `0.1.190` / `0.1.179` |
| `pass/whs2` | Session `2026-09-04_02-36-52`, `source/` | `6d0317f2f9197fe1030d37772eb1c638428faaa8` | `1.0.28` | `0.1.123` | `0.1.190` / `0.1.179` |

Canonical GitHub repositories are `mobily-enterprises/dogandgroom`, `shipagency/compas-next`, `shipagency/racing`, and `mobily-enterprises/beepollen`. WHS2's server-owned canonical `refs/heads/main` was read directly and matched its checkout.

Relevant app-source file counts scanned were 939 for DogAndGroom, 1,030 and 790 for the two CompAS sessions, 94 for Racing, 364 in each BeePollen session, and 1,927 for WHS2. There were zero matches for the six helper names, their internal implementation modules, or the AnyAPI plugin/registry/bootstrap/field-map identifiers. The scan covered JS, CJS, MJS, TS, TSX, Vue, Markdown, YAML and package manifests; it excluded dependencies in this pass, build/cache output, business-data input/output, environment material, and CompAS's legacy `V1/` reference application.

Installed JSKIT runtime packages were then scanned separately: 702 source files for DogAndGroom, 687 for CompAS, 617 for Racing, 628 for BeePollen and 648 for WHS2. Again there were zero helper/deep-import/AnyAPI matches. These counts exclude package documentation, tests and template copies, so they specifically describe installed runtime code.

The actual installed wrapper in **each** current checkout is `node_modules/@jskit-ai/json-rest-api-core/src/server/jsonRestApiHost.js`:

- `:235–241`: `addResourceIfMissing` checks the resource and calls only `api.addResource`.
- `:812–833`: the host installs `RestApiPlugin`, `QueryProjectionsPlugin`, **`RestApiKnexPlugin` at `:824`**, `RowPolicyPlugin`, `AutoFilterPlugin`, and its temporal hook plugin.
- There is no schema-generation or table-creation call hidden in that registration wrapper.

In each installed `node_modules/@jskit-ai/database-runtime/src/server/databaseSetup.js`, `:22` calls `knex.migrate.latest()`; `prepareDatabaseFromApp` at `:41` configures and invokes that path. The similarly named `createKnexMigrationConfigFromApp` is a **JSKIT configuration/discovery helper**, not json-rest-api's `generateKnexMigration`.

Older existing server sessions were also searched. They contained json-rest-api versions `1.0.26` or `1.0.27`, and yielded no helper/AnyAPI matches. Git declined to report three older sessions' HEADs because their ownership differed from the selected daemon identity; no safe-directory exception or ownership change was made. The current checkouts above all supplied their HEAD successfully. Stale source paths whose directories no longer exist were not claimed as inspected source.

### Application-specific migration paths

**DogAndGroom:** `scripts/prepare-database.js:1` imports JSKIT's `prepareDatabaseFromApp`, and `:4` calls it with `client: "mysql2"` and `seedDatabase`. `knexfile.js:1` imports `createKnexMigrationConfigFromApp`, called at `:11`. Root `db:migrate`, rollback and status scripts invoke Knex directly. Its installed host and database-runtime paths are those described above.

**CompAS:** `scripts/prepare-database.js:5` imports JSKIT's migration configuration helper. The file defines the historical Knex ledger tables at `:10`, tests for pending historical migrations at `:17`, rejects a populated-database bootstrap at `:57`, lists Knex migrations at `:148`, reads the application-owned schema-only baseline at `:155–157`, and executes that baseline with `knex.raw` at `:172`. `knexfile.js:11` uses the same JSKIT configuration helper. This is a real, application-specific historical-schema/bootstrap problem, but it does not invoke the library's schema diff or migration generators. A resource-level diff would not replace the application's historical ledger and baseline semantics.

**Racing:** `package.json:33–36` provides prepare and direct Knex latest/rollback/list. `scripts/prepare-database.js:1` and `:4` call JSKIT preparation with its seed. `packages/car-setups/src/server/CarSetupsFeature.js:1` and `:8` use `defineCrudJsonApiFeature`, which reaches the installed ordinary-Knex resource registration wrapper. `packages/car-setups/package.json:50–53` declares package migrations. Its `migrations/20260630063554_crud-initial-schema-car_setups.cjs:3` defines `up(knex)`, with explicit `alterTable` at `:8`, `createTable` at `:15`, and index/foreign-key definitions at `:33–34`. `Procfile:1` selects database preparation for release. Source was additionally scanned from the pinned GitHub tree: 67 relevant code/config/docs files plus 29 Vue files, with no requested helper references.

**BeePollen:** `package.json:31–35` provides preparation and Knex migration scripts. `scripts/prepare-database.js:1` and `:3` call JSKIT preparation; development preparation adds the application's seed. `packages/receivals/src/server/ReceivalsFeature.js:1` and `:26` use the standard CRUD feature, with an explicit repository decorator. `packages/receivals/package.json:47–50` declares migrations. Its `migrations/20260421094339_crud-initial-schema-receivals.cjs:9` creates the table, `:27–35` declares indexes/FKs, and `:37–38` contains authored CHECK DDL. The root `migrations/constraints/20260820090000_beepollen-cross-package-foreign-keys.cjs:60–61` queries `information_schema.TABLE_CONSTRAINTS` itself, then adds constraints through Knex at `:72` and `:81–85`. That is application-owned introspection, not the library's `dbIntrospection` module. `packages/json-api-records/src/server/index.js:40–65` extracts JSON:API response/linkage data; it is not a hidden schema helper. The pinned GitHub tree scan covered 301 relevant code/config/docs files plus 66 Vue files, with no requested helper references.

**WHS2:** `scripts/prepare-database.js:1` and `:3` use JSKIT's `prepareDatabaseFromApp({ client: "mysql2" })`. `knexfile.js:1` imports JSKIT's configuration helper; `:12` obtains the config, and `:155–156` applies the application's package migration dependency ordering. Missing package/prerequisite checks appear at `:106` and `:113`. This is application-specific ordering of real Knex migrations. Its installed host and all inspected app/runtime source contain no json-rest-api schema-helper or AnyAPI use.

### Recorded published artifacts differ from current development source

The audit also followed the three recorded current-publication pointers found for these applications and read their existing artifact workspaces. This is deliberately separate from the current session checkouts above.

| Application | Recorded published artifact | Installed library / host | Source inspection |
| --- | --- | --- | --- |
| DogAndGroom | Release `20260910_071045z-44f9c043`, recorded source commit `582dd1227a00aa35b2747572767b3a6a76a36c08` | `json-rest-api@1.0.29`, host `0.1.127` | 938 relevant app files; no helper/AnyAPI matches. Host registers resources at `:240` and ordinary Knex at `:824`. |
| CompAS | Release `20260711_013658z-a06a10f2`; pointer had no source commit | `json-rest-api@1.0.24`, host `0.1.53` | 556 relevant app files; no helper/AnyAPI matches. Older host registers resources at `:98` and ordinary Knex at `:593`. |
| BeePollen | Release `20260720_153232z-b2d3b355`; pointer had no source commit | `json-rest-api@1.0.24`, host `0.1.62` | 422 relevant app files; no helper/AnyAPI matches. Older host registers resources at `:98` and ordinary Knex at `:593`. |

Racing and WHS2 had no current-publication pointer in the inspected project state. This does not establish that they have never been deployed elsewhere. The audit did not probe running application processes, request health endpoints, or query migration history tables. Recorded publication state and installed source are not a fresh production-health check.

None of these artifacts or checkouts establishes production use of this working repository's unpublished revised `2.0.0` implementation. The remote findings concern the older installed versions explicitly listed above.

### Practical value of retaining the diff

The five applications have real schema work: authored table migrations, cross-package constraints, data seeds, and, in CompAS, historical bootstrap/ledger requirements. A reviewed generated draft could help with a **bounded change to an ordinary resource table** and then be placed in their existing Knex migration sequence. It would need an explicit development workflow; none of the inspected apps currently wires it in.

Their existing migration paths give no reason to trust an unattended whole-database sync from resource schemas. The library's diff cannot replace application migration ordering, historical ledgers, backfills, cross-table dependencies or release recovery. Retaining the real helper with conservative behavior and a reviewed-draft contract is useful; claiming current adoption or automatic migration safety would be unsupported.

## Local scope and limits

The initial local investigation covered the roots below. The owner subsequently
identified the five remote canonical applications; their source, installed
framework and publication-artifact coverage is recorded above. AnyAPI canonical
storage was investigated separately from that application set.

Primary roots:

- `/home/merc/Development/current/jskit-ai`, HEAD `70163546304ee1fed80cbf1c6ec67517294db855`. One unrelated test was already modified when inspected.
- `/home/merc/Development/current/vibe64`, HEAD `180be75175745875534b224609b3704757586866`.
- `/home/merc/Development/current/genesis`, whose template catalogue matches the installed `vibe64/node_modules/genesis-stack/genesis.templates.json`.
- `/home/merc/Development/current/seed-jskit`, branch `public`, HEAD `02cf10cef15a2a44b73adf52e5cd60e53b7bf9bf`.
- `/home/merc/Development/current/seed-jskit-accounts`, branch `accounts`, HEAD `91dad8e418ada6594001b8282c2b87c41e8fc3e5`.
- `/home/merc/Development/current/jskit-seed-workspaces`, an older seed with JSKIT migration-installation tooling.

The two current seed clones both have origin `https://github.com/vibe64-dev/seed-jskit.git`; their branches are exactly those referenced by Vibe64's installed template catalogue. Remote branches were not fetched, so the findings describe local checked-out source and installed packages, not an assertion about uninspected remote updates.

An expanded search covered source under `/home/merc/Development/current`, including ignored and hidden files, with dependency trees, Git internals, archived `old/` directories, build outputs, caches, logs, lockfiles and private environment files excluded. The current `jskit-ai` root has **no `apps/` directory**. The search identified additional app source in `MOVE_TO_VIBE64/convict` and `MOVE_TO_VIBE64/compas-next`, and older JSKIT copies; relevant wrappers were inspected below. Deployment mirrors were not treated as the authoritative Vibe64 source.

Installed `node_modules/@jskit-ai` runtime packages were searched separately in the accounts and workspaces seeds to catch behavior hidden behind published framework wrappers. Vibe64's package manifest and lockfile contain no `json-rest-api` dependency. The accounts seed does have it transitively: `package-lock.json:861` records `@jskit-ai/json-rest-api-core`, and `package-lock.json:3480` records `json-rest-api@1.0.28`.

This was a static call-path investigation. It cannot prove which commands a person has executed historically, discover arbitrary code generated outside these roots, or rule out dynamically constructed helper names in uninspected private applications.

## Exact functions considered

| Surface | Implementation and registration | What it actually does |
| --- | --- | --- |
| `createKnexTable` | `plugins/core/lib/dbTablesOperations.js:1041`; `plugins/core/rest-api-knex-plugin.js:264` | Creates a physical table from the compiled table schema, with mapped columns and metadata. |
| `addKnexFields` | `dbTablesOperations.js:1077`; regular plugin `:322` | Applies physical column additions. This is not migration-file generation. |
| `alterKnexFields` | `dbTablesOperations.js:1126`; regular plugin `:307` | Applies field changes, including dialect-specific transaction and constraint handling. |
| `introspectKnexTableSnapshot` | `plugins/core/lib/dbIntrospection.js:1249`; regular plugin `:269` | Reads a normalized SQLite, MySQL or PostgreSQL table snapshot. |
| `generateKnexMigration` | `dbTablesOperations.js:1193`; regular plugin `:276` | Returns executable CommonJS `up`/`down` migration source for table creation. It does not write a file or run a migration. |
| `generateKnexMigrationDiff` | `dbTablesOperations.js:1256`; regular plugin `:288` | Introspects the live table through the public wrapper, compares desired schema, and returns `{ migration, warnings, plan }`. |
| `introspectKnexColumnConstraints` | `dbIntrospection.js:1228` | Narrower internal introspection used by direct alterations. |
| `hasKnexTableIndex` | `dbIntrospection.js:1208` | Dialect-specific index existence check, also relevant to canonical bootstrap. |
| `ensureAnyApiSchema` | `plugins/core/lib/anyapi/schema-utils.js:61` | Creates/checks canonical backing tables and validates existing temporal storage. |
| `AnyapiRegistry.registerResource`, `allocateField`, `getDescriptor`, `listResources`, `invalidateDescriptor` | `plugins/core/lib/anyapi/anyapi-registry.js:106`, `:120`, `:259`, `:285`, `:294` | Persist and load current canonical resource/field mappings and descriptors. These are not a migration-history runner. |

Searches included these names, direct internal module imports (`dbTablesOperations`, `dbIntrospection`, `anyapi-registry`, `schema-utils`), plugin names, canonical field-map configuration, and migration/diff/registry wording. Wrapper imports and callers were then followed; the result is not based solely on absence of the six public method names.

There is no independent json-rest-api migration runner/history API in the inspected implementation. Generated migrations leave execution and history to the caller's migration system. AnyAPI's persisted schema/descriptor records represent storage configuration, not an append-only executed-migration history.

## Actual JSKIT call paths

### Runtime resource registration

`jskit-ai/packages/json-rest-api-core/src/server/JsonRestApiProvider.js` constructs the host with the database provider's Knex instance.

`packages/json-rest-api-core/src/server/jsonRestApiHost.js:800` defines `createJsonRestApiHost`. Its import at `:2` and installation at `:824` select **`RestApiKnexPlugin`**. `addResourceIfMissing`, at `:235`, calls only `api.addResource(scopeName, resourceConfig)` at `:240`.

Real feature setup reaches that wrapper:

- `packages/crud-core/src/server/defineCrudJsonApiFeature.js:225` starts setup and calls it at `:226`.
- `packages/users-core/src/server/UsersIdentityProvider.js:28` and `:33` register user resources.
- `packages/workspaces-core/src/server/WorkspacesFeature.js:63`, `:68`, `:73`, `:78` register workspace resources.

None of those wrappers subsequently invokes table creation, generated migration source, schema diff, or canonical registry allocation. The repositories use the registered resources for CRUD and query behavior.

The framework itself states the boundary in `packages/agent-docs/patterns/row-policies.md:52`: its current host uses normal Knex tables, and an explicit AnyAPI host plus domain regression would be needed before claiming JSKIT AnyAPI support.

### Migration execution and history

The current database pattern's `packages/database-runtime-mysql/patterns/mysql-application/example/package.json:5` defines `db:prepare`; `:6–8` define Knex CLI latest/rollback/list commands. The PostgreSQL pattern provides the equivalent arrangement.

Its `knexfile.js:1` imports **JSKIT's** `createKnexMigrationConfigFromApp`, and `:11` calls it. The implementation is `packages/database-runtime/src/server/knexMigrationConfig.js`:

- `:27` configures migration directories and `.cjs` files.
- `:48` discovers installed packages' `package.json#jskit.migrations.directories` metadata.
- `:94` combines discovered package directories with application migrations.

`packages/database-runtime/src/server/databaseSetup.js:14` defines `runDatabaseSetup`; `:22` directly calls `knex.migrate.latest()`. `prepareDatabaseFromApp` at `:41` loads that configuration and creates the Knex instance. There is no json-rest-api schema-generator call between configuration and execution.

Concrete authored migration source includes `packages/crud-core/patterns/json-api-resource-package/example/migrations/20260815000000_books.cjs:3`: its `up(knex)` manually calls `knex.schema.createTable` at `:8`; `down` drops the table at `:20`. Users and workspaces packages declare their migration directories at `packages/users-core/package.json:162` and `packages/workspaces-core/package.json:165`.

Thus there is real application migration use, including applied migration tracking through Knex, but it does not currently consume json-rest-api's generation or diff functions.

## Vibe64 and its actual seeds

### Template chain

`vibe64/packages/vibe64-project/src/server/service.js:282–283` defaults its injected template operations to `listGenesisTemplates` and `applyGenesisTemplate`. Onboarding reaches list at `:1021`; template application reaches the apply wrapper at `:1049`.

`packages/vibe64-genesis/src/server/index.js:69` selects `genesis-stack`. `withVibe64StackCatalog` at `:147` supplies it to every operation; `runGenesisOperation` at `:205` forwards these options. The list/apply wrappers at `:245` and `:249` call the compiler operations.

The installed `node_modules/genesis-stack/genesis.templates.json:9` and `:17` points both variants at `https://github.com/vibe64-dev/seed-jskit.git`, with `public` and `accounts` branches. The local Genesis source explains catalogue resolution in `genesis/src/index/template-catalog.js:45`, and template application resolves that entry then reads its Git snapshot in `genesis/src/index/template-project.js:85–89`.

### Accounts seed

`seed-jskit-accounts/package.json:30–33` provides `db:prepare` and Knex latest/rollback/list. `scripts/prepare-database.js:1` imports JSKIT's `prepareDatabaseFromApp`; `:11` invokes it. `knexfile.js:1` and `:11` use JSKIT's configuration helper. Its migration README says application migrations belong there and installed-package migration directories are discovered separately.

The installed `@jskit-ai/json-rest-api-core` and users provider were checked: they follow the same ordinary Knex host and registration path as current JSKIT source. No installed JSKIT runtime call to any json-rest-api schema/migration helper was found.

### Public seed

The public seed's root package has no database migration command or database runtime dependency. It does contain a stale-looking `Procfile:1` that invokes `npm run db:migrate`, even though that script is absent. That is an unrelated seed configuration concern, not evidence of json-rest-api helper use; it was not changed.

### Older workspaces seed and apps

`jskit-seed-workspaces/package.json:29–32` runs `jskit migrations changed` before Knex. This could superficially look like a library diff pipeline, so its installed CLI was inspected.

`node_modules/@jskit-ai/jskit-cli/src/server/commandHandlers/packageCommands/migrations.js:70–77` chooses packages by **package migration-sync version**, then `:116` invokes `applyPackageMigrationsOnly`. The installation machinery uses `install-migration` template mutations and authored package migration files; it does not import json-rest-api generation or introspection helpers. Its installed json-rest-api host calls `api.addResource` at `jsonRestApiHost.js:104` and installs ordinary `RestApiKnexPlugin` at `:603`.

Additional app source under `MOVE_TO_VIBE64/convict` and `MOVE_TO_VIBE64/compas-next` follows that older JSKIT resource path. For example, `convict/packages/users/src/server/UsersProvider.js:70–81` registers the resource via `addResourceIfMissing`, and `convict/packages/workflow-support/src/server/jsonRestWorkflow.js:1–4` imports context/collection helpers only. Their package scripts invoke Knex directly (`convict/package.json:32–34`, `compas-next/package.json:30–32`). No helper-generation or AnyAPI call was found there.

### Vibe64 database schema browsing

`vibe64/packages/vibe64-database-tools/src/server/service.js:224` refreshes the database schema; `:227–230` calls `inspectDatabaseSchema` and stores a browsing snapshot. That helper is imported from its own `databaseDialect.js`, which imports its own MySQL/PostgreSQL inspectors at `:5–8`.

`schemaInspector.js` reads native PostgreSQL catalogues (`:1`) and MySQL information-schema tables (`:123`) via its own Knex raw query helper (`:235`). This is real introspection for database tools, but it is independent of `json-rest-api/plugins/core/lib/dbIntrospection.js`. A UI refresh after a migration does not mean json-rest-api generated that migration.

## Canonical storage is a different live library path

In the library, `plugins/core/rest-api-anyapi-knex-plugin.js:855` registers a `resource:added` hook that calls `registry.registerResource` at `:859`, then refreshes the descriptor.

Its `createKnexTable` method at `:875` calls `ensureAnyApiSchema`, so it bootstraps shared canonical storage rather than creating an ordinary per-resource SQL table. Its `addKnexFields` at `:880` compiles the enlarged schema, allocates slots in a transaction (`:900–909`), invalidates the descriptor, and refreshes runtime schema state (`:911–913`). `alterKnexFields` is explicitly unsupported at `:916`.

Those are real runtime storage-evolution mechanisms. Deleting them because ordinary SQL migration-generation helpers have no consumer call would conflate different behavior. The registry also rejects unsafe remapping of populated storage (`anyapi-registry.js:577`) and obsolete temporal mappings (`:662`).

The expanded search found no external registration of this plugin. Current JSKIT's use of the word “canonical” for application contracts or field names is not evidence of canonical AnyAPI storage.

## Initial implementation assessment and retention decision

It is real. `tests/db-schema-conformance.test.js:13` loads generated source as a migration module. The public helper regression at `:79` executes generated `up`; at `:85` it checks an empty round-trip diff. Further cases execute alterations and verify data preservation, constraints, indexes, enum changes and temporal precision. This investigation read those regressions; it did not rerun them or claim fresh test results.

The following targets came from the initial source review, before the reproduced
safeguard fixes recorded in `last_todo.md`. They describe the intended scope and
limits, rather than additional uncompleted work:

1. **Make the scope obvious.** Separate explanation of immediate table/field DDL, generated reviewable migration source, and canonical field-slot evolution. Similar method names currently cover different backend behavior.
2. **Keep generated diffs explicitly reviewable.** The result already supplies warnings and a structured plan. Dropped columns require `allowDropColumns`; unsupported or unsafe changes can be skipped with warnings. Callers need to notice those warnings rather than assume the desired schema was fully applied.
3. **State rollback limits clearly.** Create migrations emit a real drop-table `down`; diff migrations deliberately emit a `down` that throws (`dbTablesOperations.js:1504–1505`). Do not imply arbitrary schema/data changes are automatically reversible.
4. **Preserve dialect and transaction constraints.** Direct alteration already distinguishes MySQL implicit DDL commits, SQLite rebuild constraints, and PostgreSQL transactions (`dbTablesOperations.js:1166–1182`). Simplification should keep these explicit rules rather than disguise them behind a universal migration abstraction.
5. **Evaluate extraction only against a real use case.** There is substantial shared schema mapping and metadata logic between immediate DDL and generation. A removal or split needs the library's internal dependency audit; consumer absence alone does not show that deleting a large file is safe.

No new migration execution/history framework is needed in json-rest-api to serve
these consumers: their existing Knex path already owns that responsibility. The
authorized follow-up retained these implemented functions and improved their
safeguards and documentation. No current consumer requirement forces retention
of SQL diff generation; its value is the bounded, reviewed-draft workflow
described above.
