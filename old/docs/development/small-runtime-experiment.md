# Small resource runtime experiment

Rollback checkpoint: `f242aa5` (`Harden resource contracts and simplify storage internals`).
This is an experiment for judging the assembly layer, not a completed dependency migration.
The master improvement goal and consumer migrations remain paused.

## Verdict

Keep pursuing this design. The runtime occupies one file and 166 lines, including
comments and blank lines. Existing operations execute without a proxy dispatcher,
a generic scope-alias system, or automatic dispatch logging. SQL, schema compilation,
query building and transaction ownership remain in their existing implementations.
Changes in the storage plugins are registration names and setup hook declarations.

This is enough evidence to justify the approach, not to claim that the whole
library has completed migration. Smallness must survive the remaining work below.
Do not port the old framework wholesale to obtain compatibility.

## Following a call

1. `api.resources.items.patch(params, context)` finds an ordinary method on the
   shared resource-method prototype.
2. That method constructs one argument object and calls the existing patch handler.
3. The handler's `runHooks` walks a named hook list sequentially, awaiting each handler.
4. Existing write code acquires or participates in its transaction and records its outcome.

There are no dispatcher catches, payload dumps or error wrappers. Existing
operation-level diagnostics still run; errors from those diagnostics remain subject
to the existing cleanup/error contract.

`lib/runtime/json-rest-api.js` contains the resource runtime and its small hook list.
It owns construction, installation, resource registration, argument construction,
named hook ordering and sequential execution.
The operation argument names `scope`, `scopes`, `scopeName` and `scopeOptions` remain
because existing operation handlers use them. They do not introduce a second public
scope API or require a compatibility dispatcher.

## Deliberate contracts

- Resources have stable object identities; looking up a method does not allocate a wrapper.
- Resource methods inherit from one shared method table. Later registrations apply to
  existing resources; a resource's own method overrides its default.
- Vars and helpers each inherit API defaults through one ordinary prototype link.
  Assignments stay local; deleting an override reveals the current default again.
  `Object.keys(resource.vars)` enumerates local values, not inherited defaults.
- Call methods with their resource receiver. Extracted shared methods need `.bind(resource)`.
- Global setup hooks run when a resource becomes available. Its local operation hooks
  are registered afterwards, as with the previous resource setup sequence.
- Hooks support `beforeFunction` or `afterFunction`. A missing anchor is an error.
  Returning `false` stops that hook list; it is not an authorization-denial substitute.
  Throwing stops dispatch and preserves the exact thrown value.
- A dispatch snapshots its list: newly registered hooks run on subsequent dispatches.
- Plugin installation and resource configuration are sequential setup operations.
  Await each operation. Discard the instance after a setup failure; installation is
  not transactional and there is no partial-install recovery system.
- Logging is injected by the owner. Missing levels are silent; formatting and filtering
  belong to that logger. There is no automatic invocation logging.

## Experimental migration examples

The constructor is intentionally not yet a root export or a declared public host type.
For this checkout (and its packaged deep path), bootstrap is:

```js
import { JsonRestApi } from 'json-rest-api/lib/runtime/json-rest-api.js'
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api'

const api = new JsonRestApi({ name: 'app', logger })
await api.use(RestApiPlugin, { format: 'jsonapi' })
await api.use(RestApiKnexPlugin, { knex })
await api.addResource('items', resourceOptions)
```

The resource calls and transaction API stay as they were at the checkpoint.
Setup changes are explicit:

| Previous setup | Experimental setup |
| --- | --- |
| `new Api(...)` from hooked-api | `new JsonRestApi(...)` from the local runtime |
| `api.scopes` | `api.resources` |
| Injected `addScopeMethod` | Injected `addResourceMethod` |
| `scope:added` | `resource:added` |
| Resource `scopeMethods` | Resource `methods` |
| `customize({ scopeMethods })` | `customize({ methods })` |
| Dependency string `'a\|b'` | Dependency alternatives `['a', 'b']` within `dependencies` |
| Built-in logging configuration | Injected `logger` with level methods |

API methods are installed by plugins. Generic aliases, arbitrary method-registration
lifecycle events, per-plugin hook placement and `customize({ apiMethods })` are not
implemented. The canonical plugin's old `sequence: 50` option was ignored by the
installed hooked-api; its registration now explicitly uses append order.

## Verification

Node 24.6.0 only. Focused runs, not the comprehensive suite:

- Existing managed transaction, authorization and reused-context regressions.
- Existing transaction concurrency, related/include permissions and explicit-search regressions.
- Existing write-error cleanup and redaction regressions.
- New runtime tests for identity, context sharing, local hooks, late helper/method
  overrides, dependency checks, ordering, stopping, mutation during dispatch,
  arbitrary thrown values and unsafe property names.
- Twelve promoted dependency regressions per SQLite storage implementation verify
  null/undefined from preparation, finish and after-commit hooks. They inspect the
  original cause, stored rows, transaction outcome and failed write-logger diagnostics.
  No patched dependency or module loader is involved.
- Real Express/Fastify parity and HTTP diagnostic regressions: 186 per SQLite storage mode.
- PostgreSQL 16 and MySQL 8: 111 per storage implementation per database, 444 passing total.
- Existing project typecheck and ESLint. The typecheck does not establish a typed
  public interface for the new runtime.

Successful batches recorded 1,620 passing test executions, including narrow reruns:
115 initial ordinary-storage checks, 278 additional ordinary-storage/runtime checks,
355 canonical-storage checks, 24 promoted failure regressions, 372 HTTP checks,
444 native database checks, and 32 final runtime/failure checks. Initial setup failures
were corrected before these passing batches. Final lint, existing project typecheck
and documentation build passed. No full-suite or clean-package result is claimed.

## Work deliberately outside this experiment

- Remove the remaining hooked-api error classes and missing-package helper imports;
  update the manifest, lock and corresponding declarations.
- Choose and type the public constructor/plugin interface and finalize validation of
  the narrower setup contract, including rejection of removed option names.
- Migrate documentation, runnable examples and development scripts. Most still show
  the previous constructor and plugin contract and are not an acceptance gate for this spike.
- Review optional plugins beyond those exercised here, especially their setup and
  diagnostic assumptions. Removing positioning's private installed-plugin lookup is
  covered by the common dependency check; its behavior has not been newly certified.
- Update the historical pending-hooked-api test instructions: their fixture now uses
  the experimental runtime, so their old loader override no longer selects dispatch.
  The historical patch artifacts remain intact for rollback and reference.
- Complete package/public-type checks and a deliberately scheduled comprehensive
  regression run before treating the migration as ready to publish.
- Migrate jskit-ai/vibe64 only when consumer work is resumed. Neither repository nor
  its seeds was changed by this experiment.

If completing these tasks requires rebuilding a generic framework, reconsider the
approach. The current result is useful precisely because its responsibilities are narrow.

## One-file follow-up

The hook list and runtime now live together in `lib/runtime/json-rest-api.js`:
166 lines, including comments and blank lines. Hook tests import that file directly.
No operation, storage, schema or transaction implementation moved into the runtime.

The first comprehensive ordinary-storage run reported 5,957 passes, 33 failures
and one existing skip. The failures identified remaining test migrations:

- Bulk configuration now asserts the original validation error code and field details,
  rather than the removed plugin-installation wrapper's text.
- Reserved resource names now assert the runtime's direct TypeError.
- File cleanup tests intercept the injected API warning logger rather than global console.
- The historical CORS setup now uses the new constructor and resource setup fixture.

Review also found an older query-copy test repeating three logger modes without ever
reaching its purported log message. The copy path has no such logging. Its eight
actual combinations (query/related, JSON:API/plain, borrowed/no transaction) retain
failure propagation, transaction ownership and subsequent-call recovery checks;
the sixteen ineffective duplicates were removed.

A clean full verification run and clean-package check follow these corrections.
Performance has not been benchmarked. Lower dispatcher overhead is plausible,
but request-level improvements cannot be inferred from line count or proxy removal.
