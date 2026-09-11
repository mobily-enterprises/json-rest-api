# Release review

The user authorized the final comprehensive Node 24 checks and asked for autonomous
completion, with decisions recorded here for review.

- Keep jskit-ai, vibe64 and their seeds untouched.
- Do not publish, tag or push. Commit any necessary library/documentation fixes locally.
- Run the full library gate once. After failures, rerun affected checks; repeat broader
  suites only when a behavioral change makes that necessary.
- Keep this review in `old/` so it does not become maintained release documentation
  or enter the npm package. Temporary test logs remain outside the repository.

## Documentation review

- Removed the last migration-guide progress notes; retained actual contract limits.
- The generated site has 39 pages. Local links, fragment anchors, asset references,
  unique IDs and one main heading per page passed inspection.
- Desktop and 390px mobile layouts reviewed visually. Chapter menus, page outlines,
  code copying and previous/next navigation exercised. No browser JavaScript errors.
- Browser automation needed explicit scrolling/focus for controls far down long
  chapters; the controls worked once targeted visibly. No site workaround added.

## Final gate findings

- Main runtime checks: 5,974 ordinary-storage passes, 6,041 canonical-storage passes,
  and Express 4 passes of 502 and 504. Total: 13,021 passing test executions.
  The ordinary run skips the canonical-only cursor cleanup case; canonical runs it.
- The first `npm run verify` invocation then failed lint on 15 import-style errors
  in eight example/check scripts. Consolidated duplicate imports and moved one
  static import above executable statements. No runtime behavior changed, so the
  full runtime suites were not repeated; lint passed separately.
- Production npm audit reported zero known vulnerabilities.
- Final packed contract: 165 files, 242 local documentation links, 29 runtime
  exports and 13 negative type checks; artifact hash
  `db627e12df190878a129568b44bcbbd0255f37a6`.
- The additional database runner repeats substantial conformance coverage per
  storage/backend, including SQLite overlap with the main gate. This broad matrix
  adds considerable time; it is not a second `npm run verify` invocation.

## Completed additional checks

- Full lint passed after the import-only fixes.
- Fresh tarball installation passed, including optional-peer-free core imports,
  missing Express diagnostics, freshly compiled SQLite dependency, and CRUD with
  ordinary/canonical storage. The earlier native-install timeout did not recur;
  the install ran after the large runtime suites, with no timeout changes.
- Database-runner SQLite selections passed: 4,530 ordinary and 4,599 canonical,
  with zero failures or skips. PostgreSQL ordinary passed 4,555 tests. MySQL
  passed 4,530 ordinary and 4,600 canonical tests. Redis passed 46 tests per mode.
- PostgreSQL and MySQL tutorial/migration checks passed in both storage modes.
  Runner failure/interruption/selection checks passed all 11 tests separately
  for PostgreSQL, MySQL and Redis. All executable documentation checks passed.

## Native-run timeout decision

Canonical PostgreSQL hit the former 900,000ms whole-selection limit while the
33,000-record include regressions and other files were still actively working.
No assertion failure was reported before the timeout; runner cleanup stopped the
server and removed its temporary environment.

- Full backend/storage runs now allow 30 minutes. Explicit file selections keep
  their existing 15-minute bound. No assertions or fixture sizes were weakened.
- Added `JSON_REST_API_RUNNER_STORAGE=knex|anyapi` so a failed backend/storage run
  can be retried without repeating already completed modes. Invalid values reject
  before creating an environment; focused regressions cover selection and cleanup.
- CI outer budgets now allow setup plus the complete bounded work: library 35,
  databases 75, clean package 30 minutes. These are ceilings, not additional jobs.
- Retry only canonical PostgreSQL, then continue MySQL, Redis and native example/
  cleanup checks. The 13,021-test main runtime suite is not repeated.

The focused runner selection/cleanup tests passed (11 tests). The canonical
PostgreSQL retry also reached its 30-minute limit while MySQL ran independently.
The report showed every started suite complete except `Concurrent transactions
on pg (anyapi)`, with no reported assertion failure. Rather than raise the limit
again or repeat the completed files, ran `conformance-transactions.test.js` and
all later conformance files, both database-schema files and the environment test
as an explicit canonical PostgreSQL selection. All 397 tests passed in 69 seconds;
the transaction suite completed normally. This establishes coverage across the
partial run and successful remaining selection, not a successful single full
PostgreSQL canonical command. Concurrent full database runs were too costly on
this machine; run backend selections sequentially here in future.

The contributor guide documents the runner controls, so its packed Markdown
changed. Final lint, packed contents/types/links, documentation build and all
39 generated pages' local links passed again. The final artifact is
`db627e12df190878a129568b44bcbbd0255f37a6`; fresh native installation passed for
`4436d4133be83a0e48abed66c80b14249971a874` before the contributor prose update.
Runtime files, declarations and the manifest are unchanged between those artifacts.
No fresh native compilation or comprehensive main suite was repeated for prose.

## Release boundary

No consumer repositories, seeds, publishing, tags or remote pushes were changed.
Positioning remains experimental with documented concurrency limits; the S3
adapter remains a documented demo/mock, not an actual upload implementation.
This verification does not remove those limits. Development history and this
review stay in `old/`, outside the published package.
