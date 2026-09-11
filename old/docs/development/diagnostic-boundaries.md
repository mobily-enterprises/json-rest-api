# Diagnostic boundaries

A9-07/A9-08 implementation inventory, 2026-09-11. Neither item is complete.
Consumer repositories and positioning changes remain paused.

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
