# Diagnostic boundaries

## Current owner acceptance, 2026-09-12

The finite A9-07/A9-08 reporting-owner review is complete. Final combined checks
are coordinated in the master plan; this file records targeted acceptance and
the deliberate limits of the policy. Consumers remain untouched.

Every owned operation failure/warning report now supplies `method`, `scopeName`,
`phase`, `backend` and `transactionOutcome` through the existing
`getOperationDiagnosticContext` helper. Scope is a resolved resource, or null
before resolution. Phase identifies the reporting boundary, not mutable hook
bookkeeping. Existing nested getter/setter/include/relationship-metadata context
and original causes remain intact. Read failures that are only propagated do
not acquire invented logging sites. Pure setup/debug traces remain informational.

| Current owner | Accepted behavior and evidence |
| --- | --- |
| Resource writes | Compiled hidden and normally-hidden fields are redacted in input, violations and nested errors. Early malformed input still resolves the registered resource's policy. `conformance-write-diagnostics.test.js`, `error-context.test.js`, `enhanced-logger.test.js` and `error-formatter.test.js` supply existing executed evidence. |
| HTTP errors and Express registration | Stable route/setup metadata, guarded writers and explicit omission of `body`/`headers`. The known `entity.parse.failed` parser preview omits raw parser text, stack and causes because these can contain body excerpts; original errors still reach hooks and HTTP mapping. New `http-early-diagnostics.test.js` covers pre-route body parsing and transport hooks. Root's final targeted checks passed 31/31 per storage mode and Express 4 selections 20/20 per mode. |
| File cleanup | Compiled resource policy, binary type/byte-length previews, bounded metadata and ordered original cleanup diagnostics; `conformance-file-failures.test.js` and uploaded-field logger regressions already exercise these owners. Filenames/paths and arbitrary external error text remain application-owned. |
| AnyAPI registry | Structured operation/resource/tenant/phase/backend/outcome fields and bounded original rollback/cleanup errors; no mutable transaction-context dump. Existing registry failure checks retain driver causes, including SQLite's non-native Error subclass. |
| Socket authentication, events and restoration | Stable transport metadata with null resource where unresolved. Raw handshake/credential/filter objects are omitted. Explicit application error properties are bounded, not assigned an unrelated resource's field policy. Connection and disconnection info writers can throw/reject without preventing handlers or cleanup. |
| Socket admission, removal and notification decisions | Trusted resource metadata supplies hidden/normally-hidden redaction. Query matching reports the borrowed transaction; standalone permission checks report outcome `none`. Tests cover nested causes, preserved source objects, success/failure acknowledgements and later recipients. |
| Redis setup/shutdown | Stable Redis role and operation metadata, original setup and cleanup errors, contained diagnostic writers and immediate independent close attempts. Adapter configuration precedes HTTP attachment; failed destruction cannot make reporting wait for a stranded connection promise. |
| Include warnings | Missing targets, unknown relationships and duplicate hasOne matches report resource/include/backend/outcome. Duplicate warnings omit the actual parent identifier. Throwing/rejecting warning writers preserve existing decisions. |
| Ordinary sort warnings | The skipped-sort report uses the existing query context and field name. It retains a successful query when the warning writer fails. Canonical paths that do not issue this warning do not gain a new logger. |
| Positioning index setup | Best-effort index diagnostics now include resolved resource, setup method, backend, outcome and original error. Existing null/frozen/long-message and failing-writer checks retain index setup behavior. |
| Cross-table schema/configuration | Missing-foreign-key reports carry setup metadata and preserve the configuration error when writers fail. The redundant schema-lookup error trace was removed; its wrapper now retains the original cause, including null. |
| Ordinary missing-scope read branch | Removed as unreachable during the storage helper extraction; shared scope resolution already throws before it. There is no remaining direct report owner at that branch. |
| Runtime and other setup/debug messages | The small runtime does not dump method parameters or plugin options. Storage/include/filter/file payload reduction and bounding remain covered by their existing checks. This is not a global sink: direct application logger calls and setup-only messages outside enhanced loggers are not covered by the enhanced formatter's limits. |

The redaction policy is structural and uses the resolved resource's compiled
field names. It does not scan secrets from arbitrary driver/application messages,
IDs, filenames, paths, or values moved to unrelated keys. A custom authentication
error has no resource schema; its own application properties can appear in
bounded form. HTTP's known raw payload containers and parser-preview exception
are explicit transport rules, not guessed resource metadata. Applications own
their error wording, extra properties and any broader sink/retention policy.

Targeted Node 24.6.0 evidence for the final owner additions:

- Socket.IO contract file: **152/152 ordinary and 152/152 canonical**, real
  WebSocket and polling. `/tmp/jra-a9-socket-knex.log` and
  `/tmp/jra-a9-socket-anyapi.log`. Throwing connection-info writers reproduced
  failed handler installation before correction (`/tmp/jra-a9-socket-info-before.log`).
- Actual Redis 7.0.15 lifecycle file: **18/18 per storage mode**, no unhandled
  rejections (`/tmp/jra-a9-redis-setup-after.log`). Both final setup failure cases
  failed before correction (`/tmp/jra-a9-redis-setup-before.log`).
- Cross-table/include error-boundary files and ordinary positioning contracts:
  **102/102** (`/tmp/jra-a9-config-diagnostics.log`). The relationship tests
  include guarded writers and original cause preservation.
- Ordinary filter/query warning file: **6/6**
  (`/tmp/jra-a9-query-diagnostics-knex-completed.log`). This checks a real
  duplicate hasOne result and skipped internal sorting with normal, throwing and
  rejecting writers alongside the previous payload tests. Canonical filter plus
  positioning checks passed **12/12**
  (`/tmp/jra-a9-query-diagnostics-anyapi-verified.log`); ordinary-only warning
  branches are selected only in the ordinary mode.
- Scoped ESLint passed for all changed diagnostic runtime/regression files
  (`/tmp/jra-a9-diagnostic-lint-completed.log`). `git diff --check` is clean.
- HTTP's before-correction probes found the raw body/header leak and, separately,
  parser snippets in messages/stacks/summaries. Root's passing final evidence is
  `/tmp/jra-http-diagnostics-after-20260912.log`,
  `/tmp/jra-http-diagnostics-anyapi-20260912.log`,
  `/tmp/jra-http-diagnostics-express4-knex-20260912.log`, and
  `/tmp/jra-http-diagnostics-express4-anyapi-20260912.log`.

The formatter's measured local cost and limitations are recorded separately in
`query-measurements.md`. No new logger enablement mechanism or per-hook context
tracking was introduced. The migration guide records this contract and its
limits in its diagnostic sections.

## Historical implementation inventory

The following sections preserve earlier investigations, superseded gaps and
measurements. References to hooked-api, paused positioning, or unfinished owners
below describe those earlier checkpoints; the current owner map above replaces
those acceptance statuses.

The serializer failure review now covers non-Error throws from custom toJSON,
its accessor, nested/enumerable properties and non-enumerable causes. These
failures produce bounded placeholders and retain the original error message;
they no longer throw merely because a caught value is null or undefined.
The formatter reuses the existing safe error-message helper. Top-level metadata,
summary and error-envelope accessor failures now produce safe previews too.
Protected message/details values are skipped before reading; error stacks are
omitted when their name/message is redacted, including enumerable stack fields.
Custom error JSON output follows this stack policy throughout its returned
object/array tree, omitting stack keys before invoking their getters.
Validation classification uses guarded property reads without an extra custom
toJSON call. These checks do not complete the wider output-owner inventory.

Binary values now produce type/byte-length metadata rather than enumerated
contents: Buffer, typed-array/DataView views, ArrayBuffer and SharedArrayBuffer.
The same preview applies to upload metadata, nested causes/details and a binary
value thrown directly. Error-message wrapping also avoids converting thrown
binary contents to text while retaining the original cause. This does not
redact arbitrary filename/path fields or secrets embedded in ordinary strings;
the wider owner/field-policy inventory remains open.

## Existing output owners

Write failures, connector errors and file-cleanup warnings now share
`getOperationDiagnosticContext` from the existing error-context module:

| Field | Meaning |
| --- | --- |
| `method` | Existing resource method spelling or HTTP verb at that boundary; null when unavailable |
| `scopeName` | Trusted operation/registered route resource, never inferred from an unvalidated URL; null when unavailable |
| `phase` | Reporting boundary: `writeFailure`, `httpError` or the existing file-cleanup phase |
| `backend` | Knex client identifier when available; null for absent/nontext configuration |
| `transactionOutcome` | Snapshot from the existing outcome helper at logging time |

Cleanup warnings can report pending even when their operation later commits;
this is the state when the warning was emitted. These reporting phases do not
pretend to identify every failing hook. Existing nested error context retains
specific getter/setter/include phases when supplied. Broader failing-phase
coverage and direct/upstream output owners remain part of A9-07/A9-08.

Existing include wrappers now supply `include`; the included-resource metadata
wrapper supplies `relationshipMetadata`. Tests cover the six relationship kinds
and nested wrapper chains while retaining typed-error identity and original
causes. The standalone relationship-identifier loader has separate unwrapped
validation/read paths; these changes do not establish phase coverage there or
for every arbitrary hook failure.

| Owner | Current behavior and remaining work |
| --- | --- |
| `lib/enhanced-logger.js` | Wraps method and connector errors and bounds their complete argument lists through the shared formatter. Original writers are captured before replacement. Duplicate validation-detail events have been removed. It is not a global logging sink. |
| `lib/error-formatter.js` | Preserves nested errors/causes with depth/cycle handling and now limits entries, traversal and copied text. Formatted-error previews are bounded; other logger arguments are not covered. Summaries share the formatter and have a 2,048-character cap. Arbitrary payload redaction remains open. |
| `rest-api-plugin-methods/common.js` | Write-error logging supplies method/resource, input record and cleanup diagnostics. It now derives hidden/normally-hidden names from compiled output fields when present. Early failures without that metadata still need coverage. |
| Express/Fastify connectors | Enhanced error logging occurs before separate HTTP error mapping. Error metadata now uses registered route templates and omits raw URLs. Broader request/error redaction remains open. |
| Ordinary storage plugin | Direct logs bypass the enhanced logger. Collection query parameters, POST input, PATCH attributes and stored filter payloads have been removed from these messages; operation/table information remains. |
| Shared `basicFiltersHook` | Direct traces previously included filters, filter values and whole field definitions. They now retain scope/table/field/operator information without those payloads. |
| File handling | Upload-completion debug messages omit the stored URL. Cleanup warnings now use the enhanced logger with current compiled field visibility, bounded previews and binary metadata. Original cleanup errors remain on the context; broader external-message and pre-metadata coverage remains open. |
| AnyAPI registry | Rollback warnings now use the enhanced logger with explicit operation/resource, phase, backend, outcome, tenant and error/cleanup fields. They no longer pass the complete mutable transaction context. Preview bounds and binary omission apply; arbitrary external error text is not a resource-field redaction policy. |
| Socket.IO | Subscription information logs omit filters and retain subscription/resource identity. Its existing installation logger is wrapped by the enhanced logger, bounding authentication, subscription, permission and Redis events. Subscription matching and notification permission failures additionally use the trusted resource's compiled hidden/normally-hidden field policy. Tests exercise real WebSocket and polling connections. Admission/authentication policy and upstream method logging remain separate work. |
| Positioning | Direct debug logs include filter conditions. Implementation changes remain paused. |
| Installed `hooked-api` | Scope/API method wrappers log `{ params }` before invoking library methods; plugin installation logs options. Its logger factories capture the configured sink. Library enhanced-log wrappers cannot sanitize these earlier writes. |

The upstream inventory is based on the installed `hooked-api/index.js` method
wrappers, `_createLogger`, `_createContextLogger` and `_formatAndOutput`. It does
not authorize editing the installed dependency or make its existing pending
logging-failure patch solve payload redaction. No dependency changes were made.

## Implementation constraints

Use compiled field definitions for resource-sensitive decisions. Do not infer
that all sensitive fields have names such as `password`; hidden attributes can
have arbitrary names. Avoid copying full input/query objects merely to describe
which operation ran. Values interpolated into log messages need the same review
as object properties. Nested causes, validation details, uploaded-file metadata
and external error messages are payload sources too.

Bound depth, breadth, strings and total emitted payload size; depth alone is not
sufficient. Preserve original error objects and transaction outcomes. Logging
failure must remain secondary to an operation failure, as enforced by the
existing resource cleanup tests. Any sink-level solution must account for the
upstream parameter logs rather than claim whole-library coverage from the
three enhanced-logger call sites.

## Applied filter-trace check

`conformance-filter-diagnostics.test.js` uses a shared real resource fixture
with a hidden searchable field. It captures the shared filter hook's logger,
checks that the hidden value and schema default are absent, and executes the
query to prove the original binding still selects the record. It covers the
hook boundary only, not upstream method logs or every query path. The canonical
query uses the same explicit logical table alias as the production collection
path. An initial missing alias in the test was corrected; it was a fixture SQL
error, not a production regression.

## Upstream parameter-output probe

A temporary probe of the installed dependency registered one API method through
its public `customize` API and supplied a recording logger at construction.
At debug level, both pretty and JSON modes emitted the parameter sentinel before
the handler was entered. A 100,000-character parameter survived as well: the
captured pre-handler call serialized to 100,163 characters in pretty mode and
100,241 in JSON mode. These lengths measure the captured-call JSON representation,
not exact terminal bytes. The probe is `/tmp/library-upstream-diagnostic-probe.mjs`
with results in `/tmp/library-upstream-diagnostic-probe.log`.

The dependency's `_sanitizeForLogging` handles depth, cycles and function-heavy
objects, but preserves primitive string values and traverses full arrays/object
keys. Its JSON output mode serializes the structured event before invoking the
custom logger; pretty mode passes data separately. A custom sink cannot be
assumed to receive the same structured input in both modes. The probe supplies
synthetic data only and does not modify the dependency or any consumer checkout.

## Expanded static inventory

A TypeScript-parser inventory of `lib/` and `plugins/` found 161 explicit
property-call logging sites at this checkpoint: 102 pass more than one argument,
and 52 interpolate their first argument. Counts overlap. The query selects
logger/console-like receiver spellings and known logging method names; it is a
review aid, not proof that aliased, computed or dynamically supplied calls are
covered. Source arguments and locations are recorded in the temporary
`/tmp/library-log-call-inventory.json`; the generating script and readable list
use the same prefix with `.mjs` and `.log`.

Review identified additional payload owners beyond the first inventory:

- Include loading logs contain `uniqueIds`, `mainIds`, `targetIds`, `parentIds`,
  relationship definitions, include configurations and parsed include trees.
  Replace diagnostic ID arrays with counts where identity lists add no necessary
  operational information; structured configuration still needs size limits.
- Connector request-error metadata previously contained full URLs, including
  query values. The applied route-template change removes those URL fields;
  this is separate from redacting the error object.
- Registry rollback diagnostics pass a context object; its construction must be
  inspected rather than assumed to be a safe request context or a harmless summary.
- Socket authentication, permission checks, Redis failures and subscription
  errors originally passed raw errors through direct loggers. The applied
  Socket.IO installation wrapper now brings these calls through the formatter;
  the subsequent resource-policy follow-up covers subscription matching and
  notification permission errors. Admission/authentication errors still need
  their own policy; a registered notification resource is not available at
  every socket failure boundary.
- Configuration and capability messages can contain arbitrary field/resource
  names, index lists, policy/resolver registries and external error messages.
  Even metadata-only events need output bounds.

Paused positioning logs were included in the read-only inventory and remain
unchanged. Counts and grep/parser matches alone do not establish redaction
acceptance; the selected output policy still needs sink-level execution tests.

## Applied include-log follow-up

The seven-site log-only draft in `/tmp/library-include-log-payload.patch` has
been applied to `knex-relationship-includes.js` after the 11,584-pass full gate
finished. It replaces ID arrays with counts and removes whole relationship/include
definitions and selection arrays from those events. A parser audit of the
original and draft found identical non-logging ASTs after removing the same 26
logging statements. Focused include checks pass 82 per storage environment,
164 total, with scoped lint clean. The legacy nested/adapter suites use SQLite,
so these environment labels are not claims of native database coverage.
The full gate predates this seven-site follow-up.

Registry review established that rollback logging received a transaction
context populated with cleanup state. The applied follow-up selects explicit
diagnostic fields and bounds nested cleanup errors using the enhanced logger.
The emitted event is a snapshot: a subsequent logger rejection is appended to
the original cleanup context, not retroactively added to the emitted preview.
The original write error remains the rejection cause.


## Applied formatted-error bounds

The existing formatter now limits each container to 50 entries, the shared
serialization traversal to 256 values, each string to 2,048 characters, and
copied text to an 8,192-character pool. Structural keys and truncation markers
add output overhead; these are traversal/text limits rather than an exact byte
cap. Arrays stop reading after their preview/traversal limit. Original error
objects, property values and aggregate members remain untouched.

Three new baseline regressions failed on long/wide errors, large property names
and array-tail reads. The applied suite also checks custom JSON output,
nonstandard error text and a shared budget across sibling containers. Existing
cause/aggregate/depth/stack cases continue to pass. This is one formatter boundary;
Enhanced-log extra arguments and direct/upstream output
still need independent treatment before A9-08 can close.


## Applied summary bounds

`formatErrorSummary` now sends its selected message/code/violations/fields through
the same bounded formatter and limits the result to 2,048 characters, including
truncation markers. Its projection avoids invoking custom error JSON conversion
or traversing unrelated detail properties. Tests cover an omitted array-tail
getter, long messages/violations, unchanged short spelling and summary-only
logger calls. Other enhanced-log arguments remain outside this boundary.


## Applied enhanced-event bounds

The serializer has been factored within the existing error-formatter module so
`formatError` and `formatDiagnosticValue` share one implementation. Enhanced log
methods convert at most 50 supplied arguments and apply a shared preview budget
to the complete emitted list. Additional data now receives the same bounds as
message/error content. The redundant validation-detail event is removed; the
main event contains the structured violation preview.

Tests reproduce oversized event data and omitted-violation access before the
change. Applied checks cover bounded events, unchanged caller data, writer
receiver/returns/exceptions and the intentional one-event validation policy.
Direct/upstream logger calls and sensitive-field redaction remain separate work.


## Applied structured-field redaction

The existing bounded serializer accepts a field-name policy. It omits matching
structured values before property access, and recognizes validation records by
an own data `field` property naming the field directly or through
`data.attributes.<field>`. Those records retain field/rule metadata and a redacted
message, dropping value-bearing properties. Enhanced error formatting and
summaries receive the same snapshotted policy.

`handleWriteMethodError` supplies the current resource's compiled hidden and
normally-hidden output fields. Unit checks cover configured getters, nested
error details, validation summaries, original error identity and caller input.
A shared real resource fixture verifies published declarations, an injected
write failure, empty persisted storage and unchanged caller input in both modes.

This does not inspect arbitrary free text for secret values, infer sensitivity
for other resources from the current resource, or retrofit direct/upstream calls.
Connector errors need the relevant resource policy; failures before metadata
assignment need a reliable owner as well. These remain A9-08 acceptance work.


## Applied connector field-policy follow-up

A real POST probe confirms that both HTTP connectors currently log a hidden
attribute inside nested error details again after write-method redaction. An
isolated draft passes the compiled route resource to the existing enhanced
logger, sharing field selection with write logging. A second reproducer checks
malformed array input before write transaction setup; assigning compiled
metadata before validation protects that event too. The broader canonical
storage-environment draft selection passes 252 checks with no failures/skips.
The draft was applied after the accumulated source gate passed; focused
applied-source checks pass (506 total), along with types, scoped lint and docs. See the
[verification ledger](verification-progress.md) for exact artifacts and results.

This route-resource policy is insufficient for an Express parser or
`transport:request` error raised before route selection. Its final error
middleware has neither route metadata nor necessarily a populated resource
context. Fastify owns route metadata in its route error-handler closure, but
that does not prove every external framework error uses this handler. Do not
infer a resource from an unvalidated URL or claim that the route draft protects
all transport events. Related-resource fields, direct/upstream output and
uploaded metadata also remain separate acceptance work.


## Metadata copying before formatting

Enhanced logger convenience methods and `{ error, ...metadata }` envelopes now
format metadata before spreading it. Previously the spread eagerly read hidden
and out-of-preview properties before the shared serializer could omit them.
Argument classification also avoids probing a configured protected `error` key.
Three counter-based regressions fail on the preceding source and pass after the
change, proving zero reads rather than relying on a thrown getter that a
serializer might catch. Final event serialization still enforces its aggregate
preview budget; original metadata remains unchanged.

### Awaiting diagnostic writers

Enhanced log-level methods, `logError()` and `logValidationError()` return the
underlying writer's result. Callers using asynchronous sinks must await that
result to observe completion or rejection. The wrapper bounds and redacts the
event; the owning operation decides whether a writer failure is primary or
secondary. The validation helper follows this contract both when violation
details are present and when it falls back to ordinary error formatting.

### Socket.IO authentication failure delivery

Authentication middleware now handles null/undefined rejections and uses the
shared safe error-message helper for other thrown values. The client receives
`Authentication failed` for absent values; server-side failure callbacks still
receive the exact original value. The connection rejection retains that value
as its cause. No socket is admitted after these failures.

Failure-hook and authentication-warning logging are guarded and awaited at
their existing call sites. A synchronous sink failure can no longer replace the
original authentication message or prevent delivery of `connect_error`.
Eight regressions reproduce the earlier failures over real WebSocket and polling
transports: null/undefined failures previously timed out, failure-hook logging
replaced the message, and authentication-warning logging prevented rejection.
This does not establish asynchronous writer propagation through the installed
hooked-api logger or complete the separate Redis/event-handler logging audit.

### Subscription room-join failures

Subscription acknowledgements, no-ack `subscription.error` events and restored
subscription failure entries now share one local formatter. It uses the existing
safe message helper, supplies `SUBSCRIBE_ERROR` / `Subscription failed` for
null/undefined failures and tolerates a throwing code accessor. Valid string
codes remain available; malformed code values cannot become response metadata.

Real WebSocket/polling tests inject room-join rejections at the server socket.
They verify the response, removal of the reserved subscription, absence of the
resource room, and successful retry after restoring the adapter. Before the
fix, null/undefined failures prevented acknowledgement/event delivery or turned
an individual restore failure into a failed restore batch. The twelve original
regressions fail before and pass after; two additional code-accessor checks
exercise the guarded metadata read. No new storage or transaction behavior is
introduced. Unsubscribe adapter rejection is covered by the follow-up below;
remaining event log owners still need separate review.

### Unsubscribe completion and room mutation ordering

Unsubscribe now waits for the room adapter before acknowledging success. Its
logical removal remains effective if departure fails, preventing further
notifications to the removed subscription. The error acknowledgement handles
non-Error failures and survives diagnostic sink failure. Successful completion
logging cannot cause a second, contradictory failure acknowledgement.

One local helper orders join/leave promises per socket. The WeakMap retains
only the current tail and removes it when the tail settles; failed operations
reject their own caller while permitting later operations. This state is not
placed in `socket.data`, serialized to Redis or used as an authorization cache.
It covers room mutations only, not permission hooks or resource operations.

Real WebSocket/polling regressions hold departure pending, check that success
has not been acknowledged, start a new subscription, and verify that the new
room membership survives. An isolated loader removes only room ordering while
retaining awaits: both transport cases then lose the room. Separate failures
verify null rejection, failed diagnostics, logical removal and subsequent
successful room operations. Remaining event and Redis logging owners still need
review; this does not complete A7/A9.

### Subscription success diagnostics

After a successful room join, the subscription is already installed. Its
informational log is now guarded and awaited before returning success; a sink
failure cannot turn that result into a failed acknowledgement, failed creation
event or failed restoration entry. Admission error logging is also awaited
inside its existing guard. Six regressions fail before the correction and pass
after it over WebSocket/polling transports. The fixture enables informational
logging so the original failure is actually exercised, and checks that the
single subscription and its room agree with the successful client result.

These checks inject synchronous sink failures. They do not establish that the
installed hooked-api logger propagates asynchronous sink promises; that upstream
limitation remains separately tracked.

### Notification warning failures

Subscription-query failures already mean no match, and a rejected final
permission check already means skip that recipient. Both warning writes now
run inside awaited guards. A throwing logger cannot turn those decisions into
a failed resource operation or prevent notifications to another permitted
recipient. The original query/permission failure is still supplied to the
bounded, resource-aware diagnostic writer; if that writer fails, the existing
delivery decision remains in force.

Real WebSocket/polling tests cover both boundaries with a rejected subscriber
and a separate permitted subscriber. They verify successful acknowledged commit,
persisted data, no forbidden notification, and one notification to the permitted
subscriber. Four initial regressions fail on the prior source; final assertions
also exercise recipient isolation in both storage modes. These are synchronous
sink-failure checks and do not remove the upstream asynchronous-logger limitation.

### Disconnection during an asynchronous join

Admission rechecks `socket.connected` after room joining settles. If the socket
disconnected while the adapter was still joining, it invokes the adapter's
`delAll(socket.id)` cleanup and rejects admission; the existing failure path
removes the reserved subscription. This handles membership created after
Socket.IO's original disconnect cleanup. Leaving only the resource room is
insufficient: the installed adapter retains an empty `sids` entry after `del`,
while `delAll` removes the socket entry as well.

The real WebSocket/polling test holds adapter `addAll` pending, disconnects the
server socket, releases the join, and waits for the actual admission handler to
settle. It checks logical subscriptions, room membership and the adapter's socket
index. An isolated probe without the completion check retains all three. An
initial room-only cleanup draft removes the first two but fails the socket-index
assertion; final cleanup uses the existing adapter operation rather than a new
registry or a special disconnected-socket cache.


## Current follow-up, 2026-09-12

Current source now bounds storage, positioning and file-plugin diagnostic
owners through the existing formatter. Include logs report counts instead of
path collections. Formatter fixes cover protected inherited/accessor fields,
restricted custom conversion, nested stacks, envelope getter reads and failed
property inspection; native brand checks and guarded Error ancestry avoid
proxy-prototype traversal while retaining ordinary SQLite driver errors.
Error wrapping preserves causes/outcomes through failed metadata inspection.

The old hooked-api and positioning-payload blockers above are historical.
A9-07/A9-08 remain open: application-authored
search-validator messages, schema-free authentication error strings and
formatter overhead retain the limits recorded in the preparation report.
Normal write attribute validation uses a fixed top-level message; the suspected
built-in hidden-value leak on that path was not established. No generic secret
scanner or new logger framework was added.

The authorized Node 24 checkpoint is complete. Focused SQLite/PostgreSQL/MySQL
checks, the final full AnyAPI suite, Express 4, internal and packed public types,
query budgets, lint and docs pass. The full default suite found three SQLite
driver-message regressions; all passed the 176-test focused rerun after the
classifier correction. That entire default suite was not repeated. Additional
verified corrections cover nullish HTTP read failures, conditional PUT,
positioning target reads and failing Express/Fastify diagnostic sinks.

A7-06 is now complete. A7-05 remains open for the two owners identified below;
A9 retains its separate acceptance work. The
[completed verification record](pending-jskit-ai/preparation-status.md#completed-verification-checkpoint)
contains exact results, commands, logs, final artifact evidence and limits.
Consumer migration and verification remain deferred.

## A7-05: Secondary-failure reconciliation, 2026-09-12

This bounded source review reconciles the current cleanup owners with existing
executed assertions. It ran no tests and changed no runtime code. The two
remaining findings below are source-reviewed failure paths, not newly executed
reproductions. Older requests for an unspecified wider audit are superseded by
this finite owner map.

| Owner | Existing primary/secondary failure evidence |
| --- | --- |
| Ordinary and relationship writes | `handleWriteMethodError` and `rollbackAfterError` retain the original cause and ordered cleanup diagnostics. `tests/conformance-write-failures.test.js`, the `Secondary write failures` suite, asserts owned/managed rollback and `afterRollback` failures, stored rows/linkage, exact diagnostics and context reuse. |
| Managed completion | `finishTransaction` attempts later operation hooks and finalizers, preserves the first committed failure and indexes later failures. `tests/conformance-managed-transactions.test.js` asserts exact hook/finalizer diagnostics, acknowledged outcomes and stored rows, including null/undefined finalizer failures and unknown completion. |
| Shared connection leases | `lib/knex-transaction.js` and the shared completion owner distinguish SQL outcome from pool release. `tests/conformance-connection-release.test.js` covers release failure after acknowledged commit, acknowledged rollback, unsettled rollback and failed BEGIN, asserting original causes, secondary diagnostics and one release attempt. |
| Bulk operations | `retainChildCleanup` retains child diagnostics with `bulkIndex`; shared rollback handles atomic owners. `tests/conformance-bulk-failures.test.js` asserts failed atomic rollback, non-atomic rollback/completion failures, later successful writes and exact indexed diagnostics without mutating child entries. |
| AnyAPI registry | `#handleWriteFailure` uses shared rollback, invalidates the descriptor and contains synchronous/asynchronous logging failures. `tests/anyapi-registry-failures.test.js` covers primary errors, failed rollback, throwing/rejecting writers, retained rollback diagnostics, cache reload and subsequent recovery. |
| File handling | `recordCleanupFailure` retains cleanup and logger failures while later cleanup attempts continue. `tests/conformance-file-failures.test.js` covers temporary files, uploaded files, managed completion chains, bulk indexes, retained failed-upload tracking and original write causes. |
| Socket.IO authentication, subscriptions and notifications | `tests/socketio-contract.test.js` verifies authentication/admission rejection despite failing writers, bounded failure-hook diagnostics, successful acknowledgements and recipient isolation. `tests/conformance-socketio-authorization.test.js` asserts continued broadcast attempts, committed rows, the first broadcast failure as cause and indexed diagnostics for both failed broadcasts. Best-effort permission/query decisions retain their documented skip/no-match behavior. Redis bulk cases in `tests/integration/socketio-redis.test.js` additionally assert original child errors, indexed rollback-hook diagnostics and delivery only for committed entries. |
| PostgreSQL schema alterations | Owned alterations use the shared transaction owner; borrowed alterations retain their savepoint and outer ownership. `tests/db-field-alterations.test.js` and the recorded native schema/completion checks cover rejected completion, parent ownership and surviving schema state. |
| SQLite schema alterations | `runSqliteAlteration` retains an alteration error and failed rollback/FK restoration through `AggregateError`. The SQLite rebuild cases in `tests/db-field-alterations.test.js` assert its cause/error members, connection disposal and stored schema. Its separate final pool release is the outstanding path described below. |

The completed Node 24 checkpoint covers the selected unit/public operation
files, including the final full AnyAPI invocation and focused correction of the
three registry diagnostic failures. Earlier native and Redis executions are
recorded in `verification-progress.md`, including the SQL lease-release, schema
completion and deferred Socket.IO broadcast sections. This reconciliation does
not claim those native/Redis suites ran again or covered the two new findings.

### Resolved owner 1: SQLite alteration pool release

The following describes the reproduced defect before correction. The completed
verification for this owner is recorded below.

`plugins/core/lib/dbTablesOperations.js`, `runSqliteAlteration`, unconditionally
awaits `knex.client.releaseConnection(connection)` in `finally`. If alteration
already failed, a rejected release replaces that error. If rollback or restoring
foreign keys also failed, the release rejection replaces the existing
`AggregateError` and loses both retained errors.

The current SQLite alteration cases inject rollback/FK-restoration failures;
they do not inject release failure. The shared transaction-factory release tests
exercise a different owner and do not establish this helper's behavior.

The finite follow-up is to preserve the original alteration cause and retain
release failure as secondary, with targeted cases for alteration failure plus
failed release and an existing cleanup aggregate plus failed release. Also
retain the successful-alteration/failed-release result deliberately; a release
failure must not imply that acknowledged schema changes were rolled back.

### Resolved owner 2: Socket.IO Redis cleanup and diagnostics

The following describes the reproduced defects before correction. The completed
verification for this owner is recorded below.

`plugins/core/socketio-plugin.js` has three uncovered secondary-failure paths:

- Both startup catches call `client.destroy()` before rethrowing the original
  connection/setup error. If destruction throws, it replaces the original and
  prevents attempts on later clients.
- The Redis `error` listener calls `log.warn` without containing a throwing or
  rejecting writer. A secondary diagnostic failure can escape the event handler
  or become an unhandled rejection.
- Redis shutdown uses `client.close().catch(error => log.warn(...))` without
  observing the returned promise. A rejected close followed by a throwing or
  rejecting warning writer can leave an unhandled rejection.

`tests/integration/socketio-lifecycle.test.js` already exercises missing sockets,
invalid credentials, one failed client, exhausted retries, normal/reconnecting
shutdown and subsequent successful startup. It does not inject destruction,
close or diagnostic-writer failures at these paths.

The finite follow-up is to preserve the startup error while retaining cleanup
failures and attempting both clients, contain Redis event/shutdown diagnostics,
and add targeted regressions for those specific combinations. Authentication,
subscription and broadcast acceptance above does not need to be reopened.

**A7-05's two remaining owners are now corrected and verified.** The completed
checks below supply the remaining closure evidence for this finite owner map.

### A7-05 completed owner verification, 2026-09-12

`runSqliteAlteration` collects alteration, rollback/FK-restoration and pool
release failures in execution order. One failure is rethrown unchanged; multiple
failures produce an `AggregateError` whose cause is the original failure. A
release failure after successful alteration still rejects, and its regression
verifies the committed new column default remains installed. The failure cases
verify the old schema, restored FK enforcement, one release attempt and a usable
subsequent connection, including a frozen primary error.

Redis startup has one cleanup path. It attempts destruction of both clients,
observes synchronous and asynchronous cleanup failures, settles the connection
attempts, and retains setup plus cleanup errors through `AggregateError`.
Redis event warnings, both startup information logs and shutdown warnings contain
throwing/rejecting writers. Both graceful shutdown attempts still start
immediately. Shutdown does not add forced destruction: flushing an adapter's
pending unsubscribe promises would introduce unrelated unhandled rejections.
Warning metadata records method, scope, phase, backend, outcome and client role;
these non-resource operations deliberately report null scope and outcome `none`.

All commands used Node **24.6.0**, with its bin directory prepended to `PATH`:

- Before correction, the three SQLite pool-release cases produced **2 failures
  and 1 pass** in `/tmp/jra-a705-sqlite-before.log`; both failures lost the primary
  error to pool release. After correction,
  `node --test tests/db-field-alterations.test.js` passed **23/23** with no
  failures, cancellations or skips (`/tmp/jra-a705-sqlite-after.log`).
- The first six Redis secondary-failure cases produced **6 failures** alongside
  eight passing existing lifecycle cases in
  `/tmp/jra-a705-redis-before-final.log`. A later throwing/rejecting info-writer
  check also reproduced the unguarded final startup log before that correction
  (`/tmp/jra-a705-redis-verified.log`).
- The final command
  `node scripts/test-databases.js redis tests/integration/socketio-lifecycle.test.js`
  passed **16/16 in each storage mode**, with no failures, cancellations, skips or
  unhandled rejections (`/tmp/jra-a705-redis-final.log`; 3.376s regular and 9.302s
  canonical). It ran actual **Redis 7.0.15**, using
  `JSON_REST_API_REDIS_BIN=/tmp/jra-redis-binaries-UPZeIA/root/usr/bin/redis-server`
  and `LD_LIBRARY_PATH=/tmp/jra-redis-binaries-UPZeIA/root/usr/lib/x86_64-linux-gnu`.
  The runner owns and removes its server and disposable database directory.
- Scoped ESLint passed for both changed runtime files and both regression files
  (`/tmp/jra-a705-lint-final.log`).

The tests also verify ordinary/reconnecting shutdown, startup failure recovery,
both Redis roles, original frozen error identity, later cleanup attempts and
successful restart. The shared conformance fixture now forwards its configured
diagnostic writer so the native tests exercise actual caller logging. These are
targeted checks; no full library or notification matrix was rerun for this item.
