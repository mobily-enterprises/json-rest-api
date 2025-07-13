/**
 * @module schemaHelpers
 * @description Schema helper functions for REST API plugin
 * 
 * This module provides utilities for processing and enhancing schemas,
 * particularly for search functionality. It ensures search fields are
 * properly indexed and generates comprehensive search schemas from
 * various configuration sources.
 */

import { RestApiValidationError } from '../../../lib/rest-api-errors.js';

/**
 * Automatically marks all fields in a searchSchema as indexed to enable efficient cross-table searches.
 * 
 * This function is essential for the cross-table search feature, which allows searching across
 * multiple related resources in a single query. By marking fields as indexed, it signals to
 * storage plugins (like Knex) that these fields should have database indexes created for
 * optimal query performance.
 * 
 * The function modifies the searchSchema in-place, adding `indexed: true` to each field
 * definition. This is typically called during scope initialization to prepare search fields
 * for efficient querying.
 * 
 * @param {Object} searchSchema - The searchSchema object to process
 * @returns {void} Modifies the searchSchema in-place
 * 
 * @example
 * // Example 1: Basic searchSchema indexing
 * const searchSchema = {
 *   title: { type: 'string', filterUsing: 'contains' },
 *   status: { type: 'string', filterUsing: '=' },
 *   created_at: { type: 'datetime', filterUsing: '>=' }
 * };
 * ensureSearchFieldsAreIndexed(searchSchema);
 * // After processing:
 * // {
 * //   title: { type: 'string', filterUsing: 'contains', indexed: true },
 * //   status: { type: 'string', filterUsing: '=', indexed: true },
 * //   created_at: { type: 'datetime', filterUsing: '>=', indexed: true }
 * // }
 * 
 * @example
 * // Example 2: Virtual fields for cross-table search
 * const searchSchema = {
 *   // Regular field
 *   name: { type: 'string', filterUsing: 'contains' },
 *   // Virtual field that searches in related table
 *   author_name: {
 *     type: 'string',
 *     filterUsing: 'contains',
 *     virtualField: {
 *       joinTo: 'users',
 *       joinOn: ['author_id', 'id'],
 *       searchField: 'name'
 *     }
 *   }
 * };
 * ensureSearchFieldsAreIndexed(searchSchema);
 * // Both fields are marked as indexed, enabling efficient joins
 * 
 * @example
 * // Example 3: Already indexed fields are not modified
 * const searchSchema = {
 *   email: { type: 'string', filterUsing: '=', indexed: false },  // Explicitly false
 *   username: { type: 'string', filterUsing: '=', indexed: true }  // Already true
 * };
 * ensureSearchFieldsAreIndexed(searchSchema);
 * // Results in:
 * // {
 * //   email: { type: 'string', filterUsing: '=', indexed: true },     // Overridden to true
 * //   username: { type: 'string', filterUsing: '=', indexed: true }   // Unchanged
 * // }
 * 
 * @example
 * // Example 4: Null or undefined searchSchema is safely handled
 * ensureSearchFieldsAreIndexed(null);      // No error, returns immediately
 * ensureSearchFieldsAreIndexed(undefined); // No error, returns immediately
 * ensureSearchFieldsAreIndexed({});        // Empty object remains empty
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Signal to storage plugins (like Knex) which fields need database indexes
 * // 2. Enable efficient filtering on search fields without full table scans
 * // 3. Support cross-table searches by ensuring join fields are indexed
 * // 4. Improve API response times for filtered queries
 * // 5. Allow storage plugins to create indexes automatically during migrations
 */
export function ensureSearchFieldsAreIndexed(searchSchema) {
  if (!searchSchema) return;
  
  Object.keys(searchSchema).forEach(fieldName => {
    const fieldDef = searchSchema[fieldName];
    if (fieldDef && typeof fieldDef === 'object') {
      // Mark the field as indexed for cross-table search support
      fieldDef.indexed = true;
    }
  });
}

/**
 * Generates a complete searchSchema by intelligently merging field definitions from the main schema
 * (fields with 'search' property) and an explicit searchSchema, with conflict detection.
 * 
 * This function is a cornerstone of the REST API's flexible search configuration. It allows
 * developers to define searchable fields in three ways:
 * 1. Inline in the schema with `search: true` or `search: { config }`
 * 2. In a separate explicit searchSchema
 * 3. As virtual fields in schema._virtual.search
 * 
 * The function performs intelligent merging while preventing conflicts that could lead to
 * ambiguous search behavior. It supports advanced search patterns like:
 * - Simple field searches with various operators (=, >, <, contains, etc.)
 * - Multiple filters from one field (e.g., date -> date_before, date_after)
 * - Virtual fields that don't exist in the database but map to searches
 * 
 * @param {Object} schema - The main resource schema that may contain fields with 'search' property
 * @param {Object} explicitSearchSchema - Optional explicit searchSchema to merge with
 * @returns {Object|null} The complete merged searchSchema, or null if no search fields defined
 * @throws {RestApiValidationError} If the same field is defined in multiple places
 * 
 * @example
 * // Example 1: Simple search fields in schema
 * const schema = {
 *   title: { type: 'string', search: true },              // Simple search
 *   content: { type: 'text' },                            // Not searchable
 *   status: { type: 'string', search: { filterUsing: '=' } }  // Custom operator
 * };
 * const searchSchema = generateSearchSchemaFromSchema(schema, null);
 * // Returns:
 * // {
 * //   title: { type: 'string', filterUsing: '=' },
 * //   status: { type: 'string', filterUsing: '=' }
 * // }
 * 
 * @example
 * // Example 2: Multiple filters from one field
 * const schema = {
 *   published_at: {
 *     type: 'datetime',
 *     search: {
 *       published_after: { filterUsing: '>=', type: 'datetime' },
 *       published_before: { filterUsing: '<=', type: 'datetime' }
 *     }
 *   }
 * };
 * const searchSchema = generateSearchSchemaFromSchema(schema, null);
 * // Returns:
 * // {
 * //   published_after: { 
 * //     type: 'datetime', 
 * //     actualField: 'published_at',  // Maps to real field
 * //     filterUsing: '>=' 
 * //   },
 * //   published_before: { 
 * //     type: 'datetime', 
 * //     actualField: 'published_at', 
 * //     filterUsing: '<=' 
 * //   }
 * // }
 * 
 * @example
 * // Example 3: Merging with explicit searchSchema
 * const schema = {
 *   name: { type: 'string', search: true }
 * };
 * const explicitSearchSchema = {
 *   email: { type: 'string', filterUsing: '=' },
 *   age: { type: 'number', filterUsing: '>=' }
 * };
 * const searchSchema = generateSearchSchemaFromSchema(schema, explicitSearchSchema);
 * // Returns:
 * // {
 * //   email: { type: 'string', filterUsing: '=' },    // From explicit
 * //   age: { type: 'number', filterUsing: '>=' },     // From explicit
 * //   name: { type: 'string', filterUsing: '=' }      // From schema
 * // }
 * 
 * @example
 * // Example 4: Conflict detection
 * const schema = {
 *   email: { type: 'string', search: true }
 * };
 * const explicitSearchSchema = {
 *   email: { type: 'string', filterUsing: 'contains' }
 * };
 * generateSearchSchemaFromSchema(schema, explicitSearchSchema);
 * // Throws RestApiValidationError:
 * // "Field 'email' is defined in both schema (with search: true) and explicit searchSchema."
 * 
 * @example
 * // Example 5: Virtual search fields
 * const schema = {
 *   title: { type: 'string' },
 *   _virtual: {
 *     search: {
 *       category_name: {
 *         type: 'string',
 *         filterUsing: 'contains',
 *         virtualField: {
 *           joinTo: 'categories',
 *           joinOn: ['category_id', 'id'],
 *           searchField: 'name'
 *         }
 *       }
 *     }
 *   }
 * };
 * const searchSchema = generateSearchSchemaFromSchema(schema, null);
 * // Returns:
 * // {
 * //   category_name: {
 * //     type: 'string',
 * //     filterUsing: 'contains',
 * //     virtualField: { ... }  // Virtual field config for cross-table search
 * //   }
 * // }
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Provide flexible search configuration without duplicating field definitions
 * // 2. Enable virtual fields that don't exist in the database (like category_name)
 * // 3. Support complex search patterns (date ranges, cross-table searches)
 * // 4. Validate search configuration at startup to catch errors early
 * // 5. Allow storage plugins to optimize queries based on search patterns
 * // 6. Enable API consumers to filter by related data without complex joins
 */
export const generateSearchSchemaFromSchema = (schema, explicitSearchSchema) => {
  // Start with explicit searchSchema or empty object
  const searchSchema = explicitSearchSchema ? {...explicitSearchSchema} : {};
  
  if (!schema) {
    return Object.keys(searchSchema).length > 0 ? searchSchema : null;
  }
  
  // Process schema fields with 'search' property
  Object.entries(schema).forEach(([fieldName, fieldDef]) => {
    const effectiveSearch = fieldDef.search;
    
    if (effectiveSearch) {
      if (effectiveSearch === true) {
        // Check for conflicts with explicit searchSchema
        if (searchSchema[fieldName]) {
          throw new RestApiValidationError(
            `Field '${fieldName}' is defined in both schema (with search: true) and explicit searchSchema. Remove one definition to avoid conflicts.`,
            { 
              fields: [fieldName],
              violations: [{
                field: fieldName,
                rule: 'duplicate_search_field',
                message: 'Field cannot be defined in both schema and searchSchema'
              }]
            }
          );
        }
        
        // Simple boolean - copy entire field definition (except search) and add filterUsing
        const { search, ...fieldDefWithoutSearch } = fieldDef;
        searchSchema[fieldName] = {
          ...fieldDefWithoutSearch,
          // Default filter behavior based on type
          filterUsing: fieldDef.type === 'string' ? '=' : '='
        };
      } else if (typeof effectiveSearch === 'object') {
        // Check if search defines multiple filter fields
        const hasNestedFilters = Object.values(effectiveSearch).some(
          v => typeof v === 'object' && v.filterUsing
        );
        
        if (hasNestedFilters) {
          // Multiple filters from one field (like published_after/before)
          Object.entries(effectiveSearch).forEach(([filterName, filterDef]) => {
            // Check for conflicts
            if (searchSchema[filterName]) {
              throw new RestApiValidationError(
                `Field '${filterName}' is defined in both schema (with search) and explicit searchSchema. Remove one definition to avoid conflicts.`,
                { 
                  fields: [filterName],
                  violations: [{
                    field: filterName,
                    rule: 'duplicate_search_field',
                    message: 'Field cannot be defined in both schema and searchSchema'
                  }]
                }
              );
            }
            
            searchSchema[filterName] = {
              type: fieldDef.type,
              actualField: fieldName,
              ...filterDef
            };
          });
        } else {
          // Check for conflicts
          if (searchSchema[fieldName]) {
            throw new RestApiValidationError(
              `Field '${fieldName}' is defined in both schema (with search) and explicit searchSchema. Remove one definition to avoid conflicts.`,
              { 
                fields: [fieldName],
                violations: [{
                  field: fieldName,
                  rule: 'duplicate_search_field',
                  message: 'Field cannot be defined in both schema and searchSchema'
                }]
              }
            );
          }
          
          // Single filter with config
          searchSchema[fieldName] = {
            type: fieldDef.type,
            ...effectiveSearch
          };
        }
      }
    }
  });
  
  // Handle _virtual search definitions
  if (schema._virtual?.search) {
    Object.entries(schema._virtual.search).forEach(([filterName, filterDef]) => {
      // Check for conflicts
      if (searchSchema[filterName]) {
        throw new RestApiValidationError(
          `Field '${filterName}' is defined in both schema (_virtual.search) and explicit searchSchema. Remove one definition to avoid conflicts.`,
          { 
            fields: [filterName],
            violations: [{
              field: filterName,
              rule: 'duplicate_search_field',
              message: 'Field cannot be defined in both schema and searchSchema'
            }]
          }
        );
      }
      
      searchSchema[filterName] = filterDef;
    });
  }
  
  return Object.keys(searchSchema).length > 0 ? searchSchema : null;
};