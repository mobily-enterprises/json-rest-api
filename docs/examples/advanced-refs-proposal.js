/**
 * Advanced Refs Proposal - Automatic Joins with Hook Execution
 * 
 * A powerful syntax for enriching refs to automatically join related data
 * and execute hooks as if the data was fetched separately
 */

// ============================================================
// PROPOSED SCHEMA SYNTAX
// ============================================================

const projectSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  description: { type: 'string' },
  
  // Simple ref - just the ID
  ownerUserId: { 
    type: 'id',
    refs: { 
      resource: 'users',
      join: { 
        type: 'left', // This will mean YES JOIN
        eager: true,
        runHooks: true, // True by default
        hookContext: 'join', // 'join by default
        fields: ['id', 'name', 'email', 'avatar'],  // Specific fields only
      }

    }
  },
  
  // ENHANCED REF - Auto-join with options
  owner: {
    type: 'virtual',  // Virtual field, not in DB
    refs: {
      resource: 'users',
      localField: 'ownerUserId',  // Which field contains the ID
      joinType: 'left',            // Optional, default: 'left'
      eager: true,                 // Auto-join when querying projects
      
      // Control what happens during join
      options: {
        runHooks: true,            // Run afterGet hooks on joined data
        hookContext: 'join',       // Tell hooks this is a join operation
        fields: ['id', 'name', 'email', 'avatar'],  // Specific fields only
        // OR: excludeFields: ['passwordHash'],     // Exclude specific fields
        // OR: includeSilent: false                  // Default behavior
      }
    }
  },
  
  // Another example - category with nested joins
  categoryId: { type: 'id' },
  
  category: {
    type: 'virtual',
    refs: {
      resource: 'categories',
      localField: 'categoryId',
      eager: true,
      
      // Nested joins!
      include: {
        department: {          // Include category's department
          refs: {
            resource: 'departments',
            localField: 'departmentId'
          }
        }
      }
    }
  },
  
  // Many-to-many through join table
  tags: {
    type: 'virtual',
    refs: {
      resource: 'tags',
      through: 'projectTags',      // Join table
      localField: 'projectId',     // Field in join table
      foreignField: 'tagId',       // Other field in join table
      eager: false,                // Don't auto-load (too expensive)
      many: true                   // This is a collection
    }
  }
});

// ============================================================
// QUERY BUILDER ENHANCEMENT
// ============================================================

// When querying, the system would automatically:
// 1. Detect eager refs
// 2. Add the necessary joins
// 3. Select non-silent fields
// 4. Group results into objects
// 5. Run hooks with context

api.hook('initializeQuery', async (context) => {
  const schema = api.schemas.get(context.options.type);
  
  // Scan for eager virtual refs
  for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
    if (fieldDef.type === 'virtual' && fieldDef.refs?.eager) {
      const refs = fieldDef.refs;
      
      // Add the join
      context.query.leftJoin(refs.localField);
      
      // Select fields based on options
      const relatedSchema = api.schemas.get(refs.resource);
      const fields = refs.options?.fields || 
                    Object.keys(relatedSchema.structure)
                      .filter(f => !relatedSchema.structure[f].silent);
      
      // Store metadata for result processing
      context.joinMetadata = context.joinMetadata || {};
      context.joinMetadata[fieldName] = {
        resource: refs.resource,
        localField: refs.localField,
        fields: fields,
        runHooks: refs.options?.runHooks ?? true,
        hookContext: refs.options?.hookContext ?? 'join'
      };
      
      // Select with special prefix for grouping
      fields.forEach(field => {
        context.query.select(
          `${refs.resource}.${field} as __${fieldName}__${field}`
        );
      });
    }
  }
});

// ============================================================
// RESULT PROCESSING - GROUP INTO OBJECTS
// ============================================================

api.hook('afterQuery', async (context) => {
  if (!context.joinMetadata) return;
  
  // Process each record
  const records = Array.isArray(context.result) 
    ? context.result 
    : [context.result];
  
  for (const record of records) {
    for (const [virtualField, metadata] of Object.entries(context.joinMetadata)) {
      // Extract prefixed fields
      const relatedData = {};
      let hasData = false;
      
      Object.keys(record).forEach(key => {
        const prefix = `__${virtualField}__`;
        if (key.startsWith(prefix)) {
          const actualField = key.substring(prefix.length);
          relatedData[actualField] = record[key];
          delete record[key];  // Remove from main record
          if (record[key] !== null) hasData = true;
        }
      });
      
      // Only add if we have data (not a null join)
      if (hasData) {
        // Run hooks if requested
        if (metadata.runHooks) {
          const hookContext = {
            type: metadata.resource,
            result: relatedData,
            params: context.params,
            options: {
              ...context.options,
              isJoinResult: true,          // Flag for hooks
              joinContext: metadata.hookContext,
              parentType: context.options.type,
              parentId: record.id
            }
          };
          
          // Run afterGet hooks
          await api.runHooks('afterGet', hookContext);
          
          record[virtualField] = hookContext.result;
        } else {
          record[virtualField] = relatedData;
        }
      } else {
        record[virtualField] = null;
      }
    }
  }
}, 90); // Run after other afterQuery hooks

// ============================================================
// HOOK AWARENESS - EXPENSIVE OPERATIONS
// ============================================================

// Hooks can check if they're running in a join context
api.hook('afterGet', async (context) => {
  if (context.options.type === 'users') {
    // Skip expensive operations for joined data
    if (context.options.isJoinResult) {
      // Just add a flag instead of doing expensive computation
      context.result.hasRecentActivity = '[not computed in join]';
      return;
    }
    
    // Expensive operation only for direct fetches
    const recentActivity = await checkUserRecentActivity(context.result.id);
    context.result.hasRecentActivity = recentActivity;
  }
});

// ============================================================
// USAGE EXAMPLES
// ============================================================

// 1. Simple query - owner is automatically included
const projects = await api.resources.projects.query();
/*
Returns:
[{
  id: 1,
  name: "My Project",
  description: "...",
  ownerUserId: 123,
  owner: {                    // Automatically joined!
    id: 123,
    name: "John Doe",
    email: "john@example.com",
    avatar: "avatar.jpg"
    // Note: passwordHash not included (it's silent)
  }
}]
*/

// 2. Opt-out of eager loading
const projectsWithoutOwners = await api.resources.projects.query({
  eager: false  // Disable all eager joins
});
// OR
const projectsWithoutOwners = await api.resources.projects.query({
  exclude: ['owner']  // Exclude specific eager joins
});

// 3. Include non-eager relations
const projectsWithTags = await api.resources.projects.query({
  include: ['tags']  // Explicitly include non-eager relations
});

// 4. Complex nested includes
const projectsWithEverything = await api.resources.projects.query({
  include: {
    owner: {
      include: ['profile', 'settings']  // Include owner's relations
    },
    category: {
      include: ['department']  // Include category's department
    },
    tags: true  // Include tags
  }
});

// ============================================================
// SQL GENERATION EXAMPLE
// ============================================================

/*
For a simple query with eager owner, the SQL would be:

SELECT 
  projects.id,
  projects.name,
  projects.description,
  projects.ownerUserId,
  users.id as __owner__id,
  users.name as __owner__name,
  users.email as __owner__email,
  users.avatar as __owner__avatar
FROM projects
LEFT JOIN users ON users.id = projects.ownerUserId

The double underscore prefix groups fields for object creation.
*/

// ============================================================
// ADVANCED: CONDITIONAL EAGER LOADING
// ============================================================

const projectSchemaConditional = new Schema({
  id: { type: 'id' },
  name: { type: 'string' },
  
  owner: {
    type: 'virtual',
    refs: {
      resource: 'users',
      localField: 'ownerUserId',
      eager: (context) => {
        // Only eager load for authenticated requests
        return context.authenticated === true;
      }
    }
  }
});

// ============================================================
// BENEFITS OF THIS APPROACH
// ============================================================

/*
1. **Clean Syntax**: Virtual fields with refs feel natural
2. **Performance**: One query instead of N+1
3. **Hook Compatibility**: Joined data goes through same processing
4. **Flexibility**: Can control eager/lazy loading per query
5. **Nested Objects**: Results are properly structured, not flat
6. **Schema-Driven**: Everything defined in one place
7. **Context Awareness**: Hooks know if they're in a join

Compare to traditional approach:
- No manual JOIN writing
- No manual field aliasing  
- No manual result grouping
- Hooks run automatically
- Nested relations "just work"
*/

// ============================================================
// IMPLEMENTATION CONSIDERATIONS
// ============================================================

/*
1. **Query Complexity**: Need to handle multiple eager joins efficiently
2. **Circular References**: Detect and prevent infinite loops
3. **Memory Usage**: Large result sets with many joins
4. **Hook Order**: Ensure join hooks run in correct order
5. **Type Safety**: With TypeScript, virtual fields need special handling

Possible solutions:
- Limit eager join depth (e.g., max 3 levels)
- Use DataLoader pattern for deduplication
- Stream large results
- Provide joinLimit option
*/