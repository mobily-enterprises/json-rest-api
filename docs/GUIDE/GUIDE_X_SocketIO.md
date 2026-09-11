# Socket.IO change notifications

`SocketIOPlugin` sends `subscription.update` messages after resource changes.
Messages identify a changed resource; clients fetch records through the resource
API using their own fields, includes and authorization context.

## Runnable public example

This example deliberately exposes a public countries resource. It uses a local
in-memory database and accepts anonymous subscriptions.

```js
import { Api } from 'hooked-api'
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin, SocketIOPlugin } from 'json-rest-api'
import { createServer } from 'node:http'
import express from 'express'
import knex from 'knex'

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
})
const api = new Api({ name: 'socket-example' })
const app = express()
await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex: db })
await api.use(ExpressPlugin, { mountPath: '/api' })
await api.use(SocketIOPlugin, { subscriptions: { maxPerSocket: 20 } })
await api.addResource('countries', {
  schema: { id: { type: 'id' }, name: { type: 'string', required: true, search: true } }
})
await api.resources.countries.createKnexTable()
api.http.express.mount(app)
const server = createServer(app)
await api.startSocketServer(server)
server.listen(3000)
```

Install `socket.io` in the server application and `socket.io-client` in the
client. Close the Socket.IO server and database during application shutdown:

```js
await new Promise(resolve => api.io.close(resolve))
await db.destroy()
```

Socket.IO closes the HTTP server passed to `startSocketServer`. Closing that
server also initiates graceful shutdown of the Redis clients created by the
plugin and clears `api.io` and its internal server/client references. Database
ownership remains with the application; ordinary resource calls still work
after Socket.IO shuts down. Do not separately quit those plugin-created Redis
clients after closing Socket.IO.

Only one Socket.IO startup may be active per API instance. Overlapping or
duplicate starts reject instead of replacing the active server. With Redis
enabled, both connections must succeed before Socket.IO attaches to the HTTP
server. Failed Redis startup closes partial connections, preserves the caller's
HTTP listeners and authentication configuration, and permits a subsequent retry.
Redis's configured reconnection policy is retained; set
`redis.socket.reconnectStrategy: false` when startup should fail on its first
connection error rather than retry.

The Socket.IO path defaults to the HTTP connector mount path plus `/socket.io`,
or `/socket.io` without a connector. Override it with
`startSocketServer(server, { path: '/events/socket.io' })`. HTTP resource routes
continue to use their configured API prefix.

## Subscribe and fetch

After the connection is established:

```js
import { io } from 'socket.io-client'

const socket = io('http://localhost:3000', { path: '/api/socket.io' })
socket.on('connect', async () => {
  const result = await socket.timeout(5000).emitWithAck('subscribe', {
    resource: 'countries',
    subscriptionId: 'country-list',
    filters: { name: 'Australia' }
  })
  if (result.error) console.error(result.error)
})
socket.on('subscription.update', change => {
  // Invalidate the affected view, then fetch through your normal API client.
  console.log(change.resource, change.id, change.action)
})
```

Subscription input accepts these fields:

| Field | Meaning |
| --- | --- |
| `resource` | Required declared resource name |
| `subscriptionId` | Optional nonempty string; omitted IDs are generated UUIDs |
| `filters` | Optional object validated with the resource's search schema |

An acknowledgement is either `{ success: true, data }` or `{ error: { code,
message } }`. Successful data contains `subscriptionId`, `resource`, normalized
`filters` and `status: 'active'`. Without an acknowledgement callback, subscribe
emits `subscription.created` or `subscription.error` instead.

`include` and `fields` are not subscription options: notifications never return
full records. Keep those options in the client's subsequent GET/query. Unknown
options receive `UNSUPPORTED_OPTION`; malformed filter containers receive
`INVALID_FILTERS` instead of becoming unfiltered subscriptions.

IDs must be unique among the socket's active subscriptions. Reusing one returns
`SUBSCRIPTION_EXISTS`; unsubscribe before replacing it. The default limit is
100 active subscriptions per socket, controlled by `subscriptions.maxPerSocket`.
Concurrent async admission hooks cannot exceed the configured limit.

To remove a subscription:

```js
await socket.timeout(5000).emitWithAck('unsubscribe', { subscriptionId: 'country-list' })
```

The connection stays subscribed to a resource while it has other subscriptions
for that resource. Every matching subscription receives its own update, with its
own subscription ID.

Unsubscribe removes the logical subscription immediately and waits for any
required room departure before acknowledging success. Room joins and departures
are ordered per socket, so a concurrent new subscription retains its membership.
If the adapter rejects departure, the acknowledgement contains `UNSUBSCRIBE_ERROR`;
the logical subscription remains removed and cannot receive notifications. The
failure does not imply that adapter room cleanup succeeded. A later subscription
can join normally; disconnect also ends the socket's room membership.

After reconnecting, submit the desired subscriptions again:

```js
const result = await socket.timeout(5000).emitWithAck('restore-subscriptions', {
  subscriptions: [{ resource: 'countries', subscriptionId: 'country-list' }]
})
// result.restored contains successful IDs; result.failed contains per-entry errors.
```

Restoration uses the same validation, permission, uniqueness and limit checks as
subscribe. It does not replay changes missed during disconnection.

## Notification shape

```json
{
  "type": "resource.updated",
  "resource": "countries",
  "id": "42",
  "action": "patch",
  "subscriptionId": "country-list",
  "meta": { "timestamp": "2026-09-09T00:00:00.000Z" }
}
```

| Change | `type` | `action` |
| --- | --- | --- |
| POST or PUT-create | `resource.created` | `post` or `put` |
| PATCH or PUT replacement | `resource.updated` | `patch` or `put` |
| Relationship POST/PATCH/DELETE | `resource.updated` | `patch` |
| Resource DELETE | `resource.deleted` | `delete` |

IDs are strings. Deletion also includes `deletedRecord: { id }`, without deleted
attributes. Reverse relationship changes notify the parent and the changed
child resources. A relationship PATCH's nested resource PATCH provides its
parent update; it is not emitted a second time by the outer relationship hook.

Eligibility uses the resource's ordinary SQL query before and after each write,
inside that write's transaction. The changed ID is constrained internally; it
need not be a public search field, and a client's ID filter cannot replace it.
A record entering or leaving the query result invalidates that subscription.
Deletion uses the before-write result. Custom `applyFilter(query, value)` search
fields work directly; remove any Socket.IO-only `filterRecord` callback. There
is no separate JavaScript predicate to maintain.

These queries run normal query permissions, hooks, filters, row policies and
autofilters. They use subscriber context, never the writer's context. Query
failures are logged and count as nonmatches; a successful match before or after
is sufficient. Applications should account for these additional queries and
ensure query hooks can run inside the write transaction.

## Authentication and permissions

For an application with authenticated users, install the plugin with a
server-owned authentication function:

```js
await api.use(SocketIOPlugin, {
  auth: {
    requireAuth: true,
    authenticate: async ({ socket }) => {
      const identity = await verifyToken(socket.handshake.auth?.token)
      return { userId: identity.id, roles: identity.roles, workspaceId: identity.workspaceId, groups: identity.groups }
    }
  }
})
```

`verifyToken` is application code. A failed authentication rejects the connection.
Handshake fields do not become trusted identity unless the application explicitly
enables `allowClientProvidedAuth`; the default is false. `anonymousContext` can
supply a deliberate public context. `onAuthenticationFailed` can observe a
failure; an error from that observer does not authorize the connection.

Resource query permission is checked when subscribing and again before each
notification. A failing notification permission check suppresses that message
and is logged. It does not undo the committed write. Authentication is performed
when connecting, so applications that revoke sessions must also invalidate or
disconnect their active sockets as appropriate.

A `subscriptionFilters` hook can add filters and set trusted query context.
Populate the same application context your row policies and autofilters need.
Hook arguments use hooked-api's normal context envelope:

```js
await api.customize({ hooks: {
  subscriptionFilters: {
    functionName: 'limit-subscriptions',
    handler: ({ context }) => {
      const { subscription, auth } = context
      subscription.context = {
        scopeValues: { workspaceId: auth.workspaceId },
        visibility: { groups: auth.groups }
      }
    }
  }
} })
```

The context property defaults to `{}` and must be an object. It is supplied to
both admission and notification query permission checks; `auth` always comes
from the stored subscription identity. Use JSON-serializable context for Redis
adapter transport. Clients cannot supply `context` in subscribe/restore messages.
The resulting filters are validated again, and the hook cannot change the
resource or subscription ID. Replacing a subscription with the same public ID
creates a new generation: it receives subsequent changes only, not messages
queued for the removed subscription.

Admission failures are logged with `operation: 'subscribe'`, `phase: 'admission'`
and the resolved `scopeName`, including individual failures while restoring
subscriptions. After resolving a resource, the diagnostic formatter redacts
structured fields marked `hidden` or `normallyHidden` in that resource's schema.
Unknown resources have no resource-specific field policy. Diagnostic formatting
does not mutate the original error, and a failed log sink does not replace the
subscription rejection. This does not redact secrets embedded in arbitrary
error-message text; avoid putting secret values in messages.

## Transactions, Redis and verification limits

For individual resource and relationship operations, notifications wait for
commit of the library-owned transaction. Writes that roll back,
including finish-hook failures after events were queued, emit no successful
change. A rejected call after commit can still have emitted notifications. These paths are tested on both SQLite storage modes over WebSocket and
HTTP polling, including relationship changes and child rollback.

Library writes now require the handle from `api.transaction` when joining an
outer unit. Resource and atomic-bulk child completion hooks run after confirmed
owner completion; non-atomic bulk retains one outcome per entry. Rolled-back
units do not flush queued notifications. Explicit callbacks are tested with
repeated changes to the same record, callback/caught-write/caught-SQL failures,
and rejected completion hooks on both storage modes and all three databases.
Direct raw transaction completion is no longer a supported library-write
notification path. Consumer migration and the broader B2 audit remain unfinished.

Notifications are per-operation invalidations. A sequential create, update and
delete in one committed callback emits those three notices in order, even though
the final row is absent. Several updates to one row are not coalesced. No notice
is emitted while the callback remains pending. The helper awaits completion
hooks; after a confirmed commit, a completion error cannot undo stored changes
or notifications already emitted. A later operation's completion chain can flush
the transaction's queue if an earlier chain failed before delivery. This does
not guarantee delivery when every applicable chain is interrupted or the
connection fails.

Once queue draining begins, failure while delivering one queued notice does not
prevent attempts for later notices. The call rejects with the first delivery
failure and a committed outcome; it does not roll back stored data. The context
of the operation draining the queue retains each failed attempt as
`{ phase: 'socketioBroadcast', broadcastIndex, error }`, where `broadcastIndex`
is zero-based in that transaction's captured queue. Keep that operation context
when you need these diagnostics, just as for file cleanup diagnostics.

The queue is consumed once. Failed notices are not automatically replayed by
later completion chains. One notice can fail after delivery to some recipients;
the plugin cannot establish who received it or undo those deliveries. Clients
must be able to refetch authoritative data. Continuing with later notices is a
best-effort attempt, not a delivery acknowledgement or durable retry mechanism.

With overlapping writes, notification order follows their capture in the
Socket.IO finish hook, which can differ from call-start order. Completion hook
chains follow transaction enlistment order (reverse order on rollback). Await
writes sequentially when their ordering matters to the application.

Socket.IO preserves message ordering but does not provide durable delivery by
default. Clients can miss notifications while disconnected; refetch on reconnect.
See [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).

Optional Redis setup accepts the options used by Redis's `createClient`, for
example `startSocketServer(server, { redis: { url: 'redis://localhost:6379' } })`.
Install `redis` and `@socket.io/redis-adapter` when using it. Subscription state
survives the JSON encoding used by the adapter's `fetchSockets` responses.
The real Redis tests (source checkout: `docs/development/real-redis.md`) exercise two Socket.IO servers
sharing SQLite, in both storage modes, over polling and WebSocket. They cover
committed CRUD and relationship notifications, row visibility, rollback and
replacement of queued subscriptions. Further cases drop each publisher/subscriber
connection on each server and verify delivery after reconnection. Startup tests
cover bad credentials, missing sockets, exhausted retries, partial connection
failure, preserved authentication and overlapping starts. Shutdown tests cover
Socket.IO close, HTTP close and close during Redis reconnection.

These tests do not establish durable delivery during an outage, Redis Cluster
or Sentinel failover, or bounded cleanup when a network connection remains open
but never answers. Redis shutdown drains queued commands; connection and retry
timeouts remain part of the supplied Redis configuration.

Socket.IO transport CORS is configured separately through
`startSocketServer(server, { cors: ... })` or `transport.cors` in plugin options.
It does not replace the HTTP [CORS plugin](GUIDE_X_Cors.md) or authentication.
