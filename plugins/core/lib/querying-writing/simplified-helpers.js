/**
 * Transformation functions for simplified API mode
 * 
 * @description
 * This module enables "simplified mode" - a developer-friendly alternative
 * to verbose JSON:API format. It allows APIs to:
 * - Accept plain JavaScript objects as input
 * - Return flat response objects instead of nested JSON:API
 * - Automatically convert between formats transparently
 * - Maintain JSON:API compliance internally
 */

import { RestApiValidationError } from '../../../../lib/rest-api-errors.js';

/**
 * Transforms simplified plain object into JSON:API format
 * 
 * @param {Object} scope - Scope containing input data
 * @param {Object} scope.inputRecord - Plain object or JSON:API document
 * @param {Object} deps - Dependencies with context
 * @param {string} deps.context.scopeName - Resource type name
 * @param {Object} deps.context.schemaStructure - Schema with field definitions
 * @param {Object} deps.context.schemaRelationships - Relationship configurations
 * @returns {Object} JSON:API formatted document
 * 
 * @example
 * // Input: Simple object with only attributes
 * const input = {
 *   id: '123',
 *   title: 'My Article',
 *   content: 'Article content here'
 * };
 * const result = transformSimplifiedToJsonApi(
 *   { inputRecord: input },
 *   { context: { scopeName: 'articles', schemaStructure: schema } }
 * );
 * 
 * // Output: Proper JSON:API structure
 * // {
 * //   data: {
 * //     type: 'articles',
 * //     id: '123',
 * //     attributes: {
 * //       title: 'My Article',
 * //       content: 'Article content here'
 * //     }
 * //   }
 * // }
 * 
 * @example
 * // Input: Object with relationship name (required)
 * const schema = {
 *   title: { type: 'string' },
 *   author_id: { 
 *     type: 'number', 
 *     belongsTo: 'users', 
 *     as: 'author' 
 *   }
 * };
 * const input = {
 *   id: '456',
 *   title: 'Another Article',
 *   author: 789                         // Using relationship name (from 'as')
 * };
 * 
 * // Output: Relationship in JSON:API format
 * // {
 * //   data: {
 * //     type: 'articles',
 * //     id: '456',
 * //     attributes: {
 * //       title: 'Another Article'
 * //     },
 * //     relationships: {
 * //       author: {
 * //         data: { type: 'users', id: '789' }
 * //       }
 * //     }
 * //   }
 * // }
 *
 * @example
 * // Input: Object with relationship alias (preferred way)
 * const input = {
 *   id: '456',
 *   title: 'Another Article',
 *   author: 789                         // Using 'as' alias directly
 * };
 * // Output: Same JSON:API structure as above
 *
 * @example
 * // Input: Many-to-many relationship
 * const relationships = {
 *   tags: {
 *     manyToMany: {
 *       through: 'article_tags',
 *       foreignKey: 'article_id',
 *       otherKey: 'tag_id',
 *       otherType: 'tags'
 *     }
 *   }
 * };
 * const input = {
 *   title: 'Tagged Article',
 *   tags: ['10', '20', '30']            // Array of IDs
 * };
 * 
 * // Output: Array becomes relationship data array
 * // {
 * //   data: {
 * //     type: 'articles',
 * //     attributes: {
 * //       title: 'Tagged Article'
 * //     },
 * //     relationships: {
 * //       tags: {
 * //         data: [
 * //           { type: 'tags', id: '10' },
 * //           { type: 'tags', id: '20' },
 * //           { type: 'tags', id: '30' }
 * //         ]
 * //       }
 * //     }
 * //   }
 * // }
 * 
 * @example
 * // Input: Already JSON:API formatted
 * const input = {
 *   data: {
 *     type: 'articles',
 *     id: '1',
 *     attributes: { title: 'Already formatted' }
 *   }
 * };
 * // Output: Returned unchanged (detected by data.type)
 * 
 * @description
 * Used by:
 * - rest-api-plugin for POST/PUT/PATCH when simplified: true
 * - Processes input before validation and storage
 * 
 * Purpose:
 * - Provides developer-friendly plain object API
 * - Automatically detects and converts relationships
 * - Supports both foreign key and alias notation
 * - Maintains JSON:API compliance internally
 * - Allows gradual migration from simple to JSON:API
 * 
 * Data flow:
 * 1. Checks if already JSON:API (has data.type)
 * 2. Extracts ID from input object
 * 3. Processes belongsTo relationships from schema
 * 4. Processes hasMany/manyToMany from relationships
 * 5. Remaining fields become attributes
 * 6. Builds proper JSON:API document structure
 */
export const transformSimplifiedToJsonApi = (scope, deps) => {
  // Extract needed values from scope and deps
  const input = scope.inputRecord;
  const scopeName = deps.context.scopeName;
  const schema = deps.context.schemaStructure;
  const relationships = deps.context.schemaRelationships;

  // If already JSON:API format, return as-is
  if (input?.data?.type) {
    return input;
  }

  const attributes = {};
  const relationshipsData = {};
  const tempInput = { ...input }; // Create a mutable copy of the input

  const id = tempInput.id;
  delete tempInput.id; // Extract ID from tempInput

  // 1. Process belongsTo relationships (from schema fields)
  // Iterate through the schema structure to find belongsTo fields
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldDef.belongsTo && fieldDef.as) {
      const relAlias = fieldDef.as; // Only use the 'as' alias (relationship name)
      
      // Only check for the relationship name (e.g., 'country'), not the foreign key (e.g., 'country_id')
      if (tempInput[relAlias] !== undefined) {
        const valueToProcess = tempInput[relAlias];
        delete tempInput[relAlias]; // Remove from tempInput once processed
        
        relationshipsData[relAlias] = {
          data: valueToProcess ? { type: fieldDef.belongsTo, id: String(valueToProcess) } : null
        };
      }
    }
  }

  // 2. Process hasMany/manyToMany relationships (from relationships object)
  // Iterate through the relationships config to find hasMany/manyToMany
  for (const [relName, relConfig] of Object.entries(relationships || {})) {
    // Check if the user provided data for this relationship name
    if (tempInput[relName] !== undefined) {
      const value = tempInput[relName];
      delete tempInput[relName]; // Remove from tempInput once processed

      if ((relConfig.hasMany || relConfig.manyToMany) && Array.isArray(value)) {
        const targetType = relConfig.hasMany || relConfig.manyToMany?.otherType || relConfig.through;
        relationshipsData[relName] = {
          data: value.map(relId => ({ type: targetType, id: String(relId) }))
        };
      }
      // Handle single belongsTo relationships if they were also defined in 'relationships'
      // (though typically they are defined in schema.belongsTo)
      else if (relConfig.belongsTo && value !== undefined) {
          relationshipsData[relName] = {
              data: value ? { type: relConfig.belongsTo, id: String(value) } : null
          };
      }
    }
  }

  // 3. Any remaining fields in tempInput are attributes
  Object.assign(attributes, tempInput);

  return {
    data: {
      type: scopeName,
      ...(id && { id: String(id) }),
      ...(Object.keys(attributes).length > 0 && { attributes }),
      ...(Object.keys(relationshipsData).length > 0 && { relationships: relationshipsData })
    }
  };
};

/**
 * Transforms JSON:API response into simplified plain object
 * 
 * @param {Object} scope - Scope containing JSON:API response
 * @param {Object} scope.record - JSON:API document to transform
 * @param {Object} deps - Dependencies with context
 * @param {Object} deps.context.schemaStructure - Schema for mapping relationships
 * @param {Object} deps.context.schemaRelationships - Relationship configurations
 * @param {Object} deps.context.scopes - All scopes for nested transformations
 * @returns {Object|Object[]} Simplified object or array of objects
 * 
 * @example
 * // Input: Single resource JSON:API
 * const jsonApi = {
 *   data: {
 *     type: 'articles',
 *     id: '123',
 *     attributes: {
 *       title: 'My Article',
 *       content: 'Content here'
 *     }
 *   }
 * };
 * const result = transformJsonApiToSimplified(
 *   { record: jsonApi },
 *   { context: { schemaStructure: schema } }
 * );
 * 
 * // Output: Flattened object
 * // {
 * //   id: '123',
 * //   title: 'My Article',        // Attributes flattened
 * //   content: 'Content here'
 * // }
 * 
 * @example
 * // Input: Resource with belongsTo relationship
 * const schema = {
 *   title: { type: 'string' },
 *   author_id: { type: 'number', belongsTo: 'users', as: 'author' }
 * };
 * const jsonApi = {
 *   data: {
 *     type: 'articles',
 *     id: '456',
 *     attributes: { title: 'Article with Author' },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '789' }
 *       }
 *     }
 *   }
 * };
 * 
 * // Output: Relationship becomes foreign key
 * // {
 * //   id: '456',
 * //   title: 'Article with Author',
 * //   author: '789'                 // Using relationship name, not foreign key
 * // }
 * 
 * @example
 * // Input: Collection response
 * const jsonApi = {
 *   data: [
 *     {
 *       type: 'articles',
 *       id: '1',
 *       attributes: { title: 'First Article' }
 *     },
 *     {
 *       type: 'articles',
 *       id: '2',
 *       attributes: { title: 'Second Article' }
 *     }
 *   ],
 *   meta: { total: 2 },
 *   links: { next: '/articles?page=2' }
 * };
 * 
 * // Output: Preserves meta and links
 * // {
 * //   data: [
 * //     { id: '1', title: 'First Article' },
 * //     { id: '2', title: 'Second Article' }
 * //   ],
 * //   meta: { total: 2 },
 * //   links: { next: '/articles?page=2' }
 * // }
 *
 * @example
 * // Input: With included resources
 * const jsonApi = {
 *   data: {
 *     type: 'articles',
 *     id: '400',
 *     attributes: { title: 'JavaScript Guide' },
 *     relationships: {
 *       author: {
 *         data: { type: 'authors', id: '75' }
 *       },
 *       chapters: {
 *         data: [
 *           { type: 'chapters', id: '1001' },
 *           { type: 'chapters', id: '1002' }
 *         ]
 *       }
 *     }
 *   },
 *   included: [
 *     {
 *       type: 'authors',
 *       id: '75',
 *       attributes: { name: 'Jane Smith' }
 *     },
 *     {
 *       type: 'chapters',
 *       id: '1001',
 *       attributes: { number: 1, title: 'Introduction' }
 *     },
 *     {
 *       type: 'chapters',
 *       id: '1002',
 *       attributes: { number: 2, title: 'Basics' }
 *     }
 *   ]
 * };
 * 
 * // Output: Expands included resources
 * // {
 * //   id: '400',
 * //   title: 'JavaScript Guide',
 * //   author: {                    // Expanded from included (or just '75' if not included)
 * //     id: '75',
 * //     name: 'Jane Smith'
 * //   },
 * //   chapters: [                  // Expanded array (or ['1001', '1002'] if not included)
 * //     { id: '1001', number: 1, title: 'Introduction' },
 * //     { id: '1002', number: 2, title: 'Basics' }
 * //   ]
 * // }
 *
 * @description
 * Used by:
 * - rest-api-plugin for GET/QUERY when simplified: true
 * - Transforms responses before sending to client
 * 
 * Purpose:
 * - Provides cleaner response format for clients
 * - Restores foreign keys from relationships
 * - Expands included resources for convenience
 * - Maintains compatibility with collection metadata
 * - Handles both single and array responses
 * 
 * Data flow:
 * 1. Detects array vs single resource
 * 2. For arrays, preserves meta/links at root
 * 3. Calls transformSingleJsonApiToSimplified for each
 * 4. Returns simplified structure
 */
export const transformJsonApiToSimplified = (scope, deps) => {
  // Extract needed values from scope and deps
  const jsonApi = scope.record;
  const schema = deps.context.schemaStructure;
  const relationships = deps.context.schemaRelationships;
  const scopes = deps.context.scopes;

  if (!jsonApi?.data) return jsonApi;

  // Handle array response (QUERY)
  if (Array.isArray(jsonApi.data)) {
    const simplifiedData = jsonApi.data.map(item =>
      transformSingleJsonApiToSimplified(
        { data: item, included: jsonApi.included },
        { context: { schemaStructure: schema, schemaRelationships: relationships, scopes } }
      )
    );
    
    // For query results, return object with data, meta, and links
    const result = { data: simplifiedData };
    
    // Add meta if present
    if (jsonApi.meta) {
      result.meta = jsonApi.meta;
    }
    
    // Add links if present
    if (jsonApi.links) {
      result.links = jsonApi.links;
    }
    
    return result;
  }

  // Handle single response (no change for single resources)
  return transformSingleJsonApiToSimplified(
    { data: jsonApi.data, included: jsonApi.included },
    { context: { schemaStructure: schema, schemaRelationships: relationships, scopes } }
  );
};

/**
 * Transforms single JSON:API resource into simplified format
 * 
 * @param {Object} scope - Scope with data and included resources
 * @param {Object} scope.data - Single JSON:API resource object
 * @param {Array} scope.included - Array of included resources
 * @param {Object} deps - Dependencies with context
 * @param {Object} deps.context.schemaStructure - Resource schema
 * @param {Object} deps.context.schemaRelationships - Relationship configs
 * @param {Object} deps.context.scopes - All scopes for recursion
 * @returns {Object} Simplified plain object
 * 
 * @example
 * // Input: Basic resource with relationships
 * const data = {
 *   type: 'comments',
 *   id: '100',
 *   attributes: {
 *     text: 'Great article!',
 *     created_at: '2024-01-15'
 *   },
 *   relationships: {
 *     author: {
 *       data: { type: 'users', id: '50' }
 *     },
 *     article: {
 *       data: { type: 'articles', id: '200' }
 *     }
 *   }
 * };
 * const schema = {
 *   text: { type: 'string' },
 *   created_at: { type: 'datetime' },
 *   author_id: { type: 'number', belongsTo: 'users', as: 'author' },
 *   article_id: { type: 'number', belongsTo: 'articles', as: 'article' }
 * };
 * const result = transformSingleJsonApiToSimplified(
 *   { data: data, included: null },
 *   { context: { schemaStructure: schema } }
 * );
 * 
 * // Output: Flattened with foreign keys restored
 * // {
 * //   id: '100',
 * //   text: 'Great article!',
 * //   created_at: '2024-01-15',
 * //   author: '50',              // From relationships.author
 * //   article: '200'             // From relationships.article
 * // }
 * 
 * @example
 * // Input: Many-to-many relationships
 * const data = {
 *   type: 'articles',
 *   id: '300',
 *   attributes: { title: 'My Article' },
 *   relationships: {
 *     tags: {
 *       data: [
 *         { type: 'tags', id: '1' },
 *         { type: 'tags', id: '2' },
 *         { type: 'tags', id: '3' }
 *       ]
 *     }
 *   }
 * };
 * const relationships = {
 *   tags: { manyToMany: { via: 'article_tags' } }
 * };
 * 
 * // Output: Array of IDs using relationship name
 * // {
 * //   id: '300',
 * //   title: 'My Article',
 * //   tags: ['1', '2', '3']        // Relationship name directly, no _ids suffix
 * // }
 * 
 * @example
 * // Input: With included resources (recursive expansion)
 * const data = {
 *   type: 'books',
 *   id: '400',
 *   attributes: { title: 'JavaScript Guide' },
 *   relationships: {
 *     author: {
 *       data: { type: 'authors', id: '75' }
 *     },
 *     chapters: {
 *       data: [
 *         { type: 'chapters', id: '1001' },
 *         { type: 'chapters', id: '1002' }
 *       ]
 *     }
 *   }
 * };
 * const included = [
 *   {
 *     type: 'authors',
 *     id: '75',
 *     attributes: { name: 'Jane Smith' },
 *     relationships: {
 *       company: {
 *         data: { type: 'companies', id: '5' }
 *       }
 *     }
 *   },
 *   {
 *     type: 'chapters',
 *     id: '1001',
 *     attributes: { number: 1, title: 'Introduction' }
 *   },
 *   {
 *     type: 'chapters',
 *     id: '1002',
 *     attributes: { number: 2, title: 'Basics' }
 *   }
 * ];
 * 
 * // Output: Recursively expanded (note author.company)
 * // {
 * //   id: '400',
 * //   title: 'JavaScript Guide',
 * //   author: {                    // Expanded and transformed
 * //     id: '75',
 * //     name: 'Jane Smith',
 * //     company: '5'               // Author's relationships processed!
 * //   },
 * //   chapters: [
 * //     { id: '1001', number: 1, title: 'Introduction' },
 * //     { id: '1002', number: 2, title: 'Basics' }
 * //   ]
 * // }
 * 
 * @description
 * Used by:
 * - transformJsonApiToSimplified for each resource
 * - Calls itself recursively for included resources
 * 
 * Purpose:
 * - Core transformation logic for single resources
 * - Uses relationship names (not foreign keys)
 * - Creates arrays for to-many relationships (no _ids suffix)
 * - Recursively expands and transforms included data
 * - Handles polymorphic relationships
 * 
 * Data flow:
 * 1. Copies ID and attributes to result
 * 2. Processes each relationship:
 *    - BelongsTo: stores ID using relationship name
 *    - Polymorphic: stores as {type, id} object
 *    - HasMany/ManyToMany: creates array of IDs
 * 3. If included data exists:
 *    - Finds matching included resources
 *    - Recursively transforms them (preserving their relationships!)
 *    - Adds transformed objects/arrays to result
 * 
 * @private
 */
export const transformSingleJsonApiToSimplified = (scope, deps) => {
  // Extract needed values from scope and deps
  const data = scope.data;
  const included = scope.included;
  const schema = deps.context.schemaStructure;
  const relationships = deps.context.schemaRelationships;
  const scopes = deps.context.scopes;

  const simplified = {};

  // Add ID
  if (data.id) {
    simplified.id = data.id;
  }

  // Add attributes
  Object.assign(simplified, data.attributes || {});

  // Process relationships using relationship names (not foreign keys)
  if (data.relationships) {
    for (const [relName, relData] of Object.entries(data.relationships)) {
      // Find schema field for this belongsTo relationship
      const schemaEntry = Object.entries(schema).find(([_, def]) => def.as === relName);

      if (schemaEntry) {
        const [fieldName, fieldDef] = schemaEntry;
        if (fieldDef.belongsTo && relData.data) {
          // Use relationship name, not foreign key field name
          simplified[relName] = relData.data.id;
        }
      }

      // Check if this is a polymorphic relationship from the relationships config
      const rel = relationships?.[relName];
      if (rel?.belongsToPolymorphic && relData.data) {
        // For polymorphic relationships, keep as object with type and id
        simplified[relName] = {
          type: relData.data.type,
          id: relData.data.id
        };
      }

      // Handle many-to-many and hasMany (arrays without _ids suffix)
      if (rel?.hasMany || rel?.manyToMany) {
        if (relData.data && Array.isArray(relData.data)) {
          // Use relationship name directly, no _ids suffix
          simplified[relName] = relData.data.map(item => item.id);
        }
      }

      // Handle includes (nested objects)
      if (included && relData.data) {
        const findIncluded = (ref) =>
          included.find(inc => inc.type === ref.type && inc.id === ref.id);

        if (Array.isArray(relData.data)) {
          const nestedData = relData.data.map(findIncluded).filter(Boolean);
          if (nestedData.length > 0) {
            simplified[relName] = nestedData.map(item => {
              // For each included record, transform it recursively to restore its relationship fields
              const itemSimplified = transformSingleJsonApiToSimplified(
                { data: item, included: null },
                { context: { 
                  schemaStructure: scopes?.[item.type]?.vars?.schemaInfo?.schema || {},
                  schemaRelationships: scopes?.[item.type]?.vars?.schemaInfo?.schemaRelationships || {},
                  scopes
                } }
              );
              return itemSimplified;
            });
          }
        } else {
          const nestedData = findIncluded(relData.data);
          if (nestedData) {
            // Transform the single included record to restore its relationship fields
            simplified[relName] = transformSingleJsonApiToSimplified(
              { data: nestedData, included: null },
              { context: { 
                schemaStructure: scopes?.[nestedData.type]?.vars?.schemaInfo?.schema || {},
                schemaRelationships: scopes?.[nestedData.type]?.vars?.schemaInfo?.schemaRelationships || {},
                scopes
              } }
            );
          }
        }
      }
    }
  }

  return simplified;
};