---
title: Guide
---

# JSON REST API guide

Use JSON REST API as a mini-ORM through resource methods, or expose the same
resources over HTTP. Start with chapters 01–04, then follow the relationship
tutorials or jump to the contract you need. Each runnable chapter uses a fresh
database unless it explicitly says otherwise.

Upgrading an application? Start with [33. Migrating to v2](33-migrating-to-v2.md).
Before choosing storage, read [30. Backend capabilities and limits](30-backend-capabilities.md).

The examples require Node.js 24 or newer and familiarity with JavaScript and npm.
Development verification targets Node 24.


## Getting started

- [01. Getting started](01-getting-started.md)
- [02. Resources and relationships](02-resources-and-relationships.md)
- [03. Running example](03-running-example.md)
- [04. Creating and querying records](04-creating-and-querying.md)

## Relationships and queries

- [05. Belongs-to relationships](05-belongs-to.md)
- [06. Has-many relationships](06-has-many.md)
- [07. Polymorphic relationships](07-polymorphic-relationships.md)
- [08. Many-to-many relationships](08-many-to-many.md)
- [09. Pagination and sorting](09-pagination-and-sorting.md)
- [10. PUT and PATCH](10-put-and-patch.md)
- [11. Relationship endpoints](11-relationship-endpoints.md)

## Resource behavior

- [12. Field transformations](12-field-transformations.md)
- [13. Hooks and lifecycle](13-hooks-and-lifecycle.md)
- [14. Custom resource methods](14-custom-resource-methods.md)
- [15. Query projections](15-query-projections.md)
- [16. Autofiltering](16-autofiltering.md)
- [17. Row policies](17-row-policies.md)
- [18. Labels](18-labels.md)

## Transactions and schema

- [19. Managed transactions](19-managed-transactions.md)
- [20. Transaction outcomes](20-transaction-outcomes.md)
- [21. Schema and migrations](21-schema-and-migrations.md)
- [22. Version-field migrations](22-version-field-migrations.md)

## Transports and extensions

- [23. Fastify integration](23-fastify.md)
- [24. CORS](24-cors.md)
- [25. URL management](25-url-management.md)
- [26. File uploads](26-file-uploads.md)
- [27. Bulk operations](27-bulk-operations.md)
- [28. Socket.IO integration](28-socketio.md)
- [29. Writing plugins](29-writing-plugins.md)

## Limits and migration

- [30. Backend capabilities and limits](30-backend-capabilities.md)
- [31. Positioning (experimental)](31-positioning.md)
- [32. Date and time](32-date-and-time.md)
- [33. Migrating to v2](33-migrating-to-v2.md)
