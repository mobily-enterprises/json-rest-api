# Real Redis notification verification

`npm run test:redis` starts a disposable Redis server, then runs
`tests/integration/socketio-lifecycle.test.js` and
`tests/integration/socketio-redis.test.js` with regular and canonical SQLite
storage. Each notification suite creates two actual Socket.IO/Express servers
using the same application database; lifecycle suites inspect one server and its
owned Redis clients. Clients connect through WebSocket or HTTP polling, and
notifications between the servers travel through Redis Pub/Sub.

The suite checks CRUD in both directions, exact notification counts, trusted
workspace context, row-policy visibility, rows leaving a result, rollback,
all three relationship write methods and replacement of a queued subscription.
Non-atomic bulk POST/PATCH/DELETE also run in both directions and transports:
first and last entries commit and notify the other server, while a rejected
middle entry produces no event even when its rollback cleanup hook also fails.
The batch context retains the indexed secondary failure and stored rows match
the committed changes.
It also drops each Redis publisher/subscriber connection on each server and
verifies notification delivery after the real client reconnects and resubscribes.
Negative assertions use a Redis inter-server acknowledgement followed by client
acknowledgements; they do not rely on a timed sleep after publishing.

Eight lifecycle cases per storage mode verify missing sockets, rejected
credentials, one connected client followed by failure of its partner, exhausted
retries, unchanged HTTP/auth state on failed startup, retry after failure,
overlapping/duplicate starts, normal HTTP/Socket.IO shutdown and shutdown during
reconnection. Redis CLIENT LIST verifies connection cleanup before fixture
cleanup; resource calls still work after Socket.IO closes. Redis test files run
serially because they share one Pub/Sub namespace; the two-server notification
cases still exercise concurrent server/client connections.

## Run locally

Use the repository's Node version and `npm ci`. Set
`JSON_REST_API_REDIS_BIN` to a Redis server executable, or put `redis-server` on
PATH. The locked development dependencies already include the Redis client and
Socket.IO adapter.

```sh
npm run test:redis
JSON_REST_API_RUNNER_DATABASE=redis node --test tests/database-runner.test.js
```

The existing database runner supplies process tracking, failure handling,
timeouts and teardown. Redis listens only on a private Unix socket, with
persistence disabled. Readiness requires both PING and server-version responses.
Its data directory and process are removed after success, failure or interruption.
The second command executes eight permanent failure/cleanup cases, including
missing binaries, an absent test file and a mismatched fixture driver.

On Ubuntu 24.04, binaries can be extracted without installing a system service:

```sh
JRA_REDIS_BINARIES=$(mktemp -d)
(
  cd "$JRA_REDIS_BINARIES"
  apt-get download redis-server redis-tools liblzf1 libjemalloc2
  for package in ./*.deb; do
    dpkg-deb --extract "$package" "$JRA_REDIS_BINARIES/root"
  done
)
export JSON_REST_API_REDIS_BIN="$JRA_REDIS_BINARIES/root/usr/bin/redis-server"
export LD_LIBRARY_PATH="$JRA_REDIS_BINARIES/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
npm run test:redis
```

Remove that temporary binary directory when finished. The runner owns its server
data directory separately. Missing services fail this command rather than skip
tests. An intentionally omitted local Redis environment should be recorded as
**not run**, with its reason.

## Scope and remaining checks

Local execution currently uses Redis 7.0.15, Socket.IO 4.8.1 and Redis adapter
8.3.0. It verifies two API instances in one Node process and real Redis message
exchange, with SQLite as their application database. PostgreSQL/MySQL behavior
is tested separately by the SQL matrix. This is not a Redis Cluster, Sentinel
failover, load-balancer or durable-delivery test. Configured client reconnection
and the listed startup/shutdown paths are exercised; an unresponsive open network
connection and forced process termination remain outside these cases.

Redis verification is separate from `npm run verify` and the SQL runner's `all`
selection. The required CI matrix includes one Redis job on Node 24; Node 22 and
Node 26 are outside the current verification policy. The suite has 92 cases
across both storage modes: 76 notification and
reconnection cases plus 16 lifecycle cases. The separate runner suite has eight
failure/interruption cases. Exact executed results are recorded in the evidence
log. The workflow was checked with actionlint locally; no remote CI run is claimed.
See the [Socket.IO Redis adapter documentation](https://socket.io/docs/v4/redis-adapter/)
for the adapter's delivery and deployment contract, and the
[verification record](verification-progress.md) for executed results.
