# Local API migration audit

B0-08 remains open. This 2026-09-11 audit separates legitimate old-name
references from obsolete usage and identifies a remaining paused example.
It covers this repository only, not jskit-ai, vibe64 or their seeds.

## Source call inspection

A Node 24 TypeScript-parser probe visits property calls in `plugins`, `lib`,
`examples`, `scripts`, `tests` and `quickTest.js`. It finds 1,043 calls named
`post`, `put` or `patch` across 362 files. Among literal first-argument objects
without `inputRecord` or a spread, exactly three are reported:

- Two validation-schema `.patch({ value })` calls, in temporal and cursor
  validation. These are schema operations, not resource CRUD.
- One `global_items.post({ name: 'Missing inputRecord' })` call in
  `return-record-settings.test.js`, which intentionally asserts rejection of
  removed shorthand.

The probe does not prove the contents of variable arguments, spread objects,
generated strings or dynamic method names. Runtime conformance and the separate
example runners remain necessary evidence for those paths. Artifacts:
`/tmp/library-local-call-audit.mjs` and `.log`.

## Removed-option spellings

The six retired spellings other than `simplified` occur on seven source lines
across six sites: the shared rejection list; the public `never` option declaration; and four
rejection/malformed-input test lists. Those tests exercise the selected API's
rejection behavior and should remain. They do not test successful compatibility
aliases. `simplified` also remains an internal computed representation flag and
an internal normalization argument. Core methods derive it from `format`; it
is not an accepted public synonym. Renaming internal helpers/flags is a separate
hook-context decision, not proof of removing public compatibility parsing.

No active source import of the removed query-adapter or writing-transformer
module was found. Their names remain in migration explanations. The old
`return-record-settings.test.js` filename now contains new control/record
separation and rejection coverage; its name does not justify deleting useful
tests. Artifacts: `/tmp/library-legacy-option-sites.txt` and the current
`response-options.js`, public resource types and listed test sources.

## Documentation inspection

A second Node 24 parser probe inspects JavaScript fences in README, the API
reference, quickstart and the guides: 106 property calls across 37 Markdown
files. The only literal CRUD shorthand candidate is the intentionally labelled
old call in the migration guide. The probe's printed line numbers refer to
concatenated JavaScript fences, not Markdown line numbers. Artifacts:
`/tmp/library-doc-call-audit.mjs` and `.log`.

Removed option names in current guide prose are confined to migration mappings
and a statement that the old transport switch does not exist. However, the
positioning guide's **Simplified Format** section shows a plain JSON body sent
as `POST /api/items`. This is not the selected built-in HTTP contract: connectors
explicitly accept JSON:API. The same section's JSON:API example is a different
case from programmatic plain-record input. This is a concrete B0-08/A10-01
documentation gap, not an accepted compatibility mode.

Positioning work is explicitly paused. This audit does not change that guide or
the plugin, and it does not imply that its concurrency defect has been fixed.
When positioning work resumes, replace that HTTP example with the intended
programmatic plain call or a valid JSON:API HTTP request, and execute the owning
example. Do not close B0-08 while the required local example remains misleading.

## Remaining acceptance

The variable/dynamic call reconciliation below is complete for the inspected local
source. Retain rejection/control-collision assertions and correct the paused
positioning example when authorized. Broad local migration acceptance
must cover tests, fixtures, plugins, examples, declarations and configuration;
the narrow parser search is an audit aid, not a substitute for that whole scope.
The [library call inventory](resource-call-inventory.md) already closes B0-01,
but neither this audit nor that inventory closes consumer migration or final
acceptance.


## Library-only pause acceptance, 2026-09-11

The refreshed Node 24 parser scan still finds 1,043 named write calls, now across
373 source files. Its 18 variable/spread argument candidates comprise two
validation-schema calls, two temporal-test resource calls whose shared `params`
explicitly contains `inputRecord`, and fourteen HTTP test/route-registration
calls. None is another resource-write shorthand call.

A separate element-access scan finds 175 calls. Outside tests, the resource
calls are the resource/relationship route dispatchers, bulk route dispatcher
and relationship query-measurement script. Source inspection confirms explicit
`inputRecord` for resource writes, `relationshipData` for linkage writes and
operation-specific bulk envelopes. Connectors select JSON:API explicitly.
Other production element calls are query-builder operations, schema validation,
transaction preconditions, dependency iteration and Socket.IO room operations.
The fixture calls choose schema column types; they are not CRUD calls.

Dynamic test calls exercise operation/format/ownership matrices in the full
ordinary and canonical suites, including bulk, response controls, temporal
values, fieldsets, relationships, errors and transaction outcomes. Redis
integration calls are separately covered by the earlier 92-case Redis evidence;
this checkpoint does not rerun Redis. The measurement script's calls use the
retained linkage contract. The scans are review aids, not proof of arbitrary
runtime-generated JavaScript. Probe artifacts are
`/tmp/library-dynamic-call-audit.mjs` / `.log` and
`/tmp/library-element-call-audit.mjs` / `.log`.

The accumulated Node 24 verification passes 12,973 tests, zero failures and one
existing skip, plus internal/public types, both query budgets, lint and docs.
A separate packed-artifact probe executes the existing migration checker against
runtime and guide files extracted from tarball SHA1
`a7ec49f3c57c8706a9e9d9db2422a135daf8d159`. Only its runner and database harness
are copied from source; dependencies are shared with the local installation.
Both SQLite modes pass the selected After snippets, including successful managed
writes/raw SQL and rollback on SQL failure. The mapped-ID schema example also
passes generated migration up/introspection/diff/down. This is packed-library
execution, not a clean dependency installation or consumer migration.
Artifacts: `/tmp/library-packed-migration-probe.py` and
`/tmp/library-packed-migration-pause.log`.

B0-08 remains unticked solely for its explicitly paused positioning example.
Library-side B0-12 example acceptance is established; consumer artifacts,
generator output and downstream legacy searches remain paused.
