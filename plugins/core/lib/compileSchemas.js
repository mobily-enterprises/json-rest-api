/**
 * @module compileSchemas
 * @description Schema compilation and enrichment for REST API resources
 * 
 * This module handles the lazy compilation of JSON schemas for resources,
 * including enrichment through hooks, search schema generation, and caching.
 * It ensures schemas are processed only once per resource for performance.
 * 
 * Why this is useful upstream:
 * - Provides lazy compilation to avoid processing unused schemas
 * - Enables schema enrichment through hooks for dynamic behavior
 * - Automatically generates search schemas from field definitions
 * - Ensures database indexes are created for searchable fields
 * - Caches compiled schemas for performance
 * - Supports both explicit and implicit search field definitions
 */

import { createSchema } from 'json-rest-schema';
import { ensureSearchFieldsAreIndexed, generateSearchSchemaFromSchema } from './schemaHelpers.js';

/**
 * Compiles and enriches schemas for a given scope.
 * This function must be called at the beginning of each REST method to ensure
 * schemas are processed and cached before use.
 * 
 * The compilation process:
 * 1. Clones the raw schema to avoid mutations
 * 2. Adds default type: 'id' to belongsTo fields
 * 3. Runs schema:enrich hooks for custom enrichment
 * 4. Creates schema objects using json-rest-schema
 * 5. Generates and enriches searchSchema if needed
 * 6. Caches all compiled schemas for the scope
 * 
 * @param {Object} scope - The scope object containing vars, runHooks, scopeOptions, etc.
 * @returns {Promise<void>} Resolves when schemas are compiled
 * 
 * @example <caption>Basic usage in REST method</caption>
 * // At the beginning of a REST method:
 * import { compileSchemas } from './lib/compileSchemas.js';
 * 
 * addScopeMethod('query', async (scope, params) => {
 *   await compileSchemas(scope);
 *   const schemaInfo = scope.vars.schemaInfo.schema;;
 *   // Now schema, searchSchema, and relationships are available
 * });
 * 
 * @example <caption>Schema enrichment through hooks</caption>
 * // A plugin can enrich schemas dynamically:
 * api.on('schema:enrich', ({ schema, scopeName }) => {
 *   if (scopeName === 'articles') {
 *     // Add computed field
 *     schema.wordCount = {
 *       type: 'number',
 *       compute: (article) => article.content.split(' ').length
 *     };
 *     // Make title required
 *     schema.title.required = true;
 *   }
 * });
 * 
 * @example <caption>Search schema generation</caption>
 * // Original schema:
 * const schema = {
 *   title: { type: 'string', search: true },  // Marked searchable
 *   content: { type: 'string' },              // Not searchable
 *   status: { type: 'string' }                // Not searchable by default
 * };
 * 
 * // Explicit searchSchema can override:
 * const searchSchema = {
 *   title: { type: 'string', filterUsing: 'contains' },
 *   status: { type: 'string', filterUsing: '=' },
 *   author_name: {  // Virtual field for joins
 *     type: 'string',
 *     filterUsing: 'contains',
 *     actualTable: 'users',
 *     actualField: 'name'
 *   }
 * };
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Lazy-load schemas only when needed (performance optimization)
 * // 2. Allow dynamic schema modifications through hooks
 * // 3. Automatically set up database indexes for searchable fields
 * // 4. Generate search schemas from field definitions (DRY principle)
 * // 5. Cache compiled schemas to avoid reprocessing
 * // 6. Support virtual search fields that join to other tables
 * // 7. Ensure belongsTo fields have proper type definitions
 */
export async function compileSchemas(scope, scopeName) {

  // Get raw schema and computed fields
  const rawSchema = scope.scopeOptions?.schema || {};
  const computed = scope.scopeOptions?.computed || {};
  
  // Validate computed fields to ensure they're properly defined
  // Example: profit_margin: { type: 'number', dependencies: ['price', 'cost'], compute: (ctx) => ... }
  Object.entries(computed).forEach(([fieldName, fieldDef]) => {
    // Every computed field must have a type (for JSON:API serialization)
    if (!fieldDef.type) {
      throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' must have a type`);
    }
    
    // If a compute function is provided, it must be a function
    // Note: compute is optional - you might use enrichAttributes hook instead
    if (fieldDef.compute && typeof fieldDef.compute !== 'function') {
      throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' has invalid compute function`);
    }
    
    // Dependencies are optional but recommended for automatic fetching
    // Example: dependencies: ['price', 'cost'] ensures these fields are 
    // fetched from DB even if not explicitly requested
  });
  
  // Deep clone schema while preserving functions
  const enrichedSchema = {};
  for (const [fieldName, fieldDef] of Object.entries(rawSchema)) {
    enrichedSchema[fieldName] = { ...fieldDef };
  }
  
  // Default enrichment: Add type to belongsTo fields
  for (const [fieldName, fieldDef] of Object.entries(enrichedSchema)) {
    if (fieldDef.belongsTo && !fieldDef.type) {
      fieldDef.type = 'id';
    }
  }
  
  // ADD LOGIC TO MAKE FIELDS SEARCHABLE HERE
  // Auto-detect pivot tables and make their foreign key fields searchable
  // This is critical for many-to-many relationship operations which need to filter pivot records
  const fields = Object.entries(enrichedSchema);
  const belongsToFields = fields.filter(([_, def]) => def.belongsTo);
  
  // If 2+ belongsTo fields and they make up 40%+ of non-id fields, likely a pivot table
  const nonIdFields = fields.filter(([name, _]) => name !== 'id');
  const isProbablyPivot = belongsToFields.length >= 2 && 
    (nonIdFields.length === 0 || belongsToFields.length / nonIdFields.length >= 0.4);
  
  if (isProbablyPivot) {
    // Make all belongsTo fields searchable for pivot operations
    for (const [fieldName, fieldDef] of belongsToFields) {
      if (!fieldDef.search) {
        fieldDef.search = true;
      }
    }
  }


  // Hook: schema:enrich
  const schemaContext = {
    schema: enrichedSchema,    // Mutable
    originalSchema: rawSchema,  // Read-only
    scopeName
  };
  await scope.runHooks('schema:enrich', schemaContext);
  
  // Create schema object
  const schemaObject = createSchema(schemaContext.schema);
  
  // Generate searchSchema by merging explicit searchSchema with fields marked search:true.
  // This allows two ways to define searchable fields: either mark fields with search:true
  // in the main schema, or provide an explicit searchSchema with more control over filtering.
  // The explicit searchSchema takes precedence and can define virtual fields for joins.
  // Example: title: {search: true} auto-generates a searchable field with sensible defaults,
  // while searchSchema can specify filterUsing: 'contains' or complex join configurations.
  let rawSearchSchema = scope.scopeOptions.searchSchema ||
  generateSearchSchemaFromSchema(schemaContext.schema);
  
  if (rawSearchSchema) {
    // Mark all search fields as indexed for database optimization.
    // This ensures that any field used for filtering will have a database index created,
    // dramatically improving query performance. Without indexes, filtering large tables
    // would require full table scans. The storage plugin uses these hints to create indexes.
    // Example: A status field marked for search gets indexed: true, enabling efficient
    // WHERE status = 'published' queries that can use index lookups instead of scanning all rows.
    ensureSearchFieldsAreIndexed(rawSearchSchema);
    
    // Hook: searchSchema:enrich
    const searchSchemaContext = {
      searchSchema: rawSearchSchema,    // Mutable
      schema: schemaContext.schema,     // Read-only enriched schema
      scopeName
    };
    await scope.runHooks('searchSchema:enrich', searchSchemaContext);
    
    // Create searchSchema object
    var searchSchemaObject = createSchema(searchSchemaContext.searchSchema);
  } else {
    var searchSchemaObject = null;
  }

  // Cache everything
  scope.vars.schemaInfo = {
    schema: schemaObject,
    schemaStructure: schemaContext.schema,
    computed: computed,
    searchSchema: searchSchemaObject,
    schemaRelationships: scope.scopeOptions.relationships || {},
    tableName: scope.scopeOptions.tableName || scopeName,
    idProperty: scope.scopeOptions.idProperty || scope.vars.idProperty
  };  
}