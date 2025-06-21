/**
 * Advanced Refs - Final Design
 * 
 * Comprehensive approach combining:
 * - Eager/lazy loading control
 * - Optional separate field for joined data
 * - JSON:API compliance with relationships/included
 */

// ============================================================
// SCHEMA WITH FULL OPTIONS
// ============================================================

const projectSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  description: { type: 'string' },
  
  // Option 1: Replace the ID with object (backward compatible)
  ownerUserId: { 
    type: 'id',
    refs: { 
      resource: 'users',
      join: { 
        eager: true,               // Auto-join on both query() and get()
        runHooks: true,
        fields: ['id', 'name', 'email', 'avatar']
      }
    }
  },
  
  // Option 2: Keep ID separate, populate different field
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories',
      join: {
        eager: false,              // Must explicitly request
        resourceField: 'category', // Populate this field instead
        fields: ['id', 'name', 'slug', 'color']
      }
    }
  },
  
  // Option 3: Both approaches - for maximum flexibility
  authorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        eager: true,
        resourceField: 'author',   // Also populate author field
        preserveId: true,          // Keep authorId as just the ID
        fields: ['id', 'name', 'bio']
      }
    }
  }
});

// ============================================================
// QUERY BEHAVIOR WITH EAGER TRUE VS FALSE
// ============================================================

// EAGER: TRUE - Joins happen automatically
const projectsEager = await api.resources.projects.query();
const projectEager = await api.resources.projects.get(1);
/*
Both return ownerUserId as object:
{
  id: 1,
  name: "My Project",
  ownerUserId: { id: 123, name: "John", email: "john@example.com" },
  categoryId: 5,              // Not joined (eager: false)
  authorId: 99,               // Preserved as ID
  author: { id: 99, name: "Jane", bio: "..." }  // Populated separately
}
*/

// EAGER: FALSE - Must explicitly request
const projectsWithCategory = await api.resources.projects.query({ 
  joins: ['categoryId'] 
});
const projectWithCategory = await api.resources.projects.get(1, { 
  joins: ['categoryId'] 
});
/*
Both return:
{
  id: 1,
  name: "My Project",
  ownerUserId: { id: 123, ... },    // Still joined (eager: true)
  categoryId: 5,                     // ID preserved
  category: {                        // Populated in resourceField
    id: 5,
    name: "Technology",
    slug: "tech",
    color: "#0066cc"
  },
  authorId: 99,
  author: { id: 99, ... }
}
*/

// ============================================================
// JSON:API RESPONSE FORMAT
// ============================================================

// For HTTP responses, we follow JSON:API spec properly
api.hook('beforeSend', async (context) => {
  if (!context.options.isHttp) return;
  
  const schema = api.schemas.get(context.options.type);
  const records = Array.isArray(context.result) 
    ? context.result 
    : [context.result];
    
  context.included = context.included || [];
  
  for (const record of records) {
    record.relationships = record.relationships || {};
    
    for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
      if (!fieldDef.refs?.join) continue;
      
      const resourceField = fieldDef.refs.join.resourceField;
      const preserveId = fieldDef.refs.join.preserveId;
      
      // Handle different configurations
      if (resourceField) {
        // Data is in separate field
        if (record[resourceField]) {
          const relName = resourceField;
          
          // Add to relationships
          record.relationships[relName] = {
            data: {
              type: fieldDef.refs.resource,
              id: String(record[resourceField].id)
            }
          };
          
          // Add to included
          context.included.push({
            type: fieldDef.refs.resource,
            id: String(record[resourceField].id),
            attributes: omit(record[resourceField], ['id'])
          });
          
          // Remove from attributes
          delete record[resourceField];
        }
      } else if (!preserveId && typeof record[fieldName] === 'object') {
        // Data replaced the ID field
        const relName = fieldName.replace(/Id$/, '');
        const data = record[fieldName];
        
        // Add to relationships
        record.relationships[relName] = {
          data: {
            type: fieldDef.refs.resource,
            id: String(data.id)
          }
        };
        
        // Add to included
        context.included.push({
          type: fieldDef.refs.resource,
          id: String(data.id),
          attributes: omit(data, ['id'])
        });
        
        // Replace with just the ID in attributes
        record[fieldName] = data.id;
      }
    }
    
    // Clean up empty relationships
    if (Object.keys(record.relationships).length === 0) {
      delete record.relationships;
    }
  }
  
  // Deduplicate included resources
  if (context.included.length > 0) {
    const seen = new Set();
    context.included = context.included.filter(item => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
});

/*
JSON:API Response:
{
  "data": {
    "type": "projects",
    "id": "1",
    "attributes": {
      "name": "My Project",
      "description": "...",
      "ownerUserId": 123,        // Back to ID
      "categoryId": 5,
      "authorId": 99
    },
    "relationships": {
      "ownerUser": {
        "data": { "type": "users", "id": "123" }
      },
      "category": {
        "data": { "type": "categories", "id": "5" }
      },
      "author": {
        "data": { "type": "users", "id": "99" }
      }
    }
  },
  "included": [
    {
      "type": "users",
      "id": "123",
      "attributes": {
        "name": "John",
        "email": "john@example.com",
        "avatar": "..."
      }
    },
    {
      "type": "categories",
      "id": "5",
      "attributes": {
        "name": "Technology",
        "slug": "tech",
        "color": "#0066cc"
      }
    },
    {
      "type": "users",
      "id": "99",
      "attributes": {
        "name": "Jane",
        "bio": "..."
      }
    }
  ]
}
*/

// ============================================================
// QUERY BUILDER IMPLEMENTATION
// ============================================================

api.hook('initializeQuery', async (context) => {
  const schema = api.schemas.get(context.options.type);
  if (!schema) return;
  
  // Determine which joins to perform
  const requestedJoins = new Set();
  
  for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
    if (!fieldDef.refs?.join) continue;
    
    const joinConfig = fieldDef.refs.join;
    const shouldJoin = 
      // Explicit joins
      (context.params.joins && context.params.joins.includes(fieldName)) ||
      // Eager joins (unless disabled)
      (joinConfig.eager && 
       context.params.joins !== false &&
       !context.params.excludeJoins?.includes(fieldName));
    
    if (shouldJoin) {
      requestedJoins.add(fieldName);
    }
  }
  
  // Store metadata
  context.joinFields = {};
  
  // Add joins
  for (const fieldName of requestedJoins) {
    const fieldDef = schema.structure[fieldName];
    const refs = fieldDef.refs;
    const joinConfig = refs.join;
    
    // Add the join
    const joinType = joinConfig.type || 'left';
    context.query[joinType + 'Join'](fieldName);
    
    // Determine fields
    const relatedSchema = api.schemas.get(refs.resource);
    let fields = joinConfig.fields || 
      Object.keys(relatedSchema.structure)
        .filter(f => !relatedSchema.structure[f].silent);
    
    // Store metadata
    context.joinFields[fieldName] = {
      resource: refs.resource,
      fields: fields,
      runHooks: joinConfig.runHooks !== false,
      hookContext: joinConfig.hookContext || 'join',
      resourceField: joinConfig.resourceField,
      preserveId: joinConfig.preserveId
    };
    
    // Select with prefix
    fields.forEach(field => {
      context.query.select(
        `${refs.resource}.${field} as __${fieldName}__${field}`
      );
    });
  }
});

// ============================================================
// RESULT TRANSFORMATION
// ============================================================

api.hook('afterQuery', async (context) => {
  if (!context.joinFields || Object.keys(context.joinFields).length === 0) {
    return;
  }
  
  const records = Array.isArray(context.result) 
    ? context.result 
    : [context.result];
  
  for (const record of records) {
    for (const [fieldName, joinMeta] of Object.entries(context.joinFields)) {
      // Extract joined data
      const joinedData = {};
      let hasData = false;
      
      const prefix = `__${fieldName}__`;
      Object.keys(record).forEach(key => {
        if (key.startsWith(prefix)) {
          const actualField = key.substring(prefix.length);
          joinedData[actualField] = record[key];
          delete record[key];
          if (record[key] !== null) hasData = true;
        }
      });
      
      if (hasData) {
        // Run hooks if needed
        let processedData = joinedData;
        if (joinMeta.runHooks) {
          const hookContext = {
            type: joinMeta.resource,
            result: joinedData,
            params: context.params,
            options: {
              ...context.options,
              isJoinResult: true,
              joinContext: joinMeta.hookContext,
              parentType: context.options.type,
              parentId: record.id,
              parentField: fieldName
            }
          };
          
          await api.runHooks('afterGet', hookContext);
          processedData = hookContext.result;
        }
        
        // Place the data based on configuration
        if (joinMeta.resourceField) {
          // Put in separate field
          record[joinMeta.resourceField] = processedData;
          // ID field stays as-is
        } else if (!joinMeta.preserveId) {
          // Replace the ID field
          record[fieldName] = processedData;
        } else {
          // Both: keep ID and add separate field
          const resourceField = fieldName.replace(/Id$/, '');
          record[resourceField] = processedData;
        }
      }
    }
  }
}, 90);

// ============================================================
// USAGE EXAMPLES
// ============================================================

// 1. Different join configurations in action
const project = await api.resources.projects.get(1);
/*
{
  id: 1,
  name: "My Project",
  
  // Replaced ID with object (no resourceField)
  ownerUserId: {
    id: 123,
    name: "John Doe",
    email: "john@example.com"
  },
  
  // Separate fields (resourceField specified)
  categoryId: 5,
  category: null,  // Not joined (eager: false)
  
  // Both (preserveId: true)
  authorId: 99,
  author: {
    id: 99,
    name: "Jane Smith",
    bio: "Author bio..."
  }
}
*/

// 2. With explicit joins
const projectFull = await api.resources.projects.get(1, {
  joins: ['categoryId']  // Request non-eager join
});
/*
Now includes:
  categoryId: 5,
  category: {
    id: 5,
    name: "Technology",
    slug: "tech"
  }
*/

// 3. Disable all joins
const projectBasic = await api.resources.projects.get(1, {
  joins: false
});
/*
All fields are just IDs:
{
  id: 1,
  name: "My Project",
  ownerUserId: 123,
  categoryId: 5,
  authorId: 99
}
*/

// ============================================================
// BENEFITS
// ============================================================

/*
1. **Flexibility**: Three ways to handle joined data
   - Replace ID field
   - Separate resource field
   - Both (preserve ID)

2. **Control**: Eager vs lazy loading with clear semantics

3. **Standards**: Proper JSON:API response format

4. **Performance**: Still single query, not N+1

5. **Backward Compatible**: Old schemas without join config work fine

6. **Developer Friendly**: 
   - `userId` can stay as ID for foreign key constraints
   - `user` or `userRecord` contains full data
   - JSON:API relationships handled automatically
*/