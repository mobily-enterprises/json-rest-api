/**
 * Advanced Refs - Revised Proposal
 * 
 * Define join behavior directly on foreign key fields
 * When joins are active, the field contains the full object instead of just the ID
 */

// ============================================================
// SCHEMA DEFINITION WITH JOIN CONFIG
// ============================================================

const projectSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  description: { type: 'string' },
  status: { type: 'string' },
  
  // Foreign key with join configuration
  ownerUserId: { 
    type: 'id',
    refs: { 
      resource: 'users',
      
      // Presence of 'join' means this can be auto-populated
      join: { 
        type: 'left',              // Join type (left, inner)
        eager: true,               // Auto-join on all queries
        runHooks: true,            // Run afterGet hooks (default: true)
        hookContext: 'join',       // Context passed to hooks (default: 'join')
        fields: ['id', 'name', 'email', 'avatar'],  // Specific fields only
        // OR: excludeFields: ['passwordHash', 'salt'],
        // OR: includeSilent: false (default behavior)
      }
    }
  },
  
  // Another example - lazy loaded (eager: false)
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories',
      join: {
        type: 'left',
        eager: false,  // Must explicitly request
        fields: ['id', 'name', 'slug']
      }
    }
  },
  
  // Example without join config - traditional foreign key
  departmentId: {
    type: 'id',
    refs: {
      resource: 'departments'
      // No 'join' property = never auto-joined
    }
  }
});

// ============================================================
// QUERY RESULTS - DIFFERENT MODES
// ============================================================

// 1. DEFAULT QUERY (with eager joins)
const projects = await api.resources.projects.query();
/*
Returns:
[{
  id: 1,
  name: "My Project",
  description: "...",
  status: "active",
  
  // Instead of just the ID, we get the full object!
  ownerUserId: {
    id: 123,
    name: "John Doe",
    email: "john@example.com",
    avatar: "avatar.jpg"
  },
  
  // Non-eager join not loaded
  categoryId: 5,
  
  // No join config - always just the ID
  departmentId: 10
}]
*/

// 2. QUERY WITH JOINS DISABLED
const projectsNoJoins = await api.resources.projects.query({ 
  joins: false  // Disable all joins
});
/*
Returns:
[{
  id: 1,
  name: "My Project",
  ownerUserId: 123,      // Just the ID
  categoryId: 5,         // Just the ID
  departmentId: 10       // Just the ID
}]
*/

// 3. QUERY WITH SPECIFIC JOINS
const projectsWithCategory = await api.resources.projects.query({
  joins: ['categoryId']  // Only join these fields
});
/*
Returns:
[{
  id: 1,
  name: "My Project",
  ownerUserId: 123,      // Not joined (even though eager)
  categoryId: {          // Explicitly requested
    id: 5,
    name: "Technology",
    slug: "technology"
  },
  departmentId: 10
}]
*/

// 4. EXCLUDE SPECIFIC JOINS
const projectsWithoutOwner = await api.resources.projects.query({
  excludeJoins: ['ownerUserId']  // Skip this eager join
});

// ============================================================
// QUERY BUILDER IMPLEMENTATION
// ============================================================

api.hook('initializeQuery', async (context) => {
  const schema = api.schemas.get(context.options.type);
  if (!schema) return;
  
  // Figure out which joins to perform
  const requestedJoins = new Set();
  
  // Check each field with refs.join config
  for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
    if (fieldDef.refs?.join) {
      const shouldJoin = 
        // Explicit joins take precedence
        (context.params.joins && context.params.joins.includes(fieldName)) ||
        // Otherwise check if eager and not excluded
        (fieldDef.refs.join.eager && 
         context.params.joins !== false &&
         !context.params.excludeJoins?.includes(fieldName));
      
      if (shouldJoin) {
        requestedJoins.add(fieldName);
      }
    }
  }
  
  // Store metadata for later processing
  context.joinFields = {};
  
  // Add joins and selects
  for (const fieldName of requestedJoins) {
    const fieldDef = schema.structure[fieldName];
    const refs = fieldDef.refs;
    const joinConfig = refs.join;
    
    // Add the join
    context.query[joinConfig.type + 'Join'](fieldName);
    
    // Determine which fields to select
    const relatedSchema = api.schemas.get(refs.resource);
    let fields;
    
    if (joinConfig.fields) {
      fields = joinConfig.fields;
    } else if (joinConfig.excludeFields) {
      fields = Object.keys(relatedSchema.structure)
        .filter(f => !joinConfig.excludeFields.includes(f))
        .filter(f => joinConfig.includeSilent || !relatedSchema.structure[f].silent);
    } else {
      // Default: all non-silent fields
      fields = Object.keys(relatedSchema.structure)
        .filter(f => !relatedSchema.structure[f].silent);
    }
    
    // Store join metadata
    context.joinFields[fieldName] = {
      resource: refs.resource,
      fields: fields,
      runHooks: joinConfig.runHooks !== false,
      hookContext: joinConfig.hookContext || 'join'
    };
    
    // Select with special prefix
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
      
      // Collect prefixed fields
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
        // Run hooks if configured
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
          
          // Replace the ID with the full object
          record[fieldName] = hookContext.result;
        } else {
          // Just replace without hooks
          record[fieldName] = joinedData;
        }
      }
      // If no data (null join), leave the original ID value
    }
  }
}, 90);

// ============================================================
// SINGLE RECORD OPERATIONS
// ============================================================

// Get operations also support joins
const project = await api.resources.projects.get(123);
// Returns: { id: 123, ownerUserId: { id: 5, name: "John", ... }, ... }

const projectNoJoins = await api.resources.projects.get(123, { joins: false });
// Returns: { id: 123, ownerUserId: 5, ... }

// ============================================================
// HOOK CONTEXT AWARENESS
// ============================================================

api.hook('afterGet', async (context) => {
  if (context.options.type === 'users') {
    if (context.options.isJoinResult) {
      // Simplified processing for joined data
      context.result.displayName = `${context.result.name} (via ${context.options.parentField})`;
      
      // Skip expensive operations
      console.log(`Skipping activity check for joined user ${context.result.id}`);
      return;
    }
    
    // Full processing for direct fetches
    context.result.displayName = context.result.name;
    context.result.lastActivity = await getLastActivity(context.result.id);
  }
});

// ============================================================
// JSON:API RESPONSE FORMAT
// ============================================================

// The HTTP plugin would need to handle this specially
api.hook('transformResult', async (context) => {
  if (context.options.isHttp) {
    const record = context.result;
    
    // For JSON:API, we might want to move joined data to relationships
    const relationships = {};
    
    for (const [fieldName, fieldDef] of Object.entries(context.schema.structure)) {
      if (fieldDef.refs?.join && typeof record[fieldName] === 'object') {
        // Move to relationships
        relationships[fieldName.replace(/Id$/, '')] = {
          data: {
            type: fieldDef.refs.resource,
            id: record[fieldName].id
          }
        };
        
        // Store for included section
        context.included = context.included || [];
        context.included.push({
          type: fieldDef.refs.resource,
          id: record[fieldName].id,
          attributes: record[fieldName]
        });
        
        // Replace with just the ID in attributes
        record[fieldName] = record[fieldName].id;
      }
    }
    
    // Add relationships if any
    if (Object.keys(relationships).length > 0) {
      context.jsonApiRelationships = relationships;
    }
  }
});

// ============================================================
// ADVANCED: NESTED JOINS
// ============================================================

// What if the joined resource also has joins?
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string' },
  email: { type: 'string' },
  
  departmentId: {
    type: 'id',
    refs: {
      resource: 'departments',
      join: {
        eager: true,
        fields: ['id', 'name']
      }
    }
  }
});

// When joining users, should we also join their departments?
// This could be controlled by a depth parameter:
const projectsDeep = await api.resources.projects.query({
  joinDepth: 2  // Follow joins up to 2 levels deep
});
/*
Returns:
{
  id: 1,
  ownerUserId: {
    id: 123,
    name: "John",
    departmentId: {      // Nested join!
      id: 5,
      name: "Engineering"
    }
  }
}
*/

// ============================================================
// BENEFITS OF THIS APPROACH
// ============================================================

/*
1. **Clean Schema**: Join config lives with the field definition
2. **Backward Compatible**: Fields without join config work as before
3. **Flexible**: Can be eager or lazy, with or without hooks
4. **Intuitive**: The field contains what you'd expect
5. **Performance**: Still one query, not N+1
6. **Contextual**: Hooks know they're processing joined data

The key insight: Foreign key fields can be either:
- Simple IDs (traditional behavior)
- Full objects (when joined)

This matches how developers think about relationships!
*/