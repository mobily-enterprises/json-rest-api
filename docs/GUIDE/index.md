# JSON REST API Complete Guide

Start with setup and the relationship tutorials, then use the contract pages
for response options, transactions and extension behavior. The working tree
contains breaking changes; read the [API migration guide](MIGRATING_API_V2.md)
before upgrading an existing application.

Start with [backend capabilities and limits](BACKEND_CAPABILITIES.md) when
choosing storage, planning a database migration or reviewing transaction and
file-storage guarantees.

The [managed transaction contract](managed-transactions.md) defines callback
ownership and completion; [transaction outcomes](transaction-outcomes.md)
defines failure states and retry/reconciliation rules. These are the authoritative
contract pages used by the API reference and migration guide.

## Table of Contents

### Core Chapters

1. **[Initial Setup](GUIDE_1_Initial_Setup.md)**
   Get started with JSON REST API, create your first API instance, and understand the basic concepts.

2. **[Data and Relations](GUIDE_2_Data_And_Relations.md)**
   Learn how to define resources, set up relationships, and work with your data model.

3. **[Field Transformations](GUIDE_3_Field_Transformations.md)**
   Transform data with virtual fields, getters, setters, computed fields, and visibility control.

4. **[Custom Data Sources](GUIDE_5_Non-Db_Resources.md)**
   Distinguish custom service methods from built-in SQL CRUD and the requirements of a new storage integration.

5. **[Positioning](GUIDE_6_Positioning.md)**
   Review position management and its documented limits; positioning work is currently paused.

6. **[Hooks, Data Management, and Plugins](GUIDE_7_Hooks_Data_Management_And_Plugins.md)**
   Use the verified hook names, context shapes, nested reads and completion boundaries.


### Additional Topics

- **[File Uploads](GUIDE_X_File_Uploads.md)**
  Handle file uploads with local storage and a mock S3-style demo adapter.

- **[Bulk Operations](GUIDE_X_Bulk_Operations.md)**
  Handle multiple records efficiently with bulk create, update, and delete operations.

- **[CORS Configuration](GUIDE_X_Cors.md)**
  Set up Cross-Origin Resource Sharing for browser-based applications.

- **[Autofiltering](GUIDE_X_Autofiltering.md)**
  Scope datasets automatically using configured context values, without baking in auth semantics.

- **[Row Policies](GUIDE_X_Row_Policies.md)**
  Apply mandatory server-side visibility predicates before pagination, counts, includes, and relationship loading.

- **[Knex Schema and Migrations](GUIDE_X_Knex_Schema_And_Migrations.md)**
  Create tables, inspect live table snapshots, and generate create or additive diff migrations from table-backed resource scopes.

- **[Query Projections](GUIDE_X_Query_Projections.md)**
  Use the optional query-projections plugin to add SQL-backed, output-only derived fields that can participate in sorting and cursor pagination.

- **[Writing Plugins](GUIDE_X_Writing_Plugins.md)**
  Build plugins against the supported extension surface, including hooks, scope methods, and query-only read fields.

- **[Fastify Integration](GUIDE_X_Fastify.md)**
  Register REST routes on Fastify and reject malformed write payloads at the transport layer using exported resource schemas.

- **[Socket.IO Integration](GUIDE_X_SocketIO.md)**
  Add real-time capabilities to your API with WebSocket support.

- **[URL Management](GUIDE_X_URL_Management.md)**
  Configure URL generation for proxies, CDNs, and multi-tenant scenarios.

- **[Date and Time](GUIDE_Y_Appendices.md)**
  Validate temporal input, normalize output and query date/time fields.

- **[Version-field Migration](version-field-migration.md)**
  Allocate and backfill revision fields before enabling conditional writes.

## Prerequisites

Before starting this guide, you should have:

- Node.js 24 or newer installed; verification targets Node 24 only
- Basic knowledge of JavaScript and REST APIs
- Familiarity with npm/yarn package management

---

Ready to get started? Head to [Chapter 1: Initial Setup](GUIDE_1_Initial_Setup.md) →
