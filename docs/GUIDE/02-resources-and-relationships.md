---
title: "Resources and relationships"
chapter: 2
chapter_label: "02"
---

# 02. Resources and relationships

These tutorials cover resource CRUD, relationship linkage and related-record
queries. Use the same public relationship names in plain input and JSON:API
relationships; backing foreign-key columns are storage details.

Each runnable scenario starts from a fresh database unless it explicitly says
otherwise. Do not concatenate different chapters' resource declarations into
one API: several deliberately reuse the same resource names.

| Tutorial | What it demonstrates |
| --- | --- |
| [Starting point](03-running-example.md) | API, database and Express setup. |
| [Manipulating and searching tables](04-creating-and-querying.md) | CRUD, declared filters, custom search and sparse fields. |
| [Belongs-to relationships](05-belongs-to.md) | Public relationship input, linkage, includes, filtering and clearing. |
| [Has-many relationships](06-has-many.md) | Reverse membership, includes, related queries, attachment and removal. |
| [Polymorphic relationships](07-polymorphic-relationships.md) | Typed identifiers, distinct resources sharing an ID, includes and search. |
| [Many-to-many relationships](08-many-to-many.md) | Membership and ordinary pivot metadata, with canonical-storage distinctions. |
| [Pagination and ordering](09-pagination-and-sorting.md) | Default caps, numbered/cursor pages, sorting and sparse results. |
| [PUT and PATCH](10-put-and-patch.md) | Explicit replacement, omitted-value rejection and relationship-object boundaries. |
| [Relationship URLs](11-relationship-endpoints.md) | Identifier linkage versus related records, and relationship mutation endpoints. |

For query projections and their SQL ordering, use
[Query Projections](15-query-projections.md). For mandatory visibility before
counts and pagination, use [Row Policies](17-row-policies.md) or
[Autofiltering](16-autofiltering.md), according to the required policy.
See [backend capabilities](30-backend-capabilities.md) for database differences.
