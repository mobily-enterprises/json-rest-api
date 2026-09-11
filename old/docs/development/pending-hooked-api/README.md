# Pending hooked-api thrown-value fix

This is a tested upstream patch against `hooked-api` 1.0.24, **not an installed
json-rest-api fix**. The installed dependency, package manifest/lock, and sibling
hooked-api repository are unchanged. A7-05/A7-06 remain open.

The API-method, scope-method and hook dispatcher catches read `error.message`
while logging. Throwing null or undefined therefore produces a TypeError and
loses the original value before json-rest-api can attach its write outcome.
The patch uses a private, safe error-message formatter and a shared failure-log
helper at those three catches. It rethrows the identical original value. If the
synchronous diagnostic logger throws, its failure is appended to the mutable
caller's `context.cleanupErrors` as `{ phase: 'logging', error }`. Each failed
logging attempt retains its own entry; a hook and its enclosing method can each
attempt to log the same primary failure.

It adds 48 upstream cases covering null, undefined, false, zero, strings, frozen
and typed errors, an object without a printable prototype, and diagnostic
loggers throwing Error or null. These checks address failures while logging a
rejected handler; they do not define recovery from arbitrary success/debug
logging failures or asynchronous logger rejection.

## Apply and verify

Use a clean checkout of hooked-api 1.0.24. `manifest.json` records the base source
and patch hashes. Apply `thrown-values.patch` with `git apply`, then run its
`npm test` using Node 24. The isolated patched copy passed all **295 tests**;
the added suite alone failed **30/48** on the original dependency and passes
**48/48** with the patch. The initial null-only patch still failed all 24 added
logging-failure cases; the extended patch fixes those too. No upstream publication or repository change was made.

From the json-rest-api root, the retained integration test can select that
patched checkout without changing dependency resolution for other processes:

```sh
PATCHED_HOOKED_API=/absolute/path/to/patched/hooked-api JSON_REST_API_STORAGE=knex node --test docs/development/pending-hooked-api/library-regression.test.js
PATCHED_HOOKED_API=/absolute/path/to/patched/hooked-api JSON_REST_API_STORAGE=anyapi node --test docs/development/pending-hooked-api/library-regression.test.js
```

Use Node 24 for these commands. The loader override exists only in this test
process. The twelve tests inspect the original cause, rollback/commit outcome,
persisted row count and secondary logging diagnostics for null/undefined from
preparation, finish and after-commit hooks with successful/failing logging.
They pass **12/12 per storage mode** with the patch and fail **12/12** against
the installed dependency (omit `PATCHED_HOOKED_API` to reproduce).

## Remaining integration

- [ ] Apply/review the upstream patch and release an intended dependency version.
- [ ] Update this library's dependency and lock to that version; run its required gates.
- [ ] Promote the integration regression into the normal test suite and remove the test-only resolution override.
- [ ] Audit plugin-installation wrapping and success/debug/asynchronous logging separately. The patch handles synchronous logging failures in the three rejected-handler dispatch paths; it does not fix the separate plugin-installation catch.

These tasks explain an existing A7 dependency, not additional master-plan items.
The patch contains no runtime compatibility adapter or alternate dispatcher.

## Separate pending diagnostic-payload patch

`diagnostic-payload.patch` removes the raw `{ params }` arguments from automatic
API/scope invocation logs and `{ options }` from plugin-installation logs. The
operation messages remain. This is a separate, uninstalled patch against 1.0.24;
it introduces no compatibility layer, new logger factory or configuration flag.
`diagnostic-payload-manifest.json` records base, draft, composed and test hashes.

The retained `diagnostic-payload.test.js` checks API methods, scoped methods and
plugin installation in both pretty and JSON modes. Each handler still receives
the complete payload, while captured automatic logs omit its sentinel and large
string. All six tests fail against the installed source and pass against the
payload-only draft. All six also pass with the draft composed with the earlier
thrown-value fix. Both saved patches apply in sequence to a clean isolated copy and reproduce
the recorded composed hash. The composed upstream suite passes **295/295**
when run alone; its first run alongside library checks failed three wall-clock
stress assertions (five reported failures including parent tests). No thresholds
or implementation were changed between runs. The composed checkout also passes
the retained library integration checks **12/12 per storage mode**, plus all six
payload regressions.

Run the retained tests against an explicitly selected patched module:

```sh
HOOKED_API_PAYLOAD_MODULE=/absolute/path/to/patched/hooked-api/index.js node --test docs/development/pending-hooked-api/diagnostic-payload.test.js
```

Use Node 24. Omitting the variable selects the currently installed dependency
and reproduces the six failures until it is updated. Review/apply both patches
to the intended upstream checkout, verify that release checkout, release it, and update
this library deliberately before considering the upstream gap resolved.
This patch only removes the three automatic payload dumps. It does not redact
external error messages, user-written logs or every diagnostic field, nor does
it introduce a general output-size bound.
