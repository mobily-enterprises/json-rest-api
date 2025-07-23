# Advanced Relationships Guide

This guide provides a comprehensive understanding of how the REST API plugin system handles relationships, includes, and search functionality.

## Architecture Overview

The system has three main layers:
1. **REST API Plugin** (`rest-api-plugin.js`) - Handles HTTP/JSON:API formatting
2. **REST API Knex Plugin** (`rest-api-knex-plugin.js`) - Handles SQL database operations
3. **Helper Libraries** - Modular functionality for specific features

## Core Helper Libraries

### 1. **Relationship Includes** (`lib/relationship-includes.js`)
**Purpose**: Handles the `?include=` parameter for loading related resources

**Key Functions**:
- `parseIncludeTree()` - Converts "author,comments.author" → nested tree structure
- `loadBelongsTo()` - Loads many-to-one relationships
- `loadHasMany()` - Loads one-to-many relationships  
- `loadPolymorphicBelongsTo()` - Loads polymorphic many-to-one
- `loadReversePolymorphic()` - Loads reverse polymorphic (hasMany via)
- `buildIncludedResources()` - Main entry point that orchestrates everything

### 2. **Cross-Table Search** (`lib/cross-table-search.js`)
**Purpose**: Enables searching across related tables

**Key Functions**:
- `buildJoinChain()` - Creates SQL JOIN paths for cross-table queries
- `analyzeRequiredIndexes()` - Identifies missing database indexes
- `validateCrossTableField()` - Ensures fields are properly configured

### 3. **Polymorphic Helpers** (`lib/polymorphic-helpers.js`)
**Purpose**: Utilities for polymorphic relationships

**Key Functions**:
- `validatePolymorphicRelationship()` - Validates config during registration
- `groupByPolymorphicType()` - Groups records by their polymorphic type
- `resolvePolymorphicTarget()` - Determines target type and ID
- `buildPolymorphicSearchJoins()` - Creates conditional JOINs for search

## How Relationships Work

### 1. **BelongsTo (Many-to-One)**

**Definition**:
```javascript
const articlesSchema = {
  id: { type: 'id' },
  title: { type: 'string' },
  author_id: { 
    type: 'number',
    belongsTo: 'users',
    as: 'author',
    sideSearch: true    // Enable cross-table search
  }
}
```

**How it works**:
1. Foreign key `author_id` points to `users.id`
2. In JSON:API response, creates relationship: `{ author: { data: { type: 'users', id: '123' } } }`
3. With `?include=author`, uses `loadBelongsTo()` to fetch related user
4. With search, enables `?filters[authorName]=John` via cross-table search

**SQL for include**:
```sql
-- First query: Get articles
SELECT * FROM articles WHERE ...

-- Second query: Get all authors for found articles
SELECT * FROM users WHERE id IN (1, 2, 3)
```

### 2. **HasMany (One-to-Many)**

**Definition**:
```javascript
api.addResource('users', {
  schema: usersSchema,
  relationships: {
    articles: {
      hasMany: 'articles',
      foreignKey: 'author_id',  // Field in articles table
      as: 'articles',
      // Relationships are always includable via ?include=
    }
  }
});
```

**How it works**:
1. Reverse of belongsTo - finds all records where `articles.author_id = users.id`
2. Creates relationship array: `{ articles: { data: [{ type: 'articles', id: '1' }, ...] } }`
3. With `?include=articles`, uses `loadHasMany()` to fetch related articles

**SQL for include**:
```sql
-- First query: Get users
SELECT * FROM users WHERE ...

-- Second query: Get all articles for found users  
SELECT * FROM articles WHERE author_id IN (1, 2, 3) ORDER BY id
```

### 3. **Polymorphic BelongsTo**

**Definition**:
```javascript
api.addResource('comments', {
  schema: commentsSchema,
  relationships: {
    commentable: {
      belongsToPolymorphic: {
        types: ['articles', 'videos', 'products'],
        typeField: 'commentable_type',
        idField: 'commentable_id'
      },
      as: 'commentable',
      // Relationships are always includable via ?include=
    }
  }
});
```

**How it works**:
1. Two fields work together: `commentable_type` (stores 'articles'/'videos') and `commentable_id`
2. Validates type is in allowed list
3. With `?include=commentable`, uses `loadPolymorphicBelongsTo()`:
   - Groups comments by type
   - Makes separate query for each type
   - Maps results back

**SQL for include**:
```sql
-- First query: Get comments
SELECT * FROM comments WHERE ...

-- Second query: Get articles (for comments with type='articles')
SELECT * FROM articles WHERE id IN (1, 2)

-- Third query: Get videos (for comments with type='videos')  
SELECT * FROM videos WHERE id IN (3, 4)
```

### 4. **Reverse Polymorphic (HasMany via)**

**Definition**:
```javascript
api.addResource('articles', {
  schema: articlesSchema,
  relationships: {
    comments: {
      hasMany: 'comments',
      via: 'commentable',  // Polymorphic field name
      as: 'comments',
      // Relationships are always includable via ?include=
    }
  }
});
```

**How it works**:
1. Finds all records where `comments.commentable_type = 'articles'` AND `comments.commentable_id = articles.id`
2. Uses `loadReversePolymorphic()` function

**SQL for include**:
```sql
-- Get all comments for these articles
SELECT * FROM comments 
WHERE commentable_type = 'articles' 
  AND commentable_id IN (1, 2, 3)
ORDER BY id
```

### 5. **Enhanced Many-to-Many**

**Definition**:
```javascript
// Pivot table as full resource
api.addResource('project_members', {
  schema: {
    id: { type: 'id' },
    project_id: { 
      type: 'number',
      belongsTo: 'projects',
      as: 'project',
      // Relationships are always includable via ?include=
    },
    user_id: {
      type: 'number', 
      belongsTo: 'users',
      as: 'user',
      // Relationships are always includable via ?include=
    },
    role: { type: 'string' },
    hours_allocated: { type: 'number' }
  }
});

// From users side
api.addResource('users', {
  relationships: {
    projectMemberships: {
      hasMany: 'project_members',
      foreignKey: 'user_id',
      as: 'projectMemberships'
    }
  }
});
```

**How it works**:
1. Pivot table is a full resource with its own schema and API endpoints
2. Can query pivot table directly: `GET /project_members?filters[role]=lead`
3. Can include through pivot: `GET /users/1?include=projectMemberships.project`
4. Pivot table can have additional attributes beyond just the foreign keys

## How Search Works

### 1. **Basic Search Schema**

```javascript
searchSchema: {
  // Simple field search
  title: { type: 'string', filterUsing: 'like' },
  
  // Cross-table search
  authorName: {
    type: 'string',
    actualField: 'users.name',  // Table.field notation
    filterUsing: 'like'
  },
  
  // Multi-field search
  search: {
    type: 'string',
    likeOneOf: ['title', 'body', 'users.name']
  },
  
  // Custom filter function
  minPrice: {
    type: 'number',
    applyFilter: (query, value) => {
      query.where('price', '>=', value);
    }
  }
}
```

### 2. **Polymorphic Search**

```javascript
searchSchema: {
  trackableTitle: {
    type: 'string',
    filterUsing: 'like',
    polymorphicField: 'trackable',  // References relationship name
    targetFields: {
      articles: 'title',      // When type=articles, search title
      videos: 'title',        // When type=videos, search title  
      courses: 'name'         // When type=courses, search name
    }
  }
}
```

## Hook System

The system uses a powerful hook architecture:

### 1. **Main Hook: `knexQueryFiltering`**

Called during query building to add WHERE conditions:

```javascript
addHook('knexQueryFiltering', 'myPlugin', {}, ({ query, filters, searchSchema }) => {
  // Add your custom filtering logic
  query.where(function() {
    this.where('tenant_id', getTenantId());
  });
});
```

**Built-in hook handlers**:
1. **searchSchemaFilter** (in `rest-api-knex-plugin.js`) - Processes searchSchema filters
2. Your custom hooks can add security filters, soft deletes, etc.

### 2. **Processing Flow**

1. REST API plugin receives request with `?filters[title]=javascript`
2. Validates filters against searchSchema
3. Passes to Knex plugin's `dataQuery` method
4. Knex plugin:
   - Builds base query
   - Stores context in `context.knexQuery`
   - Calls `runHooks('knexQueryFiltering')`
   - searchSchemaFilter hook processes filters:
     - Detects cross-table fields → builds JOINs
     - Detects polymorphic fields → builds conditional JOINs
     - Applies WHERE conditions
5. Executes query
6. Processes includes if requested
7. Converts to JSON:API format

## Key Implementation Details

### 1. **Foreign Key Filtering**
- Foreign keys are automatically excluded from JSON:API attributes
- They appear only in relationships section
- Polymorphic type/id fields are also filtered out

### 2. **Batch Loading**
- All includes use batch loading to prevent N+1 queries
- Example: 100 articles with authors = 2 queries total, not 101

### 3. **Field Selection**
- Sparse fieldsets (`?fields[articles]=title,body`) are supported
- Foreign keys are always selected (needed for relationships)
- Uses `buildFieldSelection()` helper

### 4. **SQL Generation Examples**

**Cross-table search**:
```sql
-- GET /articles?filters[authorName]=john
SELECT articles.* FROM articles 
LEFT JOIN users AS articles_to_users_users 
  ON articles.author_id = articles_to_users_users.id
WHERE (articles_to_users_users.name LIKE '%john%')
```

**Polymorphic search**:
```sql
-- GET /activities?filters[trackableTitle]=JavaScript
SELECT activities.* FROM activities 
LEFT JOIN articles AS activities_trackable_articles 
  ON activities.trackable_type = 'articles' 
  AND activities.trackable_id = activities_trackable_articles.id
LEFT JOIN videos AS activities_trackable_videos 
  ON activities.trackable_type = 'videos' 
  AND activities.trackable_id = activities_trackable_videos.id
WHERE (
  (activities.trackable_type = 'articles' 
   AND activities_trackable_articles.title LIKE '%JavaScript%')
  OR 
  (activities.trackable_type = 'videos' 
   AND activities_trackable_videos.title LIKE '%JavaScript%')
)
```

## File Structure

```
json-rest-api/
├── plugins/core/
│   ├── rest-api-plugin.js           # HTTP/JSON:API layer
│   ├── rest-api-knex-plugin.js      # SQL/Database layer
│   └── lib/
│       ├── relationship-includes.js  # Include processing
│       ├── cross-table-search.js     # Cross-table search
│       └── polymorphic-helpers.js    # Polymorphic utilities
└── lib/
    ├── payload-validators.js         # Request validation
    ├── rest-api-errors.js           # Error classes
    └── polymorphic-helpers.js       # Core polymorphic utilities
```

## API Structure

The REST API Knex plugin exposes its functionality in a well-organized structure:

```javascript
api.knex = {
  instance: knex,  // The Knex instance for direct SQL queries
  helpers: {
    crossTableSearch: {
      validateCrossTableField: async (targetScopeName, fieldName) => {...},
      buildJoinChain: async (fromScopeName, targetPath) => {...},
      analyzeRequiredIndexes: (scopeName, searchSchema) => {...},
      createRequiredIndexes: async (requiredIndexes, knex) => {...}
    },
    relationshipIncludes: {
      parseIncludeTree: (includeString) => {...},
      buildIncludedResources: async (records, scopeName, queryParams) => {...}
      // ... other internal methods
    },
    polymorphic: {
      validatePolymorphicRelationship: (relDef, scopeName) => {...},
      groupByPolymorphicType: (records, typeField, idField) => {...},
      resolvePolymorphicTarget: (record, typeField, idField, allowedTypes) => {...},
      buildPolymorphicSearchJoins: async (query, searchDef, scopeName, tableName, knex) => {...}
    }
  }
};
```

This architecture provides a clean separation of concerns with modular helpers that can be tested and understood independently.