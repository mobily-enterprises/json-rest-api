# Data and relations

The true power of json-rest-api lies in its sophisticated handling of relationships between resources. Unlike traditional ORMs that focus on object mapping, this library provides a fully JSON:API compliant REST interface that elegantly manages complex data relationships. This guide will walk you through defining datasets and explore all the possible relationship types available in the system.

This guide has been split into the following sections for easier navigation:

## [2.1 The starting point](./GUIDE_2_1_The_Starting_Point.md)
- Basic setup and configuration
- Creating the API instance
- Setting up the database connection

## [2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md)
- Setting up schemas
- Basic CRUD operations (POST, GET, PATCH, PUT)
- Search and filtering capabilities
- Multi-word search with AND logic
- Custom search functions
- Sparse fieldsets

## [2.3 `belongsTo` Relationships](./GUIDE_2_3_BelongsTo_Relationships.md)
- Understanding belongsTo relationships
- Including related records
- Sparse fieldsets with belongsTo relations
- Filtering by belongsTo relationships

## [2.4 hasMany records](./GUIDE_2_4_HasMany_Records.md)
- Understanding hasMany relationships
- Including hasMany records
- Filtering by hasMany relationships
- Cross-table searches

## [2.5 hasMany records (polymorphic)](./GUIDE_2_5_HasMany_Polymorphic.md)
- Understanding polymorphic relationships
- Including polymorphic records
- Forward and reverse polymorphic search
- Complex polymorphic filtering

## [2.6 Many to many (hasMany with through records)](./GUIDE_2_6_Many_To_Many.md)
- Understanding many-to-many relationships
- Working with pivot tables directly
- Including many-to-many records
- Search across many-to-many relationships

## [2.7 Pagination and ordering](./GUIDE_2_7_Pagination_And_Ordering.md)
- Offset-based vs cursor-based pagination
- Sorting and multi-field sorting
- Limits and ordering for included relationships
- Combining filters, sorting, pagination, and includes

## [2.8 Effects of PUT and PATCH](./GUIDE_2_8_Effects_of_PUT_and_PATCH.md)
- Understanding the difference between PUT and PATCH
- How PUT affects relationships (complete replacement)
- How PATCH affects relationships (partial updates)
- Managing belongsTo relationships
- Handling hasMany relationships
- Working with many-to-many relationships

## [2.9 Relationships URLs](./GUIDE_2_9_Relationships_Urls.md)
- Working with relationship endpoints
- Direct relationship manipulation
- Relationship links and meta information
- Managing relationship collections

---

[Back to Guide](./index.md)