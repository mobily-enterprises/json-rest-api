/**
 * Schema processing utilities for search and field dependencies
 * 
 * @description
 * This module provides utilities for:
 * - Marking search fields as indexed for database optimization
 * - Generating search schemas from various configuration sources
 * - Sorting fields by their dependencies (for getters/setters)
 * - Detecting circular dependencies in field definitions
 */

import { RestApiValidationError } from '../../../../lib/rest-api-errors.js';

/**
 * Marks all fields in a searchSchema as indexed for database optimization
 * 
 * @param {Object} searchSchema - Search schema object to process
 * @returns {void} Modifies the searchSchema in-place
 * 
 * @example
 * // Input: Search fields without index flags
 * const searchSchema = {
 *   title: { type: 'string', filterOperator: 'contains' },
 *   status: { type: 'string', filterOperator: '=' },
 *   created_at: { type: 'datetime', filterOperator: '>=' }
 * };
 * ensureSearchFieldsAreIndexed(searchSchema);
 * 
 * // Output: All fields marked as indexed
 * // {
 * //   title: { type: 'string', filterOperator: 'contains', indexed: true },
 * //   status: { type: 'string', filterOperator: '=', indexed: true },
 * //   created_at: { type: 'datetime', filterOperator: '>=', indexed: true }
 * // }
 * 
 * @example
 * // Input: Virtual field for cross-table search
 * const searchSchema = {
 *   name: { type: 'string', filterOperator: 'contains' },
 *   author_name: {                              // Virtual field
 *     type: 'string',
 *     filterOperator: 'contains',
 *     virtualField: {
 *       joinTo: 'users',
 *       joinOn: ['author_id', 'id'],
 *       searchField: 'name'
 *     }
 *   }
 * };
 * ensureSearchFieldsAreIndexed(searchSchema);
 * 
 * // Output: Both regular and virtual fields indexed
 * // {
 * //   name: { ..., indexed: true },
 * //   author_name: { ..., indexed: true }  // Enables efficient JOIN
 * // }
 * 
 * @example
 * // Input: Already indexed or explicitly false
 * const searchSchema = {
 *   email: { type: 'string', indexed: false },   // Explicitly false
 *   username: { type: 'string', indexed: true }   // Already true
 * };
 * ensureSearchFieldsAreIndexed(searchSchema);
 * 
 * // Output: All forced to indexed: true
 * // {
 * //   email: { type: 'string', indexed: true },    // Overridden
 * //   username: { type: 'string', indexed: true }   // Unchanged
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-plugin during scope initialization
 * - Applied to all searchSchema fields before storage setup
 * 
 * Purpose:
 * - Signals storage plugins which fields need database indexes
 * - Enables efficient filtering without full table scans
 * - Supports cross-table searches via indexed JOINs
 * - Improves query performance for filtered API requests
 * 
 * Data flow:
 * 1. Receives searchSchema object (or null)
 * 2. Iterates through each field definition
 * 3. Sets indexed: true on all fields
 * 4. Storage plugins use this flag for index creation
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
 * Generates complete searchSchema by merging schema search definitions with explicit searchSchema
 * 
 * @param {Object} schema - Main resource schema with optional 'search' properties
 * @param {Object} explicitSearchSchema - Optional explicit searchSchema to merge
 * @returns {Object|null} Merged searchSchema or null if no search fields
 * @throws {RestApiValidationError} If same field defined in multiple places
 * 
 * @example
 * // Input: Simple search fields in schema
 * const schema = {
 *   title: { type: 'string', search: true },              // Simple
 *   content: { type: 'text' },                            // Not searchable
 *   status: { type: 'string', search: { filterOperator: '=' } }  // Custom
 * };
 * const result = generateSearchSchemaFromSchema(schema, null);
 * 
 * // Output: Generated search schema
 * // {
 * //   title: { type: 'string', filterOperator: '=' },      // Default operator
 * //   status: { type: 'string', filterOperator: '=' }      // Specified operator
 * // }
 * 
 * @example
 * // Input: Multiple filters from one field
 * const schema = {
 *   published_at: {
 *     type: 'datetime',
 *     search: {
 *       published_after: { filterOperator: '>=', type: 'datetime' },
 *       published_before: { filterOperator: '<=', type: 'datetime' }
 *     }
 *   }
 * };
 * const result = generateSearchSchemaFromSchema(schema, null);
 * 
 * // Output: Two search fields from one database field
 * // {
 * //   published_after: { 
 * //     type: 'datetime', 
 * //     actualField: 'published_at',      // Maps to real field
 * //     filterOperator: '>=' 
 * //   },
 * //   published_before: { 
 * //     type: 'datetime', 
 * //     actualField: 'published_at',      // Same field, different operator
 * //     filterOperator: '<=' 
 * //   }
 * // }
 * 
 * @example
 * // Input: Merging with explicit searchSchema
 * const schema = {
 *   name: { type: 'string', search: true }
 * };
 * const explicitSearchSchema = {
 *   email: { type: 'string', filterOperator: '=' },
 *   age: { type: 'number', filterOperator: '>=' }
 * };
 * const result = generateSearchSchemaFromSchema(schema, explicitSearchSchema);
 * 
 * // Output: Combined from both sources
 * // {
 * //   email: { type: 'string', filterOperator: '=' },    // Explicit
 * //   age: { type: 'number', filterOperator: '>=' },     // Explicit
 * //   name: { type: 'string', filterOperator: '=' }      // From schema
 * // }
 * 
 * @example
 * // Input: Explicit searchSchema takes precedence
 * const schema = {
 *   email: { type: 'string', search: true }
 * };
 * const explicitSearchSchema = {
 *   email: { type: 'string', filterOperator: 'contains' }
 * };
 * const result = generateSearchSchemaFromSchema(schema, explicitSearchSchema);
 * // Output: Explicit searchSchema wins
 * // {
 * //   email: { type: 'string', filterOperator: 'contains' }  // Uses explicit definition
 * // }
 * 
 * @example
 * // Input: Virtual search fields
 * const schema = {
 *   title: { type: 'string' },
 *   _virtual: {
 *     search: {
 *       category_name: {                    // Doesn't exist in DB
 *         type: 'string',
 *         filterOperator: 'contains',
 *         virtualField: {
 *           joinTo: 'categories',
 *           joinOn: ['category_id', 'id'], // JOIN condition
 *           searchField: 'name'             // Field in related table
 *         }
 *       }
 *     }
 *   }
 * };
 * 
 * // Output: Virtual field for cross-table search
 * // {
 * //   category_name: {
 * //     type: 'string',
 * //     filterOperator: 'contains',
 * //     virtualField: { ... join config ... }
 * //   }
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-plugin during scope initialization
 * - Generates searchSchema from various sources
 * 
 * Purpose:
 * - Provides flexible search configuration options
 * - Enables virtual fields for cross-table searches
 * - Supports range queries (before/after patterns)
 * - Merges search:true fields with explicit searchSchema
 * - Explicit searchSchema always takes precedence
 * - Allows storage plugins to optimize queries
 * 
 * Data flow:
 * 1. Starts with explicit searchSchema (if any)
 * 2. Processes schema fields with 'search' property
 * 3. Skips fields already in explicit searchSchema (no conflicts)
 * 4. Handles multiple filters from single field
 * 5. Processes virtual search definitions
 * 6. Returns merged searchSchema or null
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
        // Check if field already exists in explicit searchSchema
        if (searchSchema[fieldName]) {
          // Skip - explicit searchSchema takes precedence
          // This allows searchSchema to override fields marked with search:true
          return;
        }
        
        // Simple boolean - copy entire field definition (except search) and add filterOperator
        const { search, ...fieldDefWithoutSearch } = fieldDef;
        searchSchema[fieldName] = {
          ...fieldDefWithoutSearch,
          // Preserve existing filterOperator or default to '='
          filterOperator: fieldDefWithoutSearch.filterOperator || '='
        };
      } else if (typeof effectiveSearch === 'object') {
        // Check if search defines multiple filter fields
        const hasNestedFilters = Object.values(effectiveSearch).some(
          v => typeof v === 'object' && v.filterOperator
        );
        
        if (hasNestedFilters) {
          // Multiple filters from one field (like published_after/before)
          Object.entries(effectiveSearch).forEach(([filterName, filterDef]) => {
            // Check if filter already exists in explicit searchSchema
            if (searchSchema[filterName]) {
              // Skip - explicit searchSchema takes precedence
              return;
            }
            
            searchSchema[filterName] = {
              type: fieldDef.type,
              actualField: fieldName,
              ...filterDef
            };
          });
        } else {
          // Check if field already exists in explicit searchSchema
          if (searchSchema[fieldName]) {
            // Skip - explicit searchSchema takes precedence
            return;
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
      // Check if filter already exists in explicit searchSchema
      if (searchSchema[filterName]) {
        // Skip - explicit searchSchema takes precedence
        return;
      }
      
      searchSchema[filterName] = filterDef;
    });
  }
  
  return Object.keys(searchSchema).length > 0 ? searchSchema : null;
};

/**
 * Generic topological sort for handling dependencies
 * 
 * @param {Array} items - Array of items to sort
 * @param {Function} getDependencies - Function that returns dependencies for an item
 * @returns {Array} Sorted array respecting dependencies
 * @throws {Error} If circular dependencies or unknown dependencies detected
 * 
 * @example
 * // Input: Simple dependency chain
 * const items = ['a', 'b', 'c'];
 * const deps = { a: ['b'], b: ['c'], c: [] };
 * const sorted = topologicalSort(items, item => deps[item]);
 * // Output: ['c', 'b', 'a']
 * // c first (no deps), then b (depends on c), then a (depends on b)
 * 
 * @example
 * // Input: Circular dependency
 * const items = ['a', 'b'];
 * const deps = { a: ['b'], b: ['a'] };  // Circular!
 * topologicalSort(items, item => deps[item]);
 * // Throws: Error "Circular dependency detected: b"
 * 
 * @example
 * // Input: Unknown dependency
 * const items = ['a', 'b'];
 * const deps = { a: ['c'], b: [] };     // 'c' not in items
 * topologicalSort(items, item => deps[item]);
 * // Throws: Error "Unknown dependency 'c' for 'a'"
 * 
 * @description
 * Used by:
 * - sortFieldsByDependencies for ordering field operations
 * - Any code needing dependency-based ordering
 * 
 * Purpose:
 * - Orders items so dependencies come before dependents
 * - Detects circular dependencies early
 * - Validates all dependencies exist
 * - Uses depth-first search algorithm
 */
export function topologicalSort(items, getDependencies) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();
  
  function visit(item) {
    if (visited.has(item)) return;
    
    if (visiting.has(item)) {
      throw new Error(`Circular dependency detected: ${item}`);
    }
    
    visiting.add(item);
    
    const dependencies = getDependencies(item) || [];
    for (const dep of dependencies) {
      if (!items.includes(dep)) {
        throw new Error(`Unknown dependency '${dep}' for '${item}'`);
      }
      visit(dep);
    }
    
    visiting.delete(item);
    visited.add(item);
    sorted.push(item);
  }
  
  for (const item of items) {
    visit(item);
  }
  
  return sorted;
}

/**
 * Sorts fields by their dependencies using topological sort
 * 
 * @param {Object} fields - Object with field definitions
 * @param {string} dependencyProperty - Property name containing dependencies
 * @returns {Array} Field names sorted by dependencies
 * @throws {Error} If circular dependencies or unknown fields detected
 * 
 * @example
 * // Input: Getter dependencies (fullName needs firstName and lastName)
 * const fields = {
 *   firstName: { getter: v => v.trim() },
 *   lastName: { getter: v => v.trim() },
 *   fullName: { 
 *     getter: (v, ctx) => `${ctx.attributes.firstName} ${ctx.attributes.lastName}`,
 *     runGetterAfter: ['firstName', 'lastName']
 *   }
 * };
 * const sorted = sortFieldsByDependencies(fields, 'runGetterAfter');
 * // Output: ['firstName', 'lastName', 'fullName']
 * // Ensures firstName/lastName getters run before fullName
 * 
 * @example
 * // Input: Complex dependency chain
 * const fields = {
 *   a: { runGetterAfter: ['b', 'c'] },    // a needs b and c
 *   b: { runGetterAfter: ['d'] },         // b needs d
 *   c: { runGetterAfter: ['d'] },         // c needs d
 *   d: { runGetterAfter: [] }             // d needs nothing
 * };
 * const sorted = sortFieldsByDependencies(fields, 'runGetterAfter');
 * // Output: ['d', 'b', 'c', 'a']
 * // d first, then b/c (both need d), then a (needs b/c)
 * 
 * @example
 * // Input: Circular dependency error
 * const fields = {
 *   a: { runGetterAfter: ['b'] },
 *   b: { runGetterAfter: ['a'] }          // Circular!
 * };
 * sortFieldsByDependencies(fields, 'runGetterAfter');
 * // Throws: Error "Circular dependency detected: a in runGetterAfter"
 * 
 * @description
 * Used by:
 * - Schema processing for getter/setter ordering
 * - Ensures dependent fields process after dependencies
 * 
 * Purpose:
 * - Orders field operations by dependencies
 * - Enables computed fields that depend on other fields
 * - Validates dependency graph is acyclic
 * - Provides clear error messages for debugging
 * 
 * Data flow:
 * 1. Extracts field names from object
 * 2. Calls topologicalSort with dependency function
 * 3. Returns ordered field names
 * 4. Enhances error messages with property name
 */
export function sortFieldsByDependencies(fields, dependencyProperty) {
  const fieldNames = Object.keys(fields);
  
  if (fieldNames.length === 0) return [];
  
  try {
    return topologicalSort(fieldNames, (fieldName) => {
      const field = fields[fieldName];
      return field[dependencyProperty] || [];
    });
  } catch (error) {
    if (error.message.includes('Circular dependency')) {
      throw new Error(`${error.message} in ${dependencyProperty}`);
    }
    throw error;
  }
}