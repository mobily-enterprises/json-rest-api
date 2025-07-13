/**
 * @module relationship-processor
 * @description Relationship processing functions for REST API plugin
 * 
 * This module handles the complex task of extracting relationship data from
 * JSON:API payloads and converting them into database operations. It bridges
 * the gap between JSON:API's relationship format and actual database foreign
 * keys and pivot tables.
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
 * @param {Object} scope - The scope object containing schema info
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.context - Request context
 * @param {Object} deps.context.inputRecord - The JSON:API input record containing relationship data
 * @returns {Object} Object with belongsToUpdates and manyToManyRelationships arrays
 * @throws {RestApiValidationError} If polymorphic relationship type is invalid
 * 
 * @example
 * // Example 1: Processing a simple belongsTo relationship
 * const scope = api.resources['articles'];
 * const deps = {
 *   context: {
 *     inputRecord: {
 *       data: {
 *         type: 'articles',
 *         attributes: { title: 'My Article' },
 *         relationships: {
 *           author: {
 *             data: { type: 'users', id: '123' }
 *           }
 *         }
 *       }
 *     }
 *   }
 * };
 * const result = processRelationships(scope, deps);
 * // Returns:
 * // {
 * //   belongsToUpdates: { author_id: '123' },  // Foreign key extracted
 * //   manyToManyRelationships: []
 * // }
 * 
 * @example
 * // Example 2: Processing polymorphic relationships
 * const scope = api.resources['comments'];
 * const deps = {
 *   context: {
 *     inputRecord: {
 *       data: {
 *         type: 'comments',
 *         attributes: { text: 'Great!' },
 *         relationships: {
 *           commentable: {
 *             data: { type: 'posts', id: '456' }  // Can be 'posts' or 'videos'
 *           }
 *         }
 *       }
 *     }
 *   }
 * };
 * const result = processRelationships(scope, deps);
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
 * const scope = api.resources['articles'];
 * const deps = {
 *   context: {
 *     inputRecord: {
 *       data: {
 *         type: 'articles',
 *         attributes: { title: 'Tagged Article' },
 *         relationships: {
 *           tags: {
 *             data: [
 *               { type: 'tags', id: '10' },
 *               { type: 'tags', id: '20' },
 *               { type: 'tags', id: '30' }
 *             ]
 *           }
 *         }
 *       }
 *     }
 *   }
 * };
 * const result = processRelationships(scope, deps);
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
 * const scope = api.resources['articles'];
 * const deps = {
 *   context: {
 *     inputRecord: {
 *       data: {
 *         type: 'articles',
 *         relationships: {
 *           author: {
 *             data: null  // Clear the author
 *           },
 *           tags: {
 *             data: []    // Clear all tags
 *           }
 *         }
 *       }
 *     }
 *   }
 * };
 * const result = processRelationships(scope, deps);
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
 * const scope = api.resources['comments'];
 * const deps = {
 *   context: {
 *     inputRecord: {
 *       data: {
 *         relationships: {
 *           commentable: {
 *             data: { type: 'invalid_type', id: '123' }
 *           }
 *         }
 *       }
 *     }
 *   }
 * };
 * // Throws RestApiValidationError:
 * // "Invalid type 'invalid_type' for polymorphic relationship 'commentable'. Allowed types: posts, videos"
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Convert JSON:API relationships to database-ready foreign keys
 * // 2. Validate polymorphic relationships against allowed types
 * // 3. Prepare many-to-many operations for pivot table updates
 * // 4. Support both setting and clearing relationships (null/empty array)
 * // 5. Maintain data integrity by validating relationships before database writes
 * // 6. Abstract the complexity of different relationship types from storage plugins
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