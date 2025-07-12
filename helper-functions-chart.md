# JSON REST API Helper Functions Chart (After Refactoring)

## Module: knex-relationship-includes.js

### Pure Utility Functions (No dependencies)
```
┌─────────────────────────────┐
│      toJsonApi()            │ - Converts DB record to JSON:API format
│  (scopeName, record,        │ - Filters out foreign keys
│   schema, idProperty)       │ - Returns: {type, id, attributes}
└─────────────────────────────┘

┌─────────────────────────────┐
│  groupByPolymorphicType()   │ - Groups records by polymorphic type
│  (records, typeField,       │ - Used for batch loading
│   idField)                  │ - Returns: {type: [ids...]}
└─────────────────────────────┘

┌─────────────────────────────┐
│    parseIncludeTree()       │ - Parses include parameter string
│    (includeParam)           │ - Converts "author,comments.user"
│                             │ - Returns: nested object tree
└─────────────────────────────┘
```

### Functions with Dependencies (scopes, log, knex as first params)
```
┌─────────────────────────────────────────────────────────────────┐
│                     buildIncludedResources()                    │
│ (scopes, log, knex, records, scopeName, includeParam, fields)  │
│                                                                 │
│ Main entry point - orchestrates the include loading process     │
│                                                                 │
│ 1. Parses includes ──────────────┐                             │
│                                  ▼                              │
│ 2. Calls processIncludes ─────► processIncludes()              │
│                                                                 │
│ 3. Returns: {included: [...], recordsWithRelationships: [...]} │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                        processIncludes()                        │
│ (scopes, log, knex, records, scopeName, includeTree,           │
│  included, processedPaths, currentPath, fields)                │
│                                                                 │
│ Recursive function that examines schema and calls loaders      │
│                                                                 │
│ Dispatches to: ─────────────────┬───────────────┬──────────────┤
└─────────────────────────────────┴───────────────┴──────────────┘
                    │                     │                │
                    ▼                     ▼                ▼
┌───────────────────────────┐ ┌─────────────────────┐ ┌──────────────────────────┐
│     loadBelongsTo()       │ │    loadHasMany()    │ │ loadPolymorphicBelongsTo │
│ (scopes, log, knex,       │ │ (scopes, log, knex, │ │ (scopes, log, knex,      │
│  records, fieldName,      │ │  records, scopeName,│ │  records, relName,       │
│  fieldDef, includeName,   │ │  includeName,       │ │  relDef, subIncludes,    │
│  subIncludes, included,   │ │  relDef,            │ │  included,               │
│  processedPaths,          │ │  subIncludes,       │ │  processedPaths,         │
│  currentPath, fields)     │ │  included,          │ │  currentPath, fields)    │
│                           │ │  processedPaths,    │ │                          │
│ Loads many-to-one         │ │  currentPath,       │ │ Loads polymorphic        │
│ e.g. comment→article      │ │  fields)            │ │ e.g. comment→(article    │
│                           │ │                     │ │      or video)           │
│ ┌─────────────────┐       │ │ Loads one-to-many   │ │                          │
│ │ Recursively     │       │ │ or many-to-many     │ │ ┌──────────────────┐     │
│ │ calls           │◄──────┼─┤ e.g. article→       │ │ │ Recursively      │     │
│ │ processIncludes │       │ │      comments       │ │ │ calls            │◄────┤
│ └─────────────────┘       │ │                     │ │ │ processIncludes  │     │
└───────────────────────────┘ │ ┌─────────────────┐ │ │ └──────────────────┘     │
                              │ │ Recursively     │ │ └──────────────────────────┘
                              │ │ calls           │◄┤
                              │ │ processIncludes │ │           Also dispatches to:
                              │ └─────────────────┘ │                    │
                              └─────────────────────┘                    ▼
                                                      ┌──────────────────────────┐
                                                      │ loadReversePolymorphic() │
                                                      │ (scopes, log, knex,      │
                                                      │  records, scopeName,     │
                                                      │  includeName, relDef,    │
                                                      │  subIncludes, included,  │
                                                      │  processedPaths,         │
                                                      │  currentPath, fields)    │
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

## Module: knex-process-includes.js

```
┌─────────────────────────────────────────────────────────────────┐
│                      processIncludes()                          │
│ (records, scopeName, queryParams, transaction, dependencies)    │
│                                                                 │
│ High-level orchestrator that:                                  │
│ 1. Extracts scopes, log, knex from dependencies               │
│ 2. Uses transaction if provided, otherwise uses knex           │
│ 3. Calls buildIncludedResources with all parameters           │
│ 4. Returns just the included array                            │
│                                                                │
│ Called by: REST API plugin dataGet/dataQuery methods          │
└─────────────────────────────────────────────────────────────────┘
```

## Key Changes from Before:
1. **No more factory function** - All functions are module-level exports
2. **Explicit dependencies** - Functions receive scopes, log, knex as parameters
3. **Simpler imports** - Direct function imports instead of creating helper objects
4. **Clear parameter flow** - Dependencies passed down through function calls
5. **Pure functions** - Utility functions have no external dependencies

## Data Flow:
```
REST API Plugin
    │
    ├─► processIncludes (knex-process-includes.js)
    │       │
    │       └─► buildIncludedResources (knex-relationship-includes.js)
    │               │
    │               └─► processIncludes (recursive orchestrator)
    │                       │
    │                       ├─► loadBelongsTo
    │                       ├─► loadHasMany
    │                       ├─► loadPolymorphicBelongsTo
    │                       └─► loadReversePolymorphic
    │
    └─► Returns: Array of included resources in JSON:API format
```