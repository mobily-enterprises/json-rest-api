/**
 * @module simplifiedHelpers
 * @description Transformation functions for converting between simplified and JSON:API formats
 * 
 * This module enables the REST API's "simplified mode" feature, which provides a more
 * developer-friendly alternative to the verbose JSON:API format. It allows APIs to
 * accept and return plain JavaScript objects while still maintaining JSON:API
 * compliance internally.
 */

import { RestApiValidationError } from '../../../lib/rest-api-errors.js';

/**
 * Transforms a simplified plain JavaScript object into a JSON:API compliant format.
 * 
 * This function is crucial for the REST API's "simplified mode" feature, which allows
 * developers to work with familiar plain objects instead of the verbose JSON:API format.
 * It intelligently converts plain objects into properly structured JSON:API documents
 * by analyzing the schema to determine what fields are attributes vs relationships.
 * 
 * @param {Object} scope - The scope object containing the input data to transform
 * @param {Object} scope.inputRecord - The input object to transform (plain object or already JSON:API)
 * @param {Object} deps - The dependencies object
 * @param {Object} deps.context - The context object containing configuration
 * @param {string} deps.context.scopeName - The resource type name (e.g., 'articles', 'users')
 * @param {Object} deps.context.schemaStructure - The resource schema defining field types and relationships
 * @param {Object} deps.context.schemaRelationships - The relationships configuration for the resource
 * @returns {Object} A properly formatted JSON:API document
 * 
 * @example
 * // Example 1: Simple object with attributes only
 * const input = {
 *   id: '123',
 *   title: 'My Article',
 *   content: 'Article content here'
 * };
 * const result = transformSimplifiedToJsonApi(
 *   { inputRecord: input },
 *   { context: { scopeName: 'articles', schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
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
 * // Example 2: Object with belongsTo relationship (using foreign key name)
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
 *   author_id: 789 // Original way: using foreign key name
 * };
 * const result = transformSimplifiedToJsonApi(
 *   { inputRecord: input },
 *   { context: { scopeName: 'articles', schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
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
 * // Example 3: Object with belongsTo relationship (using 'as' alias - NEW desired behavior)
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
 *   author: 789 // NEW way: using the 'as' alias
 * };
 * const result = transformSimplifiedToJsonApi(
 *   { inputRecord: input },
 *   { context: { scopeName: 'articles', schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns the same JSON:API structure as above
 *
 * @example
 * // Example 4: Object with many-to-many relationship
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
 *   tags: ['10', '20', '30']  // Array of tag IDs
 * };
 * const result = transformSimplifiedToJsonApi(
 *   { inputRecord: input },
 *   { context: { scopeName: 'articles', schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
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
 * // Example 5: Already JSON:API formatted - returns as-is
 * const input = {
 *   data: {
 *     type: 'articles',
 *     id: '1',
 *     attributes: { title: 'Already formatted' }
 *   }
 * };
 * const result = transformSimplifiedToJsonApi(
 *   { inputRecord: input },
 *   { context: { scopeName: 'articles', schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns the same object unchanged
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Accept familiar plain objects from API consumers (better DX)
 * // 2. Automatically convert foreign keys to proper relationships
 * // 3. Support both simple and JSON:API formats in the same endpoint
 * // 4. Reduce boilerplate in client applications
 * // 5. Maintain JSON:API compliance internally for consistency
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
    if (fieldDef.belongsTo) {
      const relAlias = fieldDef.as || fieldName; // Use 'as' alias or foreign key name as default alias
      let valueToProcess = undefined;

      // Check if both foreign key and alias are provided - this is an error
      if (fieldDef.as && tempInput[fieldName] !== undefined && tempInput[fieldDef.as] !== undefined) {
        throw new RestApiValidationError(
          `Cannot specify both '${fieldName}' and '${fieldDef.as}' for the same relationship. ` +
          `Use either '${fieldName}' (foreign key) or '${fieldDef.as}' (relationship name), not both.`,
          {
            fields: [fieldName, fieldDef.as],
            violations: [{
              field: 'input',
              rule: 'duplicate_relationship_specification',
              message: `Both '${fieldName}' and '${fieldDef.as}' were provided for the same relationship`
            }]
          }
        );
      }

      // Check if the user provided the foreign key name (e.g., country_id)
      if (tempInput[fieldName] !== undefined) {
        valueToProcess = tempInput[fieldName];
        delete tempInput[fieldName]; // Remove from tempInput once processed
      }
      // Check if the user provided the 'as' alias (e.g., country)
      else if (fieldDef.as && tempInput[fieldDef.as] !== undefined) {
        valueToProcess = tempInput[fieldDef.as];
        delete tempInput[fieldDef.as]; // Remove from tempInput once processed
      }

      if (valueToProcess !== undefined) {
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
 * Transforms a JSON:API formatted response into a simplified plain JavaScript object.
 * 
 * This function reverses the work of transformSimplifiedToJsonApi, converting verbose
 * JSON:API documents back into simple, flat JavaScript objects that are easier to work
 * with in application code. It handles both single resources and collections, and can
 * optionally expand included resources inline.
 * 
 * The transformation process:
 * 1. Flattens attributes directly onto the result object
 * 2. Converts belongsTo relationships back to foreign key fields (e.g., author -> author_id)
 * 3. Extracts many-to-many relationship IDs into arrays (e.g., tags -> tags_ids)
 * 4. Optionally expands included resources inline for convenient access
 * 
 * @param {Object} scope - The scope object containing the JSON:API response
 * @param {Object} scope.record - The JSON:API response to transform
 * @param {Object} deps - The dependencies object
 * @param {Object} deps.context - The context object containing configuration
 * @param {Object} deps.context.schemaStructure - The resource schema for mapping relationships back to fields
 * @param {Object} deps.context.schemaRelationships - The relationships configuration
 * @returns {Object|Array} Simplified object(s) - single object or array depending on input
 * 
 * @example
 * // Example 1: Single resource with attributes
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
 *   { context: { schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
 * // {
 * //   id: '123',
 * //   title: 'My Article',
 * //   content: 'Content here'
 * // }
 * 
 * @example
 * // Example 2: Resource with belongsTo relationship
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
 * const result = transformJsonApiToSimplified(
 *   { record: jsonApi },
 *   { context: { schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
 * // {
 * //   id: '456',
 * //   title: 'Article with Author',
 * //   author_id: '789'  // Foreign key restored
 * // }
 * 
 * @example
 * // Example 3: Collection of resources
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
 *   ]
 * };
 * const result = transformJsonApiToSimplified(
 *   { record: jsonApi },
 *   { context: { schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
 * // [
 * //   { id: '1', title: 'First Article' },
 * //   { id: '2', title: 'Second Article' }
 * // ]
 *
 * @example
 * // Example 4: Resource with included data expanded
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
 *       attributes: { name: 'Jane Smith', bio: 'Expert developer' }
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
 * const result = transformJsonApiToSimplified(
 *   { record: jsonApi },
 *   { context: { schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
 * // {
 * //   id: '400',
 * //   title: 'JavaScript Guide',
 * //   author_id: '75',
 * //   author: {  // Expanded from included
 * //     id: '75',
 * //     name: 'Jane Smith',
 * //     bio: 'Expert developer'
 * //   },
 * //   chapters_ids: ['1001', '1002'],
 * //   chapters: [ // Expanded array from included
 * //     { id: '1001', number: 1, title: 'Introduction' },
 * //     { id: '1002', number: 2, title: 'Basics' }
 * //   ]
 * // }
 *
 * @private
 */
export const transformJsonApiToSimplified = (scope, deps) => {
  // Extract needed values from scope and deps
  const jsonApi = scope.record;
  const schema = deps.context.schemaStructure;
  const relationships = deps.context.schemaRelationships;

  if (!jsonApi?.data) return jsonApi;

  // Handle array response (QUERY)
  if (Array.isArray(jsonApi.data)) {
    return jsonApi.data.map(item =>
      transformSingleJsonApiToSimplified(
        { data: item, included: jsonApi.included },
        { context: { schemaStructure: schema, schemaRelationships: relationships } }
      )
    );
  }

  // Handle single response
  return transformSingleJsonApiToSimplified(
    { data: jsonApi.data, included: jsonApi.included },
    { context: { schemaStructure: schema, schemaRelationships: relationships } }
  );
};

/**
 * Transforms a single JSON:API resource object into a simplified format.
 * 
 * This is the workhorse function that handles the actual transformation logic for
 * individual resources. It's used by transformJsonApiToSimplified for both single
 * resources and each item in a collection.
 * 
 * The transformation includes:
 * - Flattening the id and attributes onto the root object
 * - Converting relationship references back to foreign key fields
 * - Extracting many-to-many relationship IDs into _ids arrays
 * - Expanding included related resources when available
 * 
 * @param {Object} scope - The scope object containing the data
 * @param {Object} scope.data - Single JSON:API resource object
 * @param {Array} scope.included - Array of included resources from JSON:API response
 * @param {Object} deps - The dependencies object
 * @param {Object} deps.context - The context object containing configuration
 * @param {Object} deps.context.schemaStructure - Resource schema for field mappings
 * @param {Object} deps.context.schemaRelationships - Relationships configuration
 * @returns {Object} Simplified plain object
 * 
 * @example
 * // Example 1: Basic transformation with relationships
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
 *   { context: { schemaStructure: schema, schemaRelationships: {} } }
 * );
 * // Returns:
 * // {
 * //   id: '100',
 * //   text: 'Great article!',
 * //   created_at: '2024-01-15',
 * //   author_id: '50',    // Restored from relationships.author
 * //   article_id: '200'   // Restored from relationships.article
 * // }
 * 
 * @example
 * // Example 2: Many-to-many relationships become ID arrays
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
 * const result = transformSingleJsonApiToSimplified(
 *   { data: data, included: null },
 *   { context: { schemaStructure: {}, schemaRelationships: relationships } }
 * );
 * // Returns:
 * // {
 * //   id: '300',
 * //   title: 'My Article',
 * //   tags_ids: ['1', '2', '3']  // Array of IDs with _ids suffix
 * // }
 * 
 * @example
 * // Example 3: Expanding included resources
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
 *     attributes: { name: 'Jane Smith', bio: 'Expert developer' }
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
 * const result = transformSingleJsonApiToSimplified(
 *   { data: data, included: included },
 *   { context: { schemaStructure: schema, schemaRelationships: relationships } }
 * );
 * // Returns:
 * // {
 * //   id: '400',
 * //   title: 'JavaScript Guide',
 * //   author_id: '75',
 * //   author: {  // Expanded from included
 * //     id: '75',
 * //     name: 'Jane Smith',
 * //     bio: 'Expert developer'
 * //   },
 * //   chapters_ids: ['1001', '1002'],
 * //   chapters: [  // Expanded array from included
 * //     { id: '1001', number: 1, title: 'Introduction' },
 * //     { id: '1002', number: 2, title: 'Basics' }
 * //   ]
 * // }
 * 
 * @private
 */
export const transformSingleJsonApiToSimplified = (scope, deps) => {
  // Extract needed values from scope and deps
  const data = scope.data;
  const included = scope.included;
  const schema = deps.context.schemaStructure;
  const relationships = deps.context.schemaRelationships;

  const simplified = {};

  // Add ID
  if (data.id) {
    simplified.id = data.id;
  }

  // Add attributes
  Object.assign(simplified, data.attributes || {});

  // Extract foreign keys from relationships
  if (data.relationships) {
    for (const [relName, relData] of Object.entries(data.relationships)) {
      // Find schema field for this belongsTo relationship
      const schemaEntry = Object.entries(schema).find(([_, def]) => def.as === relName);

      if (schemaEntry) {
        const [fieldName, fieldDef] = schemaEntry;
        if (fieldDef.belongsTo && relData.data) {
          simplified[fieldName] = relData.data.id;
        }
      }

      // Handle many-to-many (just IDs, not nested)
      const rel = relationships?.[relName];
      if (rel?.hasMany || rel?.manyToMany) {
        if (relData.data && Array.isArray(relData.data)) {
          simplified[`${relName}_ids`] = relData.data.map(item => item.id);
        }
      }

      // Handle includes (nested objects)
      if (included && relData.data) {
        const findIncluded = (ref) =>
          included.find(inc => inc.type === ref.type && inc.id === ref.id);

        if (Array.isArray(relData.data)) {
          const nestedData = relData.data.map(findIncluded).filter(Boolean);
          if (nestedData.length > 0) {
            simplified[relName] = nestedData.map(item => ({
              id: item.id,
              ...item.attributes
            }));
          }
        } else {
          const nestedData = findIncluded(relData.data);
          if (nestedData) {
            simplified[relName] = {
              id: nestedData.id,
              ...nestedData.attributes
            };
          }
        }
      }
    }
  }

  return simplified;
};