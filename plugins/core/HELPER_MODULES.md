
# Diagram of helpers and their dependencies

  ┌─────────────────────────────┐     ┌──────────────────────────────┐
  │  knex-field-helpers.js      │     │  knex-query-helpers-base.js  │
  │                             │     │                              │
  │  • getForeignKeyFields()    │     │  • buildQuerySelection()     │
  │  • buildFieldSelection()    │     │                              │
  │                             │     │  (no dependencies)           │
  │  (no dependencies)          │     └──────────────────────────────┘
  └──────────────┬──────────────┘
                 │
                 ├─────────────────────┬────────────────────┐
                 ↓                     ↓                    ↓
  ┌──────────────────────────┐  ┌─────────────────────┐  ┌───────────────────────┐
  │ knex-json-api-           │  │ knex-relationship-  │  │ knex-process-         │
  │ transformers.js          │  │ includes.js         │  │ includes.js           │
  │                          │  │                     │  │                       │
  │ • toJsonApi()            │  │ • createRelationship│  │ • processIncludes()   │
  │ • buildJsonApiResponse() │  │   IncludeHelpers()  │--│                       │
  │ • processBelongsTo       │  │                     │  │ imports from:         │
  │   Relationships()        │  │ imports from:       │  │ • knex-field-helpers  │
  │                          │  │ • knex-field-helpers│  │ • knex-relationship-  │
  │ imports from:            │  │                     │  │   includes            │
  │ • knex-field-helpers     │  └─────────────────────┘  └───────────┬───────────┘
  └──────────────────────────┘                                       │
                                                                     │
                                ┌────────────────────────────────────┘
                                ↓
                       ┌────────────────────────┐
                       │ rest-api-knex-plugin.js│
                       │                        │
                       │ imports from ALL:      │
                       │ • knex-field-helpers   │
                       │ • knex-query-helpers-  │
                       │   base                 │
                       │ • knex-json-api-       │
                       │   transformers         │
                       │ • knex-process-includes│
                       │ • knex-relationship-   │
                       │   includes             │
                       └────────────────────────┘

  Key Points:

  1. Two leaf modules (no dependencies): knex-field-helpers.js and knex-query-helpers-base.js
  2. Three modules depend on knex-field-helpers.js
  3. One module (knex-process-includes.js) depends on both knex-field-helpers.js and
  knex-relationship-includes.js
  4. No circular dependencies - all arrows flow in one direction
  5. The main plugin imports from all modules as needed
