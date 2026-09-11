# Data and relations

These tutorials cover resource CRUD, relationship linkage and related-record
queries. Use the same public relationship names in plain input and JSON:API
relationships; backing foreign-key columns are storage details.

Each runnable scenario starts from a fresh database unless it explicitly says
otherwise. Do not concatenate different chapters' resource declarations into
one API: several deliberately reuse the same resource names.

| Tutorial | What it demonstrates |
| --- | --- |
| [Starting point](GUIDE_2_1_The_Starting_Point.md) | API, database and Express setup. |
| [Manipulating and searching tables](GUIDE_2_2_Manipulating_And_Searching_Tables.md) | CRUD, declared filters, custom search and sparse fields. |
| [Belongs-to relationships](GUIDE_2_3_BelongsTo_Relationships.md) | Public relationship input, linkage, includes, filtering and clearing. |
| [Has-many relationships](GUIDE_2_4_HasMany_Records.md) | Reverse membership, includes, related queries, attachment and removal. |
| [Polymorphic relationships](GUIDE_2_5_HasMany_Polymorphic.md) | Typed identifiers, distinct resources sharing an ID, includes and search. |
| [Many-to-many relationships](GUIDE_2_6_Many_To_Many.md) | Membership and ordinary pivot metadata, with canonical-storage distinctions. |
| [Pagination and ordering](GUIDE_2_7_Pagination_And_Ordering.md) | Default caps, numbered/cursor pages, sorting and sparse results. |
| [PUT and PATCH](GUIDE_2_8_Effects_of_PUT_and_PATCH.md) | Explicit replacement, omitted-value rejection and relationship-object boundaries. |
| [Relationship URLs](GUIDE_2_9_Relationships_Urls.md) | Identifier linkage versus related records, and relationship mutation endpoints. |

For query projections and their SQL ordering, use
[Query Projections](GUIDE_X_Query_Projections.md). For mandatory visibility before
counts and pagination, use [Row Policies](GUIDE_X_Row_Policies.md) or
[Autofiltering](GUIDE_X_Autofiltering.md), according to the required policy.
See [backend capabilities](BACKEND_CAPABILITIES.md) for database differences.

[Back to Guide](index.md)
