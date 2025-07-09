/**
 * Relationship processing functions for REST API plugin
 */

import { RestApiValidationError } from '../../../lib/rest-api-errors.js';

/**
 * Processes JSON:API relationship data from input records and converts them into database-ready foreign key updates
 * and many-to-many relationship operations.
 * 
 * This function is the central relationship processor that handles all types of relationships:
 * 1. **belongsTo (1:1)**: Converts relationship references to foreign key values
 * 2. **Polymorphic belongsTo**: Handles relationships that can point to multiple types
 * 3. **Many-to-many**: Collects relationship data for pivot table operations
 * 
 * The function analyzes the incoming JSON:API relationships block and the resource's schema
 * to determine how to process each relationship. It returns two objects:
 * - `belongsToUpdates`: Direct field updates for foreign keys
 * - `manyToManyRelationships`: Array of many-to-many operations to perform
 * 
 * @param {Object} inputRecord - The JSON:API input record containing relationship data
 * @param {Object} schemaFields - The resource's schema field definitions
 * @param {Object} relationships - The resource's relationship configurations
 * @returns {Object} Object with belongsToUpdates and manyToManyRelationships arrays
 * @throws {RestApiValidationError} If polymorphic relationship type is invalid
 * 
 * @example
 * // Example 1: Processing a simple belongsTo relationship
 * const inputRecord = {
 *   data: {
 *     type: 'articles',
 *     attributes: { title: 'My Article' },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '123' }
 *       }
 *     }
 *   }
 * };
 * const schemaFields = {
 *   author_id: { 
 *     type: 'number', 
 *     belongsTo: 'users', 
 *     as: 'author'  // Maps to relationships.author
 *   }
 * };
 * const result = processRelationships(inputRecord, schemaFields, {});
 * // Returns:
 * // {
 * //   belongsToUpdates: { author_id: '123' },  // Foreign key extracted
 * //   manyToManyRelationships: []
 * // }
 * 
 * @example
 * // Example 2: Processing polymorphic relationships
 * const inputRecord = {
 *   data: {
 *     type: 'comments',
 *     attributes: { text: 'Great!' },
 *     relationships: {
 *       commentable: {
 *         data: { type: 'posts', id: '456' }  // Can be 'posts' or 'videos'
 *       }
 *     }
 *   }
 * };
 * const schemaFields = {
 *   commentable: {
 *     belongsToPolymorphic: {
 *       types: ['posts', 'videos'],
 *       typeField: 'commentable_type',
 *       idField: 'commentable_id'
 *     },
 *     as: 'commentable'
 *   }
 * };
 * const result = processRelationships(inputRecord, schemaFields, {});
 * // Returns:
 * // {
 * //   belongsToUpdates: {
 * //     commentable_type: 'posts',  // Type field set
 * //     commentable_id: '456'       // ID field set
 * //   },
 * //   manyToManyRelationships: []
 * // }
 * 
 * @example
 * // Example 3: Processing many-to-many relationships
 * const inputRecord = {
 *   data: {
 *     type: 'articles',
 *     attributes: { title: 'Tagged Article' },
 *     relationships: {
 *       tags: {
 *         data: [
 *           { type: 'tags', id: '10' },
 *           { type: 'tags', id: '20' },
 *           { type: 'tags', id: '30' }
 *         ]
 *       }
 *     }
 *   }
 * };
 * const relationships = {
 *   tags: {
 *     manyToMany: {
 *       through: 'article_tags',
 *       foreignKey: 'article_id',
 *       otherKey: 'tag_id'
 *     }
 *   }
 * };
 * const result = processRelationships(inputRecord, {}, relationships);
 * // Returns:
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
 * //       { type: 'tags', id: '20' },
 * //       { type: 'tags', id: '30' }
 * //     ]
 * //   }]
 * // }
 * 
 * @example
 * // Example 4: Clearing relationships (setting to null)
 * const inputRecord = {
 *   data: {
 *     type: 'articles',
 *     relationships: {
 *       author: {
 *         data: null  // Clear the author
 *       },
 *       tags: {
 *         data: []    // Clear all tags
 *       }
 *     }
 *   }
 * };
 * const result = processRelationships(inputRecord, schemaFields, relationships);
 * // Returns:
 * // {
 * //   belongsToUpdates: { author_id: null },  // Foreign key cleared
 * //   manyToManyRelationships: [{
 * //     relName: 'tags',
 * //     relDef: { ... },
 * //     relData: []  // Empty array will clear all pivot records
 * //   }]
 * // }
 * 
 * @example
 * // Example 5: Invalid polymorphic type throws error
 * const inputRecord = {
 *   data: {
 *     relationships: {
 *       commentable: {
 *         data: { type: 'invalid_type', id: '123' }
 *       }
 *     }
 *   }
 * };
 * // Throws RestApiValidationError:
 * // "Invalid type 'invalid_type' for polymorphic relationship 'commentable'. Allowed types: posts, videos"
 */
export const processRelationships = (inputRecord, schemaFields, relationships) => {
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
      if (fieldDef.belongsTo && !fieldDef.belongsToPolymorphic) {
        if (relData.data === null) {
          belongsToUpdates[fieldName] = null;
        } else if (relData.data?.id) {
          belongsToUpdates[fieldName] = relData.data.id;
        }
      }
      // Handle polymorphic belongsTo
      else if (fieldDef.belongsToPolymorphic) {
        if (relData.data === null) {
          const { typeField, idField } = fieldDef.belongsToPolymorphic;
          belongsToUpdates[typeField] = null;
          belongsToUpdates[idField] = null;
        } else if (relData.data) {
          const { type, id } = relData.data;
          const { types, typeField, idField } = fieldDef.belongsToPolymorphic;
          
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