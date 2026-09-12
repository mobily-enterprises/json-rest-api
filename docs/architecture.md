---
title: "Architecture"
---

# Architecture

The library exposes resource methods directly and uses connectors to translate
HTTP requests into those same calls. Storage and transaction rules are shared
between direct calls and transports.

## Runtime

`lib/runtime/json-rest-api.js` contains the API object and its sequential hook list.
It registers ordinary resource methods, installs plugins and constructs the argument
object passed to existing operation handlers. There are no proxy-based resource
objects, generic scope aliases or automatic dispatcher logs.

A resource inherits shared methods; its vars and helpers inherit API defaults.
Local properties override those defaults. The internal operation argument names
`scope`, `scopes` and `scopeName` refer to resources. The public collection is
`api.resources`.

## Resource operations and schemas

`plugins/core/rest-api-plugin.js` installs CRUD, relationship and transaction methods.
The operation handlers live in `plugins/core/rest-api-plugin-methods/`. They validate
requests, run permission/lifecycle hooks and call storage helpers.

Writes select plain input with `data` or JSON:API input with `document`.
`request-contracts.js` validates that selection; plain conversion produces the
normalized `context.inputRecord` used by the existing write lifecycle. `format`
controls output only. Both input forms run through the same resource operation,
including response preparation before transaction completion. Connectors submit
documents through this same boundary.

Hooks deliberately share mutable operation context for caches, added information
and phase-specific field changes. The caller observes those mutations. See the
[hook contract](GUIDE/13-hooks-and-lifecycle.md) for wrapper hooks, nested calls,
writable values and library-owned bookkeeping. Independent calls use separate
contexts; this is not an immutable-context API.

`plugins/core/lib/querying-writing/compile-schemas.js` compiles resource declarations.
Its neighboring modules own response options, field selection, ID normalization and
representation conversion. The JSON schema package remains a separate dependency;
it is unrelated to the removed hooked-api runtime.

## Storage

`rest-api-knex-plugin.js` maps resources to ordinary tables.
`rest-api-anyapi-knex-plugin.js` maps them to canonical records and relationship links.
Both use native Knex queries and the common storage interfaces under
`plugins/core/lib/storage/`.

Canonical links and relationship reads have separate modules under `lib/anyapi/`
within the core plugin. Include traversal and to-one/to-many loaders live under
`plugins/core/lib/querying/`. Keep query ownership and visibility checks in those
modules rather than duplicating them in connectors.

## Transactions and errors

`lib/error-context.js` owns managed transactions, participating operations,
completion hooks and write outcomes. `lib/knex-transaction.js` handles connection
completion. Resource methods delegate to these modules.

`lib/rest-api-errors.js` defines the local error hierarchy. The runtime preserves
thrown values; operation-level code attaches transaction outcomes and secondary
cleanup diagnostics. See the [transaction contract](GUIDE/19-managed-transactions.md)
and [error outcomes](GUIDE/20-transaction-outcomes.md).

## Transports and files

Express and Fastify connectors share parsing, route and response helpers under
`plugins/core/connectors/lib/`. Socket.IO remains an optional integration.
File handling owns upload lifetime; storage plugins under `plugins/storage/` own
file bytes. Their effects participate in the documented completion-hook lifecycle.
