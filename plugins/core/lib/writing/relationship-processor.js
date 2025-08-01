import { RestApiValidationError } from '../../../../lib/rest-api-errors.js';

/**
 * Processes JSON:API relationship data and converts to database operations
 * 
 * @param {Object} scope - The scope object containing schema info
 * @param {Object} deps - Dependencies object
 * @returns {Object} Object with belongsToUpdates and manyToManyRelationships arrays
 * 
 * @example
 * // Input: Simple belongsTo relationship
 * const inputRecord = {
 *   data: {
 *     type: 'articles',
 *     attributes: { title: 'My Article' },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '123' }
 *       },
 *       category: {
 *         data: { type: 'categories', id: '5' }
 *       }
 *     }
 *   }
 * };
 * 
 * // Schema has:
 * // author_id: { belongsTo: 'users', as: 'author' }
 * // category_id: { belongsTo: 'categories', as: 'category' }
 * 
 * const result = processRelationships(scope, { context: { inputRecord } });
 * 
 * // Output: Foreign keys extracted
 * // {
 * //   belongsToUpdates: {
 * //     author_id: '123',
 * //     category_id: '5'
 * //   },
 * //   manyToManyRelationships: []
 * // }
 * 
 * @example
 * // Input: Polymorphic relationship
 * const inputRecord = {
 *   data: {
 *     type: 'comments',
 *     relationships: {
 *       commentable: {
 *         data: { type: 'posts', id: '456' }
 *       }
 *     }
 *   }
 * };
 * 
 * // Schema relationships has:
 * // commentable: {
 * //   belongsToPolymorphic: {
 * //     types: ['posts', 'videos'],
 * //     typeField: 'commentable_type',
 * //     idField: 'commentable_id'
 * //   }
 * // }
 * 
 * const result = processRelationships(scope, { context: { inputRecord } });
 * 
 * // Output: Both type and id fields set
 * // {
 * //   belongsToUpdates: {
 * //     commentable_type: 'posts',
 * //     commentable_id: '456'
 * //   },
 * //   manyToManyRelationships: []
 * // }
 * 
 * @example
 * // Input: Many-to-many relationship
 * const inputRecord = {
 *   data: {
 *     type: 'articles', 
 *     relationships: {
 *       tags: {
 *         data: [
 *           { type: 'tags', id: '10' },
 *           { type: 'tags', id: '20' }
 *         ]
 *       }
 *     }
 *   }
 * };
 * 
 * // Schema relationships has:
 * // tags: {
 * //   hasMany: 'tags',
 * //   through: 'article_tags',
 * //   foreignKey: 'article_id',
 * //   otherKey: 'tag_id'
 * // }
 * 
 * const result = processRelationships(scope, { context: { inputRecord } });
 * 
 * // Output: Many-to-many data collected
 * // {
 * //   belongsToUpdates: {},
 * //   manyToManyRelationships: [{
 * //     relName: 'tags',
 * //     relDef: {
 * //       through: 'article_tags',
 * //       foreignKey: 'article_id',
 * //       otherKey: 'tag_id'
 * //     },
 * //     relData: [
 * //       { type: 'tags', id: '10' },
 * //       { type: 'tags', id: '20' }
 * //     ]
 * //   }]
 * // }
 * 
 * @example
 * // Input: Clearing relationships
 * const inputRecord = {
 *   data: {
 *     relationships: {
 *       author: { data: null },      // Clear belongsTo
 *       tags: { data: [] }           // Clear many-to-many
 *     }
 *   }
 * };
 * 
 * const result = processRelationships(scope, { context: { inputRecord } });
 * 
 * // Output: Null for belongsTo, empty array for many-to-many
 * // {
 * //   belongsToUpdates: { author_id: null },
 * //   manyToManyRelationships: [{
 * //     relName: 'tags',
 * //     relDef: { ... },
 * //     relData: []  // Will delete all pivot records
 * //   }]
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataPut and dataPatch methods
 * - Called before database writes to prepare relationship updates
 * 
 * Purpose:
 * - Converts JSON:API relationship format to database operations
 * - Handles all relationship types: belongsTo, polymorphic, many-to-many
 * - Validates polymorphic types against allowed values
 * - Separates concerns: foreign keys vs pivot table operations
 * 
 * Data flow:
 * 1. Receives JSON:API document with relationships section
 * 2. Analyzes schema to determine relationship types
 * 3. For belongsTo: extracts foreign key values
 * 4. For polymorphic: extracts both type and id fields
 * 5. For many-to-many: collects data for pivot operations
 * 6. Returns structured data for database updates
 */
export const processRelationships = (scope, deps) => {
  // Extract values from scope
  const { 
    vars: { 
      schemaInfo: { schemaStructure: schemaFields, schemaRelationships: relationships }
    }
  } = scope;
  
  // Extract values from deps
  const { context } = deps;
  const { inputRecord } = context;
  const belongsToUpdates = {};
  const manyToManyRelationships = [];
  
  if (!inputRecord.data.relationships) {
    return { belongsToUpdates, manyToManyRelationships };
  }
  
  for (const [relName, relData] of Object.entries(inputRecord.data.relationships)) {
    const relDef = relationships?.[relName];
    
    // Find the schema field that defines this relationship
    const schemaField = Object.entries(schemaFields).find(([fieldName, fieldDef]) => 
      fieldDef.as === relName
    );
    
    if (schemaField) {
      const [fieldName, fieldDef] = schemaField;
      
      // Handle regular belongsTo (1:1)
      if (fieldDef.belongsTo) {
        if (relData.data === null) {
          belongsToUpdates[fieldName] = null;
        } else if (relData.data?.id) {
          belongsToUpdates[fieldName] = relData.data.id;
        }
      }
    }
    
    // Check for polymorphic belongsTo defined in relationships object (not as schema field)
    if (!schemaField && relDef?.belongsToPolymorphic && relData.data !== undefined) {
      if (relData.data === null) {
        const { typeField, idField } = relDef.belongsToPolymorphic;
        belongsToUpdates[typeField] = null;
        belongsToUpdates[idField] = null;
      } else if (relData.data) {
        const { type, id } = relData.data;
        const { types, typeField, idField } = relDef.belongsToPolymorphic;
        
        // Validate type is allowed
        if (!types.includes(type)) {
          throw new RestApiValidationError(
            `Invalid type '${type}' for polymorphic relationship '${relName}'. Allowed types: ${types.join(', ')}`,
            { 
              fields: [`data.relationships.${relName}.data.type`],
              violations: [{
                field: `data.relationships.${relName}.data.type`,
                rule: 'polymorphic_type',
                message: `Type must be one of: ${types.join(', ')}`
              }]
            }
          );
        }
        
        belongsToUpdates[typeField] = type;
        belongsToUpdates[idField] = id;
      }
    }
    
    // Check for many-to-many relationships defined in relationships object
    if (relDef?.manyToMany && relData.data !== undefined) {
      manyToManyRelationships.push({
        relName,
        relDef: relDef.manyToMany,  // Pass the manyToMany object, not the whole relationship
        relData: relData.data || []  // null means empty array for many-to-many
      });
    }
    // Also check for hasMany with through (alternative many-to-many syntax)
    else if (relDef?.hasMany && relDef?.through && relData.data !== undefined) {
      manyToManyRelationships.push({
        relName,
        relDef: {
          through: relDef.through,
          foreignKey: relDef.foreignKey,
          otherKey: relDef.otherKey
        },
        relData: relData.data || []  // null means empty array for many-to-many
      });
    }
  }
  
  return { belongsToUpdates, manyToManyRelationships };
};