
# Diagram of helpers and their dependencies

## Refactoring Pattern

All helper functions have been refactored to use a consistent `(scope, deps)` signature:

**Before:**
```javascript
function helperFunction(param1, param2, param3, param4, param5) {
  // Many individual parameters
}
```

**After:**
```javascript
function helperFunction(scope, deps) {
  // Extract from scope (resource-specific data)
  const { vars: { schemaInfo } } = scope;
  
  // Extract from deps (dependencies and context)
  const { api, context, transaction } = deps;
  const { scopeName, queryParams } = context;
}
```

This pattern reduces parameters by 50-70% and provides clear separation between:
- **scope**: Resource configuration and schema information
- **deps**: Dependencies (api, knex) and request context

## Pure Utility Functions (utils/ directory)

### utils/field-utils.js
```
┌─────────────────────────────┐
│   getForeignKeyFields()     │ - Extracts foreign key fields from schema
│   (schema)                  │ - Identifies belongsTo relationships  
│                             │ - Returns: Set(['author_id', ...])
└─────────────────────────────┘

┌─────────────────────────────┐
│  filterAttributeFields()    │ - Filters out foreign keys & internals
│  (attributes,               │ - Removes polymorphic fields
│   foreignKeyFields,         │ - Returns: cleaned attributes object
│   polymorphicFields)        │
└─────────────────────────────┘
```

### utils/knex-query-helpers-base.js
```
┌─────────────────────────────┐
│    parseIncludeTree()       │ - Parses include parameter string
│    (includeParam)           │ - Converts "author,comments.user"
│                             │ - Returns: nested object tree
└─────────────────────────────┘
```

## Functions with (scope, deps) Pattern (lib/ directory)

### lib/knex-json-api-helpers.js
```
┌─────────────────────────────┐
│      toJsonApi()            │ - Converts DB record to JSON:API format
│  (scope, record, deps)      │ - Filters out foreign keys
│                             │ - Returns: {type, id, attributes}
│  deps.context: {            │
│    scopeName,               │
│    schemaInfo,              │
│    polymorphicFields        │
│  }                          │
└─────────────────────────────┘
```

### lib/knex-relationship-includes.js  
```
┌─────────────────────────────┐
│  groupByPolymorphicType()   │ - Groups records by polymorphic type
│  (records, typeField,       │ - Used for batch loading
│   idField)                  │ - Returns: {type: [ids...]}
└─────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────┐
│                     buildIncludedResources()                    │
│ (scope, records, deps)                                          │
│                                                                 │
│ Main entry point - orchestrates the include loading process     │
│                                                                 │
│ deps: {                                                         │
│   includeParam, fields, included, processedPaths                │
│ }                                                               │
│                                                                 │
│ 1. Parses includes ──────────────┐                              │
│                                  ▼                              │
│ 2. Calls processIncludes ─────► processIncludes()               │
│                                                                 │
│ 3. Returns: {included: [...], recordsWithRelationships: [...]}  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────┐
│                        processIncludes()                       │
│ (scope, records, deps)                                         │
│                                                                │
│ Recursive function that examines schema and calls loaders      │
│                                                                │
│ deps: {                                                        │
│   includeTree, included, processedPaths, currentPath, fields   │
│ }                                                              │
│                                                                │
│ Dispatches to: ─────────────────┬───────────────┬──────────────┤
└─────────────────────────────────┴───────────────┴──────────────┘
                    │                     │                │
                    ▼                     ▼                ▼
┌───────────────────────────┐ ┌─────────────────────┐ ┌──────────────────────────┐
│     loadBelongsTo()       │ │    loadHasMany()    │ │ loadPolymorphicBelongsTo │
│ (scope, records, deps)    │ │ (scope, records,    │ │ (scope, records, deps)   │
│                           │ │  deps)              │ │                          │
│ deps: {                   │ │                     │ │ deps: {                  │
│   fieldName, fieldDef,    │ │ deps: {             │ │   relName, relDef,       │
│   includeName,            │ │   includeName,      │ │   subIncludes, included, │
│   subIncludes, included,  │ │   relDef,           │ │   processedPaths,        │
│   processedPaths,         │ │   subIncludes,      │ │   currentPath, fields    │
│   currentPath, fields     │ │   included,         │ │ }                        │
│ }                         │ │   processedPaths,   │ │                          │
│                           │ │   currentPath,      │ │ Loads polymorphic        │
│ Loads many-to-one         │ │   fields            │ │ e.g. comment→(article    │
│ e.g. comment→article      │ │ }                   │ │      or video)           │
│                           │ │                     │ │                          │
│ ┌─────────────────┐       │ │ Loads one-to-many   │ │ ┌──────────────────┐     │
│ │ Recursively     │       │ │ or many-to-many     │ │ │ Recursively      │     │
│ │ calls           │◄──────┼─┤ e.g. article→       │ │ │ calls            │◄────┤
│ │ processIncludes │       │ │      comments       │ │ │ processIncludes  │     │
│ └─────────────────┘       │ │                     │ │ └──────────────────┘     │
└───────────────────────────┘ │ ┌─────────────────┐ │ └──────────────────────────┘
                              │ │ Recursively     │ │
                              │ │ calls           │◄┤
                              │ │ processIncludes │ │           Also dispatches to:
                              │ └─────────────────┘ │                    │
                              └─────────────────────┘                    ▼
                                                      ┌──────────────────────────┐
                                                      │ loadReversePolymorphic() │
                                                      │ (scope, records, deps)   │
                                                      │                          │
                                                      │ deps: {                  │
                                                      │   includeName, relDef,   │
                                                      │   subIncludes, included, │
                                                      │   processedPaths,        │
                                                      │   currentPath, fields    │
                                                      │ }                        │
                                                      │                          │
                                                      │ Loads via relationships  │
                                                      │ e.g. article→comments    │
                                                      │      (via commentable)   │
                                                      │                          │
                                                      │ ┌──────────────────┐     │
                                                      │ │ Recursively      │     │
                                                      │ │ calls            │◄────┤
                                                      │ │ processIncludes  │     │
                                                      │ └──────────────────┘     │
                                                      └──────────────────────────┘
```

### lib/simplified-helpers.js
```
┌─────────────────────────────────────────────────────────────────┐
│              transformSimplifiedToJsonApi()                     │
│ (scope, deps)                                                   │
│                                                                 │
│ Converts plain objects to JSON:API format                       │
│ - Handles both foreign key names and 'as' aliases               │
│ - Converts relationships to proper JSON:API structure            │
│                                                                 │
│ scope: { inputRecord }                                          │
│ deps.context: { scopeName, schemaStructure, schemaRelationships }│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│             transformJsonApiToSimplified()                      │
│ (scope, deps)                                                   │
│                                                                 │
│ Converts JSON:API responses to plain objects                    │
│ - Restores foreign keys from relationships                      │
│ - Handles both single resources and collections                  │
│                                                                 │
│ scope: { record }                                               │
│ deps.context: { schemaStructure, schemaRelationships }          │
└─────────────────────────────────────────────────────────────────┘
```

### lib/many-to-many-manipulations.js
```
┌─────────────────────────────────────────────────────────────────┐
│           updateManyToManyRelationship()                        │
│ (scope, deps)                                                   │
│                                                                 │
│ Intelligently syncs many-to-many relationships                  │
│ - Preserves existing pivot data                                 │
│ - Only creates/deletes changed relationships                    │
│                                                                 │
│ deps.context: {                                                 │
│   resourceId, relDef, relData, transaction                      │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### lib/relationship-processor.js
```
┌─────────────────────────────────────────────────────────────────┐
│              processRelationships()                             │
│ (scope, deps)                                                   │
│                                                                 │
│ Extracts relationship data from JSON:API payloads               │
│ - Converts belongsTo to foreign keys                            │
│ - Handles polymorphic relationships                             │
│ - Prepares many-to-many operations                              │
│                                                                 │
│ deps.context: { inputRecord }                                   │
│ Returns: { belongsToUpdates, manyToManyRelationships }          │
└─────────────────────────────────────────────────────────────────┘
```

## Module: lib/knex-process-includes.js

```
┌─────────────────────────────────────────────────────────────────┐
│                      processIncludes()                          │
│ (records, scopeName, queryParams, transaction, dependencies)    │
│                                                                 │
│ High-level orchestrator that:                                   │
│ 1. Extracts scopes, log, knex from dependencies                 │
│ 2. Uses transaction if provided, otherwise uses knex            │
│ 3. Calls buildIncludedResources with all parameters             │
│ 4. Returns just the included array                              │
│                                                                 │
│ Called by: REST API plugin dataGet/dataQuery methods            │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow:
```
REST API Plugin
    │
    ├─► processIncludes (lib/knex-process-includes.js)
    │       │
    │       └─► buildIncludedResources (lib/knex-relationship-includes.js)
    │               │
    │               ├─► Uses pure utilities:
    │               │   - parseIncludeTree (utils/knex-query-helpers-base.js)
    │               │   - getForeignKeyFields (utils/field-utils.js)
    │               │
    │               └─► processIncludes (recursive orchestrator)
    │                       │
    │                       ├─► loadBelongsTo
    │                       ├─► loadHasMany
    │                       ├─► loadPolymorphicBelongsTo
    │                       └─► loadReversePolymorphic
    │                             │
    │                             └─► All loaders use:
    │                                 - toJsonApi (lib/knex-json-api-helpers.js)
    │                                 - groupByPolymorphicType (lib/knex-relationship-includes.js)
    │
    └─► Returns: Array of included resources in JSON:API format
```

## File Organization:

### Pure Utilities (utils/ directory)
- `field-utils.js` - Schema field inspection utilities
- `knex-query-helpers-base.js` - Query parsing utilities
- `knex-constants.js` - Shared constants
- `connectors-query-parser.js` - Connector query parsing

### Scoped Functions (lib/ directory) 
- `knex-json-api-helpers.js` - JSON:API transformation with (scope, deps)
- `knex-relationship-includes.js` - Relationship loading with (scope, deps)
- `knex-process-includes.js` - Top-level orchestrator
- `knex-field-helpers.js` - Field selection and filtering with (scope, deps)
- `knex-window-queries.js` - Window query builders
- `simplified-helpers.js` - Simplified/JSON:API transformations with (scope, deps)
- `many-to-many-manipulations.js` - Many-to-many relationship updates with (scope, deps)
- `relationship-processor.js` - Relationship processing with (scope, deps)
- `compile-schemas.js` - Schema compilation with (scope, deps)
- `default-data-helpers.js` - Default data helper creation
