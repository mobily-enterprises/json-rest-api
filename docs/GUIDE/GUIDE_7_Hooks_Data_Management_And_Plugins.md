# Hooks and Data Management

This guide provides a comprehensive reference for all hooks available in the json-rest-api system, including system-wide hooks from hooked-api and method-specific hooks from the REST API plugin.

An important concept when working with hooks is understanding how simplified mode affects data flow.

Inside hooks, JSON:API format is king _regardless of simplified mode_.
Simplified mode only ever affects:
  - **Input**: How parameters are passed to the API (simplified data is converted to JSON:API before entering the lifecycle)
  - **Output**: How the record is returned to the client (JSON:API data is converted to simplified format before returning)
Hook context _always_ contains: Full JSON:API formatted records with `data`, `type`, `attributes`, and `relationships`. So, as far as the hooks are concerned, `context.inputRecord` is _always_ a full JSON:API object.

This means when writing hooks, you always work with the standard JSON:API structure:
```javascript
// In a hook, the record is ALWAYS JSON:API format:
hooks: {
  beforeData: async ({ context }) => {
    // Even in simplified mode, inputRecord has JSON:API structure
    if (context.method === 'post' && context.inputRecord) {
      // Always access via data.attributes
      context.inputRecord.data.attributes.created_at = new Date().toISOString();
    }
  },
  
  // IMPORTANT: Use enrichAttributes to modify attributes, NOT enrichRecord
  enrichAttributes: async ({ context }) => {
    // This is called for ALL records (main and included/child records)
    // Add computed fields directly to context.attributes
    context.attributes.computed_field = 'value';
    context.attributes.word_count = context.attributes.content?.split(' ').length || 0;
  }
}
```

One of the main practical use of hooks is to manupulate data before it's committed to the database.

## Customizing the API as a whole with customize()

The `customize()` method is the primary way to extend your API with hooks, variables, and helper functions. This method is available on the API instance and provides a cleaner alternative to calling individual methods like `addHook()`.

The `customize()` method accepts an object with the following properties:
- `hooks` - Hook handlers for various lifecycle events
- `vars` - Variables accessible throughout the API
- `helpers` - Reusable functions
- `apiMethods` - Methods added to the API instance
- `scopeMethods` - Methods added to _all_ scopes/resources

### Basic Example

The `customize()` method accepts an object with hooks, vars (shared state), helpers (reusable functions), apiMethods (global methods), and scopeMethods (methods for all scopes):

```javascript
api.customize({
  // Shared variables accessible throughout the API
  vars: {
    appName: 'My Application',
    userRoles: ['admin', 'editor', 'viewer'],
    environment: process.env.NODE_ENV
  },
  
  // Reusable helper functions
  helpers: {
    formatDate: (date) => new Date(date).toLocaleDateString(),
    validateEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    hashPassword: async (password) => {
      const salt = await bcrypt.genSalt(10);
      return bcrypt.hash(password, salt);
    }
  },
  
  // Hooks for customizing behavior
  hooks: {
    beforeData: async ({ context, vars, helpers, log }) => {
      log.info(`${context.method} operation on ${context.scopeName}`);
      
      // Use vars for configuration
      if (vars.environment === 'production') {
        // Production-specific logic
      }
      
      // Modify data for POST requests
      if (context.method === 'post' && context.inputRecord) {
        // Set timestamps
        context.inputRecord.data.attributes.created_at = new Date().toISOString();
        
        // Validate and transform data using helpers
        if (context.scopeName === 'users') {
          // Hash password
          if (context.inputRecord.data.attributes.password) {
            context.inputRecord.data.attributes.password = await helpers.hashPassword(
              context.inputRecord.data.attributes.password
            );
          }
        
        }
      }
    },
    
    enrichAttributes: async ({ context }) => {
      // Add computed fields to posts
      if (context.scopeName === 'posts') {
        // NOTE that 'preview' MUST be an existing record on the database
        context.attributes.preview = context.attributes.content?.substring(0, 200) + '...';
      }
    }
  },
  
  // API-level methods: api.methodName()
  apiMethods: {
    healthCheck: async ({ vars, scopes }) => ({
      status: 'ok',
      environment: vars.environment,
      timestamp: new Date().toISOString(),
      resources: Object.keys(scopes)
    })
  },
  
  // Scope methods: api.scopes.resourceName.methodName()
  scopeMethods: {
    count: async ({ scopeName, db }) => {
      const result = await db(scopeName).count('* as total').first();
      return result.total;
    }
  }
});

// Usage examples:
const health = await api.healthCheck();
const userCount = await api.scopes.users.count();
```

**Important**: Hooks added via `customize()` are registered with the plugin name `api-custom:{apiName}` for tracking purposes.

## Customizing Resources with extras (per resource)

While `customize()` applies globally to all resources, you can customize individual resources using the `extras` parameter in `addScope()`. This provides resource-specific hooks, methods, variables, and helpers that apply **only to that particular resource**.

### Using extras in addScope

```javascript
api.addScope('posts', {
  // Schema and options
}, {
  // extras parameter - everything here applies ONLY to posts
  hooks: {

    // This will change data before getting posted
    beforeDataPost: async ({ context }) => {
      const attributes = context.inputRecord.data.attributes
      // This hook only runs for POST operations on posts
      attributes.created_at = new Date().toISOString();
    },
    
    // This will enrich all attributes (main and included) when fetched
    // It's for adding computed fields to the RESPONSE, NOT for saving to database
    // These computed fields are sent to the client but never stored 
    enrichAttributes: async ({ context }) => {  
      // This wordCount is calculated on-the-fly and included in the response
      // It is NOT saved to the database
      context.attributes.wordCount = context.attributes.content?.split(' ').length || 0;
      
      // Example: Add a reading time estimate (also not stored)
      const wordsPerMinute = 200;
      context.attributes.readingTimeMinutes = Math.ceil(context.attributes.wordCount / wordsPerMinute);
    }
  },
  
  // CLAUDE: NO. This should use patch, since direct database operations
  // will skip the lifecycle (e.g. Sockets notifications etc.)
  scopeMethods: {
    // This method is ONLY available on posts: api.scopes.posts.publish()
    publish: async ({ params, context, db, runHooks }) => {
      const id = params.id;
      const result = await db('posts')
        .where('id', id)
        .update({ 
          status: 'published',
          published_at: new Date().toISOString()
        });
      return { success: true, published: result };
    },
    
    // Only on posts: api.scopes.posts.findByAuthor()
    findByAuthor: async ({ params, scope }) => {
      return await scope.query({
        filters: { author_id: params.authorId }
      });
    }
  },
  
  vars: {
    // Resource-specific configuration
    maxTitleLength: 200,
    allowedStatuses: ['draft', 'published', 'archived'],
    defaultStatus: 'draft'
  },
  
  helpers: {
    // Resource-specific helper functions
    generateSlug: (title) => {
      return title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    },
    
    validateStatus: (status, vars) => {
      // Note: can access vars through second parameter
      return vars.allowedStatuses.includes(status);
    }
  }
});
```

### Variable and Helper Fallback System

An important feature of resource-specific vars and helpers is the **fallback system**:

1. **Variables (vars)**: When you access a variable in a resource context, it first checks the resource's vars. If not found, it falls back to the global API vars.

```javascript
// Global vars
api.customize({
  vars: {
    appName: 'My Blog',
    defaultPageSize: 20,
    maxUploadSize: 5242880  // 5MB
  }
});

// Resource-specific vars
api.addScope('posts', {}, {
  vars: {
    defaultPageSize: 10,  // Override for posts only
    maxTitleLength: 200   // Posts-specific var
  }
});

// In a posts hook or method:
// vars.defaultPageSize → 10 (from posts vars)
// vars.maxUploadSize → 5242880 (fallback to global)
// vars.maxTitleLength → 200 (posts-specific)
// vars.appName → 'My Blog' (fallback to global)
```

2. **Helpers**: Same fallback behavior - resource helpers are checked first, then global helpers.

```javascript
// Global helpers
api.customize({
  helpers: {
    formatDate: (date) => new Date(date).toLocaleDateString(),
    sanitizeHtml: (html) => { /* ... */ }
  }
});

// Resource-specific helpers
api.addScope('posts', {}, {
  helpers: {
    formatDate: (date) => new Date(date).toISOString(), // Override for posts
    generateExcerpt: (content) => content.substring(0, 150) + '...'
  }
});

// In posts context:
// helpers.formatDate() → uses posts version (ISO format)
// helpers.sanitizeHtml() → uses global version (fallback)
// helpers.generateExcerpt() → posts-specific helper
```

This means that you are able to specify api-wide variables and helpers, but can then override them by resource.

### Resource-Specific vs Global Customization

| Feature | Global (`customize()`) | Resource-Specific (`extras`) |
|---------|----------------------|----------------------------|
| **Scope** | Applies to all resources | Applies to one resource only |
| **Hooks** | Must check `context.scopeName` | Automatically scoped |
| **Methods** | `apiMethods` → `api.methodName()`<br>`scopeMethods` → all scopes | `scopeMethods` → only this scope |
| **Vars** | Global defaults | Resource-specific with fallback |
| **Helpers** | Global utilities | Resource-specific with fallback |


### Best Practices for Resource Customization

1. **Use extras for resource-specific logic** - Don't clutter global hooks with scopeName checks
2. **Leverage the fallback system** - Define common utilities globally, override when needed
3. **Keep resource methods focused** - Methods should relate to that specific resource
4. **Document resource-specific vars** - Make it clear what configuration is available
5. **Avoid naming conflicts** - Be aware that resource vars/helpers can shadow global ones

### Best Practices for Global Customization

1. **Check scopeName in Hooks** - Since customize() is API-level only, use `context.scopeName` to implement resource-specific logic
2. **Keep Helpers Pure** - Make helpers independent functions that are easier to test and reuse
3. **Use Vars for Configuration** - Store configuration values in vars instead of hardcoding them
4. **Avoid Mutable Shared State** - Be careful with objects/arrays in vars as they're shared across all requests
5. **Handle Errors Gracefully** - Thrown errors in hooks will stop the operation and return to the client
6. **Use Method-Specific Hooks** - Use `beforeDataPost`, `afterDataPatch`, etc. for operation-specific logic


## REST API Method Hooks

These hooks are triggered by the REST API plugin during CRUD operations. Each method follows a consistent pattern but with method-specific variations.

### Important Context Properties

The context object contains different properties depending on the method and stage of execution:

**Common Properties**:
- `method` (string) - The HTTP method: 'query', 'get', 'post', 'put', 'patch', or 'delete'
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information containing:
  - `schema` - The full schema object
  - `searchSchema` - Schema for filtering (query method)
  - `tableName` - Database table name
  - `idProperty` - Primary key field name
  - `schemaRelationships` - Relationship definitions
- `scopeName` (string) - Name of the current resource scope
- `transaction` (object/null) - Database transaction if provided
- `db` (object) - Database connection (knex instance or transaction)
- `auth` (object) - Authentication context if provided

**Write Operation Properties** (POST/PUT/PATCH):
- `inputRecord` (object) - The JSON:API formatted input containing:
  - `data.type` - Resource type
  - `data.attributes` - Resource attributes (this is where you modify input data)
  - `data.relationships` - Resource relationships
- `belongsToUpdates` (object) - Foreign key updates extracted from relationships
- `returnRecordSetting` (object) - Configuration for what to return

**Query/Read Properties**:
- `queryParams` (object) - Query parameters containing:
  - `fields` - Sparse fieldset selections
  - `include` - Relationships to include
  - `sort` - Sort fields array (query only)
  - `page` - Pagination settings (query only)
  - `filters` - Filter conditions (query only)
- `record` (object) - The fetched/created record in JSON:API format
- `originalRecord` (object) - Backup of the record before modifications

### Hook Execution Pattern

All REST API methods follow this general pattern:

1. **Before hooks** - Run before the main operation
2. **Permission checks** - For GET method
3. **Main operation** - The actual database operation
4. **After hooks** - Run after the operation
5. **Enrichment hooks** - To enhance the record
6. **Transaction hooks** - Commit/rollback for write operations
7. **Finish hooks** - Final cleanup/processing

## QUERY Method Hooks

Used for retrieving collections of resources with filtering, sorting, and pagination.

### beforeData

**When**: Before executing the database query  
**Purpose**: Modify query parameters, add custom filters, set defaults

**Context contains**:
- `method` (string) - "query"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
  - `schema` - Full schema object
  - `searchSchema` - Schema for filtering
  - `tableName` - Database table name
  - `idProperty` - Primary key field name
- `queryParams` (object) - Query parameters
  - `fields` - Sparse fieldset selections
  - `include` - Relationships to include
  - `sort` - Sort fields array
  - `page` - Pagination settings
  - `filters` - Filter conditions
- `transaction` (object/null) - Database transaction if provided
- `db` (object) - Database connection (knex instance or transaction)
- `scopeName` (string) - Name of the current scope
- `sortableFields` (array) - Fields allowed for sorting
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `queryParams.filters` - Modify filter conditions  
- `queryParams.sort` - Modify sort order
- `queryParams.page` - Modify pagination
- `queryParams.fields` - Modify field selection
- `queryParams.include` - Modify includes
- Any custom properties added to context

**Example**:
```javascript
// In api.addScope('posts', {}, extras):
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'query' && context.auth?.userId) {
      // Only show posts by the current user
      context.queryParams.filters = {
        ...context.queryParams.filters,
        author_id: context.auth.userId
      };
    }
  }
}
```

### beforeDataQuery

**When**: Immediately after `beforeData`, query-specific  
**Purpose**: Query-specific modifications

**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### enrichRecord

**When**: After data is fetched from database and normalized  
**Purpose**: Modify the response structure, add metadata, or handle response-level concerns

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
  - `data` - Array of resource objects
  - `included` - Array of included resources
  - `meta` - Metadata (pagination, etc.)
  - `links` - Pagination links
- `originalRecord` (object) - Backup of the record before enrichment

**What can be changed**:
- `record.meta` - Add or modify metadata
- `record.links` - Modify links
- Response structure modifications (but NOT attributes)
- Should NOT modify attributes - use `enrichAttributes` hook instead

**Example**:
```javascript
hooks: {
  enrichAttributes: async ({ context }) => {
    if (context.parentContext?.method === 'query') {
      // Add computed fields that are NOT stored in database
      // These are calculated fresh for each response
      context.attributes.wordCount = context.attributes.content?.split(' ').length || 0;
      context.attributes.excerpt = context.attributes.content?.substring(0, 150) + '...';
      
      // Transform display values (original remains in database)
      // Database still has lowercase title, this is just for this response
      context.attributes.displayTitle = context.attributes.title?.toUpperCase();
    }
  }
}
```

### finish

**When**: Before returning the response  
**Purpose**: Final logging, metrics collection

**Context contains**: All previous context properties  
**What can be changed**: Nothing - hooks should NOT change `context.record` at this stage

### finishQuery

**When**: Immediately after `finish`, query-specific  
**Purpose**: Query-specific final processing

**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## GET Method Hooks

Used for retrieving a single resource by ID.

### beforeData

**When**: Before fetching the single resource  
**Purpose**: Modify query parameters, prepare for fetch

**Context contains**:
- `method` (string) - "get"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `queryParams` (object) - Query parameters
  - `fields` - Sparse fieldset selections
  - `include` - Relationships to include
- `transaction` (object/null) - Database transaction if provided
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `id` (string/number) - The ID of the resource to fetch
- `minimalRecord` (object) - Minimal record fetched for authorization
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `queryParams.fields` - Modify field selection
- `queryParams.include` - Modify includes
- Custom context properties

### beforeDataGet

**When**: Immediately after `beforeData`, get-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### checkDataPermissions

**When**: After the record is fetched, before enrichment  
**Purpose**: Implement row-level security, check access permissions

**Context contains**:
- All previous context properties
- `record` (object) - The fetched JSON:API record

**What can be changed**:
- Can throw errors to deny access
- Should NOT modify the record

**Example**:
```javascript
hooks: {
  checkDataPermissions: async ({ context }) => {
    if (context.method === 'get') {
      const post = context.record.data;
      if (post.attributes.status === 'draft' && post.attributes.author_id !== context.auth?.userId) {
        throw new Error('Access denied: Cannot view draft posts by other authors');
      }
    }
  }
}
```

### checkDataPermissionsGet

**When**: Immediately after `checkDataPermissions`, get-specific  
**Context**: Same as `checkDataPermissions`  
**What can be changed**: Same as `checkDataPermissions`

### enrichRecord

**When**: After permission checks  
**Purpose**: Modify the response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record
- `computedDependencies` (object) - Fields needed for computed fields

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### enrichRecordWithRelationships

**When**: After basic enrichment  
**Purpose**: Add relationship metadata, enhance relationship data

**Context**: Same as `enrichRecord`  
**What can be changed**:
- Can modify relationship data
- Can add relationship metadata

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishGet

**When**: Immediately after `finish`, get-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## POST Method Hooks

Used for creating new resources.

### beforeData

**When**: Before creating the new resource  
**Purpose**: Validate data, set defaults, compute values

**Context contains**:
- `method` (string) - "post"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `inputRecord` (object) - The JSON:API formatted input data
  - `data.type` - Resource type
  - `data.attributes` - Resource attributes
  - `data.relationships` - Resource relationships
- `params` (object) - Original parameters (may contain `returnFullRecord`)
- `queryParams` (object) - Contains `fields`, `include` for response
- `transaction` (object) - Database transaction (created if not provided)
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `returnRecordSetting` (object) - Settings for what to return
  - `post` - 'no', 'minimal', or 'full'
  - `put` - 'no', 'minimal', or 'full'
  - `patch` - 'no', 'minimal', or 'full'
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `inputRecord.data.attributes` - Modify validated attributes before insert
- `belongsToUpdates` - Modify foreign key values (but these are usually already merged into attributes)
- Custom context properties
- Can set defaults or compute values

**Note**: After validation, attributes are stored in `context.inputRecord.data.attributes`, not directly in `context.attributes`.
**Note**: `context.minimalRecord` is always a JSON:API resource object; for POST requests it is a snapshot of the incoming payload (`{ type, id?, attributes, relationships }`).

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'post' && context.inputRecord) {
      // Set default status
      if (!context.inputRecord.data.attributes.status) {
        context.inputRecord.data.attributes.status = 'draft';
      }
      
      // Set author from auth context (this would typically be in belongsToUpdates)
      if (context.auth?.userId && context.belongsToUpdates) {
        context.belongsToUpdates.author_id = context.auth.userId;
      }
      
      // Add creation timestamp
      context.inputRecord.data.attributes.created_at = new Date().toISOString();
    }
  }
}
```

### beforeDataPost

**When**: Immediately after `beforeData`, post-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the resource is created in the database  
**Purpose**: Trigger side effects, create related records

**Context contains**:
- All previous context properties
- `id` (string/number) - The ID of the created resource
- `newRecord` (object) - The raw database record

**What can be changed**:
- Can perform side effects (create related records, etc.)
- Can add properties to context for later hooks
- Should NOT modify `newRecord` directly

**Example**:
```javascript
hooks: {
  afterData: async ({ context, scopes }) => {
    if (context.method === 'post') {
      // Create a notification for new post
      await scopes.notifications.create({
        type: 'new_post',
        post_id: context.id,
        user_id: context.belongsToUpdates.author_id,
        created_at: new Date().toISOString()
      });
    }
  }
}
```

### afterDataPost

**When**: Immediately after `afterData`, post-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### enrichRecord

**When**: After fetching the created record (if `returnFullRecord` is not 'no')  
**Purpose**: Modify response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### afterCommit

**When**: After the transaction is committed (only if `shouldCommit` is true)  
**Purpose**: Trigger post-commit side effects like sending emails, webhooks

**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

**Example**:
```javascript
hooks: {
  afterCommit: async ({ context, helpers }) => {
    if (context.method === 'post') {
      // Send email notification (safe to do after commit)
      await helpers.emailService.send({
        template: 'new_post',
        data: {
          postId: context.id,
          title: context.inputRecord.data.attributes.title
        }
      });
    }
  }
}
```

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Purpose**: Clean up any external resources, log failures

**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup/logging only

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishPost

**When**: Immediately after `finish`, post-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## PUT Method Hooks

Used for completely replacing a resource.

### beforeData

**When**: Before replacing the resource  
**Purpose**: Validate replacement data, check permissions

**Context contains**:
- `method` (string) - "put"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `inputRecord` (object) - The JSON:API formatted input data
- `id` (string/number) - The ID from URL or input record
- `params` (object) - Original parameters
- `queryParams` (object) - Contains `fields`, `include` for response
- `transaction` (object) - Database transaction
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `returnRecordSetting` (object) - Settings for what to return
- `minimalRecord` (object) - Existing record for authorization
- `existingRelationships` (object) - Current hasMany/manyToMany relationships
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `inputRecord.data.attributes` - Modify validated attributes before update
- `belongsToUpdates` - Modify foreign key values (but these are usually already merged into attributes)
- Can prevent certain field updates

**Note**: After validation, attributes are stored in `context.inputRecord.data.attributes`.

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'put' && context.inputRecord) {
      // Prevent changing the author (check if belongsTo relationship changed)
      const newAuthorId = context.belongsToUpdates?.author_id;
      const currentAuthorId = context.minimalRecord?.relationships?.author?.data?.id;
      if (newAuthorId && newAuthorId !== currentAuthorId) {
        throw new Error('Cannot change post author');
      }
      
      // Add update timestamp
      context.inputRecord.data.attributes.updated_at = new Date().toISOString();
    }
  }
}
```

### beforeDataPut

**When**: Immediately after `beforeData`, put-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the resource is updated and relationships are replaced  
**Purpose**: Handle relationship changes, trigger updates

**Context contains**:
- All previous context properties
- `updatedRecord` (object) - The updated database record
- `relationshipChanges` (object) - Details of relationship modifications

**What can be changed**:
- Can perform side effects
- Can clean up orphaned relationships
- Should NOT modify the database record

### afterDataPut

**When**: Immediately after `afterData`, put-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### enrichRecord

**When**: After fetching the updated record (if `returnFullRecord` is not 'no')  
**Purpose**: Modify response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### enrichRecordWithRelationships

**When**: After basic enrichment  
**Context**: Same as `enrichRecord`  
**What can be changed**:
- Can modify relationship data
- Can add relationship metadata

### afterCommit

**When**: After the transaction is committed  
**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup only

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishPut

**When**: Immediately after `finish`, put-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## PATCH Method Hooks

Used for partially updating a resource.

### beforeData

**When**: Before partially updating the resource  
**Purpose**: Validate partial updates, compute derived values

**Context contains**:
- `method` (string) - "patch"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `inputRecord` (object) - The JSON:API formatted input data (partial)
- `id` (string/number) - The ID from URL or input record
- `params` (object) - Original parameters
- `queryParams` (object) - Contains `fields`, `include` for response
- `transaction` (object) - Database transaction
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `returnRecordSetting` (object) - Settings for what to return
- `minimalRecord` (object) - Existing record for authorization
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `inputRecord.data.attributes` - Modify validated attributes before update
- `belongsToUpdates` - Modify foreign key values (if any)
- Can add computed values or prevent updates

**Note**: For PATCH, `context.inputRecord.data.attributes` contains only the fields being updated. Use `context.minimalRecord.attributes` to access the complete current record.

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'patch' && context.inputRecord) {
      // If status is being changed to published, set publish date
      if (context.inputRecord.data.attributes.status === 'published' && 
        context.minimalRecord?.attributes?.status !== 'published') {
        context.inputRecord.data.attributes.published_at = new Date().toISOString();
      }
      
      // Always update the modified timestamp
      context.inputRecord.data.attributes.updated_at = new Date().toISOString();
    }
  }
}
```

### beforeDataPatch

**When**: Immediately after `beforeData`, patch-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the partial update is applied  
**Purpose**: React to specific changes, trigger conditional side effects

**Context contains**:
- All previous context properties
- `updatedRecord` (object) - The updated database record
- `relationshipChanges` (object) - Details of any relationship modifications

**What can be changed**:
- Can perform side effects based on what changed
- Should NOT modify the database record

### afterDataPatch

**When**: Immediately after `afterData`, patch-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### enrichRecord

**When**: After fetching the updated record (if `returnFullRecord` is not 'no')  
**Purpose**: Modify response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### enrichRecordWithRelationships

**When**: After basic enrichment  
**Context**: Same as `enrichRecord`  
**What can be changed**:
- Can modify relationship data
- Can add relationship metadata

### afterCommit

**When**: After the transaction is committed  
**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup only

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishPatch

**When**: Immediately after `finish`, patch-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## DELETE Method Hooks

Used for removing resources.

### beforeData

**When**: Before deleting the resource  
**Purpose**: Validate deletion, check for dependencies

**Context contains**:
- `method` (string) - "delete"
- `schemaInfo` (object) - Compiled schema information
- `id` (string/number) - The ID of the resource to delete
- `transaction` (object) - Database transaction
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `minimalRecord` (object) - Record fetched for authorization checks
- `auth` (object) - Authentication context if provided

**What can be changed**:
- Can throw errors to prevent deletion
- Can add properties to context for later hooks
- Cannot modify the deletion itself

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'delete') {
      // Check if post has comments
      const commentCount = await context.db('comments')
        .where('post_id', context.id)
        .count('* as count')
        .first();
      
      if (commentCount.count > 0) {
        throw new Error('Cannot delete post with comments');
      }
    }
  }
}
```

### beforeDataDelete

**When**: Immediately after `beforeData`, delete-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the resource is deleted from the database  
**Purpose**: Clean up related data, log deletions

**Context contains**:
- All previous context properties
- `deletedCount` (number) - Number of records deleted (should be 1)
- `deletedRecord` (object) - The record that was deleted

**What can be changed**:
- Can perform cascading deletes or cleanup
- Can log the deletion
- Cannot undo the deletion

**Example**:
```javascript
hooks: {
  afterData: async ({ context, scopes }) => {
    if (context.method === 'delete') {
      // Log the deletion
      await scopes.audit_logs.create({
        action: 'delete',
        resource_type: 'posts',
        resource_id: context.id,
        user_id: context.auth?.userId,
        timestamp: new Date().toISOString()
      });
      
      // Clean up orphaned images
      await context.db('post_images')
        .where('post_id', context.id)
        .delete();
    }
  }
}
```

### afterDataDelete

**When**: Immediately after `afterData`, delete-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### afterCommit

**When**: After the transaction is committed  
**Purpose**: Trigger post-deletion side effects

**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup only

### finish

**When**: Before returning the response (typically empty for DELETE)  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishDelete

**When**: Immediately after `finish`, delete-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## Special Hooks

### enrichAttributes

The `enrichAttributes` hook is the correct way to add or modify attributes on records. This hook is called for ALL records - both main records and included/related records.

**When**: After records are fetched and before they are returned  
**Purpose**: Add computed fields, transform attribute values, enhance record data

**Context contains**:
- `attributes` (object) - The record's attributes that should be modified
- `parentContext` (object) - The parent context from the calling method (contains method, queryParams, etc.)
- `computedFields` (object) - Computed field definitions from schema
- `requestedComputedFields` (array) - Which computed fields were requested
- `scopeName` (string) - Name of the current scope
- `helpers` (object) - Helper functions
- `api` (object) - API instance

**What can be changed**:
- Modify `context.attributes` to add new properties
- Transform existing attribute values
- Remove sensitive attributes

**Important**:
- This hook is called for EVERY record (main and included)
- Works with both single records and collections
- Modify `context.attributes` directly

**Example**:
```javascript
// In global customize()
api.customize({
  hooks: {
    enrichAttributes: async ({ context }) => {
      // Add computed fields based on scope
      if (context.scopeName === 'posts') {
        context.attributes.wordCount = context.attributes.content?.split(' ').length || 0;
        context.attributes.readingTime = Math.ceil(context.attributes.wordCount / 200) + ' min';
        context.attributes.preview = context.attributes.content?.substring(0, 150) + '...';
      }
      
      if (context.scopeName === 'users') {
        // Hide sensitive data
        delete context.attributes.password;
        delete context.attributes.resetToken;
        
        // Add display name
        context.attributes.displayName = `${context.attributes.firstName} ${context.attributes.lastName}`;
      }
    }
  }
});

// In resource-specific extras
api.addScope('articles', {}, {
  hooks: {
    enrichAttributes: async ({ context }) => {
      // This only runs for articles
      context.attributes.isPublished = context.attributes.status === 'published';
      context.attributes.isNew = new Date() - new Date(context.attributes.created_at) < 7 * 24 * 60 * 60 * 1000;
      
      // Format dates for display
      context.attributes.formattedDate = new Date(context.attributes.created_at).toLocaleDateString();
    }
  }
});
```

### knexQueryFiltering

The `knexQueryFiltering` hook is called during QUERY operations to apply filter conditions. This is a special hook that allows complex query modifications.

**When**: During `dataQuery` execution, before sorting and pagination  
**Purpose**: Apply filters, add JOINs, modify query conditions

**Context contains**:
- `knexQuery` (object) - Temporary object with:
  - `query` (knex query builder) - The active query being built
  - `filters` (object) - Filter parameters from request
  - `searchSchema` (object) - Schema defining searchable fields
  - `scopeName` (string) - Current resource scope
  - `tableName` (string) - Database table name
  - `db` (object) - Database connection
- All other standard query context properties

The REST API Knex Plugin registers three sub-hooks that run in sequence:

#### 1. polymorphicFiltersHook

**Purpose**: Handles filtering on polymorphic relationships  
**What it does**:
- Detects polymorphic filter fields (e.g., `commentable.title`)
- Adds appropriate JOINs for each polymorphic type
- Builds WHERE conditions with proper type checking

**Example**:
```javascript
// This is handled automatically by the plugin
// When filtering: ?filters[commentable.title]=Hello
// It generates SQL like:
// LEFT JOIN posts ON (comments.commentable_type = 'posts' AND comments.commentable_id = posts.id)
// WHERE posts.title = 'Hello'
```

#### 2. crossTableFiltersHook

**Purpose**: Handles filtering on cross-table fields  
**What it does**:
- Detects cross-table filter fields (e.g., `author.name`)
- Adds JOINs to related tables
- Qualifies field names to avoid ambiguity

**Example**:
```javascript
// This is handled automatically by the plugin
// When filtering: ?filters[author.name]=John
// It generates SQL like:
// INNER JOIN users ON posts.author_id = users.id
// WHERE users.name = 'John'
```

#### 3. basicFiltersHook

**Purpose**: Handles simple filters on the main table  
**What it does**:
- Processes standard field filters
- Handles special operators (contains, starts_with, etc.)
- Applies filters to non-joined fields

**Custom Filter Hook Example**:
```javascript
hooks: {
  knexQueryFiltering: async ({ context }) => {
    if (context.knexQuery && context.knexQuery.filters) {
      const { query, filters, tableName } = context.knexQuery;
      
      // Add custom filter logic
      if (filters.special_filter) {
        query.where(function() {
          this.where(`${tableName}.status`, 'active')
              .orWhere(`${tableName}.featured`, true);
        });
      }
    }
  }
}
```

## Hook Best Practices

### 1. Hook Order Matters

Hooks run in registration order. Consider dependencies between hooks:

```javascript
hooks: {
  beforeData: [
    async ({ context }) => {
      // Validation runs first
      if (!context.inputRecord?.data?.attributes?.title) {
        throw new Error('Title is required');
      }
    },
    async ({ context }) => {
      // Enrichment runs second, after validation
      context.inputRecord.data.attributes.slug = context.inputRecord.data.attributes.title
        .toLowerCase()
        .replace(/\s+/g, '-');
    }
  ]
}
```

### 2. Use Proper Hook Placement

If using addHook directly (less common), you can control placement:

```javascript
// Use afterPlugin to ensure your hook runs after the plugin's hooks
api.addHook('beforeData', 'myHook', { afterPlugin: 'rest-api-knex' }, handler);
```

### 3. Context Mutation Guidelines

- **DO**: Modify allowed properties as documented
- **DON'T**: Change properties marked as read-only
- **DO**: Add custom properties for communication between hooks
- **DON'T**: Remove required properties

### 4. Error Handling

Throwing an error in any hook will:
- Stop the operation
- Trigger rollback for write operations
- Return the error to the client

```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.inputRecord?.data?.attributes?.price < 0) {
      throw new RestApiValidationError('Price cannot be negative', {
        fields: ['data.attributes.price']
      });
    }
  }
}
```

### 5. Performance Considerations

- Keep `enrichRecord` hooks lightweight for queries with many results
- Use database transactions appropriately
- Batch operations when possible
- Avoid N+1 queries in hooks

### 6. Transaction Safety

For write operations:
- Use `afterCommit` for external side effects (emails, webhooks)
- Use `afterData` for database-related side effects
- Always handle `afterRollback` for cleanup

### 7. Scope-Specific Hooks

Add hooks to specific scopes to avoid checking in every hook:

```javascript
// Better: Add hooks in the scope's extras parameter
api.addScope('posts', {}, {
  hooks: {
    beforeData: async ({ context }) => {
      // This only runs for posts
    }
  }
});

// Less ideal: Check scopeName in global hooks
hooks: {
  beforeData: async ({ context }) => {
    if (context.scopeName === 'posts') {
      // ...
    }
  }
}
```

### 8. Hook Communication

Use context properties to communicate between hooks:

```javascript
hooks: {
  beforeData: async ({ context }) => {
    context.customData = { processed: true };
  },
  
  afterData: async ({ context }) => {
    if (context.customData?.processed) {
      // React to first hook
    }
  }
}

## System-Wide Hooks

These hooks are managed by the hooked-api framework and are triggered during core API operations.

### plugin:installed

**When**: After a plugin is successfully installed  
**Purpose**: React to plugin installations, set up inter-plugin communication

**Context contains**:
- `pluginName` (string) - Name of the installed plugin
- `pluginOptions` (object) - Options passed to the plugin
- `plugin` (object) - The plugin object itself (informational only)

**What can be changed**: Nothing - this is an informational hook

**Example**:
```javascript
hooks: {
  'plugin:installed': async ({ context }) => {
    console.log(`Plugin ${context.pluginName} installed with options:`, context.pluginOptions);
  }
}
```

### scope:added

**When**: After a scope is added to the API  
**Purpose**: Initialize scope-specific settings, validate configurations, compile schemas

**Context contains**:
- `scopeName` (string) - Name of the added scope
- `scopeOptions` (object) - Immutable copy of initial options
- `scopeExtras` (object) - Immutable copy of initial extras
- `vars` (proxy) - Proxy for current scope vars (can be mutated)
- `helpers` (proxy) - Proxy for current scope helpers (can be mutated)

**What can be changed**: 
- Can add/modify scope vars through the proxy
- Can add/modify scope helpers through the proxy
- Cannot modify scopeOptions (frozen after hook runs)

**Example**:
```javascript
hooks: {
  'scope:added': async ({ context }) => {
    // Add a default value to scope vars
    context.vars.defaultPageSize = 20;
    
    // Add a helper function
    context.helpers.formatDate = (date) => new Date(date).toISOString();
  }
}
```

### method:api:added

**When**: After an API method is added  
**Purpose**: Wrap or modify API method handlers

**Context contains**:
- `methodName` (string) - Name of the added method
- `handler` (function) - The method handler function

**What can be changed**:
- `handler` - Can wrap or replace the handler function

**Example**:
```javascript
hooks: {
  'method:api:added': async ({ context }) => {
    const originalHandler = context.handler;
    context.handler = async (params) => {
      console.log(`Calling ${context.methodName}`);
      const result = await originalHandler(params);
      console.log(`${context.methodName} completed`);
      return result;
    };
  }
}
```

### method:scope:adding

**When**: Before adding a scope method  
**Purpose**: Validate or modify scope methods before they're registered

**Context contains**:
- `methodName` (string) - Name of the method being added
- `handler` (function) - The method handler function

**What can be changed**:
- `handler` - Can wrap or replace the handler function before it's added

### method:scope:added

**When**: After a scope method is added  
**Purpose**: React to scope method additions

**Context contains**:
- `methodName` (string) - Name of the added method
- `handler` (function) - The method handler function

**What can be changed**: Nothing - this is an informational hook

```

---

[Back to Guide](./README.md)
